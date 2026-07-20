$ErrorActionPreference = "Stop"

$dataRoot = "C:\Users\user\AppData\Local\DownloadSite"
$supervisorScript = "$dataRoot\supervisor.ps1"
$taskName = "DownloadSite Supervisor"
$apiPort = 3110
$adminPort = 3111

function Stop-PortListener {
	param([int]$Port)
	$connections = netstat -ano | Select-String ":$Port\s"
	foreach ($line in $connections) {
		$parts = ($line -replace '\s+', ' ').Trim().Split(' ')
		$processId = [int]$parts[-1]
		if ($processId -gt 0) {
			Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
		}
	}
}

function Test-SupervisorRunning {
	$lockFile = "$dataRoot\supervisor.lock"
	if (-not (Test-Path $lockFile)) {
		return $false
	}
	$existingPid = (Get-Content -Path $lockFile -Raw -ErrorAction SilentlyContinue).Trim()
	if ($existingPid -notmatch '^\d+$') {
		return $false
	}
	$process = Get-Process -Id ([int]$existingPid) -ErrorAction SilentlyContinue
	return [bool]($process -and $process.Path -like "*powershell*")
}

Write-Host "Stopping API on ports $apiPort and $adminPort..."
Stop-PortListener -Port $apiPort
Stop-PortListener -Port $adminPort
Start-Sleep -Seconds 2

# Prefer letting the running supervisor bring the API back.
# Restarting the supervisor after an API blip used to also rotate the Cloudflare
# quick tunnel URL and break the public site until Pages redeployed.
if (-not (Test-SupervisorRunning)) {
	$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
	if ($task) {
		Write-Host "Supervisor not running; starting scheduled task..."
		Start-ScheduledTask -TaskName $taskName
	}
	else {
		Write-Host "Supervisor not running; starting supervisor directly..."
		$powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
		Start-Process $powershell -WindowStyle Hidden -ArgumentList @(
			"-NoProfile",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			"`"$supervisorScript`""
		)
	}
}
else {
	Write-Host "Supervisor is running; it will restart the API without touching the tunnel."
}

for ($attempt = 0; $attempt -lt 45; $attempt++) {
	Start-Sleep -Seconds 1
	try {
		$health = Invoke-RestMethod -Uri "http://127.0.0.1:$apiPort/health" -TimeoutSec 2
		if ($health.ok -eq $true) {
			$uptime = (Invoke-RestMethod -Uri "http://127.0.0.1:$adminPort/api/snapshot").server.uptimeSeconds
			$publishedUrl = ""
			if (Test-Path "$dataRoot\current-url.txt") {
				$publishedUrl = (Get-Content -Path "$dataRoot\current-url.txt" -Raw).Trim()
			}
			Write-Host "API restarted. Uptime: $uptime sec. Dashboard: http://127.0.0.1:$adminPort/"
			if ($publishedUrl) {
				Write-Host "Public API: $publishedUrl"
			}
			exit 0
		}
	}
	catch {}
}

Write-Host "API did not become healthy. Check $dataRoot\supervisor.log and $dataRoot\api.log"
exit 1
