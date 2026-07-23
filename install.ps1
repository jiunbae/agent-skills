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
$UserHome = if ($env:AGT_USER_HOME) { $env:AGT_USER_HOME } else { $HOME }
$TargetDir = Join-Path $UserHome '.claude/skills'
$StaticSource = Join-Path $ScriptDir 'static'
$StaticTarget = Join-Path $UserHome '.agents'
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
$CliTarget = Join-Path $UserHome '.local/bin'
$CliAliases = @()
$InstallCodex = $false
$DefaultClaudeSkillsTarget = Join-Path $UserHome '.claude/skills'
$CodexSkillsTarget = Join-Path $UserHome '.agents/skills'
$LegacyCodexSkillsTarget = Join-Path $UserHome '.codex/skills'
$InstallHooks = $false
$UninstallHooks = $false
$HooksSource = Join-Path $ScriptDir 'hooks'
$HooksTarget = Join-Path $UserHome '.claude/hooks'
$HooksRegistry = Join-Path $HooksSource 'hooks.json'
$InstallPersonas = $false
$PersonasSource = Join-Path $ScriptDir 'personas'
$PersonasTarget = Join-Path $UserHome '.agents/personas'
$CoreMode = $false
$CoreSkills = @(
    'development/git-commit-pr',
    'context/context-manager',
    'context/static-index',
    'security/security-auditor',
    'agents/background-implementer',
    'agents/background-planner',
    'agents/background-reviewer',
    'agents/rpf'
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
  --link-static       Link each static/* item under ~/.agents
  --unlink-static     Remove only static links managed by this installer

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
  --codex             Link selected skills individually under ~/.agents/skills
                      (also links static/* items under ~/.agents)

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

function Get-LinkTargetPath {
    param([string]$Path)

    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if (-not $item -or -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        return ''
    }

    $rawTarget = $null
    $linkProp = $item.PSObject.Properties['LinkTarget']
    if ($linkProp) { $rawTarget = $linkProp.Value }
    if (-not $rawTarget) {
        $targetProp = $item.PSObject.Properties['Target']
        if ($targetProp) { $rawTarget = $targetProp.Value }
    }
    if ($rawTarget -is [Array]) { $rawTarget = $rawTarget[0] }
    if ([string]::IsNullOrWhiteSpace([string]$rawTarget)) { return '' }

    $target = [string]$rawTarget
    if (-not [IO.Path]::IsPathRooted($target)) {
        $target = Join-Path (Split-Path -Parent $Path) $target
    }
    return (Normalize-Path $target)
}

function Test-ManagedLink {
    param(
        [string]$Path,
        [string]$Target
    )
    $resolvedTarget = Get-LinkTargetPath $Path
    if ([string]::IsNullOrEmpty($resolvedTarget)) { return $false }
    return ($resolvedTarget -eq (Normalize-Path $Target))
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
            Write-Host "  Legacy link present: $StaticTarget -> $target" -ForegroundColor Yellow
        } elseif ($item.PSIsContainer) {
            Write-Host "  Integrated directory: $StaticTarget" -ForegroundColor Green
        } else {
            Write-Host "  File exists (not a link): $StaticTarget" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  Not found: $StaticTarget" -ForegroundColor Red
    }
}

function Copy-SkillTree {
    param(
        [string]$Source,
        [string]$Destination
    )

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        if ($item.Name -eq 'node_modules') {
            continue
        }

        $destinationItem = Join-Path $Destination $item.Name
        if (
            $item.PSIsContainer -and
            -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
        ) {
            Copy-SkillTree -Source $item.FullName -Destination $destinationItem
        } else {
            Copy-Item -LiteralPath $item.FullName -Destination $destinationItem -Force
        }
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

    $existingTarget = Get-Item -LiteralPath $targetPath -Force -ErrorAction SilentlyContinue
    if ($existingTarget) {
        if ($DryRun) {
            Write-Dry "Overwrite existing: $targetName"
        } elseif ($existingTarget.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            Write-Warn "Updating existing skill link: $targetName"
            Remove-Item -LiteralPath $targetPath -Force
        } else {
            throw "Refusing to overwrite existing file or directory: $targetPath"
        }
    }

    if ($DryRun) {
        if ($CopyMode) {
            Write-Dry "Copy ${Group}/${Skill} -> $targetName"
        } else {
            Write-Dry "Link ${Group}/${Skill} -> $targetName"
        }
        Install-CodexSkillLink -SourcePath $sourcePath -TargetName $targetName
        return
    }

    if ($CopyMode) {
        Copy-SkillTree -Source $sourcePath -Destination $targetPath
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

    Install-CodexSkillLink -SourcePath $sourcePath -TargetName $targetName
}

function Uninstall-Skill {
    param(
        [string]$Group,
        [string]$Skill
    )

    $sourcePath = Join-Path (Join-Path $ScriptDir $Group) $Skill
    $targetName = "${Prefix}${Skill}${Postfix}"
    $targetPath = Join-Path $TargetDir $targetName
    if (-not (Test-Path -LiteralPath $targetPath)) {
        Write-Warn "Not installed: $targetName"
    } elseif ($DryRun) {
        Write-Dry "Remove: $targetName"
    } else {
        Remove-Existing $targetPath
        Write-Success "Removed: $targetName"
    }

    Uninstall-CodexSkillLink -SourcePath $sourcePath -TargetName $targetName
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

function Migrate-LegacyCodexSkillsRoot {
    $item = Get-Item -LiteralPath $LegacyCodexSkillsTarget -Force -ErrorAction SilentlyContinue
    if (-not $item -or -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        return
    }

    $currentTarget = Get-LinkTargetPath $LegacyCodexSkillsTarget
    if ($currentTarget -ne (Normalize-Path $DefaultClaudeSkillsTarget)) {
        Write-Warn "Preserving unmanaged Codex link: $LegacyCodexSkillsTarget -> $currentTarget"
        return
    }

    $backup = "${LegacyCodexSkillsTarget}.backup"
    $backupItem = Get-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    $hasRestorableBackup = (
        $backupItem -and
        $backupItem.PSIsContainer -and
        -not ($backupItem.Attributes -band [IO.FileAttributes]::ReparsePoint)
    )
    if ($DryRun) {
        Write-Dry "Remove legacy Codex root link: $LegacyCodexSkillsTarget"
        if ($hasRestorableBackup) {
            Write-Dry "Restore Codex skills backup: $backup"
        }
        return
    }

    Remove-Item -LiteralPath $LegacyCodexSkillsTarget -Force
    Write-Success "Removed legacy Codex root link: $LegacyCodexSkillsTarget"
    if ($hasRestorableBackup) {
        Move-Item -LiteralPath $backup -Destination $LegacyCodexSkillsTarget
        Write-Success "Restored Codex skills backup: $LegacyCodexSkillsTarget"
    }
}

function Install-Codex {
    Migrate-LegacyCodexSkillsRoot
    Link-Static

    if ($DryRun) {
        Write-Dry "Prepare Codex user skills directory: $CodexSkillsTarget"
        Write-Dry "Preserve Codex-managed system skills: $LegacyCodexSkillsTarget/.system"
        return
    }

    Ensure-Directory $CodexSkillsTarget
    Write-Info "Codex user skills directory ready: $CodexSkillsTarget"
    Write-Info "Selected skills will be linked individually"
    Write-Info "Codex-managed system skills are unchanged: $LegacyCodexSkillsTarget/.system"
}

function Install-CodexSkillLink {
    param(
        [string]$SourcePath,
        [string]$TargetName
    )
    if (-not $InstallCodex) { return }

    $codexTarget = Join-Path $CodexSkillsTarget $TargetName
    $legacyTarget = Join-Path $LegacyCodexSkillsTarget $TargetName

    if ($DryRun) {
        Write-Dry "Codex skill link: $codexTarget -> $SourcePath"
        return
    }

    Ensure-Directory $CodexSkillsTarget
    $existing = Get-Item -LiteralPath $codexTarget -Force -ErrorAction SilentlyContinue
    if ($existing) {
        if (-not (Test-ManagedLink -Path $codexTarget -Target $SourcePath)) {
            throw "Refusing to overwrite existing Codex skill path: $codexTarget"
        }
        Write-Info "Codex skill link already correct: $TargetName"
    } else {
        $linkType = New-Link -Path $codexTarget -Target $SourcePath
        Write-Success "Codex linked: $TargetName ($linkType)"
    }

    $legacyRoot = Get-Item -LiteralPath $LegacyCodexSkillsTarget -Force -ErrorAction SilentlyContinue
    if ($legacyRoot -and -not ($legacyRoot.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        if (Test-ManagedLink -Path $legacyTarget -Target $SourcePath) {
            Remove-Item -LiteralPath $legacyTarget -Force
            Write-Success "Removed legacy Codex skill link: $legacyTarget"
        }
    }
}

function Uninstall-CodexSkillLink {
    param(
        [string]$SourcePath,
        [string]$TargetName
    )
    if (-not $InstallCodex) { return }

    $targets = @((Join-Path $CodexSkillsTarget $TargetName))
    $legacyRoot = Get-Item -LiteralPath $LegacyCodexSkillsTarget -Force -ErrorAction SilentlyContinue
    if (-not $legacyRoot -or -not ($legacyRoot.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        $targets += (Join-Path $LegacyCodexSkillsTarget $TargetName)
    }

    foreach ($target in $targets) {
        if (-not (Test-ManagedLink -Path $target -Target $SourcePath)) { continue }
        if ($DryRun) {
            Write-Dry "Remove Codex skill link: $target"
        } else {
            Remove-Item -LiteralPath $target -Force
            Write-Success "Removed Codex skill link: $target"
        }
    }
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
    $settingsFile = Join-Path $UserHome '.claude/settings.json'

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
    $settingsFile = Join-Path $UserHome '.claude/settings.json'
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

    $rootItem = Get-Item -LiteralPath $StaticTarget -Force -ErrorAction SilentlyContinue
    if ($rootItem -and ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        if (-not (Test-ManagedLink -Path $StaticTarget -Target $StaticSource)) {
            throw "Refusing to replace unmanaged ~/.agents link: $StaticTarget"
        }
        if ($DryRun) {
            Write-Dry "Convert legacy ~/.agents link to a directory: $StaticTarget"
        } else {
            Remove-Item -LiteralPath $StaticTarget -Force
            Ensure-Directory $StaticTarget
            Write-Success "Converted legacy ~/.agents link to a directory"
        }
    } elseif ($rootItem -and -not $rootItem.PSIsContainer) {
        throw "Refusing to replace non-directory path: $StaticTarget"
    } elseif (-not $rootItem -and -not $DryRun) {
        Ensure-Directory $StaticTarget
    }

    if (-not $DryRun) { Ensure-Directory $StaticTarget }

    Get-ChildItem -LiteralPath $StaticSource -Force | ForEach-Object {
        if ($_.Name -ne 'skills') {
            $targetPath = Join-Path $StaticTarget $_.Name
            $targetItem = Get-Item -LiteralPath $targetPath -Force -ErrorAction SilentlyContinue

            if ($targetItem) {
                if (-not (Test-ManagedLink -Path $targetPath -Target $_.FullName)) {
                    Write-Warn "Preserving existing user item: $targetPath"
                }
            } elseif ($DryRun) {
                Write-Dry "Static link: $targetPath -> $($_.FullName)"
            } else {
                try {
                    $linkType = New-Link -Path $targetPath -Target $_.FullName
                    Write-Success "Static linked: $($_.Name) ($linkType)"
                } catch {
                    throw "Failed to link static item $($_.Name). Enable Windows Developer Mode or run PowerShell as Administrator. $($_.Exception.Message)"
                }
            }
        }
    }
}

function Unlink-Static {
    $rootItem = Get-Item -LiteralPath $StaticTarget -Force -ErrorAction SilentlyContinue
    if (-not $rootItem) {
        Write-Warn "~/.agents does not exist"
        return
    }

    if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        if (-not (Test-ManagedLink -Path $StaticTarget -Target $StaticSource)) {
            Write-Warn "Preserving unmanaged ~/.agents link: $StaticTarget"
            return
        }
        if ($DryRun) {
            Write-Dry "Remove legacy static root link: $StaticTarget"
        } else {
            Remove-Item -LiteralPath $StaticTarget -Force
            Write-Success "Removed legacy static root link: $StaticTarget"
        }
        return
    }

    $separatorChars = [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $staticPrefix = (Normalize-Path $StaticSource).TrimEnd($separatorChars) + [IO.Path]::DirectorySeparatorChar
    Get-ChildItem -LiteralPath $StaticTarget -Force | ForEach-Object {
        $linkTarget = Get-LinkTargetPath $_.FullName
        if (-not [string]::IsNullOrEmpty($linkTarget) -and
            $linkTarget.StartsWith($staticPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            if ($DryRun) {
                Write-Dry "Remove static link: $($_.FullName)"
            } else {
                Remove-Item -LiteralPath $_.FullName -Force
                Write-Success "Removed static link: $($_.FullName)"
            }
        }
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
$DefaultClaudeSkillsTarget = Normalize-Path $DefaultClaudeSkillsTarget
$CodexSkillsTarget = Normalize-Path $CodexSkillsTarget
$LegacyCodexSkillsTarget = Normalize-Path $LegacyCodexSkillsTarget

# Standalone uninstall operations (exit immediately)
if ($UnlinkStatic) { Unlink-Static; exit 0 }
if ($UninstallCli) { Uninstall-Cli; exit 0 }
if ($UninstallHooks) { Uninstall-Hooks; exit 0 }
if ($ListMode) { List-Skills; exit 0 }

# Combinable install options (run before skill installation)
if ($LinkStatic) { Link-Static; Write-Host '' }
if ($InstallCli) { Install-Cli; Write-Host '' }
if ($InstallCodex -and -not $Uninstall) { Install-Codex; Write-Host '' }
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
