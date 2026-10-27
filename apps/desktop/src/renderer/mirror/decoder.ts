/**
 * H.264 WebCodecs 解码 + Canvas 渲染(Annex-B 模式,依赖码流内 SPS/PPS)。
 * scrcpy 的关键帧自带参数集;为稳妥起见,配置包(SPS/PPS)会前置到首个关键帧。
 */
export interface DecoderConfigInfo {
  profileIndex: number
  constraintSet: number
  levelIndex: number
  width: number
  height: number
}

function hex2(value: number): string {
  return value.toString(16).padStart(2, '0')
}

export class H264CanvasRenderer {
  private decoder: VideoDecoder | null = null
  private pending: VideoFrame | null = null
  private rafId = 0
  private lastTs = -1
  private configRaw: Uint8Array | null = null
  private configInjected = false
  private canvas2d: CanvasRenderingContext2D | null = null

  framesDecoded = 0
  framesDropped = 0

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.canvas2d = canvas.getContext('2d')
  }

  configure(info: DecoderConfigInfo, spsPps: Uint8Array): void {
    this.closeDecoder()
    this.configRaw = spsPps
    this.configInjected = false
    this.lastTs = -1
    const codec = `avc1.${hex2(info.profileIndex)}${hex2(info.constraintSet)}${hex2(info.levelIndex)}`
    this.decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        this.framesDecoded += 1
        this.pending?.close()
        this.pending = frame
        this.schedulePaint()
      },
      error: (err: DOMException) => {
        console.error('[mirror] 解码错误:', err.message)
      },
    })
    this.decoder.configure({
      codec,
      codedWidth: info.width,
      codedHeight: info.height,
      optimizeForLatency: true,
    })
    this.startPaintLoop()
  }

  /** 喂入一帧 Annex-B 码流;keyframe 时(如配置已就绪)前置 SPS/PPS。 */
  feed(data: Uint8Array, keyframe: boolean, ptsUs: number): void {
    const decoder = this.decoder
    if (!decoder || decoder.state === 'unconfigured' || decoder.state === 'closed') return
    // 延迟控制:队列积压时丢弃非关键帧
    if (decoder.decodeQueueSize > 4 && !keyframe) {
      this.framesDropped += 1
      return
    }
    let payload: Uint8Array = data
    if (keyframe && !this.configInjected && this.configRaw) {
      const merged = new Uint8Array(this.configRaw.length + data.length)
      merged.set(this.configRaw, 0)
      merged.set(data, this.configRaw.length)
      payload = merged
      this.configInjected = true
    }
    const ts = Math.max(Math.round(ptsUs), this.lastTs + 1)
    this.lastTs = ts
    try {
      decoder.decode(
        new EncodedVideoChunk({ type: keyframe ? 'key' : 'delta', timestamp: ts, data: payload }),
      )
    } catch {
      // 解码器暂不可用(如正在重连),丢弃该帧
      this.framesDropped += 1
    }
  }

  close(): void {
    this.stopPaintLoop()
    this.closeDecoder()
  }

  private closeDecoder(): void {
    if (this.rafId) this.stopPaintLoop()
    this.pending?.close()
    this.pending = null
    if (this.decoder && this.decoder.state !== 'closed') {
      try {
        this.decoder.close()
      } catch {
        // 已关闭
      }
    }
    this.decoder = null
  }

  private schedulePaint(): void {
    // rAF 循环已在跑;无需额外调度
  }

  private startPaintLoop(): void {
    const paint = (): void => {
      const frame = this.pending
      if (frame && this.canvas2d) {
        if (
          this.canvas.width !== frame.displayWidth ||
          this.canvas.height !== frame.displayHeight
        ) {
          this.canvas.width = frame.displayWidth
          this.canvas.height = frame.displayHeight
        }
        this.canvas2d.drawImage(frame, 0, 0)
        frame.close()
        this.pending = null
      }
      this.rafId = requestAnimationFrame(paint)
    }
    this.rafId = requestAnimationFrame(paint)
  }

  private stopPaintLoop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
  }
}
