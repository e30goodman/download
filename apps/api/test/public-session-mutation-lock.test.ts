import { describe, expect, it } from 'vitest'
import { withPublicSessionMutationLock } from '../src/lib/public-session-mutation-lock'

const createSignal = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve = (): void => undefined
  const promise = new Promise<void>((signal) => {
    resolve = signal
  })
  return { promise, resolve }
}

describe('public session mutation lock', () => {
  it('serializes mutations for the same public session', async () => {
    const firstStarted = createSignal()
    const releaseFirst = createSignal()
    const events: string[] = []

    const first = withPublicSessionMutationLock('session-a', async () => {
      events.push('first-start')
      firstStarted.resolve()
      await releaseFirst.promise
      events.push('first-end')
    })
    await firstStarted.promise

    const second = withPublicSessionMutationLock('session-a', async () => {
      events.push('second')
    })
    await Promise.resolve()
    expect(events).toEqual(['first-start'])

    releaseFirst.resolve()
    await Promise.all([first, second])
    expect(events).toEqual(['first-start', 'first-end', 'second'])
  })

  it('does not serialize independent sessions', async () => {
    const releaseFirst = createSignal()
    const secondStarted = createSignal()

    const first = withPublicSessionMutationLock('session-a', async () => {
      await releaseFirst.promise
    })
    const second = withPublicSessionMutationLock('session-b', async () => {
      secondStarted.resolve()
    })

    await secondStarted.promise
    releaseFirst.resolve()
    await Promise.all([first, second])
  })

  it('releases the session after a failed mutation', async () => {
    await expect(
      withPublicSessionMutationLock('session-failure', async () => {
        throw new Error('expected failure')
      })
    ).rejects.toThrow('expected failure')

    await expect(
      withPublicSessionMutationLock('session-failure', async () => 'next mutation')
    ).resolves.toBe('next mutation')
  })
})
