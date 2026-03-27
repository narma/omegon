//! Regex-based structural code scanner for Rust, TypeScript, Python, Go.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct CodeChunk {
    pub path: PathBuf,
    pub start_line: usize,
    pub end_line: usize,
    pub item_name: String,
    pub item_kind: String,
    pub text: String,
}

pub struct CodeScanner;

impl CodeScanner {
    pub fn scan_file(path: &Path, content: &str) -> Vec<CodeChunk> {
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        match ext {
            "rs" => scan_with_patterns(path, content, RUST_PATTERNS),
            "ts" | "tsx" | "js" | "jsx" | "mts" | "mjs" => scan_with_patterns(path, content, TS_PATTERNS),
            "py" => scan_with_patterns(path, content, PY_PATTERNS),
            "go" => scan_with_patterns(path, content, GO_PATTERNS),
            _ => vec![],
        }
    }
}

type PatternPair = (&'static str, &'static str);

const RUST_PATTERNS: &[PatternPair] = &[
    (r"^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([a-zA-Z_][a-zA-Z0-9_]*)\b", "fn"),
    (r"^(?:pub(?:\([^)]*\))?\s+)?impl(?:<[^>]*>)?\s+(?:\S+\s+for\s+)?([a-zA-Z_][a-zA-Z0-9_:<>]*)", "impl"),
    (r"^(?:pub(?:\([^)]*\))?\s+)?struct\s+([a-zA-Z_][a-zA-Z0-9_]*)\b", "struct"),
    (r"^(?:pub(?:\([^)]*\))?\s+)?enum\s+([a-zA-Z_][a-zA-Z0-9_]*)\b", "enum"),
    (r"^(?:pub(?:\([^)]*\))?\s+)?trait\s+([a-zA-Z_][a-zA-Z0-9_]*)\b", "trait"),
    (r"^(?:pub(?:\([^)]*\))?\s+)?mod\s+([a-zA-Z_][a-zA-Z0-9_]*)\b", "mod"),
];

const TS_PATTERNS: &[PatternPair] = &[
    (r"^(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\b", "function"),
    (r"^(?:export\s+)?(?:abstract\s+)?class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\b", "class"),
    (r"^(?:export\s+)?interface\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\b", "interface"),
    (r"^(?:export\s+)?type\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=", "type"),
];

const PY_PATTERNS: &[PatternPair] = &[
    (r"^(?:async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\b", "def"),
    (r"^class\s+([a-zA-Z_][a-zA-Z0-9_]*)\b", "class"),
];

const GO_PATTERNS: &[PatternPair] = &[
    (r"^func\s+(?:\([^)]+\)\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\b", "func"),
    (r"^type\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:struct|interface)\b", "type"),
];

fn scan_with_patterns(path: &Path, content: &str, patterns: &[PatternPair]) -> Vec<CodeChunk> {
    let lines: Vec<&str> = content.lines().collect();
    let total = lines.len();
    let mut matches: BTreeMap<usize, (String, String)> = BTreeMap::new();

    for &(pattern, kind) in patterns {
        let Ok(re) = regex::Regex::new(pattern) else { continue };
        for (i, line) in lines.iter().enumerate() {
            if let Some(cap) = re.captures(line) {
                let name = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                if !name.is_empty() {
                    matches.entry(i).or_insert_with(|| (name, kind.to_string()));
                }
            }
        }
    }

    if matches.is_empty() {
        return vec![];
    }

    let starts: Vec<usize> = matches.keys().cloned().collect();
    let mut chunks = Vec::with_capacity(starts.len());

    for (i, &start) in starts.iter().enumerate() {
        let end = if i + 1 < starts.len() { (starts[i + 1]).saturating_sub(1) } else { total.saturating_sub(1) };
        let chunk_end = end.min(start + 99);
        let (name, kind) = &matches[&start];
        let text = lines[start..=chunk_end.min(total.saturating_sub(1))].join("\n");
        chunks.push(CodeChunk {
            path: path.to_path_buf(),
            start_line: start + 1,
            end_line: chunk_end + 1,
            item_name: name.clone(),
            item_kind: kind.clone(),
            text,
        });
    }
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_rust() {
        let src = "pub struct Foo {}\nimpl Foo {\n    pub fn new() {}\n}\npub trait Bar {}";
        let chunks = CodeScanner::scan_file(Path::new("x.rs"), src);
        let names: Vec<&str> = chunks.iter().map(|c| c.item_name.as_str()).collect();
        assert!(names.contains(&"Foo"), "{:?}", names);
        assert!(names.contains(&"Bar"), "{:?}", names);
    }

    #[test]
    fn scan_typescript() {
        let src = "export class MyService {}\nexport async function fetchData() {}\nexport interface Config {}";
        let chunks = CodeScanner::scan_file(Path::new("x.ts"), src);
        let names: Vec<&str> = chunks.iter().map(|c| c.item_name.as_str()).collect();
        assert!(names.contains(&"MyService"), "{:?}", names);
        assert!(names.contains(&"fetchData"), "{:?}", names);
        assert!(names.contains(&"Config"), "{:?}", names);
    }

    #[test]
    fn scan_python() {
        let src = "class Foo:\n    pass\nasync def handler():\n    pass";
        let chunks = CodeScanner::scan_file(Path::new("x.py"), src);
        let names: Vec<&str> = chunks.iter().map(|c| c.item_name.as_str()).collect();
        assert!(names.contains(&"Foo"), "{:?}", names);
        assert!(names.contains(&"handler"), "{:?}", names);
    }

    #[test]
    fn scan_go() {
        let src = "type Server struct {}\nfunc NewServer() *Server { return nil }";
        let chunks = CodeScanner::scan_file(Path::new("x.go"), src);
        let names: Vec<&str> = chunks.iter().map(|c| c.item_name.as_str()).collect();
        assert!(names.contains(&"NewServer"), "{:?}", names);
    }

    #[test]
    fn unknown_ext_empty() {
        assert!(CodeScanner::scan_file(Path::new("x.toml"), "key = 1").is_empty());
    }
}
