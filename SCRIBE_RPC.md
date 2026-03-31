# Scribe RPC — First Rust-Native Omegon Extension

This is the canonical implementation of the **Rust-native extension** pattern for omegon, as defined in `design/rust-native-extension-boundary.md`.

## Architecture

```
omegon (Node.js/TypeScript)
  ↓ spawns
extensions/scribe/src/
  ├── index.ts           tool/command registration (~160 lines)
  ├── client.ts          typed RPC wrapper (~110 lines)
  └── (pi-tui components)
  
      ↕ ndjson over stdin/stdout
      
core/crates/scribe-rpc/ (Rust binary)
  ├── main.rs            entry point: --rpc flag check (~80 lines)
  ├── rpc/
  │   ├── mod.rs         JSON-RPC loop, message parsing (~120 lines)
  │   └── dispatch.rs    method handlers (~110 lines)
  ├── cli/
  │   └── mod.rs         standalone CLI mode (~30 lines)
  └── scribe/
      └── mod.rs         business logic, transport-agnostic (~100 lines)
```

## Running

### Build

```bash
cd core
cargo build -p scribe-rpc --release
```

Binary: `core/target/release/scribe-rpc`

### Standalone CLI

```bash
scribe-rpc log "Fixed timeout bug" --category development
scribe-rpc status
scribe-rpc sync
```

### Sidecar Mode (omegon)

```bash
scribe-rpc --rpc
```

Listens on stdin for ndjson RPC requests, writes responses to stdout.

## RPC Methods

### get_context

**Request:**
```json
{"jsonrpc":"2.0","id":1,"method":"get_context","params":{"cwd":"/path/to/repo"}}
```

**Response:**
```json
{
  "jsonrpc":"2.0",
  "id":1,
  "result":{
    "partnership":"qrypt",
    "engagement_id":"QRYPT-001",
    "team_members":["alice","bob"],
    "recent_activity":["PR merged","deployment"]
  }
}
```

### get_status

Returns engagement status, progress, and last update time.

```json
{"jsonrpc":"2.0","id":2,"method":"get_status","params":{"cwd":"."}}
```

### write_log

Add a work log entry to the engagement.

```json
{
  "jsonrpc":"2.0",
  "id":3,
  "method":"write_log",
  "params":{
    "content":"Completed integration tests",
    "category":"development"
  }
}
```

### get_timeline

Fetch engagement timeline (commits, PRs, manual logs).

```json
{"jsonrpc":"2.0","id":4,"method":"get_timeline","params":{"cwd":".","page":1,"per_page":20}}
```

### shutdown

Graceful shutdown signal (sent by omegon on session end).

```json
{"jsonrpc":"2.0","id":5,"method":"shutdown","params":{}}
```

## Notifications

Rust can push unsolicited notifications to omegon (e.g., when engagement context changes).

```json
{"jsonrpc":"2.0","method":"context_changed","params":{"partnership":"new-partner"}}
```

## Implementation Status

### Complete (First Pass)

- ✅ Rust binary: main, RPC loop, method dispatch, CLI mode
- ✅ Business logic stubs: resolve_context, get_status, write_log, get_timeline, sync
- ✅ TypeScript: RpcSidecar transport, ScribeClient wrapper, extension registration
- ✅ Build: integrated into workspace Cargo.toml

### TODO: Backend Integration

- [ ] .scribe file format (TOML) — read engagement metadata
- [ ] HTTP client — call SCRIBE_URL endpoints (reqwest setup)
- [ ] Token caching — refresh engagement context every 30 turns
- [ ] Filesystem watcher (notify crate) — push notifications on changes
- [ ] Git integration — read recent commits, associate with logs
- [ ] omegon integration — session lifecycle hooks

### TODO: UI Components

- [ ] Footer component — display partnership/engagement in omegon footer
- [ ] Engagement picker — dialog to select engagement
- [ ] Log composer — text input for work log entries

## Design Patterns

### Transport-Agnostic Business Logic

All functions in `scribe-rpc/src/scribe/` are pure async functions with no transport awareness. This means:
- Same code runs in CLI mode, RPC mode, and (future) napi-rs FFI
- No coupling to JSON serialization
- Tests call the business logic directly, no mocking of RPC

### Dual-Mode Binary

```rust
// main.rs
if args.rpc {
    rpc::run_rpc_loop().await?;
} else if let Some(cmd) = args.command {
    cli::execute(cmd).await?;
}
```

One binary, two consumers: omegon (sidecar) and terminal users.

### TypeScript Adapter is Render-Only

```typescript
// ScribeExtension.registerTools() — just serializes/deserializes RPC
// No business logic: no context resolution, no API calls, no file I/O
// All of that happens in Rust
```

## Migration Path (Future)

### Phase 2: napi-rs FFI (no business logic changes)

The Rust codebase gains a `[lib] crate-type = ["cdylib"]` and thin napi wrappers:

```rust
#[napi]
pub fn get_context(cwd: String) -> napi::Result<ContextResult> {
    scribe::resolve_context(&cwd).map_err(|e| /* convert to napi::Error */)
}
```

TypeScript adapter shrinks from 160 lines to ~50 lines of type bindings. No changes to business logic.

### Phase 3: Omegon goes Rust

The TypeScript adapter disappears. Extensions implement a Rust trait. Same `src/scribe/` business logic is untouched.

## Testing

```bash
# Unit tests for business logic (Rust)
cargo test -p scribe-rpc

# Integration tests for RPC protocol (TODO)
npm run test:scribe

# Standalone CLI smoke tests (TODO)
scribe-rpc log "test" && scribe-rpc status
```

## Resources

- **Design**: `docs/rust-native-extension-boundary.md`
- **Example manifest** (reference): `core/examples/plugins/scribe/plugin.toml`
- **RPC spec**: ndjson, JSON-RPC 2.0
- **Transport**: `extensions/lib/rpc-sidecar.ts` (reusable for all Rust extensions)

---

**This is the template for all future omegon-native Rust extensions.** The pattern:
1. Write business logic in Rust (transport-agnostic)
2. Add RPC dispatch layer for sidecar communication
3. Add CLI for standalone use
4. Write thin TypeScript adapter (~100-200 lines) for tool/command registration
5. Profit.
