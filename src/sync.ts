import mqtt, { type MqttClient } from 'mqtt'
import type { Customer, LedgerData } from './types'

// ---------------------------------------------------------------------------
// Khata device-to-device sync.
//
// No backend, no account. The sender encrypts the ledger with AES-GCM (key
// derived from a 6-digit pairing code) and publishes it in chunks as retained
// MQTT messages to a public relay. The receiver enters the same code,
// downloads, decrypts, previews, and then smart-merges or replaces.
// Anyone holding the code within its short lifetime can fetch the payload,
// so codes are single-use and cleared after delivery.
// ---------------------------------------------------------------------------

const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081']
const TOPIC_ROOT = 'khata/v1'
const CHUNK_SIZE = 32 * 1024 // chars per chunk — stays far below broker limits
const MAX_CHUNKS = 150 // ~4.8 MB cap (bill photos make ledgers heavy)
const KEY_SALT = 'khata-sync-v1|'

export type SyncPayload = {
  v: 1
  exportedAt: string
  device: string
  customers: Customer[]
}

export function makeCode(): string {
  const bytes = new Uint32Array(1)
  crypto.getRandomValues(bytes)
  return String(100000 + (bytes[0] % 900000))
}

export function normalizeCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, 6)
}

export function deviceLabel(): string {
  const ua = navigator.userAgent
  const mobile = /android|iphone|ipad|ipod|mobile/i.test(ua)
  const browser = /chrome/i.test(ua) && !/edg/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : /firefox/i.test(ua) ? 'Firefox' : /edg/i.test(ua) ? 'Edge' : 'Browser'
  const os = /android/i.test(ua) ? 'Android' : /iphone|ipad|ipod/i.test(ua) ? 'iOS' : /windows/i.test(ua) ? 'Windows' : /mac/i.test(ua) ? 'Mac' : /linux/i.test(ua) ? 'Linux' : mobile ? 'Mobile' : 'Desktop'
  return `${os} · ${browser}`
}

// --- base64 helpers (binary-safe) ------------------------------------------

function bytesToB64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// --- encryption --------------------------------------------------------------

async function codeKey(code: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(KEY_SALT + code))
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptPayload(code: string, plainJson: string): Promise<string> {
  const key = await codeKey(code)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plainJson)))
  const packed = new Uint8Array(12 + cipher.length)
  packed.set(iv, 0)
  packed.set(cipher, 12)
  return bytesToB64(packed)
}

export async function decryptPayload(code: string, packedB64: string): Promise<string> {
  const packed = b64ToBytes(packedB64)
  if (packed.length < 13) throw new Error('Payload is too short.')
  const key = await codeKey(code)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, key, packed.slice(12))
  return new TextDecoder().decode(plain)
}

// --- payload -----------------------------------------------------------------

export function buildPayload(data: LedgerData): string {
  const payload: SyncPayload = {
    v: 1,
    exportedAt: new Date().toISOString(),
    device: deviceLabel(),
    customers: data.customers,
  }
  return JSON.stringify(payload)
}

export function parsePayload(json: string): SyncPayload {
  const parsed = JSON.parse(json) as Partial<SyncPayload>
  if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.customers)) throw new Error('Sync payload is invalid.')
  return parsed as SyncPayload
}

// --- relay --------------------------------------------------------------------

type ChunkMsg = { s: string; t: number; i: number; d: string }

function topicFor(code: string) {
  return `${TOPIC_ROOT}/${code}`
}

function connectRelay(): Promise<MqttClient> {
  let index = 0
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (index >= BROKERS.length) {
        reject(new Error('Could not reach the sync relay. Check your internet and retry.'))
        return
      }
      const url = BROKERS[index++]
      const client = mqtt.connect(url, { connectTimeout: 10000, reconnectPeriod: 0, clean: true })
      client.on('connect', () => resolve(client))
      client.on('error', () => {
        client.end(true)
        attempt()
      })
    }
    attempt()
  })
}

export type ProgressFn = (done: number, total: number) => void

export async function publishLedger(code: string, payloadJson: string, session: string, onProgress: ProgressFn): Promise<{ client: MqttClient; chunks: number }> {
  const sealed = await encryptPayload(code, payloadJson)
  const parts: string[] = []
  for (let i = 0; i < sealed.length; i += CHUNK_SIZE) parts.push(sealed.slice(i, i + CHUNK_SIZE))
  if (parts.length > MAX_CHUNKS) {
    throw new Error(
      `Ledger is too large to sync (${(sealed.length / 1024 / 1024).toFixed(1)} MB). Remove some bill photos or use Export/Import file transfer instead.`,
    )
  }
  const client = await connectRelay()
  const base = topicFor(code)
  for (let i = 0; i < parts.length; i++) {
    const msg: ChunkMsg = { s: session, t: parts.length, i, d: parts[i] }
    await new Promise<void>((resolve, reject) => {
      client.publish(`${base}/c/${i}`, JSON.stringify(msg), { qos: 1, retain: true }, error => (error ? reject(error) : resolve()))
    })
    onProgress(i + 1, parts.length)
  }
  return { client, chunks: parts.length }
}

export function waitForAck(client: MqttClient, code: string, timeoutMs: number): Promise<boolean> {
  const base = topicFor(code)
  return new Promise(resolve => {
    const done = (value: boolean) => {
      clearTimeout(timer)
      client.unsubscribe(`${base}/ack`)
      resolve(value)
    }
    const timer = setTimeout(() => done(false), timeoutMs)
    client.subscribe(`${base}/ack`, { qos: 1 }, () => undefined)
    client.on('message', topic => {
      if (topic === `${base}/ack`) done(true)
    })
  })
}

export async function receiveLedger(code: string, sessionLock: { id: string | null }, onProgress: ProgressFn, timeoutMs = 30000): Promise<{ payload: SyncPayload; chunks: number; clear: () => void }> {
  const client = await connectRelay()
  const base = topicFor(code)
  const seen = new Map<number, string>()
  let total = -1
  const seenTopics = new Set<string>()
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No sync found for this code. Check the code and ask the sender to keep their screen open.')), timeoutMs)
      client.on('message', (topic, raw) => {
        try {
          const msg = JSON.parse(String(raw)) as ChunkMsg
          if (typeof msg.i !== 'number' || typeof msg.t !== 'number' || typeof msg.d !== 'string' || !msg.s) return
          if (sessionLock.id === null) sessionLock.id = msg.s
          if (msg.s !== sessionLock.id) return // stale payload from an older code reuse
          total = msg.t
          seen.set(msg.i, msg.d)
          seenTopics.add(topic)
          onProgress(seen.size, total)
          if (seen.size >= total) {
            clearTimeout(timer)
            resolve()
          }
        } catch {
          /* ignore malformed relay noise */
        }
      })
      client.subscribe(`${base}/c/#`, { qos: 1 }, error => {
        if (error) {
          clearTimeout(timer)
          reject(error)
        }
      })
    })
    const ordered: string[] = []
    for (let i = 0; i < total; i++) {
      const part = seen.get(i)
      if (part === undefined) throw new Error('Sync arrived incomplete. Please retry.')
      ordered.push(part)
    }
    const json = await decryptPayload(code, ordered.join(''))
    const payload = parsePayload(json)
    const topics = [...seenTopics]
    const clear = () => {
      // Best-effort wipe so the single-use code cannot be replayed.
      for (const t of topics) client.publish(t, '', { qos: 1, retain: true }, () => undefined)
      client.publish(`${base}/ack`, JSON.stringify({ ok: true, at: new Date().toISOString() }), { qos: 0, retain: false }, () => undefined)
      setTimeout(() => client.end(true), 1500)
    }
    return { payload, chunks: total, clear }
  } catch (error) {
    client.end(true)
    throw error
  }
}

export function clearPublished(client: MqttClient, code: string, chunks: number) {
  const base = topicFor(code)
  for (let i = 0; i < chunks; i++) client.publish(`${base}/c/${i}`, '', { qos: 1, retain: true }, () => undefined)
}

export function closeRelay(client: MqttClient) {
  try {
    client.end(true)
  } catch {
    /* already closed */
  }
}
