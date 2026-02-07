<#
Windows installer for Agent Skills.
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
$Targets = @()
$ExcludeDirs = @('static', 'cli', '.git', '.github', '.agents', 'node_modules', '__pycache__')

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
  --link-static       Link static/ -> ~/.agents
  --unlink-static     Remove ~/.agents link
  --cli               Install claude-skill CLI (~/.local/bin)
  --alias NAME        Extra alias for CLI (repeatable)
  --uninstall-cli     Remove CLI and aliases

Examples:
  ./install.ps1
  ./install.ps1 agents
  ./install.ps1 agents/background-planner development/git-commit-pr
  ./install.ps1 --prefix my- --postfix -dev
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
    $source = Join-Path $ScriptDir 'cli/claude-skill'
    $target = Join-Path $CliTarget 'claude-skill'

    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        Write-ErrorMsg "CLI script not found: $source"
        exit 1
    }

    if ($DryRun) {
        Write-Dry "Ensure directory: $CliTarget"
        Write-Dry "Link CLI: $target -> $source"
    } else {
        Ensure-Directory $CliTarget
        Remove-Existing $target
        try {
            $linkType = New-Link -Path $target -Target $source
            Write-Success "CLI installed: $target ($linkType)"
        } catch {
            Write-ErrorMsg "Failed to create CLI link: $_. Try running as admin or copy manually."
            exit 1
        }
    }

    foreach ($alias in $CliAliases) {
        $aliasPath = Join-Path $CliTarget $alias
        if ($DryRun) {
            Write-Dry "Alias -> $aliasPath"
            continue
        }
        Remove-Existing $aliasPath
        try {
            $linkType = New-Link -Path $aliasPath -Target $source
            Write-Success "Alias installed: $aliasPath ($linkType)"
        } catch {
            Write-ErrorMsg ("Failed to create alias {0}: {1}" -f $alias, $_)
            exit 1
        }
    }
}

function Uninstall-Cli {
    $source = Join-Path $ScriptDir 'cli/claude-skill'
    $target = Join-Path $CliTarget 'claude-skill'

    $removed = $false
    if (Test-Path -LiteralPath $target) {
        if ($DryRun) {
            Write-Dry "Remove CLI: $target"
        } else {
            Remove-Existing $target
            Write-Success "Removed CLI: $target"
        }
        $removed = $true
    }

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

    if (-not $removed) {
        Write-Warn 'CLI not installed'
    }
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
        default { $Targets += $arg }
    }
}

$TargetDir = Normalize-Path $TargetDir
$StaticSource = Normalize-Path $StaticSource
$StaticTarget = Normalize-Path $StaticTarget
$CliTarget = Normalize-Path $CliTarget

if ($LinkStatic) { Link-Static; exit 0 }
if ($UnlinkStatic) { Unlink-Static; exit 0 }
if ($InstallCli) { Install-Cli; exit 0 }
if ($UninstallCli) { Uninstall-Cli; exit 0 }
if ($ListMode) { List-Skills; exit 0 }

if (-not $DryRun) { Ensure-Directory $TargetDir }

if (-not $Quiet -and -not $DryRun) {
    Write-Host ''
    Write-Host 'Agent Skills Installer (Windows)' -ForegroundColor Cyan
    Write-Host '==============================='
    Write-Host ("Mode: {0}" -f ($(if ($Uninstall) { 'Uninstall' } elseif ($CopyMode) { 'Copy' } else { 'Link' })))
    Write-Host "Target: $TargetDir"
    if ($Prefix) { Write-Host "Prefix: $Prefix" }
    if ($Postfix) { Write-Host "Postfix: $Postfix" }
    Write-Host ''
}

$skillGroups = Get-SkillGroups

$targetsArray = @($Targets)

if ($targetsArray.Count -eq 0 -or $targetsArray[0] -eq 'all') {
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
