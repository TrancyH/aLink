# AmooLink — 跨平台手机互联应用 总体计划

> 状态:已评审定稿(v1.0,2026-10-26)
> 交付策略:设计文档 + 可运行项目骨架,按清单逐项推进

## 0. 背景与已确认事实

| 项 | 值 |
|---|---|
| 目标设备(实测) | StepX PZ261A(代号 pandora),USB 连接 |
| 系统 | Android 16 / SDK 36 / arm64-v8a,USB 调试已开启 |
| 屏幕 | 1200×2670 @ 520dpi |
| 能力结论 | scrcpy 协议、音频转发(Android 11+)、摄像头虚拟源(Android 12+)均可用 |
| 项目目录 | `/Users/z/Desktop/ai/AmooLink`(全新) |

**已确认的四项决策:**

1. 桌面端平台:**macOS + Windows**(架构保持可扩展 Linux)
2. 桌面端技术栈:**Electron + Node.js**(渲染层 React + TypeScript + Vite)
3. 手机端形态:**双轨** —— 一期纯 ADB 免装 App;二期伴侣 APK 解锁完整体验
4. 本次交付:**设计文档 + 真实可验证的项目骨架(M0)**

## 1. 产品定位

对标华为多屏协同 / 小米妙享 / Samsung Flow 的跨设备互联应用,但不绑定手机厂商:任何开启 USB 调试(或无线调试)的 Android 手机,插入即可获得投屏反控、文件互传、剪贴板同步、通知同步等完整互联体验。

## 2. 功能设计(摘要,详见 docs/01)

### P0 核心
1. **设备连接管理**:USB 即插即用、Android 11+ 无线调试配对(`adb pair`)、经典 `tcpip 5555`、mDNS 自动发现、多设备管理、设备面板(电量/型号/版本/存储/连接方式)
2. **投屏反控**:自实现 scrcpy client 协议;H.264/H.265,可调分辨率/码率/帧率;鼠标反控(点击/长按/拖动/滚轮)、键盘注入;快捷键(Home/返回/多任务/音量/锁屏);独立窗/置顶小窗/全屏;多设备同投;旋转自适应;黑屏模式;FPS/码率统计
3. **文件互传**:拖入即传(多文件/文件夹)、手机文件浏览器、相册批量导出、传输队列(并行/暂停/取消/重试)、APK 拖入即装、完成后打开目录
4. **剪贴板双向同步**:文本 + 图片;手机复制↔电脑粘贴;自动/手动模式;隐私开关;本地历史记录
5. **截图/录屏**:手机截屏→自动进电脑剪贴板(可直接 Ctrl+V)+ 可选存盘;电脑框选截图→发送到手机;录屏电脑侧编码保存 mp4

### P1 补充(ADB 可实现)
6. 通知同步(dumpsys 轮询 diff → 系统通知,按 App 免打扰,点击跳转投屏)
7. 音频转发(手机媒体音频在电脑播放)
8. 虚拟摄像头(手机摄像头作为电脑虚拟摄像头)
9. 应用面板(常用 App 快捷启动、第三方应用列表)
10. 设置中心(接收目录、码率帧率默认值、开机自启、托盘常驻)

### P2 伴侣 APK(二期)
11. 免 USB 调试的 mTLS + QR 码配对自建通路、通知快捷回复、短信/通讯录、系统右键菜单发送到手机、剪贴板历史端到端加密同步、来电提醒

## 3. 架构设计(摘要,详见 docs/02、03)

```
┌────────────────────────────────────────────────────┐
│ Electron 主进程 (Node.js)                            │
│  ├─ DeviceService     设备监听/连接池/无线配对/设备档案  │
│  ├─ MirrorService     scrcpy-server 推送 + 协议客户端  │
│  ├─ TransferService   上传下载队列                     │
│  ├─ ClipboardService  双向剪贴板同步                    │
│  ├─ NotifyService     通知轮询/转发                    │
│  └─ IPC Hub (contextBridge, 类型化)                   │
├────────────────────────────────────────────────────┤
│ 渲染进程 (React + TS)                                 │
│  ├─ 设备管理 / 文件管理器 / 传输队列 / 通知 / 设置       │
│  └─ 投屏窗口:WebCodecs H.264/H.265 硬解 → Canvas 渲染  │
└────────────────────────────────────────────────────┘
```

**关键技术决策:**
- **adb 通路**:`@u4/adbkit`(纯 JS,Apache-2.0)实现 track/push/pull/shell/forward;无线配对 `adb pair` spawn 内置 adb 二进制(资源目录随包分发)
- **投屏**:不包装 scrcpy 可执行文件,内嵌 `scrcpy-server.jar`(Apache-2.0,保留版权声明),自实现 client 协议(视频/控制/音频 socket)
- **解码**:渲染进程 WebCodecs(VideoDecoder/AudioDecoder)硬解,Chromium 保证 macOS/Windows 双端一致;Canvas 渲染
- **工程形态**:pnpm monorepo —— `apps/desktop`(Electron 应用)、`packages/adb`(adb 封装)、`packages/scrcpy-client`(协议实现)
- **构建**:electron-vite + electron-builder(macOS darwin-arm64 / Windows nsis)

## 4. 目录结构

```
AmooLink/
├── PLAN.md / TODO.md / README.md
├── docs/                    # 六份设计文档
├── package.json / pnpm-workspace.yaml / .npmrc(npmmirror 镜像)
├── packages/
│   ├── adb/                 # @amoolink/adb
│   └── scrcpy-client/       # @amoolink/scrcpy-client
├── apps/
│   └── desktop/             # @amoolink/desktop (Electron)
│       ├── electron-builder.yml
│       ├── scripts/check-device.ts   # 真机冒烟测试
│       └── src/{main,preload,renderer}/
└── resources/               # scrcpy-server.jar(M1 下载)、adb 二进制
```

## 5. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M0 骨架(本次) | monorepo + Electron 壳 + DeviceService 真实实现 + UI 框架 | `pnpm dev` 实时显示真机 PZ261A 信息;typecheck/build 通过 |
| M1 投屏 | scrcpy 协议客户端 + WebCodecs 渲染 + 反控 | 60fps 流畅投屏,鼠标键盘反控可用 |
| M2 传输 | 上传/下载队列 + 拖拽 + 文件浏览器 | 拖入 1GB 文件稳定传输,断线重试 |
| M3 互联 | 剪贴板双向 + 截图进剪贴板 + 通知同步 | 手机截图 2s 内可电脑粘贴;通知实时弹窗 |
| M4 增强 | 音频转发 + 虚拟摄像头 + APK 安装 | 音视频会议可用手机摄像头 |
| M5 伴侣 APK | 二期双轨 | 详见 docs/04 |

## 6. 开发方式约定

- 文档编写、UI 设计与编写、识别类任务 → 由 `flash` 子代理(GLM-5.3-Flash)执行
- 核心协议/工程骨架/验证 → 主代理执行
- 进度以 `TODO.md` 清单为准,完成一项勾一项
- 依赖安装一律使用国内镜像(npmmirror),Electron 二进制使用镜像 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
