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

  // `cmd /c start` hands the script to the shell, so it keeps running after this
  // process is stopped. A plain detached spawn dies together with the parent here.
  // restart-api.ps1 only stops LISTENING ports, so cloudflared keeps its URL.
  const child = spawn(
    'cmd.exe',
    [
      '/c',
      'start',
      '',
      '/min',
      powershell,
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath
    ],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }
  )
  child.on('error', (error) => {
    console.error('Failed to launch restart script:', error)
  })
  child.unref()

  return { scriptPath }
}
