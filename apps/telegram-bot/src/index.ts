import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import type { DownloadTask, downloaderContract } from '@vidbee/downloader-core'
import { Input, Telegraf } from 'telegraf'

type Role = 'user' | 'admin'

interface TrackedTask {
  id: string
  chatId: number
  requestedBy: number
  requestedType: 'video' | 'audio' | 'text'
  createdAt: number
  delivered: boolean
}

interface BotState {
  trackedTasks: Record<string, TrackedTask>
}

const execFileAsync = promisify(execFile)
const EMPTY_STATE: BotState = { trackedTasks: {} }
const POLL_INTERVAL_MS = Number(process.env.TELEGRAM_POLL_INTERVAL_MS ?? 3000)
const WATCHDOG_INTERVAL_MS = Number(process.env.TELEGRAM_WATCHDOG_INTERVAL_MS ?? 30_000)
const WATCHDOG_FAIL_THRESHOLD = Number(process.env.TELEGRAM_WATCHDOG_FAIL_THRESHOLD ?? 3)
const TELEGRAM_MAX_UPLOAD_BYTES = Number(process.env.TELEGRAM_MAX_UPLOAD_BYTES ?? 49_000_000)
const WATCHDOG_ALERT_THROTTLE_MS = Number(
  process.env.TELEGRAM_WATCHDOG_ALERT_THROTTLE_MS ?? 300_000
)
const ENABLE_AUTO_RESTART = process.env.TELEGRAM_AUTO_RESTART_ON_FAILURE === 'true'
const allowedServices = new Set(['vidbee-api', 'vidbee-web', 'cloudflared-vidbee'])

const stateFilePath = path.resolve(
  process.env.TELEGRAM_STATE_FILE ?? '/home/user/vidbee/telegram-bot-state.json'
)
const downloadDir = path.resolve(process.env.VIDBEE_DOWNLOAD_DIR ?? '/home/user/vidbee/downloads')
const apiBaseUrl = (process.env.VIDBEE_API_URL?.trim() || 'http://127.0.0.1:3100').replace(
  /\/+$/,
  ''
)
const publicBaseUrl = process.env.VIDBEE_PUBLIC_URL?.trim()?.replace(/\/+$/, '') ?? ''

const parseIdSet = (raw: string | undefined): Set<number> =>
  new Set(
    (raw ?? '')
      .split(',')
      .map((chunk) => Number(chunk.trim()))
      .filter((id) => Number.isInteger(id) && id > 0)
  )

const allowedUsers = parseIdSet(process.env.TELEGRAM_ALLOWED_USERS)
const adminUsers = parseIdSet(process.env.TELEGRAM_ADMIN_USERS)
for (const adminId of adminUsers) {
  allowedUsers.add(adminId)
}

const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? ''
if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is required.')
}
if (allowedUsers.size === 0) {
  throw new Error('TELEGRAM_ALLOWED_USERS/TELEGRAM_ADMIN_USERS must include at least one user ID.')
}

const rpcClient: ContractRouterClient<typeof downloaderContract> = createORPCClient(
  new RPCLink({
    url: `${apiBaseUrl}/rpc`
  })
)

const readState = async (): Promise<BotState> => {
  try {
    const raw = await fs.readFile(stateFilePath, 'utf-8')
    const parsed = JSON.parse(raw) as BotState
    return {
      trackedTasks: parsed.trackedTasks ?? {}
    }
  } catch {
    return { ...EMPTY_STATE }
  }
}

const writeState = async (state: BotState): Promise<void> => {
  await fs.mkdir(path.dirname(stateFilePath), { recursive: true })
  await fs.writeFile(stateFilePath, JSON.stringify(state), 'utf-8')
}

const state = await readState()
let watchdogFailureStreak = 0
let lastWatchdogAlertAt = 0

const roleOf = (telegramId: number): Role | null => {
  if (adminUsers.has(telegramId)) {
    return 'admin'
  }
  if (allowedUsers.has(telegramId)) {
    return 'user'
  }
  return null
}

const withRole = async (
  telegramId: number | undefined,
  minimumRole: Role,
  cb: (role: Role) => Promise<void>
): Promise<void> => {
  if (!telegramId) {
    return
  }
  const role = roleOf(telegramId)
  if (!role) {
    return
  }
  if (minimumRole === 'admin' && role !== 'admin') {
    throw new Error('This command is available only for admins.')
  }
  await cb(role)
}

const findTask = (
  taskId: string,
  active: DownloadTask[],
  history: DownloadTask[]
): DownloadTask | undefined =>
  active.find((task) => task.id === taskId) ?? history.find((task) => task.id === taskId)

const renderTask = (task: DownloadTask): string => {
  const title = task.title?.trim() || task.savedFileName?.trim() || task.id
  return `• ${task.status.toUpperCase()} [${task.type}] ${title}`
}

const resolveTaskFilePath = (task: DownloadTask): string | null => {
  const fileName = task.savedFileName?.trim()
  const taskDir = task.downloadPath?.trim()
  if (fileName && taskDir) {
    return path.resolve(taskDir, fileName)
  }
  if (fileName) {
    return path.resolve(downloadDir, fileName)
  }
  return null
}

const restartService = async (service: string): Promise<string> => {
  if (!allowedServices.has(service)) {
    throw new Error(`Service "${service}" is not allowed.`)
  }
  const result = await execFileAsync('sudo', ['-n', 'systemctl', 'restart', `${service}.service`])
  return (result.stdout || result.stderr || '').trim()
}

const serviceStatus = async (service: string): Promise<string> => {
  if (!allowedServices.has(service)) {
    return `${service}: blocked`
  }
  try {
    const { stdout } = await execFileAsync('systemctl', ['is-active', `${service}.service`])
    return `${service}: ${stdout.trim() || 'unknown'}`
  } catch (error) {
    const message = error instanceof Error ? error.message : 'status failed'
    return `${service}: error (${message})`
  }
}

const sendFallback = async (
  bot: Telegraf,
  chatId: number,
  task: DownloadTask,
  reason: string,
  filePath: string | null
): Promise<void> => {
  const apiFileUrl = `${apiBaseUrl}/downloads/${encodeURIComponent(task.id)}/file`
  const publicUrl = publicBaseUrl
    ? `${publicBaseUrl}/downloads/${encodeURIComponent(task.id)}/file`
    : ''
  const lines = [
    `Файл готов, но отправка вложением не удалась: ${reason}`,
    filePath ? `Путь: ${filePath}` : 'Путь: недоступен',
    `Local API: ${apiFileUrl}`
  ]
  if (publicUrl) {
    lines.push(`Public URL: ${publicUrl}`)
  }
  await bot.telegram.sendMessage(chatId, lines.join('\n'))
}

const sendTaskFile = async (
  bot: Telegraf,
  tracked: TrackedTask,
  task: DownloadTask
): Promise<void> => {
  const filePath = resolveTaskFilePath(task)
  if (!filePath) {
    await sendFallback(bot, tracked.chatId, task, 'не найден filePath', null)
    return
  }

  let statInfo: Awaited<ReturnType<typeof fs.stat>> | null = null
  try {
    statInfo = await fs.stat(filePath)
  } catch {
    statInfo = null
  }

  if (!statInfo?.isFile()) {
    await sendFallback(bot, tracked.chatId, task, 'файл отсутствует на диске', filePath)
    return
  }
  if (statInfo.size > TELEGRAM_MAX_UPLOAD_BYTES) {
    await sendFallback(
      bot,
      tracked.chatId,
      task,
      `размер ${statInfo.size} превышает лимит Telegram`,
      filePath
    )
    return
  }

  const caption = `${task.type.toUpperCase()} готов: ${task.title?.trim() || task.savedFileName || task.id}`
  try {
    if (task.type === 'video') {
      await bot.telegram.sendVideo(tracked.chatId, Input.fromLocalFile(filePath), { caption })
    } else if (task.type === 'audio') {
      await bot.telegram.sendAudio(tracked.chatId, Input.fromLocalFile(filePath), { caption })
    } else {
      await bot.telegram.sendDocument(tracked.chatId, Input.fromLocalFile(filePath), { caption })
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'telegram upload failed'
    await sendFallback(bot, tracked.chatId, task, reason, filePath)
  }
}

const bot = new Telegraf(token)

bot.use(async (ctx, next) => {
  const telegramId = ctx.from?.id
  if (!telegramId) {
    return
  }
  const role = roleOf(telegramId)
  if (!role) {
    await ctx.reply('Доступ запрещен. Сообщите ваш Telegram ID администратору.')
    return
  }
  await next()
})

bot.start(async (ctx) => {
  const role = roleOf(ctx.from?.id ?? 0)
  await ctx.reply(
    [
      `VidBee bot online. Role: ${role ?? 'unknown'}`,
      '/add <url> - video',
      '/audio <url> - audio',
      '/text <url> - text',
      '/status - queue/history',
      '/srv_status - admin only',
      '/srv_restart <vidbee-api|vidbee-web|cloudflared-vidbee> - admin only'
    ].join('\n')
  )
})

const createTaskFromCommand = async (
  chatId: number,
  requesterId: number,
  type: 'video' | 'audio' | 'text',
  url: string
): Promise<string> => {
  const response = await rpcClient.downloads.create({
    url,
    type
  })
  const taskId = response.download.id
  state.trackedTasks[taskId] = {
    id: taskId,
    chatId,
    requestedBy: requesterId,
    requestedType: type,
    createdAt: Date.now(),
    delivered: false
  }
  await writeState(state)
  return taskId
}

const parseUrl = (text: string): string => {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error('Укажите URL после команды.')
  }
  const parsed = new URL(trimmed)
  return parsed.toString()
}

bot.command('add', async (ctx) => {
  const url = parseUrl(ctx.payload)
  const taskId = await createTaskFromCommand(ctx.chat.id, ctx.from.id, 'video', url)
  await ctx.reply(`Задача добавлена: ${taskId}`)
})

bot.command('audio', async (ctx) => {
  const url = parseUrl(ctx.payload)
  const taskId = await createTaskFromCommand(ctx.chat.id, ctx.from.id, 'audio', url)
  await ctx.reply(`Аудио-задача добавлена: ${taskId}`)
})

bot.command('text', async (ctx) => {
  const url = parseUrl(ctx.payload)
  const taskId = await createTaskFromCommand(ctx.chat.id, ctx.from.id, 'text', url)
  await ctx.reply(`Текстовая задача добавлена: ${taskId}`)
})

bot.command('status', async (ctx) => {
  const [active, history] = await Promise.all([
    rpcClient.downloads.list(),
    rpcClient.history.list()
  ])
  const activeTop = active.downloads.slice(0, 5)
  const historyTop = history.history.slice(0, 5)
  const lines = [
    `Active: ${active.downloads.length}`,
    ...activeTop.map(renderTask),
    `History: ${history.history.length}`,
    ...historyTop.map(renderTask)
  ]
  await ctx.reply(lines.join('\n'))
})

bot.command('srv_status', async (ctx) => {
  await withRole(ctx.from?.id, 'admin', async () => {
    const lines = await Promise.all(
      Array.from(allowedServices).map((service) => serviceStatus(service))
    )
    await ctx.reply(lines.join('\n'))
  })
})

bot.command('srv_restart', async (ctx) => {
  await withRole(ctx.from?.id, 'admin', async () => {
    const service = ctx.payload.trim()
    if (!service) {
      throw new Error('Usage: /srv_restart <vidbee-api|vidbee-web|cloudflared-vidbee>')
    }
    await restartService(service)
    await ctx.reply(`Restart triggered: ${service}`)
  })
})

bot.catch(async (error, ctx) => {
  const message = error instanceof Error ? error.message : 'Unknown error'
  await ctx.reply(`Ошибка: ${message}`)
})

const monitorTasks = async (): Promise<void> => {
  const trackedIds = Object.keys(state.trackedTasks)
  if (trackedIds.length === 0) {
    return
  }
  const [active, history] = await Promise.all([
    rpcClient.downloads.list(),
    rpcClient.history.list()
  ])
  for (const taskId of trackedIds) {
    const tracked = state.trackedTasks[taskId]
    if (!tracked || tracked.delivered) {
      continue
    }
    const task = findTask(taskId, active.downloads, history.history)
    if (!task) {
      continue
    }
    if (task.status === 'completed') {
      await sendTaskFile(bot, tracked, task)
      tracked.delivered = true
      await writeState(state)
      continue
    }
    if (task.status === 'error' || task.status === 'cancelled') {
      const reason = task.error?.trim() || task.status
      await bot.telegram.sendMessage(tracked.chatId, `Задача ${task.id} завершилась: ${reason}`)
      tracked.delivered = true
      await writeState(state)
    }
  }
}

const notifyAdmins = async (text: string): Promise<void> => {
  await Promise.all(
    Array.from(adminUsers).map(async (adminId) => {
      try {
        await bot.telegram.sendMessage(adminId, text)
      } catch {
        // keep watchdog robust even if one admin chat is unavailable
      }
    })
  )
}

const watchdogTick = async (): Promise<void> => {
  try {
    const health = await fetch(`${apiBaseUrl}/health`, { signal: AbortSignal.timeout(5000) })
    if (!health.ok) {
      throw new Error(`Health status ${health.status}`)
    }
    watchdogFailureStreak = 0
  } catch (error) {
    watchdogFailureStreak += 1
    if (watchdogFailureStreak < WATCHDOG_FAIL_THRESHOLD) {
      return
    }

    if (ENABLE_AUTO_RESTART) {
      try {
        await restartService('vidbee-api')
      } catch {
        // Continue to alert below.
      }
    }

    const now = Date.now()
    if (now - lastWatchdogAlertAt < WATCHDOG_ALERT_THROTTLE_MS) {
      return
    }
    lastWatchdogAlertAt = now
    const message = error instanceof Error ? error.message : 'unknown'
    await notifyAdmins(
      `Watchdog: API health failed ${watchdogFailureStreak} times. Last error: ${message}`
    )
  }
}

await bot.launch()
console.log('VidBee Telegram bot started')

setInterval(() => {
  void monitorTasks()
}, POLL_INTERVAL_MS).unref()

setInterval(() => {
  void watchdogTick()
}, WATCHDOG_INTERVAL_MS).unref()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void bot.stop(signal)
    process.exit(0)
  })
}
