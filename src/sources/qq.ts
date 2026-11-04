/** QQ (Official Bot / QQ Open Platform Webhook) source kind definition and plugin entry. */
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { ed25519Sign, qqLink, sendQQ, setActiveContext, verifyWebhookSignature, type QQConfig } from './qq-channel.ts'
import { SOURCE, qqTrigger, qqTriggerId } from './qq-trigger.ts'
import { sourceContext, type SourceHost } from './host.ts'
import type { SourceKind } from './kind.ts'

export { SOURCE, qqTrigger, qqTriggerId } from './qq-trigger.ts'
export type { QQConfig } from './qq-channel.ts'

const QQConfigSchema = z.object({
  appId: z.string().trim().default(''),                     // QQ 开放平台机器人 AppID
  appSecret: z.string().trim().default(''),                 // 机器人 AppSecret (用于 Ed25519 签名验证和 API Token)
  directMessages: z.boolean().default(true),                // 是否接收单聊私聊消息
  otherGroups: z.enum(['none', 'mentions', 'all']).default('mentions'), // 其他未单独列出的群
  listenGroups: z.array(z.object({
    openid: z.string().trim(),                              // 群 openid (group_openid)
    name: z.string().trim().max(60).optional(),             // 备注群名
    listen: z.enum(['mentions', 'all']).default('mentions'),
  }).strict()).default([]),
  markdownSupport: z.boolean().default(false),              // 是否开启 Markdown 格式发送（需在开放平台申请 Markdown 权限）
}).strict()

export const qqKind: SourceKind<QQConfig> = {
  kind: SOURCE,
  title: { zh: 'QQ 官方机器人', en: 'QQ Official Bot' },
  description: {
    zh: '接入 QQ 开放平台官方机器人 Webhook（支持群聊 @ 机器人、私聊 C2C 消息），自动派工执行与回传结果。在开放平台配置回调地址为 /api/webhook/qq（或 /orchestrator/api/qq）。',
    en: 'Connects to official QQ Open Platform Bot Webhook for group @mentions and C2C private messages. Configure callback URL as /api/webhook/qq (or /orchestrator/api/qq).',
  },
  schema: QQConfigSchema,
  fields: [
    {
      key: 'appId',
      type: 'text',
      label: { zh: '机器人 AppID', en: 'Bot AppID' },
      hint: {
        zh: 'QQ 开放平台（q.qq.com）创建机器人后分配的 AppID。',
        en: 'The Bot AppID assigned by QQ Open Platform (q.qq.com).',
      },
    },
    {
      key: 'appSecret',
      type: 'text',
      label: { zh: '机器人 AppSecret', en: 'Bot AppSecret' },
      hint: {
        zh: 'QQ 开放平台机器人 AppSecret，用于 Webhook 的 Ed25519 签名验签与 OpenAPI 访问凭证生成。',
        en: 'The Bot AppSecret used for Ed25519 signature verification and OpenAPI access token.',
      },
    },
    {
      key: 'directMessages',
      type: 'switch',
      label: { zh: '接收私聊（C2C）', en: 'Direct messages' },
      hint: { zh: '开启后接收 QQ 单聊私聊发来的研发需求。', en: 'Allow authorized users to initiate tasks in direct chat.' },
    },
    {
      key: 'otherGroups',
      type: 'select',
      label: { zh: '群聊接收模式', en: 'Group messages mode' },
      hint: {
        zh: '“仅 @”只接收群里 @ 机器人的消息；“全部消息”接收群内所有消息用于自主研判；“不接收”忽略未单独配置的群。',
        en: '"@ only" receives @ mentions; "All" receives all messages; "Not received" ignores other groups.',
      },
      options: [
        { value: 'mentions', label: { zh: '仅 @', en: '@ only' } },
        { value: 'all', label: { zh: '全部消息', en: 'All' } },
        { value: 'none', label: { zh: '不接收', en: 'Not received' } },
      ],
    },
    {
      key: 'listenGroups',
      type: 'rows',
      advanced: true,
      label: { zh: '指定群配置（可选）', en: 'Configured Groups (Optional)' },
      hint: {
        zh: '可选为指定群配置独立的接收模式与群名称备注。群 ID 为开放平台的 group_openid。',
        en: 'Optionally configure mode and alias for specific group_openids.',
      },
      columns: [
        { key: 'openid', type: 'text', label: { zh: '群 openid', en: 'Group openid' } },
        { key: 'name', type: 'text', label: { zh: '群名称备注', en: 'Group Name' }, optional: true },
        {
          key: 'listen',
          type: 'select',
          label: { zh: '监听模式', en: 'Mode' },
          options: [
            { value: 'mentions', label: { zh: '仅 @', en: '@ only' } },
            { value: 'all', label: { zh: '全部消息', en: 'All' } },
          ],
        },
      ],
    },
    {
      key: 'markdownSupport',
      type: 'switch',
      advanced: true,
      label: { zh: '启用 Markdown 消息回复', en: 'Enable Markdown replies' },
      hint: {
        zh: '需机器人已在开放平台通过 Markdown 模版/权限审核；未开启时采用纯文本发送。',
        en: 'Requires Markdown permission in QQ Open Platform; defaults to plain text.',
      },
    },
  ],
  health: ['qq'],
  scope({ meta }, config) {
    if (meta.direct === true || meta.scope === 'c2c' || meta.scope === 'dm') {
      return config.directMessages
        ? { listened: true, observed: false, row: 'direct' }
        : { listened: false, reason: 'direct_not_allowed' }
    }
    const groupId = String(meta.groupId || meta.targetId || '')
    const group = config.listenGroups?.find(g => g.openid === groupId)
    if (group) {
      return { listened: true, observed: group.listen === 'all', row: group.openid }
    }
    if (config.otherGroups === 'mentions') {
      return { listened: true, observed: false, row: 'other' }
    }
    if (config.otherGroups === 'all') {
      return { listened: true, observed: true, row: 'other' }
    }
    return { listened: false, reason: 'group_not_listened' }
  },
  channel: {
    allowed: (address, config) => {
      const isDirect = address.scope === 'c2c' || address.scope === 'dm'
      return qqKind.scope!({ meta: { scope: address.scope, groupId: address.targetId, direct: isDirect } }, config).listened
    },
    send: sendQQ,
    link: qqLink,
  },
  repliesTo: trigger => typeof trigger.meta.replyMessageId === 'string' ? qqTriggerId(trigger.meta.replyMessageId) : undefined,
  policy: {
    unnamed: { person: { zh: 'QQ 用户', en: 'QQ user' }, bot: { zh: 'QQ 机器人', en: 'QQ bot' } },
    schema: z.object({
      allowed: z.array(z.object({ id: z.string().trim(), name: z.string().trim().max(100).optional() }).strict())
        .refine(users => new Set(users.map(u => u.id)).size === users.length, 'Duplicate user openids').default([]),
    }).strict(),
    fields: [
      {
        key: 'allowed',
        type: 'rows',
        label: { zh: '能发起工作的 QQ 用户（openid 白名单）', en: 'Allowed QQ users (openid whitelist)' },
        hint: {
          zh: '填入用户的 openid（或 member_openid）。白名单内的成员发出的需求会被识别为明确请求。',
          en: 'Enter user openid or member_openid. Requests from listed users are accepted as explicit requests.',
        },
        columns: [
          { key: 'id', type: 'text', label: { zh: '用户 openid', en: 'User openid' } },
          { key: 'name', type: 'text', label: { zh: '备注 / 昵称', en: 'Nickname' }, optional: true },
        ],
      },
    ],
    explicit: {
      zh: '名单内的用户 @ 机器人或私聊发出的需求，会被自动识别为明确的工单请求。',
      en: 'Requests from listed users mentioning the bot or via direct messages are treated as explicit requests.',
    },
    rows(stored) {
      const config = QQConfigSchema.parse(stored)
      const mentions = { zh: '仅 @', en: '@ only' }
      const rows = (config.listenGroups ?? []).map(group => ({
        id: group.openid,
        label: group.name || group.openid,
        note: group.listen === 'all' ? { zh: '全部消息', en: 'All' } : mentions,
        cells: {
          listedUnaddressed: group.listen === 'all',
          unlistedAddressed: true,
          unlistedUnaddressed: group.listen === 'all',
        },
      }))

      return [
        ...rows,
        {
          id: 'other',
          label: { zh: '其他群', en: 'Other groups' },
          note: config.otherGroups === 'all' ? { zh: '全部消息', en: 'All' } : config.otherGroups === 'mentions' ? mentions : { zh: '不接收', en: 'Not received' },
          cells: {
            listedUnaddressed: config.otherGroups === 'all',
            unlistedAddressed: config.otherGroups !== 'none',
            unlistedUnaddressed: config.otherGroups === 'all',
          },
        },
        {
          id: 'direct',
          label: { zh: '私聊（C2C）', en: 'Direct messages' },
          note: config.directMessages ? { zh: '接收', en: 'Received' } : { zh: '不接收', en: 'Not received' },
          cells: { listedUnaddressed: false, unlistedAddressed: config.directMessages, unlistedUnaddressed: false },
        },
      ]
    },
  },
  environment: {
    variables: [
      { key: 'DSH_SUPERAGENT_QQ_BOT', description: { zh: 'QQ 机器人 AppID', en: 'The QQ Bot AppID' } },
      { key: 'DSH_SUPERAGENT_QQ_TARGET', description: { zh: '接下工单的 QQ 群或用户 openid；工单不是从 QQ 来的时为空', en: 'The QQ group or user openid that started the ticket' } },
    ],
    values: ({ trigger }) => ({
      DSH_SUPERAGENT_QQ_BOT: trigger?.source === SOURCE ? String(trigger.meta.botAppId ?? '') : '',
      DSH_SUPERAGENT_QQ_TARGET: trigger?.source === SOURCE ? String(trigger.meta.targetId ?? trigger.meta.groupId ?? '') : '',
    }),
  },
}

export const name = 'dsh-superagent-qq'
export const inject = ['orchestrator', 'webServer']

/** Cordis plugin entry: mounts QQ Open Platform Webhook handler */
export function apply(ctx: Context): void {
  const orchestrator = ctx.get('orchestrator') as SourceHost
  const source = sourceContext(orchestrator, qqKind)
  setActiveContext(source)

  const unregisterKind = orchestrator.sources.register(qqKind)
  ctx.effect(() => () => {
    setActiveContext(undefined)
    unregisterKind()
  })

  // Mount official webhook handler at /api/webhook/qq and /orchestrator/api/qq
  const handleWebhook: (req: any, res: any) => Promise<void> = async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }

    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer | string) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) })
    req.on('end', () => {
      try {
        const rawBody = Buffer.concat(chunks)
        const payload = JSON.parse(rawBody.toString('utf-8'))
        const config = orchestrator.sources.instance(SOURCE)?.config as QQConfig | undefined

        // 1. op: 13 — Callback URL Validation (QQ Open Platform console verification)
        if (payload.op === 13) {
          const d = payload.d as { plain_token?: string; event_ts?: string } | undefined
          if (!d?.plain_token || !d?.event_ts) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing plain_token or event_ts' }))
            return
          }

          if (!config?.appSecret) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'QQ AppSecret is not configured in superagent settings' }))
            return
          }

          // Sign event_ts + plain_token using Ed25519
          const message = Buffer.from(d.event_ts + d.plain_token, 'utf-8')
          const signature = ed25519Sign(config.appSecret, message)

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ plain_token: d.plain_token, signature }))
          return
        }

        // 2. Signature verification for event callbacks
        const timestamp = (req.headers['x-signature-timestamp'] as string) || ''
        const signature = (req.headers['x-signature-ed25519'] as string) || ''

        if (config?.appSecret) {
          const valid = verifyWebhookSignature({
            body: rawBody,
            timestamp,
            signature,
            botSecret: config.appSecret,
          })

          if (!valid) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid Ed25519 signature' }))
            return
          }
        }

        // 3. OpCode 0: Event dispatch — respond immediately with ACK (op: 12)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ op: 12, d: 0 }))

        // Ingest trigger asynchronously into engine
        if (payload.op === 0) {
          const trigger = qqTrigger(payload, config?.appId)
          if (trigger) {
            Promise.resolve(source.receive(trigger)).catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err)
              source.report('qq', { state: 'error', detail: `QQ 消息摄入失败: ${msg}` })
            })
          }
        }
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err?.message || 'Invalid payload' }))
      }
    })
  }

  const unregisterHttp1 = ctx.webServer.register({
    kind: 'prefix',
    path: '/api/webhook/qq',
    handler: handleWebhook,
  })
  const unregisterHttp2 = ctx.webServer.register({
    kind: 'prefix',
    path: '/orchestrator/api/qq',
    handler: handleWebhook,
  })
  ctx.effect(() => () => {
    unregisterHttp1()
    unregisterHttp2()
  })

  const config = orchestrator.sources.instance(SOURCE)?.config as QQConfig | undefined
  if (config?.appId && config?.appSecret) {
    source.report('qq', { state: 'ready', detail: 'QQ 官方机器人 Webhook 就绪' })
  } else {
    source.report('qq', { state: 'paused', detail: '等待配置 QQ 机器人 AppID 与 AppSecret' })
  }
}
