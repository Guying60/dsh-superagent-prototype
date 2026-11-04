/** Normalizes WeCom/WeChat webhook messages and events into domain Triggers. */
import { z } from 'zod'
import { key, type ChannelRef, type Trigger } from '../core/index.ts'

export const SOURCE = 'wechat'

/** Constructs a WeChat reply channel address */
export const wechatChannel = (chatId: string, messageId: string): ChannelRef => ({
  source: SOURCE,
  thread: `wechat:${chatId}`,
  address: { chatId, messageId },
})

/** Message schema received from WeCom Webhook / Gateway callback */
const EventSchema = z.object({
  msg_id: z.string(),
  chat_id: z.string().default('default'),
  from_user: z.string(),
  user_name: z.string().optional(),
  msg_type: z.enum(['text', 'markdown']).default('text'),
  content: z.string(),
  create_time: z.string().or(z.number()),
  is_mentioned: z.boolean().default(false),
})

export type WechatEvent = z.infer<typeof EventSchema>

/** Deterministic trigger ID for an incoming message */
export const wechatTriggerId = (msgId: string): string => key('wechat', msgId)

export function wechatTime(value: string | number): string {
  const time = typeof value === 'number' ? value * 1000 : /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value)
  return new Date(time).toISOString()
}

/** Converts incoming WeChat payload into standard Trigger */
export function wechatTrigger(input: unknown, botName: string): Trigger | undefined {
  const event = EventSchema.parse(input)
  if (event.from_user === botName) return undefined

  const threadId = `${event.chat_id}:root`
  const mentioned = event.is_mentioned || event.content.includes(`@${botName}`)

  return {
    id: wechatTriggerId(event.msg_id),
    source: SOURCE,
    threads: [{ source: SOURCE, id: threadId }],
    actor: { source: SOURCE, id: event.from_user },
    human: true,
    ...(mentioned ? { addressed: 'mention' as const } : {}),
    at: wechatTime(event.create_time),
    text: event.content,
    channel: wechatChannel(event.chat_id, event.msg_id),
    meta: {
      chatId: event.chat_id,
      messageId: event.msg_id,
      fromUser: event.from_user,
      mentioned,
    },
  }
}
