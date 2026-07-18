import { lookup } from 'node:dns/promises'
import net from 'node:net'

export class RemoteUrlPolicyError extends Error {
  constructor() {
    super('Remote URL is not allowed.')
    this.name = 'RemoteUrlPolicyError'
  }
}

export type RemoteUrlPolicyMode = 'basic' | 'public'

export interface RemoteUrlPolicyOptions {
  mode: RemoteUrlPolicyMode
}

const ipv4ToNumber = (address: string): number | null => {
  const octets = address.split('.').map((part) => Number.parseInt(part, 10))
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null
  }
  return (
    (octets[0] ?? 0) * 256 ** 3 +
    (octets[1] ?? 0) * 256 ** 2 +
    (octets[2] ?? 0) * 256 +
    (octets[3] ?? 0)
  )
}

const isIpv4InRange = (address: number, base: number, prefixLength: number): boolean => {
  const blockSize = 2 ** (32 - prefixLength)
  return Math.floor(address / blockSize) === Math.floor(base / blockSize)
}

const BLOCKED_IPV4_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
] as const
const BLOCKED_DOMAIN_SUFFIXES = [
  'localhost',
  'local',
  'test',
  'invalid',
  'example',
  'home.arpa',
  'onion'
] as const

const parseIpv6 = (address: string): bigint | null => {
  let normalized = address.toLowerCase().split('%')[0] ?? ''
  const embeddedIpv4Match = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (embeddedIpv4Match) {
    const ipv4 = ipv4ToNumber(embeddedIpv4Match[1] ?? '')
    if (ipv4 === null) {
      return null
    }
    normalized = normalized.replace(
      embeddedIpv4Match[1] ?? '',
      `${Math.floor(ipv4 / 65_536).toString(16)}:${(ipv4 % 65_536).toString(16)}`
    )
  }

  const halves = normalized.split('::')
  if (halves.length > 2) {
    return null
  }
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) {
    return null
  }
  const words = [...left, ...Array.from({ length: missing }, () => '0'), ...right]
  if (words.length !== 8) {
    return null
  }
  let result = 0n
  for (const word of words) {
    if (!/^[\da-f]{1,4}$/.test(word)) {
      return null
    }
    result = result * 65_536n + BigInt(Number.parseInt(word, 16))
  }
  return result
}

const isIpv6InRange = (address: bigint, base: bigint, prefixLength: number): boolean => {
  const shift = 128n - BigInt(prefixLength)
  const blockSize = 2n ** shift
  return address / blockSize === base / blockSize
}

const IPV6_RANGES = [
  ['::', 96],
  ['::ffff:0:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
  ['2620:4f:8000::', 48],
  ['fc00::', 7],
  ['fec0::', 10],
  ['fe80::', 10],
  ['ff00::', 8]
] as const

const BLOCKED_IPV6_RANGES = IPV6_RANGES.map(([base, prefixLength]) => {
  const parsed = parseIpv6(base)
  if (parsed === null) {
    throw new Error(`Invalid internal IPv6 range: ${base}`)
  }
  return [parsed, prefixLength] as const
})

export const isPublicIpAddress = (rawAddress: string): boolean => {
  const address = rawAddress.replace(/^\[|\]$/g, '')
  if (net.isIP(address) === 4) {
    const numericAddress = ipv4ToNumber(address)
    return (
      numericAddress !== null &&
      !BLOCKED_IPV4_RANGES.some(([base, prefixLength]) => {
        const numericBase = ipv4ToNumber(base)
        return numericBase !== null && isIpv4InRange(numericAddress, numericBase, prefixLength)
      })
    )
  }
  if (net.isIP(address) !== 6) {
    return false
  }

  const numericAddress = parseIpv6(address)
  if (numericAddress === null) {
    return false
  }
  const mappedIpv4Prefix = 0xffffn
  const ipv4AddressSpaceSize = 2n ** 32n
  if (numericAddress / ipv4AddressSpaceSize === mappedIpv4Prefix) {
    const mappedIpv4 = Number(numericAddress % ipv4AddressSpaceSize)
    return !BLOCKED_IPV4_RANGES.some(([base, prefixLength]) => {
      const numericBase = ipv4ToNumber(base)
      return numericBase !== null && isIpv4InRange(mappedIpv4, numericBase, prefixLength)
    })
  }
  return !BLOCKED_IPV6_RANGES.some(([base, prefixLength]) =>
    isIpv6InRange(numericAddress, base, prefixLength)
  )
}

export const assertRemoteHttpUrl = async (
  value: string | URL,
  options: RemoteUrlPolicyOptions
): Promise<URL> => {
  let url: URL
  try {
    url = value instanceof URL ? new URL(value) : new URL(value)
  } catch {
    throw new RemoteUrlPolicyError()
  }

  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new RemoteUrlPolicyError()
  }
  if (options.mode === 'basic') {
    return url
  }

  const hostname = url.hostname
    .replace(/^\[|\]$/g, '')
    .trim()
    .toLowerCase()
  if (
    !hostname ||
    BLOCKED_DOMAIN_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
  ) {
    throw new RemoteUrlPolicyError()
  }

  if (net.isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) {
      throw new RemoteUrlPolicyError()
    }
    return url
  }

  try {
    const records = await lookup(hostname, { all: true, verbatim: true })
    if (records.length === 0 || records.some((record) => !isPublicIpAddress(record.address))) {
      throw new RemoteUrlPolicyError()
    }
  } catch (error) {
    if (error instanceof RemoteUrlPolicyError) {
      throw error
    }
    throw new RemoteUrlPolicyError()
  }

  return url
}
