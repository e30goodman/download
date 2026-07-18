import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { DownloadRuntimeSettings, VideoInfo } from '@vidbee/downloader-core'
import { assertRemoteHttpUrl, type RemoteUrlPolicyMode } from './remote-url-policy'
import { fetchVideoInfo } from './yt-dlp-info'

const SPOTIFY_HOST = 'open.spotify.com'
const SPOTIFY_TRACK_ID_REGEX = /^[A-Za-z0-9]{22}$/
const SPOTDL_TIMEOUT_MS = 90_000
const SPOTDL_TERMINATION_GRACE_MS = 5000
const MAX_STDOUT_BYTES = 4 * 1024 * 1024
const MAX_STDERR_BYTES = 64 * 1024
const CACHE_TTL_MS = 10 * 60 * 1000
const MAX_CACHE_ENTRIES = 100
const MAX_TEXT_LENGTH = 2000
const MAX_ACTIVE_SPOTDL_PROCESSES = 2
const MAX_WAITING_SPOTDL_PROCESSES = 20

export interface SpotifyTrackUrl {
  canonicalUrl: string
  trackId: string
}

export interface SpotifyResolvedTrack {
  originalUrl: string
  resolvedUrl: string
  title: string
  name: string
  artist: string
  thumbnail?: string
  duration?: number
  sourceProvider: 'spotify'
}

export interface DownloadSourceInput {
  url: string
  title?: string
  thumbnail?: string
  duration?: number
}

export interface ResolvedDownloadSource extends DownloadSourceInput {
  spotify: SpotifyResolvedTrack | null
}

interface RawSpotDlTrack {
  name?: unknown
  artists?: unknown
  artist?: unknown
  duration?: unknown
  cover_url?: unknown
  url?: unknown
  download_url?: unknown
}

interface CacheEntry {
  expiresAt: number
  value: SpotifyResolvedTrack
}

export interface SpotDlRunOptions {
  maxStderrBytes?: number
  maxStdoutBytes?: number
  platform?: NodeJS.Platform
  resolveExecutable?: () => string
  spawnProcess?: typeof spawn
  terminateProcess?: (child: ChildProcess) => void
  timeoutMs?: number
}

export interface SpotDlExecutableOptions {
  env?: NodeJS.ProcessEnv
  homedir?: () => string
  platform?: NodeJS.Platform
  statSync?: typeof fs.statSync
}

export interface SpotifyResolverOptions {
  assertRemoteUrl?: typeof assertRemoteHttpUrl
  now?: () => number
  policyMode: RemoteUrlPolicyMode
  runSpotDl?: (url: string) => Promise<string>
}

interface SourceVideoInfoDependencies {
  fetchVideo?: (url: string, settings?: DownloadRuntimeSettings) => Promise<VideoInfo>
  resolveSpotify?: (
    url: string,
    options: { policyMode: RemoteUrlPolicyMode }
  ) => Promise<SpotifyResolvedTrack | null>
}

export type SpotifySourceErrorCode =
  | 'busy'
  | 'invalid-response'
  | 'invalid-url'
  | 'match-mismatch'
  | 'service-unavailable'
  | 'timeout'
  | 'unavailable'
  | 'unsafe-source'
  | 'unsupported'

export type SpotifySourceErrorCategory = 'busy' | 'internal' | 'service' | 'user'

const ERROR_CATEGORY_BY_CODE: Record<SpotifySourceErrorCode, SpotifySourceErrorCategory> = {
  busy: 'busy',
  'invalid-response': 'internal',
  'invalid-url': 'user',
  'match-mismatch': 'internal',
  'service-unavailable': 'service',
  timeout: 'service',
  unavailable: 'user',
  'unsafe-source': 'internal',
  unsupported: 'user'
}

export class SpotifySourceError extends Error {
  readonly category: SpotifySourceErrorCategory
  readonly code: SpotifySourceErrorCode

  constructor(code: SpotifySourceErrorCode, message = 'Failed to match the Spotify track.') {
    super(message)
    this.name = 'SpotifySourceError'
    this.code = code
    this.category = ERROR_CATEGORY_BY_CODE[code]
  }
}

export const isSpotifyUrl = (input: string): boolean => {
  try {
    return new URL(input.trim()).hostname.toLowerCase() === SPOTIFY_HOST
  } catch {
    return false
  }
}

export const parseSpotifyTrackUrl = (input: string): SpotifyTrackUrl | null => {
  let parsed: URL
  try {
    parsed = new URL(input.trim())
  } catch {
    return null
  }
  if (parsed.hostname.toLowerCase() !== SPOTIFY_HOST) {
    return null
  }
  if (parsed.protocol !== 'https:') {
    throw new SpotifySourceError('invalid-url', 'Spotify links must use HTTPS.')
  }

  const segments = parsed.pathname.split('/').filter(Boolean)
  if (
    segments.length !== 2 ||
    segments[0] !== 'track' ||
    !SPOTIFY_TRACK_ID_REGEX.test(segments[1] ?? '')
  ) {
    throw new SpotifySourceError(
      'unsupported',
      'Only Spotify track links are supported; albums, playlists, and episodes are not supported.'
    )
  }

  const trackId = segments[1] as string
  return {
    canonicalUrl: `https://${SPOTIFY_HOST}/track/${trackId}`,
    trackId
  }
}

export const buildSpotDlArgs = (url: string): string[] => [
  'save',
  url,
  '--save-file',
  '-',
  '--preload',
  '--only-verified-results',
  '--threads',
  '1',
  '--log-level',
  'ERROR'
]

const isAbsolutePath = (targetPath: string, platform: NodeJS.Platform): boolean =>
  platform === 'win32' ? path.win32.isAbsolute(targetPath) : path.posix.isAbsolute(targetPath)

const isRegularFile = (targetPath: string, statSync: typeof fs.statSync): boolean => {
  try {
    return statSync(targetPath).isFile()
  } catch {
    return false
  }
}

export const resolveSpotDlExecutable = (options: SpotDlExecutableOptions = {}): string => {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const statSync = options.statSync ?? fs.statSync
  const configuredPath = env.SPOTDL_PATH?.trim()
  if (
    configuredPath &&
    isAbsolutePath(configuredPath, platform) &&
    isRegularFile(configuredPath, statSync)
  ) {
    return configuredPath
  }

  if (platform === 'win32') {
    const localAppData =
      env.LOCALAPPDATA?.trim() ||
      path.win32.join((options.homedir ?? os.homedir)(), 'AppData', 'Local')
    const isolatedPath = path.win32.join(
      localAppData,
      'DownloadSite',
      'spotdl-venv',
      'Scripts',
      'spotdl.exe'
    )
    if (path.win32.isAbsolute(isolatedPath) && isRegularFile(isolatedPath, statSync)) {
      return isolatedPath
    }
  }

  throw new SpotifySourceError(
    'service-unavailable',
    'Spotify track matching service is unavailable.'
  )
}

export const terminateSpotDlProcess = (
  child: ChildProcess,
  options: { platform?: NodeJS.Platform; spawnProcess?: typeof spawn } = {}
): void => {
  if (child.killed || child.pid === undefined) {
    return
  }
  const platform = options.platform ?? process.platform
  if (platform === 'win32') {
    try {
      const killer = (options.spawnProcess ?? spawn)(
        'taskkill',
        ['/pid', String(child.pid), '/t', '/f'],
        {
          stdio: 'ignore',
          windowsHide: true
        }
      )
      killer.once('error', () => {
        child.kill()
      })
      killer.once('close', (code) => {
        if (code !== 0) {
          child.kill()
        }
      })
      killer.unref()
    } catch {
      child.kill()
    }
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

let activeSpotDlProcesses = 0
type SpotDlPermitRelease = () => void
const spotDlWaiters: Array<(release: SpotDlPermitRelease) => void> = []

const createSpotDlPermitRelease = (): SpotDlPermitRelease => {
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    const nextWaiter = spotDlWaiters.shift()
    if (nextWaiter) {
      nextWaiter(createSpotDlPermitRelease())
      return
    }
    activeSpotDlProcesses -= 1
  }
}

const acquireSpotDlCapacity = (): Promise<SpotDlPermitRelease> => {
  if (activeSpotDlProcesses < MAX_ACTIVE_SPOTDL_PROCESSES) {
    activeSpotDlProcesses += 1
    return Promise.resolve(createSpotDlPermitRelease())
  }
  if (spotDlWaiters.length >= MAX_WAITING_SPOTDL_PROCESSES) {
    return Promise.reject(new SpotifySourceError('busy', 'Spotify track matching service is busy.'))
  }
  return new Promise<SpotDlPermitRelease>((resolve) => {
    spotDlWaiters.push(resolve)
  })
}

const runSpotDlProcess = (url: string, options: SpotDlRunOptions): Promise<string> =>
  new Promise((resolve, reject) => {
    let executable: string
    try {
      executable = (options.resolveExecutable ?? resolveSpotDlExecutable)()
    } catch (error) {
      reject(error)
      return
    }
    const spawnProcess = options.spawnProcess ?? spawn
    const platform = options.platform ?? process.platform
    const timeoutMs = options.timeoutMs ?? SPOTDL_TIMEOUT_MS
    const maxStdoutBytes = options.maxStdoutBytes ?? MAX_STDOUT_BYTES
    const maxStderrBytes = options.maxStderrBytes ?? MAX_STDERR_BYTES
    const terminate =
      options.terminateProcess ??
      ((child: ChildProcess) => {
        terminateSpotDlProcess(child, { platform })
      })
    let child: ReturnType<typeof spawn>
    try {
      child = spawnProcess(executable, buildSpotDlArgs(url), {
        detached: platform !== 'win32',
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch {
      reject(
        new SpotifySourceError(
          'service-unavailable',
          'Spotify track matching service is unavailable.'
        )
      )
      return
    }
    const stdoutChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let terminationError: SpotifySourceError | null = null
    let terminationTimer: NodeJS.Timeout | null = null

    const requestTimer = setTimeout(() => {
      requestTermination(new SpotifySourceError('timeout', 'Spotify track matching timed out.'))
    }, timeoutMs)
    requestTimer.unref()

    const clearTimers = (): void => {
      clearTimeout(requestTimer)
      if (terminationTimer) {
        clearTimeout(terminationTimer)
      }
    }
    const rejectOnce = (error: SpotifySourceError): void => {
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
    function requestTermination(error: SpotifySourceError): void {
      if (settled || terminationError) {
        return
      }
      terminationError = error
      clearTimeout(requestTimer)
      terminationTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // The process may already have exited.
        }
        rejectOnce(error)
      }, SPOTDL_TERMINATION_GRACE_MS)
      terminationTimer.unref()
      terminate(child)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (terminationError) {
        return
      }
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > maxStdoutBytes) {
        requestTermination(
          new SpotifySourceError('invalid-response', 'Spotify metadata response was too large.')
        )
        return
      }
      stdoutChunks.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes = Math.min(stderrBytes + chunk.byteLength, maxStderrBytes)
    })
    child.once('error', () => {
      rejectOnce(
        terminationError ??
          new SpotifySourceError(
            'service-unavailable',
            'Spotify track matching service is unavailable.'
          )
      )
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
      rejectOnce(
        new SpotifySourceError('unavailable', 'Spotify track is unavailable or link is invalid.')
      )
    })
  })

export const runSpotDl = async (url: string, options: SpotDlRunOptions = {}): Promise<string> => {
  const release = await acquireSpotDlCapacity()
  try {
    return await runSpotDlProcess(url, options)
  } finally {
    release()
  }
}

const safeText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_TEXT_LENGTH ? trimmed : undefined
}

const safeHttpUrl = (value: unknown): string | undefined => {
  const text = safeText(value)
  if (!text) {
    return undefined
  }
  try {
    const parsed = new URL(text)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined
  } catch {
    return undefined
  }
}

const parseJsonArray = (stdout: string): unknown[] => {
  const trimmed = stdout.trim()
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) {
      return parsed
    }
  } catch {
    const start = trimmed.indexOf('[')
    const end = trimmed.lastIndexOf(']')
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown
        if (Array.isArray(parsed)) {
          return parsed
        }
      } catch {
        // Fall through to the safe resolver error.
      }
    }
  }
  throw new SpotifySourceError('invalid-response', 'Spotify track metadata was invalid.')
}

export const parseSpotDlOutput = (stdout: string, originalUrl: string): SpotifyResolvedTrack => {
  const entries = parseJsonArray(stdout)
  if (entries.length === 0 || (entries.length === 1 && entries[0] === null)) {
    throw new SpotifySourceError('unavailable', 'Spotify track is unavailable or link is invalid.')
  }
  if (entries.length !== 1 || typeof entries[0] !== 'object') {
    throw new SpotifySourceError('invalid-response', 'Spotify track metadata was invalid.')
  }

  const raw = entries[0] as RawSpotDlTrack
  let responseTrack: SpotifyTrackUrl | null = null
  try {
    const responseUrl = safeText(raw.url)
    responseTrack = responseUrl ? parseSpotifyTrackUrl(responseUrl) : null
  } catch {
    // The response URL must be the exact requested Spotify track.
  }
  const requestedTrack = parseSpotifyTrackUrl(originalUrl)
  if (!responseTrack || responseTrack.trackId !== requestedTrack?.trackId) {
    throw new SpotifySourceError('invalid-response', 'Spotify track metadata was invalid.')
  }
  const name = safeText(raw.name)
  const artists = Array.isArray(raw.artists)
    ? raw.artists.map(safeText).filter((value): value is string => Boolean(value))
    : []
  const artist = artists.join(', ') || safeText(raw.artist)
  const resolvedUrl = safeHttpUrl(raw.download_url)
  if (!(name && artist && resolvedUrl)) {
    throw new SpotifySourceError('invalid-response', 'Spotify track metadata was invalid.')
  }

  const duration =
    typeof raw.duration === 'number' &&
    Number.isFinite(raw.duration) &&
    raw.duration >= 0 &&
    raw.duration <= 86_400
      ? raw.duration
      : undefined

  return {
    originalUrl,
    resolvedUrl,
    title: name,
    name,
    artist,
    thumbnail: safeHttpUrl(raw.cover_url),
    duration,
    sourceProvider: 'spotify'
  }
}

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<SpotifyResolvedTrack>>()

const setCached = (key: string, value: SpotifyResolvedTrack, now: number): void => {
  cache.delete(key)
  cache.set(key, { expiresAt: now + CACHE_TTL_MS, value })
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (typeof oldestKey !== 'string') {
      break
    }
    cache.delete(oldestKey)
  }
}

export const clearSpotifySourceCache = (): void => {
  cache.clear()
  inFlight.clear()
}

const assertSafeResolvedUrl = async (
  result: SpotifyResolvedTrack,
  options: SpotifyResolverOptions
): Promise<void> => {
  try {
    await (options.assertRemoteUrl ?? assertRemoteHttpUrl)(result.resolvedUrl, {
      mode: options.policyMode
    })
  } catch {
    throw new SpotifySourceError('unsafe-source', 'Spotify matched an unsafe media source.')
  }
}

export const resolveSpotifyTrack = async (
  input: string,
  options: SpotifyResolverOptions
): Promise<SpotifyResolvedTrack | null> => {
  const parsed = parseSpotifyTrackUrl(input)
  if (!parsed) {
    return null
  }
  const now = options.now?.() ?? Date.now()
  const cached = cache.get(parsed.canonicalUrl)
  if (cached && cached.expiresAt > now) {
    await assertSafeResolvedUrl(cached.value, options)
    cache.delete(parsed.canonicalUrl)
    cache.set(parsed.canonicalUrl, cached)
    return cached.value
  }
  if (cached) {
    cache.delete(parsed.canonicalUrl)
  }

  const pending = inFlight.get(parsed.canonicalUrl)
  if (pending) {
    const result = await pending
    await assertSafeResolvedUrl(result, options)
    return result
  }

  const resolution = (async (): Promise<SpotifyResolvedTrack> => {
    const stdout = await (options.runSpotDl ?? runSpotDl)(parsed.canonicalUrl)
    const result = parseSpotDlOutput(stdout, parsed.canonicalUrl)
    await assertSafeResolvedUrl(result, options)
    setCached(parsed.canonicalUrl, result, options.now?.() ?? Date.now())
    return result
  })()
  inFlight.set(parsed.canonicalUrl, resolution)
  try {
    return await resolution
  } finally {
    inFlight.delete(parsed.canonicalUrl)
  }
}

export const fetchVideoInfoFromSource = async (
  url: string,
  settings: DownloadRuntimeSettings | undefined,
  policyMode: RemoteUrlPolicyMode,
  dependencies: SourceVideoInfoDependencies = {}
): Promise<VideoInfo> => {
  const spotify = await (dependencies.resolveSpotify ?? resolveSpotifyTrack)(url, { policyMode })
  const video = await (dependencies.fetchVideo ?? fetchVideoInfo)(
    spotify?.resolvedUrl ?? url,
    settings
  )
  if (!spotify) {
    return video
  }
  if (
    spotify.duration !== undefined &&
    video.duration !== undefined &&
    Math.abs(spotify.duration - video.duration) > Math.max(15, spotify.duration * 0.1)
  ) {
    throw new SpotifySourceError('match-mismatch', 'Spotify provider match failed validation.')
  }
  return {
    ...video,
    title: spotify.title,
    thumbnail: spotify.thumbnail,
    duration: spotify.duration,
    extractorKey: 'Spotify',
    webpageUrl: spotify.resolvedUrl,
    uploader: spotify.artist
  }
}

export const resolveDownloadSource = async (
  input: DownloadSourceInput,
  policyMode: RemoteUrlPolicyMode,
  resolveSpotify: typeof resolveSpotifyTrack = resolveSpotifyTrack
): Promise<ResolvedDownloadSource> => {
  const spotify = await resolveSpotify(input.url, { policyMode })
  if (spotify) {
    return {
      url: spotify.resolvedUrl,
      title: spotify.title,
      thumbnail: spotify.thumbnail,
      duration: spotify.duration,
      spotify
    }
  }
  return {
    ...input,
    spotify: null
  }
}
