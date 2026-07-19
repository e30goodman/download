import { describe, expect, it } from 'vitest'
import { isUsableTranscript, subtitleFileToPlainText } from '@vidbee/downloader-core'

describe('subtitleFileToPlainText', () => {
  it('converts SRT cues to plain text and drops duplicates', () => {
    const srt = `1
00:00:00,000 --> 00:00:01,000
Hello world

2
00:00:01,000 --> 00:00:02,000
Hello world

3
00:00:02,000 --> 00:00:03,500
How are you?
`
    expect(subtitleFileToPlainText(srt)).toBe('Hello world\nHow are you?')
  })

  it('strips WebVTT tags', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
<c>Welcome</c> back

00:00:01.000 --> 00:00:02.000
to the show
`
    expect(subtitleFileToPlainText(vtt)).toBe('Welcome back\nto the show')
  })

  it('detects usable transcript length', () => {
    expect(isUsableTranscript('short')).toBe(false)
    expect(isUsableTranscript('a'.repeat(40))).toBe(true)
  })
})
