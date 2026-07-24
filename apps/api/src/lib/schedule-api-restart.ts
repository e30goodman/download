import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_RESTART_SCRIPT = path.join(
  process.env.LOCALAPPDATA ?? '',
  'DownloadSite',
  'restart-api.ps1'
)

export const getRestartScriptPath = (): string =>
  process.env.VIDBEE_RESTART_SCRIPT?.trim() || DEFAULT_RESTART_SCRIPT

export const scheduleApiRestart = async (): Promise<{ scriptPath: string }> => {
  const scriptPath = getRestartScriptPath()
  await access(scriptPath)

  const powershell = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )

  // Detached: response can return before this process is stopped.
  // restart-api.ps1 only kills LISTENING ports, so cloudflared stays up.
  const child = spawn(
    powershell,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }
  )
  child.unref()

  return { scriptPath }
}
