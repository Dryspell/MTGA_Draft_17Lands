export const APP_VERSION = __APP_VERSION__

const RELEASES_URL = 'https://api.github.com/repos/Dryspell/MTGA_Draft_17Lands/releases?per_page=30'
/** Overlay releases share the repo with the Python app's `v4.x` tags. */
const TAG_PREFIX = 'overlay-v'

export interface UpdateInfo {
  version: string
  url: string
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

/** Resolves to the newest overlay release if it is newer than this build, otherwise null. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
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
