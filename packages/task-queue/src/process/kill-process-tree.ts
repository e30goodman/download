import { execFileSync } from 'node:child_process'

/**
 * Kill a process together with its entire child tree, cross-platform.
 *
 * On Windows there are no POSIX signals, so `process.kill(pid, 'SIGTERM')`
 * terminates only the parent yt-dlp process and leaves its spawned ffmpeg /
 * fragment-downloader children running — the download keeps going in the
 * background after the user cancels (GitHub issue #395). `taskkill /T` walks
 * and terminates the whole process tree; `/F` forces it because yt-dlp does
 * not handle the graceful WM_CLOSE that plain taskkill sends. On POSIX we keep
 * the existing single-process signal semantics (SIGTERM grace, then SIGKILL).
 *
 * @param pid Process id to terminate; no-op when missing or non-positive.
 * @param signal Signal used on POSIX platforms.
 */
export const killProcessTree = (
  pid: number | undefined,
  signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'
): void => {
  if (pid === undefined || pid <= 0) {
    return
  }

  if (process.platform === 'win32') {
    // Wait until taskkill has finished so a retry cannot start while an
    // orphaned ffmpeg process still holds the previous attempt's output.
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      })
    } catch {
      // Best-effort: failures usually mean the process is already gone.
    }
    return
  }

  process.kill(pid, signal)
}
