#!/bin/zsh
# 录屏完整 UI 链路 E2E:autotest=rec(投屏→真实点击⏺→10s→⏹)→ 断言接收目录新 mp4(ftyp+moov)。
set -u
cd "$(dirname "$0")/.." || exit 1
LOG=/tmp/e2e-rec2.log
OUT=~/Downloads/AmooLink
if ! adb devices | grep -wq "device"; then echo "✗ 无设备"; exit 1; fi
mkdir -p "$OUT"
BEFORE=$(ls -t "$OUT" 2>/dev/null | grep "mp4$" | head -1)

AMOOLINK_AUTOTEST=rec pnpm dev > "$LOG" 2>&1 &
PID=$!
ok=0
for i in $(seq 1 80); do grep -q "rec 完成" "$LOG" 2>/dev/null && { ok=1; break; }; kill -0 $PID 2>/dev/null || break; sleep 2; done
kill $PID 2>/dev/null; sleep 1; pkill -f "out/main/index.js" 2>/dev/null
[ $ok -ne 1 ] && { echo "✗ 录制链路未完成"; grep -E "autotest" "$LOG" | tail -6; exit 1; }

NEW="$OUT/$(ls -t "$OUT" 2>/dev/null | grep "mp4$" | head -1)"
NEWBASE=$(basename "$NEW" 2>/dev/null); if [ -z "$NEWBASE" ] || [ "$NEWBASE" = "$BEFORE" ]; then echo "✗ 无新 mp4 (BEFORE=$BEFORE NEW=$NEWBASE)"; exit 1; fi
SZ=$(stat -f%z "$NEW")
python3 - "$NEW" << 'PY'
import struct, sys
data = open(sys.argv[1], 'rb').read()
tag = lambda o: data[o+4:o+8].decode('latin1')
assert tag(0) == 'ftyp', 'missing ftyp'
head = data[:1<<20].decode('latin1')
assert 'moov' in head, 'missing moov'
assert 'avcC' in head, 'missing avcC'
print(f"✓ {sys.argv[1]} 结构合法(ftyp+moov+avcC)")
PY
[ $? -ne 0 ] && exit 1
echo "✓ 录屏 E2E 通过:$(basename "$NEW") $((SZ/1024))KB"
grep -E "autotest" "$LOG" | tail -4
