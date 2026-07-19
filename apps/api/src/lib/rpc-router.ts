import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { implement, ORPCError } from '@orpc/server'
import type { DownloadRuntimeSettings, DownloadTask } from '@vidbee/downloader-core'
import { downloaderContract } from '@vidbee/downloader-core'
import type { Task, TaskStatus } from '@vidbee/task-queue'
import { resolveDirectDelivery } from './direct-delivery'
import { taskQueue, taskQueueExecutor } from './downloader'
import { projectTaskForApi } from './projection'
import { withPublicSessionMutationLock } from './public-session-mutation-lock'
import {
  type ApiContext,
  isPublicSiteEnabled,
  requirePublicSessionId,
  taskBelongsToPublicSession
} from './public-site'
import { assertRemoteHttpUrl } from './remote-url-policy'
import {
  enrichDownloadSourceMetadata,
  fetchVideoInfoFromSource,
  isSpotifyUrl,
  resolveDownloadSource,
  SpotifySourceError
} from './spotify-source'
import { webSettingsStore } from './web-settings-store'
import { fetchPlaylistInfo } from './yt-dlp-info'

const os = implement(downloaderContract).$context<ApiContext>()
const WEB_SETTINGS_FILES_DIR = path.resolve(process.cwd(), '.data', 'web-settings-files')
const MAX_WEB_SETTINGS_FILE_BYTES = 1_000_000
const MANAGED_SETTINGS_FILE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const SAFE_FILE_NAME_REGEX = /[^A-Za-z0-9._-]+/g
type ManagedSettingsFileKind = 'cookies' | 'config'
const PUBLIC_MAX_ACTIVE_TASKS = 3
const PUBLIC_MAX_PLAYLIST_ENTRIES = 10
const CANCEL_CONFIRMATION_TIMEOUT_MS = 12_000
const CANCEL_CONFIRMATION_POLL_MS = 100

const TERMINAL_TASK_STATUSES = new Set<TaskStatus>(['completed', 'failed', 'cancelled'])
const NON_TERMINAL_TASK_STATUSES = new Set<TaskStatus>([
  'queued',
  'running',
  'processing',
  'paused',
  'retry-scheduled'
])

const waitForTaskCancellation = async (taskId: string): Promise<boolean> => {
  const deadline = Date.now() + CANCEL_CONFIRMATION_TIMEOUT_MS
  while (Date.now() < deadline) {
    const task = taskQueue.get(taskId)
    if (!task || task.status === 'cancelled') {
      return true
    }
    if (task.status === 'completed' || task.status === 'failed') {
      return false
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, CANCEL_CONFIRMATION_POLL_MS)
    })
  }
  return taskQueue.get(taskId)?.status === 'cancelled'
}

const toErrorMessage = (error: unknown, fallbackMessage: string): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  return fallbackMessage
}

const runProcess = (command: string, args: string[]): Promise<boolean> =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'ignore',
      windowsHide: true
    })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

const isPathWithinBase = (basePath: string, targetPath: string): boolean => {
  const normalizedBase = path.resolve(basePath)
  const normalizedTarget = path.resolve(targetPath)
  const relativePath = path.relative(normalizedBase, normalizedTarget)
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

const openFileWithSystem = async (targetPath: string): Promise<boolean> => {
  if (process.platform === 'darwin') {
    return runProcess('open', [targetPath])
  }
  if (process.platform === 'win32') {
    return runProcess('cmd', ['/c', 'start', '', targetPath])
  }
  return runProcess('xdg-open', [targetPath])
}

const openFileLocationWithSystem = async (targetPath: string): Promise<boolean> => {
  if (process.platform === 'darwin') {
    return runProcess('open', ['-R', targetPath])
  }
  if (process.platform === 'win32') {
    return runProcess('explorer', [`/select,${targetPath}`])
  }
  return runProcess('xdg-open', [path.dirname(targetPath)])
}

const copyFileToClipboardWithSystem = async (targetPath: string): Promise<boolean> => {
  if (process.platform === 'darwin') {
    const escapedPath = targetPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return runProcess('osascript', ['-e', `set the clipboard to (POSIX file "${escapedPath}")`])
  }
  if (process.platform === 'win32') {
    const escapedPath = targetPath.replace(/'/g, "''")
    return runProcess('powershell', [
      '-NoProfile',
      '-Command',
      `Set-Clipboard -Path '${escapedPath}'`
    ])
  }
  return false
}

const listServerDirectories = async (
  rawPath: string | undefined
): Promise<{
  currentPath: string
  parentPath: string | null
  directories: { name: string; path: string }[]
}> => {
  const requestedPath = rawPath?.trim()
  const candidatePath = requestedPath && requestedPath.length > 0 ? requestedPath : process.cwd()
  const currentPath = path.resolve(candidatePath)

  const pathInfo = await stat(currentPath)
  if (!pathInfo.isDirectory()) {
    throw new Error('Path is not a directory.')
  }

  const entries = await readdir(currentPath, { withFileTypes: true })
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(currentPath, entry.name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const parsed = path.parse(currentPath)
  const parentPath = currentPath === parsed.root ? null : path.dirname(currentPath)

  return { currentPath, parentPath, directories }
}

const sanitizeUploadedFileName = (fileName: string, fallbackFileName: string): string => {
  const normalized = path
    .basename(fileName.trim())
    .replace(SAFE_FILE_NAME_REGEX, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (!normalized) {
    return fallbackFileName
  }
  return normalized.slice(0, 120)
}

const storeWebSettingsFile = async (
  kind: 'cookies' | 'config',
  fileName: string,
  content: string
): Promise<string> => {
  const contentBuffer = Buffer.from(content, 'utf-8')
  if (contentBuffer.byteLength > MAX_WEB_SETTINGS_FILE_BYTES) {
    throw new Error('Uploaded file is too large.')
  }

  const destinationDir = path.join(WEB_SETTINGS_FILES_DIR, kind)
  await mkdir(destinationDir, { recursive: true })

  const fallbackFileName = kind === 'cookies' ? 'cookies.txt' : 'config.txt'
  const safeFileName = sanitizeUploadedFileName(fileName, fallbackFileName)
  const storedFileName = `${Date.now()}-${randomUUID()}-${safeFileName}`
  const destinationPath = path.join(destinationDir, storedFileName)

  await writeFile(destinationPath, contentBuffer)
  return destinationPath
}

const resolveManagedSettingsFilePath = (
  rawPath: string,
  kind: ManagedSettingsFileKind
): string | null => {
  const trimmedPath = rawPath.trim()
  if (!trimmedPath) {
    return null
  }
  const resolvedPath = path.resolve(trimmedPath)
  const managedDirectory = path.join(WEB_SETTINGS_FILES_DIR, kind)
  if (!isPathWithinBase(managedDirectory, resolvedPath)) {
    return null
  }
  return resolvedPath
}

const pruneManagedSettingsFiles = async (
  kind: ManagedSettingsFileKind,
  referencedPaths: string[]
): Promise<void> => {
  const managedDirectory = path.join(WEB_SETTINGS_FILES_DIR, kind)
  const keepPaths = new Set<string>()
  for (const rawPath of referencedPaths) {
    const managedPath = resolveManagedSettingsFilePath(rawPath, kind)
    if (managedPath) {
      keepPaths.add(managedPath)
    }
  }
  let entries: { isFile: () => boolean; name: string }[] = []
  try {
    entries = await readdir(managedDirectory, { withFileTypes: true })
  } catch {
    return
  }
  const now = Date.now()
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }
    const candidatePath = path.resolve(path.join(managedDirectory, entry.name))
    if (keepPaths.has(candidatePath)) {
      continue
    }
    try {
      const candidateInfo = await stat(candidatePath)
      if (now - candidateInfo.mtimeMs < MANAGED_SETTINGS_FILE_RETENTION_MS) {
        continue
      }
      await rm(candidatePath, { force: true })
    } catch {
      // Ignore cleanup errors to keep upload and settings updates resilient.
    }
  }
}

const triggerManagedSettingsFilePrune = (
  kind: ManagedSettingsFileKind,
  newlyUploadedPath: string
): void => {
  void (async () => {
    try {
      const settings = await webSettingsStore.get()
      const currentSettingsPath = kind === 'cookies' ? settings.cookiesPath : settings.configPath
      await pruneManagedSettingsFiles(kind, [newlyUploadedPath, currentSettingsPath])
    } catch {
      // Ignore cleanup errors to keep upload and settings updates resilient.
    }
  })()
}

const PLAYLIST_GROUP_PREFIX = 'playlist_group_'

const projectTask = (task: Readonly<Task>): DownloadTask => projectTaskForApi(task)

const listTasksByStatuses = (
  statuses: ReadonlySet<TaskStatus>,
  publicSessionId: string | null
): DownloadTask[] => {
  const tasks: Task[] = []
  let cursor: string | null = null
  do {
    const page = taskQueue.list({ limit: 200, cursor })
    for (const t of page.tasks) {
      if (statuses.has(t.status) && taskBelongsToPublicSession(t, publicSessionId)) {
        tasks.push(t)
      }
    }
    cursor = page.nextCursor
  } while (cursor)
  return tasks.sort((a, b) => b.createdAt - a.createdAt).map(projectTask)
}

const rejectPublicServerOperation = (): void => {
  if (!isPublicSiteEnabled) {
    return
  }
  throw new ORPCError('FORBIDDEN', {
    message: 'This server operation is disabled on the public site.'
  })
}

const sanitizeRuntimeSettings = (
  settings: DownloadRuntimeSettings | undefined
): DownloadRuntimeSettings | undefined => {
  if (!(isPublicSiteEnabled && settings)) {
    return settings
  }
  return {
    embedSubs: settings.embedSubs,
    embedThumbnail: settings.embedThumbnail,
    embedMetadata: settings.embedMetadata,
    embedChapters: settings.embedChapters
  }
}

const ensurePublicTaskCapacity = (
  publicSessionId: string | null,
  requestedTaskCount: number
): void => {
  if (!(isPublicSiteEnabled && publicSessionId)) {
    return
  }

  let activeTaskCount = 0
  let cursor: string | null = null
  do {
    const page = taskQueue.list({ limit: 200, cursor })
    for (const task of page.tasks) {
      if (
        NON_TERMINAL_TASK_STATUSES.has(task.status) &&
        taskBelongsToPublicSession(task, publicSessionId)
      ) {
        activeTaskCount += 1
      }
    }
    cursor = page.nextCursor
  } while (cursor)

  if (activeTaskCount + requestedTaskCount > PUBLIC_MAX_ACTIVE_TASKS) {
    throw new ORPCError('TOO_MANY_REQUESTS', {
      message: `Only ${PUBLIC_MAX_ACTIVE_TASKS} active downloads are allowed per session.`
    })
  }
}

const assertAllowedUserUrl = async (url: string): Promise<void> => {
  try {
    await assertRemoteHttpUrl(url, {
      mode: isPublicSiteEnabled ? 'public' : 'basic'
    })
  } catch {
    throw new ORPCError('BAD_REQUEST', {
      message: 'Only public HTTP(S) URLs are allowed.'
    })
  }
}

const spotifyPolicyMode = (): 'basic' | 'public' => (isPublicSiteEnabled ? 'public' : 'basic')

const throwSpotifyRpcError = (error: unknown): void => {
  if (!(error instanceof SpotifySourceError)) {
    return
  }
  if (error.category === 'user') {
    throw new ORPCError('BAD_REQUEST', { message: error.message })
  }
  if (error.category === 'busy') {
    throw new ORPCError('TOO_MANY_REQUESTS', {
      message: 'Spotify track matching service is busy. Try again shortly.'
    })
  }
  if (error.category === 'service') {
    throw new ORPCError('SERVICE_UNAVAILABLE', {
      message: 'Spotify track matching service is temporarily unavailable.'
    })
  }
  throw new ORPCError('INTERNAL_SERVER_ERROR', {
    message: 'Failed to safely match the Spotify track.'
  })
}

export const rpcRouter = os.router({
  status: os.status.handler(() => {
    const stats = taskQueue.stats()
    return {
      ok: true,
      version: '1.0.0',
      active: stats.running,
      pending: stats.queued
    }
  }),

  videoInfo: os.videoInfo.handler(async ({ context, input }) => {
    requirePublicSessionId(context)
    try {
      await assertAllowedUserUrl(input.url)
      const video = await fetchVideoInfoFromSource(
        input.url,
        sanitizeRuntimeSettings(input.settings),
        spotifyPolicyMode()
      )
      return { video }
    } catch (error) {
      if (error instanceof ORPCError) {
        throw error
      }
      throwSpotifyRpcError(error)
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: toErrorMessage(error, 'Failed to fetch video info.')
      })
    }
  }),

  playlist: {
    info: os.playlist.info.handler(async ({ context, input }) => {
      requirePublicSessionId(context)
      try {
        await assertAllowedUserUrl(input.url)
        if (isSpotifyUrl(input.url)) {
          throw new SpotifySourceError(
            'unsupported',
            'Spotify playlists and albums are not supported; use a Spotify track link.'
          )
        }
        const playlist = await fetchPlaylistInfo(input.url, sanitizeRuntimeSettings(input.settings))
        return { playlist }
      } catch (error) {
        if (error instanceof ORPCError) {
          throw error
        }
        throwSpotifyRpcError(error)
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to fetch playlist info.')
        })
      }
    }),
    download: os.playlist.download.handler(async ({ context, input }) => {
      const publicSessionId = requirePublicSessionId(context)
      try {
        await assertAllowedUserUrl(input.url)
        if (isSpotifyUrl(input.url)) {
          throw new SpotifySourceError(
            'unsupported',
            'Spotify playlists and albums are not supported; use a Spotify track link.'
          )
        }
        const playlist = await fetchPlaylistInfo(input.url, sanitizeRuntimeSettings(input.settings))
        const groupId = `${PLAYLIST_GROUP_PREFIX}${Date.now()}_${randomUUID().slice(0, 8)}`

        if (playlist.entryCount === 0) {
          return {
            result: {
              groupId,
              playlistId: playlist.id,
              playlistTitle: playlist.title,
              type: input.type,
              totalCount: 0,
              startIndex: 0,
              endIndex: 0,
              entries: []
            }
          }
        }

        let selected = playlist.entries
        if (input.entryIds && input.entryIds.length > 0) {
          const ids = new Set(input.entryIds)
          selected = playlist.entries.filter((e) => ids.has(e.id))
        } else {
          const requestedStart = Math.max((input.startIndex ?? 1) - 1, 0)
          const requestedEnd = input.endIndex
            ? Math.min(input.endIndex - 1, playlist.entryCount - 1)
            : playlist.entryCount - 1
          const rangeStart = Math.min(requestedStart, requestedEnd)
          const rangeEnd = Math.max(requestedStart, requestedEnd)
          selected = playlist.entries.slice(rangeStart, rangeEnd + 1)
        }
        if (isPublicSiteEnabled && selected.length > PUBLIC_MAX_PLAYLIST_ENTRIES) {
          throw new ORPCError('BAD_REQUEST', {
            message: `Public playlist downloads are limited to ${PUBLIC_MAX_PLAYLIST_ENTRIES} entries.`
          })
        }
        for (const entry of selected) {
          await assertAllowedUserUrl(entry.url)
        }

        const created = await withPublicSessionMutationLock(publicSessionId, async () => {
          ensurePublicTaskCapacity(publicSessionId, selected.length)
          const entries: Array<{
            downloadId: string
            entryId: string
            title: string
            url: string
            index: number
          }> = []

          for (const entry of selected) {
            const result = await taskQueue.add({
              input: {
                url: entry.url,
                kind:
                  input.type === 'audio'
                    ? 'audio'
                    : input.type === 'text'
                      ? 'text'
                      : 'video',
                title: entry.title,
                thumbnail: entry.thumbnail,
                playlistId: groupId,
                playlistIndex: entry.index,
                options: {
                  type: input.type,
                  format: input.format,
                  audioFormat: input.audioFormat,
                  audioFormatIds: input.audioFormatIds,
                  customDownloadPath: isPublicSiteEnabled ? undefined : input.customDownloadPath,
                  customFilenameTemplate: isPublicSiteEnabled
                    ? undefined
                    : input.customFilenameTemplate,
                  containerFormat: input.containerFormat,
                  settings: sanitizeRuntimeSettings(input.settings),
                  title: entry.title,
                  thumbnail: entry.thumbnail,
                  playlistTitle: playlist.title,
                  playlistSize: selected.length,
                  publicSessionId
                }
              },
              groupKey: `playlist:${groupId}`
            })
            entries.push({
              downloadId: result.id,
              entryId: entry.id,
              title: entry.title,
              url: entry.url,
              index: entry.index
            })
          }
          return entries
        })

        return {
          result: {
            groupId,
            playlistId: playlist.id,
            playlistTitle: playlist.title,
            type: input.type,
            totalCount: selected.length,
            startIndex: selected[0]?.index ?? 0,
            endIndex: selected.at(-1)?.index ?? 0,
            entries: created
          }
        }
      } catch (error) {
        if (error instanceof ORPCError) {
          throw error
        }
        throwSpotifyRpcError(error)
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to start playlist download.')
        })
      }
    })
  },

  downloads: {
    resolveDelivery: os.downloads.resolveDelivery.handler(async ({ context, input }) => {
      requirePublicSessionId(context)
      if (isSpotifyUrl(input.url)) {
        return { mode: 'server' as const, reason: 'processing-required' as const }
      }
      try {
        await assertAllowedUserUrl(input.url)
      } catch {
        return { mode: 'server' as const, reason: 'unsafe-source' as const }
      }
      if (!isPublicSiteEnabled) {
        return { mode: 'server' as const, reason: 'processing-required' as const }
      }
      return resolveDirectDelivery(input)
    }),
    create: os.downloads.create.handler(async ({ context, input }) => {
      const publicSessionId = requirePublicSessionId(context)
      try {
        await assertAllowedUserUrl(input.url)
        ensurePublicTaskCapacity(publicSessionId, 1)
        const source = await enrichDownloadSourceMetadata(
          await resolveDownloadSource(input, spotifyPolicyMode()),
          sanitizeRuntimeSettings(input.settings),
          spotifyPolicyMode()
        )
        return await withPublicSessionMutationLock(publicSessionId, async () => {
          ensurePublicTaskCapacity(publicSessionId, 1)
          const result = await taskQueue.add({
            input: {
              url: source.url,
              kind:
                input.type === 'audio'
                  ? 'audio'
                  : input.type === 'text'
                    ? 'text'
                    : 'video',
              title: source.title,
              thumbnail: source.thumbnail,
              playlistId: input.playlistId,
              playlistIndex: input.playlistIndex,
              options: {
                type: input.type,
                format: input.format,
                audioFormat: input.audioFormat,
                audioFormatIds: input.audioFormatIds,
                startTime: input.startTime,
                endTime: input.endTime,
                customDownloadPath: isPublicSiteEnabled ? undefined : input.customDownloadPath,
                customFilenameTemplate: isPublicSiteEnabled
                  ? undefined
                  : input.customFilenameTemplate,
                containerFormat: input.containerFormat,
                settings: sanitizeRuntimeSettings(input.settings),
                title: source.title,
                thumbnail: source.thumbnail,
                description: input.description,
                channel: input.channel,
                uploader: input.uploader,
                viewCount: input.viewCount,
                tags: input.tags ? [...input.tags] : undefined,
                duration: source.duration,
                playlistTitle: input.playlistTitle,
                playlistSize: input.playlistSize,
                publicSessionId
              }
            }
          })
          const created = taskQueue.get(result.id)
          if (!created) {
            throw new Error('Failed to read back created task.')
          }
          return { download: projectTask(created) }
        })
      } catch (error) {
        if (error instanceof ORPCError) {
          throw error
        }
        throwSpotifyRpcError(error)
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to create download.')
        })
      }
    }),
    list: os.downloads.list.handler(({ context }) => {
      const publicSessionId = requirePublicSessionId(context)
      return { downloads: listTasksByStatuses(NON_TERMINAL_TASK_STATUSES, publicSessionId) }
    }),
    cancel: os.downloads.cancel.handler(async ({ context, input }) => {
      const publicSessionId = requirePublicSessionId(context)
      try {
        const task = taskQueue.get(input.id)
        if (!(task && taskBelongsToPublicSession(task, publicSessionId))) {
          return { cancelled: false }
        }
        await taskQueue.cancel(input.id)
        return { cancelled: await waitForTaskCancellation(input.id) }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to cancel download.')
        })
      }
    })
  },

  history: {
    list: os.history.list.handler(({ context }) => {
      const publicSessionId = requirePublicSessionId(context)
      return { history: listTasksByStatuses(TERMINAL_TASK_STATUSES, publicSessionId) }
    }),
    removeItems: os.history.removeItems.handler(async ({ context, input }) => {
      const publicSessionId = requirePublicSessionId(context)
      let removed = 0
      for (const rawId of input.ids) {
        const id = rawId.trim()
        if (!id) {
          continue
        }
        const task = taskQueue.get(id)
        if (!(task && taskBelongsToPublicSession(task, publicSessionId))) {
          continue
        }
        try {
          await taskQueue.removeFromHistory(id)
          removed += 1
        } catch {
          // Non-terminal tasks throw; skip them quietly to match legacy behavior.
        }
      }
      return { removed }
    }),
    removeByPlaylist: os.history.removeByPlaylist.handler(async ({ context, input }) => {
      const publicSessionId = requirePublicSessionId(context)
      const playlistId = input.playlistId.trim()
      if (!playlistId) {
        return { removed: 0 }
      }
      let removed = 0
      let cursor: string | null = null
      do {
        const page = taskQueue.list({ limit: 200, cursor })
        for (const t of page.tasks) {
          if (
            t.input.playlistId === playlistId &&
            TERMINAL_TASK_STATUSES.has(t.status) &&
            taskBelongsToPublicSession(t, publicSessionId)
          ) {
            try {
              await taskQueue.removeFromHistory(t.id)
              removed += 1
            } catch {
              /* skip */
            }
          }
        }
        cursor = page.nextCursor
      } while (cursor)
      return { removed }
    })
  },

  files: {
    exists: os.files.exists.handler(async ({ input }) => {
      rejectPublicServerOperation()
      try {
        const resolvedPath = path.resolve(input.path)
        return { exists: await pathExists(resolvedPath) }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to check file existence.')
        })
      }
    }),
    listDirectories: os.files.listDirectories.handler(async ({ input }) => {
      rejectPublicServerOperation()
      try {
        return await listServerDirectories(input.path)
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to list server directories.')
        })
      }
    }),
    openFile: os.files.openFile.handler(async ({ input }) => {
      rejectPublicServerOperation()
      try {
        const resolvedPath = path.resolve(input.path)
        const exists = await pathExists(resolvedPath)
        if (!exists) {
          return { success: false }
        }
        return { success: await openFileWithSystem(resolvedPath) }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to open file.')
        })
      }
    }),
    openFileLocation: os.files.openFileLocation.handler(async ({ input }) => {
      rejectPublicServerOperation()
      try {
        const resolvedPath = path.resolve(input.path)
        const exists = await pathExists(resolvedPath)
        if (!exists) {
          return { success: false }
        }
        return { success: await openFileLocationWithSystem(resolvedPath) }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to open file location.')
        })
      }
    }),
    copyFileToClipboard: os.files.copyFileToClipboard.handler(async ({ input }) => {
      rejectPublicServerOperation()
      try {
        const resolvedPath = path.resolve(input.path)
        const exists = await pathExists(resolvedPath)
        if (!exists) {
          return { success: false }
        }
        return { success: await copyFileToClipboardWithSystem(resolvedPath) }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to copy file to clipboard.')
        })
      }
    }),
    deleteFile: os.files.deleteFile.handler(async ({ input }) => {
      rejectPublicServerOperation()
      try {
        const settings = await webSettingsStore.get()
        const managedDownloadPath = settings.downloadPath.trim()
        if (!managedDownloadPath) {
          throw new ORPCError('FORBIDDEN', {
            message: 'Deleting files is disabled until a download path is configured.'
          })
        }
        const resolvedPath = path.resolve(input.path)
        if (!isPathWithinBase(managedDownloadPath, resolvedPath)) {
          throw new ORPCError('FORBIDDEN', {
            message: 'Refusing to delete files outside the managed download directory.'
          })
        }
        const exists = await pathExists(resolvedPath)
        if (!exists) {
          return { success: false }
        }
        await rm(resolvedPath)
        return { success: true }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to delete file.')
        })
      }
    }),
    uploadSettingsFile: os.files.uploadSettingsFile.handler(async ({ input }) => {
      rejectPublicServerOperation()
      try {
        const storedPath = await storeWebSettingsFile(input.kind, input.fileName, input.content)
        triggerManagedSettingsFilePrune(input.kind, storedPath)
        return { path: storedPath }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to upload settings file.')
        })
      }
    })
  },

  settings: {
    get: os.settings.get.handler(async () => {
      rejectPublicServerOperation()
      try {
        const settings = await webSettingsStore.get()
        return { settings }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to read settings.')
        })
      }
    }),
    set: os.settings.set.handler(async ({ input }) => {
      rejectPublicServerOperation()
      try {
        const settings = await webSettingsStore.set(input.settings)
        return { settings }
      } catch (error) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: toErrorMessage(error, 'Failed to save settings.')
        })
      }
    })
  }
})

// `taskQueueExecutor` is intentionally re-exported from this module so the
// integration test (packages/task-queue/__integration__/three-host-equivalence)
// can introspect host wiring without reaching into apps/api directly.
export { taskQueueExecutor }
