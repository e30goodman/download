/**
 * Stateless yt-dlp metadata client used by `videoInfo` and `playlist.info`.
 * Replaces the equivalent calls on `DownloaderCore`, which the API layer
 * no longer instantiates after NEX-131.
 */
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import type {
  DownloadRuntimeSettings,
  PlaylistInfo,
  VideoFormat,
  VideoInfo
} from '@vidbee/downloader-core'
import { buildPlaylistInfoArgs, buildVideoInfoArgs } from '@vidbee/downloader-core'

export interface RawVideoFormat {
  format_id?: string | null
  url?: string | null
  ext?: string | null
  protocol?: string | null
  width?: number | null
  height?: number | null
  fps?: number | null
  vcodec?: string | null
  acodec?: string | null
  filesize?: number | null
  filesize_approx?: number | null
  format_note?: string | null
  tbr?: number | null
  quality?: number | null
  language?: string | null
  video_ext?: string | null
  audio_ext?: string | null
  manifest_url?: string | null
  fragments?: unknown[] | null
  has_drm?: boolean | null
  drm_family?: string | null
  http_headers?: Record<string, unknown> | null
  cookies?: string | null
}

export interface RawVideoInfo {
  id?: string
  title?: string
  thumbnail?: string | null
  duration?: number | null
  extractor_key?: string | null
  webpage_url?: string | null
  description?: string | null
  view_count?: number | null
  uploader?: string | null
  tags?: unknown
  formats?: RawVideoFormat[]
  http_headers?: Record<string, unknown> | null
  cookies?: string | null
}

interface RawPlaylistEntry {
  id?: string | null
  title?: string | null
  url?: string | null
  webpage_url?: string | null
  original_url?: string | null
  ie_key?: string | null
  thumbnail?: string | null
}

interface RawPlaylistInfo {
  id?: string | null
  title?: string | null
  entries?: RawPlaylistEntry[]
}

const trim = (v?: string | null): string => v?.trim() ?? ''
const optString = (v: unknown): string | undefined => {
  if (typeof v !== 'string') {
    return undefined
  }
  const t = v.trim()
  return t.length ? t : undefined
}
const optNumber = (v: unknown): number | undefined =>
  typeof v === 'number' && !Number.isNaN(v) ? v : undefined

const optStringArray = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) {
    return undefined
  }
  const list = v
    .filter((e): e is string => typeof e === 'string')
    .map((e) => e.trim())
    .filter((e) => e.length > 0)
  return list.length ? list : undefined
}

const isHttpUrl = (v?: string | null): boolean => {
  if (!v) {
    return false
  }
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

const resolveEntryUrl = (entry: RawPlaylistEntry): string | undefined => {
  if (isHttpUrl(entry.url)) {
    return optString(entry.url)
  }
  if (isHttpUrl(entry.webpage_url)) {
    return optString(entry.webpage_url)
  }
  if (isHttpUrl(entry.original_url)) {
    return optString(entry.original_url)
  }
  if (entry.url) {
    const id = entry.url.trim()
    const ie = entry.ie_key?.toLowerCase() ?? ''
    if (ie.includes('youtube')) {
      return `https://www.youtube.com/watch?v=${id}`
    }
    if (ie.includes('youtubemusic')) {
      return `https://music.youtube.com/watch?v=${id}`
    }
  }
  return undefined
}

let cachedYtDlpPath: string | null = null
const YT_DLP_TIMEOUT_MS = 45_000
const YT_DLP_TERMINATION_GRACE_MS = 5000
const MAX_STDOUT_BYTES = 16 * 1024 * 1024
const MAX_STDERR_BYTES = 64 * 1024

export class YtDlpInfoError extends Error {
  constructor(message = 'Failed to resolve remote media metadata.') {
    super(message)
    this.name = 'YtDlpInfoError'
  }
}

const resolveYtDlpPath = (): string => {
  if (cachedYtDlpPath && fs.existsSync(cachedYtDlpPath)) {
    return cachedYtDlpPath
  }
  const env = trim(process.env.YTDLP_PATH)
  if (env && fs.existsSync(env)) {
    cachedYtDlpPath = env
    return env
  }
  try {
    const out = execSync(process.platform === 'win32' ? 'where yt-dlp' : 'which yt-dlp', {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      maxBuffer: MAX_STDERR_BYTES
    })
      .toString()
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0)
    if (out && fs.existsSync(out)) {
      cachedYtDlpPath = out
      return out
    }
  } catch {
    /* noop */
  }
  throw new YtDlpInfoError('Media metadata service is unavailable.')
}

const killProcessTree = (child: ReturnType<typeof spawn>): void => {
  if (child.killed || child.pid === undefined) {
    return
  }
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true
    })
    killer.on('error', () => {
      child.kill()
    })
    killer.unref()
    return
  }
  child.kill('SIGKILL')
}

const runYtDlp = (args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    let ytDlp: string
    try {
      ytDlp = resolveYtDlpPath()
    } catch (error) {
      reject(error)
      return
    }
    const child = spawn(ytDlp, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const stdoutChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let terminationError: YtDlpInfoError | null = null
    let requestTimer: NodeJS.Timeout | null = null
    let terminationTimer: NodeJS.Timeout | null = null

    const clearTimers = (): void => {
      if (requestTimer) {
        clearTimeout(requestTimer)
      }
      if (terminationTimer) {
        clearTimeout(terminationTimer)
      }
    }
    const rejectOnce = (error: YtDlpInfoError): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimers()
      reject(error)
    }
    const resolveOnce = (stdout: string): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimers()
      resolve(stdout)
    }
    const requestTermination = (error: YtDlpInfoError): void => {
      if (settled || terminationError) {
        return
      }
      terminationError = error
      if (requestTimer) {
        clearTimeout(requestTimer)
      }
      killProcessTree(child)
      terminationTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // The process may already have exited between the guard and this fallback.
        }
        rejectOnce(error)
      }, YT_DLP_TERMINATION_GRACE_MS)
      terminationTimer.unref()
    }

    requestTimer = setTimeout(() => {
      requestTermination(new YtDlpInfoError('Media metadata request timed out.'))
    }, YT_DLP_TIMEOUT_MS)
    requestTimer.unref()

    child.stdout.on('data', (chunk: Buffer) => {
      if (terminationError) {
        return
      }
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        requestTermination(new YtDlpInfoError('Media metadata response was too large.'))
        return
      }
      stdoutChunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes >= MAX_STDERR_BYTES) {
        return
      }
      const remainingBytes = MAX_STDERR_BYTES - stderrBytes
      const boundedChunk = chunk.subarray(0, remainingBytes)
      stderrBytes += boundedChunk.byteLength
    })
    child.once('error', () => {
      rejectOnce(terminationError ?? new YtDlpInfoError())
    })
    child.once('close', (code) => {
      if (terminationError) {
        rejectOnce(terminationError)
        return
      }
      const stdout = Buffer.concat(stdoutChunks, stdoutBytes).toString('utf8')
      if (code === 0 && stdout.trim()) {
        resolveOnce(stdout)
        return
      }
      rejectOnce(new YtDlpInfoError())
    })
  })

const parseVideoInfoPayload = (stdout: string): RawVideoInfo => {
  try {
    return JSON.parse(stdout) as RawVideoInfo
  } catch (err) {
    const firstLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('{') || line.startsWith('['))
    if (!firstLine) {
      throw err
    }
    return JSON.parse(firstLine) as RawVideoInfo
  }
}

const fetchRawVideoInfoWithArgs = async (args: string[]): Promise<RawVideoInfo> => {
  const stdout = await runYtDlp(args)
  try {
    return parseVideoInfoPayload(stdout)
  } catch {
    throw new YtDlpInfoError()
  }
}

// yt-dlp documents --ignore-config as disabling implicit portable, user, and system config files.
export const buildDirectVideoInfoArgs = (url: string): string[] => [
  '--ignore-config',
  ...buildVideoInfoArgs(url, {})
]

export async function fetchRawVideoInfo(
  url: string,
  settings: DownloadRuntimeSettings = {}
): Promise<RawVideoInfo> {
  const target = url.trim()
  if (!target) {
    throw new YtDlpInfoError('URL is required.')
  }
  const args = buildVideoInfoArgs(target, settings)
  return await fetchRawVideoInfoWithArgs(args)
}

export async function fetchRawDirectVideoInfo(url: string): Promise<RawVideoInfo> {
  const target = url.trim()
  if (!target) {
    throw new YtDlpInfoError('URL is required.')
  }
  return await fetchRawVideoInfoWithArgs(buildDirectVideoInfoArgs(target))
}

export async function fetchVideoInfo(
  url: string,
  settings: DownloadRuntimeSettings = {}
): Promise<VideoInfo> {
  const target = url.trim()
  const raw = await fetchRawVideoInfo(target, settings)
  const formats: VideoFormat[] = (raw.formats ?? []).map((f) => ({
    formatId: f.format_id ?? 'unknown',
    ext: f.ext ?? 'unknown',
    width: optNumber(f.width),
    height: optNumber(f.height),
    fps: optNumber(f.fps),
    vcodec: optString(f.vcodec),
    acodec: optString(f.acodec),
    filesize: optNumber(f.filesize),
    filesizeApprox: optNumber(f.filesize_approx),
    formatNote: optString(f.format_note),
    tbr: optNumber(f.tbr),
    quality: optNumber(f.quality),
    protocol: optString(f.protocol),
    language: optString(f.language),
    videoExt: optString(f.video_ext),
    audioExt: optString(f.audio_ext)
  }))
  return {
    id: raw.id ?? target,
    title: raw.title ?? target,
    thumbnail: optString(raw.thumbnail),
    duration: optNumber(raw.duration),
    extractorKey: optString(raw.extractor_key),
    webpageUrl: optString(raw.webpage_url),
    description: optString(raw.description),
    viewCount: optNumber(raw.view_count),
    uploader: optString(raw.uploader),
    tags: optStringArray(raw.tags),
    formats
  }
}

export async function fetchPlaylistInfo(
  url: string,
  settings: DownloadRuntimeSettings = {}
): Promise<PlaylistInfo> {
  const target = url.trim()
  if (!target) {
    throw new YtDlpInfoError('URL is required.')
  }
  const args = buildPlaylistInfoArgs(target, settings)
  const stdout = await runYtDlp(args)
  let raw: RawPlaylistInfo
  try {
    raw = JSON.parse(stdout) as RawPlaylistInfo
  } catch {
    throw new YtDlpInfoError()
  }
  const rawEntries = Array.isArray(raw.entries) ? raw.entries : []
  const entries = rawEntries
    .map((entry, index) => {
      const resolvedUrl = resolveEntryUrl(entry)
      if (!resolvedUrl) {
        return null
      }
      return {
        id: optString(entry.id) ?? `${index + 1}`,
        title: optString(entry.title) ?? `Entry ${index + 1}`,
        url: resolvedUrl,
        index: index + 1,
        thumbnail: optString(entry.thumbnail)
      }
    })
    .filter((e): e is NonNullable<typeof e> => Boolean(e))
  return {
    id: optString(raw.id) ?? target,
    title: optString(raw.title) ?? 'Playlist',
    entries,
    entryCount: entries.length
  }
}
