import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Card } from '../types'

interface Hover {
  card: Card
  y: number
}

const PreviewContext = createContext<(hover: Hover | null) => void>(() => {})

export const usePreview = () => useContext(PreviewContext)

const WIDTH = 220
const HEIGHT = WIDTH * 1.395

export function PreviewProvider({ children }: { children: ReactNode }) {
  const [hover, setHover] = useState<Hover | null>(null)
  const image = hover?.card.images[0]
  const top = hover ? Math.max(8, Math.min(hover.y - HEIGHT / 2, window.innerHeight - HEIGHT - 8)) : 0

  return (
    <PreviewContext.Provider value={setHover}>
      {children}
      {image && (
        <img
          src={image}
          alt={hover.card.name}
          className="pointer-events-none fixed right-3 z-50 rounded-[10px] shadow-2xl shadow-black/70 ring-1 ring-white/10"
          style={{ top, width: WIDTH, height: HEIGHT }}
        />
      )}
    </PreviewContext.Provider>
  )
}
