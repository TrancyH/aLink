import { describe, expect, it } from 'vitest'
import { joinRemote, escapeShell, formatBytes, toFileEntries } from '../src/file-utils.js'

describe('joinRemote', () => {
  it('拼接并压缩重复斜杠', () => {
    expect(joinRemote('/sdcard/Download', 'a.bin')).toBe('/sdcard/Download/a.bin')
    expect(joinRemote('/sdcard/Download/', 'a.bin')).toBe('/sdcard/Download/a.bin')
    expect(joinRemote('/sdcard//Download///', 'a.bin')).toBe('/sdcard/Download/a.bin')
  })
})

describe('escapeShell', () => {
  it('转义单引号', () => {
    expect(escapeShell("/sdcard/it's.bin")).toBe("/sdcard/it'\\''s.bin")
    expect(escapeShell('/sdcard/a b.bin')).toBe('/sdcard/a b.bin')
  })
})

describe('formatBytes', () => {
  it('单位分级', () => {
    expect(formatBytes(0)).toBe('0B')
    expect(formatBytes(512)).toBe('512B')
    expect(formatBytes(2048)).toBe('2.0KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0MB')
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5GB')
    expect(formatBytes(-1)).toBe('?')
  })
})

describe('toFileEntries', () => {
  const raw = (name: string, isDir: boolean, size = 100): {
    name: string
    size: number
    mtime: number
    isDirectory: () => boolean
  } => ({
    name,
    size,
    mtime: 1700000000,
    isDirectory: () => isDir,
  })

  it('目录排前,同级按名称', () => {
    const out = toFileEntries([raw('b.bin', false), raw('Zdir', true), raw('a.bin', false), raw('Adir', true)])
    expect(out.map((e) => e.name)).toEqual(['Adir', 'Zdir', 'a.bin', 'b.bin'])
  })

  it('字段映射(size/mtime → number,兼容 Date 与秒)', () => {
    const fromNumber = toFileEntries([{ name: 'x', size: 5n, mtime: 2n, isDirectory: () => false }])
    expect(fromNumber[0]).toEqual({ name: 'x', isDir: false, size: 5, mtimeMs: 2000 })
    const fromDate = toFileEntries([
      { name: 'y', size: 7, mtime: new Date(1700000000000), isDirectory: () => false },
    ])
    expect(fromDate[0]?.mtimeMs).toBe(1700000000000)
  })
})
