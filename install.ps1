<#
Windows installer for agt.
Mirrors the behavior of install.sh: install/uninstall skills, list skills,
manage static link, and install the CLI helper.
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ScriptArgs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent -Path $MyInvocation.MyCommand.Path
$TargetDir = Join-Path $HOME '.claude/skills'
$StaticSource = Join-Path $ScriptDir 'static'
$StaticTarget = Join-Path $HOME '.agents'
$Prefix = ''
$Postfix = ''
$CopyMode = $false
$DryRun = $false
$Uninstall = $false
$ListMode = $false
$Quiet = $false
$LinkStatic = $false
$UnlinkStatic = $false
$InstallCli = $false
$UninstallCli = $false
$CliTarget = Join-Path $HOME '.local/bin'
$CliAliases = @()
$InstallCodex = $false
$CodexTarget = Join-Path $HOME '.codex'
$CodexAgentsSource = Join-Path $ScriptDir 'codex-support/AGENTS.md'
$InstallHooks = $false
$UninstallHooks = $false
$HooksSource = Join-Path $ScriptDir 'hooks'
$HooksTarget = Join-Path $HOME '.claude/hooks'
$HooksRegistry = Join-Path $HooksSource 'hooks.json'
$InstallPersonas = $false
$PersonasSource = Join-Path $ScriptDir 'personas'
$PersonasTarget = Join-Path $HOME '.agents/personas'
$CoreMode = $false
$CoreSkills = @(
    'development/git-commit-pr',
    'context/context-manager',
    'context/static-index',
    'security/security-auditor',
    'agents/background-implementer',
    'agents/background-planner',
    'agents/background-reviewer'
)
$Targets = @()
$ExcludeDirs = @('static', 'cli', 'codex-support', 'hooks', 'personas', '.git', '.github', '.agents', 'node_modules', '__pycache__')

function Normalize-Path {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $Path }
    if ($Path.StartsWith('~')) {
        $Path = Join-Path $HOME $Path.Substring(2)
    }
    return [IO.Path]::GetFullPath($Path)
}

function Write-Info { param($Message) if (-not $Quiet) { Write-Host "[INFO] $Message" -ForegroundColor Cyan } }
function Write-Success { param($Message) if (-not $Quiet) { Write-Host "[OK]   $Message" -ForegroundColor Green } }
function Write-Warn { param($Message) Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-ErrorMsg { param($Message) Write-Host "[ERROR] $Message" -ForegroundColor Red }
function Write-Dry { param($Message) Write-Host "[DRY]  $Message" -ForegroundColor Magenta }

function Show-Usage {
    Write-Host @"
Usage: install.ps1 [options] [group/skill...]

Options:
  -h, --help          Show this help
  -l, --list          Show available skills
  -u, --uninstall     Remove instead of install
  -c, --copy          Copy instead of link
  -n, --dry-run       Preview actions without changes
  -q, --quiet         Reduce output
  --prefix VALUE      Add prefix to installed skill names
  --postfix VALUE     Add postfix to installed skill names
  --target DIR        Install path (default: ~/.claude/skills)
  --core              Install core skills only (workspace common)

Static:
  --link-static       Link static/ -> ~/.agents
  --unlink-static     Remove ~/.agents link

CLI:
  --cli               Install agt CLI tool (~/.local/bin)
  --alias NAME        Extra alias for CLI (repeatable)
  --uninstall-cli     Remove CLI and aliases

Hooks:
  --hooks             Install Claude Code hooks (~/.claude/hooks)
  --uninstall-hooks   Remove installed hooks

Personas:
  --personas          Install agent personas (~/.agents/personas)

Codex:
  --codex             Setup Codex CLI support (AGENTS.md + skills symlink)

Examples:
  ./install.ps1
  ./install.ps1 --core                    # Core skills only (recommended)
  ./install.ps1 --core --cli --link-static  # Core + CLI + static
  ./install.ps1 agents
  ./install.ps1 agents/background-planner development/git-commit-pr
  ./install.ps1 --hooks                   # Install hooks
  ./install.ps1 --codex                   # Codex CLI support
  ./install.ps1 --list
"@
    exit 0
}

function Ensure-Directory {
    param([string]$Path)
    if ($DryRun) {
        Write-Dry "Create directory: $Path"
        return
    }
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Remove-Existing {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    if ($DryRun) {
        Write-Dry "Remove existing: $Path"
        return
    }
    Remove-Item -LiteralPath $Path -Recurse -Force
}

function New-Link {
    param(
        [string]$Path,
        [string]$Target
    )

    $isDirectory = Test-Path -LiteralPath $Target -PathType Container
    try {
        New-Item -ItemType SymbolicLink -Path $Path -Target $Target -Force | Out-Null
        return 'SymbolicLink'
    } catch {
        if ($isDirectory) {
            try {
                New-Item -ItemType Junction -Path $Path -Target $Target -Force | Out-Null
                return 'Junction'
            } catch {
                throw
            }
        }
        throw
    }
}

function Get-SkillsInGroup {
    param([string]$Group)
    $groupDir = Join-Path $ScriptDir $Group
    if (-not (Test-Path -LiteralPath $groupDir -PathType Container)) { return @() }
    return @(Get-ChildItem -Path $groupDir -Directory -Force |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'SKILL.md') } |
        ForEach-Object { $_.Name })
}

function Get-SkillGroups {
    $groups = @()
    Get-ChildItem -Path $ScriptDir -Directory -Force |
        Where-Object { -not $ExcludeDirs.Contains($_.Name) -and ($_.Name -notlike '.*') } |
        ForEach-Object {
            $skills = Get-SkillsInGroup $_.Name
            if (@($skills).Count -gt 0) { $groups += $_.Name }
        }
    return $groups
}

function Extract-Description {
    param(
        [string]$SkillFile,
        [int]$MaxLen = 50
    )
    try {
        $content = Get-Content -LiteralPath $SkillFile -Raw
        $frontmatter = [regex]::Match($content, '^---\s*(.*?)\s*---', 'Singleline')
        if (-not $frontmatter.Success) { return '' }
        $descMatch = [regex]::Match($frontmatter.Groups[1].Value, '^description:\s*(.+?)(\r?\n(?!\s)|$)', 'Singleline')
        if (-not $descMatch.Success) { return '' }
        $desc = $descMatch.Groups[1].Value.Trim()
        if ($desc.Length -gt $MaxLen) { $desc = $desc.Substring(0, $MaxLen - 3) + '...' }
        return $desc
    } catch {
        return ''
    }
}

function List-Skills {
    $groups = Get-SkillGroups
    Write-Host ''
    Write-Host 'Available skills' -ForegroundColor Cyan
    Write-Host '================='
    foreach ($group in $groups) {
        $skills = Get-SkillsInGroup $group
        Write-Host "$group/"
        foreach ($skill in $skills) {
            $skillPath = Join-Path (Join-Path $ScriptDir $group) $skill
            $desc = Extract-Description (Join-Path $skillPath 'SKILL.md') 45
            if ([string]::IsNullOrEmpty($desc)) { $desc = '(no description)' }
            Write-Host ("  - {0,-25} {1}" -f $skill, $desc) -ForegroundColor Green
        }
        Write-Host ''
    }

    Write-Host 'Static directory' -ForegroundColor Cyan
    Write-Host '================'
    if (Test-Path -LiteralPath $StaticTarget) {
        $item = Get-Item -LiteralPath $StaticTarget -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            $target = ''
            $linkProp = $item.PSObject.Properties['LinkTarget']
            if ($linkProp) { $target = $linkProp.Value }
            Write-Host "  Link present: $StaticTarget -> $target" -ForegroundColor Green
        } elseif ($item.PSIsContainer) {
            Write-Host "  Directory exists (not a link): $StaticTarget" -ForegroundColor Yellow
        } else {
            Write-Host "  File exists (not a link): $StaticTarget" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  Not found: $StaticTarget" -ForegroundColor Red
    }
}

function Install-Skill {
    param(
        [string]$Group,
        [string]$Skill
    )

    $sourcePath = Join-Path (Join-Path $ScriptDir $Group) $Skill
    $skillFile = Join-Path $sourcePath 'SKILL.md'
    if (-not (Test-Path -LiteralPath $skillFile)) {
        Write-ErrorMsg "SKILL.md not found for ${Group}/${Skill}"
        return
    }

    $targetName = "${Prefix}${Skill}${Postfix}"
    $targetPath = Join-Path $TargetDir $targetName

    if (Test-Path -LiteralPath $targetPath) {
        if ($DryRun) {
            Write-Dry "Overwrite existing: $targetName"
        } else {
            Write-Warn "Overwriting existing: $targetName"
            Remove-Existing $targetPath
        }
    }

    if ($DryRun) {
        if ($CopyMode) {
            Write-Dry "Copy ${Group}/${Skill} -> $targetName"
        } else {
            Write-Dry "Link ${Group}/${Skill} -> $targetName"
        }
        return
    }

    if ($CopyMode) {
        Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Recurse -Force
        Write-Success "Copied ${Group}/${Skill} -> $targetName"
    } else {
        try {
            $linkType = New-Link -Path $targetPath -Target $sourcePath
            Write-Success "Linked (${linkType}) ${Group}/${Skill} -> $targetName"
        } catch {
            Write-ErrorMsg "Link failed for ${Group}/${Skill}: $_. Enable Developer Mode/Admin or rerun with --copy."
            throw
        }
    }
}

function Uninstall-Skill {
    param(
        [string]$Group,
        [string]$Skill
    )

    $targetName = "${Prefix}${Skill}${Postfix}"
    $targetPath = Join-Path $TargetDir $targetName
    if (-not (Test-Path -LiteralPath $targetPath)) {
        Write-Warn "Not installed: $targetName"
        return
    }

    if ($DryRun) {
        Write-Dry "Remove: $targetName"
    } else {
        Remove-Existing $targetPath
        Write-Success "Removed: $targetName"
    }
}

function Install-Group {
    param([string]$Group)
    $skills = @(Get-SkillsInGroup $Group)
    if ($skills.Count -eq 0) {
        Write-Warn "No skills found in group: $Group"
        return
    }
    Write-Info "Processing group: $Group"
    foreach ($skill in $skills) {
        if ($Uninstall) {
            Uninstall-Skill -Group $Group -Skill $skill
        } else {
            Install-Skill -Group $Group -Skill $skill
        }
    }
}

function Install-All {
    $groups = Get-SkillGroups
    foreach ($group in $groups) {
        Install-Group -Group $group
    }
}

function Install-Core {
    Write-Info "Installing core skills... ($($CoreSkills.Count) skills)"
    Write-Host ''

    foreach ($skillPath in $CoreSkills) {
        $parts = $skillPath -split '/', 2
        $group = $parts[0]
        $skill = $parts[1]

        if ($Uninstall) {
            Uninstall-Skill -Group $group -Skill $skill
        } else {
            Install-Skill -Group $group -Skill $skill
        }
    }

    Write-Host ''
    Write-Info "Core skills installed. For additional skills per workspace:"
    Write-Host "  agt skill install <skill-name>"
}

function Install-Codex {
    if (-not (Test-Path -LiteralPath $CodexAgentsSource -PathType Leaf)) {
        Write-ErrorMsg "Codex AGENTS.md not found: $CodexAgentsSource"
        exit 1
    }

    $codexAgentsTarget = Join-Path $CodexTarget 'AGENTS.md'
    $codexSkillsTarget = Join-Path $CodexTarget 'skills'
    $claudeSkillsSource = Join-Path $HOME '.claude/skills'

    if ($DryRun) {
        Write-Dry "Ensure directory: $CodexTarget"
        if (Test-Path -LiteralPath $codexAgentsTarget) {
            Write-Dry "Append skill guide to AGENTS.md: $codexAgentsTarget"
        } else {
            Write-Dry "Create AGENTS.md: $codexAgentsTarget"
        }
        Write-Dry "Link: $codexSkillsTarget -> $claudeSkillsSource"
        return
    }

    # Create ~/.codex directory
    Ensure-Directory $CodexTarget

    # Handle AGENTS.md
    if (Test-Path -LiteralPath $codexAgentsTarget -PathType Leaf) {
        $existingContent = Get-Content -LiteralPath $codexAgentsTarget -Raw
        if ($existingContent -match 'Claude Skills \(SKILL\.md\)') {
            Write-Warn "AGENTS.md already contains skill guide."
            Write-Warn "Remove the existing skill section manually, then re-run."
        } else {
            Write-Info "Appending skill guide to existing AGENTS.md..."
            $separator = "`n`n# ====================================================`n# agt Integration (auto-generated)`n# ====================================================`n`n"
            $skillGuide = Get-Content -LiteralPath $CodexAgentsSource -Raw
            Add-Content -LiteralPath $codexAgentsTarget -Value ($separator + $skillGuide)
            Write-Success "Skill guide appended to AGENTS.md (existing content preserved)"
        }
    } else {
        Copy-Item -LiteralPath $CodexAgentsSource -Destination $codexAgentsTarget
        Write-Success "AGENTS.md created: $codexAgentsTarget"
    }

    # Skills symlink
    if (-not (Test-Path -LiteralPath $claudeSkillsSource -PathType Container)) {
        Write-Warn "Claude skills directory not found: $claudeSkillsSource"
        Write-Info "Install skills first: ./install.ps1"
    }

    if (Test-Path -LiteralPath $codexSkillsTarget) {
        $item = Get-Item -LiteralPath $codexSkillsTarget -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            $linkTarget = ''
            $linkProp = $item.PSObject.Properties['LinkTarget']
            if ($linkProp) { $linkTarget = $linkProp.Value }
            if ($linkTarget -eq $claudeSkillsSource) {
                Write-Info "Skills symlink already correctly set"
            } else {
                Write-Warn "Replacing existing symlink: $codexSkillsTarget"
                Remove-Existing $codexSkillsTarget
                $linkType = New-Link -Path $codexSkillsTarget -Target $claudeSkillsSource
                Write-Success "Link created: ~/.codex/skills -> ~/.claude/skills ($linkType)"
            }
        } elseif ($item.PSIsContainer) {
            $backup = "${codexSkillsTarget}.backup"
            Write-Warn "Backing up existing directory to: $backup"
            Move-Item -LiteralPath $codexSkillsTarget -Destination $backup -Force
            $linkType = New-Link -Path $codexSkillsTarget -Target $claudeSkillsSource
            Write-Success "Link created: ~/.codex/skills -> ~/.claude/skills ($linkType)"
        }
    } else {
        try {
            $linkType = New-Link -Path $codexSkillsTarget -Target $claudeSkillsSource
            Write-Success "Link created: ~/.codex/skills -> ~/.claude/skills ($linkType)"
        } catch {
            Write-ErrorMsg "Failed to create codex skills link: $_"
        }
    }

    Write-Host ''
    Write-Info "Codex CLI can now use skills"
    Write-Info "AGENTS.md: $codexAgentsTarget"
    Write-Info "Skills: $codexSkillsTarget -> $claudeSkillsSource"
}

function Install-Hooks {
    if (-not (Test-Path -LiteralPath $HooksRegistry -PathType Leaf)) {
        Write-ErrorMsg "hooks.json not found: $HooksRegistry"
        exit 1
    }

    Write-Info "Installing hooks..."

    $registry = Get-Content -LiteralPath $HooksRegistry -Raw | ConvertFrom-Json

    foreach ($hookName in $registry.PSObject.Properties.Name) {
        $hookConfig = $registry.$hookName
        $hookType = if ($hookConfig.PSObject.Properties['type']) { $hookConfig.type } else { 'command' }

        if ($hookType -ne 'command') {
            Write-Info "Registered: $hookName ($hookType type, no script needed)"
            continue
        }

        $script = if ($hookConfig.PSObject.Properties['script']) { $hookConfig.script } else { '' }
        if ([string]::IsNullOrEmpty($script)) { continue }

        $sourcePath = Join-Path $HooksSource $script
        $targetPath = Join-Path $HooksTarget $script

        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            Write-Warn "Script not found: $sourcePath"
            continue
        }

        if ($DryRun) {
            Write-Dry "Link: $sourcePath -> $targetPath"
        } else {
            Ensure-Directory $HooksTarget
            Remove-Existing $targetPath

            if ($CopyMode) {
                Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
                Write-Success "Copied: $hookName ($script)"
            } else {
                try {
                    $linkType = New-Link -Path $targetPath -Target $sourcePath
                    Write-Success "Linked: $hookName ($script) ($linkType)"
                } catch {
                    Write-ErrorMsg "Failed to link hook $hookName : $_"
                }
            }
        }
    }

    # Merge hook settings into settings.json
    $settingsFile = Join-Path $HOME '.claude/settings.json'

    if ($DryRun) {
        Write-Dry "Merge hook settings into: $settingsFile"
        return
    }

    if (-not (Test-Path -LiteralPath $settingsFile -PathType Leaf)) {
        Ensure-Directory (Split-Path $settingsFile -Parent)
        '{}' | Set-Content -LiteralPath $settingsFile
    }

    $settings = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json
    if (-not $settings.PSObject.Properties['hooks']) {
        $settings | Add-Member -MemberType NoteProperty -Name 'hooks' -Value ([PSCustomObject]@{})
    }

    foreach ($hookName in $registry.PSObject.Properties.Name) {
        $hookConfig = $registry.$hookName
        $event = $hookConfig.event
        $hookType = if ($hookConfig.PSObject.Properties['type']) { $hookConfig.type } else { 'command' }

        if (-not $settings.hooks.PSObject.Properties[$event]) {
            $settings.hooks | Add-Member -MemberType NoteProperty -Name $event -Value @()
        }

        # Build identifier for dedup
        if ($hookType -eq 'command') {
            $scriptPath = Join-Path $HooksTarget $hookConfig.script
            $identifier = "bash $scriptPath"
        } else {
            $identifier = if ($hookConfig.PSObject.Properties['prompt']) { $hookConfig.prompt.Substring(0, [Math]::Min(80, $hookConfig.prompt.Length)) } else { '' }
        }

        # Check for duplicates
        $alreadyExists = $false
        foreach ($entry in $settings.hooks.$event) {
            foreach ($h in $entry.hooks) {
                if ($hookType -eq 'command' -and $h.PSObject.Properties['command'] -and $h.command -eq $identifier) {
                    $alreadyExists = $true; break
                }
                if ($hookType -eq 'prompt' -and $h.PSObject.Properties['prompt'] -and $h.prompt.Substring(0, [Math]::Min(80, $h.prompt.Length)) -eq $identifier) {
                    $alreadyExists = $true; break
                }
            }
        }

        if (-not $alreadyExists) {
            $h = [PSCustomObject]@{ type = $hookType }
            if ($hookType -eq 'command') {
                $h | Add-Member -MemberType NoteProperty -Name 'command' -Value $identifier
            } elseif ($hookType -eq 'prompt') {
                $h | Add-Member -MemberType NoteProperty -Name 'prompt' -Value $hookConfig.prompt
            }
            if ($hookConfig.PSObject.Properties['statusMessage']) {
                $h | Add-Member -MemberType NoteProperty -Name 'statusMessage' -Value $hookConfig.statusMessage
            }
            if ($hookConfig.PSObject.Properties['model']) {
                $h | Add-Member -MemberType NoteProperty -Name 'model' -Value $hookConfig.model
            }

            $hookEntry = [PSCustomObject]@{ hooks = @($h) }
            if ($hookConfig.PSObject.Properties['matcher']) {
                $hookEntry | Add-Member -MemberType NoteProperty -Name 'matcher' -Value $hookConfig.matcher
            }

            $settings.hooks.$event = @($settings.hooks.$event) + @($hookEntry)
        }
    }

    $settings | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $settingsFile
    Write-Success "Hook settings merged into settings.json"

    Write-Host ''
    Write-Info "Installed hooks:"
    foreach ($hookName in $registry.PSObject.Properties.Name) {
        $desc = if ($registry.$hookName.PSObject.Properties['description']) { $registry.$hookName.description } else { '' }
        Write-Info "  - ${hookName}: $desc"
    }
}

function Uninstall-Hooks {
    Write-Info "Removing hooks..."

    if (-not (Test-Path -LiteralPath $HooksRegistry -PathType Leaf)) {
        Write-Warn "hooks.json not found"
        return
    }

    $registry = Get-Content -LiteralPath $HooksRegistry -Raw | ConvertFrom-Json

    # Remove hook script files
    foreach ($hookName in $registry.PSObject.Properties.Name) {
        $hookConfig = $registry.$hookName
        $script = if ($hookConfig.PSObject.Properties['script']) { $hookConfig.script } else { '' }
        if ([string]::IsNullOrEmpty($script)) { continue }

        $targetPath = Join-Path $HooksTarget $script
        if (Test-Path -LiteralPath $targetPath) {
            Remove-Existing $targetPath
            Write-Success "Script removed: $script"
        }
    }

    # Remove hook settings from settings.json
    $settingsFile = Join-Path $HOME '.claude/settings.json'
    if (Test-Path -LiteralPath $settingsFile -PathType Leaf) {
        $settings = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json
        if ($settings.PSObject.Properties['hooks']) {
            foreach ($hookName in $registry.PSObject.Properties.Name) {
                $hookConfig = $registry.$hookName
                $event = $hookConfig.event
                $hookType = if ($hookConfig.PSObject.Properties['type']) { $hookConfig.type } else { 'command' }

                if (-not $settings.hooks.PSObject.Properties[$event]) { continue }

                if ($hookType -eq 'command') {
                    $scriptPath = Join-Path $HooksTarget $hookConfig.script
                    $command = "bash $scriptPath"
                    $settings.hooks.$event = @($settings.hooks.$event | Where-Object {
                        -not ($_.hooks | Where-Object { $_.PSObject.Properties['command'] -and $_.command -eq $command })
                    })
                } else {
                    $promptPrefix = if ($hookConfig.PSObject.Properties['prompt']) { $hookConfig.prompt.Substring(0, [Math]::Min(80, $hookConfig.prompt.Length)) } else { '' }
                    $settings.hooks.$event = @($settings.hooks.$event | Where-Object {
                        -not ($_.hooks | Where-Object { $_.PSObject.Properties['prompt'] -and $_.prompt.Substring(0, [Math]::Min(80, $_.prompt.Length)) -eq $promptPrefix })
                    })
                }

                if ($settings.hooks.$event.Count -eq 0) {
                    $settings.hooks.PSObject.Properties.Remove($event)
                }
            }

            if ($settings.hooks.PSObject.Properties.Count -eq 0) {
                $settings.PSObject.Properties.Remove('hooks')
            }

            $settings | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $settingsFile
            Write-Success "Hook settings removed from settings.json"
        }
    }
}

function Link-Static {
    if (-not (Test-Path -LiteralPath $StaticSource -PathType Container)) {
        Write-ErrorMsg "Missing static directory: $StaticSource"
        exit 1
    }

    if (Test-Path -LiteralPath $StaticTarget) {
        $item = Get-Item -LiteralPath $StaticTarget -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            if ($DryRun) {
                Write-Dry "Remove existing link: $StaticTarget"
            } else {
                Write-Warn "Removing existing link: $StaticTarget"
                Remove-Existing $StaticTarget
            }
        } elseif ($item.PSIsContainer) {
            $backup = "${StaticTarget}.backup"
            if ($DryRun) {
                Write-Dry "Backup existing directory to: $backup"
            } else {
                Write-Warn "Backing up existing directory to: $backup"
                Move-Item -LiteralPath $StaticTarget -Destination $backup -Force
            }
        } else {
            if ($DryRun) {
                Write-Dry "Remove file: $StaticTarget"
            } else {
                Remove-Existing $StaticTarget
            }
        }
    }

    if ($DryRun) {
        Write-Dry "Link ~/.agents -> $StaticSource"
        return
    }

    try {
        $linkType = New-Link -Path $StaticTarget -Target $StaticSource
        Write-Success "Linked ~/.agents -> $StaticSource ($linkType)"
    } catch {
        Write-ErrorMsg "Failed to create link for static directory: $_"
        exit 1
    }
}

function Unlink-Static {
    if (-not (Test-Path -LiteralPath $StaticTarget)) {
        Write-Warn "~/.agents does not exist"
        return
    }
    $item = Get-Item -LiteralPath $StaticTarget -Force
    if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        Write-Warn "~/.agents is not a link; remove manually if needed"
        return
    }

    if ($DryRun) {
        Write-Dry "Remove link: $StaticTarget"
    } else {
        Remove-Existing $StaticTarget
        Write-Success "Removed link: ~/.agents"
    }
}

function Install-Cli {
    $cliTools = @('claude-skill', 'agent-skill', 'agent-persona', 'agt')

    if ($DryRun) {
        Write-Dry "Ensure directory: $CliTarget"
        foreach ($tool in $cliTools) {
            Write-Dry "Link CLI: $(Join-Path $CliTarget $tool) -> $(Join-Path $ScriptDir "cli/$tool")"
        }
        foreach ($alias in $CliAliases) {
            Write-Dry "Alias -> $(Join-Path $CliTarget $alias)"
        }
        return
    }

    Ensure-Directory $CliTarget

    foreach ($tool in $cliTools) {
        $source = Join-Path $ScriptDir "cli/$tool"
        $target = Join-Path $CliTarget $tool

        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            Write-Warn "CLI script not found: $source"
            continue
        }

        Remove-Existing $target
        try {
            $linkType = New-Link -Path $target -Target $source
            Write-Success "CLI installed: $target ($linkType)"
        } catch {
            Write-ErrorMsg "Failed to create CLI link for ${tool}: $_. Try running as admin or use --copy."
        }
    }

    # Aliases point to claude-skill
    $claudeSkillSource = Join-Path $ScriptDir 'cli/claude-skill'
    foreach ($alias in $CliAliases) {
        $aliasPath = Join-Path $CliTarget $alias
        Remove-Existing $aliasPath
        try {
            $linkType = New-Link -Path $aliasPath -Target $claudeSkillSource
            Write-Success "Alias installed: $aliasPath ($linkType)"
        } catch {
            Write-ErrorMsg ("Failed to create alias {0}: {1}" -f $alias, $_)
        }
    }

    Write-Info "Usage:"
    Write-Info "  agt skill list       (list skills)"
    Write-Info "  agt persona list     (list personas)"
    Write-Info "  agt run ""prompt""     (run skills)"

    if (-not ($env:PATH -split ';' | Where-Object { $_ -eq $CliTarget })) {
        Write-Warn "$CliTarget is not in PATH."
        Write-Info "Add it to your PATH environment variable."
    }
}

function Uninstall-Cli {
    $cliTools = @('claude-skill', 'agent-skill', 'agent-persona', 'agt')
    $removed = $false

    foreach ($tool in $cliTools) {
        $source = Join-Path $ScriptDir "cli/$tool"
        $target = Join-Path $CliTarget $tool

        if (Test-Path -LiteralPath $target) {
            if ($DryRun) {
                Write-Dry "Remove CLI: $target"
            } else {
                Remove-Existing $target
                Write-Success "Removed CLI: $target"
            }
            $removed = $true
        }

        # Remove aliases pointing to this tool
        if (Test-Path -LiteralPath $CliTarget -PathType Container) {
            Get-ChildItem -Path $CliTarget -Force |
                Where-Object {
                    $_.Attributes -band [IO.FileAttributes]::ReparsePoint -and
                    ($_.PSObject.Properties['LinkTarget'] -and $_.LinkTarget -eq $source)
                } |
                ForEach-Object {
                    if ($DryRun) {
                        Write-Dry "Remove alias: $($_.FullName)"
                    } else {
                        Remove-Existing $_.FullName
                        Write-Success "Removed alias: $($_.FullName)"
                    }
                    $removed = $true
                }
        }
    }

    if (-not $removed) {
        Write-Warn 'CLI not installed'
    }
}

function Install-Personas {
    if (-not (Test-Path -LiteralPath $PersonasSource -PathType Container)) {
        Write-ErrorMsg "Personas directory not found: $PersonasSource"
        exit 1
    }

    Write-Info "Installing personas..."
    Ensure-Directory $PersonasTarget

    $installed = 0
    Get-ChildItem -Path $PersonasSource -Filter '*.md' -File | Where-Object { $_.Name -ne 'README.md' } | ForEach-Object {
        $targetPath = Join-Path $PersonasTarget $_.Name

        if ($DryRun) {
            Write-Dry "Link: $($_.Name)"
            $script:installed++
            return
        }

        Remove-Existing $targetPath

        if ($CopyMode) {
            Copy-Item -LiteralPath $_.FullName -Destination $targetPath
            Write-Success "Copied: $($_.Name)"
        } else {
            try {
                $linkType = New-Link -Path $targetPath -Target $_.FullName
                Write-Success "Linked: $($_.Name) ($linkType)"
            } catch {
                Write-ErrorMsg "Failed to link persona $($_.Name): $_"
            }
        }
        $script:installed++
    }

    Write-Info "$installed personas installed ($PersonasTarget)"
}

if (-not $ScriptArgs) { $ScriptArgs = @() }
for ($i = 0; $i -lt $ScriptArgs.Count; $i++) {
    $arg = $ScriptArgs[$i]
    switch ($arg) {
        '-h' { Show-Usage }
        '--help' { Show-Usage }
        '-l' { $ListMode = $true; continue }
        '--list' { $ListMode = $true; continue }
        '-u' { $Uninstall = $true; continue }
        '--uninstall' { $Uninstall = $true; continue }
        '-c' { $CopyMode = $true; continue }
        '--copy' { $CopyMode = $true; continue }
        '-n' { $DryRun = $true; continue }
        '--dry-run' { $DryRun = $true; continue }
        '-q' { $Quiet = $true; continue }
        '--quiet' { $Quiet = $true; continue }
        '--prefix' { $Prefix = $ScriptArgs[++$i]; continue }
        '--postfix' { $Postfix = $ScriptArgs[++$i]; continue }
        '--suffix' { $Postfix = $ScriptArgs[++$i]; continue }
        '--target' { $TargetDir = $ScriptArgs[++$i]; continue }
        '--link-static' { $LinkStatic = $true; continue }
        '--unlink-static' { $UnlinkStatic = $true; continue }
        '--cli' { $InstallCli = $true; continue }
        { $_ -like '--alias=*' } { $CliAliases += $arg.Split('=')[1]; continue }
        '--alias' { $CliAliases += $ScriptArgs[++$i]; continue }
        '--uninstall-cli' { $UninstallCli = $true; continue }
        '--codex' { $InstallCodex = $true; continue }
        '--hooks' { $InstallHooks = $true; continue }
        '--uninstall-hooks' { $UninstallHooks = $true; continue }
        '--personas' { $InstallPersonas = $true; continue }
        '--core' { $CoreMode = $true; continue }
        default { $Targets += $arg }
    }
}

$TargetDir = Normalize-Path $TargetDir
$StaticSource = Normalize-Path $StaticSource
$StaticTarget = Normalize-Path $StaticTarget
$CliTarget = Normalize-Path $CliTarget

# Standalone uninstall operations (exit immediately)
if ($UnlinkStatic) { Unlink-Static; exit 0 }
if ($UninstallCli) { Uninstall-Cli; exit 0 }
if ($UninstallHooks) { Uninstall-Hooks; exit 0 }
if ($ListMode) { List-Skills; exit 0 }

# Combinable install options (run before skill installation)
if ($LinkStatic) { Link-Static; Write-Host '' }
if ($InstallCli) { Install-Cli; Write-Host '' }
if ($InstallCodex) { Install-Codex; Write-Host '' }
if ($InstallHooks) { Install-Hooks; Write-Host '' }
if ($InstallPersonas) { Install-Personas; Write-Host '' }

# If only non-skill options were specified (no targets and not core mode), exit
if ($Targets.Count -eq 0 -and -not $CoreMode -and ($LinkStatic -or $InstallCli -or $InstallCodex -or $InstallHooks -or $InstallPersonas)) {
    exit 0
}

if (-not $DryRun) { Ensure-Directory $TargetDir }

if (-not $Quiet -and -not $DryRun) {
    Write-Host ''
    Write-Host 'agt Installer (Windows)' -ForegroundColor Cyan
    Write-Host '==============================='
    Write-Host ("Mode: {0}" -f ($(if ($Uninstall) { 'Uninstall' } elseif ($CopyMode) { 'Copy' } else { 'Link' })))
    Write-Host "Target: $TargetDir"
    if ($Prefix) { Write-Host "Prefix: $Prefix" }
    if ($Postfix) { Write-Host "Postfix: $Postfix" }
    Write-Host ''
}

$skillGroups = Get-SkillGroups

$targetsArray = @($Targets)

if ($CoreMode) {
    # Core skills only
    Install-Core
} elseif ($targetsArray.Count -eq 0 -or $targetsArray[0] -eq 'all') {
    if ($Uninstall) {
        foreach ($group in $skillGroups) {
            foreach ($skill in Get-SkillsInGroup $group) {
                Uninstall-Skill -Group $group -Skill $skill
            }
        }
    } else {
        Install-All
    }
} else {
    foreach ($target in $Targets) {
        if ($target -match '[/\\]') {
            $parts = $target -split '[/\\]', 2
            $group = $parts[0]
            $skill = $parts[1]
            if ($Uninstall) {
                Uninstall-Skill -Group $group -Skill $skill
            } else {
                Install-Skill -Group $group -Skill $skill
            }
        } else {
            Install-Group -Group $target
        }
    }
}

if (-not $Quiet) {
    Write-Host ''
    if ($DryRun) {
        Write-Host '[DRY-RUN] No changes were made.' -ForegroundColor Magenta
    } elseif ($Uninstall) {
        Write-Host 'Uninstall complete.' -ForegroundColor Green
    } else {
        Write-Host 'Install complete.' -ForegroundColor Green
        Write-Host "Installed skills: $(Join-Path $TargetDir '*')"
    }
    Write-Host ''
}
