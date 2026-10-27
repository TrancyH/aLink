import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const adbSrc = resolve(__dirname, '../../packages/adb/src/index.ts')
const scrcpySrc = resolve(__dirname, '../../packages/scrcpy-client/src/index.ts')
// mp4 录制模块必须走子路径:整包 alias 会把 scrcpy-session(node:events/fs)拉进浏览器 bundle
const mp4Src = resolve(__dirname, '../../packages/scrcpy-client/src/mp4-recorder.ts')
const notesEditorSrc = resolve(__dirname, '../../packages/notes-editor/src/index.ts')
const notesEditorReactSrc = resolve(__dirname, '../../packages/notes-editor/src/react.ts')

// 工作区包(@amoolink/*)必须内联打包:其 main 指向 TS 源码,外置成 require 会运行时失败;
// @u4/adbkit v5 纯 ESM,被内联进 CJS 产物后才能被主进程加载(electron 由 electron-vite 内置外置)。
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@amoolink/adb', '@amoolink/scrcpy-client', '@amoolink/notes-editor'] })],
    resolve: {
      alias: {
        '@amoolink/adb': adbSrc,
        '@amoolink/scrcpy-client': scrcpySrc,
        '@amoolink/notes-editor': notesEditorSrc,
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@amoolink/adb'] })],
    resolve: {
      alias: {
        '@amoolink/adb': adbSrc,
      },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: [
        { find: /^@amoolink\/scrcpy-client\/mp4$/, replacement: mp4Src },
        { find: '@amoolink/adb', replacement: adbSrc },
        { find: '@amoolink/scrcpy-client', replacement: scrcpySrc },
        { find: /^@amoolink\/notes-editor\/react$/, replacement: notesEditorReactSrc },
        { find: /^@amoolink\/notes-editor$/, replacement: notesEditorSrc },
        { find: '@renderer', replacement: resolve(__dirname, 'src/renderer') },
      ],
    },
  },
})
