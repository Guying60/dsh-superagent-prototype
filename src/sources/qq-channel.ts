/** QQ outbound channel: token manager, Ed25519 signing/verification, and message sender. */
import * as crypto from 'node:crypto'
import type { OutboundMessage } from '../core/index.ts'
import type { ChannelLink, ChannelLinks } from './kind.ts'
import { SOURCE, qqTriggerId } from './qq-trigger.ts'
import type { SourceContext } from './host.ts'

export type QQConfig = {
  appId: string
  appSecret: string
  directMessages: boolean
  otherGroups: 'none' | 'mentions' | 'all'
  listenGroups: Array<{
    openid: string
    name?: string
    listen: 'mentions' | 'all'
  }>
  markdownSupport: boolean
} & Record<string, unknown>

// ============ Ed25519 Signature Verification & URL Validation ============

/**
 * Derives a 32-byte Ed25519 seed from the bot AppSecret.
 * Official QQ spec: repeat the secret until >= 32 chars, then truncate to 32 bytes UTF-8.
 */
export function deriveSeed(botSecret: string): Buffer {
  let seed = botSecret
  while (seed.length < 32) {
    seed = seed + seed
  }
  return Buffer.from(seed.slice(0, 32), 'utf-8')
}

/** Generates Ed25519 KeyObject pair from bot secret */
export function getKeyPair(botSecret: string): { privateKey: crypto.KeyObject; publicKey: crypto.KeyObject } {
  const seed = deriveSeed(botSecret)
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      seed,
    ]),
    format: 'der',
    type: 'pkcs8',
  })
  const publicKey = crypto.createPublicKey(privateKey)
  return { privateKey, publicKey }
}

/** Signs message using the bot's Ed25519 private key, returns hex signature */
export function ed25519Sign(botSecret: string, message: Buffer): string {
  const { privateKey } = getKeyPair(botSecret)
  const signature = crypto.sign(null, message, privateKey)
  return signature.toString('hex')
}

/** Verifies inbound webhook request signature */
export function verifyWebhookSignature(params: {
  body: Buffer
  timestamp: string
  signature: string
  botSecret: string
}): boolean {
  const { body, timestamp, signature, botSecret } = params
  if (!botSecret || !timestamp || !signature) return false
  try {
    const { publicKey } = getKeyPair(botSecret)
    const message = Buffer.concat([
      Buffer.from(timestamp, 'utf-8'),
      body,
    ])
    const sigBuffer = Buffer.from(signature, 'hex')
    return crypto.verify(null, message, publicKey, sigBuffer)
  } catch {
    return false
  }
}

// ============ Token Manager ============

interface CachedToken {
  token: string
  expiresAt: number
}

let cachedToken: CachedToken | undefined
let tokenPromise: Promise<string> | undefined

/** Fetches access_token from QQ Open Platform with automatic caching */
export async function getAccessToken(appId: string, clientSecret: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 5 * 60 * 1000) {
    return cachedToken.token
  }

  if (tokenPromise) return tokenPromise

  tokenPromise = (async () => {
    try {
      const res = await fetch('https://bots.qq.com/app/getAppAccessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, clientSecret }),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`QQ getAppAccessToken HTTP ${res.status}: ${errText}`)
      }

      const data = await res.json() as { access_token?: string; expires_in?: number }
      if (!data.access_token) {
        throw new Error(`QQ getAppAccessToken missing access_token: ${JSON.stringify(data)}`)
      }

      const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 7200
      cachedToken = {
        token: data.access_token,
        expiresAt: Date.now() + expiresIn * 1000,
      }
      return cachedToken.token
    } finally {
      tokenPromise = undefined
    }
  })()

  return tokenPromise
}

// ============ Message Sending ============

let msgSeqCounter = 1
function getNextMsgSeq(): number {
  msgSeqCounter = (msgSeqCounter % 65535) + 1
  return msgSeqCounter
}

/** Active SourceContext reference fallback */
let activeContext: SourceContext | undefined
export function setActiveContext(ctx: SourceContext | undefined): void {
  activeContext = ctx
}

/** Sends message to QQ group, direct C2C user, or guild channel */
export async function sendQQ(host: any, message: OutboundMessage): Promise<'sent' | 'gone'> {
  const config = (host?.config ? host.config(SOURCE) : activeContext?.config<QQConfig>(SOURCE)) as QQConfig | undefined
  if (!config?.appId || !config?.appSecret) {
    throw new Error('QQ AppID or AppSecret is not configured')
  }

  const { scope, targetId, messageId } = message.channel.address
  if (!targetId) throw new Error('Missing QQ message target')

  const token = await getAccessToken(config.appId, config.appSecret)

  const sendOnce = async (withMsgId: boolean): Promise<Response> => {
    let url = ''
    let body: Record<string, unknown> = {}
    const msgSeq = getNextMsgSeq()

    if (scope === 'c2c') {
      url = `https://api.sgroup.qq.com/v2/users/${targetId}/messages`
      body = config.markdownSupport
        ? { markdown: { content: message.text }, msg_type: 2, msg_seq: msgSeq, ...(withMsgId && messageId ? { msg_id: messageId } : {}) }
        : { content: message.text, msg_type: 0, msg_seq: msgSeq, ...(withMsgId && messageId ? { msg_id: messageId } : {}) }
    } else if (scope === 'guild') {
      url = `https://api.sgroup.qq.com/channels/${targetId}/messages`
      body = { content: message.text, ...(withMsgId && messageId ? { msg_id: messageId } : {}) }
    } else if (scope === 'dm') {
      url = `https://api.sgroup.qq.com/dms/${targetId}/messages`
      body = { content: message.text, ...(withMsgId && messageId ? { msg_id: messageId } : {}) }
    } else {
      // Default: Group message
      url = `https://api.sgroup.qq.com/v2/groups/${targetId}/messages`
      body = config.markdownSupport
        ? { markdown: { content: message.text }, msg_type: 2, msg_seq: msgSeq, ...(withMsgId && messageId ? { msg_id: messageId } : {}) }
        : { content: message.text, msg_type: 0, msg_seq: msgSeq, ...(withMsgId && messageId ? { msg_id: messageId } : {}) }
    }

    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `QQBot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  let res = await sendOnce(Boolean(messageId))

  if (!res.ok) {
    const errorText = await res.text().catch(() => '')

    // If passive reply fails with expired msg_id (e.g. task took > 5 minutes), retry once as proactive message
    if (messageId && (errorText.includes('msg_id') || res.status === 400 || res.status === 404)) {
      const retryRes = await sendOnce(false)
      if (retryRes.ok) return 'sent'
    }

    if (res.status === 404 || res.status === 410) return 'gone'

    try {
      const errJson = JSON.parse(errorText)
      if (errJson.code === 304023 || errJson.code === 304024 || errJson.code === 10004) {
        return 'gone'
      }
    } catch {}

    throw new Error(`QQ API send failed HTTP ${res.status}: ${errorText}`)
  }

  return 'sent'
}

/** Constructs deep link for QQ channel */
export const qqLink = (address: Record<string, string>, _links: ChannelLinks): ChannelLink => ({
  url: 'https://q.qq.com/',
  label: {
    zh: address.scope === 'group' ? 'QQ 群' : address.scope === 'c2c' ? 'QQ 私聊' : 'QQ 频道',
    en: address.scope === 'group' ? 'QQ Group' : address.scope === 'c2c' ? 'QQ Direct' : 'QQ Guild',
  },
  triggerId: address.messageId ? qqTriggerId(address.messageId) : undefined,
})
