import { createContext, useContext, type MouseEvent } from 'react'
import type { Card } from '../types'

export interface CardInteractions {
  hover: (card: Card | null, el?: HTMLElement) => void
  menu: (card: Card, e: MouseEvent) => void
}

export const CardInteractionsContext = createContext<CardInteractions>({ hover: () => {}, menu: () => {} })

/** Props that give any element the card tooltip and context menu. */
export function useCardProps(card: Card) {
  const { hover, menu } = useContext(CardInteractionsContext)
  return {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => hover(card, e.currentTarget),
    onMouseLeave: () => hover(null),
    onContextMenu: (e: MouseEvent) => menu(card, e),
  }
}
