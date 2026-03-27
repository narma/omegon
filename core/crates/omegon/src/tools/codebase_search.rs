//! codebase_search and codebase_index tools backed by omegon-codescan.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use omegon_traits::{ContentBlock, ToolDefinition, ToolProvider, ToolResult};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

use omegon_codescan::{BM25Index, Indexer, ScanCache, SearchScope};

pub struct CodescanProvider {
    repo_path: PathBuf,
    cache: Arc<Mutex<Option<ScanCache>>>,
}

impl CodescanProvider {
    pub fn new(repo_path: PathBuf) -> Self {
        Self { repo_path, cache: Arc::new(Mutex::new(None)) }
    }

    fn db_path(&self) -> PathBuf {
        self.repo_path.join(".omegon/codescan.db")
    }

    fn with_cache<F, R>(&self, f: F) -> anyhow::Result<R>
    where F: FnOnce(&mut ScanCache) -> anyhow::Result<R> {
        let mut guard = self.cache.lock().map_err(|_| anyhow::anyhow!("mutex poisoned"))?;
        if guard.is_none() {
            *guard = Some(ScanCache::open(&self.db_path())?);
        }
        f(guard.as_mut().unwrap())
    }

    fn execute_search(&self, args: &Value) -> anyhow::Result<ToolResult> {
        let query = args["query"].as_str().ok_or_else(|| anyhow::anyhow!("query required"))?;
        let scope_str = args["scope"].as_str().unwrap_or("all");
        let max_results = args["max_results"].as_u64().unwrap_or(10) as usize;
        let tag_filter: Vec<String> = args["tags"].as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        let scope = SearchScope::from_str(scope_str);

        let (code_chunks, mut knowledge_chunks) = self.with_cache(|cache| {
            Indexer::run(&self.repo_path, cache)?;
            Ok((cache.all_code_chunks()?, cache.all_knowledge_chunks()?))
        })?;

        if !tag_filter.is_empty() {
            knowledge_chunks.retain(|c| tag_filter.iter().any(|t| c.tags.contains(t)));
        }

        let idx = BM25Index::build(&code_chunks, &knowledge_chunks);
        let results = idx.search(query, scope, max_results);

        if results.is_empty() {
            return Ok(ToolResult {
                content: vec![ContentBlock::Text { text: format!("No results for `{}` (scope: {}).", query, scope_str) }],
                details: json!({"results": [], "query": query}),
            });
        }

        let mut table = format!(
            "## codebase_search: `{}`\n\n**{} result(s)** (scope: `{}`)\n\n| File | Lines | Type | Score | Preview |\n|------|-------|------|-------|---------|\n",
            query, results.len(), scope_str
        );
        for r in &results {
            let preview = r.preview.lines().next().unwrap_or("").chars().take(120).collect::<String>().replace('|', "\\|");
            table.push_str(&format!("| `{}` | {}-{} | {} | {:.2} | `{}` |\n",
                r.file, r.start_line, r.end_line, r.chunk_type.as_str(), r.score, preview));
        }
        table.push_str("\n*Use `read` tool with offset/limit for full chunk content.*");

        // Background HEAD check
        self.spawn_head_check();

        Ok(ToolResult {
            content: vec![ContentBlock::Text { text: table }],
            details: json!({
                "query": query, "scope": scope_str,
                "results": results.iter().map(|r| json!({
                    "file": r.file, "start_line": r.start_line, "end_line": r.end_line,
                    "chunk_type": r.chunk_type.as_str(), "score": r.score, "label": r.label,
                    "preview": r.preview.chars().take(300).collect::<String>(),
                })).collect::<Vec<_>>(),
            }),
        })
    }

    fn execute_index(&self, args: &Value) -> anyhow::Result<ToolResult> {
        let invalidate = args["invalidate"].as_bool().unwrap_or(false);
        let stats = self.with_cache(|cache| {
            if invalidate { cache.clear_all()?; }
            Indexer::run(&self.repo_path, cache)
        })?;
        let text = format!(
            "## codebase_index\n\n**Status:** {}\n\n| Metric | Count |\n|--------|-------|\n| Code files | {} |\n| Knowledge files | {} |\n| Code chunks | {} |\n| Knowledge chunks | {} |\n| Duration | {}ms |\n",
            if invalidate { "Full reindex" } else { "Incremental" },
            stats.code_files, stats.knowledge_files, stats.code_chunks, stats.knowledge_chunks, stats.duration_ms,
        );
        Ok(ToolResult {
            content: vec![ContentBlock::Text { text }],
            details: json!({ "code_files": stats.code_files, "knowledge_files": stats.knowledge_files, "code_chunks": stats.code_chunks, "knowledge_chunks": stats.knowledge_chunks, "duration_ms": stats.duration_ms }),
        })
    }

    fn spawn_head_check(&self) {
        let repo_path = self.repo_path.clone();
        let cache_arc = Arc::clone(&self.cache);
        tokio::spawn(async move {
            let Ok(out) = tokio::process::Command::new("git").args(["rev-parse", "HEAD"]).current_dir(&repo_path).output().await else { return; };
            if !out.status.success() { return; }
            let head = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if head.is_empty() { return; }
            let needs = { let g = cache_arc.lock().ok(); g.as_ref().and_then(|g| g.as_ref()).map(|c| c.get_meta("last_head").as_deref() != Some(&head)).unwrap_or(false) };
            if needs {
                let mut g = cache_arc.lock().ok();
                if let Some(Some(cache)) = g.as_mut().map(|g| g.as_mut()) {
                    let _ = Indexer::run(&repo_path, cache);
                }
            }
        });
    }
}

#[async_trait]
impl ToolProvider for CodescanProvider {
    fn tools(&self) -> Vec<ToolDefinition> {
        vec![
            ToolDefinition {
                name: crate::tool_registry::codescan::CODEBASE_SEARCH.into(),
                label: "codebase_search".into(),
                description: "Search the codebase by concept across code files (functions, structs, classes) and knowledge files (design docs, OpenSpec, memory facts). BM25 ranked. scope: all|code|knowledge".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "Search query" },
                        "scope": { "type": "string", "enum": ["all", "code", "knowledge"], "description": "Search scope (default: all)" },
                        "max_results": { "type": "number", "description": "Max results (default 10)" },
                        "tags": { "type": "array", "items": {"type": "string"}, "description": "Filter knowledge chunks by frontmatter tags" }
                    },
                    "required": ["query"]
                }),
            },
            ToolDefinition {
                name: crate::tool_registry::codescan::CODEBASE_INDEX.into(),
                label: "codebase_index".into(),
                description: "Rebuild the codebase search index. invalidate=true for full reindex; default is incremental.".into(),
                parameters: json!({ "type": "object", "properties": { "invalidate": { "type": "boolean", "description": "Drop cache and full reindex (default: false)" } } }),
            },
        ]
    }

    async fn execute(&self, tool_name: &str, _call_id: &str, args: Value, _cancel: CancellationToken) -> anyhow::Result<ToolResult> {
        match tool_name {
            crate::tool_registry::codescan::CODEBASE_SEARCH => self.execute_search(&args),
            crate::tool_registry::codescan::CODEBASE_INDEX => self.execute_index(&args),
            _ => anyhow::bail!("Unknown codescan tool: {tool_name}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_definitions_have_correct_names() {
        let dir = tempfile::tempdir().unwrap();
        let p = CodescanProvider::new(dir.path().to_path_buf());
        let tools = p.tools();
        assert_eq!(tools.len(), 2);
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"codebase_search"));
        assert!(names.contains(&"codebase_index"));
    }

    #[tokio::test]
    async fn execute_index_returns_stats() {
        let dir = tempfile::tempdir().unwrap();
        let p = CodescanProvider::new(dir.path().to_path_buf());
        let result = p.execute("codebase_index", "tc", json!({}), CancellationToken::new()).await.unwrap();
        let text = match &result.content[0] { ContentBlock::Text { text } => text.clone(), _ => panic!() };
        assert!(text.contains("codebase_index"));
    }

    #[tokio::test]
    async fn execute_search_empty_returns_no_results() {
        let dir = tempfile::tempdir().unwrap();
        let p = CodescanProvider::new(dir.path().to_path_buf());
        let result = p.execute("codebase_search", "tc", json!({"query": "zzz_not_found_12345"}), CancellationToken::new()).await.unwrap();
        let text = match &result.content[0] { ContentBlock::Text { text } => text.clone(), _ => panic!() };
        assert!(text.contains("No results"), "{text}");
    }
}
