#!/bin/zsh
# M2 E2E 验证:启动应用(files 自测模式),按时间轴截取传输页与文件页。
# 前置:真机已连接。用法:zsh apps/desktop/scripts/e2e-files.sh
set -u
cd "$(dirname "$0")/.." || exit 1  # apps/desktop

LOG=/tmp/amoolink-e2e-files.log
OUT=/tmp/amoolink-e2e-files
mkdir -p "$OUT"
rm -f "$LOG" "$OUT"/*.png

if ! adb devices | grep -wq "device"; then
  echo "✗ 无处于 device 状态的设备" && exit 1
fi

echo "启动应用(AMOOLINK_AUTOTEST=files)…"
AMOOLINK_AUTOTEST=files pnpm dev > "$LOG" 2>&1 &
DEV_PID=$!

ok=0
for i in {1..45}; do
  if grep -q "已入队" "$LOG" 2>/dev/null; then ok=1; break; fi
  if ! kill -0 $DEV_PID 2>/dev/null; then break; fi
  sleep 2
done
if [ $ok -ne 1 ]; then
  echo "✗ 90s 内未入队传输任务"; tail -20 "$LOG"; kill $DEV_PID 2>/dev/null; exit 1
fi

# 时间轴:3s 跳 transfers(自测钩子),5.5s 截传输页;12s 跳 files,14.5s 截文件页
sleep 5
screencapture -x "$OUT/transfers.png"
echo "传输页截图完成"
sleep 9
screencapture -x "$OUT/files.png"
echo "文件页截图完成"

kill $DEV_PID 2>/dev/null
sleep 1
pkill -f "out/main/index.js" 2>/dev/null
adb shell "rm -f /sdcard/Download/amoolink-e2e-big.bin /sdcard/Download/amoolink-e2e-small.txt" 2>/dev/null
rm -f /tmp/amoolink-e2e-big.bin /tmp/amoolink-e2e-small.txt
echo "=== 关键日志 ==="
grep -E "autotest|transfer|error|ERROR" "$LOG" | tail -10
exit 0
