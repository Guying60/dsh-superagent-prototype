/** Normalizes official QQ Open Platform bot webhook messages and events into domain Triggers. */
import { key, type ChannelRef, type Trigger } from '../core/index.ts'

export const SOURCE = 'qq'

/** Constructs a QQ reply channel address */
export const qqChannel = (scope: string, targetId: string, messageId: string): ChannelRef => ({
  source: SOURCE,
  thread: `qq:${scope}:${targetId}`,
  address: { scope, targetId, messageId },
})

export const qqTriggerId = (messageId: string): string => key('qq', messageId)

export function qqTime(value?: string | number): string {
  if (!value) return new Date().toISOString()
  if (typeof value === 'number') {
    const time = value < 1e12 ? value * 1000 : value
    return new Date(time).toISOString()
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString()
}

/** Cleans mention tags like <@!123456> or @botName from text */
function cleanMention(content: string, appId?: string): string {
  let text = content
  text = text.replace(/<@!\d+>/g, '')
  if (appId) {
    text = text.replace(new RegExp(`<@!${appId}>`, 'g'), '')
    text = text.replace(new RegExp(`@${appId}`, 'g'), '')
  }
  return text.trim()
}

interface InboundAttachment {
  content_type?: string
  url?: string
}

interface InboundAuthor {
  id?: string
  member_openid?: string
  user_openid?: string
  username?: string
  bot?: boolean
}

interface InboundEventData {
  id?: string
  content?: string
  timestamp?: string
  group_openid?: string
  channel_id?: string
  guild_id?: string
  author?: InboundAuthor
  attachments?: InboundAttachment[]
  message_reference?: { message_id?: string }
}

interface InboundEventEnvelope {
  id?: string
  op?: number
  s?: number
  t?: string
  d?: InboundEventData
}

/**
 * Parses incoming official QQ Open Platform webhook event payload into standard Trigger.
 * Supports:
 * - GROUP_AT_MESSAGE_CREATE / GROUP_MESSAGE_CREATE (QQ group)
 * - C2C_MESSAGE_CREATE (QQ direct chat)
 * - AT_MESSAGE_CREATE (Guild text channel)
 * - DIRECT_MESSAGE_CREATE (Guild direct message)
 */
export function qqTrigger(input: unknown, botAppId?: string): Trigger | undefined {
  if (!input || typeof input !== 'object') return undefined
  const envelope = input as InboundEventEnvelope
  const eventType = envelope.t ?? ''
  const d = envelope.d
  if (!d || !d.id) return undefined

  // Ignore bot own echoes
  if (d.author?.bot) return undefined

  let content = cleanMention(d.content || '', botAppId)
  if (!content && d.attachments?.length) {
    content = d.attachments.map(att => att.url).filter(Boolean).join(' ')
  }

  const atTime = qqTime(d.timestamp)
  const replyMessageId = d.message_reference?.message_id

  // 1. Group message
  if (eventType === 'GROUP_AT_MESSAGE_CREATE' || eventType === 'GROUP_MESSAGE_CREATE') {
    const groupId = d.group_openid
    if (!groupId) return undefined
    const userId = d.author?.member_openid || d.author?.id || 'unknown'
    const isAt = eventType === 'GROUP_AT_MESSAGE_CREATE' || (d.content ? d.content.includes('<@!') : false)

    return {
      id: qqTriggerId(d.id),
      source: SOURCE,
      threads: [{ source: SOURCE, id: `group:${groupId}` }],
      actor: { source: SOURCE, id: userId },
      human: true,
      ...(isAt ? { addressed: 'mention' as const } : {}),
      at: atTime,
      text: content,
      channel: qqChannel('group', groupId, d.id),
      meta: {
        scope: 'group',
        groupId,
        targetId: groupId,
        userId,
        messageId: d.id,
        mentioned: isAt,
        ...(replyMessageId ? { replyMessageId } : {}),
      },
    }
  }

  // 2. C2C (Private / Direct) message
  if (eventType === 'C2C_MESSAGE_CREATE') {
    const userId = d.author?.user_openid || d.author?.id
    if (!userId) return undefined

    return {
      id: qqTriggerId(d.id),
      source: SOURCE,
      threads: [{ source: SOURCE, id: `c2c:${userId}` }],
      actor: { source: SOURCE, id: userId },
      human: true,
      addressed: 'direct' as const,
      at: atTime,
      text: content,
      channel: qqChannel('c2c', userId, d.id),
      meta: {
        scope: 'c2c',
        direct: true,
        targetId: userId,
        userId,
        messageId: d.id,
        mentioned: true,
        ...(replyMessageId ? { replyMessageId } : {}),
      },
    }
  }

  // 3. Guild channel message
  if (eventType === 'AT_MESSAGE_CREATE') {
    const channelId = d.channel_id
    if (!channelId) return undefined
    const userId = d.author?.id || 'unknown'

    return {
      id: qqTriggerId(d.id),
      source: SOURCE,
      threads: [{ source: SOURCE, id: `channel:${channelId}` }],
      actor: { source: SOURCE, id: userId },
      human: true,
      addressed: 'mention' as const,
      at: atTime,
      text: content,
      channel: qqChannel('guild', channelId, d.id),
      meta: {
        scope: 'guild',
        channelId,
        guildId: d.guild_id,
        targetId: channelId,
        userId,
        messageId: d.id,
        mentioned: true,
        ...(replyMessageId ? { replyMessageId } : {}),
      },
    }
  }

  // 4. Guild DM message
  if (eventType === 'DIRECT_MESSAGE_CREATE') {
    const guildId = d.guild_id
    if (!guildId) return undefined
    const userId = d.author?.id || 'unknown'

    return {
      id: qqTriggerId(d.id),
      source: SOURCE,
      threads: [{ source: SOURCE, id: `dm:${guildId}` }],
      actor: { source: SOURCE, id: userId },
      human: true,
      addressed: 'direct' as const,
      at: atTime,
      text: content,
      channel: qqChannel('dm', guildId, d.id),
      meta: {
        scope: 'dm',
        direct: true,
        guildId,
        targetId: guildId,
        userId,
        messageId: d.id,
        mentioned: true,
        ...(replyMessageId ? { replyMessageId } : {}),
      },
    }
  }

  return undefined
}
