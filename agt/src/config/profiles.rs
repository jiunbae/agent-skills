use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
pub struct ProfileDef {
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub groups: Vec<String>,
}

#[allow(dead_code)]
pub struct ResolvedProfile {
    pub name: String,
    pub description: String,
    pub skills: Vec<(String, String)>, // (group, skill_name)
}

fn builtin_profiles() -> BTreeMap<String, ProfileDef> {
    let mut map = BTreeMap::new();
    map.insert(
        "core".to_string(),
        ProfileDef {
            description: "Essential skills for every workspace".to_string(),
            skills: vec![
                "development/git-commit-pr".into(),
                "context/context-manager".into(),
                "context/static-index".into(),
                "security/security-auditor".into(),
                "agents/background-implementer".into(),
                "agents/background-planner".into(),
                "agents/background-reviewer".into(),
            ],
            groups: vec![],
        },
    );
    map
}

fn load_profiles_file(source_dir: &Path) -> Option<BTreeMap<String, ProfileDef>> {
    let path = source_dir.join("profiles.yml");
    let content = std::fs::read_to_string(&path).ok()?;
    serde_yaml::from_str(&content).ok()
}

fn available_profiles(source_dir: &Path) -> BTreeMap<String, ProfileDef> {
    let mut profiles = builtin_profiles();
    if let Some(file_profiles) = load_profiles_file(source_dir) {
        for (name, def) in file_profiles {
            profiles.insert(name, def);
        }
    }
    profiles
}

pub fn resolve_profile(name: &str, source_dir: &Path) -> anyhow::Result<ResolvedProfile> {
    if name == "all" {
        let mut skills = Vec::new();
        for group in super::skill_groups(source_dir) {
            for skill in super::skills_in_group(source_dir, &group) {
                skills.push((group.clone(), skill));
            }
        }
        return Ok(ResolvedProfile {
            name: "all".to_string(),
            description: "All available skills".to_string(),
            skills,
        });
    }

    let profiles = available_profiles(source_dir);
    let def = profiles.get(name).ok_or_else(|| {
        let available: Vec<_> = profiles
            .keys()
            .chain(std::iter::once(&"all".to_string()))
            .cloned()
            .collect();
        anyhow::anyhow!(
            "Unknown profile '{}'. Available: {}",
            name,
            available.join(", ")
        )
    })?;

    let mut skills = Vec::new();

    for spec in &def.skills {
        if let Some((group, skill_name)) = spec.split_once('/') {
            let pair = (group.to_string(), skill_name.to_string());
            if !skills.contains(&pair) {
                skills.push(pair);
            }
        }
    }

    for group in &def.groups {
        for skill in super::skills_in_group(source_dir, group) {
            let pair = (group.clone(), skill);
            if !skills.contains(&pair) {
                skills.push(pair);
            }
        }
    }

    Ok(ResolvedProfile {
        name: name.to_string(),
        description: def.description.clone(),
        skills,
    })
}

pub fn list_profiles(source_dir: &Path) -> Vec<(String, String, usize)> {
    let profiles = available_profiles(source_dir);
    let mut result: Vec<(String, String, usize)> = profiles
        .into_iter()
        .map(|(name, def)| {
            let count = resolve_profile(&name, source_dir)
                .map(|r| r.skills.len())
                .unwrap_or(0);
            (name, def.description, count)
        })
        .collect();

    let all_count: usize = super::skill_groups(source_dir)
        .iter()
        .map(|g| super::skills_in_group(source_dir, g).len())
        .sum();
    result.push((
        "all".to_string(),
        "All available skills".to_string(),
        all_count,
    ));

    result.sort_by(|a, b| a.0.cmp(&b.0));
    result
}
