param([switch] $Offline)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'local-model-secret.ps1')
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$info = $null
$child = $null
$model = $null
$search = $null
try {
    if (-not $IsWindows) { throw 'Windows required' }
    if (-not $Offline -and (Test-Path -LiteralPath (Join-Path $root '.local\visual-context\    contextual-quality-reply-live\dispatch.json'))) { throw 'Canary consumed' }
    $model = if ($Offline) { 'OFFLINE-MODEL' } else { Read-LocalModelSecret (Join-Path $root '.local\visual-context\model-key.dpapi') }
    $search = if ($Offline) { 'OFFLINE-SEARCH' } else { Read-LocalModelSecret (Join-Path $root '.local\visual-context\serpapi-key.dpapi') }
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = (Get-Command node -CommandType Application).Source
    $info.WorkingDirectory = $root
    $info.UseShellExecute = $false
    $info.ArgumentList.Add((Join-Path $root 'scripts\verify-contextual-quality.mjs'))
    $info.ArgumentList.Add($(if ($Offline) { '--offline' } else { '--live-once' }))
    $info.Environment.Clear()
    foreach ($name in @('SystemRoot','WINDIR','PATH','PATHEXT','USERPROFILE','LOCALAPPDATA','APPDATA','ProgramFiles','ProgramFiles(x86)','ProgramW6432','TEMP','TMP')) {
        $value = [Environment]::GetEnvironmentVariable($name,'Process')
        if ($null -ne $value) { $info.Environment[$name] = $value }
    }
    $info.Environment['MODEL_API_KEY'] = $model
    $info.Environment['SERPAPI_API_KEY'] = $search
    $info.Environment['VISUAL_BUILD_ROOT'] = 'dist-chat-contextual-reply'
    $child = [Diagnostics.Process]::Start($info)
    [void]$info.Environment.Remove('MODEL_API_KEY')
    [void]$info.Environment.Remove('SERPAPI_API_KEY')
    $model = $null; $search = $null
    $child.WaitForExit()
    if ($child.ExitCode -ne 0) { throw 'Canary incomplete; use sanitized receipt, never retry automatically' }
} catch {
    [Console]::Error.WriteLine('Contextual canary stopped. Inspect its safe receipt; no secret or raw transport error is logged. No automatic retry.')
    exit 1
} finally {
    $model = $null; $search = $null
    if ($null -ne $info) {
        [void]$info.Environment.Remove('MODEL_API_KEY')
        [void]$info.Environment.Remove('SERPAPI_API_KEY')
    }
    if ($null -ne $child) { $child.Dispose() }
}
