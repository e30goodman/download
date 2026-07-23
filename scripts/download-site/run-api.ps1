$ErrorActionPreference = "Stop"

$projectRoot = "C:\Users\user\Desktop\vids"
$dataRoot = "C:\Users\user\AppData\Local\DownloadSite"
$apiLog = "$dataRoot\api.log"

$env:VIDBEE_API_HOST = "127.0.0.1"
$env:VIDBEE_API_PORT = "3110"
$env:VIDBEE_ADMIN_PORT = "3111"
$env:VIDBEE_PUBLIC_SITE = "true"
$env:VIDBEE_PUBLIC_SITE_ORIGIN = "https://e30goodman.github.io"
$env:VIDBEE_DOWNLOAD_DIR = "C:\Users\user\Downloads\DownloadSite"
$env:VIDBEE_HISTORY_STORE_PATH = "$dataRoot\history.db"
$env:VIDBEE_TASK_QUEUE_DB = "$dataRoot\queue.db"
$env:VIDBEE_PERSIST_QUEUE = "1"
$env:VIDBEE_MAX_CONCURRENT = "2"
$env:YTDLP_PATH = "C:\Users\user\AppData\Local\Programs\yt-dlp\yt-dlp.exe"
$env:FFMPEG_PATH = "C:\ProgramData\chocolatey\lib\ffmpeg\tools\ffmpeg\bin\ffmpeg.exe"
$env:SPOTDL_PATH = "C:\Users\user\AppData\Local\DownloadSite\spotdl-venv\Scripts\spotdl.exe"
$env:WHISPER_PYTHON = "C:\Users\user\AppData\Local\DownloadSite\whisper-venv\Scripts\python.exe"
$env:WHISPER_SCRIPT = "C:\Users\user\Desktop\vids\apps\api\scripts\whisper_transcribe.py"
$env:WHISPER_MODEL = "base"
$env:WHISPER_LANGUAGE = "auto"
# Own IPs/sessions are not counted as visitors (comma-separated):
# $env:VIDBEE_MONITOR_IGNORE_IPS = "1.2.3.4,5.6.7.8"
# $env:VIDBEE_MONITOR_IGNORE_SESSIONS = "your-session-uuid-from-browser-localstorage"

Set-Location "$projectRoot\apps\api"

# Append via cmd so Node/pnpm stdout is not stuck behind PowerShell pipeline buffering.
"$(Get-Date -Format s) Starting API via pnpm run start" | Add-Content -Path $apiLog -Encoding UTF8
cmd.exe /c "pnpm run start >> `"$apiLog`" 2>&1"
