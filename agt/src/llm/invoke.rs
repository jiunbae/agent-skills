use super::LlmCli;
use anyhow::{bail, Context, Result};
use std::fs;
use std::process::Command;
use tempfile::NamedTempFile;

pub struct InvokeOpts {
    pub output_file: Option<String>,
}

/// Invoke an LLM CLI with a prompt and return the output
pub fn invoke(cli: LlmCli, prompt: &str, _opts: &InvokeOpts) -> Result<String> {
    // Write prompt to temp file for large prompts
    let tmp = NamedTempFile::new().context("Failed to create temp file")?;
    fs::write(tmp.path(), prompt).context("Failed to write prompt")?;

    let prompt_content = fs::read_to_string(tmp.path())?;

    let output = match cli {
        LlmCli::Codex => Command::new("codex")
            .args(["exec", "--full-auto", &prompt_content])
            .output()
            .context("Failed to run codex")?,

        LlmCli::Claude => Command::new("claude")
            .args(["-p", &prompt_content, "--output-format", "text"])
            .output()
            .context("Failed to run claude")?,

        LlmCli::Gemini => Command::new("gemini")
            .args(["-p", &prompt_content, "-o", "text"])
            .output()
            .context("Failed to run gemini")?,

        LlmCli::Ollama => Command::new("ollama")
            .args(["run", "llama3.2", &prompt_content])
            .output()
            .context("Failed to run ollama")?,
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("{} failed: {}", cli, stderr);
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
