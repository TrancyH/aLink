import { execOut, pairWireless, connectWireless, enableTcpip, mdnsServices, type MdnsServiceInfo } from '@amoolink/adb'
import { deviceService } from './device-service'

/** 无线连接服务:经典 tcpip 5555、Android 11+ 无线调试配对、mDNS 发现。 */
class WirelessService {
  /** 经典模式:USB 在线设备切 tcpip,返回设备 IP(从 wifi 网关推断本机网段?用 ip addr wlan0)。 */
  async enableWifi(serial: string): Promise<{ ip: string; port: number }> {
    const client = await deviceService.getDeviceClient(serial)
    if (!client) throw new Error('设备不可用(需先用 USB 连接)')
    const ipOut = await execOut(client, 'ip addr show wlan0')
    const ip = /inet (\d+\.\d+\.\d+\.\d+)/.exec(ipOut)?.[1]
    if (!ip) throw new Error('手机未连接 Wi-Fi(拿不到 wlan0 地址)')
    await enableTcpip(serial)
    const port = 5555
    // 等设备在 5555 就绪后连接
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 800))
      const out = await connectWireless(ip, port).catch(() => '')
      if (/connected to/i.test(out)) return { ip, port }
    }
    throw new Error(`无法连接 ${ip}:${port}`)
  }

  /** Android 11+ 无线调试配对(手机端「无线调试 → 使用配对码」)。 */
  async pair(host: string, port: number, code: string): Promise<string> {
    if (!/^\d{6}$/.test(code)) throw new Error('配对码应为 6 位数字')
    return await pairWireless(host, port, code)
  }

  async connect(host: string, port: number): Promise<string> {
    return await connectWireless(host, port)
  }

  /** mDNS 自动发现:解析为结构化列表;首次调用会拉起 adb mdns 后端,空结果时重试一次。 */
  async discover(): Promise<MdnsServiceInfo[]> {
    let list = await mdnsServices().catch(() => [] as MdnsServiceInfo[])
    if (list.length === 0) {
      await new Promise((r) => setTimeout(r, 1200))
      list = await mdnsServices().catch(() => [] as MdnsServiceInfo[])
    }
    return list
  }
}

export const wirelessService = new WirelessService()
