use anyhow::{bail, Result};
use std::fs;
use std::path::Path;

/// Validate a skill/persona name to prevent path traversal
pub fn validate_name(name: &str) -> Result<()> {
    if name.is_empty() {
        bail!("Name cannot be empty");
    }
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        bail!("Name contains invalid path characters: {}", name);
    }
    if name == "." || name == ".." || name.starts_with("..") {
        bail!("Name cannot be a relative path component: {}", name);
    }
    Ok(())
}

/// Check if target path exists and clear it if force is set
pub fn ensure_target_clear(path: &Path, force: bool, entity_name: &str) -> Result<()> {
    if path.exists() || path.is_symlink() {
        if force {
            if path.is_symlink() || path.is_file() {
                fs::remove_file(path)?;
            } else {
                fs::remove_dir_all(path)?;
            }
        } else {
            bail!(
                "'{}' already installed at {}. Use --force to overwrite.",
                entity_name,
                path.display()
            );
        }
    }
    Ok(())
}

/// Recursively copy a directory, skipping symlinks for safety
pub fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)?.flatten() {
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        // Skip symlinks to prevent exfiltration of files outside the source tree
        if file_type.is_symlink() {
            continue;
        }

        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}
