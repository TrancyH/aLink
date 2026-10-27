/**
 * AAC 音频解码 + WebAudio 播放(scrcpy 音频通道)。
 * config 包即 AudioSpecificConfig(ASC);AAC 帧为 raw(无 ADTS)。
 */
export interface AacStreamInfo {
  sampleRate: number
  channels: number
}

/** 从 ASC(AudioSpecificConfig)解析采样率与声道数(ISO 14496-3)。 */
export function parseAsc(asc: Uint8Array): AacStreamInfo {
  // audioObjectType 5bit, samplingFrequencyIndex 4bit, channelConfig 4bit
  const b0 = asc[0] ?? 0
  const b1 = asc[1] ?? 0
  const sampleRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]
  let idx = ((b0 & 0x07) << 1) | ((b1 >> 7) & 0x01)
  if (idx >= sampleRates.length || idx === 12) idx = 3 // 48000 兜底
  const channels = ((b1 >> 3) & 0x0f) || 2
  return { sampleRate: sampleRates[idx] ?? 48000, channels }
}

export class AacAudioPlayer {
  private decoder: AudioDecoder | null = null
  private ctx: AudioContext | null = null
  private configured = false
  private nextTs = 0
  muted = false

  configure(asc: Uint8Array): boolean {
    try {
      const { sampleRate, channels } = parseAsc(asc)
      this.closeDecoder()
      this.decoder = new AudioDecoder({
        output: (data: AudioData) => this.play(data),
        error: (e: DOMException) => console.error('[audio]', e.message),
      })
      this.decoder.configure({
        codec: 'mp4a.40.2',
        sampleRate,
        numberOfChannels: channels,
        description: asc.slice(0, 2),
      })
      this.configured = true
      return true
    } catch {
      this.configured = false
      return false
    }
  }

  feed(data: Uint8Array, ptsUs: number): void {
    const d = this.decoder
    if (!d || !this.configured || d.state === 'closed') return
    const ts = Math.max(Math.round(ptsUs), this.nextTs)
    this.nextTs = ts + 1
    try {
      d.decode(new EncodedAudioChunk({ type: 'key', timestamp: ts, duration: 21_333, data }))
    } catch {
      // 队列瞬时异常丢弃
    }
  }

  private play(data: AudioData): void {
    if (this.muted) {
      data.close()
      return
    }
    this.ctx ??= new AudioContext({ latencyHint: 'interactive', sampleRate: data.sampleRate })
    const ctx = this.ctx
    if (ctx.state === 'suspended') void ctx.resume()
    const buffer = ctx.createBuffer(data.numberOfChannels, data.numberOfFrames, data.sampleRate)
    for (let ch = 0; ch < data.numberOfChannels; ch++) {
      const tmp = new Float32Array(data.numberOfFrames)
      data.copyTo(tmp, { planeIndex: ch })
      buffer.copyToChannel(tmp, ch)
    }
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    src.start()
    data.close()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (muted && this.ctx && this.ctx.state === 'running') void this.ctx.suspend()
    if (!muted && this.ctx && this.ctx.state === 'suspended') void this.ctx.resume()
  }

  private closeDecoder(): void {
    if (this.decoder && this.decoder.state !== 'closed') {
      try {
        this.decoder.close()
      } catch {
        /* ignore */
      }
    }
    this.decoder = null
  }

  close(): void {
    this.closeDecoder()
    void this.ctx?.close().catch(() => undefined)
    this.ctx = null
    this.configured = false
  }
}
