//! CLI mode — standalone terminal interface for scribe-rpc.

use anyhow::Result;
use std::path::PathBuf;

use crate::{scribe, Cli, Commands};

pub async fn execute(command: Commands) -> Result<()> {
    match command {
        Commands::Log { message, category } => {
            scribe::write_log_entry(&message, &category).await?;
            println!("✓ Log entry written: [{}] {}", category, message);
        }

        Commands::Sync { cwd } => {
            let cwd_str = cwd.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| ".".to_string());
            scribe::sync_engagement(&cwd_str).await?;
            println!("✓ Engagement data synced");
        }

        Commands::Status { cwd } => {
            let cwd_str = cwd.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| ".".to_string());
            let status = scribe::get_engagement_status(&cwd_str).await?;
            println!("{}", serde_json::to_string_pretty(&status)?);
        }
    }

    Ok(())
}
