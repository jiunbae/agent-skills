use crate::{config, frontmatter, remote, ui, util};
use anyhow::{bail, Context, Result};
use clap::Subcommand;
use colored::Colorize;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};

#[derive(Subcommand)]
pub enum SkillAction {
    /// Install a skill (local symlink or remote)
    Install {
        /// Skill name (from source library)
        name: Option<String>,
        /// Install globally (~/.claude/skills)
        #[arg(short, long)]
        global: bool,
        /// Force overwrite existing
        #[arg(short, long)]
        force: bool,
        /// Remote spec: owner/repo/path[@ref]
        #[arg(long, value_name = "SPEC")]
        from: Option<String>,
    },
    /// Uninstall a skill
    Uninstall {
        /// Skill name
        name: String,
        /// Remove from global scope
        #[arg(short, long)]
        global: bool,
    },
    /// List available and installed skills
    List {
        /// Show only installed skills
        #[arg(long)]
        installed: bool,
        /// Show only local project skills
        #[arg(long)]
        local: bool,
        /// Show only global skills
        #[arg(long)]
        global: bool,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
    /// Initialize skill directory in current project
    Init,
    /// Show the path of a skill
    Which {
        /// Skill name
        name: String,
    },
}

pub fn execute(action: SkillAction) -> Result<()> {
    match action {
        SkillAction::Install {
            name,
            global,
            force,
            from,
        } => install(name, global, force, from),
        SkillAction::Uninstall { name, global } => uninstall(&name, global),
        SkillAction::List {
            installed,
            local,
            global,
            json,
        } => list(installed, local, global, json),
        SkillAction::Init => init(),
        SkillAction::Which { name } => which(&name),
    }
}

fn install(
    name: Option<String>,
    global: bool,
    force: bool,
    from: Option<String>,
) -> Result<()> {
    if let Some(spec_str) = from {
        return install_remote(&spec_str, global, force);
    }

    let name = name.context("Skill name required (or use --from for remote install)")?;
    util::validate_name(&name)?;

    let source_dir = config::find_source_dir()
        .context("Cannot find agent-skills source directory")?;

    // Find skill in source
    let skill_path = find_skill_in_source(&source_dir, &name)
        .context(format!("Skill '{}' not found in source library", name))?;

    let target_dir = if global {
        config::global_skill_target()
    } else {
        config::local_skill_target()
    };

    fs::create_dir_all(&target_dir)?;
    let link_path = target_dir.join(&name);

    util::ensure_target_clear(&link_path, force, &name)?;

    symlink(&skill_path, &link_path).context(format!(
        "Failed to create symlink: {} -> {}",
        link_path.display(),
        skill_path.display()
    ))?;

    let scope = if global { "global" } else { "local" };
    ui::success(&format!("Installed skill '{}' ({})", name, scope));
    Ok(())
}

fn install_remote(spec_str: &str, global: bool, force: bool) -> Result<()> {
    let spec = remote::parse_spec(spec_str)?;
    ui::info(&format!("Downloading {}...", spec));

    let (_tmp_dir, source_path) = remote::fetch_dir(&spec)?;

    // Verify it's a skill (has SKILL.md)
    if !source_path.join("SKILL.md").exists() {
        bail!("Remote path does not contain SKILL.md: {}", spec);
    }

    let skill_name = source_path
        .file_name()
        .context("Invalid remote path")?
        .to_string_lossy()
        .to_string();
    util::validate_name(&skill_name)?;

    let target_dir = if global {
        config::global_skill_target()
    } else {
        config::local_skill_target()
    };

    fs::create_dir_all(&target_dir)?;
    let dest = target_dir.join(&skill_name);

    util::ensure_target_clear(&dest, force, &skill_name)?;

    util::copy_dir_recursive(&source_path, &dest)?;
    remote::write_metadata(&dest, &spec)?;

    let scope = if global { "global" } else { "local" };
    ui::success(&format!(
        "Installed remote skill '{}' ({}) from {}",
        skill_name, scope, spec
    ));
    Ok(())
}

fn uninstall(name: &str, global: bool) -> Result<()> {
    util::validate_name(name)?;

    let target_dir = if global {
        config::global_skill_target()
    } else {
        config::local_skill_target()
    };

    let skill_path = target_dir.join(name);

    if !skill_path.exists() && !skill_path.is_symlink() {
        bail!("Skill '{}' is not installed", name);
    }

    if skill_path.is_symlink() {
        fs::remove_file(&skill_path)?;
    } else {
        fs::remove_dir_all(&skill_path)?;
    }

    let scope = if global { "global" } else { "local" };
    ui::success(&format!("Uninstalled skill '{}' ({})", name, scope));
    Ok(())
}

fn list(installed: bool, local: bool, global: bool, json: bool) -> Result<()> {
    // Build installed skill sets for status lookup
    let local_dir = config::local_skill_target();
    let global_dir = config::global_skill_target();
    let local_installed = installed_skill_names(&local_dir);
    let global_installed = installed_skill_names(&global_dir);

    let mut entries: Vec<serde_json::Value> = Vec::new();

    // If only showing installed
    if installed || local || global {
        if installed || local {
            list_skills_in_dir(&local_dir, "local", &mut entries)?;
        }
        if installed || global {
            list_skills_in_dir(&global_dir, "global", &mut entries)?;
        }

        if json {
            println!("{}", serde_json::to_string_pretty(&entries)?);
            return Ok(());
        }
        if entries.is_empty() {
            ui::info("No installed skills found.");
            return Ok(());
        }
        print_flat(&entries);
        return Ok(());
    }

    // Default: grouped view showing all skills with install status
    if let Some(source_dir) = config::find_source_dir() {
        let skill_groups = config::skill_groups(&source_dir);
        let mut total = 0usize;
        let mut total_installed = 0usize;

        if json {
            // JSON mode: collect all entries
            for group in &skill_groups {
                let skills = config::skills_in_group(&source_dir, group);
                for skill_name in &skills {
                    let skill_path = source_dir.join(group).join(skill_name);
                    let desc = read_skill_description(&skill_path);
                    let status = if local_installed.contains(&skill_name.to_string()) {
                        "local"
                    } else if global_installed.contains(&skill_name.to_string()) {
                        "global"
                    } else {
                        "available"
                    };
                    entries.push(serde_json::json!({
                        "name": skill_name,
                        "group": group,
                        "status": status,
                        "description": desc,
                    }));
                }
            }
            println!("{}", serde_json::to_string_pretty(&entries)?);
            return Ok(());
        }

        // Grouped display matching agent-skill format
        println!(
            "{}  ({}=local {}=global {}=not installed)",
            "Available skills".cyan(),
            "L".green(),
            "G".blue(),
            "○".dimmed()
        );
        println!("{}", "=".repeat(40));

        for group in &skill_groups {
            let skills = config::skills_in_group(&source_dir, group);
            let group_installed: usize = skills
                .iter()
                .filter(|s| local_installed.contains(*s) || global_installed.contains(*s))
                .count();

            total += skills.len();
            total_installed += group_installed;

            println!(
                "\n{} ({}/{})",
                format!("{}/", group).yellow().bold(),
                group_installed,
                skills.len()
            );

            for skill_name in &skills {
                let status = if local_installed.contains(skill_name) {
                    format!("{}", "L".green())
                } else if global_installed.contains(skill_name) {
                    format!("{}", "G".blue())
                } else {
                    format!("{}", "○".dimmed())
                };
                println!("  {} {:28}", status, skill_name);
            }
        }

        println!(
            "\n{}: total {} / installed {}",
            "Summary".cyan(),
            total,
            total_installed
        );
    } else {
        // No source dir — show installed only
        list_skills_in_dir(&local_dir, "local", &mut entries)?;
        list_skills_in_dir(&global_dir, "global", &mut entries)?;

        if json {
            println!("{}", serde_json::to_string_pretty(&entries)?);
            return Ok(());
        }
        if entries.is_empty() {
            ui::info("No skills found.");
            return Ok(());
        }
        print_flat(&entries);
    }

    Ok(())
}

fn init() -> Result<()> {
    let dir = config::local_skill_target();
    if dir.exists() {
        ui::info(&format!("Skill directory already exists: {}", dir.display()));
        return Ok(());
    }
    fs::create_dir_all(&dir)?;
    ui::success(&format!("Created skill directory: {}", dir.display()));
    Ok(())
}

fn which(name: &str) -> Result<()> {
    // Check local
    let local = config::local_skill_target().join(name);
    if local.exists() {
        let resolved = fs::canonicalize(&local).unwrap_or(local);
        println!("{}", resolved.display());
        return Ok(());
    }

    // Check global
    let global = config::global_skill_target().join(name);
    if global.exists() {
        let resolved = fs::canonicalize(&global).unwrap_or(global);
        println!("{}", resolved.display());
        return Ok(());
    }

    // Check source library
    if let Some(source_dir) = config::find_source_dir() {
        if let Some(path) = find_skill_in_source(&source_dir, name) {
            println!("{}", path.display());
            return Ok(());
        }
    }

    bail!("Skill '{}' not found", name);
}

// --- Helpers ---

fn find_skill_in_source(source_dir: &Path, name: &str) -> Option<PathBuf> {
    for group in config::skill_groups(source_dir) {
        let path = source_dir.join(&group).join(name);
        if path.is_dir() && path.join("SKILL.md").exists() {
            return Some(path);
        }
    }
    None
}

fn installed_skill_names(dir: &Path) -> Vec<String> {
    let mut names = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with('.') {
                names.push(name);
            }
        }
    }
    names
}

fn list_skills_in_dir(
    dir: &Path,
    scope: &str,
    entries: &mut Vec<serde_json::Value>,
) -> Result<()> {
    if let Ok(read) = fs::read_dir(dir) {
        for entry in read.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }

            let desc = read_skill_description(&path);
            let is_remote = path.join(".remote-source").exists();
            let is_symlink = path.is_symlink();

            entries.push(serde_json::json!({
                "name": name,
                "scope": scope,
                "description": desc,
                "remote": is_remote,
                "symlink": is_symlink,
            }));
        }
    }
    Ok(())
}

fn read_skill_description(path: &Path) -> String {
    let skill_md = path.join("SKILL.md");
    if let Ok(content) = fs::read_to_string(skill_md) {
        if let Some(desc) = frontmatter::get_field(&content, "description") {
            return desc;
        }
    }
    String::new()
}

fn print_flat(entries: &[serde_json::Value]) {
    for entry in entries {
        let name = entry["name"].as_str().unwrap_or("");
        let scope = entry["scope"].as_str().unwrap_or("");
        let desc = entry["description"].as_str().unwrap_or("");

        if desc.is_empty() {
            println!("{:30} [{}]", name, scope);
        } else {
            println!("{:30} [{}] {}", name, scope, desc);
        }
    }
}
