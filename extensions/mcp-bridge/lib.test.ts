/**
 * Tests for mcp-bridge pure utility functions.
 *
 * Run: npx tsx --test extensions/mcp-bridge/lib.test.ts
 *   or: node --import tsx --test extensions/mcp-bridge/lib.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isHttpConfig,
  resolveEnvVars,
  resolveEnvObj,
  isAuthError,
  isTransportError,
  extractText,
  validateConfig,
  AUTH_REMEDIATION,
  loadMergedConfig,
  slugifyUrl,
  buildHttpConfig,
  buildStdioConfig,
  parseCommand,
  extractSecretRefs,
} from "./lib.ts";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ═══════════════════════════════════════════════════════════════════════════
// isHttpConfig
// ═══════════════════════════════════════════════════════════════════════════

describe("isHttpConfig", () => {
  it("returns true for objects with url", () => {
    assert.ok(isHttpConfig({ url: "https://example.com/mcp/" }));
  });

  it("returns true for url + headers", () => {
    assert.ok(isHttpConfig({ url: "https://x.com", headers: { Authorization: "Bearer tok" } }));
  });

  it("returns false for stdio config", () => {
    assert.ok(!isHttpConfig({ command: "npx", args: ["-y", "foo"] }));
  });

  it("returns false for stdio config with env", () => {
    assert.ok(!isHttpConfig({ command: "python", env: { KEY: "val" } }));
  });

  // Edge: an object with both url and command — url wins (discriminant)
  it("returns true if both url and command present", () => {
    assert.ok(isHttpConfig({ url: "https://x.com", command: "npx" } as any));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// resolveEnvVars
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveEnvVars", () => {
  const env = { TOKEN: "abc123", EMPTY: "" };

  it("replaces ${VAR} with value", () => {
    assert.equal(resolveEnvVars("Bearer ${TOKEN}", env), "Bearer abc123");
  });

  it("replaces multiple vars", () => {
    assert.equal(resolveEnvVars("${TOKEN}:${TOKEN}", env), "abc123:abc123");
  });

  it("replaces missing var with empty string", () => {
    assert.equal(resolveEnvVars("key=${MISSING}", env), "key=");
  });

  it("replaces empty var with empty string", () => {
    assert.equal(resolveEnvVars("key=${EMPTY}", env), "key=");
  });

  it("passes through strings without vars", () => {
    assert.equal(resolveEnvVars("no vars here", env), "no vars here");
  });

  it("handles empty string input", () => {
    assert.equal(resolveEnvVars("", env), "");
  });

  it("does not replace $VAR without braces", () => {
    assert.equal(resolveEnvVars("$TOKEN", env), "$TOKEN");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// resolveEnvObj
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveEnvObj", () => {
  it("resolves all values in an object", () => {
    const env = { A: "1", B: "2" };
    const result = resolveEnvObj({ x: "${A}", y: "${B}", z: "literal" }, env);
    assert.deepEqual(result, { x: "1", y: "2", z: "literal" });
  });

  it("returns empty object for empty input", () => {
    assert.deepEqual(resolveEnvObj({}, {}), {});
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// isAuthError
// ═══════════════════════════════════════════════════════════════════════════

describe("isAuthError", () => {
  // --- Positive: code-based detection ---

  it("detects error with code 401", () => {
    assert.ok(isAuthError({ code: 401, message: "whatever" }));
  });

  it("detects error with code 403", () => {
    assert.ok(isAuthError({ code: 403, message: "whatever" }));
  });

  // --- Positive: HTTP status in message (SDK send() format) ---

  it("detects 'HTTP 401' in message", () => {
    assert.ok(isAuthError(new Error("Error POSTing to endpoint (HTTP 401): {\"error\":\"Invalid token\"}")));
  });

  it("detects 'HTTP 403' in message", () => {
    assert.ok(isAuthError(new Error("Error POSTing to endpoint (HTTP 403): forbidden")));
  });

  // --- Positive: keyword patterns ---

  it("detects 'unauthorized'", () => {
    assert.ok(isAuthError(new Error("Unauthorized access")));
  });

  it("detects 'forbidden'", () => {
    assert.ok(isAuthError(new Error("Forbidden")));
  });

  it("detects 'invalid token'", () => {
    assert.ok(isAuthError(new Error("Invalid GitHub token")));
  });

  it("detects 'expired token'", () => {
    assert.ok(isAuthError(new Error("Your expired token cannot be used")));
  });

  it("detects 'token expired'", () => {
    assert.ok(isAuthError(new Error("Token expired at 2026-01-01")));
  });

  // --- Positive: real Scribe server responses ---

  it("detects Scribe invalid token response", () => {
    assert.ok(isAuthError(new Error(
      "Error POSTing to endpoint (HTTP 401): " +
      '{"error":"Invalid GitHub token. Provide a valid GitHub PAT with at least read:user and read:org scopes."}'
    )));
  });

  it("detects Scribe missing auth response", () => {
    assert.ok(isAuthError(new Error(
      "Error POSTing to endpoint (HTTP 401): " +
      '{"error":"Missing or invalid Authorization header. Provide an API key or GitHub PAT via: Authorization: Bearer <token>"}'
    )));
  });

  it("detects Scribe org membership failure", () => {
    assert.ok(isAuthError(new Error(
      "Error POSTing to endpoint (HTTP 403): " +
      '{"error":"User \'someone\' is not a member of the \'recro\' organization"}'
    )));
  });

  // --- Negative: should NOT match ---

  it("rejects HTTP 404", () => {
    assert.ok(!isAuthError(new Error("Error POSTing to endpoint (HTTP 404): not found")));
  });

  it("rejects HTTP 500", () => {
    assert.ok(!isAuthError(new Error("Error POSTing to endpoint (HTTP 500): server error")));
  });

  it("rejects ECONNREFUSED", () => {
    assert.ok(!isAuthError(new Error("connect ECONNREFUSED 127.0.0.1:8000")));
  });

  it("rejects timeout errors", () => {
    assert.ok(!isAuthError(new Error("[mcp-bridge] scribe: timed out after 15000ms")));
  });

  it("rejects generic errors", () => {
    assert.ok(!isAuthError(new Error("Something went wrong")));
  });

  it("rejects null/undefined", () => {
    assert.ok(!isAuthError(null));
    assert.ok(!isAuthError(undefined));
  });

  it("rejects error with no message", () => {
    assert.ok(!isAuthError({}));
  });

  it("rejects error with code 200", () => {
    assert.ok(!isAuthError({ code: 200, message: "ok" }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// isTransportError
// ═══════════════════════════════════════════════════════════════════════════

describe("isTransportError", () => {
  it("detects 'not connected'", () => {
    assert.ok(isTransportError(new Error("Client not connected")));
  });

  it("detects 'aborted'", () => {
    assert.ok(isTransportError(new Error("Request aborted")));
  });

  it("detects ECONNREFUSED", () => {
    assert.ok(isTransportError(new Error("connect ECONNREFUSED 127.0.0.1:8000")));
  });

  it("detects 'fetch failed'", () => {
    assert.ok(isTransportError(new Error("fetch failed")));
  });

  it("detects 'network'", () => {
    assert.ok(isTransportError(new Error("network error")));
  });

  it("detects ECONNRESET via code", () => {
    const err: any = new Error("read ECONNRESET");
    err.code = "ECONNRESET";
    assert.ok(isTransportError(err));
  });

  // Negative
  it("rejects auth errors", () => {
    assert.ok(!isTransportError(new Error("HTTP 401: unauthorized")));
  });

  it("rejects generic errors", () => {
    assert.ok(!isTransportError(new Error("Something else")));
  });

  it("rejects null", () => {
    assert.ok(!isTransportError(null));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// extractText
// ═══════════════════════════════════════════════════════════════════════════

describe("extractText", () => {
  it("extracts text from single text block", () => {
    assert.equal(
      extractText({ content: [{ type: "text", text: "hello" }] }),
      "hello"
    );
  });

  it("joins multiple text blocks with newlines", () => {
    assert.equal(
      extractText({
        content: [
          { type: "text", text: "line 1" },
          { type: "text", text: "line 2" },
        ],
      }),
      "line 1\nline 2"
    );
  });

  it("filters out non-text blocks", () => {
    assert.equal(
      extractText({
        content: [
          { type: "image", data: "..." },
          { type: "text", text: "only this" },
          { type: "resource", uri: "..." },
        ],
      }),
      "only this"
    );
  });

  it("returns '(empty response)' for no text blocks", () => {
    assert.equal(
      extractText({ content: [{ type: "image", data: "..." }] }),
      "(empty response)"
    );
  });

  it("returns '(empty response)' for empty content array", () => {
    assert.equal(extractText({ content: [] }), "(empty response)");
  });

  it("returns '(empty response)' for text blocks with empty strings", () => {
    assert.equal(
      extractText({ content: [{ type: "text", text: "" }] }),
      "(empty response)"
    );
  });

  it("handles null content gracefully", () => {
    assert.equal(extractText({ content: null }), "(empty response)");
  });

  it("handles undefined content gracefully", () => {
    assert.equal(extractText({}), "(empty response)");
  });

  it("handles undefined result gracefully", () => {
    assert.equal(extractText(undefined), "(empty response)");
  });

  it("handles null result gracefully", () => {
    assert.equal(extractText(null), "(empty response)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTH_REMEDIATION
// ═══════════════════════════════════════════════════════════════════════════

describe("AUTH_REMEDIATION", () => {
  it("mentions gh auth login", () => {
    assert.ok(AUTH_REMEDIATION.includes("gh auth login"));
  });

  it("mentions restart", () => {
    assert.ok(AUTH_REMEDIATION.includes("restart"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Mutual exclusivity: auth vs transport errors
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// validateConfig
// ═══════════════════════════════════════════════════════════════════════════

describe("validateConfig", () => {
  it("accepts valid HTTP server config", () => {
    const { servers, errors } = validateConfig({
      servers: { s: { url: "https://example.com/mcp/" } },
    });
    assert.equal(errors.length, 0);
    assert.ok("s" in servers);
  });

  it("accepts valid stdio server config", () => {
    const { servers, errors } = validateConfig({
      servers: { s: { command: "npx", args: ["-y", "foo"] } },
    });
    assert.equal(errors.length, 0);
    assert.ok("s" in servers);
  });

  it("accepts HTTP config with headers and timeout", () => {
    const { errors } = validateConfig({
      servers: {
        s: { url: "https://x.com/mcp/", headers: { Authorization: "Bearer tok" }, timeout: 5000 },
      },
    });
    assert.equal(errors.length, 0);
  });

  it("accepts stdio config with env", () => {
    const { errors } = validateConfig({
      servers: { s: { command: "python", env: { KEY: "val" } } },
    });
    assert.equal(errors.length, 0);
  });

  it("rejects missing servers key", () => {
    const { errors } = validateConfig({});
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes("servers"));
  });

  it("rejects null input", () => {
    const { errors } = validateConfig(null);
    assert.equal(errors.length, 1);
  });

  it("rejects config with neither url nor command", () => {
    const { errors } = validateConfig({ servers: { s: { headers: {} } } });
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes("url"));
  });

  it("rejects config with both url and command", () => {
    const { errors } = validateConfig({
      servers: { s: { url: "https://x.com", command: "npx" } },
    });
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes("both"));
  });

  it("rejects invalid URL", () => {
    const { errors } = validateConfig({
      servers: { s: { url: "not a url" } },
    });
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes("invalid url"));
  });

  it("rejects non-object headers", () => {
    const { errors } = validateConfig({
      servers: { s: { url: "https://x.com/mcp/", headers: "nope" } },
    });
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes("headers"));
  });

  it("rejects negative timeout", () => {
    const { errors } = validateConfig({
      servers: { s: { url: "https://x.com/mcp/", timeout: -1 } },
    });
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes("timeout"));
  });

  it("rejects string timeout", () => {
    const { errors } = validateConfig({
      servers: { s: { url: "https://x.com/mcp/", timeout: "5000" } },
    });
    assert.equal(errors.length, 1);
  });

  it("rejects non-array args", () => {
    const { errors } = validateConfig({
      servers: { s: { command: "npx", args: "bad" } },
    });
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes("args"));
  });

  it("rejects non-object env", () => {
    const { errors } = validateConfig({
      servers: { s: { command: "npx", env: "bad" } },
    });
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes("env"));
  });

  it("rejects non-object server entry", () => {
    const { errors } = validateConfig({ servers: { s: "bad" } });
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes("object"));
  });

  it("validates multiple servers independently", () => {
    const { servers, errors } = validateConfig({
      servers: {
        good: { url: "https://x.com/mcp/" },
        bad: { url: "not valid" },
        also_good: { command: "npx" },
      },
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].server, "bad");
    assert.ok("good" in servers);
    assert.ok("also_good" in servers);
    assert.ok(!("bad" in servers));
  });

  it("returns empty servers for empty servers object", () => {
    const { servers, errors } = validateConfig({ servers: {} });
    assert.equal(errors.length, 0);
    assert.equal(Object.keys(servers).length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// slugifyUrl
// ═══════════════════════════════════════════════════════════════════════════

describe("slugifyUrl", () => {
  it("extracts subdomain from scribe.recrocog.com", () => {
    assert.equal(slugifyUrl("https://scribe.recrocog.com/mcp/transport/"), "scribe");
  });

  it("joins significant parts for api.example.com", () => {
    assert.equal(slugifyUrl("https://api.example.com/mcp/"), "api-example");
  });

  it("handles localhost", () => {
    assert.equal(slugifyUrl("http://localhost:3000/mcp"), "localhost");
  });

  it("handles bare domain", () => {
    assert.equal(slugifyUrl("https://example.com"), "example");
  });

  it("returns 'server' for invalid URL", () => {
    assert.equal(slugifyUrl("not a url"), "server");
  });

  it("drops www prefix", () => {
    assert.equal(slugifyUrl("https://www.example.com/mcp/"), "example");
  });

  it("handles deep subdomains", () => {
    const slug = slugifyUrl("https://tools.internal.corp.io/mcp/");
    assert.equal(slug, "tools");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildHttpConfig
// ═══════════════════════════════════════════════════════════════════════════

describe("buildHttpConfig", () => {
  it("builds config with bearer auth", () => {
    const config = buildHttpConfig("https://example.com/mcp/", "bearer", "MY_TOKEN");
    assert.equal(config.url, "https://example.com/mcp/");
    assert.deepEqual(config.headers, { Authorization: "Bearer ${MY_TOKEN}" });
  });

  it("builds config with API key auth", () => {
    const config = buildHttpConfig("https://example.com/mcp/", "api-key", "API_KEY", "X-Api-Key");
    assert.deepEqual(config.headers, { "X-Api-Key": "${API_KEY}" });
  });

  it("builds config with no auth", () => {
    const config = buildHttpConfig("https://example.com/mcp/", "none");
    assert.equal(config.url, "https://example.com/mcp/");
    assert.equal(config.headers, undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildStdioConfig
// ═══════════════════════════════════════════════════════════════════════════

describe("buildStdioConfig", () => {
  it("builds minimal config", () => {
    const config = buildStdioConfig("npx");
    assert.equal(config.command, "npx");
    assert.equal(config.args, undefined);
    assert.equal(config.env, undefined);
  });

  it("includes args when provided", () => {
    const config = buildStdioConfig("npx", ["-y", "foo"]);
    assert.deepEqual(config.args, ["-y", "foo"]);
  });

  it("includes env when provided", () => {
    const config = buildStdioConfig("node", [], { PORT: "3000" });
    assert.deepEqual(config.env, { PORT: "3000" });
  });

  it("omits empty args array", () => {
    const config = buildStdioConfig("node", []);
    assert.equal(config.args, undefined);
  });

  it("omits empty env object", () => {
    const config = buildStdioConfig("node", undefined, {});
    assert.equal(config.env, undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseCommand
// ═══════════════════════════════════════════════════════════════════════════

describe("parseCommand", () => {
  it("parses single command", () => {
    assert.deepEqual(parseCommand("npx"), { command: "npx", args: [] });
  });

  it("parses command with args", () => {
    assert.deepEqual(parseCommand("npx -y @example/server --port 3000"), {
      command: "npx",
      args: ["-y", "@example/server", "--port", "3000"],
    });
  });

  it("handles leading/trailing whitespace", () => {
    assert.deepEqual(parseCommand("  node server.js  "), {
      command: "node",
      args: ["server.js"],
    });
  });

  it("handles empty string", () => {
    assert.deepEqual(parseCommand(""), { command: "", args: [] });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// extractSecretRefs
// ═══════════════════════════════════════════════════════════════════════════

describe("extractSecretRefs", () => {
  it("extracts from HTTP bearer header", () => {
    const refs = extractSecretRefs({
      url: "https://x.com",
      headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
    });
    assert.deepEqual(refs, ["GITHUB_TOKEN"]);
  });

  it("extracts from stdio env", () => {
    const refs = extractSecretRefs({
      command: "npx",
      env: { API_KEY: "${MY_KEY}", OTHER: "${MY_SECRET}" },
    });
    assert.deepEqual(refs, ["MY_KEY", "MY_SECRET"]);
  });

  it("deduplicates refs", () => {
    const refs = extractSecretRefs({
      url: "https://x.com",
      headers: { A: "${TOK}", B: "${TOK}" },
    });
    assert.deepEqual(refs, ["TOK"]);
  });

  it("returns empty for no refs", () => {
    const refs = extractSecretRefs({ url: "https://x.com" });
    assert.deepEqual(refs, []);
  });

  it("returns empty for stdio with no env", () => {
    const refs = extractSecretRefs({ command: "npx" });
    assert.deepEqual(refs, []);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// loadMergedConfig
// ═══════════════════════════════════════════════════════════════════════════

describe("loadMergedConfig", () => {
  let tempDir: string;

  function setup() {
    tempDir = mkdtempSync(join(tmpdir(), "mcp-test-"));
    mkdirSync(join(tempDir, "ext"), { recursive: true });
    mkdirSync(join(tempDir, "user"), { recursive: true });
    mkdirSync(join(tempDir, "project", ".pi"), { recursive: true });
    return tempDir;
  }

  function cleanup() {
    rmSync(tempDir, { recursive: true, force: true });
  }

  it("loads from bundled only when no other files exist", () => {
    setup();
    try {
      writeFileSync(
        join(tempDir, "ext", "mcp.json"),
        JSON.stringify({ servers: { s1: { url: "https://bundled.com/mcp/" } } })
      );
      const result = loadMergedConfig(null, join(tempDir, "user"), join(tempDir, "ext"));
      assert.equal(Object.keys(result.servers).length, 1);
      assert.equal(result.sources["s1"], "bundled");
      assert.equal(result.errors.length, 0);
    } finally { cleanup(); }
  });

  it("user-level overrides bundled on name collision", () => {
    setup();
    try {
      writeFileSync(
        join(tempDir, "ext", "mcp.json"),
        JSON.stringify({ servers: { s1: { url: "https://bundled.com/mcp/" } } })
      );
      writeFileSync(
        join(tempDir, "user", "mcp.json"),
        JSON.stringify({ servers: { s1: { url: "https://user.com/mcp/" } } })
      );
      const result = loadMergedConfig(null, join(tempDir, "user"), join(tempDir, "ext"));
      assert.equal(result.sources["s1"], "user");
      assert.equal((result.servers["s1"] as any).url, "https://user.com/mcp/");
    } finally { cleanup(); }
  });

  it("project-level overrides user on name collision", () => {
    setup();
    try {
      writeFileSync(
        join(tempDir, "user", "mcp.json"),
        JSON.stringify({ servers: { s1: { url: "https://user.com/mcp/" } } })
      );
      writeFileSync(
        join(tempDir, "project", ".pi", "mcp.json"),
        JSON.stringify({ servers: { s1: { url: "https://project.com/mcp/" } } })
      );
      const result = loadMergedConfig(join(tempDir, "project"), join(tempDir, "user"), join(tempDir, "ext"));
      assert.equal(result.sources["s1"], "project");
      assert.equal((result.servers["s1"] as any).url, "https://project.com/mcp/");
    } finally { cleanup(); }
  });

  it("merges servers from different layers", () => {
    setup();
    try {
      writeFileSync(
        join(tempDir, "ext", "mcp.json"),
        JSON.stringify({ servers: { bundled: { url: "https://bundled.com/mcp/" } } })
      );
      writeFileSync(
        join(tempDir, "user", "mcp.json"),
        JSON.stringify({ servers: { user_srv: { url: "https://user.com/mcp/" } } })
      );
      writeFileSync(
        join(tempDir, "project", ".pi", "mcp.json"),
        JSON.stringify({ servers: { proj_srv: { command: "npx" } } })
      );
      const result = loadMergedConfig(join(tempDir, "project"), join(tempDir, "user"), join(tempDir, "ext"));
      assert.equal(Object.keys(result.servers).length, 3);
      assert.equal(result.sources["bundled"], "bundled");
      assert.equal(result.sources["user_srv"], "user");
      assert.equal(result.sources["proj_srv"], "project");
    } finally { cleanup(); }
  });

  it("aggregates errors from all layers", () => {
    setup();
    try {
      writeFileSync(join(tempDir, "ext", "mcp.json"), "not json");
      writeFileSync(join(tempDir, "user", "mcp.json"), "also bad");
      const result = loadMergedConfig(null, join(tempDir, "user"), join(tempDir, "ext"));
      assert.equal(result.errors.length, 2);
      assert.ok(result.errors[0].message.includes("[bundled]"));
      assert.ok(result.errors[1].message.includes("[user]"));
    } finally { cleanup(); }
  });

  it("handles all files missing gracefully", () => {
    setup();
    try {
      const result = loadMergedConfig(null, join(tempDir, "user"), join(tempDir, "ext"));
      assert.equal(Object.keys(result.servers).length, 0);
      assert.equal(result.errors.length, 0);
    } finally { cleanup(); }
  });

  it("handles null projectDir", () => {
    setup();
    try {
      writeFileSync(
        join(tempDir, "user", "mcp.json"),
        JSON.stringify({ servers: { s: { url: "https://x.com/mcp/" } } })
      );
      const result = loadMergedConfig(null, join(tempDir, "user"), join(tempDir, "ext"));
      assert.equal(Object.keys(result.servers).length, 1);
    } finally { cleanup(); }
  });

  it("empty servers object produces no errors", () => {
    setup();
    try {
      writeFileSync(
        join(tempDir, "ext", "mcp.json"),
        JSON.stringify({ servers: {} })
      );
      const result = loadMergedConfig(null, join(tempDir, "user"), join(tempDir, "ext"));
      assert.equal(Object.keys(result.servers).length, 0);
      assert.equal(result.errors.length, 0);
    } finally { cleanup(); }
  });
});

describe("auth vs transport mutual exclusivity", () => {
  const authErrors = [
    { code: 401, message: "Unauthorized" },
    new Error("Error POSTing to endpoint (HTTP 401): invalid token"),
    new Error("Error POSTing to endpoint (HTTP 403): forbidden"),
  ];

  const transportErrors = [
    new Error("Client not connected"),
    new Error("connect ECONNREFUSED 127.0.0.1:8000"),
    new Error("fetch failed"),
  ];

  for (const err of authErrors) {
    const label = err instanceof Error ? err.message.slice(0, 50) : `code=${(err as any).code}`;
    it(`auth error '${label}' is NOT a transport error`, () => {
      assert.ok(isAuthError(err));
      assert.ok(!isTransportError(err));
    });
  }

  for (const err of transportErrors) {
    it(`transport error '${err.message}' is NOT an auth error`, () => {
      assert.ok(isTransportError(err));
      assert.ok(!isAuthError(err));
    });
  }
});
