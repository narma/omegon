/**
 * Auth Extension — authentication status, diagnosis, and refresh across dev tools.
 *
 * Registers:
 *   - `whoami` tool: LLM-callable auth status check
 *   - `/auth` command: interactive auth management
 *     - `/auth` or `/auth status` — check all providers
 *     - `/auth check <provider>` — check a specific provider
 *     - `/auth refresh <provider>` — attempt to refresh credentials
 *     - `/auth list` — list available providers
 *
 * Security model:
 *   - Auth NEVER stores, caches, or manipulates secret values directly.
 *   - All credential storage flows through 00-secrets (`/secrets configure`).
 *   - Auth reads process.env (populated by 00-secrets at init) to check
 *     whether token env vars are set.
 *   - Auth runs CLI tools (`gh`, `glab`, `aws`, etc.) to check session state
 *     and parse error output for specific failure reasons.
 *
 * Load order: 01-auth loads after 00-secrets, so process.env is populated.
 *
 * @secret GITHUB_TOKEN "GitHub personal access token (alternative to gh auth login)"
 * @secret GITLAB_TOKEN "GitLab personal access token (alternative to glab auth login)"
 * @secret AWS_ACCESS_KEY_ID "AWS access key ID (alternative to aws sso login)"
 * @secret AWS_SECRET_ACCESS_KEY "AWS secret access key"
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// ─── Types ───────────────────────────────────────────────────────

export type AuthStatus = "ok" | "expired" | "invalid" | "none" | "missing";

export interface AuthResult {
	provider: string;
	status: AuthStatus;
	detail: string;
	error?: string;
	refresh?: string;
	secretHint?: string;
}

export interface AuthProvider {
	/** Unique identifier: "github", "gitlab", "aws", etc. */
	id: string;
	/** Display name: "GitHub", "GitLab", "AWS", etc. */
	name: string;
	/** CLI binary name: "gh", "glab", "aws", etc. */
	cli: string;
	/** Env var that can provide a token (checked via process.env, populated by 00-secrets) */
	tokenEnvVar?: string;
	/** Command to refresh/login */
	refreshCommand: string;
	/** Check auth status. Returns structured result with diagnosis. */
	check(pi: ExtensionAPI, signal?: AbortSignal): Promise<AuthResult>;
}

// ─── Error Diagnosis Helpers ─────────────────────────────────────

/** Classify common HTTP/auth error patterns from CLI stderr. */
function diagnoseError(stderr: string): { status: AuthStatus; reason: string } {
	const lower = stderr.toLowerCase();

	// Expired tokens
	if (lower.includes("expired") || lower.includes("expiredtoken") || lower.includes("token has expired")
		|| lower.includes("token is expired") || lower.includes("session expired")) {
		return { status: "expired", reason: "Token or session has expired" };
	}

	// Invalid/revoked tokens
	if (lower.includes("invalid") || lower.includes("unauthorized") || lower.includes("401")
		|| lower.includes("bad credentials") || lower.includes("authentication failed")
		|| lower.includes("revoked") || lower.includes("denied")) {
		return { status: "invalid", reason: extractErrorLine(stderr) };
	}

	// Forbidden (authenticated but no access)
	if (lower.includes("403") || lower.includes("forbidden") || lower.includes("insufficient scope")) {
		return { status: "invalid", reason: `Authenticated but forbidden: ${extractErrorLine(stderr)}` };
	}

	// Not logged in
	if (lower.includes("not logged") || lower.includes("no token") || lower.includes("not authenticated")
		|| lower.includes("login required") || lower.includes("no credentials")) {
		return { status: "none", reason: "Not authenticated" };
	}

	return { status: "none", reason: extractErrorLine(stderr) || "Authentication failed" };
}

/** Extract the most informative error line from multi-line stderr. */
function extractErrorLine(stderr: string): string {
	const lines = stderr.trim().split("\n").filter(l => l.trim());
	// Prefer lines with "error", "failed", or specific status info
	const errorLine = lines.find(l => /error|failed|invalid|expired|denied|unauthorized/i.test(l));
	if (errorLine) return errorLine.trim().slice(0, 200);
	// Fall back to first non-empty line
	return (lines[0] || "Unknown error").trim().slice(0, 200);
}

// ─── Providers ───────────────────────────────────────────────────

const gitProvider: AuthProvider = {
	id: "git",
	name: "Git",
	cli: "git",
	refreshCommand: 'git config --global user.name "Your Name" && git config --global user.email "you@example.com"',

	async check(pi, signal) {
		const nameResult = await pi.exec("git", ["config", "user.name"], { signal, timeout: 5_000 });
		const emailResult = await pi.exec("git", ["config", "user.email"], { signal, timeout: 5_000 });
		const name = nameResult.stdout.trim() || "";
		const email = emailResult.stdout.trim() || "";

		if (name && email) {
			return { provider: "git", status: "ok", detail: `${name} <${email}>` };
		}
		return {
			provider: "git",
			status: "none",
			detail: `name: ${name || "(not set)"}, email: ${email || "(not set)"}`,
			refresh: this.refreshCommand,
		};
	},
};

const githubProvider: AuthProvider = {
	id: "github",
	name: "GitHub",
	cli: "gh",
	tokenEnvVar: "GITHUB_TOKEN",
	refreshCommand: "gh auth login",

	async check(pi, signal) {
		const which = await pi.exec("which", ["gh"], { signal, timeout: 3_000 });
		if (which.code !== 0) {
			return { provider: "github", status: "missing", detail: "gh CLI not installed" };
		}

		const result = await pi.exec("gh", ["auth", "status"], { signal, timeout: 10_000 });
		const output = (result.stdout + "\n" + result.stderr).trim();

		if (result.code === 0) {
			const accountMatch = output.match(/Logged in to .+ as (\S+)/);
			const scopeMatch = output.match(/Token scopes:(.+)/);
			let detail = accountMatch ? accountMatch[1] : "authenticated";
			if (scopeMatch) detail += ` (scopes: ${scopeMatch[1].trim()})`;
			return { provider: "github", status: "ok", detail, refresh: this.refreshCommand };
		}

		const diag = diagnoseError(output);
		return {
			provider: "github",
			status: diag.status,
			detail: diag.reason,
			error: output.slice(0, 300),
			refresh: this.refreshCommand,
			secretHint: "GITHUB_TOKEN",
		};
	},
};

const gitlabProvider: AuthProvider = {
	id: "gitlab",
	name: "GitLab",
	cli: "glab",
	tokenEnvVar: "GITLAB_TOKEN",
	refreshCommand: "glab auth login",

	async check(pi, signal) {
		const which = await pi.exec("which", ["glab"], { signal, timeout: 3_000 });
		if (which.code !== 0) {
			// glab not installed — check if GITLAB_TOKEN is set via secrets
			if (process.env.GITLAB_TOKEN) {
				return {
					provider: "gitlab",
					status: "ok",
					detail: "GITLAB_TOKEN set (glab CLI not installed)",
				};
			}
			return { provider: "gitlab", status: "missing", detail: "glab CLI not installed" };
		}

		const result = await pi.exec("glab", ["auth", "status"], { signal, timeout: 10_000 });
		const output = (result.stdout + "\n" + result.stderr).trim();

		if (result.code === 0) {
			const accountMatch = output.match(/Logged in to .+ as (\S+)/i);
			const hostMatch = output.match(/Logged in to (\S+)/i);
			let detail = accountMatch ? accountMatch[1] : "authenticated";
			if (hostMatch) detail += ` @ ${hostMatch[1]}`;
			return { provider: "gitlab", status: "ok", detail, refresh: this.refreshCommand };
		}

		const diag = diagnoseError(output);
		return {
			provider: "gitlab",
			status: diag.status,
			detail: diag.reason,
			error: output.slice(0, 300),
			refresh: this.refreshCommand,
			secretHint: "GITLAB_TOKEN",
		};
	},
};

const awsProvider: AuthProvider = {
	id: "aws",
	name: "AWS",
	cli: "aws",
	tokenEnvVar: "AWS_ACCESS_KEY_ID",
	refreshCommand: "aws sso login --profile <profile>",

	async check(pi, signal) {
		const which = await pi.exec("which", ["aws"], { signal, timeout: 3_000 });
		if (which.code !== 0) {
			return { provider: "aws", status: "missing", detail: "aws CLI not installed" };
		}

		const result = await pi.exec("aws", ["sts", "get-caller-identity", "--output", "json"], { signal, timeout: 10_000 });

		if (result.code === 0) {
			try {
				const identity = JSON.parse(result.stdout.trim());
				return {
					provider: "aws",
					status: "ok",
					detail: identity.Arn || identity.Account || "authenticated",
					refresh: this.refreshCommand,
				};
			} catch {
				return { provider: "aws", status: "ok", detail: "authenticated", refresh: this.refreshCommand };
			}
		}

		const diag = diagnoseError(result.stderr || result.stdout);
		return {
			provider: "aws",
			status: diag.status,
			detail: diag.reason,
			error: (result.stderr || result.stdout).slice(0, 300),
			refresh: this.refreshCommand,
			secretHint: "AWS_ACCESS_KEY_ID",
		};
	},
};

const kubernetesProvider: AuthProvider = {
	id: "kubernetes",
	name: "Kubernetes",
	cli: "kubectl",
	refreshCommand: "kubectl config use-context <context>",

	async check(pi, signal) {
		const which = await pi.exec("which", ["kubectl"], { signal, timeout: 3_000 });
		if (which.code !== 0) {
			return { provider: "kubernetes", status: "missing", detail: "kubectl not installed" };
		}

		const ctx = await pi.exec("kubectl", ["config", "current-context"], { signal, timeout: 5_000 });
		if (ctx.code === 0) {
			const context = ctx.stdout.trim();
			// Verify the context actually works
			const verify = await pi.exec("kubectl", ["cluster-info", "--request-timeout=5s"], { signal, timeout: 10_000 });
			if (verify.code === 0) {
				return {
					provider: "kubernetes",
					status: "ok",
					detail: `context: ${context}`,
					refresh: this.refreshCommand,
				};
			}
			const diag = diagnoseError(verify.stderr || verify.stdout);
			return {
				provider: "kubernetes",
				status: diag.status,
				detail: `context: ${context} — ${diag.reason}`,
				error: (verify.stderr || "").slice(0, 300),
				refresh: this.refreshCommand,
			};
		}

		return {
			provider: "kubernetes",
			status: "none",
			detail: "No context set",
			refresh: this.refreshCommand,
		};
	},
};

const ociProvider: AuthProvider = {
	id: "oci",
	name: "OCI Registry (ghcr.io)",
	cli: "podman",
	refreshCommand: "gh auth token | podman login ghcr.io -u <user> --password-stdin",

	async check(pi, signal) {
		const podmanWhich = await pi.exec("which", ["podman"], { signal, timeout: 3_000 });
		const dockerWhich = await pi.exec("which", ["docker"], { signal, timeout: 3_000 });
		const cmd = podmanWhich.code === 0 ? "podman" : dockerWhich.code === 0 ? "docker" : null;

		if (!cmd) {
			return { provider: "oci", status: "missing", detail: "Neither podman nor docker installed" };
		}

		// Update refresh command to use actual container runtime
		const refresh = `gh auth token | ${cmd} login ghcr.io -u $(gh api user --jq .login) --password-stdin`;

		const result = await pi.exec(cmd, ["login", "--get-login", "ghcr.io"], { signal, timeout: 5_000 });
		if (result.code === 0) {
			return {
				provider: "oci",
				status: "ok",
				detail: `ghcr.io: ${result.stdout.trim()} (${cmd})`,
				refresh,
			};
		}

		return {
			provider: "oci",
			status: "none",
			detail: `Not logged in to ghcr.io (${cmd})`,
			refresh,
		};
	},
};

// ─── Provider Registry ───────────────────────────────────────────

/** All providers, ordered by typical check priority. */
const ALL_PROVIDERS: AuthProvider[] = [
	gitProvider,
	githubProvider,
	gitlabProvider,
	awsProvider,
	kubernetesProvider,
	ociProvider,
];

function findProvider(idOrName: string): AuthProvider | undefined {
	const lower = idOrName.toLowerCase();
	return ALL_PROVIDERS.find(p => p.id === lower || p.name.toLowerCase() === lower);
}

// ─── Formatting ──────────────────────────────────────────────────

const STATUS_ICONS: Record<AuthStatus, string> = {
	ok: "✓",
	expired: "⚠",
	invalid: "✗",
	none: "✗",
	missing: "·",
};

function formatResults(results: AuthResult[]): string {
	const lines: string[] = ["**Auth Status**", ""];

	for (const r of results) {
		const icon = STATUS_ICONS[r.status];
		let line = `  ${icon}  **${r.provider}**: ${r.detail}`;
		if (r.error && r.status !== "ok") {
			line += `\n      Error: ${r.error.split("\n")[0].slice(0, 120)}`;
		}
		lines.push(line);
	}

	// Actionable items
	const fixable = results.filter(r =>
		r.status === "expired" || r.status === "invalid" || r.status === "none"
	);
	if (fixable.length > 0) {
		lines.push("", "**To fix:**");
		for (const r of fixable) {
			if (r.status === "expired") {
				lines.push(`  ${r.provider}: token expired → \`${r.refresh}\``);
			} else if (r.status === "invalid") {
				lines.push(`  ${r.provider}: credentials invalid → \`${r.refresh}\``);
				if (r.secretHint) {
					lines.push(`    Or configure via: \`/secrets configure ${r.secretHint}\``);
				}
			} else {
				lines.push(`  ${r.provider}: \`${r.refresh}\``);
				if (r.secretHint) {
					lines.push(`    Or configure via: \`/secrets configure ${r.secretHint}\``);
				}
			}
		}
	}

	return lines.join("\n");
}

// ─── Extension ───────────────────────────────────────────────────

export default function authExtension(pi: ExtensionAPI) {

	// ── Tool: whoami (LLM-callable) ───────────────────────────────

	pi.registerTool({
		name: "whoami",
		label: "Auth Status",
		description:
			"Check authentication status across development tools " +
			"(git, GitHub, GitLab, AWS, Kubernetes, OCI registries). " +
			"Returns structured status with error diagnosis and refresh " +
			"commands for expired or missing sessions.",
		promptSnippet:
			"Check auth status across dev tools (git, GitHub, GitLab, AWS, k8s, OCI registries)",

		parameters: Type.Object({}),

		async execute(_toolCallId, _params, signal, _onUpdate, _ctx) {
			const results: AuthResult[] = [];
			for (const provider of ALL_PROVIDERS) {
				try {
					results.push(await provider.check(pi, signal));
				} catch (e: any) {
					results.push({
						provider: provider.name,
						status: "none",
						detail: `Check failed: ${e.message}`,
					});
				}
			}

			const text = formatResults(results);
			return {
				content: [{ type: "text", text }],
				details: {
					checks: results.map(r => ({
						provider: r.provider,
						status: r.status,
						detail: r.detail,
						error: r.error,
					})),
				},
			};
		},
	});

	// ── Command: /auth ────────────────────────────────────────────

	pi.registerCommand("auth", {
		description: "Auth management: status | check <provider> | refresh <provider> | list",
		getArgumentCompletions: (prefix: string) => {
			const parts = prefix.split(/\s+/);
			if (parts.length <= 1) {
				const subs = ["status", "check", "refresh", "list"];
				const filtered = subs.filter(s => s.startsWith(parts[0] || ""));
				return filtered.length > 0
					? filtered.map(s => ({ value: s, label: s }))
					: null;
			}
			const sub = parts[0];
			if ((sub === "check" || sub === "refresh") && parts.length === 2) {
				const partial = parts[1] || "";
				return ALL_PROVIDERS
					.filter(p => p.id.startsWith(partial) || p.name.toLowerCase().startsWith(partial))
					.map(p => ({
						value: `${sub} ${p.id}`,
						label: `${p.id} — ${p.name}`,
					}));
			}
			return null;
		},

		handler: async (args, ctx) => {
			const parts = (args || "status").trim().split(/\s+/);
			const subcommand = parts[0];
			const providerArg = parts.slice(1).join(" ");

			switch (subcommand) {
				case "status":
				case "": {
					const results: AuthResult[] = [];
					for (const provider of ALL_PROVIDERS) {
						try {
							results.push(await provider.check(pi));
						} catch (e: any) {
							results.push({
								provider: provider.name,
								status: "none",
								detail: `Check failed: ${e.message}`,
							});
						}
					}
					const text = formatResults(results);
					pi.sendMessage({ customType: "view", content: text, display: true });
					break;
				}

				case "check": {
					if (!providerArg) {
						ctx.ui.notify("Usage: /auth check <provider>  (try /auth list)", "error");
						return;
					}
					const provider = findProvider(providerArg);
					if (!provider) {
						ctx.ui.notify(
							`Unknown provider: ${providerArg}\nAvailable: ${ALL_PROVIDERS.map(p => p.id).join(", ")}`,
							"error"
						);
						return;
					}
					try {
						const result = await provider.check(pi);
						const text = formatResults([result]);
						pi.sendMessage({ customType: "view", content: text, display: true });
					} catch (e: any) {
						ctx.ui.notify(`Check failed: ${e.message}`, "error");
					}
					break;
				}

				case "refresh": {
					if (!providerArg) {
						ctx.ui.notify("Usage: /auth refresh <provider>  (try /auth list)", "error");
						return;
					}
					const provider = findProvider(providerArg);
					if (!provider) {
						ctx.ui.notify(
							`Unknown provider: ${providerArg}\nAvailable: ${ALL_PROVIDERS.map(p => p.id).join(", ")}`,
							"error"
						);
						return;
					}

					// Check current state first
					let current: AuthResult;
					try {
						current = await provider.check(pi);
					} catch (e: any) {
						ctx.ui.notify(`Check failed: ${e.message}`, "error");
						return;
					}

					if (current.status === "ok") {
						ctx.ui.notify(`${provider.name} is already authenticated: ${current.detail}`, "info");
						return;
					}

					if (current.status === "missing") {
						ctx.ui.notify(
							`${provider.name}: ${provider.cli} CLI is not installed.\n` +
							(provider.tokenEnvVar
								? `You can set ${provider.tokenEnvVar} instead: /secrets configure ${provider.tokenEnvVar}`
								: `Install ${provider.cli} first.`),
							"warning"
						);
						return;
					}

					// Offer refresh options
					const options: string[] = [];
					options.push(`Run: ${provider.refreshCommand}`);
					if (provider.tokenEnvVar) {
						options.push(`Configure token: /secrets configure ${provider.tokenEnvVar}`);
					}
					options.push("Cancel");

					const statusLabel = current.status === "expired"
						? "expired"
						: current.status === "invalid"
							? "invalid"
							: "not authenticated";

					const choice = await ctx.ui.select(
						`${provider.name} — ${statusLabel}\n` +
						(current.error ? `Error: ${current.error.split("\n")[0].slice(0, 120)}\n` : "") +
						`\nHow would you like to fix this?`,
						options
					);

					if (!choice || choice === "Cancel") return;

					if (choice.startsWith("Configure token")) {
						ctx.ui.notify(
							`Run: /secrets configure ${provider.tokenEnvVar}\n` +
							`This will store the token securely via the secrets extension.`,
							"info"
						);
						return;
					}

					if (choice.startsWith("Run:")) {
						// Interactive CLI auth — run in terminal
						ctx.ui.notify(
							`Running: ${provider.refreshCommand}\n` +
							`This may open a browser for authentication.`,
							"info"
						);
						const result = await pi.exec("bash", ["-c", provider.refreshCommand], { timeout: 120_000 });
						if (result.code === 0) {
							// Verify the refresh worked
							try {
								const verify = await provider.check(pi);
								if (verify.status === "ok") {
									ctx.ui.notify(`✅ ${provider.name} authenticated: ${verify.detail}`, "info");
								} else {
									ctx.ui.notify(
										`⚠️ ${provider.name} refresh completed but verification failed: ${verify.detail}`,
										"warning"
									);
								}
							} catch {
								ctx.ui.notify(`${provider.name} refresh completed — run /auth check ${provider.id} to verify`, "info");
							}
						} else {
							ctx.ui.notify(
								`❌ ${provider.name} refresh failed (exit ${result.code})\n${(result.stderr || result.stdout).slice(0, 200)}`,
								"error"
							);
						}
					}
					break;
				}

				case "list": {
					const lines = ALL_PROVIDERS.map(p => {
						let line = `  ${p.id} — ${p.name} (${p.cli})`;
						if (p.tokenEnvVar) line += `  [env: ${p.tokenEnvVar}]`;
						return line;
					});
					ctx.ui.notify("Available auth providers:\n\n" + lines.join("\n"), "info");
					break;
				}

				default:
					ctx.ui.notify(
						"Usage: /auth <status|check|refresh|list> [provider]\n\n" +
						"  /auth               — check all providers\n" +
						"  /auth check github  — check a specific provider\n" +
						"  /auth refresh aws   — refresh expired credentials\n" +
						"  /auth list          — list available providers",
						"info"
					);
			}
		},
	});

	// ── Backward compat: /whoami command ──────────────────────────

	pi.registerCommand("whoami", {
		description: "Alias for /auth status — check authentication across dev tools",
		handler: async (_args, _ctx) => {
			const results: AuthResult[] = [];
			for (const provider of ALL_PROVIDERS) {
				try {
					results.push(await provider.check(pi));
				} catch (e: any) {
					results.push({
						provider: provider.name,
						status: "none",
						detail: `Check failed: ${e.message}`,
					});
				}
			}
			const text = formatResults(results);
			pi.sendMessage({ customType: "view", content: text, display: true });
		},
	});
}

// ─── Exports for testing ─────────────────────────────────────────

export {
	diagnoseError,
	extractErrorLine,
	ALL_PROVIDERS,
	formatResults,
	findProvider,
};
