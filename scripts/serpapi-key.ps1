param([ValidateSet('Setup','Status')][string] $Mode = 'Status')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'local-model-secret.ps1')
$path = Join-Path $PSScriptRoot '..\.local\visual-context\serpapi-key.dpapi'
$secure = $null
$value = $null
$pointer = [IntPtr]::Zero
try {
    if (-not $IsWindows) { throw 'Windows CurrentUser DPAPI is required.' }
    if ($Mode -eq 'Setup') {
        if (Test-Path -LiteralPath $path) {
            $confirmation = Read-Host 'A protected SerpApi key already exists. Type REPLACE to overwrite it, or press Enter to cancel'
            if ($confirmation -cne 'REPLACE') {
                Write-Output 'Setup cancelled; the existing protected key is unchanged. No key was read or provider request made.'
                return
            }
        }
        Write-Output 'Revoke any key previously shared in chat using the SerpApi dashboard. Enter only its replacement below.'
        $secure = Read-Host 'SerpApi key (hidden; never paste it into chat)' -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        Save-LocalModelSecret -Path $path -Value $value
        Write-Output 'SerpApi key protected with CurrentUser DPAPI. No API/account/billing operation performed. Start a fresh Google-images app instance to load it.'
    } else {
        Write-Output ('SerpApi protected credential present: ' + (Test-Path -LiteralPath $path))
        Write-Output 'Presence only; no key read or provider request. Register/configure your own SerpApi account separately.'
    }
} catch {
    [Console]::Error.WriteLine('SerpApi credential setup/status failed. Check Windows DPAPI access and enter a non-empty key locally. No credential or provider response is logged.')
    exit 1
} finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($null -ne $secure) { $secure.Dispose() }
    $value = $null
}
