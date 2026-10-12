import type {
  Card, Config, DatasetFile, DeckEntry, DeckView, GameRecord, HistoryLog, Job, Meta, SealedState, SetOption, TierFile,
} from './types'

export const HOST = import.meta.env.VITE_BRIDGE_HOST ?? '127.0.0.1:8617'
const HTTP = `http://${HOST}`

export class ApiError extends Error {}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${HTTP}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const err = await res.json()
      if (typeof err.detail === 'string') detail = err.detail
    } catch {
      // keep status text
    }
    throw new ApiError(detail)
  }
  return res.json()
}

const get = <T>(path: string) => request<T>('GET', path)
const post = <T>(path: string, body: unknown = {}) => request<T>('POST', path, body)
const del = <T>(path: string) => request<T>('DELETE', path)

type Deck = { deck: DeckEntry[]; sideboard?: DeckEntry[] }

export const api = {
  meta: () => get<Meta>('/api/meta'),
  config: () => get<Config>('/api/config'),
  patchConfig: (patch: Record<string, Record<string, unknown>>) => request<Config>('PATCH', '/api/config', patch),
  resetConfig: () => post<Config>('/api/config/reset'),

  reload: () => post('/api/reload'),
  setDataset: (filename: string) => post('/api/dataset/active', { filename }),
  history: () => get<{ live: string | null; logs: HistoryLog[]; current: string }>('/api/history'),
  openLog: (path: string) => post('/api/log/open', { path }),
  locateMtgaData: (path: string) => post<{ path: string }>('/api/mtga-data', { path }),
  exportDraft: (format: 'csv' | 'json', path?: string) =>
    post<{ content?: string; path?: string }>('/api/export', { format, path }),
  cardNames: () => get<string[]>('/api/cards/names'),
  lookupCards: (names: string[]) => post<Card[]>('/api/cards/lookup', { names }),
  openUrl: (url: string) => post('/api/open-url', { url }),
  draftRecord: (draftId: string) =>
    get<{ wins?: number; losses?: number; url?: string }>(`/api/draft-record?draft_id=${encodeURIComponent(draftId)}`),

  datasets: () =>
    get<{ files: DatasetFile[]; sets: SetOption[]; excluded: string[]; liveSets: string[] }>('/api/datasets'),
  downloadDataset: (body: { set: string; event: string; group: string; period: string; threshold: number }) =>
    post<Job>('/api/datasets/download', body),
  deleteDataset: (filename: string) => del(`/api/datasets/${encodeURIComponent(filename)}`),
  clearInactive: () => post<{ removed: number; failures: string[]; liveSets: string[] }>('/api/datasets/clear-inactive'),
  restoreExcluded: () => post('/api/datasets/restore'),
  resetDatasets: () => post<{ removed: number }>('/api/datasets/reset'),

  tiers: () => get<TierFile[]>('/api/tiers'),
  importTier: (url: string, label: string) => post<Job>('/api/tiers/import', { url, label }),
  deleteTier: (filename: string) => del(`/api/tiers/${encodeURIComponent(filename)}`),

  suggestDeck: () => post<Job>('/api/deck/suggest'),
  analyzeDeck: (d: Deck) => post<Job<DeckView>>('/api/deck/analyze', d),
  autoLands: (d: Deck) => post<Job<DeckView>>('/api/deck/auto-lands', d),
  optimizeDeck: (d: Deck) => post<Job<DeckView>>('/api/deck/optimize', d),
  exportDeck: (d: Deck) => post<{ text: string }>('/api/deck/export', d),

  practiceSets: () => get<{ code: string; label: string; active: boolean }[]>('/api/sealed/sets'),
  practiceSealed: (code: string, mode: 'generate' | 'import', text = '') =>
    post<SealedState>('/api/sealed/practice', { code, mode, text }),
  games: () => get<GameRecord[]>('/api/games'),
  buildRecords: (sessionId: string) => get<Record<string, { wins: number; losses: number }>>(`/api/games/records?session_id=${encodeURIComponent(sessionId)}`),
  liveSealed: () => post<SealedState>('/api/sealed/live'),
  sealed: (id: string) => get<SealedState>(`/api/sealed/${id}`),
  sealedAction: (id: string, body: { op: string; name?: string; new_name?: string; card?: string; count?: number; text?: string; cards?: DeckEntry[] }) =>
    post<SealedState>(`/api/sealed/${id}/action`, body),
  sealedShells: (id: string) => post<Job<SealedState>>(`/api/sealed/${id}/shells`),
  sealedExport: (id: string, target: 'mtga' | 'sealeddeck') =>
    post<{ text: string; url?: string | null; error?: string }>(`/api/sealed/${id}/export?target=${target}`),
}

export const toEntries = (cards: Card[]): DeckEntry[] => cards.map((c) => ({ name: c.name, count: c.count }))
