param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F-]{36}$')][string]$TeamsAppId,
  [Parameter(Mandatory=$true)][ValidatePattern('^https://[^/*?#]+$')][string]$PublicOrigin
)
$ErrorActionPreference = "Stop"
teams app update $TeamsAppId --endpoint "$PublicOrigin/api/messages"
teams app bot get $TeamsAppId
Write-Host "Rebuild, repackage, and reinstall the app package with the same origin."
