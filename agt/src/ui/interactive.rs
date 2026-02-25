use crate::config;
use anyhow::{bail, Context, Result};
use dialoguer::{theme::ColorfulTheme, Confirm, Input, MultiSelect, Select};
use std::path::Path;

pub enum InteractiveSelection {
    Profile(String),
    Skills(Vec<(String, String)>),
    Remote(String),
    CloneAndInstall,
    Cancelled,
}

pub fn run_interactive_selector(
    source_dir: &Path,
    local_installed: &[String],
    global_installed: &[String],
) -> Result<InteractiveSelection> {
    run_interactive_selector_inner(source_dir, local_installed, global_installed, false)
}

/// Interactive selector for remote repos — skips builtin profiles.
pub fn run_interactive_selector_remote(
    source_dir: &Path,
    local_installed: &[String],
    global_installed: &[String],
) -> Result<InteractiveSelection> {
    run_interactive_selector_inner(source_dir, local_installed, global_installed, true)
}

fn run_interactive_selector_inner(
    source_dir: &Path,
    local_installed: &[String],
    global_installed: &[String],
    remote: bool,
) -> Result<InteractiveSelection> {
    let theme = ColorfulTheme::default();

    let modes: &[&str] = if remote {
        &[
            "Install a profile (curated set)",
            "Browse by group",
        ]
    } else {
        &[
            "Install a profile (curated set)",
            "Browse by group",
            "Install from remote (owner/repo/path)",
        ]
    };
    let mode = Select::with_theme(&theme)
        .with_prompt("How would you like to install skills?")
        .items(modes)
        .default(0)
        .interact_opt()
        .context("Failed to render mode selection")?;

    match mode {
        None => Ok(InteractiveSelection::Cancelled),
        Some(0) => select_profile(source_dir, &theme, remote),
        Some(1) => browse_by_group(source_dir, local_installed, global_installed, &theme),
        Some(2) if !remote => prompt_remote(&theme),
        _ => unreachable!(),
    }
}

fn select_profile(source_dir: &Path, theme: &ColorfulTheme, remote: bool) -> Result<InteractiveSelection> {
    let profiles = if remote {
        config::list_profiles_remote(source_dir)
    } else {
        config::list_profiles(source_dir)
    };
    if profiles.is_empty() {
        bail!("No profiles available");
    }

    let items: Vec<String> = profiles
        .iter()
        .map(|(name, desc, count)| format!("{:14} {} ({} skills)", name, desc, count))
        .collect();

    let selection = Select::with_theme(theme)
        .with_prompt("Select a profile")
        .items(&items)
        .default(0)
        .interact_opt()
        .context("Failed to render profile selection")?;

    match selection {
        None => Ok(InteractiveSelection::Cancelled),
        Some(idx) => Ok(InteractiveSelection::Profile(profiles[idx].0.clone())),
    }
}

fn browse_by_group(
    source_dir: &Path,
    local_installed: &[String],
    global_installed: &[String],
    theme: &ColorfulTheme,
) -> Result<InteractiveSelection> {
    let groups = config::skill_groups(source_dir);
    if groups.is_empty() {
        bail!("No skill groups found");
    }

    // Build group display with counts
    let group_items: Vec<String> = groups
        .iter()
        .map(|g| {
            let skills = config::skills_in_group(source_dir, g);
            let installed: usize = skills
                .iter()
                .filter(|s| local_installed.contains(s) || global_installed.contains(s))
                .count();
            format!("{:20} ({}/{} installed)", g, installed, skills.len())
        })
        .collect();

    let group_idx = Select::with_theme(theme)
        .with_prompt("Select a group")
        .items(&group_items)
        .default(0)
        .interact_opt()
        .context("Failed to render group selection")?;

    let group_idx = match group_idx {
        None => return Ok(InteractiveSelection::Cancelled),
        Some(idx) => idx,
    };

    let group = &groups[group_idx];
    let skills = config::skills_in_group(source_dir, group);

    if skills.is_empty() {
        bail!("No skills in group '{}'", group);
    }

    // Build skill display with status and description
    let items: Vec<String> = skills
        .iter()
        .map(|name| {
            let tag = if local_installed.contains(name) {
                "[L]"
            } else if global_installed.contains(name) {
                "[G]"
            } else {
                "[ ]"
            };
            let desc = read_skill_description(&source_dir.join(group).join(name));
            if desc.is_empty() {
                format!("{} {}", tag, name)
            } else {
                format!("{} {} - {}", tag, name, desc)
            }
        })
        .collect();

    let defaults: Vec<bool> = skills.iter().map(|_| false).collect();

    let selections = MultiSelect::with_theme(theme)
        .with_prompt(format!("{}/  (Space to toggle, Enter to confirm)", group))
        .items(&items)
        .defaults(&defaults)
        .interact_opt()
        .context("Failed to render skill selection")?;

    match selections {
        None => Ok(InteractiveSelection::Cancelled),
        Some(indices) if indices.is_empty() => Ok(InteractiveSelection::Cancelled),
        Some(indices) => {
            let selected: Vec<(String, String)> = indices
                .into_iter()
                .map(|i| (group.clone(), skills[i].clone()))
                .collect();
            Ok(InteractiveSelection::Skills(selected))
        }
    }
}

pub fn run_no_source_selector() -> Result<InteractiveSelection> {
    let theme = ColorfulTheme::default();

    eprintln!("No skills source found. To get all skills:");
    eprintln!("  git clone https://github.com/jiunbae/agent-skills ~/.agent-skills\n");

    let modes = &[
        "Clone jiunbae/agent-skills and install a profile",
        "Install from remote (owner/repo/path)",
    ];
    let mode = Select::with_theme(&theme)
        .with_prompt("How would you like to install skills?")
        .items(modes)
        .default(0)
        .interact_opt()
        .context("Failed to render mode selection")?;

    match mode {
        None => Ok(InteractiveSelection::Cancelled),
        Some(0) => Ok(InteractiveSelection::CloneAndInstall),
        Some(1) => prompt_remote(&theme),
        _ => unreachable!(),
    }
}

fn prompt_remote(theme: &ColorfulTheme) -> Result<InteractiveSelection> {
    eprintln!("  e.g. jiunbae/agent-skills/agents/background-reviewer");
    let spec: String = Input::with_theme(theme)
        .with_prompt("Remote spec (owner/repo/path[@ref])")
        .interact_text()
        .context("Failed to read remote spec")?;

    let spec = spec.trim().to_string();
    if spec.is_empty() {
        return Ok(InteractiveSelection::Cancelled);
    }
    Ok(InteractiveSelection::Remote(spec))
}

pub fn confirm_install(skills: &[(String, String)], global: bool) -> Result<bool> {
    let scope = if global { "global" } else { "local" };
    eprintln!(
        "\nThe following {} skills will be installed ({}):",
        skills.len(),
        scope
    );
    for (group, skill) in skills {
        eprintln!("  {}/{}", group, skill);
    }
    eprintln!();

    Confirm::with_theme(&ColorfulTheme::default())
        .with_prompt("Proceed with installation?")
        .default(true)
        .interact()
        .context("Failed to render confirmation")
}

/// Interactive persona selector for repo-level install.
/// Returns selected persona names, or None if cancelled.
pub fn select_personas(
    personas: &[(String, String)], // (name, role)
    installed: &[String],
    global: bool,
) -> Result<Option<Vec<String>>> {
    let theme = ColorfulTheme::default();

    let scope = if global { "global" } else { "local" };
    let items: Vec<String> = personas
        .iter()
        .map(|(name, role)| {
            let tag = if installed.contains(name) {
                "[*]"
            } else {
                "[ ]"
            };
            if role.is_empty() {
                format!("{} {}", tag, name)
            } else {
                format!("{} {} - {}", tag, name, role)
            }
        })
        .collect();

    let defaults: Vec<bool> = personas
        .iter()
        .map(|(name, _)| !installed.contains(name))
        .collect();

    let selections = MultiSelect::with_theme(&theme)
        .with_prompt(format!(
            "Select personas to install ({}) (Space to toggle, Enter to confirm)",
            scope
        ))
        .items(&items)
        .defaults(&defaults)
        .interact_opt()
        .context("Failed to render persona selection")?;

    match selections {
        None => Ok(None),
        Some(indices) if indices.is_empty() => Ok(None),
        Some(indices) => {
            let names: Vec<String> = indices
                .into_iter()
                .map(|i| personas[i].0.clone())
                .collect();

            // Confirm
            eprintln!("\nThe following {} personas will be installed ({}):", names.len(), scope);
            for name in &names {
                eprintln!("  {}", name);
            }
            eprintln!();

            let confirmed = Confirm::with_theme(&theme)
                .with_prompt("Proceed with installation?")
                .default(true)
                .interact()
                .context("Failed to render confirmation")?;

            if confirmed {
                Ok(Some(names))
            } else {
                Ok(None)
            }
        }
    }
}

fn read_skill_description(path: &Path) -> String {
    let skill_md = path.join("SKILL.md");
    if let Ok(content) = std::fs::read_to_string(skill_md) {
        if let Some(desc) = crate::frontmatter::get_field(&content, "description") {
            return desc;
        }
    }
    String::new()
}
