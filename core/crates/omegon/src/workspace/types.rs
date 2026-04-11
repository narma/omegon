use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkspaceRole {
    Primary,
    Feature,
    CleaveChild,
    Benchmark,
    Release,
    Exploratory,
    ReadOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkspaceKind {
    Code,
    Vault,
    Knowledge,
    Spec,
    Mixed,
    Generic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mutability {
    Mutable,
    ReadOnly,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkspaceLease {
    pub project_id: String,
    pub workspace_id: String,
    pub path: String,
    pub branch: String,
    pub role: WorkspaceRole,
    pub workspace_kind: WorkspaceKind,
    pub mutability: Mutability,
    pub owner_session_id: Option<String>,
    pub owner_agent_id: Option<String>,
    pub created_at: String,
    pub last_heartbeat: String,
    pub parent_workspace_id: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkspaceSummary {
    pub workspace_id: String,
    pub path: String,
    pub branch: String,
    pub role: WorkspaceRole,
    pub workspace_kind: WorkspaceKind,
    pub mutability: Mutability,
    pub owner_session_id: Option<String>,
    pub last_heartbeat: String,
    pub stale: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkspaceRegistry {
    pub project_id: String,
    pub repo_root: String,
    pub workspaces: Vec<WorkspaceSummary>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_lease_round_trip() {
        let lease = WorkspaceLease {
            project_id: "proj".into(),
            workspace_id: "ws".into(),
            path: "/tmp/ws".into(),
            branch: "feature/demo".into(),
            role: WorkspaceRole::Feature,
            workspace_kind: WorkspaceKind::Mixed,
            mutability: Mutability::Mutable,
            owner_session_id: Some("session-1".into()),
            owner_agent_id: Some("agent-1".into()),
            created_at: "2026-04-11T00:00:00Z".into(),
            last_heartbeat: "2026-04-11T00:00:10Z".into(),
            parent_workspace_id: Some("parent".into()),
            source: "operator".into(),
        };
        let json = serde_json::to_string(&lease).unwrap();
        let decoded: WorkspaceLease = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, lease);
    }

    #[test]
    fn workspace_registry_round_trip() {
        let registry = WorkspaceRegistry {
            project_id: "proj".into(),
            repo_root: "/repo".into(),
            workspaces: vec![WorkspaceSummary {
                workspace_id: "ws".into(),
                path: "/repo".into(),
                branch: "main".into(),
                role: WorkspaceRole::Primary,
                workspace_kind: WorkspaceKind::Code,
                mutability: Mutability::Mutable,
                owner_session_id: None,
                last_heartbeat: "2026-04-11T00:00:10Z".into(),
                stale: false,
            }],
        };
        let json = serde_json::to_string(&registry).unwrap();
        let decoded: WorkspaceRegistry = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, registry);
    }
}
