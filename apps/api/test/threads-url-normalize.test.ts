import { buildDownloadArgs, normalizeDownloadUrl } from '@vidbee/downloader-core'
import { describe, expect, it } from 'vitest'

describe('normalizeDownloadUrl', () => {
  it('rewrites Threads post URLs to Instagram media URLs', () => {
    expect(
      normalizeDownloadUrl(
        'https://www.threads.com/@aleksandra.umn/post/DbVLrkkALlv?xmt=abc&slof=1'
      )
    ).toBe('https://www.instagram.com/p/DbVLrkkALlv/')
    expect(normalizeDownloadUrl('https://www.threads.net/t/CuXnwmrMIZL')).toBe(
      'https://www.instagram.com/p/CuXnwmrMIZL/'
    )
    expect(normalizeDownloadUrl('https://www.threads.net/@tntsportsbr/post/C6cqebdCfBi')).toBe(
      'https://www.instagram.com/p/C6cqebdCfBi/'
    )
  })

  it('leaves non-Threads URLs unchanged', () => {
    const youtube = 'https://www.youtube.com/watch?v=abc'
    expect(normalizeDownloadUrl(youtube)).toBe(youtube)
  })

  it('passes normalized Threads URLs into yt-dlp args', () => {
    const args = buildDownloadArgs(
      {
        url: 'https://www.threads.com/@user/post/DbVLrkkALlv?xmt=1',
        type: 'video',
        format: 'best',
        containerFormat: 'original'
      },
      '/tmp/downloads',
      {}
    )
    expect(args.at(-1)).toBe('https://www.instagram.com/p/DbVLrkkALlv/')
  })
})
