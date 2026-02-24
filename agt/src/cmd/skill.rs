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
        /// Install a named profile (core, dev, all, etc.)
        #[arg(short, long, value_name = "NAME")]
        profile: Option<String>,
        /// Install all available skills
        #[arg(short, long)]
        all: bool,
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
        /// Show available installation profiles
        #[arg(long)]
        profiles: bool,
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
            profile,
            all,
            from,
        } => install(name, global, force, profile, all, from),
        SkillAction::Uninstall { name, global } => uninstall(&name, global),
        SkillAction::List {
            installed,
            local,
            global,
            profiles,
            json,
        } => list(installed, local, global, profiles, json),
        SkillAction::Init => init(),
        SkillAction::Which { name } => which(&name),
    }
}

fn install(
    name: Option<String>,
    global: bool,
    force: bool,
    profile: Option<String>,
    all: bool,
    from: Option<String>,
) -> Result<()> {
    if let Some(spec_str) = from {
        if profile.is_some() || all {
            bail!("--from cannot be combined with --profile or --all");
        }
        return install_remote(&spec_str, global, force);
    }

    // Profile / all install
    let profile_name = if all {
        if profile.is_some() {
            bail!("--all and --profile cannot be used together");
        }
        Some("all".to_string())
    } else {
        profile
    };

    if let Some(prof_name) = profile_name {
        if name.is_some() {
            bail!("Cannot specify both a skill name and --profile/--all");
        }
        return install_profile(&prof_name, global, force);
    }

    let name = match name {
        Some(n) => n,
        None => {
            if !console::Term::stderr().is_term() {
                bail!("Skill name required (or use --profile, --all, --from)");
            }
            return interactive_install(global, force);
        }
    };
    util::validate_name(&name)?;

    let source_dir = config::find_source_dir()
        .context(config::source_dir_hint())?;

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

    // Repo-level: owner/repo with no path — browse all skills
    if spec.path.is_empty() {
        return install_remote_repo(&spec, global, force);
    }

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

fn install_remote_repo(spec: &remote::RemoteSpec, global: bool, force: bool) -> Result<()> {
    ui::info(&format!("Downloading {}/{}@{}...", spec.owner, spec.repo, spec.git_ref));
    let (_tmp_dir, repo_root) = remote::fetch_dir(spec)?;

    // Discover skills in the repo (directories containing SKILL.md)
    let groups = config::skill_groups(&repo_root);
    let mut all_skills: Vec<(String, String)> = Vec::new();
    for group in &groups {
        for skill_name in config::skills_in_group(&repo_root, group) {
            all_skills.push((group.clone(), skill_name));
        }
    }

    // Also check for personas
    let persona_dir = repo_root.join("personas");
    let has_personas = persona_dir.is_dir()
        && fs::read_dir(&persona_dir)
            .map(|rd| rd.flatten().any(|e| !e.file_name().to_string_lossy().starts_with('.')))
            .unwrap_or(false);

    if all_skills.is_empty() {
        bail!("No skills found in {}/{}", spec.owner, spec.repo);
    }

    ui::info(&format!(
        "Found {} skills in {} groups{}",
        all_skills.len(),
        groups.len(),
        if has_personas { " (+ personas)" } else { "" }
    ));

    // Interactive mode if TTY
    let is_tty = console::Term::stderr().is_term();

    let target_dir = if global {
        config::global_skill_target()
    } else {
        config::local_skill_target()
    };
    fs::create_dir_all(&target_dir)?;

    let scope = if global { "global" } else { "local" };
    let skills_to_install = if is_tty {
        let local_installed = installed_skill_names(&config::local_skill_target());
        let global_installed = installed_skill_names(&config::global_skill_target());

        let selection = ui::interactive::run_interactive_selector(
            &repo_root, &local_installed, &global_installed,
        )?;

        match selection {
            ui::interactive::InteractiveSelection::Profile(prof_name) => {
                let resolved = config::resolve_profile(&prof_name, &repo_root)?;
                if !ui::interactive::confirm_install(&resolved.skills, global)? {
                    ui::info("Installation cancelled.");
                    return Ok(());
                }
                resolved.skills
            }
            ui::interactive::InteractiveSelection::Skills(skills) => {
                if !ui::interactive::confirm_install(&skills, global)? {
                    ui::info("Installation cancelled.");
                    return Ok(());
                }
                skills
            }
            _ => {
                ui::info("Installation cancelled.");
                return Ok(());
            }
        }
    } else {
        // Non-interactive: install all
        all_skills
    };

    let mut installed = 0;
    let mut skipped = 0;

    for (group, skill_name) in &skills_to_install {
        let source_path = repo_root.join(group).join(skill_name);
        if !source_path.is_dir() || !source_path.join("SKILL.md").exists() {
            skipped += 1;
            continue;
        }

        let dest = target_dir.join(skill_name);
        if dest.exists() || dest.is_symlink() {
            if force {
                if dest.is_symlink() || dest.is_file() {
                    fs::remove_file(&dest)?;
                } else {
                    fs::remove_dir_all(&dest)?;
                }
            } else {
                skipped += 1;
                continue;
            }
        }

        util::copy_dir_recursive(&source_path, &dest)?;
        let skill_spec = remote::RemoteSpec {
            owner: spec.owner.clone(),
            repo: spec.repo.clone(),
            path: format!("{}/{}", group, skill_name),
            git_ref: spec.git_ref.clone(),
        };
        remote::write_metadata(&dest, &skill_spec)?;
        ui::success(&format!("Installed skill '{}' ({})", skill_name, scope));
        installed += 1;
    }

    ui::success(&format!(
        "Done: {} installed, {} skipped from {}/{}",
        installed, skipped, spec.owner, spec.repo
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

fn install_profile(profile_name: &str, global: bool, force: bool) -> Result<()> {
    let source_dir = config::find_source_dir().context(config::source_dir_hint())?;
    let resolved = config::resolve_profile(profile_name, &source_dir)?;

    let target_dir = if global {
        config::global_skill_target()
    } else {
        config::local_skill_target()
    };
    fs::create_dir_all(&target_dir)?;

    let scope = if global { "global" } else { "local" };
    ui::info(&format!(
        "Installing profile '{}': {} skills ({})",
        resolved.name,
        resolved.skills.len(),
        scope
    ));

    let mut installed = 0;
    let mut skipped = 0;

    for (group, skill_name) in &resolved.skills {
        let skill_path = source_dir.join(group).join(skill_name);
        if !skill_path.is_dir() || !skill_path.join("SKILL.md").exists() {
            ui::warn(&format!("Skill '{}/{}' not found, skipping", group, skill_name));
            skipped += 1;
            continue;
        }

        let link_path = target_dir.join(skill_name);

        if link_path.exists() || link_path.is_symlink() {
            if force {
                if link_path.is_symlink() || link_path.is_file() {
                    fs::remove_file(&link_path)?;
                } else {
                    fs::remove_dir_all(&link_path)?;
                }
            } else {
                skipped += 1;
                continue;
            }
        }

        symlink(&skill_path, &link_path).context(format!(
            "Failed to create symlink for '{}'",
            skill_name
        ))?;
        installed += 1;
    }

    ui::success(&format!(
        "Profile '{}': {} installed, {} skipped",
        resolved.name, installed, skipped
    ));
    Ok(())
}

fn interactive_install(global: bool, force: bool) -> Result<()> {
    let source_dir = config::find_source_dir();
    let local_installed = installed_skill_names(&config::local_skill_target());
    let global_installed = installed_skill_names(&config::global_skill_target());

    let selection = if let Some(ref sd) = source_dir {
        ui::interactive::run_interactive_selector(sd, &local_installed, &global_installed)?
    } else {
        ui::interactive::run_no_source_selector()?
    };

    match selection {
        ui::interactive::InteractiveSelection::Profile(prof_name) => {
            let sd = source_dir.context(config::source_dir_hint())?;
            let resolved = config::resolve_profile(&prof_name, &sd)?;
            if !ui::interactive::confirm_install(&resolved.skills, global)? {
                ui::info("Installation cancelled.");
                return Ok(());
            }
            install_profile(&prof_name, global, force)
        }
        ui::interactive::InteractiveSelection::Skills(skills) => {
            let sd = source_dir.context(config::source_dir_hint())?;
            if !ui::interactive::confirm_install(&skills, global)? {
                ui::info("Installation cancelled.");
                return Ok(());
            }
            install_selected_skills(&sd, &skills, global, force)
        }
        ui::interactive::InteractiveSelection::Remote(spec) => {
            install_remote(&spec, global, force)
        }
        ui::interactive::InteractiveSelection::CloneAndInstall => {
            clone_and_install(global, force)
        }
        ui::interactive::InteractiveSelection::Cancelled => {
            ui::info("Installation cancelled.");
            Ok(())
        }
    }
}

fn clone_and_install(global: bool, force: bool) -> Result<()> {
    let home = dirs::home_dir().context("Cannot determine home directory")?;
    let target = home.join(".agent-skills");

    if target.exists() {
        ui::info(&format!("Skills repo already exists: {}", target.display()));
    } else {
        ui::info("Cloning jiunbae/agent-skills...");
        let status = std::process::Command::new("git")
            .args(["clone", "--depth", "1", "https://github.com/jiunbae/agent-skills.git"])
            .arg(&target)
            .status()
            .context("Failed to run git clone")?;
        if !status.success() {
            bail!("git clone failed");
        }
        ui::success(&format!("Cloned to {}", target.display()));
    }

    // Now run interactive install with the fresh source
    ui::info("Launching interactive installer...");
    eprintln!();
    let local_installed = installed_skill_names(&config::local_skill_target());
    let global_installed = installed_skill_names(&config::global_skill_target());

    let selection =
        ui::interactive::run_interactive_selector(&target, &local_installed, &global_installed)?;

    match selection {
        ui::interactive::InteractiveSelection::Profile(prof_name) => {
            let resolved = config::resolve_profile(&prof_name, &target)?;
            if !ui::interactive::confirm_install(&resolved.skills, global)? {
                ui::info("Installation cancelled.");
                return Ok(());
            }
            install_profile(&prof_name, global, force)
        }
        ui::interactive::InteractiveSelection::Skills(skills) => {
            if !ui::interactive::confirm_install(&skills, global)? {
                ui::info("Installation cancelled.");
                return Ok(());
            }
            install_selected_skills(&target, &skills, global, force)
        }
        ui::interactive::InteractiveSelection::Remote(spec) => {
            install_remote(&spec, global, force)
        }
        _ => {
            ui::info("Installation cancelled.");
            Ok(())
        }
    }
}

fn install_selected_skills(
    source_dir: &Path,
    skills: &[(String, String)],
    global: bool,
    force: bool,
) -> Result<()> {
    let target_dir = if global {
        config::global_skill_target()
    } else {
        config::local_skill_target()
    };
    fs::create_dir_all(&target_dir)?;

    let scope = if global { "global" } else { "local" };
    let mut installed = 0;
    let mut skipped = 0;

    for (group, skill_name) in skills {
        let skill_path = source_dir.join(group).join(skill_name);
        if !skill_path.is_dir() || !skill_path.join("SKILL.md").exists() {
            ui::warn(&format!("Skill '{}/{}' not found, skipping", group, skill_name));
            skipped += 1;
            continue;
        }

        let link_path = target_dir.join(skill_name);

        if link_path.exists() || link_path.is_symlink() {
            if force {
                if link_path.is_symlink() || link_path.is_file() {
                    fs::remove_file(&link_path)?;
                } else {
                    fs::remove_dir_all(&link_path)?;
                }
            } else {
                skipped += 1;
                continue;
            }
        }

        symlink(&skill_path, &link_path).context(format!(
            "Failed to create symlink for '{}'",
            skill_name
        ))?;
        ui::success(&format!("Installed skill '{}' ({})", skill_name, scope));
        installed += 1;
    }

    ui::success(&format!("Done: {} installed, {} skipped", installed, skipped));
    Ok(())
}

fn list(installed: bool, local: bool, global: bool, profiles: bool, json: bool) -> Result<()> {
    if profiles {
        return list_profiles_display(json);
    }
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
        // No source dir — infer groups from symlink targets
        list_skills_in_dir(&local_dir, "local", &mut entries)?;
        list_skills_in_dir(&global_dir, "global", &mut entries)?;

        if json {
            println!("{}", serde_json::to_string_pretty(&entries)?);
            return Ok(());
        }
        if entries.is_empty() {
            ui::info("No skills found.");
            eprintln!("\nTo see all available skills, clone the skills repo:");
            eprintln!("  git clone https://github.com/jiunbae/agent-skills ~/.agent-skills");
            return Ok(());
        }
        print_grouped_installed(&local_dir, &global_dir);
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
    util::validate_name(name)?;
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

fn list_profiles_display(json: bool) -> Result<()> {
    let source_dir = config::find_source_dir().context(config::source_dir_hint())?;
    let profiles = config::list_profiles(&source_dir);

    if json {
        let entries: Vec<serde_json::Value> = profiles
            .iter()
            .map(|(name, desc, count)| {
                serde_json::json!({
                    "name": name,
                    "description": desc,
                    "skill_count": count,
                })
            })
            .collect();
        println!("{}", serde_json::to_string_pretty(&entries)?);
        return Ok(());
    }

    println!("{}", "Installation profiles".cyan());
    println!("{}", "=".repeat(40));
    for (name, desc, count) in &profiles {
        println!(
            "  {:16} {:32} ({} skills)",
            name.green(),
            desc,
            count
        );
    }
    println!("\nUsage: agt skill install --profile <name> [-g]");
    Ok(())
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

fn print_grouped_installed(local_dir: &Path, global_dir: &Path) {
    use std::collections::BTreeMap;

    // Deduplicate: key = skill name, value = (group, scope, desc)
    // Local takes priority over global
    let mut seen: BTreeMap<String, (String, String, String)> = BTreeMap::new();

    for (dir, scope) in [(local_dir, "local"), (global_dir, "global")] {
        if let Ok(read) = fs::read_dir(dir) {
            for entry in read.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                if seen.contains_key(&name) {
                    continue; // local already registered
                }
                let path = entry.path();
                let desc = read_skill_description(&path);

                let group = if path.is_symlink() {
                    fs::read_link(&path)
                        .ok()
                        .and_then(|target| {
                            target.parent().and_then(|p| {
                                p.file_name().map(|g| g.to_string_lossy().to_string())
                            })
                        })
                        .unwrap_or_else(|| "other".to_string())
                } else {
                    "other".to_string()
                };

                seen.insert(name, (group, scope.to_string(), desc));
            }
        }
    }

    // Group by group name
    let mut groups: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();
    for (name, (group, scope, _desc)) in &seen {
        groups
            .entry(group.clone())
            .or_default()
            .push((name.clone(), scope.clone()));
    }

    println!(
        "{}  ({}=local {}=global)",
        "Installed skills".cyan(),
        "L".green(),
        "G".blue()
    );
    println!("{}", "=".repeat(40));

    let mut total = 0usize;
    for (group, skills) in &groups {
        total += skills.len();
        println!(
            "\n{} ({})",
            format!("{}/", group).yellow().bold(),
            skills.len()
        );
        for (name, scope) in skills {
            let tag = if scope == "local" {
                format!("{}", "L".green())
            } else {
                format!("{}", "G".blue())
            };
            println!("  {} {}", tag, name);
        }
    }

    println!("\n{}: {} installed", "Summary".cyan(), total);
    eprintln!("\nTo see all available skills:");
    eprintln!("  git clone https://github.com/jiunbae/agent-skills ~/.agent-skills");
    eprintln!("  agt skill install            # interactive installer");
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
