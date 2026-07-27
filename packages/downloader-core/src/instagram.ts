/**
 * Instagram helpers: photo posts have no audio stream in yt-dlp upstream.
 * A bundled plugin exposes still images as formats; audio downloads probe
 * first and fall back to saving the image when no audio track exists.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface InstagramProbeSettings {
  proxy?: string
  browserForCookies?: string
  cookiesPath?: string
  configPath?: string
}

const trim = (value?: string | null): string | undefined => {
  const next = value?.trim()
  return next ? next : undefined
}

const resolveHomePath = (rawPath?: string | null): string | undefined => {
  const trimmed = trim(rawPath)
  if (!trimmed) {
    return undefined
  }
  if (trimmed === '~') {
    return os.homedir()
  }
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2))
  }
  return trimmed
}

export const isInstagramUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am'
  } catch {
    return false
  }
}

/** Directory passed to yt-dlp `--plugin-dirs` (contains instagram-photos/...). */
export const resolveYtDlpPluginDirs = (): string | null => {
  const fromSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../yt-dlp-plugin-dirs')
  return existsSync(fromSrc) ? fromSrc : null
}

export const appendYtDlpPluginDirs = (args: string[]): void => {
  const pluginDirs = resolveYtDlpPluginDirs()
  if (pluginDirs) {
    args.push('--plugin-dirs', pluginDirs)
  }
}

const formatHasAudio = (format: unknown): boolean => {
  if (!format || typeof format !== 'object') {
    return false
  }
  const acodec = (format as { acodec?: unknown }).acodec
  return typeof acodec === 'string' && acodec !== 'none' && acodec.length > 0
}

const infoHasAudio = (info: unknown): boolean => {
  if (!info || typeof info !== 'object') {
    return false
  }
  const record = info as { formats?: unknown; entries?: unknown; _type?: unknown }
  if (Array.isArray(record.formats) && record.formats.some(formatHasAudio)) {
    return true
  }
  if (record._type === 'playlist' && Array.isArray(record.entries)) {
    return record.entries.some(infoHasAudio)
  }
  return false
}

/**
 * Probe whether an Instagram URL exposes any audio-bearing format.
 * Returns `true` / `false` on success, or `null` when the probe itself fails.
 */
export const probeInstagramHasAudio = (
  ytDlpPath: string,
  url: string,
  settings: InstagramProbeSettings = {}
): boolean | null => {
  const args = ['-j', '--no-playlist', '--no-warnings', '--encoding', 'utf-8', '--socket-timeout', '30']
  appendYtDlpPluginDirs(args)

  const proxy = trim(settings.proxy)
  if (proxy) {
    args.push('--proxy', proxy)
  }

  const browserForCookies = trim(settings.browserForCookies)
  if (browserForCookies && browserForCookies !== 'none') {
    args.push('--cookies-from-browser', browserForCookies)
  }

  const cookiesPath = trim(settings.cookiesPath)
  if (cookiesPath) {
    args.push('--cookies', cookiesPath)
  }

  const configPath = resolveHomePath(settings.configPath)
  if (configPath) {
    args.push('--config-location', configPath)
  }

  args.push(url)

  const result = spawnSync(ytDlpPath, args, {
    encoding: 'utf8',
    timeout: 45_000,
    maxBuffer: 12 * 1024 * 1024,
    windowsHide: true
  })

  if (result.status !== 0 || !result.stdout?.trim()) {
    return null
  }

  try {
    return infoHasAudio(JSON.parse(result.stdout))
  } catch {
    return null
  }
}

export const INSTAGRAM_NO_VIDEO_MESSAGE =
  'This Instagram post has no video or audio to download (photo-only). Try Video type to save the image.'
