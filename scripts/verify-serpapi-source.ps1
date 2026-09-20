param([switch] $ThumbnailRepair)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'local-model-secret.ps1')
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$key = $null
$info = $null
$child = $null
try {
    if (-not $IsWindows) { throw 'Windows DPAPI required' }
    $attemptDirectory = if ($ThumbnailRepair) { 'live-fixed' } else { 'live' }
    if ($ThumbnailRepair -and -not (Test-Path -LiteralPath (Join-Path $root '.local\visual-context\serpapi-source-acceptance\live\attempt.json'))) {
        throw 'Original acceptance receipt required before the authorized repair attempt'
    }
    if (Test-Path -LiteralPath (Join-Path $root ('.local\visual-context\serpapi-source-acceptance\' + $attemptDirectory + '\attempt.json'))) {
        throw 'The one-shot source acceptance has already been consumed'
    }
    $key = Read-LocalModelSecret (Join-Path $root '.local\visual-context\serpapi-key.dpapi')
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = (Get-Command node -CommandType Application).Source
    $info.WorkingDirectory = $root
    $info.UseShellExecute = $false
    $info.ArgumentList.Add((Join-Path $root 'scripts\verify-serpapi-source.mjs'))
    $info.ArgumentList.Add($(if ($ThumbnailRepair) { '--live-fixed-once' } else { '--live-once' }))
    $info.Environment.Clear()
    foreach ($name in @('SystemRoot','WINDIR','PATH','PATHEXT','USERPROFILE','LOCALAPPDATA','APPDATA')) {
        $value = [Environment]::GetEnvironmentVariable($name,'Process')
        if ($null -ne $value) { $info.Environment[$name] = $value }
    }
    $info.Environment['SERPAPI_API_KEY'] = $key
    $child = [Diagnostics.Process]::Start($info)
    [void]$info.Environment.Remove('SERPAPI_API_KEY')
    $key = $null
    $child.WaitForExit()
    if ($child.ExitCode -ne 0) { throw 'Source verification did not pass; inspect the sanitized receipt' }
} catch {
    [Console]::Error.WriteLine('One-shot source acceptance stopped. See its sanitized receipt or verify local credential/setup and the consumed-attempt marker. No key or raw error is logged.')
    exit 1
} finally {
    $key = $null
    if ($null -ne $info) { [void]$info.Environment.Remove('SERPAPI_API_KEY') }
    if ($null -ne $child) { $child.Dispose() }
}
