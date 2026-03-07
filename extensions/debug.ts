/**
 * Shared debug logging for pi-kit extensions.
 *
 * Output goes to stderr so it doesn't interfere with TUI rendering.
 * Controlled by PI_DEBUG environment variable:
 *   PI_DEBUG=1           — all extensions
 *   PI_DEBUG=dashboard   — only dashboard
 *   PI_DEBUG=openspec,cleave — comma-separated list
 *
 * Each log line: [ext:tag] message {json}
 */

const PI_DEBUG = process.env.PI_DEBUG ?? "";
const debugAll = PI_DEBUG === "1" || PI_DEBUG === "*" || PI_DEBUG === "true";
const debugScopes = new Set(
  debugAll ? [] : PI_DEBUG.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
);

function isEnabled(scope: string): boolean {
  if (debugAll) return true;
  if (debugScopes.size === 0) return false;
  return debugScopes.has(scope.toLowerCase());
}

/**
 * Log a debug message to stderr.
 *
 * @param scope - Extension name (e.g. "dashboard", "openspec", "cleave")
 * @param tag - Sub-tag for the message (e.g. "render", "emitState", "session_start")
 * @param data - Optional structured data to include
 */
export function debug(scope: string, tag: string, data?: Record<string, unknown>): void {
  if (!isEnabled(scope)) return;
  const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
  const prefix = `[${ts} ${scope}:${tag}]`;
  if (data && Object.keys(data).length > 0) {
    process.stderr.write(`${prefix} ${JSON.stringify(data)}\n`);
  } else {
    process.stderr.write(`${prefix}\n`);
  }
}
