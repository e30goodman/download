$ErrorActionPreference = "Continue"

$dataRoot = "C:\Users\user\AppData\Local\DownloadSite"
$apiRunner = "$dataRoot\run-api.ps1"
$tunnelRunner = "$dataRoot\run-tunnel.ps1"
$tunnelLog = "$dataRoot\tunnel.log"
$currentUrlFile = "$dataRoot\current-url.txt"
$supervisorLog = "$dataRoot\supervisor.log"
$lockFile = "$dataRoot\supervisor.lock"
$gh = "C:\Users\user\AppData\Local\Programs\GitHub CLI\gh.exe"
$repository = "e30goodman/download"
$apiEndpointPath = "api-endpoint.json"
$apiPort = 3110
$adminPort = 3111
$pollIntervalSeconds = 20
$tunnelFailureThreshold = 4
$apiFailureThreshold = 3
$apiWarmupSeconds = 45

$script:tunnelFailureCount = 0
$script:apiFailureCount = 0
$script:skipTunnelChecksUntil = [datetime]::MinValue

function Write-SupervisorLog {
	param([string]$Message)
	$line = "$(Get-Date -Format s) $Message"
	Add-Content -Path $supervisorLog -Value $line -Encoding UTF8
}

function Test-SingleInstance {
	if (Test-Path $lockFile) {
		$existingPid = (Get-Content -Path $lockFile -Raw -ErrorAction SilentlyContinue).Trim()
		if ($existingPid -match '^\d+$') {
			$process = Get-Process -Id ([int]$existingPid) -ErrorAction SilentlyContinue
			if ($process -and $process.Path -like "*powershell*") {
				return $false
			}
		}
	}

	Set-Content -Path $lockFile -Value $PID -Encoding ASCII
	return $true
}

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

function Start-HiddenPowerShell {
	param([string]$ScriptPath)

	$powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
	Start-Process $powershell -WindowStyle Hidden -ArgumentList @(
		"-NoProfile",
		"-ExecutionPolicy",
		"Bypass",
		"-File",
		"`"$ScriptPath`""
	) | Out-Null
}

function Test-Api {
	try {
		$response = Invoke-RestMethod -Uri "http://127.0.0.1:$apiPort/health" -TimeoutSec 4
		return $response.ok -eq $true
	}
	catch {
		return $false
	}
}

function Restart-Api {
	Write-SupervisorLog "Restarting API on ports $apiPort and $adminPort."
	Stop-PortListener -Port $apiPort
	Stop-PortListener -Port $adminPort
	Start-Sleep -Seconds 2
	Start-HiddenPowerShell -ScriptPath $apiRunner

	for ($attempt = 0; $attempt -lt 30; $attempt++) {
		Start-Sleep -Seconds 2
		if (Test-Api) {
			Write-SupervisorLog "API is healthy."
			$script:apiFailureCount = 0
			$script:skipTunnelChecksUntil = (Get-Date).AddSeconds($apiWarmupSeconds)
			Write-SupervisorLog "Skipping tunnel health checks for ${apiWarmupSeconds}s after API restart."
			return $true
		}
	}

	Write-SupervisorLog "API did not become healthy."
	return $false
}

function Ensure-Api {
	if (Test-Api) {
		$script:apiFailureCount = 0
		return $true
	}

	$script:apiFailureCount += 1
	Write-SupervisorLog "API health check failed ($script:apiFailureCount/$apiFailureThreshold)."
	if ($script:apiFailureCount -lt $apiFailureThreshold) {
		return $false
	}

	$script:apiFailureCount = 0
	return Restart-Api
}

function Get-TunnelProcess {
	return Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" |
		Where-Object { $_.CommandLine -like "*127.0.0.1:$apiPort*" } |
		Select-Object -First 1
}

function Read-TunnelUrl {
	if (-not (Test-Path $tunnelLog)) {
		return $null
	}

	$content = Get-Content -Path $tunnelLog -Raw -ErrorAction SilentlyContinue
	$matches = [regex]::Matches(
		$content,
		"https://[a-z0-9-]+\.trycloudflare\.com",
		[System.Text.RegularExpressions.RegexOptions]::IgnoreCase
	)
	if ($matches.Count -eq 0) {
		return $null
	}
	return $matches[$matches.Count - 1].Value.ToLowerInvariant()
}

function Read-PublishedUrl {
	if (-not (Test-Path $currentUrlFile)) {
		return $null
	}
	$url = (Get-Content -Path $currentUrlFile -Raw -ErrorAction SilentlyContinue).Trim()
	if ($url.Length -eq 0) {
		return $null
	}
	return $url.ToLowerInvariant()
}

function Test-RemoteHealth {
	param([string]$Url)

	if (-not $Url) {
		return $false
	}

	try {
		$hostName = ([System.Uri]$Url).DnsSafeHost
		$ipAddress = Resolve-DnsName $hostName -Server 1.1.1.1 -Type A -ErrorAction Stop |
			Select-Object -First 1 -ExpandProperty IPAddress
		$curlOutput = & curl.exe --silent --show-error --fail --max-time 12 `
			--resolve "${hostName}:443:${ipAddress}" "$Url/health" 2>$null
		if ($LASTEXITCODE -ne 0) {
			return $false
		}
		$response = $curlOutput | ConvertFrom-Json
		return $response.ok -eq $true
	}
	catch {
		return $false
	}
}

function Stop-Tunnel {
	$process = Get-TunnelProcess
	if ($process) {
		Write-SupervisorLog "Stopping Cloudflare Tunnel process $($process.ProcessId)."
		Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
		Start-Sleep -Seconds 2
	}
}

function Restart-Tunnel {
	Stop-Tunnel
	Write-SupervisorLog "Starting Cloudflare Tunnel."
	Start-HiddenPowerShell -ScriptPath $tunnelRunner

	for ($attempt = 0; $attempt -lt 45; $attempt++) {
		Start-Sleep -Seconds 2
		$url = Read-TunnelUrl
		if ($url -and (Test-RemoteHealth -Url $url)) {
			$script:tunnelFailureCount = 0
			Write-SupervisorLog "Cloudflare Tunnel is healthy at $url."
			return $url
		}
	}

	Write-SupervisorLog "Tunnel did not become healthy."
	Stop-Tunnel
	return $null
}

function Ensure-Tunnel {
	# Never restart the tunnel just because a stale published URL fails.
	# Quick tunnels get a new hostname on every restart; that breaks Pages until redeploy.
	if ((Get-Date) -lt $script:skipTunnelChecksUntil) {
		$warmupUrl = Read-TunnelUrl
		if (-not $warmupUrl) {
			$warmupUrl = Read-PublishedUrl
		}
		return $warmupUrl
	}

	$process = Get-TunnelProcess
	$tunnelUrl = Read-TunnelUrl
	$publishedUrl = Read-PublishedUrl

	$liveHealthy = $false
	if ($process -and $tunnelUrl) {
		$liveHealthy = Test-RemoteHealth -Url $tunnelUrl
	}

	if ($liveHealthy) {
		$script:tunnelFailureCount = 0
		# Live tunnel is fine: republish if GitHub/Pages still point elsewhere.
		if ($publishedUrl -ne $tunnelUrl) {
			Write-SupervisorLog "Live tunnel URL differs from published URL; will republish without restart. live=$tunnelUrl published=$publishedUrl"
		}
		return $tunnelUrl
	}

	# Process alive but remote health flaky while local API is up — tolerate briefly.
	if ($process -and $tunnelUrl -and (Test-Api)) {
		$script:tunnelFailureCount += 1
		Write-SupervisorLog "Live tunnel health check failed ($script:tunnelFailureCount/$tunnelFailureThreshold) for $tunnelUrl (process still running)."
		if ($script:tunnelFailureCount -lt $tunnelFailureThreshold) {
			return $null
		}
	}
	elseif (-not $process) {
		$script:tunnelFailureCount += 1
		Write-SupervisorLog "Tunnel process missing ($script:tunnelFailureCount/$tunnelFailureThreshold)."
		if ($script:tunnelFailureCount -lt $tunnelFailureThreshold) {
			return $null
		}
	}
	else {
		$script:tunnelFailureCount += 1
		Write-SupervisorLog "Tunnel unhealthy ($script:tunnelFailureCount/$tunnelFailureThreshold)."
		if ($script:tunnelFailureCount -lt $tunnelFailureThreshold) {
			return $null
		}
	}

	$script:tunnelFailureCount = 0
	return Restart-Tunnel
}

function Publish-ApiEndpointFile {
	param([string]$Url)

	if (-not (Test-Path $gh)) {
		return $false
	}

	$payloadObject = [ordered]@{
		url = $Url
		updatedAt = (Get-Date).ToUniversalTime().ToString("o")
	}
	$payload = ($payloadObject | ConvertTo-Json -Compress)
	$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
	$content = [Convert]::ToBase64String($bytes)

	$sha = $null
	try {
		$sha = & $gh api "repos/$repository/contents/$apiEndpointPath" --jq ".sha" 2>$null
		if ($LASTEXITCODE -ne 0) {
			$sha = $null
		}
	}
	catch {
		$sha = $null
	}

	$ghArgs = @(
		"api",
		"--method", "PUT",
		"repos/$repository/contents/$apiEndpointPath",
		"-f", "message=chore(ops): refresh public API endpoint",
		"-f", "content=$content",
		"-f", "branch=main"
	)
	if ($sha) {
		$ghArgs += @("-f", "sha=$sha")
	}

	& $gh @ghArgs *>> $supervisorLog
	if ($LASTEXITCODE -ne 0) {
		Write-SupervisorLog "Failed to update $apiEndpointPath on GitHub."
		return $false
	}

	Write-SupervisorLog "Updated $apiEndpointPath for fast client discovery."
	return $true
}

function Publish-TunnelUrl {
	param([string]$Url)

	$currentUrl = Read-PublishedUrl
	if ($currentUrl -eq $Url) {
		return
	}

	Set-Content -Path $currentUrlFile -Value $Url -Encoding UTF8

	if (-not (Test-Path $gh)) {
		Write-SupervisorLog "GitHub CLI not found; saved tunnel URL locally only."
		return
	}

	Write-SupervisorLog "Publishing new tunnel URL: $Url"
	& $gh variable set VIDBEE_API_URL --body $Url --repo $repository *>> $supervisorLog
	if ($LASTEXITCODE -ne 0) {
		Write-SupervisorLog "Failed to update the GitHub variable."
		return
	}

	# Fast path: clients read raw.githubusercontent.com within seconds.
	[void](Publish-ApiEndpointFile -Url $Url)

	& $gh workflow run download-pages.yml --repo $repository *>> $supervisorLog
	if ($LASTEXITCODE -ne 0) {
		Write-SupervisorLog "Failed to start the Pages deployment."
		return
	}

	Write-SupervisorLog "Pages deployment started for $Url."
}

if (-not (Test-SingleInstance)) {
	exit 0
}

Write-SupervisorLog "Supervisor started (pid=$PID)."
try {
	while ($true) {
		if (Ensure-Api) {
			$tunnelUrl = Ensure-Tunnel
			if ($tunnelUrl) {
				Publish-TunnelUrl -Url $tunnelUrl
			}
		}
		Start-Sleep -Seconds $pollIntervalSeconds
	}
}
finally {
	if (Test-Path $lockFile) {
		$lockPid = (Get-Content -Path $lockFile -Raw -ErrorAction SilentlyContinue).Trim()
		if ($lockPid -eq "$PID") {
			Remove-Item -Path $lockFile -Force -ErrorAction SilentlyContinue
		}
	}
}
