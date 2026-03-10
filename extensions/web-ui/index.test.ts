import assert from "node:assert/strict";
import { before, beforeEach, afterEach, describe, it } from "node:test";
import { startWebUIServer, type WebUIServer } from "./server.ts";
import { _setServer, _setSpawnFn, _getServer } from "./index.ts";

function buildFakePi() {
  const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
  const events = new Map<string, Array<() => Promise<void>>>();
  return {
    registerCommand(name: string, config: { handler: (args: string, ctx: any) => Promise<void> }) {
      commands.set(name, config);
    },
    on(event: string, handler: () => Promise<void>) {
      const list = events.get(event) ?? [];
      list.push(handler);
      events.set(event, list);
    },
    _commands: commands,
    async _trigger(event: string) {
      for (const handler of events.get(event) ?? []) await handler();
    },
  };
}

async function runCommand(api: ReturnType<typeof buildFakePi>, args: string): Promise<string[]> {
  const command = api._commands.get("web-ui");
  assert.ok(command, "web-ui command should be registered");
  const messages: string[] = [];
  await command.handler(args, { cwd: process.cwd(), ui: { notify: (msg: string) => messages.push(msg) } });
  return messages;
}

let register: (pi: ReturnType<typeof buildFakePi>) => void;

before(async () => {
  const mod = await import("./index.ts");
  register = mod.default as unknown as typeof register;
});

describe("web-ui command surface", () => {
  let api: ReturnType<typeof buildFakePi>;
  let realServer: WebUIServer | null = null;

  beforeEach(() => {
    _setServer(null);
    api = buildFakePi();
    register(api as any);
  });

  afterEach(async () => {
    if (realServer) {
      await realServer.stop().catch(() => {});
      realServer = null;
    }
    _setServer(null);
  });

  it("reports stopped status before start", async () => {
    const messages = await runCommand(api, "status");
    assert.equal(messages.length, 1);
    assert.match(messages[0], /stopped/i);
  });

  it("starts server and reports URL", async () => {
    const messages = await runCommand(api, "start");
    assert.equal(messages.length, 1);
    assert.match(messages[0], /started/i);
    assert.match(messages[0], /127\.0\.0\.1/);
    realServer = _getServer();
    assert.ok(realServer);
  });

  it("opens browser using explicit argv (no shell string)", async () => {
    realServer = await startWebUIServer();
    _setServer(realServer);

    let capturedCmd: string | null = null;
    let capturedArgs: string[] | null = null;

    const prev = _setSpawnFn(((cmd: string, args: string[], _opts: unknown) => {
      capturedCmd = cmd;
      capturedArgs = args;
      return { stdio: "ignore" } as any;
    }) as any);

    try {
      const messages = await runCommand(api, "open");
      assert.equal(messages.length, 1);
      assert.match(messages[0], /Opening/);

      // Must have called spawn with an explicit program
      assert.notEqual(capturedCmd, null, "spawn should have been called");
      assert.notEqual(capturedArgs, null, "spawn should have been called with args");

      // URL must appear as a discrete argument, not interpolated into a shell string
      const url = realServer!.url;
      assert.ok(
        capturedArgs!.includes(url),
        `URL "${url}" should be a discrete spawn argument, got: ${JSON.stringify(capturedArgs)}`
      );

      // The command itself must be a launcher binary, not a shell-formatted string
      const launcher = capturedCmd!;
      assert.ok(
        ["open", "xdg-open", "cmd"].includes(launcher),
        `Expected platform launcher binary, got: "${launcher}"`
      );

      // The shell-string anti-pattern: the command must NOT contain the URL baked in
      assert.ok(
        !launcher.includes(url),
        "Launcher binary must not contain the URL (shell-string anti-pattern)"
      );

      // Platform-specific argv validation:
      // On Windows, cmd.exe `start` requires an empty-string window-title placeholder
      // before the URL so it treats the URL as the target rather than the title.
      if (launcher === "cmd") {
        assert.deepEqual(
          capturedArgs,
          ["/c", "start", "", url],
          `Windows argv must be ["/c","start","",url] — removing "" breaks cmd.exe start semantics`
        );
      } else if (launcher === "open") {
        assert.deepEqual(capturedArgs, [url], `macOS argv must be ["<url>"]`);
      } else {
        assert.deepEqual(capturedArgs, [url], `Linux argv must be ["<url>"]`);
      }
    } finally {
      _setSpawnFn(prev);
    }
  });

  it("stops server gracefully on session shutdown", async () => {
    realServer = await startWebUIServer();
    _setServer(realServer);
    await api._trigger("session_shutdown");
    // Use the explicit getter rather than the ESM live-binding export so this
    // test is not sensitive to Node version differences in live-binding semantics.
    assert.equal(_getServer(), null);
    realServer = null;
  });
});
