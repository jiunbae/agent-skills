use crate::{config, frontmatter, llm, remote, ui};
use anyhow::{bail, Context, Result};
use clap::Subcommand;
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

    if link_path.exists() || link_path.is_symlink() {
        if force {
            if link_path.is_dir() && !link_path.is_symlink() {
                fs::remove_dir_all(&link_path)?;
            } else {
                fs::remove_file(&link_path).or_else(|_| fs::remove_dir_all(&link_path))?;
            }
        } else {
            bail!(
                "Persona '{}' already installed. Use --force to overwrite.",
                name
            );
        }
    }

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

    if dest.exists() {
        if force {
            if dest.is_dir() {
                fs::remove_dir_all(&dest)?;
            } else {
                fs::remove_file(&dest)?;
            }
        } else {
            bail!(
                "Persona '{}' already installed. Use --force to overwrite.",
                persona_name
            );
        }
    }

    // Try fetching as a directory (tarball)
    match remote::fetch_dir(&spec) {
        Ok((_tmp_dir, source_path)) => {
            copy_dir_recursive(&source_path, &dest)?;
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
    let target_dir = if global {
        config::global_persona_target()
    } else {
        config::local_persona_target()
    };

    let path = target_dir.join(name);

    if !path.exists() && !path.is_symlink() {
        bail!("Persona '{}' is not installed", name);
    }

    if path.is_symlink() {
        fs::remove_file(&path)?;
    } else {
        fs::remove_dir_all(&path)?;
    }

    let scope = if global { "global" } else { "local" };
    ui::success(&format!("Uninstalled persona '{}' ({})", name, scope));
    Ok(())
}

fn list(installed: bool, local: bool, global: bool, json: bool) -> Result<()> {
    let mut entries: Vec<serde_json::Value> = Vec::new();

    if installed || local || (!global) {
        let local_dir = config::local_persona_target();
        if local_dir.is_dir() {
            list_personas_in_dir(&local_dir, "local", &mut entries)?;
        }
    }

    if installed || global || (!local) {
        let global_dir = config::global_persona_target();
        if global_dir.is_dir() {
            list_personas_in_dir(&global_dir, "global", &mut entries)?;
        }
    }

    // Show library personas
    if !installed && !local && !global {
        if let Some(source_dir) = config::find_source_dir() {
            let lib_dir = config::persona_library(&source_dir);
            if lib_dir.is_dir() {
                list_personas_in_dir(&lib_dir, "library", &mut entries)?;
            }
        }
    }

    if json {
        println!("{}", serde_json::to_string_pretty(&entries)?);
        return Ok(());
    }

    if entries.is_empty() {
        ui::info("No personas found.");
        return Ok(());
    }

    for entry in &entries {
        let name = entry["name"].as_str().unwrap_or("");
        let scope = entry["scope"].as_str().unwrap_or("");
        let role = entry["role"].as_str().unwrap_or("");
        let domain = entry["domain"].as_str().unwrap_or("");

        if role.is_empty() {
            println!("{:30} [{}]", name, scope);
        } else {
            println!("{:30} [{}] {} ({})", name, scope, role, domain);
        }
    }

    Ok(())
}

fn create(
    name: &str,
    ai: Option<String>,
    codex: Option<String>,
    claude: Option<String>,
    gemini: Option<String>,
) -> Result<()> {
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

    let opts = llm::InvokeOpts { output_file: None };
    let result = llm::invoke(cli, &prompt, &opts)?;

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
    // Check local
    let local = config::local_persona_target().join(name);
    if local.exists() {
        return Ok(local);
    }

    // Check global
    let global = config::global_persona_target().join(name);
    if global.exists() {
        return Ok(global);
    }

    // Check library
    if let Some(source_dir) = config::find_source_dir() {
        let lib = config::persona_library(&source_dir).join(name);
        if lib.exists() {
            return Ok(lib);
        }
    }

    bail!("Persona '{}' not found", name);
}

fn find_persona_md(path: &Path) -> Result<PathBuf> {
    let persona_md = path.join("PERSONA.md");
    if persona_md.exists() {
        return Ok(persona_md);
    }
    // Check for any .md file
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

fn list_personas_in_dir(
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
            if !path.is_dir() {
                continue;
            }

            let (role, domain) = read_persona_info(&path);
            let is_remote = path.join(".remote-source").exists();

            entries.push(serde_json::json!({
                "name": name,
                "scope": scope,
                "role": role,
                "domain": domain,
                "remote": is_remote,
            }));
        }
    }
    Ok(())
}

fn read_persona_info(path: &Path) -> (String, String) {
    let persona_md = path.join("PERSONA.md");
    if let Ok(content) = fs::read_to_string(persona_md) {
        let role = frontmatter::get_field(&content, "role").unwrap_or_default();
        let domain = frontmatter::get_field(&content, "domain").unwrap_or_default();
        return (role, domain);
    }
    (String::new(), String::new())
}

fn get_diff(staged: bool, base: Option<&str>) -> Result<String> {
    let output = if staged {
        std::process::Command::new("git")
            .args(["diff", "--cached"])
            .output()
            .context("Failed to run git diff")?
    } else if let Some(base_branch) = base {
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

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
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

    let opts = llm::InvokeOpts { output_file: None };
    llm::invoke(cli, &prompt, &opts)
}

fn default_persona_template(name: &str) -> String {
    format!(
        "---\nname: {}\nrole: \"Code Reviewer\"\ndomain: general\n\
         type: review\ntags: [review]\n---\n\n\
         # {}\n\nReview code for correctness, readability, and best practices.\n",
        name, name
    )
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
