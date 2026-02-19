use std::fs;
use std::path::{Path, PathBuf};

const EXCLUDE_DIRS: &[&str] = &[
    "static",
    "cli",
    "codex-support",
    "personas",
    "agt",
    "npm",
    ".git",
    ".github",
    ".agents",
    ".context",
    "node_modules",
    "__pycache__",
    "hooks",
    "target",
];

/// Find agt source directory by following symlinks from the executable
pub fn find_source_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let resolved = fs::canonicalize(&exe).unwrap_or(exe);

    // Walk up looking for a directory that contains skill groups
    let mut dir = resolved.parent()?;
    for _ in 0..5 {
        // Check if this looks like the agent-skills root
        // (has directories containing SKILL.md files)
        if has_skill_groups(dir) {
            return Some(dir.to_path_buf());
        }
        dir = dir.parent()?;
    }

    // Fallback: check if AGT_DIR or AGENT_SKILLS_DIR env is set
    if let Ok(env_dir) = std::env::var("AGT_DIR").or_else(|_| std::env::var("AGENT_SKILLS_DIR")) {
        let p = PathBuf::from(env_dir);
        if p.is_dir() {
            return Some(p);
        }
    }

    None
}

fn has_skill_groups(dir: &Path) -> bool {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if !is_excluded(&name_str) && !name_str.starts_with('.') {
                    // Check if any subdirectory contains SKILL.md
                    if let Ok(sub_entries) = fs::read_dir(&path) {
                        for sub in sub_entries.flatten() {
                            if sub.path().is_dir() && sub.path().join("SKILL.md").exists() {
                                return true;
                            }
                        }
                    }
                }
            }
        }
    }
    false
}

/// Check if a directory name is in the exclude list
pub fn is_excluded(name: &str) -> bool {
    EXCLUDE_DIRS.contains(&name)
}

/// Get all skill group names from the source directory
pub fn skill_groups(source_dir: &Path) -> Vec<String> {
    let mut groups = Vec::new();
    if let Ok(entries) = fs::read_dir(source_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name();
            let name_str = name.to_string_lossy().to_string();
            if is_excluded(&name_str) || name_str.starts_with('.') {
                continue;
            }
            // Verify at least one skill exists
            if skills_in_group(source_dir, &name_str)
                .first()
                .is_some()
            {
                groups.push(name_str);
            }
        }
    }
    groups.sort();
    groups
}

/// Get all skill names in a group
pub fn skills_in_group(source_dir: &Path, group: &str) -> Vec<String> {
    let group_dir = source_dir.join(group);
    let mut skills = Vec::new();
    if let Ok(entries) = fs::read_dir(&group_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && path.join("SKILL.md").exists() {
                if let Some(name) = entry.file_name().to_str() {
                    skills.push(name.to_string());
                }
            }
        }
    }
    skills.sort();
    skills
}

/// Skill target directories
pub fn local_skill_target() -> PathBuf {
    PathBuf::from(".claude/skills")
}

pub fn global_skill_target() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("~"))
        .join(".claude/skills")
}

/// Persona paths
pub fn persona_library(source_dir: &Path) -> PathBuf {
    source_dir.join("personas")
}

pub fn local_persona_target() -> PathBuf {
    PathBuf::from(".agents/personas")
}

pub fn global_persona_target() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("~"))
        .join(".agents/personas")
}
