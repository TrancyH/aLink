import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { H264CanvasRenderer } from '../mirror/decoder'
import { AacAudioPlayer } from '../mirror/audio-player'
import { H264Mp4Recorder } from '../mirror/mp4-recorder'
import './MirrorWindow.css'

/**
 * 投屏窗口(M1):WebCodecs 解码渲染 + 鼠标/键盘/滚轮反控 + 工具条 + OSD。
 * 视觉层由 T24 UI 打磨;此文件承载引擎逻辑。
 */
export default function MirrorWindowPage() {
  const { serial = '' } = useParams()
  const navigate = useNavigate()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<H264CanvasRenderer | null>(null)
  const videoSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })
  const pressedRef = useRef(false)

  const [phase, setPhase] = useState<'starting' | 'streaming' | 'retrying' | 'error'>('starting')
  const [errorMessage, setErrorMessage] = useState('')
  const [stats, setStats] = useState({ fps: 0, kbps: 0 })
  const [toast, setToast] = useState('')
  const [pinned, setPinned] = useState(false)
  const [blackScreen, setBlackScreen] = useState(false)
  const [audioMuted, setAudioMuted] = useState(false)
  const [recording, setRecording] = useState(false)
  const audioRef = useRef<AacAudioPlayer | null>(null)
  const recorderRef = useRef<H264Mp4Recorder | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [osdOn, setOsdOn] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [dragCount, setDragCount] = useState(0)
  const toastTimer = useRef<number>(0)

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2600)
  }, [])

  // 订阅主进程镜像事件
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new H264CanvasRenderer(canvas)
    rendererRef.current = renderer

    const offConfig = window.amoolink.onMirrorConfig((msg) => {
      if (msg.serial !== serial) return
      const { raw, width, height, profileIndex, constraintSet, levelIndex } = msg.payload
      videoSizeRef.current = { w: width, h: height }
      renderer.configure({ profileIndex, constraintSet, levelIndex, width, height }, raw)
      recorderRef.current?.setConfig(raw)
    })
    const audio = new AacAudioPlayer()
    audioRef.current = audio
    const offAudioMeta = window.amoolink.onMirrorAudioMeta((msg) => {
      if (msg.serial !== serial) return
      console.log('[mirror] audio codec', msg.payload.codecId.toString(16))
    })
    const offAudioConfig = window.amoolink.onMirrorAudioConfig((msg) => {
      if (msg.serial !== serial) return
      audio.configure(msg.payload.raw)
    })
    const offAudioFrame = window.amoolink.onMirrorAudioFrame((msg) => {
      if (msg.serial !== serial) return
      audio.feed(msg.payload.data, msg.payload.ptsUs)
    })
    const offFrame = window.amoolink.onMirrorFrame((msg) => {
      if (msg.serial !== serial) return
      renderer.feed(msg.payload.data, msg.payload.keyframe, msg.payload.ptsUs)
      recorderRef.current?.feed(msg.payload.data, msg.payload.ptsUs, msg.payload.keyframe)
    })
    const offState = window.amoolink.onMirrorState((msg) => {
      if (msg.serial !== serial) return
      const { state, message } = msg.payload
      if (state === 'streaming') setPhase('streaming')
      else if (state === 'retrying') {
        setPhase('retrying')
        if (message) setErrorMessage(message)
      } else if (state === 'error') {
        setPhase('error')
        setErrorMessage(message ?? '投屏失败')
      }
    })
    const offStats = window.amoolink.onMirrorStats((msg) => {
      if (msg.serial !== serial) return
      setStats(msg.payload)
    })
    const offToast = window.amoolink.onMirrorToast((msg) => {
      if (msg.serial === serial) showToast(msg.payload)
    })

    return () => {
      offConfig()
      offFrame()
      offState()
      offStats()
      offToast()
      offAudioMeta()
      offAudioConfig()
      offAudioFrame()
      audio.close()
      void stopRecording(true)
      renderer.close()
    }
  }, [serial, showToast])

  // 键盘注入
  useEffect(() => {
    const send = window.amoolink.sendMirrorControl
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key.length === 1) {
        e.preventDefault()
        send(serial, { type: 'text', text: e.key })
        return
      }
      const map: Record<string, number> = {
        Backspace: 67,
        Enter: 66,
        Escape: 111,
        Tab: 61,
        ArrowUp: 19,
        ArrowDown: 20,
        ArrowLeft: 21,
        ArrowRight: 22,
        Home: 122,
        End: 123,
        PageUp: 92,
        PageDown: 93,
      }
      const keycode = map[e.key]
      if (keycode !== undefined) {
        e.preventDefault()
        send(serial, { type: 'key', action: 1, keycode })
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      const map: Record<string, number> = {
        Backspace: 67,
        Enter: 66,
        Escape: 111,
        Tab: 61,
        ArrowUp: 19,
        ArrowDown: 20,
        ArrowLeft: 21,
        ArrowRight: 22,
        Home: 122,
        End: 123,
        PageUp: 92,
        PageDown: 93,
      }
      const keycode = map[e.key]
      if (keycode !== undefined) send(serial, { type: 'key', action: 0, keycode })
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [serial])

  // 画布坐标映射(object-fit: contain 的黑边偏移)
  const toVideoPx = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current
    const { w, h } = videoSizeRef.current
    if (!canvas || w === 0 || h === 0) return null
    const rect = canvas.getBoundingClientRect()
    const scale = Math.min(rect.width / w, rect.height / h)
    const drawW = w * scale
    const drawH = h * scale
    const offsetX = rect.left + (rect.width - drawW) / 2
    const offsetY = rect.top + (rect.height - drawH) / 2
    const x = ((clientX - offsetX) / drawW) * w
    const y = ((clientY - offsetY) / drawH) * h
    if (x < 0 || y < 0 || x >= w || y >= h) return null
    return { x, y }
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (e.button === 2) return // 右键=返回,在 contextmenu 处理
    if (e.button === 1) {
      // 中键=回桌面(阻止浏览器自动滚动)
      e.preventDefault()
      window.amoolink.sendMirrorControl(serial, { type: 'home' })
      return
    }
    const pos = toVideoPx(e.clientX, e.clientY)
    if (!pos) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pressedRef.current = true
    window.amoolink.sendMirrorControl(serial, {
      type: 'touch',
      action: 0,
      x: pos.x,
      y: pos.y,
      pointerId: e.pointerId,
      pressure: 1,
    })
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!pressedRef.current) return
    const pos = toVideoPx(e.clientX, e.clientY)
    if (!pos) return
    window.amoolink.sendMirrorControl(serial, {
      type: 'touch',
      action: 2,
      x: pos.x,
      y: pos.y,
      pointerId: e.pointerId,
      pressure: 1,
    })
  }
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!pressedRef.current) return
    pressedRef.current = false
    const pos = toVideoPx(e.clientX, e.clientY) ?? { x: 0, y: 0 }
    window.amoolink.sendMirrorControl(serial, {
      type: 'touch',
      action: 1,
      x: pos.x,
      y: pos.y,
      pointerId: e.pointerId,
      pressure: 0,
    })
  }
  const onContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    window.amoolink.sendMirrorControl(serial, { type: 'back' })
  }
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>): void => {
    const pos = toVideoPx(e.clientX, e.clientY)
    if (!pos) return
    const vUnits = Math.min(Math.max(-e.deltaY / 100, -3), 3)
    // 与纵向对称取负:macOS 触控板自然滚动下,双指左滑(deltaX<0)应翻向右侧页面
    const hUnits = Math.min(Math.max(-e.deltaX / 100, -3), 3)
    window.amoolink.sendMirrorControl(serial, {
      type: 'scroll',
      x: pos.x,
      y: pos.y,
      vUnits,
      hUnits,
    })
  }

  const takeScreenshot = (): void => {
    const canvas = canvasRef.current
    if (!canvas || canvas.width === 0) {
      showToast('尚无可截取的画面')
      return
    }
    window.amoolink.sendMirrorControl(serial, { type: 'screenshot', dataUrl: canvas.toDataURL('image/png') })
  }

  // ── 拖拽上传(电脑 → 手机,拖到投屏窗口即传输)─────────────
  const onMirrorDragEnter = (e: React.DragEvent): void => {
    e.preventDefault()
    if (e.dataTransfer.types.includes('Files')) {
      setDragOver(true)
      setDragCount(e.dataTransfer.items.length)
    }
  }
  const onMirrorDragOverEvt = (e: React.DragEvent): void => {
    e.preventDefault() // 必须,否则浏览器直接打开文件
    e.dataTransfer.dropEffect = 'copy'
    if (!dragOver && e.dataTransfer.types.includes('Files')) {
      setDragOver(true)
      setDragCount(e.dataTransfer.items.length)
    }
  }
  const onMirrorDragLeave = (e: React.DragEvent): void => {
    e.preventDefault()
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
  }
  const onMirrorDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    const paths: string[] = []
    let hasApk = false
    for (const f of files) {
      const p = window.amoolinkFiles.getPathForFile(f)
      if (p) {
        paths.push(p)
        if (/\.apk$/i.test(f.name)) hasApk = true
      }
    }
    if (paths.length === 0) {
      showToast('未能读取拖入的文件')
      return
    }
    showToast(
      `正在发送 ${paths.length} 个文件到手机…${hasApk ? '(APK 将自动安装)' : ''}`,
    )
    try {
      const settings = await window.amoolink.getSettings()
      await window.amoolink.uploadFiles(serial, paths, settings.mirror.uploadDir || '/sdcard/Download')
    } catch (err) {
      showToast(`发送失败:${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const toggleFullscreen = (): void => {
    const el = document.documentElement
    if (!document.fullscreenElement) {
      void el.requestFullscreen()
      setFullscreen(true)
    } else {
      void document.exitFullscreen()
      setFullscreen(false)
    }
  }

  const togglePin = (): void => {
    const next = !pinned
    setPinned(next)
    void window.amoolink.setMirrorPinned(serial, next)
  }

  /** 录屏:主进程帧流封 mp4,经 IPC 保存。 */
  const startRecording = (): void => {
    document.title = 'REC-CALLED' // autotest 执行标记
    if (recording) return
    const { w, h } = videoSizeRef.current
    if (w === 0) {
      showToast('等待画面就绪…')
      return
    }
    const rec = new H264Mp4Recorder({ width: w, height: h, framerate: 30 })
    rec.start()
    recorderRef.current = rec
    setRecording(true)
    // 请求服务端重发关键帧(scrcpy 静止后只发 P 帧,不 reset 则录制器等不到 I 帧)
    window.amoolink.sendMirrorControl(serial, { type: 'reset-video' })
    showToast('开始录制…')
  }

  const stopRecording = async (silent = false): Promise<void> => {
    const rec = recorderRef.current
    if (!rec) return
    recorderRef.current = null
    setRecording(false)
    const bytes = rec.finish()
    if (!bytes || bytes.length < 1000) {
      if (!silent) showToast('录制太短,已丢弃')
      return
    }
    try {
      const settings = await window.amoolink.getSettings()
      const dir = settings.files.downloadDir || '~/Downloads/AmooLink'
      const { ok, path } = await window.amoolink.saveRecording(serial, bytes, dir)
      if (!silent) showToast(ok ? `录屏已保存 ${path}` : '录屏保存失败')
    } catch (e) {
      if (!silent) showToast(`录屏保存失败:${e instanceof Error ? e.message : e}`)
    }
  }

  /** 黑屏模式:手机物理屏熄灭,投屏与反控继续(电脑端独占显示)。 */
  const toggleBlackScreen = (): void => {
    const next = !blackScreen
    setBlackScreen(next)
    window.amoolink.sendMirrorControl(serial, { type: 'black-screen', on: next })
    showToast(next ? '黑屏模式:手机屏幕已熄灭,电脑端继续操控' : '已点亮手机屏幕')
  }

  const closeMirror = (): void => {
    void window.amoolink.stopMirror(serial).then(() => navigate('/'))
  }

  const btn = (label: string, title: string, onClick: () => void, active = false) => (
    <button
      key={label}
      className={`mirror-btn${active ? ' active' : ''}`}
      title={title}
      onClick={onClick}
    >
      {label}
    </button>
  )

  return (
    <div
      className="mirror-window"
      onDragEnter={onMirrorDragEnter}
      onDragOver={onMirrorDragOverEvt}
      onDragLeave={onMirrorDragLeave}
      onDrop={(e) => {
        void onMirrorDrop(e)
      }}
    >
      <div className="mirror-stage">
        <canvas
          ref={canvasRef}
          className="mirror-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={onContextMenu}
          onWheel={onWheel}
        />
        {phase !== 'streaming' && (
          <div className="mirror-overlay">
            <div className="mirror-overlay-title">
              {phase === 'starting' && '正在建立投屏…'}
              {phase === 'retrying' && `连接中断,自动重连中… ${errorMessage}`}
              {phase === 'error' && `投屏失败:${errorMessage}`}
            </div>
          </div>
        )}
        {osdOn && phase === 'streaming' && (
          <div className="mirror-osd num" onClick={() => setOsdOn(false)} title="点击隐藏">
            {stats.fps} fps · {stats.kbps} KB/s
          </div>
        )}
        {!osdOn && (
          <div className="mirror-osd-hidden" onClick={() => setOsdOn(true)} title="显示统计" />
        )}
        {toast && <div className="mirror-toast">{toast}</div>}
        {dragOver && (
          <div className="mirror-drop-overlay">
            <div className="mirror-drop-icon">⇪</div>
            <div className="mirror-drop-title">松开即发送到手机</div>
            <div className="mirror-drop-sub">{dragCount > 0 ? `${dragCount} 个文件` : ''}</div>
          </div>
        )}
      </div>

      <div className="mirror-toolbar">
        {btn('⌂', 'Home', () => window.amoolink.sendMirrorControl(serial, { type: 'home' }))}
        {btn('←', '返回(右键也可)', () => window.amoolink.sendMirrorControl(serial, { type: 'back' }))}
        {btn('▣', '多任务', () => window.amoolink.sendMirrorControl(serial, { type: 'app-switch' }))}
        {btn('＋', '音量加', () => window.amoolink.sendMirrorControl(serial, { type: 'volume-up' }))}
        {btn('－', '音量减', () => window.amoolink.sendMirrorControl(serial, { type: 'volume-down' }))}
        {btn('☀', '亮屏', () => window.amoolink.sendMirrorControl(serial, { type: 'screen-on' }))}
        {btn('⟳', '旋转', () => window.amoolink.sendMirrorControl(serial, { type: 'rotate' }))}
        {btn('☰', '通知栏', () => window.amoolink.sendMirrorControl(serial, { type: 'notifications' }))}
        {btn('✂', '截图到电脑剪贴板', takeScreenshot)}
        {btn(fullscreen ? '⤡' : '⤢', '全屏', toggleFullscreen, fullscreen)}
        {btn('🔊', audioMuted ? '取消静音' : '静音(音频转发)', () => {
          const next = !audioMuted
          setAudioMuted(next)
          audioRef.current?.setMuted(next)
        }, audioMuted)}
        {recording
          ? btn('⏹', '停止录屏', () => {
              void stopRecording()
            }, true)
          : btn('⏺', '录屏保存 mp4', startRecording)}
        {btn('🌙', '黑屏模式:手机熄屏,电脑继续操控', toggleBlackScreen, blackScreen)}
        {btn('📌', '窗口置顶', togglePin, pinned)}
        {btn('✕', '结束投屏', closeMirror)}
      </div>
    </div>
  )
}
