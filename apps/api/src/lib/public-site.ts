import { ORPCError } from '@orpc/server'
import type { Task } from '@vidbee/task-queue'

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface ApiContext {
  publicSessionId: string | null
}

export const isPublicSiteEnabled = process.env.VIDBEE_PUBLIC_SITE === 'true'

/** Public download site brand tag used in saved filenames. */
export const PUBLIC_SITE_FILENAME_BRAND = 'e30goodman'

/**
 * yt-dlp / text output template:
 * `Video by {author} via e30goodman.mp4` (also Audio / Text).
 */
export const buildPublicSiteFilenameTemplate = (type: 'video' | 'audio' | 'text'): string => {
  const kind = type === 'audio' ? 'Audio' : type === 'text' ? 'Text' : 'Video'
  return `${kind} by %(uploader,channel,uploader_id,creator,title)s via ${PUBLIC_SITE_FILENAME_BRAND}.%(ext)s`
}

export const parsePublicSessionId = (value: unknown): string | null => {
  const sessionId = Array.isArray(value) ? value[0] : value
  if (typeof sessionId !== 'string') {
    return null
  }
  const normalizedSessionId = sessionId.trim()
  return SESSION_ID_PATTERN.test(normalizedSessionId) ? normalizedSessionId : null
}

export const requirePublicSessionId = (context: ApiContext): string | null => {
  if (!isPublicSiteEnabled) {
    return null
  }
  if (context.publicSessionId) {
    return context.publicSessionId
  }

  throw new ORPCError('UNAUTHORIZED', {
    message: 'A valid public session is required.'
  })
}

export const taskBelongsToPublicSession = (
  task: Readonly<Task>,
  publicSessionId: string | null
): boolean => {
  if (!isPublicSiteEnabled) {
    return true
  }
  return task.input.options?.publicSessionId === publicSessionId
}

export const getTaskPublicSessionId = (task: Readonly<Task>): string | null => {
  const sessionId = task.input.options?.publicSessionId
  return typeof sessionId === 'string' ? sessionId : null
}
