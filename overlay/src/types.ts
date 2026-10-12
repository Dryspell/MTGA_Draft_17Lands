export type StatField =
  | 'gihwr' | 'ohwr' | 'gpwr' | 'gnswr' | 'gdwr' | 'iwd' | 'alsa' | 'ata'
  | 'gih' | 'ngp' | 'ngoh' | 'ngd' | 'ngnd' | 'samples'

export type CardStats = Partial<Record<StatField, number>>

export interface Recommendation {
  score: number
  baseWinRate: number
  zScore: number
  castProbability: number
  wheelChance: number
  reasoning: string[]
  isElite: boolean
  archetypeFit: string
  tags: string[]
}

export interface Card {
  name: string
  manaCost: string
  colors: string[]
  types: string[]
  subtypes: string[]
  rarity: string
  cmc: number
  images: string[]
  tags: string[]
  count: number
  returnableAt: number[]
  deckColors: Record<string, CardStats>
  tiers: Record<string, string>
  recommendation: Recommendation | null
}

/** [mean, std] per archetype and win-rate field. */
export type Metrics = Record<string, Record<string, [number, number]>>

export interface RecapEntry {
  name: string
  gihwr: number
}

export interface PickEntry {
  name: string
  pack: number
  pick: number
  value: number
  delta: number
}

export interface Recap {
  poolPower: number
  grade: string
  top23Avg: number
  formatAvg: number
  archetypes: { key: string; name: string; gihwr: number }[]
  bestCards: RecapEntry[]
  steals: PickEntry[]
  reaches: PickEntry[]
  tribes: { name: string; count: number }[]
  roles: { tag: string; count: number }[]
  staples: RecapEntry[]
  lands: RecapEntry[]
  rares: RecapEntry[]
  typeCounts: Record<string, number>
}

export interface Snapshot {
  status: string
  event: { set: string; type: string; label: string }
  draftId: string
  startTime: string
  pack: number
  pick: number
  logFile: string
  isLiveLog: boolean
  dataset: string
  hasDatasets: boolean
  sources: { setCode: string; setName: string; events: Record<string, Record<string, string>> }
  filter: string
  filterOptions: Record<string, string>
  metrics: Metrics
  tierOptions: Record<string, string>
  packCards: Card[]
  missingCards: Card[]
  pickedNames: string[]
  pool: Card[]
  poolSize: number
  signals: Record<string, number>
  curve: number[]
  creatureCount: number
  noncreatureCount: number
  typeCounts: Record<string, number>
  isSealed: boolean
  draftComplete: boolean
  recap: Recap | null
}

export interface Meta {
  version: string
  colorNames: Record<string, string>
  deckColors: string[]
  tagVisuals: Record<string, string>
  columnLabels: Record<string, string>
  winRateFields: string[]
  gradeDeviations: Record<string, number>
  resultFormats: string[]
  filterFormats: string[]
  uiSizes: string[]
  limitedTypes: string[]
  userGroups: string[]
  timePeriods: string[]
  basicLands: string[]
}

export interface Settings {
  column_configs: Record<string, string[]>
  table_sort_states: Record<string, { column: string; reverse: boolean }>
  collapsible_states: Record<string, boolean>
  deck_filter: string
  filter_format: string
  result_format: string
  ui_size: string
  theme_palette: string
  theme: string
  always_on_top: boolean
  card_colors_enabled: boolean
  draft_log_enabled: boolean
  update_notifications_enabled: boolean
  missing_notifications_enabled: boolean
  auto_sync_datasets: boolean
  show_splash_screen: boolean
  arena_log_location: string
  arena_log_pinned: boolean
  database_location: string
  [key: string]: unknown
}

export interface DeckBucket {
  distribution: number[]
  maximum_card_count: number
  recommended_creature_count: number
  cmc_average: number
}

export interface Config {
  settings: Settings
  card_logic: { deck_mid: DeckBucket; [key: string]: unknown }
  features: { images_enabled?: boolean; [key: string]: unknown }
  card_data: { latest_dataset: string; excluded_datasets: string[]; [key: string]: unknown }
}

export type JobStatus = 'running' | 'done' | 'error'

export interface Job<T = unknown> {
  id: string
  kind: string
  status: JobStatus
  message: string
  progress: number | null
  result?: T
  data?: Record<string, unknown>
}

export type BridgeMessage =
  | { type: 'status'; status: string }
  | { type: 'snapshot'; snapshot: Snapshot }
  | ({ type: 'job' } & Job)

export interface DeckEntry {
  name: string
  count: number
}

export interface SimStats {
  cast_t2: number
  cast_t3: number
  cast_t4: number
  curve_out: number
  removal_t4: number
  mulligans: number
  avg_hand_size: number
  screw_t3: number
  screw_t4: number
  color_screw_t3: number
  flood_t5: number
  [key: string]: number
}

export interface DeckView {
  deck: Card[]
  sideboard: Card[]
  stats: SimStats | null
  note: string | null
  advice: string[]
}

export interface DeckVariant extends DeckView {
  label: string
  colors: string[]
  archetype: string
  rating: number
  record: string
  breakdown: string
}

export interface SealedState {
  id: string
  label: string
  variants: string[]
  active: string
  main: Card[]
  sideboard: Card[]
  poolSize: number
  warning?: string | null
}

export interface DatasetFile {
  set: string
  event: string
  group: string
  start: string
  end: string
  games: number
  filename: string
  collected: string
  active: boolean
}

export interface SetOption {
  name: string
  code: string
  formats: string[]
  startDate: string
  live: boolean
}

export interface TierFile {
  set: string
  label: string
  date: string
  filename: string
}

export interface HistoryLog {
  path: string
  file: string
  set: string
  event: string
  time: string
}
