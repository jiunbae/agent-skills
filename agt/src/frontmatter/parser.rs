use anyhow::{Context, Result};
use serde::Deserialize;

#[derive(Debug, Default, Deserialize)]
pub struct Frontmatter {
    pub name: Option<String>,
    pub description: Option<String>,
    pub role: Option<String>,
    pub domain: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub tags: Option<Vec<String>>,
    #[serde(rename = "trigger-keywords")]
    pub trigger_keywords: Option<Vec<String>>,
    #[serde(rename = "allowed-tools")]
    #[allow(dead_code)]
    pub allowed_tools: Option<String>,
    #[allow(dead_code)]
    pub priority: Option<String>,
}

/// Parse YAML frontmatter from a markdown file.
/// Returns (frontmatter, body) where body is the content after the second ---.
pub fn parse(content: &str) -> Result<(Frontmatter, String)> {
    let trimmed = content.trim_start();

    if !trimmed.starts_with("---") {
        return Ok((Frontmatter::default(), content.to_string()));
    }

    // Find the closing ---
    let after_first = &trimmed[3..];
    let end_pos = after_first
        .find("\n---")
        .context("Missing closing --- in frontmatter")?;

    let yaml_str = &after_first[..end_pos].trim();
    let body_start = end_pos + 4; // skip \n---
    let body = after_first[body_start..].trim_start_matches('\n');

    let fm: Frontmatter =
        serde_yaml::from_str(yaml_str).context("Failed to parse YAML frontmatter")?;

    Ok((fm, body.to_string()))
}

/// Quick extract: get a single field from frontmatter without full parsing
pub fn get_field(content: &str, field: &str) -> Option<String> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return None;
    }

    let after_first = &trimmed[3..];
    let end_pos = after_first.find("\n---")?;
    let yaml_section = &after_first[..end_pos];

    for line in yaml_section.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix(field) {
            if let Some(value) = rest.strip_prefix(':') {
                let v = value.trim().trim_matches('"').trim_matches('\'');
                if !v.is_empty() {
                    return Some(v.to_string());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_skill_frontmatter() {
        let content = r#"---
name: test-skill
description: A test skill
tags: [test, example]
---

# Test Skill

This is the body."#;

        let (fm, body) = parse(content).unwrap();
        assert_eq!(fm.name.as_deref(), Some("test-skill"));
        assert_eq!(fm.description.as_deref(), Some("A test skill"));
        assert!(body.contains("# Test Skill"));
    }

    #[test]
    fn test_parse_persona_frontmatter() {
        let content = r#"---
name: security-reviewer
role: "Senior Application Security Engineer"
domain: security
type: review
tags: [security, owasp]
---

# Security Reviewer"#;

        let (fm, _body) = parse(content).unwrap();
        assert_eq!(fm.name.as_deref(), Some("security-reviewer"));
        assert_eq!(
            fm.role.as_deref(),
            Some("Senior Application Security Engineer")
        );
        assert_eq!(fm.kind.as_deref(), Some("review"));
    }

    #[test]
    fn test_get_field() {
        let content = r#"---
name: test
description: hello world
---"#;
        assert_eq!(get_field(content, "name"), Some("test".to_string()));
        assert_eq!(
            get_field(content, "description"),
            Some("hello world".to_string())
        );
        assert_eq!(get_field(content, "missing"), None);
    }
}
