/** WeChat / WeCom source kind definition, webhook receiver, and Cordis plugin entry. */
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { SOURCE, wechatTrigger, wechatTriggerId } from './wechat-trigger.ts'
import { sourceContext, type SourceHost } from './host.ts'
import type { SourceKind } from './kind.ts'
import type { OutboundMessage } from '../core/index.ts'

export { SOURCE, wechatTrigger, wechatTriggerId } from './wechat-trigger.ts'

const WechatConfigSchema = z.object({
  webhookUrl: z.string().default(''),
  botName: z.string().default('Agent'),
  listenAll: z.boolean().default(false),
}).strict()

export type WechatConfig = z.infer<typeof WechatConfigSchema>

async function sendWechat(host: any, message: OutboundMessage): Promise<'sent' | 'gone'> {
  const config = host.config?.(SOURCE) as WechatConfig | undefined
  if (!config?.webhookUrl) throw new Error('WeChat webhook URL is not configured')

  const response = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: { content: message.text },
    }),
  })

  if (!response.ok) {
    if (response.status === 404 || response.status === 410) return 'gone'
    throw new Error(`WeChat send failed with status ${response.status}`)
  }
  return 'sent'
}

export const wechatKind: SourceKind<WechatConfig> = {
  kind: SOURCE,
  title: { zh: '微信 / 企业微信', en: 'WeChat / WeCom' },
  description: {
    zh: '接收来自微信/企业微信群机器人的指令，并将研发进展和 PR 结果实时同步到群聊中。',
    en: 'Receives instructions from WeChat/WeCom group bot and pushes PR and task updates back.',
  },
  schema: WechatConfigSchema,
  fields: [
    {
      key: 'webhookUrl',
      type: 'text',
      label: { zh: '群机器人 Webhook 地址', en: 'Bot Webhook URL' },
      hint: {
        zh: '企业微信群中添加机器人后获得的 Webhook URL（包含 key）。',
        en: 'The WeCom Bot Webhook URL with key.',
      },
    },
    {
      key: 'botName',
      type: 'text',
      label: { zh: '机器人名称', en: 'Bot Name' },
      hint: { zh: '群里识别被 @ 的机器人名称，例如 Agent。', en: 'Bot name used to match mentions, e.g. Agent.' },
    },
    {
      key: 'listenAll',
      type: 'switch',
      label: { zh: '接收群内所有消息', en: 'Receive all messages' },
      hint: {
        zh: '默认仅处理明确 @ 机器人的消息；开启后将接收所有消息进行主动研发意图研判。',
        en: 'Default only handles @bot mentions. When enabled, all messages will be evaluated.',
      },
    },
  ],
  health: ['wechat'],
  scope({ meta }, config) {
    if (meta.mentioned || config.listenAll) {
      return { listened: true, observed: config.listenAll, row: 'group' }
    }
    return { listened: false, reason: 'not_mentioned' }
  },
  channel: {
    allowed: (_address, config) => Boolean(config.webhookUrl),
    send: sendWechat,
    link: address => ({
      url: 'https://work.weixin.qq.com/',
      label: { zh: '微信群聊', en: 'WeChat Group' },
      triggerId: address.messageId ? wechatTriggerId(address.messageId) : undefined,
    }),
  },
  policy: {
    unnamed: { person: { zh: '微信用户', en: 'WeChat User' }, bot: { zh: '微信机器人', en: 'WeChat Bot' } },
    schema: z.object({
      allowed: z.array(z.object({ id: z.string(), name: z.string().optional() }).strict()).default([]),
    }).strict(),
    fields: [
      {
        key: 'allowed',
        type: 'rows',
        label: { zh: '允许发起工作的微信号 / 用户 ID', en: 'Allowed WeChat users' },
        columns: [
          { key: 'id', type: 'text', label: { zh: '用户 ID / 微信号', en: 'User ID' } },
          { key: 'name', type: 'text', label: { zh: '姓名 / 备注', en: 'Name' }, optional: true },
        ],
      },
    ],
    explicit: {
      zh: '白名单内的成员 @ 机器人发出的需求，会被自动识别为明确的研发请求。',
      en: 'Mentions from allowed members will be directly treated as explicit requests.',
    },
    rows(stored) {
      const config = WechatConfigSchema.parse(stored)
      return [
        {
          id: 'group',
          label: { zh: '微信群消息', en: 'Group messages' },
          note: config.listenAll ? { zh: '全部消息', en: 'All' } : { zh: '仅 @', en: '@ only' },
          cells: { listedUnaddressed: config.listenAll, unlistedAddressed: true, unlistedUnaddressed: config.listenAll },
        },
      ]
    },
  },
}

export const name = 'dsh-superagent-wechat'
export const inject = ['orchestrator', 'webServer']

export function apply(ctx: Context): void {
  const orchestrator = ctx.get('orchestrator') as SourceHost
  const source = sourceContext(orchestrator, wechatKind)
  const unregisterKind = orchestrator.sources.register(wechatKind)
  ctx.effect(() => () => unregisterKind())

  const unregisterHttp = ctx.webServer.register({
    kind: 'prefix',
    path: '/orchestrator/api/wechat',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }

      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        try {
          const payload = JSON.parse(body)
          const config = orchestrator.sources.instance(SOURCE)?.config as WechatConfig | undefined
          const trigger = wechatTrigger(payload, config?.botName || 'Agent')

          if (trigger) {
            source.receive(trigger)
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'ok' }))
        } catch (err: any) {
          res.writeHead(400).end(err?.message || 'Invalid payload')
        }
      })
    },
  })
  ctx.effect(() => () => unregisterHttp())

  source.report('wechat', { state: 'ready', detail: 'WeChat source ready' })
}
