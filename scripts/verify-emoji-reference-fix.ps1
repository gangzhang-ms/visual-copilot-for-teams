param([switch] $Offline,[switch] $Custom)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'local-model-secret.ps1')
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$info = $null
$child = $null
$model = $null
try {
    if (-not $IsWindows) { throw 'Windows required' }
    $evidence = if ($Custom) { '.local\visual-context\custom-emoji-demo-live\attempt.json' } else { '.local\visual-context\emoji-reference-fix-live\attempt.json' }
    if (-not $Offline -and (Test-Path -LiteralPath (Join-Path $root $evidence))) { throw 'One-call acceptance already attempted' }
    $model = if ($Offline) { 'OFFLINE-MODEL' } else { Read-LocalModelSecret (Join-Path $root '.local\visual-context\model-key.dpapi') }
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = (Get-Command node -CommandType Application).Source
    $info.WorkingDirectory = $root
    $info.UseShellExecute = $false
    $info.ArgumentList.Add((Join-Path $root 'scripts\verify-emoji-reference-fix.mjs'))
    $info.ArgumentList.Add($(if ($Offline) { '--offline' } else { '--live-once' }))
    if ($Custom) { $info.ArgumentList.Add('--custom') }
    $info.Environment.Clear()
    foreach ($name in @('SystemRoot','WINDIR','PATH','PATHEXT','USERPROFILE','LOCALAPPDATA','APPDATA','ProgramFiles','ProgramFiles(x86)','ProgramW6432','TEMP','TMP')) {
        $value = [Environment]::GetEnvironmentVariable($name,'Process')
        if ($null -ne $value) { $info.Environment[$name] = $value }
    }
    $info.Environment['MODEL_API_KEY'] = $model
    $info.Environment['VISUAL_BUILD_ROOT'] = if ($Custom) { 'dist-chat-custom-emoji-demo' } else { 'dist-chat-emoji-reference-fix' }
    $child = [Diagnostics.Process]::Start($info)
    [void]$info.Environment.Remove('MODEL_API_KEY')
    $model = $null
    $child.WaitForExit()
    if ($child.ExitCode -ne 0) { throw 'Acceptance incomplete' }
} catch {
    [Console]::Error.WriteLine('Emoji reference acceptance stopped. Inspect sanitized evidence. No automatic retry.')
    exit 1
} finally {
    $model = $null
    if ($null -ne $info) { [void]$info.Environment.Remove('MODEL_API_KEY') }
    if ($null -ne $child) { $child.Dispose() }
}
