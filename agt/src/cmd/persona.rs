use crate::{config, frontmatter, llm, remote, ui, util};
use anyhow::{bail, Context, Result};
use clap::Subcommand;
use colored::Colorize;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};

#[derive(Subcommand)]
pub enum PersonaAction {
    /// Install a persona
    Install {
        /// Persona name (from library)
        name: Option<String>,
        /// Install globally (~/.agents/personas)
        #[arg(short, long)]
        global: bool,
        /// Force overwrite existing
        #[arg(short, long)]
        force: bool,
        /// Remote spec: owner/repo/path[@ref]
        #[arg(long, value_name = "SPEC")]
        from: Option<String>,
    },
    /// Uninstall a persona
    Uninstall {
        /// Persona name
        name: String,
        /// Remove from global scope
        #[arg(short, long)]
        global: bool,
    },
    /// List available and installed personas
    List {
        /// Show only installed
        #[arg(long)]
        installed: bool,
        /// Show only local
        #[arg(long)]
        local: bool,
        /// Show only global
        #[arg(long)]
        global: bool,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
    /// Create a new persona
    Create {
        /// Persona name
        name: String,
        /// Generate with AI (provide a description)
        #[arg(long, value_name = "DESC")]
        ai: Option<String>,
        /// Use Codex for generation
        #[arg(long, value_name = "DESC")]
        codex: Option<String>,
        /// Use Claude for generation
        #[arg(long, value_name = "DESC")]
        claude: Option<String>,
        /// Use Gemini for generation
        #[arg(long, value_name = "DESC")]
        gemini: Option<String>,
    },
    /// Show persona details
    Show {
        /// Persona name
        name: String,
    },
    /// Show the path of a persona
    Which {
        /// Persona name
        name: String,
    },
    /// Run a persona review on current changes
    Review {
        /// Persona name
        name: String,
        /// Use Codex
        #[arg(long)]
        codex: bool,
        /// Use Claude
        #[arg(long)]
        claude: bool,
        /// Use Gemini
        #[arg(long)]
        gemini: bool,
        /// Review staged changes only
        #[arg(long)]
        staged: bool,
        /// Base branch for diff
        #[arg(long)]
        base: Option<String>,
        /// Output file
        #[arg(short, long)]
        output: Option<String>,
    },
}

pub fn execute(action: PersonaAction) -> Result<()> {
    match action {
        PersonaAction::Install {
            name,
            global,
            force,
            from,
        } => install(name, global, force, from),
        PersonaAction::Uninstall { name, global } => uninstall(&name, global),
        PersonaAction::List {
            installed,
            local,
            global,
            json,
        } => list(installed, local, global, json),
        PersonaAction::Create {
            name,
            ai,
            codex,
            claude,
            gemini,
        } => create(&name, ai, codex, claude, gemini),
        PersonaAction::Show { name } => show(&name),
        PersonaAction::Which { name } => which(&name),
        PersonaAction::Review {
            name,
            codex,
            claude,
            gemini,
            staged,
            base,
            output,
        } => review(&name, codex, claude, gemini, staged, base, output),
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

    let name = name.context("Persona name required (or use --from for remote install)")?;
    util::validate_name(&name)?;

    let source_dir = config::find_source_dir()
        .context("Cannot find agent-skills source directory")?;

    let persona_lib = config::persona_library(&source_dir);
    let persona_path = persona_lib.join(&name);

    if !persona_path.is_dir() {
        bail!("Persona '{}' not found in library: {}", name, persona_lib.display());
    }

    let target_dir = if global {
        config::global_persona_target()
    } else {
        config::local_persona_target()
    };

    fs::create_dir_all(&target_dir)?;
    let link_path = target_dir.join(&name);

    util::ensure_target_clear(&link_path, force, &name)?;

    symlink(&persona_path, &link_path)?;

    let scope = if global { "global" } else { "local" };
    ui::success(&format!("Installed persona '{}' ({})", name, scope));
    Ok(())
}

fn install_remote(spec_str: &str, global: bool, force: bool) -> Result<()> {
    let spec = remote::parse_spec(spec_str)?;
    ui::info(&format!("Downloading {}...", spec));

    // Try single-file download first (personas are often a single .md)
    let file_spec = remote::RemoteSpec {
        owner: spec.owner.clone(),
        repo: spec.repo.clone(),
        path: format!("{}/PERSONA.md", spec.path),
        git_ref: spec.git_ref.clone(),
    };

    let persona_name = spec
        .path
        .rsplit('/')
        .next()
        .unwrap_or(&spec.path)
        .to_string();

    let target_dir = if global {
        config::global_persona_target()
    } else {
        config::local_persona_target()
    };

    fs::create_dir_all(&target_dir)?;
    let dest = target_dir.join(&persona_name);

    util::ensure_target_clear(&dest, force, &persona_name)?;

    // Try fetching as a directory (tarball)
    match remote::fetch_dir(&spec) {
        Ok((_tmp_dir, source_path)) => {
            util::copy_dir_recursive(&source_path, &dest)?;
            remote::write_metadata(&dest, &spec)?;
        }
        Err(_) => {
            // Fallback: try single PERSONA.md file
            let data = remote::fetch_file(&file_spec)
                .context(format!("Failed to download persona '{}'", persona_name))?;

            fs::create_dir_all(&dest)?;
            fs::write(dest.join("PERSONA.md"), &data)?;
            remote::write_metadata(&dest, &spec)?;
        }
    }

    let scope = if global { "global" } else { "local" };
    ui::success(&format!(
        "Installed remote persona '{}' ({}) from {}",
        persona_name, scope, spec
    ));
    Ok(())
}

fn uninstall(name: &str, global: bool) -> Result<()> {
    util::validate_name(name)?;
    // Try to find the persona: check dir, .md file, in both local and global
    let (path, scope) = if global {
        (find_installed_persona(name, &config::global_persona_target()), "global")
    } else {
        // Try local first, then auto-detect global
        let local = find_installed_persona(name, &config::local_persona_target());
        if local.is_some() {
            (local, "local")
        } else {
            let global_found = find_installed_persona(name, &config::global_persona_target());
            if global_found.is_some() {
                (global_found, "global")
            } else {
                (None, "local")
            }
        }
    };

    let path = path.context(format!("Persona '{}' is not installed", name))?;

    if path.is_symlink() || path.is_file() {
        fs::remove_file(&path)?;
    } else {
        fs::remove_dir_all(&path)?;
    }

    ui::success(&format!("Uninstalled persona '{}' ({})", name, scope));
    Ok(())
}

fn find_installed_persona(name: &str, dir: &Path) -> Option<PathBuf> {
    // Check exact name (directory or file)
    let exact = dir.join(name);
    if exact.exists() || exact.is_symlink() {
        return Some(exact);
    }
    // Check with .md extension
    let with_md = dir.join(format!("{}.md", name));
    if with_md.exists() || with_md.is_symlink() {
        return Some(with_md);
    }
    None
}

fn list(installed: bool, local: bool, global: bool, json: bool) -> Result<()> {
    let local_dir = config::local_persona_target();
    let global_dir = config::global_persona_target();
    let local_installed = installed_persona_names(&local_dir);
    let global_installed = installed_persona_names(&global_dir);

    let mut entries: Vec<serde_json::Value> = Vec::new();

    // If only showing installed
    if installed || local || global {
        if installed || local {
            if local_dir.is_dir() {
                list_personas_in_dir(&local_dir, "local", &mut entries)?;
            }
        }
        if installed || global {
            if global_dir.is_dir() {
                list_personas_in_dir(&global_dir, "global", &mut entries)?;
            }
        }
        if json {
            println!("{}", serde_json::to_string_pretty(&entries)?);
            return Ok(());
        }
        if entries.is_empty() {
            ui::info("No installed personas found.");
            return Ok(());
        }
        for entry in &entries {
            let name = entry["name"].as_str().unwrap_or("");
            let scope = entry["scope"].as_str().unwrap_or("");
            let role = entry["role"].as_str().unwrap_or("");
            println!("  {} {:28} {}", scope, name, role);
        }
        return Ok(());
    }

    // Default: show all library personas with install status
    // Collect library entries
    if let Some(source_dir) = config::find_source_dir() {
        let lib_dir = config::persona_library(&source_dir);
        if lib_dir.is_dir() {
            list_personas_in_dir(&lib_dir, "library", &mut entries)?;
        }
    }

    // Also add installed-only personas not in library
    if local_dir.is_dir() {
        list_personas_in_dir(&local_dir, "local", &mut entries)?;
    }
    if global_dir.is_dir() {
        list_personas_in_dir(&global_dir, "global", &mut entries)?;
    }

    // Deduplicate by name (library entries first)
    let mut seen = std::collections::HashSet::new();
    entries.retain(|e| {
        let name = e["name"].as_str().unwrap_or("").to_string();
        seen.insert(name)
    });

    if json {
        println!("{}", serde_json::to_string_pretty(&entries)?);
        return Ok(());
    }

    if entries.is_empty() {
        ui::info("No personas found.");
        return Ok(());
    }

    // Group by type
    use std::collections::BTreeMap;

    let mut by_type: BTreeMap<String, Vec<&serde_json::Value>> = BTreeMap::new();
    for entry in &entries {
        let kind = entry["type"].as_str().unwrap_or("other").to_string();
        by_type.entry(kind).or_default().push(entry);
    }

    let total = entries.len();
    let total_installed: usize = entries
        .iter()
        .filter(|e| {
            let name = e["name"].as_str().unwrap_or("");
            local_installed.contains(&name.to_string())
                || global_installed.contains(&name.to_string())
        })
        .count();

    println!(
        "{}  ({}=local {}=global {}=not installed)",
        "Available personas".cyan(),
        "L".green(),
        "G".blue(),
        "○".dimmed()
    );
    println!("{}", "=".repeat(40));

    for (kind, personas) in &by_type {
        println!("\n{}", format!("{}/", kind).yellow().bold());

        for entry in personas {
            let name = entry["name"].as_str().unwrap_or("");
            let role = entry["role"].as_str().unwrap_or("");

            let status = if local_installed.contains(&name.to_string()) {
                format!("{}", "L".green())
            } else if global_installed.contains(&name.to_string()) {
                format!("{}", "G".blue())
            } else {
                format!("{}", "○".dimmed())
            };

            let role_display = if role.len() > 40 {
                format!("{}...", &role[..37])
            } else {
                role.to_string()
            };

            println!("  {} {:28} {}", status, name, role_display);
        }
    }

    println!(
        "\n{}: total {} / installed {}",
        "Summary".cyan(),
        total,
        total_installed
    );

    Ok(())
}

fn create(
    name: &str,
    ai: Option<String>,
    codex: Option<String>,
    claude: Option<String>,
    gemini: Option<String>,
) -> Result<()> {
    util::validate_name(name)?;
    let target_dir = config::local_persona_target();
    fs::create_dir_all(&target_dir)?;

    let persona_dir = target_dir.join(name);
    if persona_dir.exists() {
        bail!("Persona '{}' already exists at {}", name, persona_dir.display());
    }

    // Determine if AI generation is requested
    let ai_desc = ai
        .or(codex.clone())
        .or(claude.clone())
        .or(gemini.clone());

    let cli_override = if codex.is_some() {
        Some(llm::LlmCli::Codex)
    } else if claude.is_some() {
        Some(llm::LlmCli::Claude)
    } else if gemini.is_some() {
        Some(llm::LlmCli::Gemini)
    } else {
        None
    };

    let content = if let Some(desc) = ai_desc {
        generate_persona(name, &desc, cli_override)?
    } else {
        default_persona_template(name)
    };

    fs::create_dir_all(&persona_dir)?;
    fs::write(persona_dir.join("PERSONA.md"), content)?;

    ui::success(&format!("Created persona '{}' at {}", name, persona_dir.display()));
    Ok(())
}

fn show(name: &str) -> Result<()> {
    let path = find_persona(name)?;
    let persona_md = find_persona_md(&path)?;
    let content = fs::read_to_string(&persona_md)?;

    let (fm, body) = frontmatter::parse(&content)?;

    if let Some(n) = &fm.name {
        println!("Name:        {}", n);
    }
    if let Some(role) = &fm.role {
        println!("Role:        {}", role);
    }
    if let Some(domain) = &fm.domain {
        println!("Domain:      {}", domain);
    }
    if let Some(kind) = &fm.kind {
        println!("Type:        {}", kind);
    }
    if let Some(desc) = &fm.description {
        println!("Description: {}", desc);
    }
    if let Some(tags) = &fm.tags {
        println!("Tags:        {}", tags.join(", "));
    }
    println!();
    println!("{}", body);

    Ok(())
}

fn which(name: &str) -> Result<()> {
    let path = find_persona(name)?;
    let resolved = fs::canonicalize(&path).unwrap_or(path);
    println!("{}", resolved.display());
    Ok(())
}

fn review(
    name: &str,
    use_codex: bool,
    use_claude: bool,
    use_gemini: bool,
    staged: bool,
    base: Option<String>,
    output: Option<String>,
) -> Result<()> {
    let persona_path = find_persona(name)?;
    let persona_md = find_persona_md(&persona_path)?;
    let persona_content = fs::read_to_string(&persona_md)?;

    // Get diff
    let diff = get_diff(staged, base.as_deref())?;
    if diff.trim().is_empty() {
        ui::warn("No changes to review.");
        return Ok(());
    }

    // Determine LLM
    let cli = if use_codex {
        llm::LlmCli::Codex
    } else if use_claude {
        llm::LlmCli::Claude
    } else if use_gemini {
        llm::LlmCli::Gemini
    } else {
        llm::detect().context("No LLM CLI found. Install codex, claude, gemini, or ollama.")?
    };

    ui::info(&format!("Reviewing with {} using persona '{}'...", cli, name));

    let prompt = format!(
        "You are acting as the following persona:\n\n{}\n\n\
         Review the following code changes and provide feedback:\n\n\
         ```diff\n{}\n```\n\n\
         Provide a structured review with: issues found, suggestions, and an overall assessment.",
        persona_content, diff
    );

    let result = llm::invoke(cli, &prompt)?;

    if let Some(output_path) = output {
        fs::write(&output_path, &result)?;
        ui::success(&format!("Review saved to {}", output_path));
    } else {
        println!("{}", result);
    }

    Ok(())
}

// --- Helpers ---

fn find_persona(name: &str) -> Result<PathBuf> {
    // Check local (dir or .md)
    let local_dir = config::local_persona_target().join(name);
    let local_md = config::local_persona_target().join(format!("{}.md", name));
    if local_dir.exists() {
        return Ok(local_dir);
    }
    if local_md.exists() {
        return Ok(local_md);
    }

    // Check global (dir or .md)
    let global_dir = config::global_persona_target().join(name);
    let global_md = config::global_persona_target().join(format!("{}.md", name));
    if global_dir.exists() {
        return Ok(global_dir);
    }
    if global_md.exists() {
        return Ok(global_md);
    }

    // Check library (dir or .md)
    if let Some(source_dir) = config::find_source_dir() {
        let lib = config::persona_library(&source_dir);
        let lib_dir = lib.join(name);
        let lib_md = lib.join(format!("{}.md", name));
        if lib_dir.exists() {
            return Ok(lib_dir);
        }
        if lib_md.exists() {
            return Ok(lib_md);
        }
    }

    bail!("Persona '{}' not found", name);
}

/// Find the persona markdown content. Handles both:
/// - Directory with PERSONA.md inside
/// - Single .md file
fn find_persona_md(path: &Path) -> Result<PathBuf> {
    // If path is already a .md file
    if path.is_file() && path.extension().is_some_and(|e| e == "md") {
        return Ok(path.to_path_buf());
    }

    // Directory: check PERSONA.md first, then any .md
    let persona_md = path.join("PERSONA.md");
    if persona_md.exists() {
        return Ok(persona_md);
    }
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if entry.path().extension().is_some_and(|e| e == "md") {
                return Ok(entry.path());
            }
        }
    }
    bail!(
        "No PERSONA.md found in {}",
        path.display()
    );
}

fn installed_persona_names(dir: &Path) -> Vec<String> {
    let mut names = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            // Strip .md extension for matching
            let clean = name.strip_suffix(".md").unwrap_or(&name).to_string();
            names.push(clean);
        }
    }
    names
}

fn list_personas_in_dir(
    dir: &Path,
    scope: &str,
    entries: &mut Vec<serde_json::Value>,
) -> Result<()> {
    if let Ok(read) = fs::read_dir(dir) {
        for entry in read.flatten() {
            let path = entry.path();
            let raw_name = entry.file_name().to_string_lossy().to_string();
            if raw_name.starts_with('.') || raw_name == "README.md" {
                continue;
            }

            // Handle both directories and .md files
            let (name, role, domain, kind) = if path.is_dir() {
                let (role, domain, kind) = read_persona_info(&path);
                (raw_name, role, domain, kind)
            } else if path.extension().is_some_and(|e| e == "md") {
                let persona_name = raw_name.strip_suffix(".md").unwrap_or(&raw_name).to_string();
                let (role, domain, kind) = read_persona_info_from_file(&path);
                (persona_name, role, domain, kind)
            } else {
                continue;
            };

            let is_remote = if path.is_dir() {
                path.join(".remote-source").exists()
            } else {
                false
            };

            entries.push(serde_json::json!({
                "name": name,
                "scope": scope,
                "role": role,
                "domain": domain,
                "type": kind,
                "remote": is_remote,
            }));
        }
    }
    Ok(())
}

fn read_persona_info(path: &Path) -> (String, String, String) {
    let persona_md = path.join("PERSONA.md");
    if let Ok(content) = fs::read_to_string(persona_md) {
        return extract_persona_fields(&content);
    }
    // Try any .md in dir
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if entry.path().extension().is_some_and(|e| e == "md") {
                if let Ok(content) = fs::read_to_string(entry.path()) {
                    return extract_persona_fields(&content);
                }
            }
        }
    }
    (String::new(), String::new(), String::new())
}

fn read_persona_info_from_file(path: &Path) -> (String, String, String) {
    if let Ok(content) = fs::read_to_string(path) {
        return extract_persona_fields(&content);
    }
    (String::new(), String::new(), String::new())
}

fn extract_persona_fields(content: &str) -> (String, String, String) {
    let role = frontmatter::get_field(content, "role").unwrap_or_default();
    let domain = frontmatter::get_field(content, "domain").unwrap_or_default();
    let kind = frontmatter::get_field(content, "type").unwrap_or_default();
    (role, domain, kind)
}

fn get_diff(staged: bool, base: Option<&str>) -> Result<String> {
    let output = if staged {
        std::process::Command::new("git")
            .args(["diff", "--cached"])
            .output()
            .context("Failed to run git diff")?
    } else if let Some(base_branch) = base {
        // Validate base branch to prevent argument injection
        if base_branch.starts_with('-') {
            bail!("Invalid base branch name: {}", base_branch);
        }
        std::process::Command::new("git")
            .args(["diff", &format!("{}...HEAD", base_branch)])
            .output()
            .context("Failed to run git diff")?
    } else {
        std::process::Command::new("git")
            .args(["diff", "HEAD"])
            .output()
            .context("Failed to run git diff")?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("git diff failed: {}", stderr);
    }

    Ok(String::from_utf8(output.stdout)
        .unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned()))
}

fn generate_persona(
    name: &str,
    desc: &str,
    cli_override: Option<llm::LlmCli>,
) -> Result<String> {
    let cli = cli_override
        .or_else(llm::detect)
        .context("No LLM CLI found for persona generation")?;

    ui::info(&format!("Generating persona with {}...", cli));

    let prompt = format!(
        "Create a code review persona in YAML frontmatter + markdown format.\n\n\
         Name: {}\nDescription: {}\n\n\
         Use this exact format:\n\
         ---\nname: {}\nrole: \"<role title>\"\ndomain: <domain>\n\
         type: review\ntags: [<tag1>, <tag2>]\n---\n\n\
         # <Title>\n\n<Detailed persona instructions for code review>\n\n\
         Output ONLY the persona file content, no explanation.",
        name, desc, name
    );

    llm::invoke(cli, &prompt)
}

fn default_persona_template(name: &str) -> String {
    format!(
        "---\nname: {}\nrole: \"Code Reviewer\"\ndomain: general\n\
         type: review\ntags: [review]\n---\n\n\
         # {}\n\nReview code for correctness, readability, and best practices.\n",
        name, name
    )
}

