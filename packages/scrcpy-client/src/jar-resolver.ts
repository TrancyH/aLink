import prebuilds from '@u4/minicap-prebuilt'

/**
 * adbkit 的 Scrcpy.start() 内部通过 @u4/minicap-prebuilt 的 getScrcpyJar(version)
 * 定位 server jar,该函数基于 import.meta.url 解析 —— 被 electron-vite 打包后路径失效。
 * 这里在模块加载后替换其实现,指向 AmooLink resources 内置的 jar(带 SHA-256 校验)。
 */
type Prebuilds = { getScrcpyJar: (version: string) => string }
const mutablePrebuilds = prebuilds as Prebuilds
export const originalGetScrcpyJar = mutablePrebuilds.getScrcpyJar.bind(mutablePrebuilds)

/** 将 adbkit 使用的 scrcpy-server jar 固定为指定路径(须在创建任何会话前调用一次)。 */
export function overrideScrcpyJar(jarPath: string): void {
  mutablePrebuilds.getScrcpyJar = () => jarPath
}

/** 恢复默认 jar 解析(主要用于测试)。 */
export function restoreScrcpyJar(): void {
  mutablePrebuilds.getScrcpyJar = originalGetScrcpyJar
}
