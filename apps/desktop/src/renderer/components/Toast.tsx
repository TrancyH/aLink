import { useEffect, useRef, useState } from 'react'
import { BoltIcon } from './Icons'

/**
 * 轻提示:展示 message,自动消失(默认 2.6s)。
 * 用于 M1/M2 占位入口的 TODO 反馈。
 */
export function useToast(): {
  toast: (message: string) => void
  toastNode: React.ReactNode
} {
  const [message, setMessage] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const toast = (msg: string): void => {
    setMessage(msg)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setMessage(null), 2600)
  }

  const toastNode =
    message === null ? null : (
      <div className="toast" role="status">
        <BoltIcon size={14} className="toast-icon" />
        <span>{message}</span>
      </div>
    )

  return { toast, toastNode }
}
