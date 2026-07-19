import { buildDownloadArgs } from '@vidbee/downloader-core'
import { describe, expect, it } from 'vitest'

describe('audio download arguments', () => {
  it('extracts a selected YouTube audio stream as MP3', () => {
    const args = buildDownloadArgs(
      {
        url: 'https://www.youtube.com/watch?v=example',
        type: 'audio',
        format: 'bestaudio',
        audioFormat: 'mp3'
      },
      'C:\\Downloads',
      {
        embedChapters: false,
        embedMetadata: false,
        embedSubs: false,
        embedThumbnail: false
      }
    )

    expect(args).toEqual(
      expect.arrayContaining(['-f', 'bestaudio', '--extract-audio', '--audio-format', 'mp3'])
    )
  })

  it('does not pass unsupported converter formats to yt-dlp', () => {
    const args = buildDownloadArgs(
      {
        url: 'https://www.youtube.com/watch?v=example',
        type: 'audio',
        format: 'bestaudio',
        audioFormat: 'not-a-format'
      },
      'C:\\Downloads',
      {}
    )

    expect(args).not.toContain('--extract-audio')
    expect(args).not.toContain('--audio-format')
  })
})
