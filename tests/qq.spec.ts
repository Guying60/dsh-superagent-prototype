import { describe, expect, it } from 'vitest'
import * as crypto from 'node:crypto'
import { qqTrigger, qqTriggerId } from '../src/sources/qq-trigger.ts'
import { qqKind, type QQConfig } from '../src/sources/qq.ts'
import { ed25519Sign, verifyWebhookSignature } from '../src/sources/qq-channel.ts'

describe('QQ Official Webhook Source', () => {
  it('parses GROUP_AT_MESSAGE_CREATE into trigger', () => {
    const payload = {
      id: 'event_001',
      op: 0,
      t: 'GROUP_AT_MESSAGE_CREATE',
      d: {
        id: 'msg_1001',
        content: '<@!1024> 帮我写一个测试',
        timestamp: '2026-11-03T15:00:00+08:00',
        group_openid: 'GROUP_OPENID_AAA',
        author: {
          id: 'USER_OPENID_BBB',
          member_openid: 'USER_OPENID_BBB',
        },
      },
    }

    const trigger = qqTrigger(payload, '1024')
    expect(trigger).toBeDefined()
    expect(trigger?.id).toBe(qqTriggerId('msg_1001'))
    expect(trigger?.source).toBe('qq')
    expect(trigger?.actor).toEqual({ source: 'qq', id: 'USER_OPENID_BBB' })
    expect(trigger?.addressed).toBe('mention')
    expect(trigger?.text).toBe('帮我写一个测试')
    expect(trigger?.channel?.thread).toBe('qq:group:GROUP_OPENID_AAA')
    expect(trigger?.channel?.address).toEqual({
      scope: 'group',
      targetId: 'GROUP_OPENID_AAA',
      messageId: 'msg_1001',
    })
    expect(trigger?.meta).toMatchObject({
      scope: 'group',
      groupId: 'GROUP_OPENID_AAA',
      mentioned: true,
    })
  })

  it('parses C2C_MESSAGE_CREATE into direct trigger', () => {
    const payload = {
      id: 'event_002',
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: {
        id: 'msg_2001',
        content: '私聊测试内容',
        timestamp: '2026-11-03T15:05:00+08:00',
        author: {
          user_openid: 'USER_OPENID_CCC',
        },
      },
    }

    const trigger = qqTrigger(payload)
    expect(trigger).toBeDefined()
    expect(trigger?.id).toBe(qqTriggerId('msg_2001'))
    expect(trigger?.addressed).toBe('direct')
    expect(trigger?.text).toBe('私聊测试内容')
    expect(trigger?.channel?.thread).toBe('qq:c2c:USER_OPENID_CCC')
    expect(trigger?.meta).toMatchObject({
      scope: 'c2c',
      direct: true,
      targetId: 'USER_OPENID_CCC',
    })
  })

  it('filters scope according to QQ config', () => {
    const config: QQConfig = {
      appId: '123456',
      appSecret: 'secret_abc',
      directMessages: true,
      otherGroups: 'mentions',
      listenGroups: [
        { openid: 'GROUP_CUSTOM', name: '研发群', listen: 'all' },
      ],
      markdownSupport: false,
    }

    // Direct C2C
    const c2cScope = qqKind.scope!({ meta: { scope: 'c2c', direct: true } }, config)
    expect(c2cScope).toEqual({ listened: true, observed: false, row: 'direct' })

    // Listed group with 'all'
    const customGroupScope = qqKind.scope!({ meta: { scope: 'group', groupId: 'GROUP_CUSTOM' } }, config)
    expect(customGroupScope).toEqual({ listened: true, observed: true, row: 'GROUP_CUSTOM' })

    // Unlisted group with 'mentions'
    const otherGroupScope = qqKind.scope!({ meta: { scope: 'group', groupId: 'GROUP_OTHER' } }, config)
    expect(otherGroupScope).toEqual({ listened: true, observed: false, row: 'other' })
  })

  it('validates Ed25519 signature algorithm', () => {
    const botSecret = 'test_app_secret_99999'
    let seed = botSecret
    while (seed.length < 32) seed += seed
    const seedBuffer = Buffer.from(seed.slice(0, 32), 'utf-8')

    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from('302e020100300506032b657004220420', 'hex'),
        seedBuffer,
      ]),
      format: 'der',
      type: 'pkcs8',
    })
    const publicKey = crypto.createPublicKey(privateKey)

    // Simulate validation request (op: 13)
    const eventTs = '1725442341'
    const plainToken = 'Arq0D5A61EgUu4OxUvOp'
    const validationMessage = Buffer.from(eventTs + plainToken, 'utf-8')
    const sig = crypto.sign(null, validationMessage, privateKey)
    expect(sig.length).toBe(64) // 64 bytes for Ed25519 signature
    expect(crypto.verify(null, validationMessage, publicKey, sig)).toBe(true)

    // Test exported ed25519Sign & verifyWebhookSignature
    const generatedSig = ed25519Sign(botSecret, validationMessage)
    expect(generatedSig).toBe(sig.toString('hex'))

    const valid = verifyWebhookSignature({
      body: Buffer.from(plainToken, 'utf-8'),
      timestamp: eventTs,
      signature: generatedSig,
      botSecret,
    })
    expect(valid).toBe(true)
  })
})
