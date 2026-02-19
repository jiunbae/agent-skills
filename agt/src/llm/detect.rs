use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LlmCli {
    Codex,
    Claude,
    Gemini,
    Ollama,
}

impl std::fmt::Display for LlmCli {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LlmCli::Codex => write!(f, "codex"),
            LlmCli::Claude => write!(f, "claude"),
            LlmCli::Gemini => write!(f, "gemini"),
            LlmCli::Ollama => write!(f, "ollama"),
        }
    }
}

impl LlmCli {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "codex" => Some(LlmCli::Codex),
            "claude" => Some(LlmCli::Claude),
            "gemini" => Some(LlmCli::Gemini),
            "ollama" => Some(LlmCli::Ollama),
            _ => None,
        }
    }
}

fn command_exists(cmd: &str) -> bool {
    Command::new("which")
        .arg(cmd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Detect available LLM CLI.
/// Priority: codex > claude (skip if CLAUDECODE set) > gemini > ollama
pub fn detect() -> Option<LlmCli> {
    if command_exists("codex") {
        return Some(LlmCli::Codex);
    }

    // Skip claude if running inside Claude Code
    if std::env::var("CLAUDECODE").is_err() && command_exists("claude") {
        return Some(LlmCli::Claude);
    }

    if command_exists("gemini") {
        return Some(LlmCli::Gemini);
    }

    if command_exists("ollama") {
        return Some(LlmCli::Ollama);
    }

    None
}
