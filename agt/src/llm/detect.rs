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

/// Check if a command exists by scanning PATH directories (no subprocess spawn)
fn command_exists(cmd: &str) -> bool {
    std::env::var_os("PATH")
        .map(|paths| {
            std::env::split_paths(&paths)
                .any(|dir| dir.join(cmd).is_file())
        })
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
