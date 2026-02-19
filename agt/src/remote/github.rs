use anyhow::{bail, Context, Result};
use flate2::read::GzDecoder;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tar::Archive;
use tempfile::TempDir;

/// Parsed remote specification
#[derive(Debug, Clone)]
pub struct RemoteSpec {
    pub owner: String,
    pub repo: String,
    pub path: String,
    pub git_ref: String,
}

impl std::fmt::Display for RemoteSpec {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}/{}/{}@{}",
            self.owner, self.repo, self.path, self.git_ref
        )
    }
}

/// Parse "owner/repo/path[@ref]" into a RemoteSpec
pub fn parse_spec(spec: &str) -> Result<RemoteSpec> {
    let spec = spec.trim_end_matches('/');

    // Extract @ref suffix
    let (path_part, git_ref) = if let Some(at_pos) = spec.rfind('@') {
        (&spec[..at_pos], spec[at_pos + 1..].to_string())
    } else {
        (spec, "main".to_string())
    };

    let parts: Vec<&str> = path_part.split('/').collect();
    if parts.len() < 3 {
        bail!(
            "Invalid format: {}\nExpected: owner/repo/path/to/skill[@ref]",
            spec
        );
    }

    Ok(RemoteSpec {
        owner: parts[0].to_string(),
        repo: parts[1].to_string(),
        path: parts[2..].join("/"),
        git_ref,
    })
}

/// Download a single file from raw.githubusercontent.com
pub fn fetch_file(spec: &RemoteSpec) -> Result<Vec<u8>> {
    let url = format!(
        "https://raw.githubusercontent.com/{}/{}/{}/{}",
        spec.owner, spec.repo, spec.git_ref, spec.path
    );

    let response = ureq::get(&url)
        .call()
        .context(format!("Failed to download: {}", url))?;

    let mut body = Vec::new();
    response
        .into_reader()
        .read_to_end(&mut body)
        .context("Failed to read response")?;

    Ok(body)
}

/// Download a directory from GitHub tarball, extract to a temp directory.
/// Returns (TempDir, path_to_extracted_content).
/// The TempDir must be kept alive by the caller — dropping it cleans up.
pub fn fetch_dir(spec: &RemoteSpec) -> Result<(TempDir, PathBuf)> {
    let tmp_dir = TempDir::new().context("Failed to create temp directory")?;

    // Try tags first (more common for versioned refs), then heads
    let urls = [
        format!(
            "https://github.com/{}/{}/archive/refs/tags/{}.tar.gz",
            spec.owner, spec.repo, spec.git_ref
        ),
        format!(
            "https://github.com/{}/{}/archive/refs/heads/{}.tar.gz",
            spec.owner, spec.repo, spec.git_ref
        ),
    ];

    let mut extracted_root: Option<PathBuf> = None;

    for url in &urls {
        // Clean previous attempt
        if let Ok(entries) = fs::read_dir(tmp_dir.path()) {
            for entry in entries.flatten() {
                let _ = fs::remove_dir_all(entry.path());
            }
        }

        let response = match ureq::get(url).call() {
            Ok(r) => r,
            Err(_) => continue,
        };

        let decoder = GzDecoder::new(response.into_reader());
        let mut archive = Archive::new(decoder);

        if archive.unpack(tmp_dir.path()).is_err() {
            continue;
        }

        // Find extracted root directory
        if let Ok(entries) = fs::read_dir(tmp_dir.path()) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    extracted_root = Some(entry.path());
                    break;
                }
            }
        }

        if extracted_root.is_some() {
            break;
        }
    }

    let root = extracted_root.context(format!(
        "Download failed: {}/{}@{}",
        spec.owner, spec.repo, spec.git_ref
    ))?;

    let target_path = root.join(&spec.path);
    if !target_path.exists() {
        bail!(
            "Path not found: {} in {}/{}@{}",
            spec.path,
            spec.owner,
            spec.repo,
            spec.git_ref
        );
    }

    Ok((tmp_dir, target_path))
}

/// Write .remote-source metadata file
pub fn write_metadata(target: &Path, spec: &RemoteSpec) -> Result<()> {
    let metadata_path = if target.is_dir() {
        target.join(".remote-source")
    } else {
        let stem = target
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        target.with_file_name(format!("{}.remote-source", stem))
    };

    let content = format!(
        "source: {}/{}/{}\nref: {}\ninstalled: {}\n",
        spec.owner,
        spec.repo,
        spec.path,
        spec.git_ref,
        chrono_like_now()
    );

    fs::write(&metadata_path, content).context("Failed to write remote metadata")?;
    Ok(())
}

fn chrono_like_now() -> String {
    use std::time::SystemTime;
    let duration = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();
    // Simple UTC timestamp without chrono dependency
    let days = secs / 86400;
    let time_secs = secs % 86400;
    let hours = time_secs / 3600;
    let mins = (time_secs % 3600) / 60;
    let s = time_secs % 60;

    // Approximate date calculation (good enough for metadata)
    let mut y = 1970i64;
    let mut remaining_days = days as i64;
    loop {
        let days_in_year = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
            366
        } else {
            365
        };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        y += 1;
    }
    let is_leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let month_days = [
        31,
        if is_leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut m = 0;
    for (i, &md) in month_days.iter().enumerate() {
        if remaining_days < md as i64 {
            m = i + 1;
            break;
        }
        remaining_days -= md as i64;
    }
    let d = remaining_days + 1;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, m, d, hours, mins, s
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_spec_basic() {
        let spec = parse_spec("open330/agt/agents/background-reviewer").unwrap();
        assert_eq!(spec.owner, "open330");
        assert_eq!(spec.repo, "agt");
        assert_eq!(spec.path, "agents/background-reviewer");
        assert_eq!(spec.git_ref, "main");
    }

    #[test]
    fn test_parse_spec_with_ref() {
        let spec =
            parse_spec("open330/agt/agents/background-reviewer@v2026.02.19.1").unwrap();
        assert_eq!(spec.path, "agents/background-reviewer");
        assert_eq!(spec.git_ref, "v2026.02.19.1");
    }

    #[test]
    fn test_parse_spec_persona() {
        let spec = parse_spec("open330/agt/personas/security-reviewer").unwrap();
        assert_eq!(spec.path, "personas/security-reviewer");
    }

    #[test]
    fn test_parse_spec_invalid() {
        assert!(parse_spec("bad-format").is_err());
        assert!(parse_spec("owner/repo").is_err());
    }
}
