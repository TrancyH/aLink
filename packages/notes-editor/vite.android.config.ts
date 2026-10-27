import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/** 编辑器 Android 离线 bundle:IIFE 单文件 → apps/android-notes assets。 */
export default defineConfig({
  build: {
    outDir: resolve(__dirname, '../../apps/android-notes/app/src/main/assets/editor'),
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/android-main.ts'),
      name: 'AmooNotesLib',
      formats: ['iife'],
      fileName: () => 'editor.js',
    },
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        assetFileNames: (info) => (info.name?.endsWith('.css') ? 'editor.css' : '[name][extname]'),
      },
    },
  },
})
