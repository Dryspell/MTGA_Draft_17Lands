import { inTauri } from './platform'

export const APP_VERSION = __APP_VERSION__

const RELEASES_URL = 'https://api.github.com/repos/Dryspell/MTGA_Draft_17Lands/releases?per_page=30'
/** Overlay releases share the repo with the Python app's `v4.x` tags. */
const TAG_PREFIX = 'overlay-v'

export interface UpdateInfo {
  version: string
  url: string
  /** Downloads, installs and restarts in place. Absent when only the release page is known. */
  install?: (onProgress: (fraction: number | null) => void) => Promise<void>
}

interface Release {
  tag_name: string
  html_url: string
  draft: boolean
  prerelease: boolean
}

function parse(version: string): number[] {
  return version.split('.').map((part) => parseInt(part, 10) || 0)
}

export function isNewer(candidate: string, current: string): boolean {
  const a = parse(candidate)
  const b = parse(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff) return diff > 0
  }
  return false
}

async function latestRelease(): Promise<UpdateInfo | null> {
  const res = await fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) return null
  const releases = (await res.json()) as Release[]
  let best: UpdateInfo | null = null
  for (const r of releases) {
    if (r.draft || r.prerelease || !r.tag_name.startsWith(TAG_PREFIX)) continue
    const version = r.tag_name.slice(TAG_PREFIX.length)
    if (!best || isNewer(version, best.version)) best = { version, url: r.html_url }
  }
  return best && isNewer(best.version, APP_VERSION) ? best : null
}

/** A signed in-place update from the updater feed (desktop app only). */
async function signedUpdate(): Promise<UpdateInfo | null> {
  const [{ check }, { invoke }, { relaunch }] = await Promise.all([
    import('@tauri-apps/plugin-updater'),
    import('@tauri-apps/api/core'),
    import('@tauri-apps/plugin-process'),
  ])
  const update = await check()
  if (!update) return null
  return {
    version: update.version,
    url: `https://github.com/Dryspell/MTGA_Draft_17Lands/releases/tag/${TAG_PREFIX}${update.version}`,
    install: async (onProgress) => {
      let total = 0
      let received = 0
      await update.download((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? 0
        else if (event.event === 'Progress') {
          received += event.data.chunkLength
          onProgress(total ? received / total : null)
        }
      })
      onProgress(null)
      // The installer has to replace the engine's executable, so stop it first.
      await invoke('stop_bridge')
      await update.install()
      await relaunch()
    },
  }
}

/** Resolves to the newest overlay release if it is newer than this build, otherwise null. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (inTauri) {
    try {
      return await signedUpdate()
    } catch {
      // No signed feed yet (or offline): fall back to linking the release page.
    }
  }
  return latestRelease()
}
