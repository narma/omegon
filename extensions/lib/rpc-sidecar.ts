export interface RpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * RPC Sidecar Transport — shared by all Rust-native omegon extensions.
 *
 * Spawns a Rust binary with `--rpc` flag and communicates via ndjson
 * over stdin/stdout. Handles request/response correlation, unsolicited
 * notifications, and graceful shutdown.
 */
export class RpcSidecar {
  private proc: any = null; // ChildProcess
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private buffer = "";
  private listeners = new Map<string, ((params: unknown) => void)[]>();

  /**
   * Spawn the Rust binary and start listening for messages.
   * @param binaryPath Path to the Rust binary (e.g., ~/.omegon/bin/scribe-rpc)
   * @param args Additional arguments to pass (default: ["--rpc"])
   */
  async start(binaryPath: string, args: string[] = ["--rpc"]): Promise<void> {
    const { spawn } = await import("child_process");

    this.proc = spawn(binaryPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    // Handle stdout — incoming messages
    this.proc.stdout.on("data", (chunk: Buffer) => this.handleData(chunk));

    // Log stderr (Rust tracing output) — write to extension log file
    this.proc.stderr.on("data", (chunk: Buffer) => {
      const msg = chunk.toString();
      if (msg.trim()) {
        console.error(`[scribe-rpc] ${msg}`);
      }
    });

    // Handle process exit
    this.proc.on("exit", (code: number) => {
      console.error(`[scribe-rpc] exited with code ${code}`);
      this.proc = null;
    });
  }

  /**
   * Send an RPC request and wait for a response.
   */
  async request<T>(method: string, params?: unknown): Promise<T> {
    if (!this.proc) {
      throw new Error("RPC sidecar not started");
    }

    const id = this.nextId++;
    const msg: RpcMessage = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });

      try {
        this.proc.stdin.write(JSON.stringify(msg) + "\n");
      } catch (e) {
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  /**
   * Register a listener for unsolicited notifications.
   */
  on(event: string, callback: (params: unknown) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  /**
   * Gracefully shut down the sidecar.
   */
  async shutdown(): Promise<void> {
    if (!this.proc) return;

    try {
      await this.request("shutdown");
    } catch {
      // Ignore errors, just force kill
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.proc?.kill("SIGKILL");
        resolve();
      }, 2000);

      this.proc.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });

      this.proc.kill("SIGTERM");
    });
  }

  /**
   * Internal: handle incoming data from stdout.
   */
  private handleData(chunk: Buffer): void {
    this.buffer += chunk.toString();
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        try {
          const msg: RpcMessage = JSON.parse(line);
          this.dispatch(msg);
        } catch (e) {
          console.error(`[scribe-rpc] parse error: ${e}`);
        }
      }
    }
  }

  /**
   * Internal: dispatch a received message.
   */
  private dispatch(msg: RpcMessage): void {
    if (msg.id != null) {
      // Response to a request
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }
    } else if (msg.method) {
      // Notification — unsolicited message from the sidecar
      const callbacks = this.listeners.get(msg.method) || [];
      for (const cb of callbacks) {
        try {
          cb(msg.params);
        } catch (e) {
          console.error(`[scribe-rpc] notification handler error: ${e}`);
        }
      }
    }
  }
}
