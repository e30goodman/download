import { buildDownloadArgs, isInstagramUrl, resolveYtDlpPluginDirs } from '@vidbee/downloader-core'
import { describe, expect, it } from 'vitest'

describe('instagram helpers', () => {
  it('detects Instagram URLs', () => {
    expect(isInstagramUrl('https://www.instagram.com/p/DZuO_1pjIF5/')).toBe(true)
    expect(isInstagramUrl('https://instagram.com/reel/abc/')).toBe(true)
    expect(isInstagramUrl('https://www.youtube.com/watch?v=1')).toBe(false)
  })

  it('resolves bundled yt-dlp plugin dirs', () => {
    const pluginDirs = resolveYtDlpPluginDirs()
    expect(pluginDirs).toBeTruthy()
    expect(pluginDirs?.replaceAll('\\', '/')).toMatch(/yt-dlp-plugin-dirs$/)
  })

  it('passes --plugin-dirs into download args', () => {
    const args = buildDownloadArgs(
      {
        url: 'https://www.instagram.com/p/DZuO_1pjIF5/',
        type: 'video',
        format: 'best',
        containerFormat: 'original'
      },
      '/tmp/downloads',
      {}
    )
    const index = args.indexOf('--plugin-dirs')
    expect(index).toBeGreaterThan(-1)
    expect(args[index + 1]).toMatch(/yt-dlp-plugin-dirs/)
  })
})
