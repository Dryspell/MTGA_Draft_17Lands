export type Color = 'W' | 'U' | 'B' | 'R' | 'G'

export interface CardStats {
  gihwr: number
  ohwr: number
  gpwr: number
  iwd: number
  alsa: number
  ata: number
  gih: number
}

export interface Recommendation {
  score: number
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
  rarity: string
  cmc: number
  images: string[]
  tags: string[]
  count: number
  returnableAt: number[]
  stats: { all: CardStats; filter: CardStats }
  grade: string | null
  gradeAll: string | null
  recommendation: Recommendation | null
}

export interface Snapshot {
  status: string
  event: { set: string; type: string }
  draftId: string
  pack: number
  pick: number
  isLiveLog: boolean
  dataset: string
  filter: string
  packCards: Card[]
  missingCards: Card[]
  pool: Card[]
  poolSize: number
  signals: Record<Color, number>
  curve: number[]
  creatureCount: number
  noncreatureCount: number
}

export type BridgeMessage =
  | { type: 'status'; status: string }
  | { type: 'snapshot'; snapshot: Snapshot }
