/**
 * Omegon extension registration for Scribe.
 *
 * Registers tools, commands, and context hooks with the omegon agent.
 */

import { ScribeClient, ScribeStatus } from "./client";

export class ScribeExtension {
  private client: ScribeClient | null = null;
  private engaged = false;

  /**
   * Called by omegon on extension load.
   * Check for .scribe marker and SCRIBE_URL env var.
   */
  async initialize(): Promise<void> {
    const scribeUrl = process.env.SCRIBE_URL;
    if (!scribeUrl) {
      console.log("[scribe] SCRIBE_URL not set, extension disabled");
      return;
    }

    // TODO: check for .scribe file in cwd upward

    // Initialize the client
    const binaryPath = process.env.SCRIBE_RPC_BIN || "~/.omegon/bin/scribe-rpc";
    this.client = new ScribeClient(binaryPath);

    const ok = await this.client.init();
    if (ok) {
      this.engaged = true;
      console.log("[scribe] initialized");

      // Listen for context changes
      this.client.onContextChanged((ctx) => {
        console.log(`[scribe] context changed: ${ctx.partnership}`);
        // TODO: emit agent event to refresh system prompt context
      });
    }
  }

  /**
   * Register tools with omegon.
   */
  registerTools(registerTool: any): void {
    if (!this.engaged || !this.client) return;

    registerTool({
      name: "scribe_status",
      description:
        "Get the current engagement status, team composition, and recent activity",
      execute: async () => {
        const status = await this.client!.getStatus();
        return JSON.stringify(status, null, 2);
      },
    });

    registerTool({
      name: "scribe_log",
      description:
        "Add a work log entry to the current engagement. Use after completing significant work.",
      parameters: {
        type: "object",
        required: ["content"],
        properties: {
          content: {
            type: "string",
            description: "Work log entry content",
          },
          category: {
            type: "string",
            enum: [
              "development",
              "architecture",
              "review",
              "deployment",
              "meeting",
              "investigation",
            ],
            description: "Log entry category",
          },
        },
      },
      execute: async (params: any) => {
        await this.client!.writeLog(
          params.content,
          params.category || "development"
        );
        return "✓ Log entry written";
      },
    });

    registerTool({
      name: "scribe_timeline",
      description:
        "Get the engagement timeline — recent commits, PRs, deployments, and manual log entries",
      parameters: {
        type: "object",
        properties: {
          page: {
            type: "integer",
            description: "Page number (default: 1)",
          },
          per_page: {
            type: "integer",
            description: "Items per page (default: 20)",
          },
        },
      },
      execute: async (params: any) => {
        const timeline = await this.client!.getTimeline(
          ".",
          params.page || 1,
          params.per_page || 20
        );
        return JSON.stringify(timeline, null, 2);
      },
    });
  }

  /**
   * Inject engagement context into the system prompt.
   */
  async provideContext(): Promise<string | null> {
    if (!this.engaged || !this.client) return null;

    try {
      const ctx = await this.client.getContext();
      if (!ctx.partnership && !ctx.engagement_id) {
        return null;
      }

      const lines: string[] = ["## Active Engagement"];
      if (ctx.partnership) lines.push(`Partnership: ${ctx.partnership}`);
      if (ctx.engagement_id) lines.push(`Engagement: ${ctx.engagement_id}`);
      if (ctx.team_members.length > 0) {
        lines.push(`Team: ${ctx.team_members.join(", ")}`);
      }
      if (ctx.recent_activity.length > 0) {
        lines.push(`Recent: ${ctx.recent_activity.slice(0, 3).join("; ")}`);
      }

      return lines.join("\n");
    } catch (e) {
      console.error(`[scribe] failed to provide context: ${e}`);
      return null;
    }
  }

  /**
   * Called when the agent session ends.
   */
  async shutdown(): Promise<void> {
    if (this.client) {
      await this.client.shutdown();
    }
  }
}
