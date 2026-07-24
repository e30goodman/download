$ErrorActionPreference = "Continue"

$dataRoot = "C:\Users\user\AppData\Local\DownloadSite"
$cloudflared = "C:\Users\user\AppData\Local\Programs\cloudflared\cloudflared.exe"
$logPath = "$dataRoot\tunnel.log"
$configPath = "$dataRoot\tunnel-config.json"

Set-Content -Path $logPath -Value "" -Encoding UTF8

function Read-TunnelConfig {
	if (-not (Test-Path $configPath)) {
		return $null
	}
	try {
		return Get-Content -Path $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
	}
	catch {
		Add-Content -Path $logPath -Value "Failed to parse tunnel-config.json: $($_.Exception.Message)" -Encoding UTF8
		return $null
	}
}

$config = Read-TunnelConfig
$mode = "quick"
$token = ""
$publicUrl = ""
if ($config) {
	if ($config.mode) {
		$mode = [string]$config.mode
	}
	if ($config.token) {
		$token = [string]$config.token
	}
	if ($config.publicUrl) {
		$publicUrl = [string]$config.publicUrl
	}
}

if ($mode -eq "named" -and $token.Length -gt 0) {
	if ($publicUrl.Length -gt 0) {
		Add-Content -Path $logPath -Value "Named tunnel mode. publicUrl=$publicUrl" -Encoding UTF8
		Add-Content -Path $logPath -Value $publicUrl -Encoding UTF8
	}
	else {
		Add-Content -Path $logPath -Value "Named tunnel mode without publicUrl in tunnel-config.json." -Encoding UTF8
	}

	& $cloudflared tunnel run --token $token --no-autoupdate 2>&1 |
		ForEach-Object {
			Add-Content -Path $logPath -Value $_.ToString() -Encoding UTF8
		}
	return
}

Add-Content -Path $logPath -Value "Quick tunnel mode (hostname changes on every restart)." -Encoding UTF8
& $cloudflared tunnel --url "http://127.0.0.1:3110" --no-autoupdate 2>&1 |
	ForEach-Object {
		Add-Content -Path $logPath -Value $_.ToString() -Encoding UTF8
	}
