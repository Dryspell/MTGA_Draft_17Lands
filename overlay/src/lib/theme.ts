/** Accent colors standing in for the Tk app's "Mana Flair" palettes. */
export const PALETTES: Record<string, { accent: string; tint: string }> = {
  Neutral: { accent: '#8b7cf6', tint: '17 18 23' },
  Dark: { accent: '#94a3b8', tint: '12 12 14' },
  Plains: { accent: '#e0b94a', tint: '24 22 17' },
  Island: { accent: '#4ea7e6', tint: '14 20 28' },
  Swamp: { accent: '#a990c4', tint: '20 16 24' },
  Mountain: { accent: '#f0624f', tint: '26 16 15' },
  Forest: { accent: '#4fbf75', tint: '14 22 17' },
  Wastes: { accent: '#a8a29e', tint: '20 19 18' },
}

export function applyTheme(palette: string | undefined, uiSize: string | undefined, light = false) {
  const p = PALETTES[palette ?? ''] ?? PALETTES.Neutral
  const root = document.documentElement
  root.dataset.theme = light ? 'light' : 'dark'
  root.style.setProperty('--color-accent', p.accent)
  root.style.setProperty(
    '--color-surface',
    light ? `color-mix(in srgb, ${p.accent} 6%, rgb(250 250 249 / 0.98))` : `rgb(${p.tint} / 0.97)`,
  )
  const scale = parseInt(uiSize ?? '100', 10)
  if (Number.isFinite(scale) && scale > 0 && scale !== 100) root.style.setProperty('zoom', String(scale / 100))
  else root.style.removeProperty('zoom')
}
