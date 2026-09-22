param([ValidateSet('Setup', 'Readiness', 'Synthetic', 'Start', 'Chat', 'ImageInit', 'ImageStatus', 'ImageCanary', 'ImageChat', 'LocalOpen', 'ExplainProbe')][string] $Mode = 'Readiness',
    [ValidateRange(1024,65535)][int] $Port = 4317,
    [ValidateSet('dist-chat-shared-demo','dist-chat-live-sync','dist-chat-film-context','dist-chat-style-continuity','dist-chat-compact-explain','dist-chat-visual-inline','dist-chat-emoji-consistent','dist-chat-emoji-inline','dist-chat-emoji-disclosure','dist-chat-emoji-enlarge','dist-chat-demo-polish-fixed','dist-chat-demo-polish','dist-chat-combined-demo','dist-chat-custom-emoji-demo','dist-chat-emoji-reference-fix','dist-chat-emoji-recognition','dist-chat-emoji-express','dist-chat-source-clarity','dist-chat-contextual-reply','dist-chat-contextual-create','dist-chat-google-thumbnails','dist-chat-google-create','dist-chat-commons-fix','dist-chat-commons-create','dist-chat-web-create','dist-chat-resilient-create','dist-chat-mixed-create','dist-chat-express-scope','dist-chat-create-options','dist','dist-upgrade','dist-generation-live','dist-local-open','dist-teams-style','dist-chat-expressive','dist-chat-recovery',    'dist-chat-recovery-check',    'dist-chat-memes','dist-chat-quick-explain','dist-chat-visual-explain','dist-chat-emoji-explain','dist-chat-media-composer','dist-chat-natural-demo','dist-chat-explain-fix','dist-chat-visual-target','dist-chat-clean-explanation','dist-chat-open-media','dist-chat-clean-ui','dist-chat-unified-express','dist-chat-instant-create','dist-chat-oneclick-create','dist-chat-simple-create','dist-chat-generation-recovery','dist-chat-english','dist-chat-pop-culture-demo','dist-chat-brief-explain','dist-chat-brief-background','dist-chat-source-background')][string] $BuildRoot = 'dist')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'local-model-secret.ps1')
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$secretPath = Join-Path $root '.local\visual-context\model-key.dpapi'
$key = $null
$webKey = $null
$exitCode = 0
try {
    if (-not $IsWindows) { throw 'Windows CurrentUser DPAPI is required.' }
    Set-Location $root
    $settings = Get-Content -LiteralPath (Join-Path $root 'config\visual-model.development.json') -Raw | ConvertFrom-Json
    # Fixed resource identity: editing other config cannot redirect credential retrieval.
    if ($settings.subscription -ne '00000000-0000-4000-8000-000000000001' -or
        $settings.tenant -ne '00000000-0000-4000-8000-000000000002' -or
        $settings.resourceGroup -ne 'your-resource-group' -or
        $settings.account -ne 'your-azure-openai-resource' -or
        $settings.profile.endpoint -ne 'https://your-azure-openai-resource.openai.azure.com/' -or
        $settings.profile.deployment -ne 'your-vision-deployment') { throw 'Development resource mismatch.' }
    if ($Mode -eq 'Setup') {
        $tenant = & az account show --subscription $settings.subscription --query tenantId -o tsv --only-show-errors 2>$null
        if ($LASTEXITCODE -ne 0 -or $tenant -ne $settings.tenant) { throw 'Azure tenant mismatch.' }
        $account = & az cognitiveservices account show --subscription $settings.subscription --resource-group $settings.resourceGroup --name $settings.account --query '{endpoint:properties.endpoint,state:properties.provisioningState}' -o json --only-show-errors 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'Resource unavailable.' }
        $account = $account | ConvertFrom-Json
        if ($account.endpoint -ne $settings.profile.endpoint -or $account.state -ne 'Succeeded') { throw 'Resource not ready.' }
        $deployment = & az cognitiveservices account deployment show --subscription $settings.subscription --resource-group $settings.resourceGroup --name $settings.account --deployment-name $settings.profile.deployment --query '{state:properties.provisioningState,model:properties.model.name,version:properties.model.version}' -o json --only-show-errors 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'Deployment unavailable.' }
        $deployment = $deployment | ConvertFrom-Json
        if ($deployment.state -ne 'Succeeded' -or $deployment.model -ne 'gpt-4.1-mini' -or $deployment.version -ne '2025-04-14') { throw 'Deployment mismatch.' }
        $key = & az cognitiveservices account keys list --subscription $settings.subscription --resource-group $settings.resourceGroup --name $settings.account --query key1 -o tsv --only-show-errors 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($key)) { throw 'Credential retrieval failed.' }
        Save-LocalModelSecret -Path $secretPath -Value $key
        if ((Read-LocalModelSecret $secretPath) -cne $key) { throw 'Protected credential roundtrip failed.' }
        Write-Output 'Development credential protected with Windows CurrentUser DPAPI. Production gates unchanged.'
    } else {
        if ($Mode -eq 'ImageInit') { Set-PrivateDirectory (Join-Path $root '.local\visual-context\image-allowance') }
        $key = Read-LocalModelSecret $secretPath
        $info = [System.Diagnostics.ProcessStartInfo]::new()
        $info.FileName = (Get-Command node -CommandType Application).Source
        $info.WorkingDirectory = $root
        $info.UseShellExecute = $false
        $info.ArgumentList.Add((Join-Path $root 'scripts\run-local-model.mjs'))
        $info.ArgumentList.Add($Mode.ToLowerInvariant())
        $info.Environment.Clear()
        foreach ($name in @('SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA')) {
            $value = [Environment]::GetEnvironmentVariable($name, 'Process')
            if ($null -ne $value) { $info.Environment[$name] = $value }
        }
        if ($Mode -eq 'Start') {
            foreach ($name in @('TEAMS_APP_ID', 'CLIENT_ID', 'BOT_APP_ID', 'TENANT_ID', 'CLIENT_SECRET', 'PUBLIC_ORIGIN', 'PORT')) {
                $value = [Environment]::GetEnvironmentVariable($name, 'Process')
                if ($null -ne $value) { $info.Environment[$name] = $value }
            }
        }
        $info.Environment['MODEL_API_KEY'] = $key
        if ($Mode -eq 'LocalOpen' -and $BuildRoot -eq 'dist-chat-web-create') {
            $webPath = Join-Path $root '.local\visual-context\brave-search-key.dpapi'
            $info.Environment['BRAVE_SEARCH_CREDENTIAL_STATE'] = 'missing'
            if (Test-Path -LiteralPath $webPath) {
                try {
                    $webKey = Read-LocalModelSecret $webPath
                    $info.Environment['BRAVE_SEARCH_API_KEY'] = $webKey
                    $info.Environment['BRAVE_SEARCH_CREDENTIAL_STATE'] = 'available'
                } catch {
                    $info.Environment['BRAVE_SEARCH_CREDENTIAL_STATE'] = 'unreadable'
                    [Console]::Error.WriteLine('Protected web-search credential is unreadable. Web search stays disabled; image creation remains available.')
                }
            }
        }
        if ($Mode -eq 'LocalOpen' -and $BuildRoot -in                 @('dist-chat-shared-demo','dist-chat-live-sync','dist-chat-film-context','dist-chat-style-continuity','dist-chat-compact-explain','dist-chat-visual-inline','dist-chat-emoji-consistent','dist-chat-emoji-inline','dist-chat-emoji-disclosure','dist-chat-google-create','dist-chat-google-thumbnails',        'dist-chat-contextual-create',        'dist-chat-contextual-reply',        'dist-chat-source-clarity',        'dist-chat-emoji-express','dist-chat-emoji-recognition',                'dist-chat-emoji-reference-fix',        'dist-chat-custom-emoji-demo',        'dist-chat-combined-demo',        'dist-chat-demo-polish','dist-chat-demo-polish-fixed','dist-chat-emoji-enlarge')) {
            $webPath = Join-Path $root '.local\visual-context\serpapi-key.dpapi'
            $info.Environment['SERPAPI_CREDENTIAL_STATE'] = 'missing'
            if (Test-Path -LiteralPath $webPath) {
                try {
                    $webKey = Read-LocalModelSecret $webPath
                    $info.Environment['SERPAPI_API_KEY'] = $webKey
                    $info.Environment['SERPAPI_CREDENTIAL_STATE'] = 'available'
                } catch {
                    $info.Environment['SERPAPI_CREDENTIAL_STATE'] = 'unreadable'
                    [Console]::Error.WriteLine('Protected SerpApi key is unreadable. Search stays disabled; image creation remains available.')
                }
            }
        }
        $info.Environment['VISUAL_BUILD_ROOT'] = $BuildRoot
        if ($Mode -in @('Chat','ImageChat','LocalOpen')) { $info.Environment['LOCAL_CHAT_PORT'] = [string] $Port }
        $child = [System.Diagnostics.Process]::Start($info)
        $info.Environment.Remove('MODEL_API_KEY') | Out-Null
        $info.Environment.Remove('BRAVE_SEARCH_API_KEY') | Out-Null
        $info.Environment.Remove('SERPAPI_API_KEY') | Out-Null
        $webKey = $null
        $key = $null
        try { $child.WaitForExit(); $exitCode = $child.ExitCode }
        finally { $child.Dispose() }
    }
} catch {
    [Console]::Error.WriteLine('Local model setup/run blocked. Verify Azure login for the configured tenant/resource, Windows DPAPI access, build and real Teams configuration. Secrets and provider errors are not logged.')
    $exitCode = 1
} finally { $key = $null; $webKey = $null }
exit $exitCode
