#!/bin/zsh
# M1 E2E 验证:启动应用(自动投屏钩子),等待渲染后截屏。
# 前置:真机已连接(adb devices 可见),pnpm install 已完成。
# 用法:zsh apps/desktop/scripts/e2e-mirror.sh
set -u
cd "$(dirname "$0")/.." || exit 1  # apps/desktop

LOG=/tmp/amoolink-e2e.log
OUT=/tmp/amoolink-e2e
mkdir -p "$OUT"
rm -f "$LOG" "$OUT/mirror.png"

if ! adb devices | grep -wq "device"; then
  echo "✗ 无处于 device 状态的设备" && exit 1
fi

echo "启动应用(AMOOLINK_AUTOTEST=1)…"
AMOOLINK_AUTOTEST=1 pnpm dev > "$LOG" 2>&1 &
DEV_PID=$!

ok=0
for i in {1..45}; do
  if grep -q "自动投屏" "$LOG" 2>/dev/null; then ok=1; break; fi
  if ! kill -0 $DEV_PID 2>/dev/null; then break; fi
  sleep 2
done
if [ $ok -ne 1 ]; then
  echo "✗ 45s 内未触发自动投屏"; tail -20 "$LOG"; kill $DEV_PID 2>/dev/null; exit 1
fi
echo "自动投屏已触发,等待画面渲染(14s)…"
sleep 14
screencapture -x "$OUT/mirror.png"
echo "截图完成: $OUT/mirror.png"

kill $DEV_PID 2>/dev/null
sleep 1
pkill -f "out/main/index.js" 2>/dev/null
echo "=== 关键日志 ==="
grep -E "autotest|mirror|ERROR|error" "$LOG" | tail -12
exit 0
