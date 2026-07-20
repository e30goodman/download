import type { Task } from '@vidbee/task-queue'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { taskQueue } from './downloader'

const ACTIVE_VISITOR_WINDOW_MS = 5 * 60 * 1000
const NEW_VISITOR_WINDOW_MS = 24 * 60 * 60 * 1000
const MAX_VISITORS = 500
const MAX_EVENTS = 100
const MAX_TASKS_TO_SCAN = 10_000
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BACKGROUND_PATHS = new Set(['/health', '/events', '/docs', '/openapi.json'])
const BACKGROUND_RPC_PATHS = new Set([
  '/status',
  '/downloads/list',
  '/history/list',
  '/settings/get',
  '/files/exists'
])
const MONITOR_CLIENT_KINDS = new Set(['monitor', 'internal'])
const LOCAL_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost', 'unknown'])

interface VisitorActivity {
  country: string | null
  currentRequests: number
  firstSeen: number
  ip: string
  key: string
  kind: 'monitor' | 'user'
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

export const getRequestPath = (rawUrl: string | undefined): string => {
  const url = rawUrl?.trim() || '/'
  const pathOnly = url.split('?')[0]?.split('#')[0]?.trim() || '/'
  return pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`
}

export const getClientKind = (request: FastifyRequest): string | null => {
  const clientKind = firstHeaderValue(request.headers['x-vidbee-client'])?.toLowerCase() ?? null
  return clientKind
}

export const isBackgroundRequestPath = (pathOnly: string, clientKind: string | null): boolean => {
  if (clientKind && MONITOR_CLIENT_KINDS.has(clientKind)) {
    return true
  }

  if (BACKGROUND_PATHS.has(pathOnly)) {
    return true
  }

  if (pathOnly.startsWith('/images/proxy')) {
    return true
  }

  if (pathOnly.startsWith('/rpc/')) {
    const rpcPath = pathOnly.slice('/rpc'.length)
    return BACKGROUND_RPC_PATHS.has(rpcPath)
  }

  return false
}

export const isBackgroundRequest = (request: FastifyRequest): boolean =>
  isBackgroundRequestPath(getRequestPath(request.raw.url), getClientKind(request))

export const isNewVisitor = (firstSeen: number, now: number): boolean =>
  firstSeen >= now - NEW_VISITOR_WINDOW_MS

const parseIgnoreList = (value: string | undefined): Set<string> => {
  const entries = value
    ?.split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  return new Set(entries ?? [])
}

const ignoredIps = parseIgnoreList(process.env.VIDBEE_MONITOR_IGNORE_IPS)
const ignoredSessions = parseIgnoreList(process.env.VIDBEE_MONITOR_IGNORE_SESSIONS)

export const isLoopbackOrPrivateIp = (ip: string): boolean => {
  const normalized = ip.trim().toLowerCase()
  if (!normalized || LOCAL_IPS.has(normalized)) {
    return true
  }
  if (normalized.startsWith('::ffff:')) {
    return isLoopbackOrPrivateIp(normalized.slice('::ffff:'.length))
  }
  if (normalized.includes(':')) {
    return normalized === '::1' || normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')
  }

  const octets = normalized.split('.').map((part) => Number(part))
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }

  const [first, second] = octets
  if (first === 10) {
    return true
  }
  if (first === 127) {
    return true
  }
  if (first === 192 && second === 168) {
    return true
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return true
  }
  return false
}

export const shouldTrackRequest = (
  pathOnly: string,
  clientKind: string | null,
  ip: string,
  cloudflareIp: string | null,
  sessionId: string | null
): boolean => {
  if (isBackgroundRequestPath(pathOnly, clientKind)) {
    return false
  }

  if (isLoopbackOrPrivateIp(ip)) {
    return false
  }

  if (cloudflareIp && isLoopbackOrPrivateIp(cloudflareIp)) {
    return false
  }

  if (!cloudflareIp) {
    return false
  }

  const normalizedIp = ip.toLowerCase()
  const normalizedCloudflareIp = cloudflareIp.toLowerCase()
  if (ignoredIps.has(normalizedIp) || ignoredIps.has(normalizedCloudflareIp)) {
    return false
  }

  if (sessionId && ignoredSessions.has(sessionId.toLowerCase())) {
    return false
  }

  return true
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

const resolveVisitorKind = (clientKind: string | null): VisitorActivity['kind'] =>
  clientKind && MONITOR_CLIENT_KINDS.has(clientKind) ? 'monitor' : 'user'

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
  const pathOnly = getRequestPath(request.raw.url)
  const clientKind = getClientKind(request)
  const sessionId = getSessionId(request)
  const ip = getClientIp(request)
  const cloudflareIp = truncate(firstHeaderValue(request.headers['cf-connecting-ip']), 80)

  if (!shouldTrackRequest(pathOnly, clientKind, ip, cloudflareIp, sessionId)) {
    return
  }

  const now = Date.now()
  const visitorKey = sessionId ? `session:${sessionId}` : `ip:${ip}`
  const visitorIp = cloudflareIp ?? ip
  let visitor = visitors.get(visitorKey)

  if (!visitor) {
    ensureVisitorCapacity()
    visitor = {
      country: truncate(firstHeaderValue(request.headers['cf-ipcountry']), 8),
      currentRequests: 0,
      firstSeen: now,
      ip: visitorIp,
      key: visitorKey,
      kind: resolveVisitorKind(clientKind),
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
  visitor.kind = resolveVisitorKind(clientKind)
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

export const dismissVisitor = (key: string): boolean => visitors.delete(key.trim())

export const clearAllVisitors = (): number => {
  const removed = visitors.size
  visitors.clear()
  return removed
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
    .filter((visitor) => visitor.kind !== 'monitor')
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .map((visitor) => ({
      active: visitor.currentRequests > 0 || visitor.lastSeen >= now - ACTIVE_VISITOR_WINDOW_MS,
      country: visitor.country,
      currentRequests: visitor.currentRequests,
      firstSeen: visitor.firstSeen,
      ip: visitor.ip,
      isNew: isNewVisitor(visitor.firstSeen, now),
      key: visitor.key,
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
      newVisitors: visitorList.filter((visitor) => visitor.isNew).length,
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
