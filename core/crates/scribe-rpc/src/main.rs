//! Scribe RPC — engagement and partnership tracking for omegon.
//!
//! Dual-mode binary:
//! - `scribe-rpc --rpc` — JSON-RPC sidecar for omegon
//! - `scribe-rpc log` — standalone CLI for terminal use
//! - `scribe-rpc sync` — background sync of engagement data

use anyhow::Result;
use clap::{Parser, Subcommand};
use std::path::PathBuf;

mod rpc;
mod cli;
mod scribe;

#[derive(Parser)]
#[command(name = "scribe-rpc", about = "Engagement & partnership tracking")]
struct Cli {
    /// Run in JSON-RPC sidecar mode for omegon
    #[arg(long)]
    rpc: bool,

    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Write a work log entry
    Log {
        /// Log message content
        message: String,

        /// Log category (development, architecture, review, deployment, meeting, investigation)
        #[arg(long, default_value = "development")]
        category: String,
    },

    /// Sync engagement data from remote
    Sync {
        /// Working directory (default: current)
        #[arg(long)]
        cwd: Option<PathBuf>,
    },

    /// Show current engagement status
    Status {
        /// Working directory (default: current)
        #[arg(long)]
        cwd: Option<PathBuf>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::WARN.into()),
        )
        .with_writer(std::io::stderr)
        .init();

    let args = Cli::parse();

    if args.rpc {
        // JSON-RPC sidecar mode
        rpc::run_rpc_loop().await?;
    } else if let Some(cmd) = args.command {
        // CLI mode
        cli::execute(cmd).await?;
    } else {
        // No command and not --rpc: print help
        eprintln!("Use --rpc for omegon sidecar mode, or provide a subcommand.");
        eprintln!("Run `scribe-rpc --help` for usage.");
    }

    Ok(())
}
