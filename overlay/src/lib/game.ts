/** "Phase_Combat" + "Step_DeclareAttack" -> "Combat · Declare attack" */
export function phaseLabel(phase: string, step: string) {
  const words = (s: string) => s.replace(/^(Phase|Step)_/, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase()
  const p = words(phase)
  const s = words(step)
  const label = s && s !== p ? `${p} · ${s}` : p
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export const eventLabel = (eventId: string) => eventId.replace(/_\d{8}$/, '').replace(/_/g, ' ')
