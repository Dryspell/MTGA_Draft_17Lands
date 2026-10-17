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
  meta_enabled: boolean
  meta_mtgtop8: boolean
  meta_spicerack_key: string
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

export interface PaperList {
  cards: DeckEntry[]
  text: string
  digital: DeckEntry[]
  rebalanced: string[]
  basics: number
  tcgplayerUrl: string
  cardKingdomUrl: string
}

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
  | { type: 'game'; game: GameView | null }
  | { type: 'decks'; version: number }
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

export interface BoardCard extends Card {
  grpId: number
  instanceId: number
  power?: number | null
  toughness?: number | null
  tapped: boolean
  token: boolean
}

export interface GameSide {
  life: number
  hand: number
  library: number
  graveyard: number
  lands: { untapped: number; total: number; colors: string[] }
  battlefield: BoardCard[]
}

export type GameFormat = 'limited' | 'constructed'

export interface SideboardChanges {
  in: DeckEntry[]
  out: DeckEntry[]
}

/** Past opponents whose revealed spells overlap this one's (or, failing that, on the same colors), and what else they showed. */
export interface SimilarOpponents {
  games: number
  wins: number
  losses: number
  archetype: string
  basis: 'cards' | 'colors'
  cards: (Card & { games: number })[]
}

export interface Versus {
  games: number
  wins: number
  losses: number
  last: string
  archetypes: string[]
  cards: string[]
}

export interface Outs {
  key: string
  label: string
  copies: number
  /** Chance within the next 1, 2 and 3 draws. */
  odds: [number, number, number]
}

export interface SideboardGuide {
  key: string
  in: DeckEntry[]
  out: DeckEntry[]
  note: string
  updated?: string
}

export interface MulliganAdvice {
  verdict: 'keep' | 'risky' | 'mulligan'
  handSize: number
  mulligans: number
  onPlay: boolean
  lands: number
  spells: number
  colors: string[]
  missingColors: string[]
  landBy2: number
  landBy3: number
  landBy4: number
  reasons: string[]
}

export type TrickCard = Card & { trickKind: string; source: 'set' | 'revealed' | 'seen before'; seenIn?: number }

export interface GameView {
  matchId: string
  gameNumber: number
  eventId: string
  format: GameFormat
  deck: { id: string | null; name: string }
  match: {
    wins: number
    losses: number
    sideboard: SideboardChanges
    games: { gameNumber: number; result: string | null; onPlay: boolean | null; turns: number }[]
    sideboarding: boolean
    guide: SideboardGuide | null
  }
  active: boolean
  result: 'win' | 'loss' | 'draw' | null
  turn: number
  phase: string
  step: string
  myTurn: boolean
  onPlay: boolean | null
  me: GameSide
  opponent: GameSide & {
    name: string
    colors: string[]
    archetype: string
    archetypeName: string
    localArchetype?: string
    meta?: MetaHit
    seen: Card[]
    similar: SimilarOpponents | null
    plays: { turn: number; plays: { name: string; land: boolean; cmc: number }[] }[]
    versus: Versus | null
  }
  tricks: TrickCard[]
  mulligan: MulliganAdvice | null
  library: { size: number; tracked: boolean; landNext: number; landWithin2: number; outs: Outs[]; cards: (Card & { nextDraw: number })[] }
}

export interface GameRecord {
  id: string
  matchId: string
  gameNumber: number
  eventId: string
  format?: GameFormat
  deckId?: string | null
  deckName?: string
  time: string
  result: 'win' | 'loss' | 'draw'
  onPlay: boolean | null
  mulligans: number
  turns: number
  deck: DeckEntry[]
  sideboard?: SideboardChanges
  opponent: { name?: string; colors: string[]; archetype: string; archetypeName?: string; cards: DeckEntry[] }
  mana: { cardsSeen: number; landsSeen: number; landPct: number; missedDrops: number[]; verdict: 'screw' | 'flood' | 'smooth' }
  life: [number, number, number][]
  timeline: { turn: number; mine: boolean; action: string; name: string }[]
}

export interface WinLoss {
  wins: number
  losses: number
  games: number
}

export type KeyedWinLoss = WinLoss & { key: string }

export interface ConstructedDeckSummary {
  id: string
  name: string
  format: string
  source: 'arena' | 'import'
  known: boolean
  count: number
  colors: string[]
  lastPlayed: string
  lastUpdated: string
  tileImage: string | null
  record: WinLoss
}

export type DeckCard = Card & { grpId: number; text?: string; keywords?: string[] }

export interface CollectionCheck {
  cards: { name: string; need: number; owned: number; missing: number; rarity: string }[]
  wildcards: Record<string, number>
  balance: Record<string, number>
  affordable: boolean | null
  unknown?: string[]
}

export interface RecordBreakdown {
  overall: WinLoss
  onPlay: WinLoss
  onDraw: WinLoss
  byEvent: KeyedWinLoss[]
  byOpponent: KeyedWinLoss[]
  mulliganRate: number
}

export interface ConstructedDeck extends ConstructedDeckSummary {
  main: DeckCard[]
  side: DeckCard[]
  commander: DeckCard[]
  companions: DeckCard[]
  collection: CollectionCheck
  text: string
  stats: RecordBreakdown
  recent: { id: string; time: string; result: string; eventId: string; onPlay: boolean | null; opponent: string; colors: string[] }[]
  versions: DeckVersion[]
  guides: SideboardGuide[]
  sideboardHistory: (WinLoss & { key: string; in: DeckEntry[]; out: DeckEntry[]; time: string })[]
  metaFormat: string
  metaArchetypes: string[]
  unknown?: string[]
}

// ---- tournament metagame ----

export type MetaSource = 'spicerack' | 'mtgtop8'

export interface MetaHit {
  id: string
  name: string
  share: number
  source: MetaSource
  score: number
  matched: string[]
}

export interface MetaOverview {
  enabled: boolean
  mtgtop8: boolean
  hasKey: boolean
  suggested: string
  formats: { format: string; sources: Record<MetaSource, boolean>; available: boolean; fetched: string; archetypes: number; stale: boolean; played: number }[]
}

export interface MetaCard {
  name: string
  inclusion: number
  avg: number
  land: boolean
}

export interface MetaDeck {
  id: string
  source: MetaSource
  player: string
  event: string
  rank: string
  date: string
  url: string
  wins?: number
  losses?: number
  main: DeckEntry[]
  side: DeckEntry[]
  cost?: { wildcards: Record<string, number>; affordable: boolean | null; missing: number } | null
}

export interface MetaArchetype {
  id: string
  name: string
  style: string
  share: number
  source: MetaSource
  url: string
  colors: string[]
  cards: MetaCard[]
  deckCount: number
  tournamentDecks: number
  winRate: number | null
  matches: number
  decks: MetaDeck[]
  record: WinLoss
}

export interface MetaFormatData {
  format: string
  enabled: boolean
  fetched?: string
  sources?: Partial<Record<MetaSource, { ok: boolean; error?: string; stale?: boolean; decks?: number; archetypes?: number }>>
  archetypes: MetaArchetype[]
  unmatched?: WinLoss
  job?: Job | null
}

export interface MetaCompare {
  format: string
  archetype: Pick<MetaArchetype, 'id' | 'name' | 'share' | 'source' | 'colors' | 'deckCount' | 'winRate' | 'url'>
  similarity: number
  options: { id: string; name: string; similarity: number }[]
  missing: { name: string; have: number; typical: number; inclusion: number; land: boolean }[]
  extra: { name: string; count: number; inclusion: number }[]
  nearest: (Omit<MetaDeck, 'main' | 'side' | 'cost'> & { add: DeckEntry[]; cut: DeckEntry[] }) | null
}

export interface DeckVersion {
  key: string
  at: string
  count: number
  current: boolean
  added: DeckEntry[]
  removed: DeckEntry[]
  record: WinLoss
}

export interface ConstructedStats extends RecordBreakdown {
  byDeck: (KeyedWinLoss & { name: string; onPlay: WinLoss; onDraw: WinLoss })[]
  byOpponentColors: KeyedWinLoss[]
}

export interface MatchSummary {
  matchId: string
  eventId: string
  format: GameFormat
  time: string
  result: 'win' | 'loss' | 'draw'
  wins: number
  losses: number
  deckName: string
  opponent: { name: string; archetypeName: string; colors: string[] }
  note: string
  games: { id: string; gameNumber: number; result: string; onPlay: boolean | null; turns: number; mulligans: number; sideboard: SideboardChanges }[]
}
