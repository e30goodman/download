import { describe, expect, it } from 'vitest'

import {
  CLASSIFIER_RULES,
  classify,
  defaultMaxAttempts,
  parseRetryAfter,
  sanitizeOutput,
  takeStderrTail,
  virtualError
} from '../src/classifier'

describe('ErrorClassifier rules (design §7.1)', () => {
  it('rule order matches the design doc', () => {
    const order = CLASSIFIER_RULES.map((r) => r.category)
    expect(order).toEqual([
      'http-429',
      'auth-required',
      'geo-blocked',
      'not-found',
      'disk-full',
      'permission-denied',
      'binary-missing',
      'ffmpeg',
      'network-transient',
      'stalled',
      'cancelled-by-user',
      'output-missing',
      'unknown'
    ])
  })

  it.each([
    ['HTTP Error 429: Too Many Requests', 'http-429'],
    ['ERROR: Sign in to confirm your age', 'auth-required'],
    ['This video is not available in your country', 'geo-blocked'],
    ['HTTP Error 404: not found', 'not-found'],
    ['ENOSPC: no space left on device', 'disk-full'],
    ['EACCES: permission denied', 'permission-denied'],
    [
      'ERROR: [WinError 32] The process cannot access the file because it is being used by another process',
      'permission-denied'
    ],
    ['ffmpeg: not found', 'binary-missing'],
    ['Postprocessing: ffmpeg failed', 'ffmpeg'],
    ['ECONNRESET on socket', 'network-transient'],
    ['HTTP Error 503 Service Unavailable', 'network-transient'],
    ['nothing in particular', 'unknown']
  ])('classifies stderr %p as %s', (stderr, category) => {
    const r = classify({ stderr })
    expect(r.category).toBe(category)
  })

  it('binary-missing also fires on exit code 127', () => {
    const r = classify({ stderr: 'random message', exitCode: 127 })
    expect(r.category).toBe('binary-missing')
  })

  it('http-429 honors Retry-After from the explicit header', () => {
    const r = classify({
      stderr: 'HTTP Error 429: too many',
      retryAfterHeader: '15'
    })
    expect(r.suggestedRetryAfterMs).toBe(15_000)
  })

  it('http-429 falls back to Retry-After parsed from stderr', () => {
    const stderr = 'HTTP Error 429: too many\nRetry-After: 7\n'
    const r = classify({ stderr })
    expect(r.suggestedRetryAfterMs).toBe(7_000)
  })

  it('http-429 default backoff is 30s when no Retry-After present', () => {
    const r = classify({ stderr: 'HTTP Error 429' })
    expect(r.suggestedRetryAfterMs).toBe(30_000)
  })

  it('non-retryable categories carry retryable=false', () => {
    for (const cat of [
      'auth-required',
      'geo-blocked',
      'not-found',
      'disk-full',
      'permission-denied',
      'binary-missing'
    ] as const) {
      expect(defaultMaxAttempts(cat)).toBe(0)
      const v = virtualError(cat, 'x')
      expect(v.retryable).toBe(false)
    }
  })

  it('retryable categories carry retryable=true and reasonable maxAttempts', () => {
    expect(defaultMaxAttempts('http-429')).toBe(3)
    expect(defaultMaxAttempts('network-transient')).toBe(5)
    expect(defaultMaxAttempts('stalled')).toBe(3)
    expect(defaultMaxAttempts('ffmpeg')).toBe(1)
    expect(defaultMaxAttempts('unknown')).toBe(1)
  })
})

describe('sanitizeOutput', () => {
  it('redacts Authorization headers but keeps the key name', () => {
    const out = sanitizeOutput('Authorization: Bearer abc.def')
    expect(out).toBe('Authorization: <redacted>')
  })

  it('redacts cookie/token query-string values', () => {
    expect(sanitizeOutput('?token=abc.def&foo=1')).toMatch(/<redacted>/)
    expect(sanitizeOutput('password=hunter2')).toMatch(/<redacted>/)
  })
})

describe('takeStderrTail', () => {
  it('returns the input unchanged if under the budget', () => {
    expect(takeStderrTail('hello', 10)).toBe('hello')
  })

  it('keeps trailing portion when too large', () => {
    const big = 'x'.repeat(20_000)
    const tail = takeStderrTail(big, 4_096)
    expect(tail.length).toBeLessThanOrEqual(big.length)
    expect(Buffer.byteLength(tail, 'utf8')).toBeLessThanOrEqual(4_096)
  })
})

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfter('120')).toBe(120_000)
    expect(parseRetryAfter('0')).toBe(0)
  })

  it('parses HTTP-date', () => {
    const future = new Date(Date.now() + 5_000).toUTCString()
    const ms = parseRetryAfter(future)
    expect(ms).not.toBeNull()
    expect(ms!).toBeGreaterThan(0)
  })

  it('returns null for nonsense', () => {
    expect(parseRetryAfter('')).toBeNull()
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter('not-a-date')).toBeNull()
  })
})
