import { createAdminServer } from './admin-server'
import { createApiServer } from './server'

const host = process.env.VIDBEE_API_HOST?.trim() || '0.0.0.0'
const portValue = Number(process.env.VIDBEE_API_PORT ?? '')
const port = Number.isInteger(portValue) && portValue > 0 ? portValue : 3100
const adminPortValue = Number(process.env.VIDBEE_ADMIN_PORT ?? '')
const adminPort = Number.isInteger(adminPortValue) && adminPortValue > 0 ? adminPortValue : port + 1

const server = await createApiServer()
const adminServer = createAdminServer()

try {
  await server.listen({ host, port })
  server.log.info(`VidBee API server listening on http://${host}:${port}`)
  await adminServer.listen({ host: '127.0.0.1', port: adminPort })
  server.log.info(`VidBee monitoring dashboard listening on http://127.0.0.1:${adminPort}`)
} catch (error) {
  server.log.error(error)
  await adminServer.close().catch(() => undefined)
  await server.close().catch(() => undefined)
  process.exit(1)
}

let isShuttingDown = false
const shutdown = async (signal: string) => {
  if (isShuttingDown) {
    return
  }
  isShuttingDown = true
  server.log.info(`Received ${signal}, shutting down API server`)
  await adminServer.close()
  await server.close()
  process.exit(0)
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})
process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
