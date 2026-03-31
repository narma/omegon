/**
 * Scribe extension for omegon — engagement & partnership tracking.
 *
 * Communicates with the scribe-rpc sidecar to:
 * - Inject engagement context into the system prompt
 * - Register work logging tools
 * - Track engagement timeline
 */

import { RpcSidecar } from "../lib/rpc-sidecar";

export interface ScribeContext {
  partnership?: string;
  engagement_id?: string;
  team_members: string[];
  recent_activity: string[];
}

export interface ScribeStatus {
  partnership?: string;
  engagement_id?: string;
  status: string;
  progress?: number;
  last_updated?: string;
}

export interface TimelineEntry {
  timestamp: string;
  event_type: string;
  description: string;
}

/**
 * Typed wrapper around the RPC sidecar for Scribe.
 */
export class ScribeClient {
  private sidecar: RpcSidecar;
  private initialized = false;

  constructor(private binaryPath: string) {
    this.sidecar = new RpcSidecar();
  }

  /**
   * Initialize the sidecar and check for engagement markers.
   */
  async init(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      await this.sidecar.start(this.binaryPath, ["--rpc"]);
      this.initialized = true;
      return true;
    } catch (e) {
      console.error(`[scribe] failed to initialize: ${e}`);
      return false;
    }
  }

  /**
   * Get the current engagement context for a working directory.
   */
  async getContext(cwd: string = "."): Promise<ScribeContext> {
    return this.sidecar.request<ScribeContext>("get_context", { cwd });
  }

  /**
   * Get engagement status from Scribe API.
   */
  async getStatus(cwd: string = "."): Promise<ScribeStatus> {
    return this.sidecar.request<ScribeStatus>("get_status", { cwd });
  }

  /**
   * Write a work log entry.
   */
  async writeLog(content: string, category: string = "development"): Promise<void> {
    await this.sidecar.request("write_log", { content, category });
  }

  /**
   * Get the engagement timeline.
   */
  async getTimeline(
    cwd: string = ".",
    page: number = 1,
    perPage: number = 20
  ): Promise<TimelineEntry[]> {
    return this.sidecar.request<TimelineEntry[]>("get_timeline", {
      cwd,
      page,
      per_page: perPage,
    });
  }

  /**
   * Register a listener for context changes (notifications from sidecar).
   */
  onContextChanged(callback: (context: ScribeContext) => void): void {
    this.sidecar.on("context_changed", (params) => {
      callback(params as ScribeContext);
    });
  }

  /**
   * Gracefully shut down the sidecar.
   */
  async shutdown(): Promise<void> {
    await this.sidecar.shutdown();
    this.initialized = false;
  }
}
