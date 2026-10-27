#!/bin/zsh
# M3 E2E:启动应用(m3 自测模式)→ 自动构造通知 → 截通知页。
# 前置:真机已连接,设备页会随设备出现自动加载(通知由 NotifyService 轮询捕获)。
set -u
cd "$(dirname "$0")/.." || exit 1

LOG=/tmp/amoolink-e2e-m3.log
OUT=/tmp/amoolink-e2e-m3
mkdir -p "$OUT"
rm -f "$LOG" "$OUT"/*.png

if ! adb devices | grep -wq "device"; then
  echo "✗ 无设备" && exit 1
fi

echo "启动应用(AMOOLINK_AUTOTEST=m3)…"
AMOOLINK_AUTOTEST=m3 pnpm dev > "$LOG" 2>&1 &
DEV_PID=$!

ok=0
for i in {1..45}; do
  grep -q "已构造通知" "$LOG" 2>/dev/null && { ok=1; break; }
  kill -0 $DEV_PID 2>/dev/null || break
  sleep 2
done
[ $ok -ne 1 ] && { echo "✗ 未构造通知"; tail -15 "$LOG"; kill $DEV_PID 2>/dev/null; exit 1; }

# 4s 跳通知页;再给页面 5s 接收轮询捕获的通知
sleep 10
screencapture -x "$OUT/notifications.png"
echo "通知页截图完成"

kill $DEV_PID 2>/dev/null
sleep 1
pkill -f "out/main/index.js" 2>/dev/null
adb shell "cmd notification cancel m3e2e" 2>/dev/null
echo "=== 日志 ==="
grep -E "autotest" "$LOG" | tail -5
exit 0
