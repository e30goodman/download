/**
 * Convert subtitle files (SRT / WebVTT) into plain transcript text.
 * Auto-generated YouTube captions often repeat the same cue; consecutive
 * duplicates are collapsed.
 */

const TIMESTAMP_LINE =
  /^\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s+-->\s+\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}/
const WEBVTT_HEADER = /^WEBVTT\b/i
const CUE_INDEX = /^\d+$/
const TAG_RE = /<[^>]+>/g
const NOTE_OR_STYLE = /^(NOTE|STYLE|REGION)\b/i

const normalizeCueText = (raw: string): string =>
  raw
    .replace(TAG_RE, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()

export const subtitleFileToPlainText = (content: string): string => {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  const cues: string[] = []
  let collecting = false
  let buffer: string[] = []

  const flush = (): void => {
    if (buffer.length === 0) {
      collecting = false
      return
    }
    const text = normalizeCueText(buffer.join(' '))
    buffer = []
    collecting = false
    if (!text) return
    const previous = cues.at(-1)
    if (previous === text) return
    // YouTube auto-captions roll forward: each cue extends the previous one.
    if (previous && text.startsWith(previous)) {
      cues[cues.length - 1] = text
      return
    }
    if (previous && previous.startsWith(text)) {
      return
    }
    cues.push(text)
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      flush()
      continue
    }
    if (WEBVTT_HEADER.test(line) || NOTE_OR_STYLE.test(line) || CUE_INDEX.test(line)) {
      continue
    }
    if (TIMESTAMP_LINE.test(line)) {
      flush()
      collecting = true
      continue
    }
    if (collecting) {
      buffer.push(line)
    }
  }
  flush()

  return cues.join('\n').trim()
}

export const isUsableTranscript = (text: string, minChars = 40): boolean =>
  text.replace(/\s+/g, ' ').trim().length >= minChars
