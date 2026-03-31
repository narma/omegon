//! Scribe RPC integration — engagement and partnership tracking.
//!
//! Spawns scribe-rpc as a JSON-RPC sidecar and exposes its methods as tools.
//! Manages bidirectional communication via ndjson (newline-delimited JSON).

use omegon_traits::{Feature, ToolDefinition, ToolResult, ContentBlock};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

/// Scribe RPC sidecar state — manages subprocess and communication.
pub struct ScribeFeature {
    process: Arc<Mutex<Option<ScribeProcess>>>,
    request_id: Arc<AtomicU64>,
    cwd: PathBuf,
}

struct ScribeProcess {
    _child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    reader: BufReader<tokio::process::ChildStdout>,
}

impl ScribeFeature {
    /// Create and spawn a new scribe-rpc sidecar.
    pub fn new(cwd: PathBuf) -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            request_id: Arc::new(AtomicU64::new(1)),
            cwd,
        }
    }

    /// Initialize the RPC sidecar. Called during setup.
    pub async fn spawn(&self) -> Result<()> {
        // Locate scribe-rpc binary in same directory as omegon executable
        let scribe_rpc_path = std::env::current_exe()?
            .parent()
            .ok_or_else(|| anyhow!("could not determine exe directory"))?
            .join("scribe-rpc");

        if !scribe_rpc_path.exists() {
            tracing::warn!(
                path = %scribe_rpc_path.display(),
                "scribe-rpc not found in exe directory — RPC sidecar disabled"
            );
            return Ok(());
        }

        let mut child = tokio::process::Command::new(&scribe_rpc_path)
            .arg("--rpc")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .spawn()
            .map_err(|e| anyhow!("failed to spawn scribe-rpc: {}", e))?;

        let stdin = child.stdin.take().ok_or_else(|| anyhow!("no stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
        let reader = BufReader::new(stdout);

        *self.process.lock().await = Some(ScribeProcess {
            _child: child,
            stdin,
            reader,
        });

        tracing::info!(binary = %scribe_rpc_path.display(), "scribe-rpc sidecar spawned");
        Ok(())
    }

    /// Send a JSON-RPC request and receive the response.
    async fn rpc_call(&self, method: &str, params: Value) -> Result<Value> {
        let mut proc = self.process.lock().await;
        let proc = proc.as_mut().ok_or_else(|| anyhow!("scribe-rpc not running"))?;

        let id = self.request_id.fetch_add(1, Ordering::SeqCst);
        let request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        // Write request
        proc.stdin
            .write_all(format!("{}\n", request.to_string()).as_bytes())
            .await?;
        proc.stdin.flush().await?;

        // Read response
        let mut line = String::new();
        loop {
            line.clear();
            let n = proc.reader.read_line(&mut line).await?;
            if n == 0 {
                return Err(anyhow!("scribe-rpc closed connection"));
            }

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let resp: Value = serde_json::from_str(trimmed)?;
            if let Some(resp_id) = resp.get("id").and_then(|v| v.as_u64()) {
                if resp_id == id {
                    // Found our response
                    if let Some(result) = resp.get("result") {
                        return Ok(result.clone());
                    } else if let Some(error) = resp.get("error") {
                        return Err(anyhow!("RPC error: {}", error));
                    } else {
                        return Err(anyhow!("invalid RPC response"));
                    }
                }
            }
            // If not our response, continue reading (for async notifications)
        }
    }
}

#[async_trait::async_trait]
impl Feature for ScribeFeature {
    fn name(&self) -> &str {
        "scribe"
    }

    fn tools(&self) -> Vec<ToolDefinition> {
        vec![
            ToolDefinition {
                name: "scribe_context".to_string(),
                label: "Get Scribe Context".to_string(),
                description: "Retrieve engagement context and recent work entries from scribe".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {},
                    "required": []
                }),
            },
            ToolDefinition {
                name: "scribe_log".to_string(),
                label: "Log Scribe Entry".to_string(),
                description: "Log an engagement entry (development, architecture, review, deployment, meeting, investigation)".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "message": {
                            "type": "string",
                            "description": "Entry content"
                        },
                        "category": {
                            "type": "string",
                            "enum": ["development", "architecture", "review", "deployment", "meeting", "investigation"],
                            "default": "development"
                        }
                    },
                    "required": ["message"]
                }),
            },
            ToolDefinition {
                name: "scribe_list".to_string(),
                label: "List Scribe Entries".to_string(),
                description: "List recent engagement entries".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "limit": {
                            "type": "integer",
                            "default": 10,
                            "description": "Number of entries to retrieve"
                        }
                    }
                }),
            },
        ]
    }

    async fn execute(
        &self,
        tool_name: &str,
        _call_id: &str,
        args: Value,
        _cancel: CancellationToken,
    ) -> Result<ToolResult> {
        let cwd = self.cwd.clone();

        let output = match tool_name {
            "scribe_context" => {
                self.rpc_call("get_context", json!({ "cwd": cwd }))
                    .await?
            }
            "scribe_log" => {
                let message = args
                    .get("message")
                    .and_then(|v| v.as_str())
                    .ok_or(anyhow!("missing 'message'"))?
                    .to_string();
                let category = args
                    .get("category")
                    .and_then(|v| v.as_str())
                    .unwrap_or("development")
                    .to_string();

                self.rpc_call(
                    "log_entry",
                    json!({
                        "cwd": cwd,
                        "message": message,
                        "category": category,
                    }),
                )
                .await?
            }
            "scribe_list" => {
                let limit = args
                    .get("limit")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(10) as usize;

                self.rpc_call(
                    "list_entries",
                    json!({
                        "cwd": cwd,
                        "limit": limit,
                    }),
                )
                .await?
            }
            _ => return Err(anyhow!("unknown tool: {}", tool_name)),
        };

        Ok(ToolResult {
            content: vec![ContentBlock::Text {
                text: output.to_string(),
            }],
            details: json!({}),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scribe_feature_creates_tools() {
        let cwd = PathBuf::from(".");
        let feature = ScribeFeature::new(cwd);
        let tools = feature.tools();
        assert_eq!(tools.len(), 3);
        assert_eq!(tools[0].name, "scribe_context");
        assert_eq!(tools[1].name, "scribe_log");
        assert_eq!(tools[2].name, "scribe_list");
    }
}
