//! State store — trait abstraction with JSON file implementation.
//!
//! Omegon uses JsonFileStore (git-native, diffable).
//! Omega would use a SledStore (ACID, fleet-scale).

use std::path::{Path, PathBuf};
use crate::types::*;
use crate::error::OpsxError;

/// The full lifecycle state — all nodes, changes, and milestones.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct LifecycleState {
    pub nodes: Vec<DesignNode>,
    pub changes: Vec<Change>,
    pub milestones: Vec<Milestone>,
}

/// Trait for state persistence. Implementations determine storage backend.
pub trait StateStore: Send + Sync {
    /// Load the full lifecycle state.
    fn load(&self) -> Result<LifecycleState, OpsxError>;

    /// Save the full lifecycle state.
    fn save(&self, state: &LifecycleState) -> Result<(), OpsxError>;
}

/// JSON file store — writes to `.omegon/lifecycle/state.json`.
/// The file is versioned by jj/git. The VCS operation log IS the transaction log.
pub struct JsonFileStore {
    path: PathBuf,
}

impl JsonFileStore {
    pub fn new(project_root: &Path) -> Self {
        Self {
            path: project_root.join(".omegon").join("lifecycle").join("state.json"),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl StateStore for JsonFileStore {
    fn load(&self) -> Result<LifecycleState, OpsxError> {
        if !self.path.exists() {
            return Ok(LifecycleState::default());
        }
        let content = std::fs::read_to_string(&self.path)
            .map_err(|e| OpsxError::StoreError(format!("read {}: {e}", self.path.display())))?;
        let state: LifecycleState = serde_json::from_str(&content)
            .map_err(|e| OpsxError::StoreError(format!("parse {}: {e}", self.path.display())))?;
        Ok(state)
    }

    fn save(&self, state: &LifecycleState) -> Result<(), OpsxError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| OpsxError::StoreError(format!("mkdir {}: {e}", parent.display())))?;
        }
        let json = serde_json::to_string_pretty(state)
            .map_err(|e| OpsxError::StoreError(format!("serialize: {e}")))?;
        std::fs::write(&self.path, json)
            .map_err(|e| OpsxError::StoreError(format!("write {}: {e}", self.path.display())))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn json_store_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let store = JsonFileStore::new(tmp.path());

        let mut state = LifecycleState::default();
        state.nodes.push(DesignNode {
            id: "test-node".into(),
            title: "Test node".into(),
            state: NodeState::Seed,
            parent: None,
            tags: vec!["v0.15.0".into()],
            priority: Some(Priority::new(2)),
            issue_type: None,
            open_questions: vec![],
            decisions: vec![],
            overview: "A test node".into(),
            bound_change: None,
            created_at: "2026-03-23".into(),
            updated_at: "2026-03-23".into(),
        });

        store.save(&state).unwrap();
        let loaded = store.load().unwrap();
        assert_eq!(loaded.nodes.len(), 1);
        assert_eq!(loaded.nodes[0].id, "test-node");
        assert_eq!(loaded.nodes[0].state, NodeState::Seed);
    }

    #[test]
    fn empty_store_returns_default() {
        let tmp = TempDir::new().unwrap();
        let store = JsonFileStore::new(tmp.path());
        let state = store.load().unwrap();
        assert!(state.nodes.is_empty());
    }
}
