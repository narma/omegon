# cleave-process-tree — Tasks

## 1. RPC child communication module
<!-- specs: dispatch -->
<!-- skills: typescript -->

- [ ] 1.1 Create `extensions/cleave/rpc-child.ts` — JSON line framing for stdin commands (prompt, abort), stdout event stream parser
- [ ] 1.2 Define typed event-to-progress mapping: `AgentSessionEvent` → `{phase, toolName, message, filesModified}`
- [ ] 1.3 Implement `sendRpcCommand(stdin, command)` — write JSON line to child stdin
- [ ] 1.4 Implement `parseRpcEventStream(stdout)` — async iterator yielding typed events from child stdout JSON lines
- [ ] 1.5 Handle pipe-break gracefully: stdout close before process exit → emit error event, don't throw
- [ ] 1.6 Add types to `extensions/cleave/types.ts`: `RpcChildEvent`, `RpcProgressUpdate`
- [ ] 1.7 Write `extensions/cleave/rpc-child.test.ts` — JSON framing, event parsing, pipe-break handling

## 2. Migrate spawnChild to RPC mode
<!-- specs: dispatch -->
<!-- skills: typescript -->

- [ ] 2.1 Add `useRpc` parameter to `spawnChild()` (default: true, allows fallback to pipe mode)
- [ ] 2.2 When `useRpc=true`: spawn with `--mode rpc --no-session`, keep stdin open, send `{type: "prompt", message}` via `sendRpcCommand`
- [ ] 2.3 Replace stdout line-by-line parsing with `parseRpcEventStream` for RPC children
- [ ] 2.4 Extract child result from RPC events: detect final `message_end`, read task file for status (unchanged contract)
- [ ] 2.5 Preserve pipe-mode path (`useRpc=false`) for backward compat and review subprocess
- [ ] 2.6 Remove `isChildStatusLine` and `stripAnsiForStatus` from the RPC code path (keep for pipe-mode fallback)
- [ ] 2.7 Update `dispatchSingleChild` to pass `useRpc` flag; review executor continues using pipe mode
- [ ] 2.8 Update `extensions/cleave/dispatcher.test.ts` — mock RPC event streams, test prompt command, test fallback

## 3. Dashboard structured progress
<!-- specs: dispatch -->

- [ ] 3.1 Replace debounced `onChildLine` callback with direct event-to-progress mapping for RPC children
- [ ] 3.2 Map `tool_call` events to structured status: `"tool: read src/auth.ts"`, `"tool: edit src/api.ts"`
- [ ] 3.3 Map `message_start`/`message_end` to phase transitions: `"thinking..."`, `"completed"`
- [ ] 3.4 Emit progress via `emitCleaveChildProgress` using the new typed progress data
- [ ] 3.5 Remove the 500ms debounce timer for RPC children (events are already structured, no filtering needed)

## 4. Graceful degradation and task file contract
<!-- specs: dispatch -->

- [ ] 4.1 Verify task file contract: RPC children produce identical `N-task.md` output as pipe children
- [ ] 4.2 Verify `conflicts.ts` works unchanged with RPC children (reads task files, not event streams)
- [ ] 4.3 Test stdin EOF handling: child continues executing if parent pipe breaks
- [ ] 4.4 Test stdout close handling: parent marks child as failed, preserves worktree/branch
- [ ] 4.5 Verify review subprocess uses pipe mode when `useRpc=false` is passed via ReviewExecutor

## 5. Documentation and skill update
<!-- skills: vault -->

- [ ] 5.1 Update `skills/cleave/SKILL.md` — document RPC dispatch, structured events, Phase 1 vs Phase 2
- [ ] 5.2 Update architecture section: RPC mode as coordination channel, event flow diagram
- [ ] 5.3 Document `useRpc` flag and pipe-mode fallback for review subprocess
