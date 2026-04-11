use std::path::{Path, PathBuf};

const STALE_HEARTBEAT_SECS: i64 = 300;

pub fn runtime_dir(cwd: &Path) -> PathBuf {
    cwd.join(".omegon").join("runtime")
}

pub fn workspace_lease_path(cwd: &Path) -> PathBuf {
    runtime_dir(cwd).join("workspace.json")
}

pub fn workspace_registry_path(cwd: &Path) -> PathBuf {
    runtime_dir(cwd).join("workspaces.json")
}

pub fn workspace_id_from_path(path: &Path) -> String {
    let normalized = path
        .components()
        .filter_map(|component| {
            let text = component.as_os_str().to_string_lossy();
            if text == "/" || text.is_empty() {
                None
            } else {
                Some(text)
            }
        })
        .collect::<Vec<_>>()
        .join("::");
    if normalized.is_empty() {
        "root".into()
    } else {
        normalized
    }
}

pub fn heartbeat_is_stale(now_epoch_secs: i64, heartbeat_epoch_secs: i64) -> bool {
    now_epoch_secs.saturating_sub(heartbeat_epoch_secs) > STALE_HEARTBEAT_SECS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_paths_are_under_omegon_runtime() {
        let cwd = Path::new("/tmp/project");
        assert_eq!(runtime_dir(cwd), PathBuf::from("/tmp/project/.omegon/runtime"));
        assert_eq!(
            workspace_lease_path(cwd),
            PathBuf::from("/tmp/project/.omegon/runtime/workspace.json")
        );
        assert_eq!(
            workspace_registry_path(cwd),
            PathBuf::from("/tmp/project/.omegon/runtime/workspaces.json")
        );
    }

    #[test]
    fn workspace_id_is_deterministic_from_path() {
        assert_eq!(workspace_id_from_path(Path::new("/tmp/example-project")), "tmp::example-project");
    }

    #[test]
    fn heartbeat_staleness_threshold_is_deterministic() {
        assert!(!heartbeat_is_stale(1_000, 701));
        assert!(heartbeat_is_stale(1_000, 699));
    }
}
