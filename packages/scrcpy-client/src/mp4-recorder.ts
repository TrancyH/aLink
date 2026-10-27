/**
 * H.264 Annex-B 码流 → MP4 录制器(环境无关:Node 与渲染进程共用)。
 * mp4-muxer 的 addVideoChunkRaw + avcC description(由 config 包的 SPS/PPS 构造)。
 */
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer'

/** Annex-B(start code)→ NAL 列表。 */
export function splitAnnexB(annexB: Uint8Array): Uint8Array[] {
  const nals: Uint8Array[] = []
  let i = 0
  const len = annexB.length
  while (i < len - 3) {
    if (annexB[i] === 0 && annexB[i + 1] === 0 && annexB[i + 2] === 1) {
      const nalStart = i + 3
      let next = -1
      for (let j = nalStart; j < len - 3; j++) {
        if (annexB[j] === 0 && annexB[j + 1] === 0 && annexB[j + 2] === 1) {
          next = j
          break
        }
      }
      const end = next === -1 ? len : next
      if (end > nalStart) nals.push(annexB.subarray(nalStart, end))
      i = end
    } else {
      i += 1
    }
  }
  return nals
}

/** Annex-B → 4 字节长度前缀(av1C/avc sample 格式)。 */
export function annexBToLengthPrefixed(annexB: Uint8Array): Uint8Array {
  const nals = splitAnnexB(annexB)
  const total = nals.reduce((a, n) => a + 4 + n.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const nal of nals) {
    out[o] = (nal.length >> 24) & 0xff
    out[o + 1] = (nal.length >> 16) & 0xff
    out[o + 2] = (nal.length >> 8) & 0xff
    out[o + 3] = nal.length & 0xff
    out.set(nal, o + 4)
    o += 4 + nal.length
  }
  return out
}

/**
 * 从 config 包(Annex-B:SPS+PPS)构造 avcC(ISO 14496-15 AVCDecoderConfigurationRecord)。
 * [1, profile, compat, level, 0xFF, 0xE1, spsLen(2B), sps, 1, ppsLen(2B), pps]
 */
export function buildAvcC(configAnnexB: Uint8Array): Uint8Array | null {
  const nals = splitAnnexB(configAnnexB)
  const sps = nals.find((n) => (n[0] & 0x1f) === 7)
  const pps = nals.find((n) => (n[0] & 0x1f) === 8)
  if (!sps || !pps || sps.length < 4) return null
  const out = new Uint8Array(11 + sps.length + pps.length)
  let o = 0
  out[o++] = 1 // configurationVersion
  out[o++] = sps[1] // profile_idc
  out[o++] = sps[2] // constraint flags
  out[o++] = sps[3] // level_idc
  out[o++] = 0xff // 111111 + 2bit reserved(长度字段=4B)
  out[o++] = 0xe1 // 3bit reserved + numSPS=1
  out[o++] = (sps.length >> 8) & 0xff
  out[o++] = sps.length & 0xff
  out.set(sps, o)
  o += sps.length
  out[o++] = 1 // numPPS
  out[o++] = (pps.length >> 8) & 0xff
  out[o++] = pps.length & 0xff
  out.set(pps, o)
  return out
}

export interface Mp4RecorderOptions {
  width: number
  height: number
  framerate: number
}

export class H264Mp4Recorder {
  private muxer: Mp4Muxer<Mp4Target> | null = null
  private target: Mp4Target | null = null
  private started = false
  private firstKeySeen = false
  private metaSent = false
  private avcC: Uint8Array | null = null
  private lastTs = 0
  private baseTs = -1
  frameCount = 0

  constructor(private readonly opts: Mp4RecorderOptions) {}

  /** 用服务端 config 包(SPS/PPS)准备 avcC;须在首个关键帧前调用。 */
  setConfig(configAnnexB: Uint8Array): boolean {
    this.avcC = buildAvcC(configAnnexB)
    return this.avcC !== null
  }

  /** Annex-B 帧直接喂入(内部转长度前缀;首个关键帧前丢弃)。 */
  feed(annexB: Uint8Array, ptsUs: number, keyframe: boolean): void {
    if (!this.muxer) return
    if (!this.firstKeySeen) {
      if (!keyframe) return
      this.firstKeySeen = true
    }
    // mp4-muxer/WebCodecs 的 timestamp 单位是微秒(实测传 ms 会被压缩 1000 倍)
    let ts = Math.max(Math.round(ptsUs), this.lastTs + 1)
    // 服务端 PTS 是系统 uptime 时钟(≈2.9e14µs),首帧归零避免域问题
    if (this.baseTs < 0) this.baseTs = ts
    ts -= this.baseTs
    const dur = Math.round(1_000_000 / this.opts.framerate)
    const data = annexBToLengthPrefixed(annexB)
    const meta =
      this.metaSent || !this.avcC
        ? undefined
        : {
            decoderConfig: {
              codec: 'avc1.640034',
              description: this.avcC,
            },
          }
    this.muxer.addVideoChunkRaw(data, keyframe ? 'key' : 'delta', ts, dur, meta)
    this.metaSent = true
    this.lastTs = ts
    this.frameCount += 1
  }

  start(): void {
    if (this.started) return
    this.target = new Mp4Target()
    this.muxer = new Mp4Muxer({
      target: this.target,
      video: {
        codec: 'avc',
        width: this.opts.width,
        height: this.opts.height,
      },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset', // 码流 PTS 从服务端时钟起,偏移到 0
    })
    this.started = true
  }

  /** 结束并返回 mp4 字节。 */
  finish(): Uint8Array | null {
    if (!this.muxer || !this.target || this.frameCount === 0) return null
    try {
      this.muxer.finalize()
      return new Uint8Array(this.target.buffer)
    } catch {
      return null
    }
  }

  get recording(): boolean {
    return this.started && this.firstKeySeen
  }
}

/** 校验 mp4 结构:ftyp 开头 + moov 存在(fastStart)且含 avc1 样板。 */
export function validateMp4(bytes: Uint8Array): { ok: boolean; reason?: string } {
  if (bytes.length < 16) return { ok: false, reason: '文件过小' }
  const tag = (o: number): string => String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7])
  if (tag(0) !== 'ftyp') return { ok: false, reason: `缺 ftyp(=${tag(0)})` }
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 1 << 20)))
  if (!text.includes('moov')) return { ok: false, reason: '缺 moov' }
  if (!text.includes('avcC')) return { ok: false, reason: 'moov 无 avcC' }
  return { ok: true }
}
