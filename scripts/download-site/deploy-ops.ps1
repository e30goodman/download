$ErrorActionPreference = "Stop"

$repoScripts = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataRoot = "C:\Users\user\AppData\Local\DownloadSite"
$taskName = "DownloadSite Supervisor"
$files = @(
	"supervisor.ps1",
	"run-api.ps1",
	"run-tunnel.ps1",
	"restart-api.ps1",
	"install-supervisor.ps1",
	"setup-named-tunnel.ps1",
	"tunnel-config.example.json"
)

if (-not (Test-Path $dataRoot)) {
	New-Item -ItemType Directory -Path $dataRoot | Out-Null
}

foreach ($name in $files) {
	$src = Join-Path $repoScripts $name
	if (-not (Test-Path $src)) {
		Write-Host "Skip missing $name"
		continue
	}
	Copy-Item -Path $src -Destination (Join-Path $dataRoot $name) -Force
	Write-Host "Copied $name"
}

& (Join-Path $dataRoot "install-supervisor.ps1")

$lockFile = Join-Path $dataRoot "supervisor.lock"
if (Test-Path $lockFile) {
	$existingPid = (Get-Content -Path $lockFile -Raw -ErrorAction SilentlyContinue).Trim()
	if ($existingPid -match '^\d+$') {
		$process = Get-Process -Id ([int]$existingPid) -ErrorAction SilentlyContinue
		if ($process) {
			Write-Host "Stopping old supervisor pid=$existingPid so new script loads."
			Stop-Process -Id ([int]$existingPid) -Force -ErrorAction SilentlyContinue
			Start-Sleep -Seconds 2
		}
	}
	Remove-Item -Path $lockFile -Force -ErrorAction SilentlyContinue
}

Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3
$info = Get-ScheduledTaskInfo -TaskName $taskName
Write-Host "Deployed ops scripts to $dataRoot"
Write-Host "Scheduled task $taskName last result: $($info.LastTaskResult)"
Write-Host "Supervisor log: $(Join-Path $dataRoot 'supervisor.log')"
