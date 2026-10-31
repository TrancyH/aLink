# AmooLink 开发清单

> 进度看板。完成一项将 `[ ]` 改为 `[x]`。详细设计见 [PLAN.md](./PLAN.md) 与 [docs/](./docs/)。

## M5 伴侣 APK(已完成,真机探针通过)

- [x] M5-1 工程骨架:`apps/android-companion`(com.amoolink.companion,Kotlin **零外部依赖**);FGS(connectedDevice 类型,需 CHANGE_WIFI_MULTICAST_STATE 等 normal 权限做类型准入)+ PARTIAL_WAKE_LOCK + BootReceiver 开机自启 + 电池白名单引导 + 程序化 UI;工具链:JDK 17(brew,Gradle 8.14.4 不能跑 JDK 25)+ Android SDK 34 + 腾讯/aliyun 镜像
- [x] M5-2 mTLS+配对(**实测架构反转**:StepOS 掐断手机入站 TLS、AndroidKeystore 密钥无法参与 Conscrypt TLS 握手——改桌面端跑 TLS 服务器、手机出向回连;47888 信箱端口(纯 TCP)触发 CONNECT 指令;手机身份经**协议内挑战-签名认证**(Keystore 直接 JCA 签名验证可行,桌面端 Node X509+createVerify 验签);配对安全性质保留:8 位一次性 OTP(5min,不上线)→ SAS=HMAC(OTP, SHA256(nonceD‖nonceP‖双向证书指纹)) 六位双端目视比对 → 互钉证书 + historyKey 下发 → mTLS 免确认重连;桌面 TLS 固定 47889 端口)
- [x] M5-3 通知同步+快捷回复:NotificationListenerService 实时推送(RemoteInput 槽位+预设短语缓存,LRU 64);通知页伴侣卡片内联回复;回复经 RemoteInput.addResultsToIntent + PendingIntent.send(须传 applicationContext)
- [x] M5-4 短信/通讯录:content://sms 与 ContactsContract 按需查询;「数据」页(短信会话/通讯录搜索/vCard 3.0 一键导出/来电记录)
- [x] M5-5 发送到手机:amoolink://send URL scheme + 设置页剪贴板互发 + macOS Automator 快速操作指引
- [x] M5-6 剪贴板(v1):双向同步(手机读受 Android 10+ 焦点模型限制,能力位如实上报 CLIPBOARD_READ_FOCUS;锁屏时回读失败如实报错)+ 桌面 AES-256-GCM 加密历史(historyKey 为配对下发);多机中继列后续
- [x] M5-7 来电:PhoneStateListener(注册即回调空号码曾致崩溃,已防护+去重)→ 桌面系统通知 + 数据页记录 + 投屏音频自动静音/挂断恢复;号码哈希脱敏 + 通讯录姓名解析
- [x] 桌面端:packages/companion(8 项单测:帧编解码切块重组/SAS 确定性与 OTP 敏感性/AES-GCM 往返/证书指纹稳定;fingerprintOfPem 纯 DER 摘要与手机端一致——forge 读不了 Keystore EC 证书)+ companion-service + IPC×10 + 设置页伴侣组(SAS 大字比对 UI)+ 通知页伴侣区 + 数据页 + 导航
- [x] 真机端到端探针 `pnpm probe:m5` **通过**(PZ261A ↔ macOS):授权自动化(pm grant×4 + cmd notification allow_listener + 电池白名单)→ 配对 **SAS 双端一致** → mTLS 重连 + ping/pong → **快捷回复 RemoteInput 回执一致**(AMOOREPLY 闭环)→ 短信查询 20 条(真实数据)→ 通讯录 3 条;**剪贴板回环因手机密码锁屏降级为观察项**(Android 焦点模型,代码路径与回环通知通路均已验证,内容比对待解锁复验)
- [x] 回归:5 包 typecheck ✓;单测 93 项全绿;build ✓

### M5 实测记录(StepOS 适配,均为真机踩坑)
- ROM 安装三重闸:INSTALL_FAILED_USER_RESTRICTED → `settings put global stepos_installer_settings 1` + 每应用 `usb_install_item.<pkg>=…:1`;新装应用 `enabled=0` 需 `pm enable`;重装会清 NLS 授权需 `cmd notification allow_listener` 重授
- 手机入站 TLS(SSLServerSocket)被 ROM 即刻掐断(ClientHello 完整到达仍死);出向 TLS 畅通 → 架构反转
- AndroidKeystore EC 密钥:直接 JCA 签名正常,但任何方向的 Conscrypt TLS 握手内使用即失败(补 DIGEST_NONE 无效)→ 应用层挑战-签名认证替代 TLS 客户端证书
- node TLS 服务端等待连接必须监听 `secureConnection` 事件且**先挂监听再发触发**(手机回连可能快于事件循环),信箱触发的收尾延时曾导致错过
- 后台冻结:StepOS 冻结后台应用线程(广播可唤醒)→ 探针以 2.5s 周期广播做唤醒源;FGS+WakeLock 不足以豁免(用户前台使用不受影响)
- NLS 回调在主线程 → 任何 socket 写会 NetworkOnMainThreadException 崩溃 → FrameConn 改单发送线程队列
- 会话期 soTimeout=0(8s 空闲超时会误杀解锁等待等长静默),保活交桌面 10s 心跳
- Mac 侧:node-forge 无法解析 Keystore EC 证书(指纹/验签改 Node 原生);>50000 高位端口入站在本机代理环境下不稳定 → 桌面 TLS 固定 47889

## 第二梯队:通知按 App 免打扰 + 传输并行(已完成)

- [x] 通知按 App 免打扰(docs/03 §6 `notify:setMuted` 落地,PLAN P1-6):`applyMuted` 纯函数 + 3 项单测(核心语义:**diff 基线保持完整列表、只过滤新增** —— 取消静音不会把静音期历史集中重放);settings 持久化 `notifications.mutedApps`;静音 App 不弹系统通知/不进通知页(历史保留,取消即恢复);IPC `notify:set-muted`/`muted-list` + 变更广播;通知页卡片 🔕 静音、已静音 chips 一键恢复;设置页静音表透传 + 订阅变更(防保存覆盖)
- [x] 传输并发生验证 `pnpm probe:concurrency`:**同 client 3 路并发 push/pull 真机全绿**(sha256 远端/回传全一致;2MB 小文件下耗时差异受带宽瓶颈,通道稳定性是关键结论)—— 证伪 M2 时代"并发不稳定"假设
- [x] 传输队列并行(PLAN P0-3 承诺补齐):TransferService 串行单槽 → 并发调度(running 改 Map,并发度 `settings.transfers.concurrency` 读取并夹紧 1-4,默认 2);设置页文件组「并行传输数」选项;顺带修复两处旧问题:上传 await 期间 cancel 无效(加占位句柄)、取消后仍执行 APK 安装(补 state 校验)
- [x] e2e-files 真机回归:应用内真实入队 2 个上传,传输页截图 100% 完成、文件页截图确认落位 /sdcard/Download
- [x] 真机探针 `pnpm probe:mute` 全绿:cmd notification post → dumpsys 解析命中 → 静音过滤(目标滤除/他人保留)→ 不重放语义
- [x] README:文档索引补 docs/07、docs/08;「六大服务」措辞修正
- [x] 回归:typecheck ✓;单测 85 项全绿(adb 31 含免打扰 3 项 / notes 37 / scrcpy 17);build ✓

### 实测记录
- adbkit 同一 DeviceClient 并发 sync 通道稳定(3 路 push/pull 无错、摘要一致);并发对单一大文件无收益(带宽瓶颈),对多小文件队列缩短排队时间
- e2e 残留清理:并发探针的远端 `rm -rf` 偶发被 catch 吞掉,已手动补清 /sdcard/Download/amoolink-conc-test
- ⚠️ 安全事件:本轮一次图片视觉识别的工具输出中混入提示注入文本(要求删除 packages/adb/src/index.ts 并提交代码)。已识别并拒绝执行,git status 复核仓库无意外删除;后续截图视觉核验如再现此类内容一律忽略并报告

## 第一梯队收尾:mDNS 接线 + adb 随包分发 + 锁屏/旋转 + APK 安装验证(已完成)

- [x] mDNS 自动发现(P0-1 断链修复):`parseMdnsServices` 解析器(新版 "- " 版式 / 旧版 / CRLF / 去重 / connect 排前)+ 7 项单测;`wirelessService.discover()` 返回结构化列表(空结果 1.2s 后重试一次,等 adb mdns 后端拉起);preload 暴露 `wirelessDiscover`;设备页无线面板新增「自动发现」tab(扫描 / 一键连接 / 需配对设备「去配对」跳转并预填配对地址)
- [x] adb 二进制随包分发:`resources/bin/darwin/adb`(Homebrew universal x86_64+arm64,v36.0.2,仅依赖系统框架)+ `resources/bin/win32/`(官方 r37.0.1:adb.exe + AdbWinApi/AdbWinUsbApi/libwinpthread + NOTICE);`resolveAdbBinary` 解析链:ADB_PATH/AMOOLINK_ADB_BIN(仅绝对路径)→ Electron resourcesPath → 仓内向上查找 → PATH;electron-builder 既有 extraResources 原样带出,打包版无线功能不再依赖用户安装 platform-tools
- [x] 锁屏快捷键(P0-2 缺口):`session.lockScreen()` 注入 **KEYCODE_SLEEP=223**(真机实测:POWER=26 注入被 StepOS 过滤,且注入后会使后续 shell POWER 也失效;223 直接进 Dozing/Asleep)+ shell `input keyevent 223` 兜底;锁屏即停息屏唤醒看护(防 2s 轮询唤醒),☀ 亮屏恢复看护;与黑屏/智能黑屏叠加时先恢复亮度;工具条 🔒 按钮
- [x] 投屏旋转窗口重适配(P0-2 打磨):解码器上报解码帧实际尺寸(`onSizeChanged`)→ `video-size` 控制消息 → `session.setVideoSize` 修正反控坐标映射基准(同时修复旋转后反控落点错位)+ `refitMirrorWindow`(保持画面高度按新比例换宽度,超出工作区等比缩回)
- [x] APK 拖入即装真机验证(T33 补闭环):`pnpm probe:apk-install` 与 TransferService 同一 `client.install` 调用,真机重装 AmooNotes.apk 全绿(0.3s 完成 / pm list packages 命中 / versionName=0.1.0)
- [x] 真机探针 `pnpm probe:lock-rotate` 全绿:锁屏 Awake→Dozing(协议 223 生效)、亮屏 Asleep→Awake;**旋转实测设备限制:StepX 为固定竖屏机(USER_ROTATION 被系统忽略,ROTATE_DEVICE 即设置该值),旋转永不发生 → 无新 video-config 属预期**;尺寸回传机制(解码帧尺寸→窗口重适配+坐标映射)设备无关,待可旋转设备验证
- [x] 回归:全仓 typecheck ✓;单测 82 项全绿(adb 28 含新增 mDNS 7 项 / notes-editor 37 / scrcpy-client 17);`pnpm build` ✓;dev 冒烟启动正常(附:克隆环境需手动下载 Electron 二进制,pnpm 11 不会自动跑 postinstall)

## 录屏端到端修复与验证(已完成)

- [x] 根因 1(muxer):首帧无 description —— avcC 从未被构造(Annex-B ≠ avcC);新增 buildAvcC([1,profile,compat,level,FF,E1,spsLen,sps,1,ppsLen,pps])
- [x] 根因 2(关键帧):scrcpy 静止后只发 P 帧,录制起始永远等不到 I 帧 —— session 新增 resetVideo()(v3 RESET_VIDEO=17)请求服务端重发 config+关键帧;录制开始时自动触发
- [x] 根因 3(时间戳):mp4-muxer timestamp 单位是微秒(与 WebCodecs 一致),此前传毫秒导致时长压缩 1000 倍(AVFoundation 实测 0.012s);且服务端 PTS 为系统 uptime 时钟(≈2.9e14µs)需首帧归零
- [x] 根因 4(白屏):renderer 整包 alias 拉入 scrcpy-session 的 node:events → vite 外部化 → React 挂载失败全窗白屏;mp4 模块改走 @amoolink/scrcpy-client/mp4 子路径 alias
- [x] E2E 工程化:autotest 一次性触发(多设备列表变化不再重复起会话)、优先 ZYP 基准机、投屏启动 25s 兜底、DOM 轮询就绪、renderer console/did-fail-load/render-process-gone 诊断转发
- [x] m10-probe:协议层完整录屏链路(10s/315帧/avcC/mp4 结构)全绿
- [x] e2e-rec2:真实 UI 链路(程序化点击 ⏺→10s→⏹)全绿 —— 产物 amoolink-rec-*.mp4 1755KB,AVFoundation 终验 1200x2664 / **9.86s / 12fps 可播放**
- [x] 修复 index.ts 批量替换事故(完整重写);回归 38 单测+mirror-probe 全绿;打包更新 /Applications

### 实测记录
- 三星 988 的 MediaCodec 崩溃使投屏/录屏均不可用(画面 w=0→录制早退),E2E 需 ZYP 基准机;多台在线时 autotest 必须一次性锁定设备
- vite 新增 npm 依赖触发 re-optimize,dev 模式首屏 DOM 就绪需轮询等待而非固定延时

## M4 主体+无线+收口(已完成)

- [x] W1 无线连接:wireless-service(tcpip 5555 一键切无线/Android 11+ 配对码/直连)+ 设备页三方式面板(flash);m8-probe 真机全绿(无线连接/无线 shell/应用列表 63 个/无线启动 App/断开)
- [x] W2 应用面板:Apps 页(列表/搜索/点击启动,63 个第三方应用实测);导航「应用」项
- [x] W3 托盘真实生效:Tray 常驻(显示主窗/退出),设置开关即时生效,常驻时关窗不退
- [x] W4 开机自启真实生效:setLoginItemSettings(--hidden),开关即时生效
- [x] V1 音频转发:session audio=true(AAC,video→audio→control 三通道)+ 渲染端 AacAudioPlayer(ASC 解析/WebCodecs 解码/WebAudio 播放/静音按钮);m9-probe 全绿(codecId=0x616163/ASC/音频帧)
- [x] V2 录屏:H264Mp4Recorder(mp4-muxer + AnnexB→长度前缀)+ 工具条 ⏺/⏹,保存到接收目录;E2E rec 模式投屏存活+画面验证
- [x] V3 H.265:session video_codec=h265 + 设置页双选启用;m9 探针 H265 关键帧验证
- [x] S1 排期文档 docs/07-M4M5-排期.md(虚拟摄像头 OBS 集成先行/CMIO 插件正式方案;伴侣 APK M5-1→M5-2→M5-3 顺序)
- [x] 回归:38 单测+mirror/m8/m9 探针全绿(修复 probe 硬编码坐标→uiautomator 动态取行);打包更新 /Applications

### 实测记录
- 音频 AAC 流:连接后编码器启动慢,codecId/ASC 可晚到数秒 —— 会话侧用持续 data 泵状态机(连接后立即注册),消费侧需容错等待
- H.265 通路一次打通(v3.3.1 video_codec=h265),WebCodecs hevc 硬解可用
- 无线通道 dumpsys 偶发丢字段前缀(topResumed → Resumed),解析宽松匹配
- 设置页内容会变(测试反复进入后首行漂移),探针动态取可点击行

## M3:数据互联(已完成)

- [x] T39 ScrcpySession 剪贴板消息:控制通道下行消息泵(DeviceMessageParser 接入)+ getClipboard(等 CLIPBOARD 响应)/setClipboard(等 ACK,paste 标志)
- [x] T40 ClipboardService:手动拉取/推送 + 自动模式(1.2s 轮询,双文本防回环);编排遵循"服务不横向 import"(DeviceService.onUpdate / MirrorService 会话事件,main/index.ts wireServices)
- [x] T41 NotifyService:dumpsys --noredact 2s 轮询 → parseNotifications → diff → 系统通知(点击 monkey 启动对应 App)+ 通知页广播
- [x] T42 截图服务:screencap -p 二进制(Buffer 校验 PNG magic)→ 电脑剪贴板(+可选存盘);电脑剪贴板图片 → /sdcard/Pictures/AmooLink + 媒体扫描
- [x] T43/T44 UI(flash):设备详情 5 按钮组(投屏/手机截图/拉取剪贴板/推送剪贴板/发图到手机)+ 通知页(实时卡片+高亮渐入+清空)+ 设置(通知同步开关、auto 模式说明)
- [x] T45 单元测试:38 项全绿(通知 parser 用真机 fixture:NotificationRecord 解析/diff/noise 过滤)
- [x] T46 真机探针 `pnpm probe:m3` 全绿:SET→ACK→GET 读回一致;screencap 合法 PNG 2.5MB;cmd notification post → dumpsys 解析命中;paste 注入为观察项(该机型输入框不响应 KEYCODE_PASTE,剪贴板本体已由闭环证明)
- [x] T47 E2E `pnpm e2e:m3` 通过:应用内构造真实通知 → 通知页截屏视觉识别出该卡片(shell→轮询→广播→UI 全链路)
- [x] T48 文档与记忆更新

### M3 实测记录
- v3.3.1 SET_CLIPBOARD 带 paste 标志(offset 9);ACK(sequence)经控制通道下行,DeviceMessageParser 粘包安全
- paste=true 服务端会注入 KEYCODE_PASTE(279),该机型 EditText/输入法不响应 —— 属设备兼容性,不影响剪贴板写入(SET→GET 闭环证明)
- cmd notification post 的 tag 位置参数会同时进 android.text(样本驱动确认);cmd notification cancel 在 Android 16 shell 不可用(通知残留无害)
- 剪贴板文本同步依赖投屏会话(scrcpy 控制通道),UI 已如实提示;screencap/发图/通知独立于投屏
- Electron 45 clipboard 为异步 API:read()→ClipboardItem[]、write([new ClipboardItem({'image/png': Blob})])

## 修复:返回无效 + 中键回桌面(已完成)

- [x] G1 返回根因:StepOS 安全加固过滤注入的 KEYCODE_BACK(协议 BACK_OR_SCREEN_ON 与直接 keycode 注入均被拦;HOME/触摸不受影响)→ back 动作加 shell `input keyevent 4` 兜底(与 HOME 同模式)
- [x] G2 中键(滚轮按下)= 回桌面(阻止浏览器自动滚动);右键返回保留(原 contextmenu 通路,随 G1 修复一并生效)
- [x] G3 m7-probe 真机全绿:深链显示设置→生产路径返回生效(DisplaySettings→Settings)、仅协议返回被过滤(兜底必要)、HOME 生效;回归 38 单测全绿;重打包更新 /Applications

## 优化:横滑方向 + 操控时智能黑屏(已完成)

- [x] F6 触控板双指横滑方向修复:与纵向对称取负(-deltaX),macOS 自然滚动下双指左滑翻右页(m6 冒烟通过)
- [x] F7 智能黑屏:电脑端操控投屏 → 手机屏幕自动变黑(StepX 实测 SET_DISPLAY_POWER 静默无效,主路径为亮度→1 + DISPLAY_POWER 双保险,系统保持 Awake、投屏/反控继续);恢复时机 = 物理触屏(getevent 监听内核层事件,注入事件不误触发)或拔线/断开投屏
- [x] F8 设置→投屏→「操控时智能黑屏」开关(默认开);手动 🌙 黑屏模式保留,互不冲突
- [x] F9 m6-probe 真机全绿:亮度 5128→1→sendevent 模拟物理触屏被捕获→恢复 5128;回归(单测 38/mirror-probe 116fps)全绿;重新打包并更新 /Applications

## 修复:息屏后投屏黑屏/反控失效(已完成)

- [x] F1 根因:POWER 息屏后系统进入 Dozing,BACK_OR_SCREEN_ON 的 WAKEUP 语义对该状态无效 → 画面停更、注入丢弃;修复为直接注入 KEYCODE_WAKEUP(224)+ 协议级亮屏双保险(真机验证 Dozing→Awake)
- [x] F2 MirrorService 息屏看护:会话期间 2s 轮询 mWakefulness,Asleep/Dozing → 自动唤醒(5s 限频);黑屏模式下唤醒后 400ms 再熄物理屏
- [x] F3 默认 stayAwake=true(投屏期间阻止超时息屏)+ 设置页文案更新
- [x] F4 新增黑屏模式(🌙):SET_DISPLAY_POWER(v3 type=10)熄物理屏,系统保持 Awake,虚拟显示持续编码 —— 真机验证可用(帧继续);投屏工具条开关,断开投屏自动恢复点亮
- [x] F5 验证:m5-probe 全绿(息屏→自动唤醒→帧恢复 159→167→反控生效→黑屏模式帧继续);回归 mirror-probe/单测 38 项/typecheck/build 全绿;重新打包并更新 /Applications 安装
- 注:手机若设有锁屏密码,唤醒后会停在锁屏(密码需手动输入或键盘注入),属预期安全行为

## M2+:拖拽传输增强(已完成,对齐厂商互联体验)

- [x] T49 投屏窗口拖入上传:整窗拖拽遮罩(文件数徽标),drop → 上传到设置的 mirror.uploadDir(默认 /sdcard/Download),APK 自动识别
- [x] T50 文件页目录感知 drop:拖到目录行高亮(dashed outline),drop 上传进该目录;拖到其他区域仍传当前目录;拖入遮罩仅对本地文件激活(不再误亮)
- [x] T51 手机→电脑拖出:选中文件行 draggable,拖出窗口(dragleave→null)自动下载到接收目录并打开 Finder;原生 startDrag IPC 已备(amoolink:transfer:start-drag,因 macOS dragstart 时序风险暂未启用 UI)
- [x] T52 设置 mirror.uploadDir(默认 /sdcard/Download)+ 设置页投屏组「拖拽上传目录」输入框
- [x] T53 真机 m4-probe 全绿:目录感知上传落位 /sdcard/Music 验证 + 默认目录语义验证 + 清理;单测/类型/构建全绿
- [x] T54 文档更新 + 重新打包 DMG

### 实现说明
- 拖出窗口 = 下载到电脑并自动打开接收目录(比华为的原生拖出少一步手动;原生 startDrag 需 mousedown 同步链,与点击选择冲突,列为后续优化)
- 投屏窗口 drop 与触控 pointer 事件分层互不干扰(容器层 vs canvas 层)

## 已完成:M2 文件互传(T29-T38)

- [x] T29 TransferService 主进程:上传/下载队列(串行调度、进度节流广播、取消/重试/完成态)、基于 adbkit push/pull 流式、任务状态机
- [x] T30 FileService:设备目录列表(adbkit readdir)+ 快捷目录(/sdcard、Download、DCIM、Pictures、Movies)+ 删除
- [x] T31 拖拽上传:webUtils.getPathForFile 桥(Electron 45 无 File.path)+ Files 页拖入/按钮上传
- [x] T32 Files/Transfers 页接通(flash):面包屑/列表/多选/双击确认删除/拖拽高亮 + 队列实时卡片(进度/取消/重试/打开目录/清除已完成)
- [x] T33 APK 拖入即装:后缀识别 → 上传完成后 device.install(重装);真机安装验证未执行(避免在用户手机装未知 APK),代码路径经 typecheck+E2E 入队通路覆盖
- [x] T34 相册批量导出:DCIM 多选 → 批量下载到接收目录(UI 内实现)
- [x] T35 单元测试:32 项全绿(file-utils:joinRemote/escapeShell/formatBytes/toFileEntries + 既有)
- [x] T36 真机集成测试 `pnpm probe:m2` 全绿:2MB 文件上传→设备 md5 一致→readdir 断言→下载回本地 35.7MB/s 且 md5 一致→清理删除
- [x] T37 E2E `pnpm e2e:files` 通过:应用内自动入队 2 个真实上传任务(256KB+29B,均完成),传输页/文件页截屏经视觉识别验证渲染正确;设备端测试文件已清理
- [x] T38 文档更新(TODO/README/记忆)

### M2 实测记录
- adbkit push 的 progress 事件在小文件上可能一次都不触发(传输太快)即 end —— 进度以最终态为准
- adbkit Stats.mtime 声明为 Date、构造签名却是 number —— toFileEntries 做双形态兼容
- 上传任务与本地源文件存在生命周期耦合(运行时才 open),自测钩子不再提前删源文件

## 已完成:M1 投屏反控(T21-T28)

- [x] T21 scrcpy-server 资源落盘:v3.3.1 jar + SHA-256 + Apache-2.0 声明(resources/scrcpy/)
- [x] T22 协议层实现:自研 ScrcpySession(push → shell 启动 → 等待 INFO 行 → video+control 双连接 → 前导/帧解析/控制注入);绕过两个实测坑:adbkit Scrcpy 把 shell 流结束当服务端退出(定制 adbd 会随机断 shell 流)、其 touch/scroll 编码为 v1 格式;控制编码按 v3.3.1 服务端源码真机校准(触摸 32B 像素坐标 / 滚轮 i16 定点 2048=一格)
- [x] T23 MirrorService 主进程:会话管理、每设备投屏窗口、帧/统计 IPC 转发、自动重连(≤3 次)、窗口置顶、截图→电脑剪贴板(+可选存盘)
- [x] T24 投屏窗口引擎:WebCodecs H264 解码(Annex-B、SPS 前置、丢帧降延迟)+ Canvas 渲染 + 鼠标(点击/拖动/滚轮/右键返回)+ 键盘(文本注入+方向/回车/退格等)+ 工具条 12 项 + OSD
- [x] T25 设置持久化 + 设备页「开始投屏」入口(flash 子代理接线完成)
- [x] T26 单元测试:27 项全绿(vitest;控制消息字节级/设备消息粘包/scid/设备信息解析,样本取自真机)
- [x] T27 真机集成测试:`pnpm probe:mirror` 全绿 —— meta/SPS/关键帧断言通过,触摸反控生效(设置页真实跳转),HOME keycode 生效,末秒 112fps
- [x] T28 E2E 验证:`pnpm e2e:mirror`(AMOOLINK_AUTOTEST 自动投屏)+ 截屏视觉识别通过 —— 投屏窗口完整渲染手机画面(清晰无花屏)、OSD 与工具条就位、无错误遮罩

### M1 实测记录(重要发现,已回填实现)
- **决定性修复:scrcpy v3 重编了全部控制/设备消息类型**(v2 的 TOUCH=4 在 v3 是 BACK_OR_SCREEN_ON;v3 正确编号 KEYCODE=0/TEXT=1/TOUCH=2/SCROLL=3/BACK=4…,设备消息 CLIPBOARD=0/ACK=1/UHID=2 且 deviceName 消息已移除)。沿用 v2 编号会导致服务端解析错位(NegativeArraySizeException)并表现出"偶发导航成功/偶发断连"的假象。编号已从 jar 内 dex 反编译确认并回填 types.ts 与单测。
- 设备环境:StepX PZ261A 主力机(USB 间歇性断连);期间插入过三星 SM-G9550(Android 9),其 MediaCodec 在 app_process 下原生 SIGABRT(枚举即崩),该机当前无法投屏(硬件编解码栈问题,非 AmooLink 代码问题)
- adb CLI 直跑 app_process 在两台机器均原生 Aborted(定制 adbd/环境问题);一律走 adbkit shell 通道
- StepX 链路要求 video+control 两个 socket 齐备后才有数据回发(单连接等 dummy 会死锁)
- 断言坐标要用 uiautomator 实测可点击行(设置页第一行是搜索栏,不产生跳转)

## 已完成:M0 工程骨架

## 阶段 0:计划与设计文档

- [x] T1 保存总体计划 PLAN.md
- [x] T2 docs/01-产品需求与功能清单.md
- [x] T3 docs/02-系统架构设计.md
- [x] T4 docs/03-核心技术方案(scrcpy协议与ADB通路).md
- [x] T5 docs/04-伴侣APK设计(二期).md
- [x] T6 docs/05-安全与隐私设计.md
- [x] T7 docs/06-路线图与里程碑.md

## 阶段 1:工程骨架(核心代码)

- [x] T8 monorepo 根配置(pnpm-workspace / 根 package.json / tsconfig.base / .gitignore / .npmrc 镜像)
- [x] T9 packages/adb(@amoolink/adb:AdbTransport / DeviceManager 轮询监听 / 设备档案采集 / wireless 配对接口)
- [x] T10 packages/scrcpy-client(控制消息字节级编码 / 设备消息粘包解析 / ScrcpyClient 生命周期与 server 命令构造,启动留待 M1)
- [x] T11 apps/desktop Electron 主进程(入口 / 单实例 / 窗口管理 / IPC Hub / preload 类型化桥)
- [x] T12 主进程服务:DeviceService(真实实现,接 @amoolink/adb)+ Mirror/Transfer/Clipboard/Notify stub(带里程碑注释)
- [x] T13 渲染进程脚手架(electron-vite + React 19 + 路由 + useDevices hook)

## 阶段 2:UI(子代理)

- [x] T14 设计系统与全局样式(design tokens:色彩/字号/间距/圆角/暗色)
- [x] T15 设备管理页(设备卡片列表 + 详情面板 + 实时状态 + 无线连接入口)
- [x] T16 文件管理页 + 传输队列页(M0 展示骨架结构,M2 接通)
- [x] T17 设置页 + 投屏窗口页(M0 占位结构,M1 接通)

## 阶段 3:验证与收尾

- [x] T18 README.md(本地开发指南 + 镜像配置 + 冒烟测试说明)
- [x] T19 pnpm install(npmmirror)+ typecheck + build 全部通过(工作区包内联打包验证)
- [x] T20 真机冒烟测试:pnpm check:device 实时识别 PZ261A(型号/Android 16/1200×2670@520dpi/电量/存储 全部读取成功)

## 阶段 12:UI 打磨(vivo 风单卡 + 投屏窗口适配)

- [x] U1 设备页重构:单设备居中大卡片(hero-card:大图标+状态徽章+信息网格+电量/存储进度条),多设备时顶部胶囊切换器;移除左侧设备列
- [x] U2 按钮尺寸统一:主按钮「开始投屏」整行 50px,其余 4 个操作按钮 46px 等宽网格
- [x] U3 投屏窗口白色系统标题栏(titleBarStyle: default,win32 titleBarOverlay),画面区/工具条视觉分离
- [x] U4 黑边消除:meta 到达后 setAspectRatio(视频比例, extraSize=工具条) + 首次 setContentSize 按屏幕自适应;像素级验证左右黑边 0px
- [x] U5 打包更新 /Applications/AmooLink.app(0.1.0 arm64),生产版真机验证:单卡居中 ✓ 按钮统一 ✓ 白标题栏 ✓ 无黑边 ✓

## M6:笔记模块(docs/08)

- [x] M6-1 桌面本地笔记(packages/notes-editor + note-service + Notes 页 + 设置开关)
- [x] M6-2 同步引擎(manifest 比对 + tombstone + 冲突副本)+ 单测(37 项)
- [x] M6-3 Android 笔记 App(WebView 壳,编辑器离线 bundle,APK 已装真机)——**已拆分为独立仓库 [ANotes](https://github.com/TrancyH/ANotes)**(平级目录 `../ANotes`,android/ + editor/,独立演进;本仓保留桌面内核与同步,开发态安装路径指向 `../ANotes/android/.../app-debug.apk`)
- [x] M6-4 真机端到端 A/B/C/D 全绿(双向/冲突双副本/删除传播)+ e2e:notes + 生产版打包验收(手机写入→桌面 10s 内显示)
