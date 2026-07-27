import { isUsableTranscript, subtitleFileToPlainText } from '@vidbee/downloader-core'
import { describe, expect, it } from 'vitest'

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

  it('collapses YouTube rolling karaoke caption overlaps', () => {
    const vtt = `WEBVTT

00:00:00.199 --> 00:00:02.230
Ну,<00:00:00.320><c> насчёт</c><00:00:00.640><c> того,</c><00:00:00.919><c> что</c><00:00:01.199><c> анкореческие</c>

00:00:02.230 --> 00:00:02.240
Ну, насчёт того, что анкореческие
 

00:00:02.240 --> 00:00:03.990
Ну, насчёт того, что анкореческие
договорённости<00:00:03.000><c> провалились,</c><00:00:03.679><c> надо,</c>

00:00:03.990 --> 00:00:04.000
договорённости провалились, надо,
 

00:00:04.000 --> 00:00:06.869
договорённости провалились, надо,
наверное,<00:00:05.279><c> понять,</c><00:00:06.080><c> кто</c><00:00:06.319><c> конкретно</c>

00:00:06.869 --> 00:00:06.879
наверное, понять, кто конкретно
`
    expect(subtitleFileToPlainText(vtt)).toBe(
      [
        'Ну, насчёт того, что анкореческие договорённости провалились, надо,',
        'наверное, понять, кто конкретно'
      ].join('\n')
    )
  })

  it('detects usable transcript length', () => {
    expect(isUsableTranscript('short')).toBe(false)
    expect(isUsableTranscript('a'.repeat(40))).toBe(true)
  })
})
