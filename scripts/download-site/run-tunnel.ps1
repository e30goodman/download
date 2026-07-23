$ErrorActionPreference = "Continue"

$dataRoot = "C:\Users\user\AppData\Local\DownloadSite"
$cloudflared = "C:\Users\user\AppData\Local\Programs\cloudflared\cloudflared.exe"
$logPath = "$dataRoot\tunnel.log"

Set-Content -Path $logPath -Value "" -Encoding UTF8
& $cloudflared tunnel --url "http://127.0.0.1:3110" --no-autoupdate 2>&1 |
	ForEach-Object {
		Add-Content -Path $logPath -Value $_.ToString() -Encoding UTF8
	}
