import { describe, expect, it } from 'vitest'
import { assertRemoteHttpUrl, isPublicIpAddress } from '../src/lib/remote-url-policy'

describe('remote URL IP policy', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '198.51.100.1',
    '224.0.0.1',
    '::',
    '::1',
    '::10.0.0.1',
    '::127.0.0.1',
    '::169.254.169.254',
    '::ffff:127.0.0.1',
    '::ffff:0:127.0.0.1',
    'fc00::1',
    'fec0::1',
    'fe80::1',
    '2001:db8::1',
    '2620:4f:8000::1',
    'ff02::1'
  ])('rejects special-use address %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(false)
  })

  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])(
    'accepts public address %s',
    (address) => {
      expect(isPublicIpAddress(address)).toBe(true)
    }
  )

  it.each([
    'http://127.0.0.1/video',
    'http://[::127.0.0.1]/video',
    'http://[::ffff:0:127.0.0.1]/video',
    'https://user:password@1.1.1.1/video',
    'file:///tmp/video'
  ])('rejects unsafe URL %s', async (url) => {
    await expect(assertRemoteHttpUrl(url, { mode: 'public' })).rejects.toThrow(
      'Remote URL is not allowed.'
    )
  })

  it('accepts a public numeric HTTP URL', async () => {
    await expect(
      assertRemoteHttpUrl('https://1.1.1.1/video', { mode: 'public' })
    ).resolves.toBeInstanceOf(URL)
  })

  it.each([
    'http://127.0.0.1/video',
    'http://localhost/video',
    'https://192.168.1.50/media',
    'http://[::1]/video'
  ])('permits private HTTP sources in basic mode: %s', async (url) => {
    await expect(assertRemoteHttpUrl(url, { mode: 'basic' })).resolves.toBeInstanceOf(URL)
  })

  it.each(['file:///tmp/video', 'ftp://192.168.1.50/video', 'http://user:pass@localhost/video'])(
    'rejects unsafe syntax in basic mode: %s',
    async (url) => {
      await expect(assertRemoteHttpUrl(url, { mode: 'basic' })).rejects.toThrow(
        'Remote URL is not allowed.'
      )
    }
  )

  it('rejects private HTTP sources in public mode', async () => {
    await expect(
      assertRemoteHttpUrl('http://192.168.1.50/video', { mode: 'public' })
    ).rejects.toThrow('Remote URL is not allowed.')
  })
})
