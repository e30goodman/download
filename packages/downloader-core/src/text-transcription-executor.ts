/**
 * Text transcription executor: prefer yt-dlp subtitles, else download audio
 * and run faster-whisper via a host-provided Python script.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type {
  Executor,
  ExecutorContext,
  ExecutorEvents,
  ExecutorRun,
  TaskOutput
} from '@vidbee/task-queue'
import { killProcessTree } from '@vidbee/task-queue/process'
import { virtualError } from '@vidbee/task-queue'

import { isUsableTranscript, subtitleFileToPlainText } from './subtitle-plain-text'
import type { DownloadRuntimeSettings } from './types'
import type { YtDlpTaskOptions } from './yt-dlp-executor'
import {
  normalizeBrowserCookiesSettingForYtDlp,
  resolvePathWithHome
} from './yt-dlp-args'

const DEFAULT_KILL_GRACE_MS = 10_000
const STDOUT_TAIL_BYTES = 8 * 1024
const STDERR_TAIL_BYTES = 8 * 1024
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa'])
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.opus', '.webm', '.ogg'])

export interface WhisperCommand {
  command: string
  args: string[]
}

export interface TextTranscriptionExecutorOptions {
  resolveYtDlpPath: () => string
  resolveFfmpegLocation: () => string | undefined
  /** Resolve whisper CLI. Throw if unavailable (only needed when subs fail). */
  resolveWhisperCommand: (audioPath: string, outputPath: string) => WhisperCommand
  defaultDownloadDir: string
  defaultRuntimeSettings?: DownloadRuntimeSettings
  killGraceMs?: number
  clock?: () => number
  spawnProcess?: typeof spawn
}

const createTailBuffer = (maxBytes: number) => {
  let buf = Buffer.alloc(0)
  return {
    push(chunk: Buffer | string): void {
      const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      buf = Buffer.concat([buf, next])
      if (buf.length > maxBytes) {
        buf = buf.subarray(buf.length - maxBytes)
      }
    },
    toString(): string {
      return buf.toString('utf8')
    }
  }
}

const sanitizeFilenamePart = (value: string): string => {
  const withoutControl = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint < 32 || codePoint === 127 ? '_' : character
  }).join('')
  const safe = withoutControl
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
  return safe.slice(0, 180) || 'transcript'
}

const appendCookieArgs = (args: string[], settings: DownloadRuntimeSettings): void => {
  const browserForCookies = normalizeBrowserCookiesSettingForYtDlp(settings.browserForCookies)
  const cookiesPath = settings.cookiesPath?.trim()
  const proxy = settings.proxy?.trim()
  const configPath = settings.configPath?.trim()
  if (browserForCookies && browserForCookies !== 'none') {
    args.push('--cookies-from-browser', browserForCookies)
  }
  const resolvedCookies = resolvePathWithHome(cookiesPath)
  if (resolvedCookies) {
    args.push('--cookies', resolvedCookies)
  }
  if (proxy) {
    args.push('--proxy', proxy)
  }
  const resolvedConfig = resolvePathWithHome(configPath)
  if (resolvedConfig) {
    args.push('--config-locations', resolvedConfig)
  }
}

const listFilesRecursive = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full))
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out
}

const pickBestSubtitleFile = (files: string[]): string | null => {
  const subs = files.filter((file) => SUBTITLE_EXTENSIONS.has(path.extname(file).toLowerCase()))
  if (subs.length === 0) return null
  const rank = (file: string): number => {
    const name = path.basename(file).toLowerCase()
    if (name.includes('.en.') || name.endsWith('.en.srt') || name.endsWith('.en.vtt')) return 0
    if (name.includes('.ru.')) return 1
    if (!name.includes('auto')) return 2
    return 3
  }
  return [...subs].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0] ?? null
}

const pickAudioFile = (files: string[]): string | null => {
  const audio = files.filter((file) => AUDIO_EXTENSIONS.has(path.extname(file).toLowerCase()))
  return audio.sort((a, b) => a.localeCompare(b))[0] ?? null
}

export class TextTranscriptionExecutor implements Executor {
  private readonly opts: Required<
    Omit<TextTranscriptionExecutorOptions, 'defaultRuntimeSettings' | 'spawnProcess'>
  > &
    Pick<TextTranscriptionExecutorOptions, 'spawnProcess'> & {
      defaultRuntimeSettings: DownloadRuntimeSettings
    }

  constructor(options: TextTranscriptionExecutorOptions) {
    this.opts = {
      resolveYtDlpPath: options.resolveYtDlpPath,
      resolveFfmpegLocation: options.resolveFfmpegLocation,
      resolveWhisperCommand: options.resolveWhisperCommand,
      defaultDownloadDir: options.defaultDownloadDir,
      defaultRuntimeSettings: options.defaultRuntimeSettings ?? {},
      killGraceMs: options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
      clock: options.clock ?? Date.now,
      spawnProcess: options.spawnProcess
    }
  }

  run(ctx: ExecutorContext, events: ExecutorEvents): ExecutorRun {
    const stdoutTail = createTailBuffer(STDOUT_TAIL_BYTES)
    const stderrTail = createTailBuffer(STDERR_TAIL_BYTES)
    let settled = false
    let cancelRequested = false
    let killTimer: NodeJS.Timeout | null = null
    let activeChild: ChildProcess | null = null
    let workDir: string | null = null

    const finishOnce = (e: Parameters<ExecutorEvents['onFinish']>[0]) => {
      if (settled) return
      settled = true
      if (killTimer) {
        clearTimeout(killTimer)
        killTimer = null
      }
      if (workDir) {
        try {
          rmSync(workDir, { recursive: true, force: true })
        } catch {
          /* best-effort cleanup */
        }
        workDir = null
      }
      events.onFinish(e)
    }

    let progressTicks = 0
    const emitProgress = (percent: number, enteredProcessing = false): void => {
      progressTicks += 1
      events.onProgress({
        taskId: ctx.taskId,
        attemptId: ctx.attemptId,
        progress: {
          percent: Math.max(0, Math.min(1, percent / 100)),
          bytesDownloaded: null,
          bytesTotal: null,
          speedBps: null,
          etaMs: null,
          ticks: progressTicks
        },
        enteredProcessing
      })
    }

    const spawnTracked = (
      command: string,
      args: string[],
      kind: 'yt-dlp' | 'ffmpeg'
    ): Promise<{ code: number | null }> =>
      new Promise((resolve, reject) => {
        if (cancelRequested) {
          resolve({ code: null })
          return
        }
        const spawnFn = this.opts.spawnProcess ?? spawn
        const child = spawnFn(command, args, {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })
        activeChild = child
        const pid = child.pid
        if (typeof pid === 'number' && pid > 0) {
          events.onSpawn({
            taskId: ctx.taskId,
            attemptId: ctx.attemptId,
            pid,
            pidStartedAt: this.opts.clock(),
            kind,
            spawnedAt: this.opts.clock()
          })
        }
        child.stdout?.on('data', (chunk: Buffer) => {
          stdoutTail.push(chunk)
          for (const line of chunk.toString('utf8').split(/\r?\n/)) {
            if (line.trim()) {
              events.onStd({
                taskId: ctx.taskId,
                attemptId: ctx.attemptId,
                stream: 'stdout',
                line
              })
            }
          }
        })
        child.stderr?.on('data', (chunk: Buffer) => {
          stderrTail.push(chunk)
          for (const line of chunk.toString('utf8').split(/\r?\n/)) {
            if (line.trim()) {
              events.onStd({
                taskId: ctx.taskId,
                attemptId: ctx.attemptId,
                stream: 'stderr',
                line
              })
            }
          }
        })
        child.on('error', (error) => {
          activeChild = null
          reject(error)
        })
        child.on('close', (code) => {
          activeChild = null
          resolve({ code })
        })
      })

    const runPipeline = async (): Promise<void> => {
      const taskOptions = (ctx.input.options ?? {}) as YtDlpTaskOptions
      const settings: DownloadRuntimeSettings = {
        ...this.opts.defaultRuntimeSettings,
        ...(taskOptions.settings ?? {})
      }
      const downloadDir =
        taskOptions.customDownloadPath?.trim() ||
        settings.downloadPath?.trim() ||
        this.opts.defaultDownloadDir

      mkdirSync(downloadDir, { recursive: true })
      workDir = mkdtempSync(path.join(tmpdir(), 'vidbee-text-'))

      let ytDlpPath: string
      try {
        ytDlpPath = this.opts.resolveYtDlpPath()
      } catch (err) {
        finishOnce({
          taskId: ctx.taskId,
          attemptId: ctx.attemptId,
          result: {
            type: 'error',
            error: virtualError(
              'binary-missing',
              String(err instanceof Error ? err.message : err)
            ),
            exitCode: null
          },
          closedAt: this.opts.clock(),
          stdoutTail: stdoutTail.toString(),
          stderrTail: String(err instanceof Error ? err.message : err)
        })
        return
      }

      const ffmpegLocation = this.opts.resolveFfmpegLocation()
      const baseArgs = ['--no-playlist', '--no-mtime', '--encoding', 'utf-8']
      if (ffmpegLocation) {
        baseArgs.push('--ffmpeg-location', ffmpegLocation)
      }
      appendCookieArgs(baseArgs, settings)

      emitProgress(5)
      const subsOut = path.join(workDir, 'subs')
      const subsArgs = [
        ...baseArgs,
        '--skip-download',
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs',
        'en.*,ru.*,de.*,es.*,fr.*,pt.*,it.*,ja.*,ko.*,zh.*,*.default',
        '--sub-format',
        'vtt/srt/best',
        '--convert-subs',
        'srt',
        '-o',
        `${subsOut}.%(ext)s`,
        ctx.input.url
      ]
      await spawnTracked(ytDlpPath, subsArgs, 'yt-dlp')
      if (cancelRequested) {
        finishOnce({
          taskId: ctx.taskId,
          attemptId: ctx.attemptId,
          result: { type: 'cancelled' },
          closedAt: this.opts.clock(),
          stdoutTail: stdoutTail.toString(),
          stderrTail: stderrTail.toString()
        })
        return
      }

      emitProgress(25)
      let transcript = ''
      const subFile = pickBestSubtitleFile(listFilesRecursive(workDir))
      if (subFile) {
        try {
          transcript = subtitleFileToPlainText(readFileSync(subFile, 'utf8'))
        } catch {
          transcript = ''
        }
      }

      if (!isUsableTranscript(transcript)) {
        emitProgress(35, true)
        const audioOut = path.join(workDir, 'audio.%(ext)s')
        const audioArgs = [
          ...baseArgs,
          '-f',
          'bestaudio/best',
          '-x',
          '--audio-format',
          'mp3',
          '--audio-quality',
          '5',
          '-o',
          audioOut,
          ctx.input.url
        ]
        const audioResult = await spawnTracked(ytDlpPath, audioArgs, 'yt-dlp')
        if (cancelRequested) {
          finishOnce({
            taskId: ctx.taskId,
            attemptId: ctx.attemptId,
            result: { type: 'cancelled' },
            closedAt: this.opts.clock(),
            stdoutTail: stdoutTail.toString(),
            stderrTail: stderrTail.toString()
          })
          return
        }
        if (audioResult.code !== 0) {
          finishOnce({
            taskId: ctx.taskId,
            attemptId: ctx.attemptId,
            result: {
              type: 'error',
              error: virtualError(
                'unknown',
                'Failed to download audio for transcription (no usable subtitles).'
              ),
              exitCode: audioResult.code
            },
            closedAt: this.opts.clock(),
            stdoutTail: stdoutTail.toString(),
            stderrTail: stderrTail.toString()
          })
          return
        }

        const audioFile = pickAudioFile(listFilesRecursive(workDir))
        if (!audioFile) {
          finishOnce({
            taskId: ctx.taskId,
            attemptId: ctx.attemptId,
            result: {
              type: 'error',
              error: virtualError('output-missing', 'Audio file for transcription was not found.'),
              exitCode: null
            },
            closedAt: this.opts.clock(),
            stdoutTail: stdoutTail.toString(),
            stderrTail: stderrTail.toString()
          })
          return
        }

        const whisperOut = path.join(workDir, 'whisper.txt')
        let whisperCmd: WhisperCommand
        try {
          whisperCmd = this.opts.resolveWhisperCommand(audioFile, whisperOut)
        } catch (err) {
          finishOnce({
            taskId: ctx.taskId,
            attemptId: ctx.attemptId,
            result: {
              type: 'error',
              error: virtualError(
                'binary-missing',
                String(err instanceof Error ? err.message : err)
              ),
              exitCode: null
            },
            closedAt: this.opts.clock(),
            stdoutTail: stdoutTail.toString(),
            stderrTail: String(err instanceof Error ? err.message : err)
          })
          return
        }

        emitProgress(55, true)
        const whisperResult = await spawnTracked(whisperCmd.command, whisperCmd.args, 'ffmpeg')
        if (cancelRequested) {
          finishOnce({
            taskId: ctx.taskId,
            attemptId: ctx.attemptId,
            result: { type: 'cancelled' },
            closedAt: this.opts.clock(),
            stdoutTail: stdoutTail.toString(),
            stderrTail: stderrTail.toString()
          })
          return
        }
        if (whisperResult.code !== 0 || !existsSync(whisperOut)) {
          finishOnce({
            taskId: ctx.taskId,
            attemptId: ctx.attemptId,
            result: {
              type: 'error',
              error: virtualError('unknown', 'Whisper transcription failed.'),
              exitCode: whisperResult.code
            },
            closedAt: this.opts.clock(),
            stdoutTail: stdoutTail.toString(),
            stderrTail: stderrTail.toString()
          })
          return
        }
        transcript = readFileSync(whisperOut, 'utf8').trim()
      }

      if (!isUsableTranscript(transcript)) {
        finishOnce({
          taskId: ctx.taskId,
          attemptId: ctx.attemptId,
          result: {
            type: 'error',
            error: virtualError(
              'output-missing',
              'No usable transcript could be produced from subtitles or speech.'
            ),
            exitCode: null
          },
          closedAt: this.opts.clock(),
          stdoutTail: stdoutTail.toString(),
          stderrTail: stderrTail.toString()
        })
        return
      }

      const titleHint =
        taskOptions.title?.trim() ||
        ctx.input.title?.trim() ||
        path.basename(ctx.input.url).slice(0, 80) ||
        'transcript'
      const fileName = `${sanitizeFilenamePart(titleHint)}.txt`
      const filePath = path.join(downloadDir, fileName)
      writeFileSync(filePath, `${transcript.trim()}\n`, 'utf8')
      const size = statSync(filePath).size
      emitProgress(100, true)

      const output: TaskOutput = {
        filePath,
        size,
        durationMs: null,
        sha256: null
      }
      finishOnce({
        taskId: ctx.taskId,
        attemptId: ctx.attemptId,
        result: { type: 'success', output },
        closedAt: this.opts.clock(),
        stdoutTail: stdoutTail.toString(),
        stderrTail: stderrTail.toString()
      })
    }

    void runPipeline().catch((err) => {
      if (settled) return
      finishOnce({
        taskId: ctx.taskId,
        attemptId: ctx.attemptId,
        result: {
          type: 'error',
          error: virtualError('unknown', String(err instanceof Error ? err.message : err)),
          exitCode: null
        },
        closedAt: this.opts.clock(),
        stdoutTail: stdoutTail.toString(),
        stderrTail: String(err instanceof Error ? err.message : err)
      })
    })

    const requestStop = async (): Promise<void> => {
      cancelRequested = true
      const child = activeChild
      if (!child?.pid) return
      try {
        killProcessTree(child.pid)
      } catch {
        try {
          child.kill('SIGTERM')
        } catch {
          /* noop */
        }
      }
      killTimer = setTimeout(() => {
        if (child.pid) {
          try {
            killProcessTree(child.pid, 'SIGKILL')
          } catch {
            try {
              child.kill('SIGKILL')
            } catch {
              /* noop */
            }
          }
        }
      }, this.opts.killGraceMs)
    }

    return {
      cancel: requestStop,
      pause: requestStop
    }
  }
}
