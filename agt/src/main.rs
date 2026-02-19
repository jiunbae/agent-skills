mod cmd;
mod config;
mod frontmatter;
mod llm;
mod remote;
mod ui;

use clap::{Parser, Subcommand};

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Parser)]
#[command(name = "agt", about = "Agent Skills CLI — manage AI agent skills and personas")]
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
    /// Manage agent personas
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
