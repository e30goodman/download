import type { ServerResponse } from 'node:http'

const HEARTBEAT_INTERVAL_MS = 15_000

export class SseHub {
  private readonly clients = new Map<ServerResponse, string | null>()
  private heartbeatTimer: NodeJS.Timeout | null = null

  addClient(client: ServerResponse, publicSessionId: string | null = null): void {
    this.clients.set(client, publicSessionId)
    client.write('event: connected\ndata: {"ok":true}\n\n')
    this.ensureHeartbeatTimer()
  }

  removeClient(client: ServerResponse): void {
    this.clients.delete(client)
    if (this.clients.size === 0) {
      this.clearHeartbeatTimer()
    }
  }

  publish(event: string, payload: unknown, publicSessionId?: string | null): void {
    if (this.clients.size === 0) {
      return
    }

    const data = JSON.stringify(payload)
    const message = `event: ${event}\ndata: ${data}\n\n`

    for (const [client, clientSessionId] of this.clients) {
      if (publicSessionId !== undefined && clientSessionId !== publicSessionId) {
        continue
      }
      client.write(message)
    }
  }

  publishPerClient(
    event: string,
    createPayload: (publicSessionId: string | null) => unknown
  ): void {
    for (const [client, publicSessionId] of this.clients) {
      const data = JSON.stringify(createPayload(publicSessionId))
      client.write(`event: ${event}\ndata: ${data}\n\n`)
    }
  }

  closeAll(): void {
    for (const client of this.clients.keys()) {
      client.end()
    }
    this.clients.clear()
    this.clearHeartbeatTimer()
  }

  private ensureHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      return
    }

    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients.keys()) {
        client.write(': heartbeat\n\n')
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  private clearHeartbeatTimer(): void {
    if (!this.heartbeatTimer) {
      return
    }
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }
}
