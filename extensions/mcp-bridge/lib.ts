/**
 * Pure utility functions extracted for testability.
 * The main index.ts imports from here; tests import directly.
 */

// ---------------------------------------------------------------------------
// Config discrimination
// ---------------------------------------------------------------------------

export interface StdioServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface HttpServerConfig {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export type ServerConfig = StdioServerConfig | HttpServerConfig;

export function isHttpConfig(config: ServerConfig): config is HttpServerConfig {
  return "url" in config;
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

export interface ConfigError {
  server: string;
  message: string;
}

/**
 * Validate an mcp.json config object. Returns an array of errors (empty = valid).
 * Does not throw — caller decides how to surface problems.
 */
export function validateConfig(
  raw: any
): { servers: Record<string, ServerConfig>; errors: ConfigError[] } {
  const errors: ConfigError[] = [];
  const servers: Record<string, ServerConfig> = {};

  if (!raw || typeof raw !== "object" || !raw.servers || typeof raw.servers !== "object") {
    return { servers, errors: [{ server: "(root)", message: "missing or invalid 'servers' object" }] };
  }

  for (const [name, config] of Object.entries(raw.servers) as [string, any][]) {
    if (!config || typeof config !== "object") {
      errors.push({ server: name, message: "server config must be an object" });
      continue;
    }

    const hasUrl = typeof config.url === "string" && config.url.length > 0;
    const hasCommand = typeof config.command === "string" && config.command.length > 0;

    if (!hasUrl && !hasCommand) {
      errors.push({ server: name, message: "must have either 'url' (HTTP) or 'command' (stdio)" });
      continue;
    }

    if (hasUrl && hasCommand) {
      errors.push({ server: name, message: "has both 'url' and 'command' — pick one transport" });
      continue;
    }

    if (hasUrl) {
      try {
        new URL(config.url);
      } catch {
        errors.push({ server: name, message: `invalid url: ${config.url}` });
        continue;
      }
      if (config.headers && typeof config.headers !== "object") {
        errors.push({ server: name, message: "'headers' must be an object" });
        continue;
      }
      if (config.timeout !== undefined && (typeof config.timeout !== "number" || config.timeout <= 0)) {
        errors.push({ server: name, message: "'timeout' must be a positive number" });
        continue;
      }
    }

    if (hasCommand) {
      if (config.args !== undefined && !Array.isArray(config.args)) {
        errors.push({ server: name, message: "'args' must be an array" });
        continue;
      }
      if (config.env !== undefined && typeof config.env !== "object") {
        errors.push({ server: name, message: "'env' must be an object" });
        continue;
      }
    }

    servers[name] = config as ServerConfig;
  }

  return { servers, errors };
}

// ---------------------------------------------------------------------------
// Env var resolution
// ---------------------------------------------------------------------------

export function resolveEnvVars(
  value: string,
  env: Record<string, string | undefined> = process.env
): string {
  return value.replace(/\$\{(\w+)\}/g, (_, key) => env[key] ?? "");
}

export function resolveEnvObj(
  obj: Record<string, string>,
  env: Record<string, string | undefined> = process.env
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    resolved[k] = resolveEnvVars(v, env);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Auth error detection
// ---------------------------------------------------------------------------

export const AUTH_REMEDIATION =
  "Your GitHub token may be expired or invalid.\n" +
  "Run `gh auth login` to re-authenticate, then restart your pi session.";

export function isAuthError(err: any): boolean {
  if (err?.code === 401 || err?.code === 403) return true;
  const msg = err?.message ?? "";
  if (/HTTP\s+40[13]\b/.test(msg)) return true;
  if (/unauthorized|forbidden|invalid.*token|expired.*token|token.*expired/i.test(msg)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Transport error detection
// ---------------------------------------------------------------------------

export function isTransportError(err: any): boolean {
  const msg = err?.message ?? "";
  return (
    msg.includes("not connected") ||
    msg.includes("aborted") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    err?.code === "ECONNRESET"
  );
}

// ---------------------------------------------------------------------------
// Response text extraction
// ---------------------------------------------------------------------------

export function extractText(result: any): string {
  const content = Array.isArray(result?.content) ? result.content : [];
  return content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n") || "(empty response)";
}
