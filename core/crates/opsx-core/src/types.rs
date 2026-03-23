//! Core types — state enums, node/change/milestone data structures.

use serde::{Deserialize, Serialize};

/// Design node lifecycle states.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeState {
    Seed,
    Exploring,
    Resolved,
    Decided,
    Implementing,
    Implemented,
    Blocked,
    Deferred,
}

impl NodeState {
    /// Valid transitions from this state.
    pub fn valid_transitions(self) -> &'static [NodeState] {
        use NodeState::*;
        match self {
            Seed => &[Exploring, Deferred],
            Exploring => &[Resolved, Decided, Blocked, Deferred],
            Resolved => &[Decided, Exploring, Blocked, Deferred],
            Decided => &[Implementing, Exploring, Blocked, Deferred],
            Implementing => &[Implemented, Decided, Blocked, Deferred],
            Implemented => &[Deferred], // terminal, can only be deferred
            Blocked => &[Exploring, Decided, Deferred],
            Deferred => &[Seed, Exploring], // can be revived
        }
    }

    /// Can transition to the target state?
    pub fn can_transition_to(self, target: NodeState) -> bool {
        self.valid_transitions().contains(&target)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Seed => "seed",
            Self::Exploring => "exploring",
            Self::Resolved => "resolved",
            Self::Decided => "decided",
            Self::Implementing => "implementing",
            Self::Implemented => "implemented",
            Self::Blocked => "blocked",
            Self::Deferred => "deferred",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "seed" => Some(Self::Seed),
            "exploring" => Some(Self::Exploring),
            "resolved" => Some(Self::Resolved),
            "decided" => Some(Self::Decided),
            "implementing" => Some(Self::Implementing),
            "implemented" => Some(Self::Implemented),
            "blocked" => Some(Self::Blocked),
            "deferred" => Some(Self::Deferred),
            _ => None,
        }
    }
}

/// OpenSpec change lifecycle states.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeState {
    Proposed,
    Specced,
    Planned,
    Implementing,
    Verifying,
    Archived,
}

impl ChangeState {
    pub fn valid_transitions(self) -> &'static [ChangeState] {
        use ChangeState::*;
        match self {
            Proposed => &[Specced],
            Specced => &[Planned, Proposed], // can revise specs
            Planned => &[Implementing, Specced],
            Implementing => &[Verifying, Planned], // can re-plan
            Verifying => &[Archived, Implementing], // can re-implement on failure
            Archived => &[], // terminal
        }
    }

    pub fn can_transition_to(self, target: ChangeState) -> bool {
        self.valid_transitions().contains(&target)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Proposed => "proposed",
            Self::Specced => "specced",
            Self::Planned => "planned",
            Self::Implementing => "implementing",
            Self::Verifying => "verifying",
            Self::Archived => "archived",
        }
    }
}

/// Milestone lifecycle states.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MilestoneState {
    Open,
    Frozen,
    Released,
}

/// Priority levels (1 = critical, 5 = trivial).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Priority(pub u8);

impl Priority {
    pub fn new(level: u8) -> Self { Self(level.clamp(1, 5)) }
}

/// Issue classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IssueType {
    Epic,
    Feature,
    Task,
    Bug,
    Chore,
}

/// A design node — the fundamental unit of the design tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesignNode {
    pub id: String,
    pub title: String,
    pub state: NodeState,
    pub parent: Option<String>,
    pub tags: Vec<String>,
    pub priority: Option<Priority>,
    pub issue_type: Option<IssueType>,
    pub open_questions: Vec<String>,
    pub decisions: Vec<Decision>,
    pub overview: String,
    /// Bound OpenSpec change name (if implementing).
    pub bound_change: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A design decision.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Decision {
    pub title: String,
    pub status: DecisionStatus,
    pub rationale: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DecisionStatus {
    Exploring,
    Decided,
    Rejected,
}

/// An OpenSpec change — tracks a spec-driven implementation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Change {
    pub name: String,
    pub title: String,
    pub state: ChangeState,
    pub bound_node: Option<String>,
    pub specs: Vec<String>,  // spec domain names
    pub tasks_total: usize,
    pub tasks_done: usize,
    pub created_at: String,
    pub updated_at: String,
}

/// A release milestone.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Milestone {
    pub name: String,
    pub state: MilestoneState,
    pub nodes: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_state_transitions() {
        assert!(NodeState::Seed.can_transition_to(NodeState::Exploring));
        assert!(NodeState::Exploring.can_transition_to(NodeState::Decided));
        assert!(NodeState::Decided.can_transition_to(NodeState::Implementing));
        assert!(!NodeState::Seed.can_transition_to(NodeState::Implemented));
        assert!(!NodeState::Implemented.can_transition_to(NodeState::Exploring));
    }

    #[test]
    fn change_state_transitions() {
        assert!(ChangeState::Proposed.can_transition_to(ChangeState::Specced));
        assert!(ChangeState::Implementing.can_transition_to(ChangeState::Verifying));
        assert!(!ChangeState::Archived.can_transition_to(ChangeState::Proposed));
        assert!(!ChangeState::Proposed.can_transition_to(ChangeState::Archived));
    }

    #[test]
    fn node_state_parse_roundtrip() {
        for state in [NodeState::Seed, NodeState::Exploring, NodeState::Decided,
                       NodeState::Implementing, NodeState::Implemented, NodeState::Blocked] {
            assert_eq!(NodeState::parse(state.as_str()), Some(state));
        }
    }
}
