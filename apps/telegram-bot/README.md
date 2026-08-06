# VidBee Telegram Bot

Telegram control-plane for VidBee API.

## Environment

- `TELEGRAM_BOT_TOKEN` - Bot token from BotFather.
- `TELEGRAM_ALLOWED_USERS` - Comma-separated Telegram user IDs allowed to use user commands.
- `TELEGRAM_ADMIN_USERS` - Comma-separated Telegram user IDs with admin commands.
- `VIDBEE_API_URL` - API base URL, default `http://127.0.0.1:3100`.
- `VIDBEE_DOWNLOAD_DIR` - Download directory used for local file delivery.
- `VIDBEE_PUBLIC_URL` - Optional public base URL for fallback links.
- `TELEGRAM_MAX_UPLOAD_BYTES` - Optional upload limit override.
- `TELEGRAM_AUTO_RESTART_ON_FAILURE` - `true` to auto-restart API on watchdog failures.

## Commands

- `/add <url>` - queue video download.
- `/audio <url>` - queue audio download.
- `/text <url>` - queue text download.
- `/status` - active and recent tasks.
- `/srv_status` - admin only, system service status.
- `/srv_restart <service>` - admin only, controlled restart.
