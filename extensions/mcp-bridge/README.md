# mcp-bridge

Pi extension that connects to [MCP](https://modelcontextprotocol.io/) servers and registers their tools as native pi tools. Supports both **stdio** (local process) and **Streamable HTTP** (remote server) transports.

## Configuration

Create `mcp.json` in this extension directory. Each entry in `servers` is either a stdio or HTTP server, discriminated by the presence of `url` vs `command`. A single config must not have both.

### Streamable HTTP server

```json
{
  "servers": {
    "scribe": {
      "url": "https://scribe.example.com/mcp/transport/",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      },
      "timeout": 15000
    }
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `url` | yes | MCP Streamable HTTP endpoint URL (use canonical URL — no trailing-slash redirects) |
| `headers` | no | HTTP headers object; values support `${ENV_VAR}` interpolation |
| `timeout` | no | Connection timeout in ms (default: 15000) |

### Stdio server

```json
{
  "servers": {
    "my-tool": {
      "command": "npx",
      "args": ["-y", "@example/mcp-server"],
      "env": {
        "API_KEY": "${MY_API_KEY}"
      }
    }
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `command` | yes | Executable to spawn |
| `args` | no | Command arguments array |
| `env` | no | Environment variables object; values support `${ENV_VAR}` interpolation |

### Validation

The config is validated at load time. The bridge will report and skip servers with:

- Missing or invalid `servers` object
- Entries that have neither `url` nor `command`
- Entries that have **both** `url` and `command` (ambiguous transport)
- Invalid URLs, non-object `headers`/`env`, non-array `args`, non-positive `timeout`

Valid servers connect normally even if other entries fail validation.

## Secret management

Environment variables in `${...}` are resolved via `process.env` at connect time. Use the **00-secrets** extension to populate secrets from keychains, CLI tools, or other backends.

This extension declares `GITHUB_TOKEN` via the `@secret` annotation. To configure:

```
/secrets configure GITHUB_TOKEN
```

Or add a recipe to `~/.pi/agent/secrets.json`:

```json
{
  "GITHUB_TOKEN": "!gh auth token"
}
```

## Architecture

### Extension lifecycle

Understanding when tools are registered is critical:

```
1. pi loads extension, calls async factory()     ← tools registered HERE
2. pi snapshots tool registry (getAllRegisteredTools)
3. pi fires session_start event                   ← too late for registerTool
4. agent loop begins with snapshotted tools
```

The bridge connects to all MCP servers and calls `pi.registerTool()` inside the **async factory** — not in `session_start`. This is a hard requirement: pi snapshots the tool registry after factories complete, so tools registered in `session_start` exist in the extension's internal Map but are invisible to the agent.

### Tool execution flow

```
agent calls mcp_scribe_list_partnerships(params)
  → execute() reads servers["scribe"] (live reference, not captured)
  → client.callTool({ name: "list_partnerships", arguments: params })
  → extractText(result) → return to agent
```

If the server reference has been replaced by a reconnect, the execute closure picks up the new one automatically because it reads from the `servers` object on every call.

### Error classification

Errors from `callTool` are classified into three buckets:

| Type | Detection | Action |
|------|-----------|--------|
| **Auth** (401/403) | `isAuthError()` — status codes, HTTP status in message, keyword patterns | Return remediation message. Skip reconnect (expired tokens can't be fixed by reconnecting). |
| **Transport** (connection lost) | `isTransportError()` — ECONNREFUSED, fetch failed, not connected, ECONNRESET | Attempt one reconnect + retry. Deduplicate concurrent reconnect attempts via mutex Map. |
| **Other** | Neither auth nor transport | Return error message directly. |

Auth and transport errors are mutually exclusive by design (tested).

### Reconnection

On transport errors, the bridge:

1. Checks the `reconnecting` Map — if a reconnect is already in flight for this server, awaits the existing promise (no duplicate connections)
2. Tears down the old client
3. Creates a fresh connection with the same config
4. Retries the original `callTool`
5. If the retry also fails with an auth error, returns remediation guidance

## Behavior summary

- **Parallel connection**: All servers connect concurrently during the factory phase. One slow/failing server does not block others (`Promise.allSettled`).
- **Timeouts**: Each connection has an independent timeout (default 15s, configurable via `timeout`). Timed-out transports are closed to prevent leaked child processes or HTTP connections.
- **Config validation**: `mcp.json` is validated before any connections are attempted. Invalid entries are reported; valid entries proceed.
- **Auth error detection**: 401/403 responses short-circuit reconnect and return actionable guidance.
- **Tool naming**: Tools are registered as `mcp_{server}_{tool}`, e.g., `mcp_scribe_list_partnerships`.
- **Shutdown**: All client connections are closed on `session_shutdown`.

## Commands

| Command | Description |
|---------|-------------|
| `/mcp` | List connected servers, transport type, and registered tools |

## File structure

```
extensions/mcp-bridge/
├── index.ts        # Extension factory — connection, registration, lifecycle
├── lib.ts          # Pure functions — config types, validation, error classification
├── lib.test.ts     # 78 unit tests (run: npx tsx --test extensions/mcp-bridge/lib.test.ts)
├── mcp.json        # Server configuration
├── package.json    # Extension manifest + SDK dependency
└── README.md
```

## Dependencies

- `@modelcontextprotocol/sdk` — MCP client, transports (stdio + Streamable HTTP)
- `@sinclair/typebox` — provided by pi (virtual module)
- `@mariozechner/pi-coding-agent` — provided by pi (virtual module)

The SDK is declared in `package.json` and installed by pi's package manager (`npm install` at the pi-kit root after `git pull`).

## Known limitations

- **Token refresh**: `gho_` tokens (from `gh auth token`) expire after ~8h. The bridge resolves `${GITHUB_TOKEN}` once at startup. A long-lived session will eventually hit 401s. Workaround: restart pi. A proper fix would require TTL-based re-resolution in `00-secrets`.
- **No late tool registration**: Pi's tool registry is snapshotted once. If an MCP server adds tools after initial connection (`tools/listChanged`), the bridge cannot register them without a full pi restart.
- **Reconnect does not re-register tools**: Reconnection replaces the client/transport but the tool set is fixed from the initial `listTools()` call during the factory.
