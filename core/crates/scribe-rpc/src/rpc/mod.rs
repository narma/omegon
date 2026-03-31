//! JSON-RPC 2.0 sidecar for omegon.
//!
//! Listens on stdin for ndjson (newline-delimited JSON) requests,
//! processes them via method dispatch, and writes ndjson responses on stdout.
//!
//! Wire format:
//! - Request: {"jsonrpc":"2.0","id":1,"method":"get_context","params":{"cwd":"/path"}}
//! - Response: {"jsonrpc":"2.0","id":1,"result":{...}}
//! - Notification: {"jsonrpc":"2.0","method":"context_changed","params":{...}}

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub mod dispatch;

#[derive(Deserialize, Debug)]
struct RpcRequest {
    jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<u64>,
    method: String,
    params: Value,
}

#[derive(Serialize, Debug)]
struct RpcResponse<T: Serialize> {
    jsonrpc: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RpcError>,
}

#[derive(Serialize, Debug)]
struct RpcError {
    code: i32,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

impl<T: Serialize> RpcResponse<T> {
    fn success(id: Option<u64>, result: T) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        }
    }
}

fn error_response(id: Option<u64>, code: i32, message: &str) -> RpcResponse<()> {
    RpcResponse {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(RpcError {
            code,
            message: message.to_string(),
            data: None,
        }),
    }
}

/// Shared state for the RPC loop
struct RpcState {
    // Add shared state here as needed (HTTP client, caches, etc.)
}

pub async fn run_rpc_loop() -> Result<()> {
    let state = Arc::new(RpcState {});

    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    let mut stdout = tokio::io::stdout();

    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break, // EOF
            Ok(_) => {}
            Err(e) => {
                eprintln!("stdin read error: {}", e);
                break;
            }
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Parse request
        let req: RpcRequest = match serde_json::from_str(trimmed) {
            Ok(r) => r,
            Err(e) => {
                let resp = error_response(None, -32700, &format!("parse error: {}", e));
                stdout.write_all(format!("{}\n", serde_json::to_string(&resp)?).as_bytes()).await?;
                continue;
            }
        };

        // Dispatch
        let response_json = dispatch::handle(&state, &req.method, req.id, req.params).await;

        // Write response (only if id is present, otherwise it was a notification)
        if req.id.is_some() {
            stdout.write_all(format!("{}\n", response_json).as_bytes()).await?;
            stdout.flush().await?;
        }
    }

    Ok(())
}
