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

/// Find agt source directory.
/// Priority: env var (cheapest) > walk up from exe > home dir fallbacks
pub fn find_source_dir() -> Option<PathBuf> {
    // 1. Cheapest check: env var
    if let Ok(env_dir) = std::env::var("AGT_DIR").or_else(|_| std::env::var("AGENT_SKILLS_DIR")) {
        let p = PathBuf::from(env_dir);
        if p.is_dir() {
            return Some(p);
        }
    }

    // 2. Walk up from executable following symlinks
    if let Ok(exe) = std::env::current_exe() {
        let resolved = fs::canonicalize(&exe).unwrap_or(exe);
        let mut dir = resolved.parent();
        for _ in 0..5 {
            match dir {
                Some(d) => {
                    if has_skill_groups(d) {
                        return Some(d.to_path_buf());
                    }
                    dir = d.parent();
                }
                None => break,
            }
        }
    }

    // 3. Fallback: check common install locations
    if let Some(home) = dirs::home_dir() {
        for candidate in &[".agt", "agt", ".agent-skills"] {
            let p = home.join(candidate);
            if has_skill_groups(&p) {
                return Some(p);
            }
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
            if !skills_in_group(source_dir, &name_str).is_empty() {
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

/// Find the git repository root by walking up from cwd
fn git_root() -> Option<PathBuf> {
    let mut dir = std::env::current_dir().ok()?;
    loop {
        if dir.join(".git").exists() {
            return Some(dir);
        }
        if !dir.pop() {
            return None;
        }
    }
}

/// Skill target directories
pub fn local_skill_target() -> PathBuf {
    git_root()
        .map(|r| r.join(".claude/skills"))
        .unwrap_or_else(|| PathBuf::from(".claude/skills"))
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
    git_root()
        .map(|r| r.join(".agents/personas"))
        .unwrap_or_else(|| PathBuf::from(".agents/personas"))
}

pub fn global_persona_target() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("~"))
        .join(".agents/personas")
}
