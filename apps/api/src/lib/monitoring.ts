import type { Task } from '@vidbee/task-queue'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { taskQueue } from './downloader'

const ACTIVE_VISITOR_WINDOW_MS = 5 * 60 * 1000
const MAX_VISITORS = 500
const MAX_EVENTS = 100
const MAX_TASKS_TO_SCAN = 10_000
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface VisitorActivity {
  country: string | null
  currentRequests: number
  firstSeen: number
  ip: string
  key: string
  lastSeen: number
  requests: number
  sessionId: string | null
  userAgent: string | null
}

interface MonitoringEvent {
  at: number
  detail: string
  kind: 'error' | 'queue'
  taskId: string | null
  title: string
}

interface RequestTiming {
  startedAt: number
  visitorKey: string
}

const requestTimings = new WeakMap<FastifyRequest, RequestTiming>()
const visitors = new Map<string, VisitorActivity>()
const events: MonitoringEvent[] = []
const serverStartedAt = Date.now()

let activeRequests = 0
let errorResponses = 0
let lastRequestAt: number | null = null
let maximumLatencyMs = 0
let totalLatencyMs = 0
let totalRequests = 0
let status2xx = 0
let status3xx = 0
let status4xx = 0
let status5xx = 0

const firstHeaderValue = (value: string | string[] | undefined): string | null => {
  const firstValue = Array.isArray(value) ? value[0] : value
  const trimmed = firstValue?.trim()
  return trimmed ? trimmed : null
}

const truncate = (value: string | null | undefined, maximumLength: number): string | null => {
  if (!value) {
    return null
  }
  return value.length > maximumLength ? `${value.slice(0, maximumLength - 1)}…` : value
}

const getSessionId = (request: FastifyRequest): string | null => {
  const headerSession = firstHeaderValue(request.headers['x-vidbee-session'])
  if (headerSession && SESSION_ID_PATTERN.test(headerSession)) {
    return headerSession.toLowerCase()
  }

  try {
    const requestUrl = new URL(request.raw.url ?? '/', 'http://localhost')
    const querySession = requestUrl.searchParams.get('session')?.trim() ?? ''
    return SESSION_ID_PATTERN.test(querySession) ? querySession.toLowerCase() : null
  } catch {
    return null
  }
}

const getClientIp = (request: FastifyRequest): string => {
  const cloudflareIp = firstHeaderValue(request.headers['cf-connecting-ip'])
  return truncate(cloudflareIp ?? request.ip, 80) ?? 'unknown'
}

const isMonitoredRequest = (request: FastifyRequest): boolean =>
  !request.raw.url?.startsWith('/health')

const ensureVisitorCapacity = (): void => {
  if (visitors.size < MAX_VISITORS) {
    return
  }
  const oldestVisitor = [...visitors.values()].sort((a, b) => a.lastSeen - b.lastSeen)[0]
  if (oldestVisitor) {
    visitors.delete(oldestVisitor.key)
  }
}

export const recordRequestStarted = (request: FastifyRequest): void => {
  if (!isMonitoredRequest(request)) {
    return
  }

  const now = Date.now()
  const sessionId = getSessionId(request)
  const ip = getClientIp(request)
  const visitorKey = sessionId ? `session:${sessionId}` : `ip:${ip}`
  let visitor = visitors.get(visitorKey)

  if (!visitor) {
    ensureVisitorCapacity()
    visitor = {
      country: truncate(firstHeaderValue(request.headers['cf-ipcountry']), 8),
      currentRequests: 0,
      firstSeen: now,
      ip,
      key: visitorKey,
      lastSeen: now,
      requests: 0,
      sessionId,
      userAgent: truncate(firstHeaderValue(request.headers['user-agent']), 180)
    }
    visitors.set(visitorKey, visitor)
  }

  visitor.currentRequests += 1
  visitor.lastSeen = now
  visitor.requests += 1
  visitor.country =
    truncate(firstHeaderValue(request.headers['cf-ipcountry']), 8) ?? visitor.country
  visitor.userAgent =
    truncate(firstHeaderValue(request.headers['user-agent']), 180) ?? visitor.userAgent

  activeRequests += 1
  lastRequestAt = now
  totalRequests += 1
  requestTimings.set(request, { startedAt: performance.now(), visitorKey })
}

export const recordRequestCompleted = (request: FastifyRequest, reply: FastifyReply): void => {
  const timing = requestTimings.get(request)
  if (!timing) {
    return
  }

  const latencyMs = Math.max(0, performance.now() - timing.startedAt)
  totalLatencyMs += latencyMs
  maximumLatencyMs = Math.max(maximumLatencyMs, latencyMs)
  activeRequests = Math.max(0, activeRequests - 1)

  const visitor = visitors.get(timing.visitorKey)
  if (visitor) {
    visitor.currentRequests = Math.max(0, visitor.currentRequests - 1)
  }

  if (reply.statusCode >= 500) {
    status5xx += 1
    errorResponses += 1
  } else if (reply.statusCode >= 400) {
    status4xx += 1
  } else if (reply.statusCode >= 300) {
    status3xx += 1
  } else {
    status2xx += 1
  }
  requestTimings.delete(request)
}

const addEvent = (event: MonitoringEvent): void => {
  events.unshift(event)
  if (events.length > MAX_EVENTS) {
    events.length = MAX_EVENTS
  }
}

export const recordQueueTransition = (event: {
  from: string | null
  taskId: string
  to: string
}): void => {
  const task = taskQueue.get(event.taskId)
  addEvent({
    at: Date.now(),
    detail: `${event.from ?? 'created'} → ${event.to}`,
    kind: event.to === 'failed' ? 'error' : 'queue',
    taskId: event.taskId,
    title: truncate(task?.input.title, 120) ?? task?.kind ?? 'Download'
  })
}

const getQueueSnapshot = () => {
  const stats = taskQueue.stats()
  const now = Date.now()
  const todayStartedAt = new Date(now).setHours(0, 0, 0, 0)
  const allTasks: Task[] = []
  let cursor: string | null = null

  do {
    const page = taskQueue.list({ cursor, limit: 200 })
    allTasks.push(...page.tasks)
    cursor = page.nextCursor
  } while (cursor && allTasks.length < MAX_TASKS_TO_SCAN)

  const tasksToday = allTasks.filter((task) => task.createdAt >= todayStartedAt)
  const recentTasks = [...allTasks]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 20)
    .map((task) => ({
      error: truncate(task.lastError?.rawMessage, 160),
      id: task.id,
      percent: task.progress.percent,
      size: task.output?.size ?? task.progress.bytesDownloaded,
      status: task.status,
      title: truncate(task.input.title, 120) ?? task.kind,
      updatedAt: task.updatedAt
    }))

  return {
    capacity: stats.capacity,
    byStatus: stats.byStatus,
    running: stats.running,
    queued: stats.queued,
    total: stats.total,
    today: {
      cancelled: tasksToday.filter((task) => task.status === 'cancelled').length,
      completed: tasksToday.filter((task) => task.status === 'completed').length,
      downloadedBytes: tasksToday.reduce((total, task) => total + (task.output?.size ?? 0), 0),
      failed: tasksToday.filter((task) => task.status === 'failed').length,
      total: tasksToday.length
    },
    recentTasks
  }
}

export const getMonitoringSnapshot = () => {
  const now = Date.now()
  const memory = process.memoryUsage()
  const visitorList = [...visitors.values()]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .map((visitor) => ({
      active: visitor.currentRequests > 0 || visitor.lastSeen >= now - ACTIVE_VISITOR_WINDOW_MS,
      country: visitor.country,
      currentRequests: visitor.currentRequests,
      firstSeen: visitor.firstSeen,
      ip: visitor.ip,
      lastSeen: visitor.lastSeen,
      requests: visitor.requests,
      session: visitor.sessionId ? visitor.sessionId.slice(0, 8) : null,
      userAgent: visitor.userAgent
    }))

  return {
    generatedAt: now,
    server: {
      memory: {
        heapUsed: memory.heapUsed,
        rss: memory.rss
      },
      nodeVersion: process.version,
      pid: process.pid,
      startedAt: serverStartedAt,
      uptimeSeconds: Math.floor(process.uptime())
    },
    traffic: {
      activeRequests,
      activeVisitors: visitorList.filter((visitor) => visitor.active).length,
      averageLatencyMs: totalRequests > 0 ? totalLatencyMs / totalRequests : 0,
      errorResponses,
      lastRequestAt,
      maximumLatencyMs,
      status: {
        '2xx': status2xx,
        '3xx': status3xx,
        '4xx': status4xx,
        '5xx': status5xx
      },
      totalRequests,
      uniqueVisitors: visitorList.length,
      visitors: visitorList.slice(0, 100)
    },
    queue: getQueueSnapshot(),
    events
  }
}
