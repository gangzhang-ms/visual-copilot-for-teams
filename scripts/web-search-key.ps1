param([ValidateSet('Setup','Status')][string] $Mode = 'Status')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'local-model-secret.ps1')
$path = Join-Path $PSScriptRoot '..\.local\visual-context\brave-search-key.dpapi'
$secure = $null
$value = $null
$pointer = [IntPtr]::Zero
try {
    if (-not $IsWindows) { throw 'Windows CurrentUser DPAPI is required.' }
    if ($Mode -eq 'Setup') {
        $secure = Read-Host 'Brave Search-plan API key (hidden; never paste it into chat)' -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        Save-LocalModelSecret -Path $path -Value $value
        Write-Output 'Brave search credential protected with CurrentUser DPAPI. No API request or account change made. Start a fresh app instance to load it.'
    } elseif (-not (Test-Path -LiteralPath $path)) {
        Write-Output 'Optional Brave search credential is not configured. Wikimedia Commons needs no search key. No API request made.'
    } else {
        $value = Read-LocalModelSecret $path
        Write-Output 'Protected optional Brave credential is readable. Provider access has not been tested; Wikimedia Commons needs no search key.'
    }
} catch {
    [Console]::Error.WriteLine('Web-search credential setup/status failed. Check Windows DPAPI access and enter a non-empty key locally. No credential or provider response is logged.')
    exit 1
} finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($null -ne $secure) { $secure.Dispose() }
    $value = $null
}
