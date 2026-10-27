#!/usr/bin/env bash
# M6 端到端:笔记双向同步真机验证(docs/08 §6)
# 前置:PZ261A 在线;AmooNotes 已装;桌面 dev(pnpm dev)已启动。
# 用法:pnpm e2e:notes
set -euo pipefail
cd "$(dirname "$0")/../.."

REMOTE_DIR='/sdcard/Android/data/com.amoolink.notes/files/notes'
USER_NOTES="$HOME/Library/Application Support/@amoolink/desktop/notes"
LOG=/tmp/notes-e2e-run.log

pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; exit 1; }

md5_of() { md5 -q "$1" 2>/dev/null || adb shell "md5sum '$REMOTE_DIR/$1'" 2>/dev/null | awk '{print $1}'; }

phone_write() { # id title body
  adb shell "printf '%s\n' \
    '---' \"id: $1\" \"title: $2\" 'createdAt: 2026-10-27T09:00:00.000Z' \"updatedAt: $(date -u +%Y-%m-%dT%H:%M:%S.000Z)\" 'pinned: false' '---' '' \"$3\" > '$REMOTE_DIR/$1.md'"
}

desktop_write() { # id title body
  printf -- '---%s\n' '' > "$USER_NOTES/$1.md"
  {
    echo "id: $1"
    echo "title: $2"
    echo "createdAt: 2026-10-27T09:00:00.000Z"
    echo "updatedAt: $(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
    echo "pinned: false"
    echo "---"
    echo ""
    echo "$3"
  } >> "$USER_NOTES/$1.md"
}

wait_sync() { # 轮询最长 12s 等条件成立
  local n=0
  while [ "$n" -lt 24 ]; do
    if eval "$2"; then return 0; fi
    sleep 0.5; n=$((n+1))
  done
  return 1
}

ID_A="20261027-090001-e2ea1"
ID_B="20261027-090002-e2eb2"
ID_C="20261027-090003-e2ec3"

echo "═══ M6 E2E:笔记双向同步 ═══"

# 场景 A:手机新建 → 6s 内出现在桌面
echo "▶ A. 手机→电脑(自动)"
phone_write "$ID_A" "手机新建E2E" "来自手机的内容 A-$(date +%s)"
if wait_sync 12 "[ -f '$USER_NOTES/$ID_A.md' ]"; then pass "A 桌面拉入 $ID_A.md"; else fail "A 未同步到桌面"; fi
grep -q "来自手机的内容" "$USER_NOTES/$ID_A.md" && pass "A 内容完整" || fail "A 内容缺失"

# 场景 B:桌面新建 → 6s 内出现在手机
echo "▶ B. 电脑→手机(自动)"
desktop_write "$ID_B" "桌面新建E2E" "来自桌面的内容 B-$(date +%s)"
if wait_sync 12 "adb shell \"test -f '$REMOTE_DIR/$ID_B.md'\""; then pass "B 手机拉入 $ID_B.md"; else fail "B 未同步到手机"; fi
adb shell "cat '$REMOTE_DIR/$ID_B.md'" | grep -q "来自桌面的内容" && pass "B 内容完整" || fail "B 内容缺失"

# 场景 C:两端同改一条 → 冲突双副本
echo "▶ C. 双改冲突(双副本策略)"
# C1 先让 ID_C 两端一致并建档
desktop_write "$ID_C" "冲突测试" "原始版本"
if ! wait_sync 12 "adb shell \"test -f '$REMOTE_DIR/$ID_C.md'\""; then fail "C 基线未同步"; fi
sleep 6 # 等一轮同步完成建档(manifest base)
phone_write "$ID_C" "冲突测试" "手机改写的版本"
desktop_write "$ID_C" "冲突测试" "桌面改写的版本"
sleep 8
# 冲突副本以新 id 落盘,标题为「<原标题>-冲突-yyyyMMdd-HHmm」→ 按内容标题找
CONFLICT_LOCAL=$(grep -l "冲突-[0-9]\{8\}-[0-9]\{4\}" "$USER_NOTES"/*.md 2>/dev/null | head -1 || true)
adb shell "ls '$REMOTE_DIR'" > /tmp/phone-notes-list.txt
CONFLICT_REMOTE=""
for f in $(cat /tmp/phone-notes-list.txt | grep '\.md$'); do
  if adb shell "head -4 '$REMOTE_DIR/$f'" | grep -q "冲突-[0-9]\{8\}-[0-9]\{4\}"; then CONFLICT_REMOTE="$f"; break; fi
done
[ -n "$CONFLICT_LOCAL" ] && pass "C 桌面冲突副本:$CONFLICT_LOCAL" || fail "C 桌面无冲突副本"
[ -n "$CONFLICT_REMOTE" ] && pass "C 手机冲突副本:$CONFLICT_REMOTE" || fail "C 手机无冲突副本"
grep -q "手机改写的版本" "$USER_NOTES/$ID_C.md" && pass "C 原 id 保留手机版本" || fail "C 原 id 内容不是手机版本"

# 场景 D:删除传播(桌面删 → 手机删)
echo "▶ D. 删除传播"
rm -f "$USER_NOTES/$ID_A.md"
python3 - "$USER_NOTES/manifest.json" "$ID_A" <<'PYEOF'
import json,sys,time
p, nid = sys.argv[1], sys.argv[2]
m = json.load(open(p))
if nid in m['notes'] and not m['notes'][nid].get('deletedAt'):
    m['notes'][nid]['deletedAt'] = int(time.time()*1000)
    json.dump(m, open(p,'w'))
PYEOF
if wait_sync 12 "! adb shell \"test -f '$REMOTE_DIR/$ID_A.md'\""; then pass "D 删除已传播到手机"; else fail "D 手机仍存在已删笔记"; fi

echo "═══ 全部通过 ═══"
