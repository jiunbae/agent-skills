mod cmd;
mod config;
mod frontmatter;
mod llm;
mod remote;
mod ui;
mod util;

use clap::{Parser, Subcommand};

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
