import { createContext, useContext } from 'react'
import type { Config, Job, Meta, Settings, Snapshot } from './types'

export type Tone = 'info' | 'success' | 'error'
export interface Toast {
  id: number
  message: string
  tone: Tone
}

export type JobListener = (job: Job) => void

export interface AppState {
  connected: boolean
  status: string
  snapshot: Snapshot | null
  meta: Meta | null
  config: Config | null
  toasts: Toast[]
  patchSettings: (patch: Partial<Settings>) => Promise<void>
  patchConfig: (patch: Record<string, Record<string, unknown>>) => Promise<void>
  refreshConfig: () => Promise<void>
  runJob: <T>(start: Promise<Job>, onUpdate?: JobListener) => Promise<T>
  toast: (message: string, tone?: Tone) => void
  dismissToast: (id: number) => void
}

export const AppContext = createContext<AppState | null>(null)

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp outside AppProvider')
  return ctx
}
