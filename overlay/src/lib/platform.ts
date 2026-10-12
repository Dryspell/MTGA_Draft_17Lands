import { api } from '../api'

export const inTauri = '__TAURI_INTERNALS__' in window

type Filter = { name: string; extensions: string[] }

export async function pickFile(title: string, filters?: Filter[], defaultPath?: string): Promise<string | null> {
  if (!inTauri) return window.prompt(`${title}\nEnter the full file path:`)?.trim() || null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({ title, filters, defaultPath, multiple: false, directory: false })
  return typeof result === 'string' ? result : null
}

export async function pickFolder(title: string): Promise<string | null> {
  if (!inTauri) return window.prompt(`${title}\nEnter the full folder path:`)?.trim() || null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({ title, directory: true, multiple: false })
  return typeof result === 'string' ? result : null
}

/** Returns a path in Tauri; null in the browser, where callers fall back to a download. */
export async function pickSavePath(title: string, defaultName: string, filters: Filter[]): Promise<string | null> {
  if (!inTauri) return null
  const { save } = await import('@tauri-apps/plugin-dialog')
  return save({ title, defaultPath: defaultName, filters })
}

export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

export async function copyText(text: string) {
  if (inTauri) {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(text)
  } else {
    await navigator.clipboard.writeText(text)
  }
}

export async function readClipboard(): Promise<string> {
  if (inTauri) {
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager')
    return readText()
  }
  try {
    return await navigator.clipboard.readText()
  } catch {
    return window.prompt('Paste the card list:') ?? ''
  }
}

export const openUrl = (url: string) => api.openUrl(url)

export async function currentWindow() {
  if (!inTauri) return null
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow()
}

export async function setWindowSize(width: number, height: number, minWidth: number, minHeight: number) {
  const win = await currentWindow()
  if (!win) return
  const { LogicalSize } = await import('@tauri-apps/api/dpi')
  await win.setMinSize(new LogicalSize(minWidth, minHeight))
  await win.setSize(new LogicalSize(width, height))
}

export async function windowSize(): Promise<{ width: number; height: number } | null> {
  const win = await currentWindow()
  if (!win) return null
  const [size, scale] = await Promise.all([win.innerSize(), win.scaleFactor()])
  return { width: Math.round(size.width / scale), height: Math.round(size.height / scale) }
}

export async function setAlwaysOnTop(value: boolean) {
  const win = await currentWindow()
  await win?.setAlwaysOnTop(value)
}
