import { describe, expect, it } from 'vitest'
import { parseMdnsServices } from '../src/wireless.js'

describe('parseMdnsServices', () => {
  it('解析新版版式(- 前缀,connect+pairing)', () => {
    const out = [
      'adb MDNS backend launched',
      'Automatically detected services: ',
      '- adb-tls-connect._tcp        192.168.1.5:43505       47c14a1d._adb-tls-connect._tcp',
      '- adb-tls-pairing._tcp        192.168.1.5:38721       47c14a1d._adb-tls-pairing._tcp',
      '',
    ].join('\n')
    const list = parseMdnsServices(out)
    expect(list).toHaveLength(2)
    // connect 排前
    expect(list[0]).toEqual({
      kind: 'connect',
      host: '192.168.1.5',
      port: 43505,
      instance: '47c14a1d._adb-tls-connect._tcp',
    })
    expect(list[1]).toMatchObject({ kind: 'pairing', port: 38721 })
  })

  it('解析旧版版式(无 - 前缀,仅 connect)', () => {
    const out = [
      'List of discovered mdns services:',
      'adb-tls-connect._tcp\t192.168.2.8:5555\t9f2b._adb-tls-connect._tcp',
    ].join('\n')
    const list = parseMdnsServices(out)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ kind: 'connect', host: '192.168.2.8', port: 5555 })
  })

  it('CRLF 与多余空白兼容', () => {
    const out = '-  adb-tls-connect._tcp   \t 10.0.0.3:40123  \t abc._adb-tls-connect._tcp \r\n'
    const list = parseMdnsServices(out)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ host: '10.0.0.3', port: 40123 })
  })

  it('无服务/后端未启动输出解析为空', () => {
    expect(parseMdnsServices('')).toHaveLength(0)
    expect(parseMdnsServices('mdns discovery disabled')).toHaveLength(0)
    expect(
      parseMdnsServices('adb MDNS backend launched\nAutomatically detected services: '),
    ).toHaveLength(0)
  })

  it('去重与排序(connect 优先)', () => {
    const out = [
      '- adb-tls-pairing._tcp  192.168.1.7:30001  x._adb-tls-pairing._tcp',
      '- adb-tls-pairing._tcp  192.168.1.7:30001  x._adb-tls-pairing._tcp',
      '- adb-tls-connect._tcp  192.168.1.7:30002  x._adb-tls-connect._tcp',
    ].join('\n')
    const list = parseMdnsServices(out)
    expect(list).toHaveLength(2)
    expect(list[0]?.kind).toBe('connect')
    expect(list[1]?.kind).toBe('pairing')
  })

  it('实例名缺失时生成占位实例名', () => {
    const out = '- adb-tls-connect._tcp  172.20.10.2:37777'
    const list = parseMdnsServices(out)
    expect(list).toHaveLength(1)
    expect(list[0]?.instance).toContain('172.20.10.2')
    expect(list[0]?.instance).toContain('_adb-tls-connect._tcp')
  })

  it('忽略非 adb-tls 行(如 googlecast 等无关 mdns 服务)', () => {
    const out = [
      '- _googlecast._tcp        192.168.1.9:8009       Chromecast._googlecast._tcp',
      '- adb-tls-connect._tcp    192.168.1.9:41999     d1._adb-tls-connect._tcp',
    ].join('\n')
    const list = parseMdnsServices(out)
    expect(list).toHaveLength(1)
    expect(list[0]?.host).toBe('192.168.1.9')
  })
})
