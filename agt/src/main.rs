mod cmd;
mod config;
mod frontmatter;
mod llm;
mod remote;
mod ui;
mod util;

use clap::{CommandFactory, Parser, Subcommand};
use clap_complete::Shell;

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Parser)]
#[command(name = "agt", about = "agt — A modular toolkit for extending AI coding agents")]
#[command(version = VERSION)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Manage agent skills
    Skill {
        #[command(subcommand)]
        action: cmd::skill::SkillAction,
    },
    /// Manage agent personas (markdown files that define expert identities for any AI agent)
    #[command(
        long_about = "Manage agent personas — markdown files that define expert identities.\n\n\
            Personas are simple .md files with YAML frontmatter (name, role, domain, tags)\n\
            and a markdown body (identity, review lens, evaluation framework, output format).\n\
            Any AI agent can read and adopt a persona.\n\n\
            Persona locations (searched in order):\n  \
              .agents/personas/        Project-local (highest priority)\n  \
              ~/.agents/personas/      User global\n  \
              personas/                Library (bundled)\n\n\
            Usage with different agents:\n  \
              Claude Code  Read the persona file path in conversation\n  \
              Codex        agt persona review <name> --codex\n  \
              Gemini       agt persona review <name> --gemini\n  \
              Any agent    cat .agents/personas/<name>.md | <agent-cli>"
    )]
    Persona {
        #[command(subcommand)]
        action: cmd::persona::PersonaAction,
    },
    /// Run prompt with skill matching
    Run {
        /// The prompt to execute
        prompt: Vec<String>,
        /// Specify skill by name
        #[arg(long)]
        skill: Option<String>,
    },
    /// Generate shell completion scripts
    Completions {
        /// Shell type
        shell: Shell,
    },
    /// List names for shell completion (internal)
    #[command(hide = true)]
    CompleteNames {
        /// Type: "persona" or "skill"
        kind: String,
    },
    /// Show version
    Version,
}

fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Skill { action } => cmd::skill::execute(action),
        Commands::Persona { action } => cmd::persona::execute(action),
        Commands::Run { prompt, skill } => {
            cmd::run::execute(&prompt.join(" "), skill.as_deref())
        }
        Commands::Completions { shell } => {
            generate_completions(shell);
            Ok(())
        }
        Commands::CompleteNames { kind } => {
            complete_names(&kind);
            Ok(())
        }
        Commands::Version => {
            println!("agt {}", VERSION);
            Ok(())
        }
    };

    if let Err(e) = result {
        ui::error(&format!("{:#}", e));
        std::process::exit(1);
    }
}

fn generate_completions(shell: Shell) {
    let mut cmd = Cli::command();

    // Print the base completion script
    let mut buf = Vec::new();
    clap_complete::generate(shell, &mut cmd, "agt", &mut buf);
    let script = String::from_utf8(buf).unwrap_or_default();

    match shell {
        Shell::Zsh => print_zsh_completions(&script),
        Shell::Bash => print_bash_completions(&script),
        Shell::Fish => print_fish_completions(&script),
        _ => print!("{}", script),
    }
}

fn print_zsh_completions(base: &str) {
    // Print base completions from clap
    print!("{}", base);

    // Add dynamic completion functions
    println!(r#"
# Dynamic completions for persona and skill names
_agt_persona_names() {{
    local -a names
    names=(${{(f)"$(agt complete-names persona 2>/dev/null)"}})
    compadd -a names
}}

_agt_skill_names() {{
    local -a names
    names=(${{(f)"$(agt complete-names skill 2>/dev/null)"}})
    compadd -a names
}}

# Override persona subcommand completions
_agt_persona_review() {{
    _arguments \
        '1:persona name:_agt_persona_names' \
        '--codex[Use Codex]' \
        '--claude[Use Claude]' \
        '--gemini[Use Gemini]' \
        '--staged[Staged changes only]' \
        '--base=[Base branch]:branch:' \
        '-o=[Output file]:file:_files' \
        '*:prompt:'
}}

_agt_persona_install() {{
    _arguments \
        '1:persona name:_agt_persona_names' \
        '-g[Install globally]' \
        '--global[Install globally]' \
        '-f[Force overwrite]' \
        '--force[Force overwrite]' \
        '-a[Install all]' \
        '--all[Install all]' \
        '--from=[Remote spec]:spec:'
}}

_agt_persona_uninstall() {{
    _arguments \
        '1:persona name:_agt_persona_names' \
        '-g[Global scope]' \
        '--global[Global scope]' \
        '-a[Uninstall all]' \
        '--all[Uninstall all]'
}}

_agt_persona_show() {{
    _arguments '1:persona name:_agt_persona_names'
}}

_agt_persona_which() {{
    _arguments '1:persona name:_agt_persona_names'
}}

_agt_skill_install() {{
    _arguments \
        '1:skill name:_agt_skill_names' \
        '-g[Install globally]' \
        '--global[Install globally]' \
        '-f[Force overwrite]' \
        '--force[Force overwrite]' \
        '--from=[Remote spec]:spec:'
}}

_agt_skill_uninstall() {{
    _arguments \
        '1:skill name:_agt_skill_names' \
        '-g[Global scope]' \
        '--global[Global scope]'
}}

_agt_skill_which() {{
    _arguments '1:skill name:_agt_skill_names'
}}
"#);
}

fn print_bash_completions(base: &str) {
    print!("{}", base);

    println!(r#"
# Dynamic completions for persona and skill names
_agt_dynamic_complete() {{
    local kind="$1"
    COMPREPLY=($(compgen -W "$(agt complete-names "$kind" 2>/dev/null)" -- "${{COMP_WORDS[COMP_CWORD]}}"))
}}

# Extend the generated completion
_agt_completion_orig=$(_agt_completion 2>/dev/null || true)

_agt_enhanced() {{
    local cur prev words cword
    _init_completion || return

    # Detect context: agt persona <subcommand> <NAME>
    if [[ "${{words[1]}}" == "persona" ]] && [[ $cword -ge 3 ]]; then
        case "${{words[2]}}" in
            review|install|uninstall|show|which)
                if [[ $cword -eq 3 ]] && [[ "$cur" != -* ]]; then
                    _agt_dynamic_complete persona
                    return
                fi
                ;;
        esac
    fi

    # Detect context: agt skill <subcommand> <NAME>
    if [[ "${{words[1]}}" == "skill" ]] && [[ $cword -ge 3 ]]; then
        case "${{words[2]}}" in
            install|uninstall|which)
                if [[ $cword -eq 3 ]] && [[ "$cur" != -* ]]; then
                    _agt_dynamic_complete skill
                    return
                fi
                ;;
        esac
    fi

    # Fall back to generated completions
    _agt "$@"
}}
complete -F _agt_enhanced -o nosort -o bashdefault -o default agt
"#);
}

fn print_fish_completions(base: &str) {
    print!("{}", base);

    println!(r#"
# Dynamic completions for persona names
complete -c agt -n '__fish_seen_subcommand_from persona; and __fish_seen_subcommand_from review install uninstall show which' -xa '(agt complete-names persona 2>/dev/null)'

# Dynamic completions for skill names
complete -c agt -n '__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from install uninstall which' -xa '(agt complete-names skill 2>/dev/null)'
"#);
}

/// Output names for shell completion
fn complete_names(kind: &str) {
    match kind {
        "persona" => {
            // Collect from all sources: local, global, library
            let mut names = std::collections::BTreeSet::new();

            // Local
            collect_names_from_dir(&config::local_persona_target(), &mut names);
            // Global
            collect_names_from_dir(&config::global_persona_target(), &mut names);
            // Library
            if let Some(source_dir) = config::find_source_dir() {
                collect_names_from_dir(&config::persona_library(&source_dir), &mut names);
            }

            for name in names {
                println!("{}", name);
            }
        }
        "skill" => {
            let mut names = std::collections::BTreeSet::new();

            // Local
            collect_names_from_dir(&config::local_skill_target(), &mut names);
            // Global
            collect_names_from_dir(&config::global_skill_target(), &mut names);
            // Library
            if let Some(source_dir) = config::find_source_dir() {
                for group in config::skill_groups(&source_dir) {
                    for skill in config::skills_in_group(&source_dir, &group) {
                        names.insert(skill);
                    }
                }
            }

            for name in names {
                println!("{}", name);
            }
        }
        _ => {}
    }
}

fn collect_names_from_dir(dir: &std::path::Path, names: &mut std::collections::BTreeSet<String>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let raw = entry.file_name().to_string_lossy().to_string();
            if raw.starts_with('.') || raw == "README.md" {
                continue;
            }
            let name = raw.strip_suffix(".md").unwrap_or(&raw).to_string();
            names.insert(name);
        }
    }
}
