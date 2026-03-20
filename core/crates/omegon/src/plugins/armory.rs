//! Armory plugin manifest — TOML schema for personas, tones, skills, and extensions.
//!
//! This implements the plugin.toml spec from the omegon-armory repo.
//! See: https://github.com/styrene-lab/omegon-armory/blob/main/docs/plugin-spec.md

use serde::Deserialize;

/// Plugin type discriminator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginType {
    Persona,
    Tone,
    Skill,
    Extension,
}

impl std::fmt::Display for PluginType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Persona => write!(f, "persona"),
            Self::Tone => write!(f, "tone"),
            Self::Skill => write!(f, "skill"),
            Self::Extension => write!(f, "extension"),
        }
    }
}

/// Top-level armory plugin manifest (plugin.toml).
#[derive(Debug, Deserialize)]
pub struct ArmoryManifest {
    pub plugin: ArmoryMeta,
    #[serde(default)]
    pub persona: Option<PersonaConfig>,
    #[serde(default)]
    pub tone: Option<ToneConfig>,
    #[serde(default)]
    pub skill: Option<SkillConfig>,
    /// Functional tools — script-backed, HTTP-backed, or WASM-backed.
    #[serde(default)]
    pub tools: Vec<ToolEntry>,
    /// Dynamic context injection — script or HTTP endpoint.
    #[serde(default)]
    pub context: Option<ContextEntry>,
    #[serde(default)]
    pub detect: Option<DetectConfig>,
}

/// Tool runner — how the tool is executed.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolRunner {
    Python,
    Node,
    Bash,
    Wasm,
}

impl std::fmt::Display for ToolRunner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Python => write!(f, "python"),
            Self::Node => write!(f, "node"),
            Self::Bash => write!(f, "bash"),
            Self::Wasm => write!(f, "wasm"),
        }
    }
}

/// A tool declaration — can be script-backed or HTTP-backed.
#[derive(Debug, Deserialize)]
pub struct ToolEntry {
    pub name: String,
    pub description: String,
    /// Script runner (python/node/bash/wasm). Mutually exclusive with `endpoint`.
    #[serde(default)]
    pub runner: Option<ToolRunner>,
    /// Path to script file, relative to plugin root.
    #[serde(default)]
    pub script: Option<String>,
    /// HTTP endpoint URL. Mutually exclusive with `runner`.
    #[serde(default)]
    pub endpoint: Option<String>,
    /// HTTP method (default: POST).
    #[serde(default)]
    pub method: Option<String>,
    /// WASM module path, relative to plugin root.
    #[serde(default)]
    pub module: Option<String>,
    /// JSON Schema for parameters.
    #[serde(default = "default_params")]
    pub parameters: serde_json::Value,
    /// Execution timeout in seconds (default: 30).
    #[serde(default = "default_tool_timeout")]
    pub timeout_secs: u64,
}

fn default_params() -> serde_json::Value {
    serde_json::json!({"type": "object", "properties": {}})
}
fn default_tool_timeout() -> u64 { 30 }

impl ToolEntry {
    /// Is this a script-backed tool?
    pub fn is_script(&self) -> bool {
        self.runner.is_some() && self.script.is_some()
    }

    /// Is this an HTTP-backed tool?
    pub fn is_http(&self) -> bool {
        self.endpoint.is_some()
    }

    /// Validate the tool entry.
    pub fn validate(&self) -> Vec<String> {
        let mut errors = Vec::new();
        if self.runner.is_some() && self.endpoint.is_some() {
            errors.push(format!(
                "tool '{}': runner and endpoint are mutually exclusive",
                self.name
            ));
        }
        if self.runner.is_some() && self.script.is_none() && self.module.is_none() {
            errors.push(format!(
                "tool '{}': runner specified but no script or module path",
                self.name
            ));
        }
        if self.runner.is_none() && self.endpoint.is_none() {
            errors.push(format!(
                "tool '{}': must have either runner+script or endpoint",
                self.name
            ));
        }
        errors
    }
}

/// Dynamic context entry — generates context at runtime.
#[derive(Debug, Deserialize)]
pub struct ContextEntry {
    /// Script runner for context generation.
    #[serde(default)]
    pub runner: Option<ToolRunner>,
    /// Script path for context generation.
    #[serde(default)]
    pub script: Option<String>,
    /// HTTP endpoint for context retrieval.
    #[serde(default)]
    pub endpoint: Option<String>,
    /// How many turns the context stays active (default: 20).
    #[serde(default = "default_context_ttl")]
    pub ttl_turns: u32,
}

fn default_context_ttl() -> u32 { 20 }

/// Required metadata for every plugin.
#[derive(Debug, Deserialize)]
pub struct ArmoryMeta {
    #[serde(rename = "type")]
    pub plugin_type: PluginType,
    /// Reverse-domain identifier (e.g. `dev.styrene.omegon.tutor`).
    pub id: String,
    /// Human-readable display name.
    pub name: String,
    /// Semantic version string.
    pub version: String,
    /// One-line description (under 200 chars).
    pub description: String,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub min_omegon: Option<String>,
}

/// Persona-specific configuration.
#[derive(Debug, Default, Deserialize)]
pub struct PersonaConfig {
    #[serde(default)]
    pub identity: Option<PersonaIdentity>,
    #[serde(default)]
    pub mind: Option<PersonaMind>,
    #[serde(default)]
    pub skills: Option<PersonaSkills>,
    #[serde(default)]
    pub tools: Option<PersonaTools>,
    #[serde(default)]
    pub routing: Option<PersonaRouting>,
    #[serde(default)]
    pub tone: Option<PersonaTone>,
    #[serde(default)]
    pub style: Option<PersonaStyle>,
}

#[derive(Debug, Deserialize)]
pub struct PersonaIdentity {
    /// Path to PERSONA.md relative to plugin root.
    pub directive: String,
}

#[derive(Debug, Default, Deserialize)]
pub struct PersonaMind {
    /// Path to seed facts file (JSONL).
    #[serde(default)]
    pub seed_facts: Option<String>,
    /// Path to seed episodes file (JSONL).
    #[serde(default)]
    pub seed_episodes: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct PersonaSkills {
    #[serde(default)]
    pub activate: Vec<String>,
    #[serde(default)]
    pub deactivate: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct PersonaTools {
    #[serde(default)]
    pub profile: Option<String>,
    #[serde(default)]
    pub enable: Vec<String>,
    #[serde(default)]
    pub disable: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct PersonaRouting {
    #[serde(default)]
    pub default_thinking: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PersonaTone {
    #[serde(default)]
    pub default: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct PersonaStyle {
    #[serde(default)]
    pub badge: Option<String>,
    #[serde(default)]
    pub accent_color: Option<String>,
}

/// Tone-specific configuration.
#[derive(Debug, Deserialize)]
pub struct ToneConfig {
    /// Path to TONE.md relative to plugin root.
    pub directive: String,
    /// Path to exemplars directory.
    #[serde(default)]
    pub exemplars: Option<String>,
    #[serde(default)]
    pub intensity: Option<ToneIntensity>,
}

#[derive(Debug, Default, Deserialize)]
pub struct ToneIntensity {
    /// Intensity during design/creative: "full" (default), "muted", "off".
    #[serde(default = "default_full")]
    pub design: String,
    /// Intensity during coding/execution: "full", "muted" (default), "off".
    #[serde(default = "default_muted")]
    pub coding: String,
}

fn default_full() -> String { "full".into() }
fn default_muted() -> String { "muted".into() }

/// Skill-specific configuration.
#[derive(Debug, Deserialize)]
pub struct SkillConfig {
    /// Path to SKILL.md relative to plugin root.
    pub guidance: String,
}

/// Auto-detection configuration.
#[derive(Debug, Default, Deserialize)]
pub struct DetectConfig {
    /// Glob patterns to match project files.
    #[serde(default)]
    pub file_patterns: Vec<String>,
    /// Directory names to match.
    #[serde(default)]
    pub directories: Vec<String>,
    /// If true, this plugin is activated when no other matches.
    #[serde(default)]
    pub default: bool,
}

impl ArmoryManifest {
    /// Parse a plugin.toml from a string.
    pub fn parse(toml_str: &str) -> Result<Self, toml::de::Error> {
        toml::from_str(toml_str)
    }

    /// Validate the manifest against the spec.
    /// Returns a list of validation errors (empty = valid).
    pub fn validate(&self) -> Vec<String> {
        let mut errors = Vec::new();

        // ID must have >= 3 segments
        if self.plugin.id.split('.').count() < 3 {
            errors.push(format!(
                "plugin.id '{}' must have at least 3 dot-separated segments",
                self.plugin.id
            ));
        }

        // Description under 200 chars
        if self.plugin.description.len() > 200 {
            errors.push(format!(
                "plugin.description is {} chars — must be under 200",
                self.plugin.description.len()
            ));
        }

        if self.plugin.description.is_empty() {
            errors.push("plugin.description must not be empty".into());
        }

        // Version is semver-ish
        let parts: Vec<&str> = self.plugin.version.split('.').collect();
        if parts.len() < 3 || parts.iter().any(|p| p.parse::<u32>().is_err()) {
            errors.push(format!(
                "plugin.version '{}' is not valid semver",
                self.plugin.version
            ));
        }

        // Type-specific validation
        match self.plugin.plugin_type {
            PluginType::Persona => {
                if self.persona.is_none() {
                    errors.push("persona plugin must have a [persona] section".into());
                } else if let Some(ref p) = self.persona {
                    if p.identity.is_none() {
                        errors.push("persona plugin must have [persona.identity] with a directive".into());
                    }
                }
            }
            PluginType::Tone => {
                if self.tone.is_none() {
                    errors.push("tone plugin must have a [tone] section with a directive".into());
                }
            }
            PluginType::Skill => {
                if self.skill.is_none() {
                    errors.push("skill plugin must have a [skill] section with a guidance path".into());
                }
            }
            PluginType::Extension => {
                // Extensions must have at least one tool or context entry
                if self.tools.is_empty() && self.context.is_none() {
                    errors.push("extension plugin must have at least one [[tools]] entry or [context]".into());
                }
            }
        }

        // Validate tool entries
        for tool in &self.tools {
            errors.extend(tool.validate());
        }

        errors
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_persona_manifest() {
        let toml = r#"
            [plugin]
            type = "persona"
            id = "dev.styrene.omegon.tutor"
            name = "Socratic Tutor"
            version = "1.0.0"
            description = "Guides through questioning, never lectures"

            [persona.identity]
            directive = "PERSONA.md"

            [persona.mind]
            seed_facts = "mind/facts.jsonl"

            [persona.tools]
            disable = ["bash", "write"]

            [persona.style]
            badge = "📚"
        "#;
        let manifest = ArmoryManifest::parse(toml).unwrap();
        assert_eq!(manifest.plugin.plugin_type, PluginType::Persona);
        assert_eq!(manifest.plugin.id, "dev.styrene.omegon.tutor");
        assert!(manifest.validate().is_empty(), "should have no validation errors");

        let persona = manifest.persona.unwrap();
        assert_eq!(persona.identity.unwrap().directive, "PERSONA.md");
        assert_eq!(persona.mind.unwrap().seed_facts.unwrap(), "mind/facts.jsonl");
        assert_eq!(persona.tools.unwrap().disable, vec!["bash", "write"]);
        assert_eq!(persona.style.unwrap().badge.unwrap(), "📚");
    }

    #[test]
    fn parse_tone_manifest() {
        let toml = r#"
            [plugin]
            type = "tone"
            id = "dev.styrene.omegon.tone.alan-watts"
            name = "Alan Watts"
            version = "1.0.0"
            description = "Philosophical, gently irreverent"

            [tone]
            directive = "TONE.md"
            exemplars = "exemplars/"

            [tone.intensity]
            design = "full"
            coding = "muted"
        "#;
        let manifest = ArmoryManifest::parse(toml).unwrap();
        assert_eq!(manifest.plugin.plugin_type, PluginType::Tone);
        assert!(manifest.validate().is_empty());

        let tone = manifest.tone.unwrap();
        assert_eq!(tone.directive, "TONE.md");
        assert_eq!(tone.exemplars.unwrap(), "exemplars/");
        let intensity = tone.intensity.unwrap();
        assert_eq!(intensity.design, "full");
        assert_eq!(intensity.coding, "muted");
    }

    #[test]
    fn parse_skill_manifest() {
        let toml = r#"
            [plugin]
            type = "skill"
            id = "dev.styrene.omegon.skill.security"
            name = "Security Review"
            version = "1.0.0"
            description = "Security checklist"

            [skill]
            guidance = "SKILL.md"
        "#;
        let manifest = ArmoryManifest::parse(toml).unwrap();
        assert_eq!(manifest.plugin.plugin_type, PluginType::Skill);
        assert!(manifest.validate().is_empty());
        assert_eq!(manifest.skill.unwrap().guidance, "SKILL.md");
    }

    #[test]
    fn parse_detect_section() {
        let toml = r#"
            [plugin]
            type = "persona"
            id = "dev.styrene.omegon.pcb"
            name = "PCB Designer"
            version = "1.0.0"
            description = "PCB design persona"

            [persona.identity]
            directive = "PERSONA.md"

            [detect]
            file_patterns = ["*.kicad_pcb", "*.kicad_sch"]
            directories = ["gerbers/"]
        "#;
        let manifest = ArmoryManifest::parse(toml).unwrap();
        let detect = manifest.detect.unwrap();
        assert_eq!(detect.file_patterns, vec!["*.kicad_pcb", "*.kicad_sch"]);
        assert_eq!(detect.directories, vec!["gerbers/"]);
        assert!(!detect.default);
    }

    #[test]
    fn validate_bad_id() {
        let toml = r#"
            [plugin]
            type = "skill"
            id = "badid"
            name = "Test"
            version = "1.0.0"
            description = "Test"

            [skill]
            guidance = "SKILL.md"
        "#;
        let manifest = ArmoryManifest::parse(toml).unwrap();
        let errors = manifest.validate();
        assert!(!errors.is_empty());
        assert!(errors[0].contains("3 dot-separated"));
    }

    #[test]
    fn validate_missing_persona_section() {
        let toml = r#"
            [plugin]
            type = "persona"
            id = "dev.styrene.omegon.empty"
            name = "Empty"
            version = "1.0.0"
            description = "Missing persona section"
        "#;
        let manifest = ArmoryManifest::parse(toml).unwrap();
        let errors = manifest.validate();
        assert!(errors.iter().any(|e| e.contains("[persona]")));
    }

    #[test]
    fn validate_bad_version() {
        let toml = r#"
            [plugin]
            type = "skill"
            id = "dev.styrene.omegon.test"
            name = "Test"
            version = "not-semver"
            description = "Test"

            [skill]
            guidance = "SKILL.md"
        "#;
        let manifest = ArmoryManifest::parse(toml).unwrap();
        let errors = manifest.validate();
        assert!(errors.iter().any(|e| e.contains("semver")));
    }

    #[test]
    fn validate_description_too_long() {
        let toml = format!(
            r#"
            [plugin]
            type = "skill"
            id = "dev.styrene.omegon.test"
            name = "Test"
            version = "1.0.0"
            description = "{}"

            [skill]
            guidance = "SKILL.md"
        "#,
            "x".repeat(201)
        );
        let manifest = ArmoryManifest::parse(&toml).unwrap();
        let errors = manifest.validate();
        assert!(errors.iter().any(|e| e.contains("200")));
    }

    #[test]
    fn plugin_type_display() {
        assert_eq!(PluginType::Persona.to_string(), "persona");
        assert_eq!(PluginType::Tone.to_string(), "tone");
        assert_eq!(PluginType::Skill.to_string(), "skill");
        assert_eq!(PluginType::Extension.to_string(), "extension");
    }

    // ── Functional plugin tests ────────────────────────────

    #[test]
    fn parse_script_backed_extension() {
        let toml = r#"
            [plugin]
            type = "extension"
            id = "dev.example.csv-analyzer"
            name = "CSV Analyzer"
            version = "1.0.0"
            description = "Analyze CSV files with pandas"

            [[tools]]
            name = "analyze_csv"
            description = "Run statistical analysis on a CSV file"
            runner = "python"
            script = "tools/analyze.py"
            timeout_secs = 60
        "#;
        let manifest = ArmoryManifest::parse(toml).unwrap();
        assert_eq!(manifest.plugin.plugin_type, PluginType::Extension);
        assert_eq!(manifest.tools.len(), 1);
        assert!(manifest.validate().is_empty());

        let tool = &manifest.tools[0];
        assert_eq!(tool.runner, Some(ToolRunner::Python));
        assert_eq!(tool.script.as_deref(), Some("tools/analyze.py"));
        assert!(tool.is_script());
        assert!(!tool.is_http());
        assert_eq!(tool.timeout_secs, 60);
    }

    #[test]
    fn parse_http_backed_extension() {
        let toml = r#"
            [plugin]
            type = "extension"
            id = "dev.example.scribe"
            name = "Scribe"
            version = "1.0.0"
            description = "Engagement tracking"

            [[tools]]
            name = "scribe_status"
            description = "Get engagement status"
            endpoint = "http://localhost:3000/api/status"
            method = "GET"
        "#;
        let manifest = ArmoryManifest::parse(toml).unwrap();
        assert!(manifest.validate().is_empty());

        let tool = &manifest.tools[0];
        assert!(tool.is_http());
        assert!(!tool.is_script());
        assert_eq!(tool.method.as_deref(), Some("GET"));
    }

    #[test]
    fn parse_persona_with_tools() {
        let toml = r#"
            [plugin]
            type = "persona"
            id = "dev.styrene.omegon.pcb-designer"
            name = "PCB Designer"
            version = "1.0.0"
            description = "PCB design persona with KiCad integration"

            [persona.identity]
            directive = "PERSONA.md"

            [persona.mind]
            seed_facts = "mind/facts.jsonl"

            [[tools]]
            name = "drc_check"
            description = "Run KiCad Design Rule Check"
            runner = "python"
            script = "tools/drc_check.py"
            timeout_secs = 60

            [[tools]]
            name = "bom_export"
            description = "Export Bill of Materials"
            runner = "python"
            script = "tools/bom_export.py"

            [detect]
            file_patterns = ["*.kicad_pcb", "*.kicad_sch"]
        "#;
        let manifest = ArmoryManifest::parse(toml).unwrap();
        assert_eq!(manifest.plugin.plugin_type, PluginType::Persona);
        assert_eq!(manifest.tools.len(), 2);
        assert!(manifest.validate().is_empty());
        assert!(manifest.detect.is_some());
    }

    #[test]
    fn parse_context_entry() {
        let toml = r#"
            [plugin]
            type = "extension"
            id = "dev.example.context-gen"
            name = "Context Gen"
            version = "1.0.0"
            description = "Dynamic context generator"

            [context]
            runner = "python"
            script = "context/generate.py"
            ttl_turns = 50
        "#;
        let manifest = ArmoryManifest::parse(toml).unwrap();
        let ctx = manifest.context.unwrap();
        assert_eq!(ctx.runner, Some(ToolRunner::Python));
        assert_eq!(ctx.script.as_deref(), Some("context/generate.py"));
        assert_eq!(ctx.ttl_turns, 50);
    }

    #[test]
    fn validate_tool_runner_without_script() {
        let toml = r#"
            [plugin]
            type = "extension"
            id = "dev.example.broken"
            name = "Broken"
            version = "1.0.0"
            description = "Missing script path"

            [[tools]]
            name = "bad_tool"
            description = "Has runner but no script"
            runner = "python"
        "#;
        let manifest = ArmoryManifest::parse(toml).unwrap();
        let errors = manifest.validate();
        assert!(errors.iter().any(|e| e.contains("no script or module")));
    }

    #[test]
    fn validate_tool_runner_and_endpoint_conflict() {
        let toml = r#"
            [plugin]
            type = "extension"
            id = "dev.example.conflict"
            name = "Conflict"
            version = "1.0.0"
            description = "Has both runner and endpoint"

            [[tools]]
            name = "confused_tool"
            description = "Can't be both"
            runner = "python"
            script = "tools/run.py"
            endpoint = "http://localhost:3000/api"
        "#;
        let manifest = ArmoryManifest::parse(toml).unwrap();
        let errors = manifest.validate();
        assert!(errors.iter().any(|e| e.contains("mutually exclusive")));
    }

    #[test]
    fn validate_tool_no_runner_no_endpoint() {
        let toml = r#"
            [plugin]
            type = "extension"
            id = "dev.example.empty-tool"
            name = "Empty"
            version = "1.0.0"
            description = "Tool with no execution method"

            [[tools]]
            name = "orphan_tool"
            description = "No runner, no endpoint"
        "#;
        let manifest = ArmoryManifest::parse(toml).unwrap();
        let errors = manifest.validate();
        assert!(errors.iter().any(|e| e.contains("must have either")));
    }

    #[test]
    fn validate_extension_needs_tools_or_context() {
        let toml = r#"
            [plugin]
            type = "extension"
            id = "dev.example.empty-ext"
            name = "Empty Extension"
            version = "1.0.0"
            description = "Extension with nothing"
        "#;
        let manifest = ArmoryManifest::parse(toml).unwrap();
        let errors = manifest.validate();
        assert!(errors.iter().any(|e| e.contains("at least one")));
    }

    #[test]
    fn tool_runner_display() {
        assert_eq!(ToolRunner::Python.to_string(), "python");
        assert_eq!(ToolRunner::Node.to_string(), "node");
        assert_eq!(ToolRunner::Bash.to_string(), "bash");
        assert_eq!(ToolRunner::Wasm.to_string(), "wasm");
    }

    #[test]
    fn parse_real_armory_manifests() {
        // Parse the actual armory plugin.toml files to validate compatibility
        let armory_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../omegon-armory");

        // Skip if armory isn't present (CI environments)
        if !armory_dir.exists() {
            return;
        }

        for category in ["personas", "tones", "skills"] {
            let cat_dir = armory_dir.join(category);
            if !cat_dir.is_dir() { continue; }
            for entry in std::fs::read_dir(cat_dir).unwrap() {
                let entry = entry.unwrap();
                let toml_path = entry.path().join("plugin.toml");
                if !toml_path.exists() { continue; }

                let content = std::fs::read_to_string(&toml_path).unwrap();
                let manifest = ArmoryManifest::parse(&content)
                    .unwrap_or_else(|e| panic!("Failed to parse {}: {e}", toml_path.display()));
                let errors = manifest.validate();
                assert!(errors.is_empty(),
                    "Validation errors in {}: {:?}", toml_path.display(), errors);
            }
        }
    }
}
