param([ValidateSet('Brave','SerpApi')][string] $Provider = 'Brave')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'local-model-secret.ps1')
$directory = Join-Path $PSScriptRoot ('..\.local\visual-context\web-secret-test-' + [Guid]::NewGuid().ToString('N'))
$path = Join-Path $directory 'fixture.dpapi'
try {
    Save-LocalModelSecret -Path $path -Value 'OFFLINE-NOT-A-LIVE-BRAVE-KEY'
    if ((Read-LocalModelSecret $path) -cne 'OFFLINE-NOT-A-LIVE-BRAVE-KEY') { throw 'Roundtrip failed' }
    if ([IO.File]::ReadAllText($path).Contains('OFFLINE-NOT-A-LIVE-BRAVE-KEY')) { throw 'Plaintext persisted' }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $acl = Get-Acl -LiteralPath $path
    if (-not $acl.AreAccessRulesProtected) { throw 'Unprotected ACL' }
    foreach ($rule in $acl.Access) {
        if ($rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid) { throw 'Unexpected ACL reader' }
    }
    [IO.File]::WriteAllText($path,'INVALID-CIPHER-FIXTURE')
    $failed = $false
    try { Read-LocalModelSecret $path | Out-Null } catch { $failed = $_.Exception.Message -eq 'local-credential-unavailable-or-unreadable' }
    if (-not $failed) { throw 'Corrupt fixture did not fail closed' }
    [IO.File]::Delete($path)
    $failed = $false
    try { Read-LocalModelSecret $path | Out-Null } catch { $failed = $_.Exception.Message -eq 'local-credential-unavailable-or-unreadable' }
    if (-not $failed) { throw 'Missing fixture did not fail closed' }
    $tokens = $null
    $errors = $null
    $setup = if ($Provider -eq 'SerpApi') { 'serpapi-key.ps1' } else { 'web-search-key.ps1' }
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $setup),[ref]$tokens,[ref]$errors)
    if ($errors.Count -ne 0 -or $ast.ParamBlock.Parameters.Count -ne 1) { throw 'Unexpected setup parameters' }
    if ($ast.ParamBlock.Parameters[0].Name.VariablePath.UserPath -ne 'Mode') { throw 'Credential argument exposed' }
    if ($Provider -eq 'SerpApi') {
        $setupCode = $ast.Extent.Text.Replace(
            ". (Join-Path `$PSScriptRoot 'local-model-secret.ps1')", ''
        ).Replace(
            "`$path = Join-Path `$PSScriptRoot '..\.local\visual-context\serpapi-key.dpapi'", '$path = $fixturePath'
        )
        if ($setupCode.Contains('serpapi-key.dpapi') -or $setupCode.Contains('local-model-secret.ps1')) {
            throw 'Setup fixture path isolation failed'
        }
        & {
            param($code, $fixturePath)
            $probe = @{ answer = ''; confirmations = 0; secretPrompts = 0 }
            function Read-Host {
                param([string] $Prompt, [switch] $AsSecureString)
                if ($AsSecureString) {
                    $probe.secretPrompts++
                    return ConvertTo-SecureString 'OFFLINE-ROTATED-FIXTURE' -AsPlainText -Force
                }
                $probe.confirmations++
                return $probe.answer
            }
            Save-LocalModelSecret -Path $fixturePath -Value 'OFFLINE-OLD-FIXTURE'
            $before = [IO.File]::ReadAllText($fixturePath)
            $setupBlock = [ScriptBlock]::Create($code)
            $output = & $setupBlock -Mode Setup
            if ($probe.confirmations -ne 1 -or $probe.secretPrompts -ne 0 -or
                [IO.File]::ReadAllText($fixturePath) -cne $before -or
                ($output -join "`n") -notmatch 'Setup cancelled') {
                throw 'Declined overwrite did not preserve the fixture before hidden input'
            }
            $probe.answer = 'REPLACE'
            $output = & $setupBlock -Mode Setup
            if ($probe.confirmations -ne 2 -or $probe.secretPrompts -ne 1 -or
                (Read-LocalModelSecret $fixturePath) -cne 'OFFLINE-ROTATED-FIXTURE' -or
                ($output -join "`n") -match 'OFFLINE-ROTATED-FIXTURE') {
                throw 'Confirmed hidden replacement failed'
            }
            [IO.File]::Delete($fixturePath)
            $output = & $setupBlock -Mode Setup
            if ($probe.confirmations -ne 2 -or $probe.secretPrompts -ne 2 -or
                (Read-LocalModelSecret $fixturePath) -cne 'OFFLINE-ROTATED-FIXTURE') {
                throw 'First-time hidden setup failed'
            }
            $output = & $setupBlock -Mode Status
            if ($probe.confirmations -ne 2 -or $probe.secretPrompts -ne 2 -or
                ($output -join "`n") -match 'OFFLINE-ROTATED-FIXTURE') {
                throw 'Presence-only status prompted for or disclosed the fixture'
            }
        } $setupCode $path
        $loader = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'local-model.ps1'),[ref]$tokens,[ref]$errors)
        $branch = $loader.FindAll({ param($node)
            $node -is [Management.Automation.Language.IfStatementAst] -and $node.Clauses[0].Item1.Extent.Text.Contains("dist-chat-google-create")
        }, $true)
        if ($branch.Count -ne 1) { throw 'Missing independent SerpApi loader branch' }
        $parent = $branch[0].Parent
        while ($null -ne $parent) {
            if ($parent -is [Management.Automation.Language.IfStatementAst] -and $parent.Clauses[0].Item1.Extent.Text.Contains("dist-chat-web-create")) {
                throw 'SerpApi loader incorrectly depends on Brave configuration'
            }
            $parent = $parent.Parent
        }
    }
    Write-Output 'Offline web-key DPAPI roundtrip, non-plaintext storage, user-only ACL, missing/corrupt failures and argument boundary passed. SerpApi mode also verifies hidden setup and confirmed/cancelled replacement. No real key or network access.'
} finally {
    if ([IO.File]::Exists($path)) { [IO.File]::Delete($path) }
    if ([IO.Directory]::Exists($directory)) { [IO.Directory]::Delete($directory) }
}
