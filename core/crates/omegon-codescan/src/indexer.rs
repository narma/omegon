//! Repo walker — discovers files, hashes content, drives incremental indexing.

use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::Result;
use sha2::{Digest, Sha256};

use crate::cache::ScanCache;
use crate::code::CodeScanner;
use crate::knowledge::{KnowledgeDirs, KnowledgeScanner};

#[derive(Debug, Clone)]
pub struct IndexStats {
    pub code_files: usize,
    pub knowledge_files: usize,
    pub code_chunks: usize,
    pub knowledge_chunks: usize,
    pub duration_ms: u64,
}

pub struct Indexer;

impl Indexer {
    pub fn run(repo_path: &Path, cache: &mut ScanCache) -> Result<IndexStats> {
        let started = Instant::now();

        let code_files = discover_code_files(repo_path);
        let knowledge_files = discover_knowledge_files(repo_path, &KnowledgeDirs::default());

        let code_hashes: Vec<(PathBuf, String)> = code_files.iter()
            .filter_map(|p| std::fs::read(p).ok().map(|c| (p.clone(), sha256(&c))))
            .collect();
        let knowledge_hashes: Vec<(PathBuf, String)> = knowledge_files.iter()
            .filter_map(|p| std::fs::read(p).ok().map(|c| (p.clone(), sha256(&c))))
            .collect();

        let all: Vec<(PathBuf, String)> = code_hashes.iter().chain(knowledge_hashes.iter()).cloned().collect();
        let stale: std::collections::HashSet<PathBuf> = cache.stale_paths(&all).into_iter().collect();

        for (path, hash) in &code_hashes {
            if !stale.contains(path) { continue; }
            let content = match std::fs::read_to_string(path) {
                Ok(c) => c,
                Err(e) => { tracing::warn!(path = %path.display(), "code read error: {e}"); continue; }
            };
            let rel = path.strip_prefix(repo_path).unwrap_or(path);
            let mut chunks = CodeScanner::scan_file(rel, &content);
            for c in &mut chunks { c.path = rel.to_path_buf(); }
            cache.upsert_code_chunks(rel, hash, &chunks)?;
        }

        for (path, hash) in &knowledge_hashes {
            if !stale.contains(path) { continue; }
            let content = match std::fs::read_to_string(path) {
                Ok(c) => c,
                Err(e) => { tracing::warn!(path = %path.display(), "knowledge read error: {e}"); continue; }
            };
            let rel = path.strip_prefix(repo_path).unwrap_or(path);
            let mut chunks = KnowledgeScanner::scan_file(rel, &content);
            for c in &mut chunks { c.path = rel.to_path_buf(); }
            cache.upsert_knowledge_chunks(rel, hash, &chunks)?;
        }

        // Record git HEAD for incremental reindex trigger
        if let Ok(out) = std::process::Command::new("git").args(["rev-parse", "HEAD"]).current_dir(repo_path).output() {
            if out.status.success() {
                let head = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let _ = cache.set_meta("last_head", &head);
            }
        }

        let duration_ms = started.elapsed().as_millis() as u64;
        let code_chunks = cache.all_code_chunks()?.len();
        let knowledge_chunks = cache.all_knowledge_chunks()?.len();

        tracing::info!(
            code_files = code_files.len(), knowledge_files = knowledge_files.len(),
            code_chunks, knowledge_chunks, duration_ms, "codescan indexed"
        );

        Ok(IndexStats {
            code_files: code_files.len(),
            knowledge_files: knowledge_files.len(),
            code_chunks, knowledge_chunks, duration_ms,
        })
    }
}

fn sha256(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

fn discover_code_files(repo_path: &Path) -> Vec<PathBuf> {
    use walkdir::WalkDir;
    let exts = ["rs", "ts", "tsx", "js", "jsx", "py", "go"];
    let skip = ["target", "node_modules", ".git", ".jj", "dist", "build", ".next"];
    WalkDir::new(repo_path).follow_links(false).into_iter()
        .filter_entry(|e| !skip.contains(&e.file_name().to_string_lossy().as_ref()))
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()).map(|x| exts.contains(&x)).unwrap_or(false))
        .map(|e| e.path().to_path_buf())
        .collect()
}

fn discover_knowledge_files(repo_path: &Path, dirs: &KnowledgeDirs) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for pattern in &dirs.patterns {
        let full = format!("{}/{}", repo_path.to_string_lossy(), pattern);
        if let Ok(paths) = glob::glob(&full) {
            for p in paths.filter_map(|p| p.ok()) {
                if p.is_file() { files.push(p); }
            }
        }
    }
    files.sort(); files.dedup(); files
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn runs_on_small_repo() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        std::fs::create_dir_all(repo.join("src")).unwrap();
        std::fs::write(repo.join("src/lib.rs"), "pub fn greet() {}").unwrap();
        std::fs::create_dir_all(repo.join("docs")).unwrap();
        std::fs::write(repo.join("docs/foo.md"), "# Foo\n\n## Overview\n\nText.").unwrap();

        let mut cache = ScanCache::open(&repo.join(".omegon/codescan.db")).unwrap();
        let stats = Indexer::run(repo, &mut cache).unwrap();
        assert!(stats.code_files >= 1);
        assert!(stats.code_chunks >= 1);
        assert!(stats.knowledge_chunks >= 1);
    }

    #[test]
    fn is_incremental() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        std::fs::create_dir_all(repo.join("src")).unwrap();
        std::fs::write(repo.join("src/main.rs"), "fn main() {}").unwrap();
        let mut cache = ScanCache::open(&repo.join(".omegon/codescan.db")).unwrap();
        let s1 = Indexer::run(repo, &mut cache).unwrap();
        let s2 = Indexer::run(repo, &mut cache).unwrap();
        assert_eq!(s1.code_chunks, s2.code_chunks);
    }
}
