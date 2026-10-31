# resources/bin — 随包分发的 adb 二进制

`packages/adb/src/wireless.ts` 的 `resolveAdbBinary()` 会优先使用本目录（打包后经
electron-builder `extraResources` 落在 `<resourcesPath>/resources/bin/`），使打包版
无线配对 / 连接 / mDNS 发现不依赖用户系统安装 platform-tools。
覆盖方式：设置环境变量 `ADB_PATH`（或 `AMOOLINK_ADB_BIN`，仅接受绝对路径）。

## darwin/

- `adb`：Homebrew `android-platform-tools` v36.0.2（Mach-O universal：x86_64 + arm64），
  Intel 与 Apple Silicon 均原生运行，无 Rosetta 依赖。
- 来源：<https://formulae.brew.sh/formula/android-platform-tools>（上游为 Android SDK platform-tools）

## win32/

- `adb.exe` + `AdbWinApi.dll` + `AdbWinUsbApi.dll` + `libwinpthread-1.dll`：官方
  platform-tools r37.0.1（`source.properties` 记录版本，`NOTICE.txt` 为上游声明）。
- 来源：<https://dl.google.com/android/repository/platform-tools-latest-windows.zip>

## 许可

Android platform-tools 由 AOSP 分发（Apache-2.0；含各上游组件声明，见 win32/NOTICE.txt），
再分发随附其声明文件。
