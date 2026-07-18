import type {
  DeliveryServerReason,
  ResolveDeliveryInput,
  ResolveDeliveryOutput
} from '@vidbee/downloader-core'
import { assertRemoteHttpUrl } from './remote-url-policy'
import { fetchRawDirectVideoInfo, type RawVideoFormat, type RawVideoInfo } from './yt-dlp-info'

type ServerDelivery = Extract<ResolveDeliveryOutput, { mode: 'server' }>
type DirectDelivery = Extract<ResolveDeliveryOutput, { mode: 'direct' }>

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v'
}

const serverDelivery = (reason: DeliveryServerReason): ServerDelivery => ({
  mode: 'server',
  reason
})

const hasValue = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0

const requiresProcessing = (input: ResolveDeliveryInput): boolean => {
  const settings = input.settings
  return (
    input.type !== 'video' ||
    hasValue(input.audioFormat) ||
    (input.audioFormatIds?.some((id) => id.trim().length > 0) ?? false) ||
    hasValue(input.startTime) ||
    hasValue(input.endTime) ||
    (input.containerFormat !== undefined &&
      input.containerFormat !== 'auto' &&
      input.containerFormat !== 'original') ||
    (settings?.embedSubs ?? true) ||
    (settings?.embedMetadata ?? true) ||
    (settings?.embedChapters ?? true) ||
    (settings?.embedThumbnail ?? false)
  )
}

const requiresServerCredentials = (input: ResolveDeliveryInput): boolean => {
  const settings = input.settings
  const browserForCookies = settings?.browserForCookies?.trim()
  return Boolean(
    (browserForCookies && browserForCookies !== 'none') ||
      settings?.cookiesPath?.trim() ||
      settings?.proxy?.trim() ||
      settings?.configPath?.trim()
  )
}

const hasUnsupportedHeaders = (
  ...headerSets: Array<Record<string, unknown> | null | undefined>
): boolean => headerSets.some((headers) => Object.keys(headers ?? {}).length > 0)

const sanitizeFilenamePart = (value: string): string => {
  const withoutControlCharacters = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint < 32 || codePoint === 127 ? '_' : character
  }).join('')
  const safe = withoutControlCharacters
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
  return safe.slice(0, 180) || 'download'
}

const parseExpiresAt = (url: URL): string | undefined => {
  for (const key of ['expire', 'expires', 'exp']) {
    const rawValue = url.searchParams.get(key)
    if (!rawValue) {
      continue
    }
    const numericValue = Number(rawValue)
    const milliseconds =
      Number.isFinite(numericValue) && numericValue > 0
        ? numericValue > 10_000_000_000
          ? numericValue
          : numericValue * 1000
        : Date.parse(rawValue)
    if (Number.isFinite(milliseconds) && milliseconds > 0) {
      return new Date(milliseconds).toISOString()
    }
  }
  return undefined
}

const selectExactFormat = (raw: RawVideoInfo, formatId: string): RawVideoFormat | undefined =>
  raw.formats?.find((format) => format.format_id?.trim() === formatId.trim())

interface DirectCandidate {
  url: string
  filename: string
  mime?: string
  contentLength?: number
}

export const selectDirectDeliveryCandidate = (
  raw: RawVideoInfo,
  input: ResolveDeliveryInput
): DirectCandidate | ServerDelivery => {
  if (requiresServerCredentials(input)) {
    return serverDelivery('authentication-required')
  }
  if (requiresProcessing(input)) {
    return serverDelivery('processing-required')
  }

  const format = selectExactFormat(raw, input.formatId)
  if (!format) {
    return serverDelivery('format-unavailable')
  }
  const protocol = format.protocol?.trim().toLowerCase()
  const isMuxed =
    hasValue(format.vcodec) &&
    format.vcodec?.toLowerCase() !== 'none' &&
    hasValue(format.acodec) &&
    format.acodec?.toLowerCase() !== 'none'
  const hasManifestOrFragments =
    hasValue(format.manifest_url) || (format.fragments?.length ?? 0) > 0
  if (
    !isMuxed ||
    (protocol !== 'http' && protocol !== 'https') ||
    !hasValue(format.url) ||
    hasManifestOrFragments ||
    format.has_drm === true ||
    hasValue(format.drm_family)
  ) {
    return serverDelivery('unsupported-format')
  }
  if (
    hasValue(raw.cookies) ||
    hasValue(format.cookies) ||
    hasUnsupportedHeaders(raw.http_headers, format.http_headers)
  ) {
    return serverDelivery('authentication-required')
  }

  const extension = format.ext?.trim().toLowerCase() || 'mp4'
  const title = sanitizeFilenamePart(raw.title?.trim() || raw.id?.trim() || 'download')
  const size = format.filesize ?? format.filesize_approx
  return {
    url: format.url?.trim() ?? '',
    filename: `${title}.${sanitizeFilenamePart(extension)}`,
    mime: MIME_BY_EXTENSION[extension],
    contentLength:
      typeof size === 'number' && Number.isFinite(size) && size >= 0 ? Math.trunc(size) : undefined
  }
}

export const resolveDirectDelivery = async (
  input: ResolveDeliveryInput
): Promise<ResolveDeliveryOutput> => {
  if (requiresServerCredentials(input)) {
    return serverDelivery('authentication-required')
  }

  try {
    await assertRemoteHttpUrl(input.url, { mode: 'public' })
  } catch {
    return serverDelivery('unsafe-source')
  }

  let raw: RawVideoInfo
  try {
    raw = await fetchRawDirectVideoInfo(input.url)
  } catch {
    return serverDelivery('resolution-failed')
  }

  const candidate = selectDirectDeliveryCandidate(raw, input)
  if ('mode' in candidate) {
    return candidate
  }

  let directUrl: URL
  try {
    directUrl = await assertRemoteHttpUrl(candidate.url, { mode: 'public' })
  } catch {
    return serverDelivery('unsafe-source')
  }

  const result: DirectDelivery = {
    mode: 'direct',
    url: directUrl.toString(),
    filename: candidate.filename
  }
  if (candidate.mime) {
    result.mime = candidate.mime
  }
  if (candidate.contentLength !== undefined) {
    result.contentLength = candidate.contentLength
  }
  const expiresAt = parseExpiresAt(directUrl)
  if (expiresAt) {
    result.expiresAt = expiresAt
  }
  return result
}
