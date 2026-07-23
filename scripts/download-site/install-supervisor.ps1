$ErrorActionPreference = "Stop"

$dataRoot = "C:\Users\user\AppData\Local\DownloadSite"
$supervisorScript = "$dataRoot\supervisor.ps1"
$taskName = "DownloadSite Supervisor"

if (-not (Test-Path $supervisorScript)) {
	Write-Error "Supervisor script not found: $supervisorScript"
}

$powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

$action = New-ScheduledTaskAction `
	-Execute $powershell `
	-Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$supervisorScript`"" `
	-WorkingDirectory $dataRoot

# Keep Logon trigger. AtStartup needs elevation on some hosts; fall back gracefully.
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$startupTrigger = New-ScheduledTaskTrigger -AtStartup

# StartWhenAvailable helps when a trigger was missed while the machine slept.
$settings = New-ScheduledTaskSettingsSet `
	-AllowStartIfOnBatteries `
	-DontStopIfGoingOnBatteries `
	-ExecutionTimeLimit ([TimeSpan]::Zero) `
	-MultipleInstances IgnoreNew `
	-RestartCount 999 `
	-RestartInterval (New-TimeSpan -Minutes 1) `
	-StartWhenAvailable

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$registered = $false
try {
	Register-ScheduledTask `
		-TaskName $taskName `
		-Action $action `
		-Trigger @($logonTrigger, $startupTrigger) `
		-Settings $settings `
		-Principal $principal `
		-Force | Out-Null
	$registered = $true
	Write-Host "Scheduled task installed with AtLogOn + AtStartup triggers."
}
catch {
	Write-Host "Full re-register failed ($($_.Exception.Message)); updating settings in place."
	try {
		Set-ScheduledTask -TaskName $taskName -Settings $settings -Action $action -Principal $principal | Out-Null
		Write-Host "Updated task settings (StartWhenAvailable=True). Logon trigger kept."
		Write-Host "To add AtStartup as well, re-run elevated: $PSCommandPath"
		$registered = $true
	}
	catch {
		Write-Error "Could not update scheduled task: $($_.Exception.Message)"
	}
}

if ($registered) {
	$task = Get-ScheduledTask -TaskName $taskName
	$info = Get-ScheduledTaskInfo -TaskName $taskName
	Write-Host "Scheduled task: $taskName"
	Write-Host "State: $($task.State)  LastResult: $($info.LastTaskResult)  StartWhenAvailable: $($task.Settings.StartWhenAvailable)"
	Write-Host "Supervisor log: $dataRoot\supervisor.log"
	Write-Host "Note: a Running supervisor process keeps the old script until that process is restarted."
}
