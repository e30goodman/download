import { describe, expect, it } from 'vitest'
import {
  getRequestPath,
  isBackgroundRequestPath,
  isLoopbackOrPrivateIp,
  isNewVisitor,
  shouldTrackRequest
} from '../src/lib/monitoring'

describe('monitoring request classification', () => {
  it('normalizes request paths', () => {
    expect(getRequestPath('/rpc/downloads/list?session=abc')).toBe('/rpc/downloads/list')
    expect(getRequestPath('health')).toBe('/health')
  })

  it('treats polling and monitoring paths as background traffic', () => {
    expect(isBackgroundRequestPath('/health', null)).toBe(true)
    expect(isBackgroundRequestPath('/events', null)).toBe(true)
    expect(isBackgroundRequestPath('/images/proxy', null)).toBe(true)
    expect(isBackgroundRequestPath('/rpc/downloads/list', null)).toBe(true)
    expect(isBackgroundRequestPath('/rpc/history/list', null)).toBe(true)
    expect(isBackgroundRequestPath('/rpc/settings/get', null)).toBe(true)
    expect(isBackgroundRequestPath('/rpc/files/exists', null)).toBe(true)
    expect(isBackgroundRequestPath('/rpc/status', null)).toBe(true)
  })

  it('treats user actions as foreground traffic', () => {
    expect(isBackgroundRequestPath('/rpc/downloads/create', null)).toBe(false)
    expect(isBackgroundRequestPath('/rpc/downloads/cancel', null)).toBe(false)
    expect(isBackgroundRequestPath('/downloads/task-id/file', null)).toBe(false)
  })

  it('ignores monitor clients entirely', () => {
    expect(isBackgroundRequestPath('/rpc/downloads/create', 'monitor')).toBe(true)
    expect(isBackgroundRequestPath('/downloads/task-id/file', 'internal')).toBe(true)
  })
})

describe('monitoring visitor classification', () => {
  it('marks first-time visitors as new within the window', () => {
    const now = Date.now()
    expect(isNewVisitor(now - 60_000, now)).toBe(true)
    expect(isNewVisitor(now - 23 * 60 * 60 * 1000, now)).toBe(true)
    expect(isNewVisitor(now - 25 * 60 * 60 * 1000, now)).toBe(false)
  })
})

describe('monitoring visitor tracking rules', () => {
  it('detects local and private addresses', () => {
    expect(isLoopbackOrPrivateIp('127.0.0.1')).toBe(true)
    expect(isLoopbackOrPrivateIp('192.168.1.5')).toBe(true)
    expect(isLoopbackOrPrivateIp('10.0.0.2')).toBe(true)
    expect(isLoopbackOrPrivateIp('8.8.8.8')).toBe(false)
  })

  it('tracks only public tunnel traffic', () => {
    expect(
      shouldTrackRequest('/rpc/downloads/create', null, '1.2.3.4', '1.2.3.4', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
    ).toBe(true)
    expect(shouldTrackRequest('/rpc/downloads/create', null, '127.0.0.1', null, null)).toBe(false)
    expect(shouldTrackRequest('/rpc/downloads/list', null, '1.2.3.4', '1.2.3.4', null)).toBe(false)
    expect(shouldTrackRequest('/rpc/downloads/create', 'monitor', '1.2.3.4', '1.2.3.4', null)).toBe(false)
    expect(shouldTrackRequest('/rpc/downloads/create', null, '192.168.0.4', '192.168.0.4', null)).toBe(false)
  })
})
