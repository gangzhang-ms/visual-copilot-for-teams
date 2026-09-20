$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'local-model-secret.ps1')
$directory = Join-Path $PSScriptRoot ('..\.local\secret-test-' + [Guid]::NewGuid().ToString('N'))
$path = [System.IO.Path]::GetFullPath((Join-Path $directory 'canary.dpapi'))
try {
    if (-not $IsWindows) { throw 'Windows is required for the DPAPI check.' }
    $canary = 'synthetic-credential-canary-only'
    Save-LocalModelSecret $path $canary
    if ((Read-LocalModelSecret $path) -cne $canary) { throw 'Roundtrip failed.' }
    if ([System.IO.File]::ReadAllText($path).Contains($canary)) { throw 'Plaintext at rest.' }
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $acl = Get-Acl -LiteralPath $path
    if (-not $acl.AreAccessRulesProtected -or @($acl.Access).Count -ne 1 -or
        $acl.Access[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $identity) { throw 'Unexpected secret ACL.' }
    $canary = 'synthetic-replacement-credential-only'
    Save-LocalModelSecret $path $canary
    if ((Read-LocalModelSecret $path) -cne $canary) { throw 'Replacing an existing protected credential failed.' }
    $acl = Get-Acl -LiteralPath $path
    if (-not $acl.AreAccessRulesProtected -or @($acl.Access).Count -ne 1 -or
        $acl.Access[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $identity) { throw 'Replacement changed secret ACL protection.' }
    foreach ($invalid in @('', 'corrupted-ciphertext')) {
        [System.IO.File]::WriteAllText($path, $invalid)
        $blocked = $false
        try { $null = Read-LocalModelSecret $path }
        catch {
            $blocked = $true
            if ($_.Exception.Message -ne 'local-credential-unavailable-or-unreadable') { throw 'Unsanitized error.' }
        }
        if (-not $blocked) { throw 'Invalid ciphertext accepted.' }
    }
    Remove-Item -LiteralPath $path
    $blocked = $false
    try { $null = Read-LocalModelSecret $path } catch { $blocked = $true }
    if (-not $blocked) { throw 'Missing credential accepted.' }
    Write-Output 'DPAPI roundtrip, non-plaintext storage, current-user-only ACL, missing/corrupt/empty failure checks passed.'
} finally {
    if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory -Recurse -Force }
}
