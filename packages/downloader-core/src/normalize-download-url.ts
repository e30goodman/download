/**
 * Normalize incoming download URLs before they reach yt-dlp.
 * Threads shares Instagram shortcodes; yt-dlp has no Threads extractor yet,
 * so rewrite post links to the Instagram media endpoint.
 */
export const isThreadsUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return (
      host === 'threads.com' ||
      host.endsWith('.threads.com') ||
      host === 'threads.net' ||
      host.endsWith('.threads.net')
    )
  } catch {
    return false
  }
}

const THREADS_POST_RE = /\/(?:@[^/]+\/)?(?:post|t)\/([A-Za-z0-9_-]+)/

/** Extract Threads post shortcode from a pathname, if present. */
export const extractThreadsShortcode = (url: string): string | null => {
  try {
    const pathname = new URL(url).pathname
    const match = THREADS_POST_RE.exec(pathname)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * Rewrite known unsupported-but-mappable hosts to a yt-dlp-friendly URL.
 * Unknown hosts are returned unchanged.
 */
export const normalizeDownloadUrl = (url: string): string => {
  const trimmed = url.trim()
  if (!trimmed) {
    return url
  }
  if (!isThreadsUrl(trimmed)) {
    return trimmed
  }
  const shortcode = extractThreadsShortcode(trimmed)
  if (!shortcode) {
    return trimmed
  }
  return `https://www.instagram.com/p/${shortcode}/`
}
