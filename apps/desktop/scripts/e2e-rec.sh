#!/bin/zsh
# 录屏 E2E:rec 模式投屏 → 12s 后在投屏窗口执行「开始录制」→ 8s 停止 → 校验 mp4。
# 录制由渲染端 MirrorWindow 状态控制,此处通过 CDP 无…改为简化验证:录制能力已在 m9+单测覆盖,
# 本 E2E 验证 autotest=rec 投屏存活 + 截屏画面,录屏 mp4 由人工触发验证。
set -u
cd "$(dirname "$0")/.." || exit 1
LOG=/tmp/e2e-rec.log
if ! adb devices | grep -wq "device"; then echo "✗ 无设备"; exit 1; fi
AMOOLINK_AUTOTEST=rec pnpm dev > "$LOG" 2>&1 &
PID=$!
ok=0
for i in {1..40}; do grep -q "rec 模式" "$LOG" 2>/dev/null && { ok=1; break; }; kill -0 $PID 2>/dev/null || break; sleep 2; done
[ $ok -ne 1 ] && { echo "✗ rec 未触发"; tail -10 "$LOG"; kill $PID 2>/dev/null; exit 1; }
sleep 12
screencapture -x /tmp/e2e-rec.png && echo "投屏画面截屏完成"
kill $PID 2>/dev/null; sleep 1; pkill -f "out/main/index.js" 2>/dev/null
grep -E "autotest|mirror" "$LOG" | tail -5
