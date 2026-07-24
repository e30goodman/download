$ErrorActionPreference = "Stop"

<#
.SYNOPSIS
	One-time setup for a stable Cloudflare named tunnel URL.

.DESCRIPTION
	Quick tunnels (*.trycloudflare.com) change hostname on every restart.
	Named tunnels keep the same public hostname across sleep/wake.

	Prerequisites:
	1. Cloudflare account
	2. A domain added to that Cloudflare account (free plan is enough)
	3. cloudflared installed

	Steps this script helps with:
	- Opens browser login for cloudflared (origin cert)
	- Creates tunnel "download-site" if missing
	- Prints DNS route + token instructions
	- Writes tunnel-config.json template for run-tunnel.ps1
#>

$dataRoot = "C:\Users\user\AppData\Local\DownloadSite"
$cloudflared = "C:\Users\user\AppData\Local\Programs\cloudflared\cloudflared.exe"
$configPath = "$dataRoot\tunnel-config.json"
$tunnelName = "download-site"

if (-not (Test-Path $cloudflared)) {
	Write-Error "cloudflared not found at $cloudflared"
}

if (-not (Test-Path $dataRoot)) {
	New-Item -ItemType Directory -Path $dataRoot | Out-Null
}

Write-Host "Opening Cloudflare login in the browser (approve the certificate)."
& $cloudflared tunnel login
if ($LASTEXITCODE -ne 0) {
	Write-Error "cloudflared tunnel login failed."
}

$existing = & $cloudflared tunnel list 2>&1 | Out-String
if ($existing -notmatch [regex]::Escape($tunnelName)) {
	Write-Host "Creating tunnel '$tunnelName'..."
	& $cloudflared tunnel create $tunnelName
}

Write-Host ""
Write-Host "Next (manual, once):"
Write-Host "1. Open https://one.dash.cloudflare.com/ -> Zero Trust -> Networks -> Tunnels"
Write-Host "2. Open tunnel '$tunnelName' -> Public Hostname"
Write-Host "3. Add hostname, e.g. api.your-domain.com -> http://127.0.0.1:3110"
Write-Host "4. Copy the tunnel token from the dashboard (Configure / Install connector)."
Write-Host ""

$publicUrl = Read-Host "Enter the public HTTPS URL (e.g. https://api.your-domain.com)"
$token = Read-Host "Paste the Cloudflare tunnel token"

$publicUrl = $publicUrl.Trim().TrimEnd('/')
$token = $token.Trim()
if (-not $publicUrl.StartsWith("https://")) {
	Write-Error "publicUrl must start with https://"
}
if ($token.Length -lt 20) {
	Write-Error "token looks empty/invalid"
}

$payload = [ordered]@{
	mode = "named"
	token = $token
	publicUrl = $publicUrl
}
($payload | ConvertTo-Json) | Set-Content -Path $configPath -Encoding UTF8
Write-Host "Wrote $configPath"
Write-Host "Run deploy-ops.ps1 (or restart the DownloadSite Supervisor task) to apply."
Write-Host "Then publish once: set VIDBEE_API_URL / api-endpoint.json to $publicUrl"
