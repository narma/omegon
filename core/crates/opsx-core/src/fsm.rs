//! Lifecycle FSM — enforced state transitions.
//!
//! Every state change goes through the FSM. Invalid transitions are
//! compile-time errors (via the type system) or runtime errors
//! (via `validate_transition`). The FSM is the single authority
//! for what transitions are legal.

use crate::types::*;
use crate::store::{LifecycleState, StateStore};
use crate::error::OpsxError;

/// The lifecycle engine — validates transitions and mutates state.
pub struct Lifecycle<S: StateStore> {
    store: S,
    state: LifecycleState,
}

impl<S: StateStore> Lifecycle<S> {
    /// Load or initialize the lifecycle from the store.
    pub fn load(store: S) -> Result<Self, OpsxError> {
        let state = store.load()?;
        Ok(Self { store, state })
    }

    /// Persist the current state to the store.
    pub fn save(&self) -> Result<(), OpsxError> {
        self.store.save(&self.state)
    }

    /// Get the current state (read-only).
    pub fn state(&self) -> &LifecycleState {
        &self.state
    }

    // ─── Design node operations ─────────────────────────────────────

    /// Create a new design node.
    pub fn create_node(&mut self, id: &str, title: &str, parent: Option<&str>) -> Result<&DesignNode, OpsxError> {
        if self.state.nodes.iter().any(|n| n.id == id) {
            return Err(OpsxError::AlreadyExists(format!("node '{id}'")));
        }
        let now = chrono_now();
        self.state.nodes.push(DesignNode {
            id: id.into(),
            title: title.into(),
            state: NodeState::Seed,
            parent: parent.map(|s| s.into()),
            tags: vec![],
            priority: None,
            issue_type: None,
            open_questions: vec![],
            decisions: vec![],
            overview: String::new(),
            bound_change: None,
            created_at: now.clone(),
            updated_at: now,
        });
        self.save()?;
        Ok(self.state.nodes.last().unwrap())
    }

    /// Transition a design node to a new state.
    pub fn transition_node(&mut self, id: &str, target: NodeState) -> Result<(), OpsxError> {
        let node = self.state.nodes.iter_mut().find(|n| n.id == id)
            .ok_or_else(|| OpsxError::NotFound(format!("node '{id}'")))?;

        if !node.state.can_transition_to(target) {
            return Err(OpsxError::InvalidTransition {
                entity: format!("node '{id}'"),
                from: node.state.as_str().into(),
                to: target.as_str().into(),
            });
        }

        // Enforce preconditions for specific transitions
        match target {
            NodeState::Decided => {
                if !node.open_questions.is_empty() {
                    return Err(OpsxError::PreconditionFailed(
                        format!("node '{}' has {} open questions — resolve before deciding",
                            id, node.open_questions.len())
                    ));
                }
            }
            NodeState::Implementing => {
                if node.state != NodeState::Decided {
                    return Err(OpsxError::PreconditionFailed(
                        format!("node '{}' must be decided before implementing", id)
                    ));
                }
            }
            _ => {}
        }

        // Check milestone freeze
        for ms in &self.state.milestones {
            if ms.state == MilestoneState::Frozen && ms.nodes.contains(&id.to_string()) {
                // Allow completing work (→ implemented) but not starting new work
                if target == NodeState::Exploring || target == NodeState::Seed {
                    return Err(OpsxError::MilestoneFrozen(ms.name.clone()));
                }
            }
        }

        node.state = target;
        node.updated_at = chrono_now();
        self.save()?;
        Ok(())
    }

    /// Get a node by ID.
    pub fn get_node(&self, id: &str) -> Option<&DesignNode> {
        self.state.nodes.iter().find(|n| n.id == id)
    }

    /// List all nodes.
    pub fn nodes(&self) -> &[DesignNode] {
        &self.state.nodes
    }

    // ─── Milestone operations ───────────────────────────────────────

    /// Create or get a milestone.
    pub fn create_milestone(&mut self, name: &str) -> Result<(), OpsxError> {
        if self.state.milestones.iter().any(|m| m.name == name) {
            return Err(OpsxError::AlreadyExists(format!("milestone '{name}'")));
        }
        let now = chrono_now();
        self.state.milestones.push(Milestone {
            name: name.into(),
            state: MilestoneState::Open,
            nodes: vec![],
            created_at: now.clone(),
            updated_at: now,
        });
        self.save()?;
        Ok(())
    }

    /// Add a node to a milestone (creates milestone if needed).
    pub fn milestone_add(&mut self, milestone: &str, node_id: &str) -> Result<(), OpsxError> {
        // Ensure node exists
        if !self.state.nodes.iter().any(|n| n.id == node_id) {
            return Err(OpsxError::NotFound(format!("node '{node_id}'")));
        }

        // Find or create milestone
        if !self.state.milestones.iter().any(|m| m.name == milestone) {
            self.create_milestone(milestone)?;
        }

        let ms = self.state.milestones.iter_mut().find(|m| m.name == milestone).unwrap();

        if ms.state == MilestoneState::Frozen {
            return Err(OpsxError::MilestoneFrozen(milestone.into()));
        }

        if !ms.nodes.contains(&node_id.to_string()) {
            ms.nodes.push(node_id.into());
            ms.updated_at = chrono_now();
        }
        self.save()?;
        Ok(())
    }

    /// Freeze a milestone.
    pub fn milestone_freeze(&mut self, name: &str) -> Result<(), OpsxError> {
        let ms = self.state.milestones.iter_mut().find(|m| m.name == name)
            .ok_or_else(|| OpsxError::NotFound(format!("milestone '{name}'")))?;
        ms.state = MilestoneState::Frozen;
        ms.updated_at = chrono_now();
        self.save()?;
        Ok(())
    }

    /// Unfreeze a milestone.
    pub fn milestone_unfreeze(&mut self, name: &str) -> Result<(), OpsxError> {
        let ms = self.state.milestones.iter_mut().find(|m| m.name == name)
            .ok_or_else(|| OpsxError::NotFound(format!("milestone '{name}'")))?;
        ms.state = MilestoneState::Open;
        ms.updated_at = chrono_now();
        self.save()?;
        Ok(())
    }

    /// Get milestone readiness report.
    pub fn milestone_status(&self, name: &str) -> Result<MilestoneStatus, OpsxError> {
        let ms = self.state.milestones.iter().find(|m| m.name == name)
            .ok_or_else(|| OpsxError::NotFound(format!("milestone '{name}'")))?;

        let mut status = MilestoneStatus {
            name: ms.name.clone(),
            state: ms.state,
            total: ms.nodes.len(),
            implemented: 0,
            decided: 0,
            exploring: 0,
            other: 0,
        };

        for node_id in &ms.nodes {
            if let Some(node) = self.state.nodes.iter().find(|n| n.id == *node_id) {
                match node.state {
                    NodeState::Implemented => status.implemented += 1,
                    NodeState::Decided | NodeState::Implementing => status.decided += 1,
                    NodeState::Exploring | NodeState::Resolved => status.exploring += 1,
                    _ => status.other += 1,
                }
            } else {
                status.other += 1;
            }
        }

        Ok(status)
    }
}

/// Milestone readiness report.
pub struct MilestoneStatus {
    pub name: String,
    pub state: MilestoneState,
    pub total: usize,
    pub implemented: usize,
    pub decided: usize,
    pub exploring: usize,
    pub other: usize,
}

impl MilestoneStatus {
    pub fn progress_pct(&self) -> usize {
        if self.total == 0 { 0 } else { self.implemented * 100 / self.total }
    }
}

fn chrono_now() -> String {
    // Simple ISO 8601 without chrono dependency
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{now}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::JsonFileStore;
    use tempfile::TempDir;

    fn test_lifecycle() -> (TempDir, Lifecycle<JsonFileStore>) {
        let tmp = TempDir::new().unwrap();
        let store = JsonFileStore::new(tmp.path());
        let lc = Lifecycle::load(store).unwrap();
        (tmp, lc)
    }

    #[test]
    fn create_node() {
        let (_tmp, mut lc) = test_lifecycle();
        lc.create_node("test", "Test Node", None).unwrap();
        assert_eq!(lc.nodes().len(), 1);
        assert_eq!(lc.nodes()[0].state, NodeState::Seed);
    }

    #[test]
    fn valid_transition() {
        let (_tmp, mut lc) = test_lifecycle();
        lc.create_node("test", "Test", None).unwrap();
        lc.transition_node("test", NodeState::Exploring).unwrap();
        assert_eq!(lc.get_node("test").unwrap().state, NodeState::Exploring);
    }

    #[test]
    fn invalid_transition_rejected() {
        let (_tmp, mut lc) = test_lifecycle();
        lc.create_node("test", "Test", None).unwrap();
        let err = lc.transition_node("test", NodeState::Implemented);
        assert!(err.is_err());
        match err.unwrap_err() {
            OpsxError::InvalidTransition { .. } => {}
            other => panic!("expected InvalidTransition, got {other:?}"),
        }
    }

    #[test]
    fn decided_requires_no_open_questions() {
        let (_tmp, mut lc) = test_lifecycle();
        lc.create_node("test", "Test", None).unwrap();
        lc.transition_node("test", NodeState::Exploring).unwrap();

        // Add a question
        if let Some(node) = lc.state.nodes.iter_mut().find(|n| n.id == "test") {
            node.open_questions.push("Unresolved?".into());
        }
        lc.save().unwrap();

        let err = lc.transition_node("test", NodeState::Decided);
        assert!(err.is_err());
    }

    #[test]
    fn milestone_freeze_prevents_additions() {
        let (_tmp, mut lc) = test_lifecycle();
        lc.create_node("a", "Node A", None).unwrap();
        lc.create_node("b", "Node B", None).unwrap();
        lc.milestone_add("v1.0", "a").unwrap();
        lc.milestone_freeze("v1.0").unwrap();

        let err = lc.milestone_add("v1.0", "b");
        assert!(err.is_err());
    }

    #[test]
    fn milestone_status_report() {
        let (_tmp, mut lc) = test_lifecycle();
        lc.create_node("a", "A", None).unwrap();
        lc.create_node("b", "B", None).unwrap();
        lc.transition_node("a", NodeState::Exploring).unwrap();
        lc.transition_node("a", NodeState::Decided).unwrap();
        lc.transition_node("a", NodeState::Implementing).unwrap();
        lc.transition_node("a", NodeState::Implemented).unwrap();
        lc.milestone_add("v1.0", "a").unwrap();
        lc.milestone_add("v1.0", "b").unwrap();

        let status = lc.milestone_status("v1.0").unwrap();
        assert_eq!(status.total, 2);
        assert_eq!(status.implemented, 1);
        assert_eq!(status.progress_pct(), 50);
    }

    #[test]
    fn state_persists_across_load() {
        let tmp = TempDir::new().unwrap();
        {
            let store = JsonFileStore::new(tmp.path());
            let mut lc = Lifecycle::load(store).unwrap();
            lc.create_node("persist", "Persisted", None).unwrap();
        }
        {
            let store = JsonFileStore::new(tmp.path());
            let lc = Lifecycle::load(store).unwrap();
            assert_eq!(lc.nodes().len(), 1);
            assert_eq!(lc.nodes()[0].id, "persist");
        }
    }
}
