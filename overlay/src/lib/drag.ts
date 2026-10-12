import type { DragEvent } from 'react'

export type DragSource = 'deck' | 'pool' | 'basic'

export interface DraggedCard {
  name: string
  from: DragSource
}

const MIME = 'application/x-mtga-card'

export function startCardDrag(e: DragEvent, card: DraggedCard) {
  e.dataTransfer.setData(MIME, JSON.stringify(card))
  e.dataTransfer.setData('text/plain', card.name)
  e.dataTransfer.effectAllowed = 'move'
}

/** Payloads are only readable on drop, so drag-over checks the type list instead. */
export const isCardDrag = (e: DragEvent) => e.dataTransfer.types.includes(MIME)

export function readCardDrag(e: DragEvent): DraggedCard | null {
  try {
    return JSON.parse(e.dataTransfer.getData(MIME)) as DraggedCard
  } catch {
    return null
  }
}
