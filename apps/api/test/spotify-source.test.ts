import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import type { VideoInfo } from '@vidbee/downloader-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildSpotDlArgs,
  clearSpotifySourceCache,
  fetchVideoInfoFromSource,
  parseSpotDlOutput,
  parseSpotifyTrackUrl,
  resolveDownloadSource,
  resolveSpotDlExecutable,
  resolveSpotifyTrack,
  runSpotDl,
  type SpotifyResolvedTrack,
  SpotifySourceError,
  terminateSpotDlProcess
} from '../src/lib/spotify-source'

const spotifyUrl = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'
const unavailableSpotifyUrl = 'https://open.spotify.com/track/4jCeTPqv46gIBiN9dB2zzr'
const resolvedUrl = 'https://music.youtube.com/watch?v=Zi_XLOBDo_Y'

const validPayload = JSON.stringify([
  {
    name: 'Billie Jean',
    artists: ['Michael Jackson'],
    artist: 'Michael Jackson',
    duration: 294,
    cover_url: 'https://i.scdn.co/image/cover',
    url: spotifyUrl,
    download_url: resolvedUrl
  }
])

const createFakeChild = () => {
  const child = new EventEmitter() as EventEmitter & {
    killed: boolean
    kill: ReturnType<typeof vi.fn>
    pid: number
    stderr: PassThrough
    stdout: PassThrough
  }
  child.killed = false
  child.kill = vi.fn()
  child.pid = 123
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  return child
}

describe('Spotify source resolver', () => {
  beforeEach(() => {
    clearSpotifySourceCache()
  })

  it('accepts only canonical Spotify track URLs and removes query parameters', () => {
    expect(parseSpotifyTrackUrl(`${spotifyUrl}?si=secret#fragment`)).toEqual({
      canonicalUrl: spotifyUrl,
      trackId: '4uLU6hMCjMI75M1A2tKUQC'
    })
    expect(parseSpotifyTrackUrl('https://example.com/track/4uLU6hMCjMI75M1A2tKUQC')).toBeNull()
  })

  it.each(['album', 'playlist', 'episode'])(
    'rejects Spotify %s URLs without invoking a downloader',
    (kind) => {
      expect(() =>
        parseSpotifyTrackUrl(`https://open.spotify.com/${kind}/4uLU6hMCjMI75M1A2tKUQC`)
      ).toThrow('Only Spotify track links are supported')
    }
  )

  it('builds the pinned safe spotDL invocation', () => {
    expect(buildSpotDlArgs(spotifyUrl)).toEqual([
      'save',
      spotifyUrl,
      '--save-file',
      '-',
      '--preload',
      '--only-verified-results',
      '--threads',
      '1',
      '--log-level',
      'ERROR'
    ])
  })

  it('resolves only an absolute regular executable from env', () => {
    const statSync = vi.fn(() => ({ isFile: () => true }))
    expect(
      resolveSpotDlExecutable({
        env: {
          LOCALAPPDATA: 'C:\\Users\\operator\\AppData\\Local',
          SPOTDL_PATH: 'C:\\tools\\spotdl.exe'
        },
        platform: 'win32',
        statSync: statSync as never
      })
    ).toBe('C:\\tools\\spotdl.exe')
    expect(statSync).toHaveBeenCalledWith('C:\\tools\\spotdl.exe')
  })

  it('uses the known isolated AppData executable and never falls back to PATH', () => {
    const knownPath =
      'C:\\Users\\user\\AppData\\Local\\DownloadSite\\spotdl-venv\\Scripts\\spotdl.exe'
    expect(
      resolveSpotDlExecutable({
        env: {
          LOCALAPPDATA: 'C:\\Users\\user\\AppData\\Local',
          SPOTDL_PATH: 'spotdl.exe'
        },
        platform: 'win32',
        statSync: vi.fn((candidate: string) => {
          if (candidate === knownPath) {
            return { isFile: () => true } as never
          }
          throw new Error('missing')
        }) as never
      })
    ).toBe(knownPath)

    expect(() =>
      resolveSpotDlExecutable({
        env: { LOCALAPPDATA: 'C:\\missing', SPOTDL_PATH: 'spotdl.exe' },
        platform: 'win32',
        statSync: vi.fn(() => {
          throw new Error('missing')
        }) as never
      })
    ).toThrow(
      expect.objectContaining({
        category: 'service',
        code: 'service-unavailable'
      })
    )
  })

  it('spawns spotDL without a shell and captures JSON output', async () => {
    const child = createFakeChild()
    const spawnProcess = vi.fn(() => child)
    setTimeout(() => {
      child.stdout.end(validPayload)
      child.emit('close', 0)
    }, 0)

    await expect(
      runSpotDl(spotifyUrl, {
        resolveExecutable: () => 'C:\\isolated\\spotdl.exe',
        spawnProcess: spawnProcess as never
      })
    ).resolves.toBe(validPayload)
    expect(spawnProcess).toHaveBeenCalledWith(
      'C:\\isolated\\spotdl.exe',
      buildSpotDlArgs(spotifyUrl),
      expect.objectContaining({ shell: false })
    )
  })

  it('terminates a timed out process once', async () => {
    const child = createFakeChild()
    const terminateProcess = vi.fn(() => child.emit('close', null))

    await expect(
      runSpotDl(spotifyUrl, {
        resolveExecutable: () => 'C:\\isolated\\spotdl.exe',
        spawnProcess: vi.fn(() => child) as never,
        terminateProcess,
        timeoutMs: 5
      })
    ).rejects.toThrow('timed out')
    expect(terminateProcess).toHaveBeenCalledTimes(1)
  })

  it('terminates when stdout exceeds the configured limit', async () => {
    const child = createFakeChild()
    const terminateProcess = vi.fn(() => child.emit('close', null))
    const result = runSpotDl(spotifyUrl, {
      maxStdoutBytes: 4,
      resolveExecutable: () => 'C:\\isolated\\spotdl.exe',
      spawnProcess: vi.fn(() => child) as never,
      terminateProcess
    })
    child.stdout.write('12345')

    await expect(result).rejects.toThrow('too large')
    expect(terminateProcess).toHaveBeenCalledTimes(1)
  })

  it('uses platform-specific process-tree termination', () => {
    const unixChild = createFakeChild()
    const killGroup = vi.spyOn(process, 'kill').mockReturnValue(true)
    terminateSpotDlProcess(unixChild as never, { platform: 'linux' })
    expect(killGroup).toHaveBeenCalledWith(-123, 'SIGKILL')
    killGroup.mockRestore()

    const windowsChild = createFakeChild()
    const killer = new EventEmitter() as EventEmitter & {
      unref: ReturnType<typeof vi.fn>
    }
    killer.unref = vi.fn()
    const spawnProcess = vi.fn(() => killer)
    terminateSpotDlProcess(windowsChild as never, {
      platform: 'win32',
      spawnProcess: spawnProcess as never
    })
    expect(spawnProcess).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', '123', '/t', '/f'],
      expect.objectContaining({ windowsHide: true })
    )
  })

  it('limits active spotDL processes and rejects queue saturation', async () => {
    let running = 0
    let maxRunning = 0
    const spawnProcess = vi.fn(() => {
      const child = createFakeChild()
      running += 1
      maxRunning = Math.max(maxRunning, running)
      setTimeout(() => {
        running -= 1
        child.stdout.end(validPayload)
        child.emit('close', 0)
      }, 2)
      return child
    })
    const calls = Array.from({ length: 23 }, () =>
      runSpotDl(spotifyUrl, {
        resolveExecutable: () => 'C:\\isolated\\spotdl.exe',
        spawnProcess: spawnProcess as never
      })
    )
    const results = await Promise.allSettled(calls)
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )

    expect(maxRunning).toBe(2)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toMatchObject({
      category: 'busy',
      code: 'busy'
    })
  })

  it('hands a released permit to the oldest waiter before a simultaneous newcomer', async () => {
    const spawned: Array<{
      child: ReturnType<typeof createFakeChild>
      url: string
    }> = []
    let running = 0
    let maxRunning = 0
    const spawnProcess = vi.fn((_command: string, args: readonly string[]) => {
      const child = createFakeChild()
      running += 1
      maxRunning = Math.max(maxRunning, running)
      child.once('close', () => {
        running -= 1
      })
      spawned.push({ child, url: args[1] ?? '' })
      return child
    })
    const start = (label: string): Promise<string> =>
      runSpotDl(`${spotifyUrl}?case=${label}`, {
        resolveExecutable: () => 'C:\\isolated\\spotdl.exe',
        spawnProcess: spawnProcess as never
      })
    const complete = (index: number): void => {
      const entry = spawned[index]
      if (!entry) {
        throw new Error(`Missing spawned process at index ${index}.`)
      }
      entry.child.stdout.end('ok')
      entry.child.emit('close', 0)
    }
    const flushTasks = async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        setImmediate(resolve)
      })
    }

    const first = start('first')
    const second = start('second')
    const waiter = start('waiter')
    await flushTasks()
    expect(spawned.map(({ url }) => url)).toEqual([
      `${spotifyUrl}?case=first`,
      `${spotifyUrl}?case=second`
    ])

    complete(0)
    let newcomer: Promise<string> | undefined
    queueMicrotask(() => {
      newcomer = start('newcomer')
    })
    await first
    await flushTasks()
    expect(spawned.map(({ url }) => url)).toEqual([
      `${spotifyUrl}?case=first`,
      `${spotifyUrl}?case=second`,
      `${spotifyUrl}?case=waiter`
    ])
    expect(maxRunning).toBeLessThanOrEqual(2)

    complete(1)
    await second
    await flushTasks()
    expect(spawned[3]?.url).toBe(`${spotifyUrl}?case=newcomer`)
    expect(maxRunning).toBeLessThanOrEqual(2)

    complete(2)
    complete(3)
    if (!newcomer) {
      throw new Error('Newcomer was not started.')
    }
    await Promise.all([waiter, newcomer])
  })

  it('parses one safe track and rejects unavailable tracks', () => {
    expect(parseSpotDlOutput(validPayload, spotifyUrl)).toMatchObject({
      originalUrl: spotifyUrl,
      resolvedUrl,
      title: 'Billie Jean',
      artist: 'Michael Jackson',
      sourceProvider: 'spotify'
    })
    expect(() => parseSpotDlOutput('[]', spotifyUrl)).toThrow(
      'Spotify track is unavailable or link is invalid.'
    )
    expect(() => parseSpotDlOutput('[null]', spotifyUrl)).toThrow(
      expect.objectContaining({ code: 'unavailable' })
    )
  })

  it('rejects metadata for a different Spotify track', () => {
    const mismatchedPayload = validPayload.replace(
      spotifyUrl,
      'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b'
    )
    expect(() => parseSpotDlOutput(mismatchedPayload, spotifyUrl)).toThrow(
      expect.objectContaining({ code: 'invalid-response' })
    )
  })

  it('reports the known removed track as unavailable instead of successful', async () => {
    await expect(
      resolveSpotifyTrack(unavailableSpotifyUrl, {
        policyMode: 'basic',
        runSpotDl: vi.fn(async () => '[]')
      })
    ).rejects.toThrow('Spotify track is unavailable or link is invalid.')
  })

  it('rejects a private resolved source with a safe error', async () => {
    const privatePayload = validPayload.replace(resolvedUrl, 'http://127.0.0.1/media')
    await expect(
      resolveSpotifyTrack(spotifyUrl, {
        assertRemoteUrl: vi.fn(async () => {
          throw new Error('private')
        }),
        policyMode: 'public',
        runSpotDl: vi.fn(async () => privatePayload)
      })
    ).rejects.toThrow('unsafe media source')
  })

  it('deduplicates concurrent resolutions and caches successful results', async () => {
    const runSpotDlMock = vi.fn(async () => validPayload)
    const options = {
      assertRemoteUrl: vi.fn(async (url: string | URL) => new URL(url)),
      policyMode: 'basic' as const,
      runSpotDl: runSpotDlMock
    }
    const [first, second] = await Promise.all([
      resolveSpotifyTrack(`${spotifyUrl}?si=one`, options),
      resolveSpotifyTrack(`${spotifyUrl}?si=two`, options)
    ])
    const third = await resolveSpotifyTrack(spotifyUrl, options)

    expect(first).toEqual(second)
    expect(third).toEqual(first)
    expect(runSpotDlMock).toHaveBeenCalledTimes(1)
  })

  it('merges Spotify metadata while fetching formats from the resolved URL', async () => {
    const spotify: SpotifyResolvedTrack = {
      originalUrl: spotifyUrl,
      resolvedUrl,
      title: 'Billie Jean',
      name: 'Billie Jean',
      artist: 'Michael Jackson',
      thumbnail: 'https://i.scdn.co/image/cover',
      duration: 294,
      sourceProvider: 'spotify'
    }
    const youtubeVideo: VideoInfo = {
      formats: [],
      id: 'Zi_XLOBDo_Y',
      title: 'YouTube title',
      webpageUrl: resolvedUrl
    }
    const fetchVideo = vi.fn(async () => youtubeVideo)

    await expect(
      fetchVideoInfoFromSource(spotifyUrl, undefined, 'basic', {
        fetchVideo,
        resolveSpotify: vi.fn(async () => spotify)
      })
    ).resolves.toEqual({
      ...youtubeVideo,
      title: spotify.title,
      thumbnail: spotify.thumbnail,
      duration: spotify.duration,
      extractorKey: 'Spotify',
      webpageUrl: resolvedUrl,
      uploader: spotify.artist
    })
    expect(fetchVideo).toHaveBeenCalledWith(resolvedUrl, undefined)
  })

  it('rejects a provider match with a materially different duration', async () => {
    const spotify: SpotifyResolvedTrack = {
      originalUrl: spotifyUrl,
      resolvedUrl,
      title: 'Billie Jean',
      name: 'Billie Jean',
      artist: 'Michael Jackson',
      duration: 294,
      sourceProvider: 'spotify'
    }
    const fetchVideo = vi.fn(
      async (): Promise<VideoInfo> => ({
        duration: 400,
        formats: [],
        id: 'wrong',
        title: 'Wrong provider result'
      })
    )

    await expect(
      fetchVideoInfoFromSource(spotifyUrl, undefined, 'basic', {
        fetchVideo,
        resolveSpotify: vi.fn(async () => spotify)
      })
    ).rejects.toMatchObject({
      category: 'internal',
      code: 'match-mismatch'
    })
  })

  it('accepts provider duration within max(15 seconds, 10 percent)', async () => {
    const spotify: SpotifyResolvedTrack = {
      originalUrl: spotifyUrl,
      resolvedUrl,
      title: 'Billie Jean',
      name: 'Billie Jean',
      artist: 'Michael Jackson',
      duration: 294,
      sourceProvider: 'spotify'
    }

    await expect(
      fetchVideoInfoFromSource(spotifyUrl, undefined, 'basic', {
        fetchVideo: vi.fn(async () => ({
          duration: 320,
          formats: [],
          id: 'match',
          title: 'Provider result'
        })),
        resolveSpotify: vi.fn(async () => spotify)
      })
    ).resolves.toMatchObject({ duration: 294, title: 'Billie Jean' })
  })

  it('replaces a create input URL and metadata before queueing', async () => {
    const spotify: SpotifyResolvedTrack = {
      originalUrl: spotifyUrl,
      resolvedUrl,
      title: 'Billie Jean',
      name: 'Billie Jean',
      artist: 'Michael Jackson',
      thumbnail: 'https://i.scdn.co/image/cover',
      duration: 294,
      sourceProvider: 'spotify'
    }

    await expect(
      resolveDownloadSource(
        {
          url: spotifyUrl,
          title: 'Untrusted client title',
          thumbnail: 'https://example.com/client.jpg',
          duration: 1
        },
        'basic',
        vi.fn(async () => spotify)
      )
    ).resolves.toEqual({
      url: resolvedUrl,
      title: spotify.title,
      thumbnail: spotify.thumbnail,
      duration: spotify.duration,
      spotify
    })
  })

  it('never falls back to untrusted input metadata for a Spotify source', async () => {
    const spotify: SpotifyResolvedTrack = {
      originalUrl: spotifyUrl,
      resolvedUrl,
      title: 'Validated Spotify title',
      name: 'Validated Spotify title',
      artist: 'Validated artist',
      sourceProvider: 'spotify'
    }

    await expect(
      resolveDownloadSource(
        {
          url: spotifyUrl,
          title: 'Malicious title',
          thumbnail: 'http://127.0.0.1/malicious.jpg',
          duration: 999_999
        },
        'basic',
        vi.fn(async () => spotify)
      )
    ).resolves.toEqual({
      url: resolvedUrl,
      title: 'Validated Spotify title',
      thumbnail: undefined,
      duration: undefined,
      spotify
    })
  })

  it('preserves input metadata for a non-Spotify source', async () => {
    const input = {
      url: 'https://example.com/video',
      title: 'Original title',
      thumbnail: 'https://example.com/thumb.jpg',
      duration: 42
    }
    await expect(
      resolveDownloadSource(
        input,
        'basic',
        vi.fn(async () => null)
      )
    ).resolves.toEqual({
      ...input,
      spotify: null
    })
  })

  it('does not expose stderr or a Spotify token in process errors', async () => {
    const child = createFakeChild()
    const result = runSpotDl(`${spotifyUrl}?si=secret-token`, {
      resolveExecutable: () => 'C:\\isolated\\spotdl.exe',
      spawnProcess: vi.fn(() => child) as never
    })
    setTimeout(() => {
      child.stderr.write('secret-token full diagnostic')
      child.emit('close', 1)
    }, 0)

    const error = await result.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SpotifySourceError)
    expect((error as Error).message).not.toContain('secret-token')
  })
})
