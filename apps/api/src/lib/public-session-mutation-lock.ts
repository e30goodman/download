const publicSessionMutationTails = new Map<string, Promise<void>>()

export const withPublicSessionMutationLock = async <T>(
  publicSessionId: string | null,
  operation: () => Promise<T>
): Promise<T> => {
  if (!publicSessionId) {
    return await operation()
  }

  const previous = publicSessionMutationTails.get(publicSessionId) ?? Promise.resolve()
  let releaseCurrent = (): void => undefined
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })
  const tail = previous.then(() => current)
  publicSessionMutationTails.set(publicSessionId, tail)

  await previous
  try {
    return await operation()
  } finally {
    releaseCurrent()
    if (publicSessionMutationTails.get(publicSessionId) === tail) {
      publicSessionMutationTails.delete(publicSessionId)
    }
  }
}
