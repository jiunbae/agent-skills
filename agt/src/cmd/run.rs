use crate::{config, frontmatter, llm, ui};
use anyhow::{Context, Result};
use std::fs;
use std::path::Path;

/// Execute a prompt, optionally using a specific skill
pub fn execute(prompt: &str, skill: Option<&str>) -> Result<()> {
    if prompt.trim().is_empty() {
        ui::error("No prompt provided.");
        std::process::exit(1);
    }

    // Find the skill to use
    let skill_content = if let Some(skill_name) = skill {
        Some(load_skill(skill_name)?)
    } else {
        auto_match_skill(prompt)
    };

    // Detect LLM
    let cli = llm::detect().context(
        "No LLM CLI found. Install codex, claude, gemini, or ollama.",
    )?;

    // Build final prompt
    let full_prompt = if let Some(ref skill_text) = skill_content {
        format!(
            "{}\n\n---\n\nUser request:\n{}",
            skill_text, prompt
        )
    } else {
        prompt.to_string()
    };

    ui::info(&format!("Running with {}...", cli));

    let opts = llm::InvokeOpts { output_file: None };
    let result = llm::invoke(cli, &full_prompt, &opts)?;

    println!("{}", result);
    Ok(())
}

fn load_skill(name: &str) -> Result<String> {
    // Search local -> global -> library
    let local = config::local_skill_target().join(name);
    let global = config::global_skill_target().join(name);

    let skill_dir = if local.exists() {
        local
    } else if global.exists() {
        global
    } else if let Some(source_dir) = config::find_source_dir() {
        find_skill_in_source(&source_dir, name)
            .context(format!("Skill '{}' not found", name))?
    } else {
        anyhow::bail!("Skill '{}' not found", name);
    };

    let skill_md = skill_dir.join("SKILL.md");
    fs::read_to_string(&skill_md)
        .context(format!("Failed to read {}", skill_md.display()))
}

fn auto_match_skill(prompt: &str) -> Option<String> {
    let prompt_lower = prompt.to_lowercase();

    // Check local skills first, then global
    let dirs = [
        config::local_skill_target(),
        config::global_skill_target(),
    ];

    for dir in &dirs {
        if let Some(content) = match_skills_in_dir(dir, &prompt_lower) {
            return Some(content);
        }
    }

    // Check library
    if let Some(source_dir) = config::find_source_dir() {
        for group in config::skill_groups(&source_dir) {
            let group_dir = source_dir.join(&group);
            if let Some(content) = match_skills_in_dir(&group_dir, &prompt_lower) {
                return Some(content);
            }
        }
    }

    None
}

fn match_skills_in_dir(dir: &Path, prompt_lower: &str) -> Option<String> {
    let entries = fs::read_dir(dir).ok()?;
    let mut best_match: Option<(u32, String)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let skill_md = path.join("SKILL.md");
        if !skill_md.exists() {
            continue;
        }

        let content = fs::read_to_string(&skill_md).ok()?;
        let (fm, _) = frontmatter::parse(&content).ok()?;

        // Score based on trigger keywords
        let mut score = 0u32;
        if let Some(keywords) = &fm.trigger_keywords {
            for kw in keywords {
                if prompt_lower.contains(&kw.to_lowercase()) {
                    score += 10;
                }
            }
        }

        // Score based on name match
        let name = entry.file_name().to_string_lossy().to_string();
        if prompt_lower.contains(&name.to_lowercase()) {
            score += 5;
        }

        // Score based on tags
        if let Some(tags) = &fm.tags {
            for tag in tags {
                if prompt_lower.contains(&tag.to_lowercase()) {
                    score += 2;
                }
            }
        }

        if score > 0 {
            if best_match.as_ref().is_none_or(|(s, _)| score > *s) {
                best_match = Some((score, content));
            }
        }
    }

    best_match.map(|(_, content)| content)
}

fn find_skill_in_source(source_dir: &Path, name: &str) -> Option<std::path::PathBuf> {
    for group in config::skill_groups(source_dir) {
        let path = source_dir.join(&group).join(name);
        if path.is_dir() && path.join("SKILL.md").exists() {
            return Some(path);
        }
    }
    None
}
