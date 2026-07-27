/**
 * Convert subtitle files (SRT / WebVTT) into plain transcript text.
 * Auto-generated YouTube captions use a rolling karaoke window: each cue
 * repeats the tail of the previous one. Consecutive duplicates, prefix
 * extensions, and word-level overlaps are collapsed.
 */

const TIMESTAMP_LINE =
  /^\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s+-->\s+\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}/
const WEBVTT_HEADER = /^WEBVTT\b/i
const CUE_INDEX = /^\d+$/
const TAG_RE = /<[^>]+>/g
const NOTE_OR_STYLE = /^(NOTE|STYLE|REGION)\b/i
/** Ignore 1-word overlaps — too easy to false-positive on common words. */
const MIN_OVERLAP_WORDS = 2

const normalizeCueText = (raw: string): string =>
  raw
    .replace(TAG_RE, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()

/** Longest word-suffix of `previous` that equals a word-prefix of `text`. */
const wordOverlapCount = (previous: string, text: string): number => {
  const previousWords = previous.split(' ')
  const textWords = text.split(' ')
  const max = Math.min(previousWords.length, textWords.length)
  let overlap = 0
  for (let count = 1; count <= max; count++) {
    if (previousWords.slice(-count).join(' ') === textWords.slice(0, count).join(' ')) {
      overlap = count
    }
  }
  return overlap
}

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
    // Scroll/commit frame: entire cue is already the visible tail of previous.
    if (previous && previous.endsWith(text)) {
      return
    }
    if (previous) {
      const overlap = wordOverlapCount(previous, text)
      const textWords = text.split(' ')
      if (overlap === textWords.length) {
        return
      }
      if (overlap >= MIN_OVERLAP_WORDS) {
        cues.push(textWords.slice(overlap).join(' '))
        return
      }
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
