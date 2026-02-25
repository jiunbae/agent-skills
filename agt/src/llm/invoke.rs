use super::LlmCli;
use anyhow::{bail, Context, Result};
use std::io::Write;
use std::process::{Command, Stdio};

/// Invoke an LLM CLI with a prompt and return the output.
/// Uses stdin to pass prompts to avoid OS ARG_MAX limits.
pub fn invoke(cli: LlmCli, prompt: &str) -> Result<String> {
    let mut child = match cli {
        LlmCli::Codex => Command::new("codex")
            .args(["exec", "--full-auto", "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("Failed to spawn codex")?,

        LlmCli::Claude => Command::new("claude")
            .args(["-p", "-", "--output-format", "text"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("Failed to spawn claude")?,

        LlmCli::Gemini => Command::new("gemini")
            .args(["-p", "-", "-o", "text"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("Failed to spawn gemini")?,

        LlmCli::Ollama => Command::new("ollama")
            .args(["run", "llama3.2"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("Failed to spawn ollama")?,
    };

    // Write prompt via stdin
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes())?;
    }

    let output = child.wait_with_output().context(format!("Failed to run {}", cli))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("{} failed: {}", cli, stderr);
    }

    Ok(String::from_utf8(output.stdout)
        .unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned()))
}
