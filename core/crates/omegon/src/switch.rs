//! Version switcher for Omegon
//!
//! Provides version management capabilities including:
//! - GitHub Releases API client
//! - Platform detection and artifact mapping
//! - Download and checksum verification
//! - Version storage management
//! - Interactive terminal picker
//! - .omegon-version auto-detection

use anyhow::{anyhow, Result};
use dirs::home_dir;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// GitHub repository info for releases
const REPO_OWNER: &str = "styrene-lab";
const REPO_NAME: &str = "omegon-core";
const GITHUB_API_BASE: &str = "https://api.github.com";

/// Platform target mapping
#[derive(Debug, Clone, PartialEq)]
pub struct PlatformInfo {
    pub os: String,
    pub arch: String,
    pub target: String,
}

/// Represents a GitHub release
#[derive(Debug, Clone, serde::Deserialize)]
pub struct GitHubRelease {
    pub tag_name: String,
    pub name: String,
    pub body: String,
    pub prerelease: bool,
    pub assets: Vec<GitHubAsset>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct GitHubAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

/// Parsed version information
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    pub rc: Option<u32>,
    pub raw: String,
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        use std::cmp::Ordering;
        
        // First compare major.minor.patch
        match (self.major, self.minor, self.patch).cmp(&(other.major, other.minor, other.patch)) {
            Ordering::Equal => {
                // If versions are equal, stable > RC
                match (&self.rc, &other.rc) {
                    (None, None) => Ordering::Equal,
                    (None, Some(_)) => Ordering::Greater, // Stable > RC
                    (Some(_), None) => Ordering::Less,    // RC < Stable
                    (Some(a), Some(b)) => a.cmp(b),       // Compare RC numbers
                }
            }
            other => other,
        }
    }
}

/// Version state in local storage
#[derive(Debug, Clone)]
pub struct VersionInfo {
    pub version: Version,
    pub path: PathBuf,
    pub is_active: bool,
    pub is_installed: bool,
}

/// Version switcher configuration
pub struct VersionSwitcher {
    pub versions_dir: PathBuf,
    pub current_exe: PathBuf,
    client: reqwest::Client,
    cache: Option<Vec<GitHubRelease>>,
}

impl Default for VersionSwitcher {
    fn default() -> Self {
        Self::new()
    }
}

impl VersionSwitcher {
    /// Create a new version switcher instance
    pub fn new() -> Self {
        let versions_dir = home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".omegon/versions");
        
        let current_exe = env::current_exe().unwrap_or_else(|_| PathBuf::from("omegon"));
        
        Self {
            versions_dir,
            current_exe,
            client: reqwest::Client::new(),
            cache: None,
        }
    }

    /// Fetch releases from GitHub API with caching
    pub async fn fetch_releases(&mut self) -> Result<&[GitHubRelease]> {
        if self.cache.is_none() {
            let url = format!("{}/repos/{}/{}/releases", GITHUB_API_BASE, REPO_OWNER, REPO_NAME);
            
            let response = self.client
                .get(&url)
                .header("User-Agent", "omegon-version-switcher")
                .send()
                .await?;

            if !response.status().is_success() {
                return Err(anyhow!("Failed to fetch releases: HTTP {}", response.status()));
            }

            let releases: Vec<GitHubRelease> = response.json().await?;
            self.cache = Some(releases);
        }

        Ok(self.cache.as_ref().unwrap())
    }

    /// List all installed versions
    pub fn list_installed_versions(&self) -> Result<Vec<VersionInfo>> {
        let mut versions = Vec::new();
        
        if !self.versions_dir.exists() {
            return Ok(versions);
        }

        let active_version = self.get_active_version()?;

        for entry in fs::read_dir(&self.versions_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                let version_name = entry.file_name();
                let version_str = version_name.to_string_lossy();
                
                if let Ok(version) = Version::parse(&version_str) {
                    let binary_path = entry.path().join("omegon");
                    let is_installed = binary_path.exists();
                    let is_active = active_version
                        .as_ref()
                        .map(|v| v.raw == version.raw)
                        .unwrap_or(false);

                    versions.push(VersionInfo {
                        version,
                        path: binary_path,
                        is_active,
                        is_installed,
                    });
                }
            }
        }

        // Sort by version (newest first)
        versions.sort_by(|a, b| b.version.cmp(&a.version));
        Ok(versions)
    }

    /// Get the currently active version by resolving symlink
    pub fn get_active_version(&self) -> Result<Option<Version>> {
        let target = if self.current_exe.is_symlink() {
            fs::read_link(&self.current_exe)?
        } else {
            return Ok(None);
        };

        // Extract version from path like ~/.omegon/versions/1.2.3/omegon
        if let Some(parent) = target.parent() {
            if let Some(version_name) = parent.file_name() {
                let version_str = version_name.to_string_lossy();
                return Ok(Some(Version::parse(&version_str)?));
            }
        }

        Ok(None)
    }

    /// Download and install a specific version
    pub async fn install_version(&mut self, version: &str) -> Result<PathBuf> {
        let releases = self.fetch_releases().await?;
        let release = releases
            .iter()
            .find(|r| r.tag_name == version)
            .ok_or_else(|| anyhow!("Version {} not found", version))?
            .clone(); // Clone to avoid borrow issues

        let platform = detect_platform()?;
        let artifact_name = format!("omegon-{}.tar.gz", platform.target);
        
        let asset = release
            .assets
            .iter()
            .find(|a| a.name == artifact_name)
            .ok_or_else(|| anyhow!("No asset found for platform {}", platform.target))?
            .clone();

        let checksums_asset = release
            .assets
            .iter()
            .find(|a| a.name == "checksums.sha256")
            .ok_or_else(|| anyhow!("No checksums file found"))?
            .clone();

        // Download and verify
        let tarball_data = self.download_asset(&asset).await?;
        let checksums_data = self.download_asset(&checksums_asset).await?;
        
        verify_checksum(&tarball_data, &checksums_data, &artifact_name)?;

        // Extract to version directory
        let version_dir = self.versions_dir.join(version);
        fs::create_dir_all(&version_dir)?;
        
        extract_tarball(&tarball_data, &version_dir)?;

        let binary_path = version_dir.join("omegon");
        if !binary_path.exists() {
            return Err(anyhow!("Binary not found after extraction"));
        }

        // Make executable
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&binary_path)?.permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&binary_path, perms)?;
        }

        Ok(binary_path)
    }

    /// Switch to a specific version
    pub fn activate_version(&self, version: &str) -> Result<()> {
        let version_binary = self.versions_dir.join(version).join("omegon");
        
        if !version_binary.exists() {
            return Err(anyhow!("Version {} is not installed", version));
        }

        // Handle first-time setup (move current binary to versions)
        if !self.current_exe.is_symlink() && self.current_exe.exists() {
            // Detect current version
            let output = Command::new(&self.current_exe)
                .arg("--version")
                .output();
            
            if let Ok(output) = output {
                let version_str = String::from_utf8_lossy(&output.stdout);
                if let Some(version) = extract_version_from_output(&version_str) {
                    let current_version_dir = self.versions_dir.join(&version);
                    fs::create_dir_all(&current_version_dir)?;
                    
                    let backup_path = current_version_dir.join("omegon");
                    fs::copy(&self.current_exe, &backup_path)?;
                    
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        let mut perms = fs::metadata(&backup_path)?.permissions();
                        perms.set_mode(0o755);
                        fs::set_permissions(&backup_path, perms)?;
                    }
                }
            }
        }

        // Remove existing symlink/binary
        if self.current_exe.exists() {
            fs::remove_file(&self.current_exe)?;
        }

        // Create parent directory if needed
        if let Some(parent) = self.current_exe.parent() {
            fs::create_dir_all(parent)?;
        }

        // Create new symlink
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&version_binary, &self.current_exe)?;
        }
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_file(&version_binary, &self.current_exe)?;
        }

        Ok(())
    }

    /// Interactive version picker
    pub async fn interactive_picker(&mut self) -> Result<Option<String>> {
        use crossterm::{
            cursor,
            event::{self, Event, KeyCode, KeyEvent},
            execute,
            style::{Color, Print, ResetColor, SetForegroundColor},
            terminal::{self, Clear, ClearType},
        };

        // Get installed versions first (only needs immutable borrow)
        let installed = self.list_installed_versions()?;
        let installed_map: HashMap<String, &VersionInfo> = installed
            .iter()
            .map(|v| (v.version.raw.clone(), v))
            .collect();

        // Fetch releases (needs mutable borrow, but installed is done)
        let releases = self.fetch_releases().await?;

        // Parse and sort versions
        let mut versions: Vec<Version> = releases
            .iter()
            .filter_map(|r| Version::parse(&r.tag_name).ok())
            .collect();
        versions.sort_by(|a, b| b.cmp(a)); // Newest first

        // Separate stable and RC versions
        let stable: Vec<&Version> = versions.iter().filter(|v| v.rc.is_none()).collect();
        let rc: Vec<&Version> = versions.iter().filter(|v| v.rc.is_some()).collect();

        let mut all_options = Vec::new();
        all_options.extend(stable.iter().map(|v| (*v, false))); // false = not RC
        if !rc.is_empty() {
            all_options.extend(rc.iter().map(|v| (*v, true))); // true = RC
        }

        if all_options.is_empty() {
            println!("No versions available");
            return Ok(None);
        }

        let mut selected = 0;

        // Enter raw mode
        terminal::enable_raw_mode()?;
        let mut stdout = std::io::stdout();

        let result = loop {
            // Clear screen and print header
            execute!(
                stdout,
                Clear(ClearType::All),
                cursor::MoveTo(0, 0),
                SetForegroundColor(Color::Cyan),
                Print("Select Omegon version (↑/↓ to navigate, Enter to select, q to quit):\n\n"),
                ResetColor,
            )?;

            // Print stable versions
            if !stable.is_empty() {
                execute!(
                    stdout,
                    SetForegroundColor(Color::Green),
                    Print("Stable Releases:\n"),
                    ResetColor,
                )?;

                for (i, (version, _)) in all_options.iter().enumerate() {
                    if version.rc.is_some() {
                        break; // We've reached RC versions
                    }

                    let marker = if i == selected { "→ " } else { "  " };
                    let mut status_parts = Vec::new();
                    
                    if let Some(info) = installed_map.get(&version.raw) {
                        if info.is_active {
                            status_parts.push("● active");
                        }
                        if info.is_installed {
                            status_parts.push("installed");
                        }
                    }

                    let status = if status_parts.is_empty() {
                        String::new()
                    } else {
                        format!(" ({})", status_parts.join(", "))
                    };

                    if i == selected {
                        execute!(
                            stdout,
                            SetForegroundColor(Color::Yellow),
                            Print(format!("{}{}{}\n", marker, version.raw, status)),
                            ResetColor,
                        )?;
                    } else {
                        execute!(stdout, Print(format!("{}{}{}\n", marker, version.raw, status)))?;
                    }
                }
                execute!(stdout, Print("\n"))?;
            }

            // Print RC versions
            if !rc.is_empty() {
                execute!(
                    stdout,
                    SetForegroundColor(Color::Yellow),
                    Print("Release Candidates:\n"),
                    ResetColor,
                )?;

                for (i, (version, _)) in all_options.iter().enumerate() {
                    if version.rc.is_none() {
                        continue; // Skip stable versions
                    }

                    let marker = if i == selected { "→ " } else { "  " };
                    let mut status_parts = Vec::new();
                    
                    if let Some(info) = installed_map.get(&version.raw) {
                        if info.is_active {
                            status_parts.push("● active");
                        }
                        if info.is_installed {
                            status_parts.push("installed");
                        }
                    }

                    let status = if status_parts.is_empty() {
                        String::new()
                    } else {
                        format!(" ({})", status_parts.join(", "))
                    };

                    if i == selected {
                        execute!(
                            stdout,
                            SetForegroundColor(Color::Yellow),
                            Print(format!("{}{}{}\n", marker, version.raw, status)),
                            ResetColor,
                        )?;
                    } else {
                        execute!(stdout, Print(format!("{}{}{}\n", marker, version.raw, status)))?;
                    }
                }
            }

            // Handle input
            if let Event::Key(KeyEvent { code, .. }) = event::read()? {
                match code {
                    KeyCode::Up => {
                        if selected > 0 {
                            selected -= 1;
                        }
                    }
                    KeyCode::Down => {
                        if selected < all_options.len() - 1 {
                            selected += 1;
                        }
                    }
                    KeyCode::Enter => {
                        let chosen_version = &all_options[selected].0;
                        break Some(chosen_version.raw.clone());
                    }
                    KeyCode::Char('q') | KeyCode::Esc => {
                        break None;
                    }
                    _ => {}
                }
            }
        };

        // Exit raw mode
        terminal::disable_raw_mode()?;
        execute!(stdout, Clear(ClearType::All), cursor::MoveTo(0, 0))?;

        Ok(result)
    }

    /// Check for .omegon-version file and warn if mismatch
    pub fn check_version_file(&self, cwd: &Path) -> Result<Option<String>> {
        let version_file = find_version_file(cwd)?;
        
        let Some(version_file_path) = version_file else {
            return Ok(None);
        };

        let required_version = fs::read_to_string(&version_file_path)?
            .trim()
            .to_string();

        let active_version = self.get_active_version()?;
        
        match active_version {
            Some(active) if active.raw != required_version => {
                let warning = format!(
                    "Warning: .omegon-version specifies '{}' but active version is '{}'",
                    required_version, active.raw
                );
                Ok(Some(warning))
            }
            None => {
                let warning = format!(
                    "Warning: .omegon-version specifies '{}' but no version is active",
                    required_version
                );
                Ok(Some(warning))
            }
            _ => Ok(None), // Versions match
        }
    }

    /// Download an asset from GitHub
    async fn download_asset(&self, asset: &GitHubAsset) -> Result<Vec<u8>> {
        let response = self.client
            .get(&asset.browser_download_url)
            .header("User-Agent", "omegon-version-switcher")
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(anyhow!("Failed to download {}: HTTP {}", asset.name, response.status()));
        }

        Ok(response.bytes().await?.to_vec())
    }
}

/// Detect the current platform and map to artifact name
pub fn detect_platform() -> Result<PlatformInfo> {
    let os = match env::consts::OS {
        "linux" => "linux",
        "macos" => "darwin",
        "windows" => "windows",
        other => return Err(anyhow!("Unsupported OS: {}", other)),
    };

    let arch = match env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "arm64",
        other => return Err(anyhow!("Unsupported architecture: {}", other)),
    };

    let target = format!("{}-{}", os, arch);

    Ok(PlatformInfo {
        os: os.to_string(),
        arch: arch.to_string(),
        target,
    })
}

/// Verify SHA256 checksum
fn verify_checksum(data: &[u8], checksums: &[u8], filename: &str) -> Result<()> {
    use sha2::{Sha256, Digest};

    let checksums_str = String::from_utf8_lossy(checksums);
    let expected_hash = checksums_str
        .lines()
        .find_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 && parts[1] == filename {
                Some(parts[0])
            } else {
                None
            }
        })
        .ok_or_else(|| anyhow!("Checksum for {} not found", filename))?;

    let mut hasher = Sha256::new();
    hasher.update(data);
    let actual_hash = format!("{:x}", hasher.finalize());

    if actual_hash != expected_hash {
        return Err(anyhow!(
            "Checksum mismatch for {}: expected {}, got {}",
            filename,
            expected_hash,
            actual_hash
        ));
    }

    Ok(())
}

/// Extract tarball to directory
fn extract_tarball(data: &[u8], dest_dir: &Path) -> Result<()> {
    use std::io::Cursor;
    
    let tar_data = if data.starts_with(&[0x1f, 0x8b]) {
        // Gzipped
        use flate2::read::GzDecoder;
        use std::io::Read;
        
        let mut decoder = GzDecoder::new(Cursor::new(data));
        let mut buf = Vec::new();
        decoder.read_to_end(&mut buf)?;
        buf
    } else {
        data.to_vec()
    };

    let mut archive = tar::Archive::new(Cursor::new(tar_data));
    archive.unpack(dest_dir)?;
    
    Ok(())
}

/// Find .omegon-version file by walking up directories
fn find_version_file(start_dir: &Path) -> Result<Option<PathBuf>> {
    let mut current = start_dir;
    
    loop {
        let version_file = current.join(".omegon-version");
        if version_file.exists() {
            return Ok(Some(version_file));
        }
        
        match current.parent() {
            Some(parent) => current = parent,
            None => return Ok(None),
        }
    }
}

/// Extract version from command output like "omegon 1.2.3 (abc123 2026-03-21)"
fn extract_version_from_output(output: &str) -> Option<String> {
    let parts: Vec<&str> = output.split_whitespace().collect();
    if parts.len() >= 2 {
        Some(parts[1].to_string())
    } else {
        None
    }
}

impl Version {
    /// Parse a version string like "1.2.3" or "1.2.3-rc.4"
    pub fn parse(s: &str) -> Result<Self> {
        let s = s.strip_prefix('v').unwrap_or(s); // Remove 'v' prefix if present
        
        let (base, rc) = if let Some(rc_pos) = s.find("-rc.") {
            let (base, rc_part) = s.split_at(rc_pos);
            let rc_num = rc_part.strip_prefix("-rc.")
                .ok_or_else(|| anyhow!("Invalid RC format"))?
                .parse::<u32>()?;
            (base, Some(rc_num))
        } else {
            (s, None)
        };

        let parts: Vec<&str> = base.split('.').collect();
        if parts.len() != 3 {
            return Err(anyhow!("Invalid version format: {}", s));
        }

        let major = parts[0].parse()?;
        let minor = parts[1].parse()?;
        let patch = parts[2].parse()?;

        Ok(Version {
            major,
            minor,
            patch,
            rc,
            raw: s.to_string(),
        })
    }

    /// Check if this is a stable release (not RC)
    pub fn is_stable(&self) -> bool {
        self.rc.is_none()
    }
}

// ─── Top-level CLI entrypoints ──────────────────────────────────────────────

/// `omegon switch --list` — show installed versions, mark active.
pub async fn list_versions() -> anyhow::Result<()> {
    let mut switcher = VersionSwitcher::new();
    let installed = switcher.list_installed_versions()?;
    let active = switcher.get_active_version()?;

    if installed.is_empty() {
        println!("No versions installed in ~/.omegon/versions/");
        println!("Run `omegon switch <version>` to install one.");
        return Ok(());
    }

    println!("Installed versions:");
    for v in &installed {
        let marker = if active.as_ref().is_some_and(|a| a.raw == v.version.raw) {
            " ● active"
        } else {
            ""
        };
        let kind = if v.version.is_stable() { "" } else { " (rc)" };
        println!("  {}{kind}{marker}", v.version.raw);
    }
    Ok(())
}

/// `omegon switch <version>` — download (if needed) and activate.
pub async fn switch_to_version(version: &str) -> anyhow::Result<()> {
    let mut switcher = VersionSwitcher::new();
    let installed = switcher.list_installed_versions()?;

    let already_installed = installed.iter().any(|v| v.version.raw == version);
    if !already_installed {
        println!("Downloading omegon {version}...");
        switcher.install_version(version).await?;
    }

    switcher.activate_version(version)?;
    println!("✓ Switched to omegon {version}");
    println!("  Restart omegon to use the new version.");
    Ok(())
}

/// `omegon switch --latest` / `--latest-rc` — find and switch to latest.
pub async fn switch_to_latest(include_rc: bool) -> anyhow::Result<()> {
    let mut switcher = VersionSwitcher::new();
    println!("Fetching releases...");
    let releases = switcher.fetch_releases().await?;

    let target = if include_rc {
        releases.first()
    } else {
        releases.iter().find(|r| !r.prerelease)
    };

    let release = target
        .ok_or_else(|| anyhow::anyhow!("No {} releases found", if include_rc { "RC" } else { "stable" }))?;
    let version = release.tag_name.strip_prefix('v').unwrap_or(&release.tag_name);
    println!("Latest {}: {version}", if include_rc { "RC" } else { "stable" });
    switch_to_version(version).await
}

/// `omegon switch` (no args) — interactive picker.
pub async fn interactive_picker() -> anyhow::Result<()> {
    let mut switcher = VersionSwitcher::new();
    println!("Fetching releases...");
    let _ = switcher.fetch_releases().await?;

    match switcher.interactive_picker().await? {
        Some(version) => switch_to_version(&version).await,
        None => {
            println!("No version selected.");
            Ok(())
        }
    }
}

/// Check `.omegon-version` and warn if mismatch. Called at startup.
pub fn check_version_file_warning(cwd: &std::path::Path) {
    let switcher = VersionSwitcher::new();
    match switcher.check_version_file(cwd) {
        Ok(Some(wanted)) => {
            match switcher.get_active_version() {
                Ok(Some(active)) if active.raw != wanted => {
                    eprintln!(
                        "⚠ .omegon-version requests {wanted} but active version is {}",
                        active.raw
                    );
                    eprintln!("  Run `omegon switch {wanted}` to switch.");
                }
                _ => {} // matches or can't determine — silent
            }
        }
        _ => {} // no file or error — silent
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_parsing() {
        let v = Version::parse("1.2.3").unwrap();
        assert_eq!(v.major, 1);
        assert_eq!(v.minor, 2);
        assert_eq!(v.patch, 3);
        assert_eq!(v.rc, None);
        assert!(v.is_stable());

        let v = Version::parse("1.2.3-rc.4").unwrap();
        assert_eq!(v.major, 1);
        assert_eq!(v.minor, 2);
        assert_eq!(v.patch, 3);
        assert_eq!(v.rc, Some(4));
        assert!(!v.is_stable());

        let v = Version::parse("v0.14.1-rc.12").unwrap();
        assert_eq!(v.major, 0);
        assert_eq!(v.minor, 14);
        assert_eq!(v.patch, 1);
        assert_eq!(v.rc, Some(12));
        assert_eq!(v.raw, "0.14.1-rc.12");

        assert!(Version::parse("invalid").is_err());
        assert!(Version::parse("1.2").is_err());
        assert!(Version::parse("1.2.3.4").is_err());
    }

    #[test]
    fn test_version_ordering() {
        let v1 = Version::parse("1.2.3").unwrap();
        let v2 = Version::parse("1.2.4").unwrap();
        let v3 = Version::parse("1.2.3-rc.1").unwrap();
        let v4 = Version::parse("1.2.4-rc.1").unwrap();

        assert!(v2 > v1);
        assert!(v1 > v3); // Stable > RC for same version
        assert!(v2 > v4); // Stable > RC for same version
        assert!(v4 > v1); // Higher version RC > lower stable
    }

    #[test]
    fn test_platform_detection() {
        let platform = detect_platform().unwrap();
        assert!(!platform.os.is_empty());
        assert!(!platform.arch.is_empty());
        assert!(!platform.target.is_empty());
        
        // Should be in format "os-arch"
        assert_eq!(platform.target, format!("{}-{}", platform.os, platform.arch));
    }

    #[test]
    fn test_version_extraction() {
        assert_eq!(
            extract_version_from_output("omegon 1.2.3 (abc123 2026-03-21)"),
            Some("1.2.3".to_string())
        );
        assert_eq!(
            extract_version_from_output("omegon 0.14.1-rc.12"),
            Some("0.14.1-rc.12".to_string())
        );
        assert_eq!(extract_version_from_output("invalid"), None);
        assert_eq!(extract_version_from_output(""), None);
    }

    #[test] 
    fn test_find_version_file() {
        use std::fs;
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let root = temp_dir.path();
        
        // Create nested directory structure
        let nested_dir = root.join("project").join("sub");
        fs::create_dir_all(&nested_dir).unwrap();
        
        // Create .omegon-version in root
        let version_file = root.join(".omegon-version");
        fs::write(&version_file, "1.2.3").unwrap();
        
        // Should find the file when starting from nested directory
        let found = find_version_file(&nested_dir).unwrap();
        assert_eq!(found, Some(version_file));
        
        // Should return None if no file exists
        let temp_dir2 = TempDir::new().unwrap();
        let found = find_version_file(temp_dir2.path()).unwrap();
        assert_eq!(found, None);
    }
}
