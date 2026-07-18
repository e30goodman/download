import type { DownloadRuntimeSettings, ResolveDeliveryInput } from '@vidbee/downloader-core'
import { describe, expect, it } from 'vitest'
import { selectDirectDeliveryCandidate } from '../src/lib/direct-delivery'
import { buildDirectVideoInfoArgs, type RawVideoInfo } from '../src/lib/yt-dlp-info'

const directInput: ResolveDeliveryInput = {
  url: 'https://example.com/watch/1',
  formatId: 'muxed',
  type: 'video',
  containerFormat: 'auto',
  settings: {
    embedSubs: false,
    embedThumbnail: false,
    embedMetadata: false,
    embedChapters: false
  }
}

const rawInfo: RawVideoInfo = {
  id: 'one',
  title: 'A/B: video',
  formats: [
    {
      format_id: 'muxed',
      url: 'https://cdn.example.com/video.mp4?expire=2000000000',
      ext: 'mp4',
      protocol: 'https',
      vcodec: 'avc1',
      acodec: 'mp4a',
      filesize: 1234
    }
  ]
}

describe('direct delivery selection', () => {
  it('selects an exact, muxed HTTP format', () => {
    expect(selectDirectDeliveryCandidate(rawInfo, directInput)).toEqual({
      url: 'https://cdn.example.com/video.mp4?expire=2000000000',
      filename: 'A_B_ video.mp4',
      mime: 'video/mp4',
      contentLength: 1234
    })
  })

  it('falls back when processing is requested', () => {
    expect(
      selectDirectDeliveryCandidate(rawInfo, {
        ...directInput,
        startTime: '00:10'
      })
    ).toEqual({ mode: 'server', reason: 'processing-required' })
  })

  it.each([
    { browserForCookies: 'chrome' },
    { cookiesPath: 'cookies.txt' },
    { proxy: 'http://proxy.example:8080' },
    { configPath: 'yt-dlp.conf' }
  ] satisfies DownloadRuntimeSettings[])(
    'falls back for sensitive runtime settings',
    (sensitiveSettings) => {
      expect(
        selectDirectDeliveryCandidate(rawInfo, {
          ...directInput,
          settings: {
            ...directInput.settings,
            ...sensitiveSettings
          }
        })
      ).toEqual({ mode: 'server', reason: 'authentication-required' })
    }
  )

  it('treats the explicit no-cookies browser setting as safe', () => {
    expect(
      selectDirectDeliveryCandidate(rawInfo, {
        ...directInput,
        settings: {
          ...directInput.settings,
          browserForCookies: 'none'
        }
      })
    ).toMatchObject({ url: 'https://cdn.example.com/video.mp4?expire=2000000000' })
  })

  it('falls back for manifests and fragmented formats', () => {
    expect(
      selectDirectDeliveryCandidate(
        {
          ...rawInfo,
          formats: [
            {
              ...rawInfo.formats?.[0],
              manifest_url: 'https://cdn.example.com/master.m3u8'
            }
          ]
        },
        directInput
      )
    ).toEqual({ mode: 'server', reason: 'unsupported-format' })
  })

  it.each([
    { 'User-Agent': 'browser' },
    { Accept: '*/*' },
    { 'Accept-Language': 'en-US' },
    { Authorization: 'Bearer secret' }
  ])('falls back for any required HTTP headers', (httpHeaders) => {
    expect(
      selectDirectDeliveryCandidate(
        {
          ...rawInfo,
          http_headers: httpHeaders
        },
        directInput
      )
    ).toEqual({ mode: 'server', reason: 'authentication-required' })
  })

  it('falls back for format-level HTTP headers', () => {
    expect(
      selectDirectDeliveryCandidate(
        {
          ...rawInfo,
          formats: [
            {
              ...rawInfo.formats?.[0],
              http_headers: { Accept: '*/*' }
            }
          ]
        },
        directInput
      )
    ).toEqual({ mode: 'server', reason: 'authentication-required' })
  })

  it('does not substitute a different format', () => {
    expect(
      selectDirectDeliveryCandidate(rawInfo, {
        ...directInput,
        formatId: 'missing'
      })
    ).toEqual({ mode: 'server', reason: 'format-unavailable' })
  })

  it('builds isolated direct metadata arguments', () => {
    const args = buildDirectVideoInfoArgs('https://www.youtube.com/watch?v=video')

    expect(args[0]).toBe('--ignore-config')
    expect(args).not.toContain('--config-location')
    expect(args).not.toContain('--cookies')
    expect(args).not.toContain('--cookies-from-browser')
    expect(args).not.toContain('--proxy')
  })
})
