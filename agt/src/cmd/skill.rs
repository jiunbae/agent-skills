use crate::{config, frontmatter, remote, ui};
use anyhow::{bail, Context, Result};
use clap::Subcommand;
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
        /// Group by directory
        #[arg(long)]
        groups: bool,
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
            groups,
            json,
        } => list(installed, local, global, groups, json),
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

    if link_path.exists() || link_path.is_symlink() {
        if force {
            if link_path.is_dir() && !link_path.is_symlink() {
                fs::remove_dir_all(&link_path)?;
            } else {
                fs::remove_file(&link_path).or_else(|_| fs::remove_dir_all(&link_path))?;
            }
        } else {
            bail!(
                "Skill '{}' already installed at {}. Use --force to overwrite.",
                name,
                link_path.display()
            );
        }
    }

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
        .unwrap()
        .to_string_lossy()
        .to_string();

    let target_dir = if global {
        config::global_skill_target()
    } else {
        config::local_skill_target()
    };

    fs::create_dir_all(&target_dir)?;
    let dest = target_dir.join(&skill_name);

    if dest.exists() {
        if force {
            fs::remove_dir_all(&dest)?;
        } else {
            bail!(
                "Skill '{}' already installed. Use --force to overwrite.",
                skill_name
            );
        }
    }

    copy_dir_recursive(&source_path, &dest)?;
    remote::write_metadata(&dest, &spec)?;

    let scope = if global { "global" } else { "local" };
    ui::success(&format!(
        "Installed remote skill '{}' ({}) from {}",
        skill_name, scope, spec
    ));
    Ok(())
}

fn uninstall(name: &str, global: bool) -> Result<()> {
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

fn list(installed: bool, local: bool, global: bool, groups: bool, json: bool) -> Result<()> {
    let mut entries: Vec<serde_json::Value> = Vec::new();

    // Show installed skills
    if installed || local || (!groups && !global) {
        let local_dir = config::local_skill_target();
        if local_dir.is_dir() {
            list_skills_in_dir(&local_dir, "local", &mut entries)?;
        }
    }

    if installed || global || (!groups && !local) {
        let global_dir = config::global_skill_target();
        if global_dir.is_dir() {
            list_skills_in_dir(&global_dir, "global", &mut entries)?;
        }
    }

    // Show source library skills
    if groups || (!installed && !local && !global) {
        if let Some(source_dir) = config::find_source_dir() {
            let skill_groups = config::skill_groups(&source_dir);
            for group in &skill_groups {
                let skills = config::skills_in_group(&source_dir, group);
                for skill_name in &skills {
                    let skill_path = source_dir.join(group).join(skill_name);
                    let desc = read_skill_description(&skill_path);
                    entries.push(serde_json::json!({
                        "name": skill_name,
                        "group": group,
                        "scope": "library",
                        "description": desc,
                    }));
                }
            }
        }
    }

    if json {
        println!("{}", serde_json::to_string_pretty(&entries)?);
        return Ok(());
    }

    if entries.is_empty() {
        ui::info("No skills found.");
        return Ok(());
    }

    if groups {
        print_grouped(&entries);
    } else {
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

fn print_grouped(entries: &[serde_json::Value]) {
    let mut current_group = String::new();
    for entry in entries {
        let group = entry["group"].as_str().unwrap_or("");
        let scope = entry["scope"].as_str().unwrap_or("");
        let header = if !group.is_empty() {
            group.to_string()
        } else {
            format!("[{}]", scope)
        };

        if header != current_group {
            if !current_group.is_empty() {
                eprintln!();
            }
            eprintln!("{}:", header);
            current_group = header;
        }

        let name = entry["name"].as_str().unwrap_or("");
        let desc = entry["description"].as_str().unwrap_or("");
        if desc.is_empty() {
            println!("  {}", name);
        } else {
            println!("  {:30} {}", name, desc);
        }
    }
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

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)?.flatten() {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}
