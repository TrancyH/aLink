# resources

运行时随包分发的资源目录(electron-builder `extraResources` 打包,M1 起启用):

| 文件 | 用途 | 引入里程碑 | 许可 |
|---|---|---|---|
| `scrcpy-server.jar` | 投屏服务端,推送到手机 `/data/local/tmp` 后由 app_process 启动 | M1 | Apache-2.0(来自 [Genymobile/scrcpy](https://github.com/Genymobile/scrcpy) releases,须保留其版权与许可声明) |
| `bin/{darwin,win32}/adb` | 无线配对(`adb pair`)与兜底 CLI 使用;日常通路走 adbkit 纯 JS | M1 | Android platform-tools(Apache-2.0) |
| `checksums.sha256` | 上述二进制的哈希清单,启动时校验(见 docs/05 §6) | M1 | — |

M0 阶段本目录仅含说明;下载脚本与哈希校验在 M1 添加。
