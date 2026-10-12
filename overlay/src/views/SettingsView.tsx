import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import { useApp } from '../store'
import type { Settings } from '../types'
import { PALETTES } from '../lib/theme'
import { pickFile, pickFolder } from '../lib/platform'
import { APP_VERSION } from '../lib/update'
import { Button, Check, Input, Section, Select } from '../components/primitives'

const TOGGLES: [keyof Settings, string, string?][] = [
  ['always_on_top', 'Always on top'],
  ['auto_sync_datasets', 'Auto-sync cloud datasets', 'Download the latest 17Lands data for live sets at startup'],
  ['card_colors_enabled', 'Highlight rows by mana cost'],
  ['update_notifications_enabled', 'Check for dataset updates'],
  ['missing_notifications_enabled', 'Alert on missing datasets'],
  ['draft_log_enabled', 'Save a draft log for every draft', 'Needed for draft history and exports of past drafts'],
  ['show_splash_screen', 'Show splash screen on startup (classic app)'],
]

export function SettingsView() {
  const { config, meta, patchSettings, patchConfig, refreshConfig, toast } = useApp()
  if (!config || !meta) return null
  const s = config.settings

  const reset = async () => {
    if (!window.confirm('Restore all settings to default?')) return
    await api.resetConfig()
    await refreshConfig()
    toast('Settings restored to defaults', 'success')
  }

  return (
    <div className="flex max-w-xl flex-col gap-3">
      <Section title="Data evaluation">
        <Row label="Win rate format" hint="Percentage, a 0–5 rating, or a letter grade relative to the format">
          <Select value={s.result_format} onChange={(e) => patchSettings({ result_format: e.target.value })}>
            {meta.resultFormats.map((f) => <option key={f}>{f}</option>)}
          </Select>
        </Row>
        <Row label="Deck filter format" hint="Show archetypes as color codes or guild names">
          <Select value={s.filter_format} onChange={(e) => patchSettings({ filter_format: e.target.value })}>
            {meta.filterFormats.map((f) => <option key={f}>{f}</option>)}
          </Select>
        </Row>
        <Row label="UI scale">
          <Select value={s.ui_size} onChange={(e) => patchSettings({ ui_size: e.target.value })}>
            {meta.uiSizes.map((f) => <option key={f}>{f}</option>)}
          </Select>
        </Row>
        <Row label="Theme">
          <Select value={PALETTES[s.theme_palette] ? s.theme_palette : 'Neutral'} onChange={(e) => patchSettings({ theme_palette: e.target.value })}>
            {Object.keys(PALETTES).map((p) => <option key={p}>{p}</option>)}
          </Select>
        </Row>
        <Row label="Card images in tooltips">
          <Check checked={config.features.images_enabled !== false} onChange={(v) => patchConfig({ features: { images_enabled: v } })} label="" />
        </Row>
      </Section>

      <Section title="Intelligence & HUD">
        {TOGGLES.map(([key, label, hint]) => (
          <Check key={key} checked={!!s[key]} onChange={(v) => patchSettings({ [key]: v })} label={label} hint={hint} />
        ))}
      </Section>

      <Section title="System paths">
        <PathRow
          label="Player.log location"
          hint="Leave empty to auto-detect. Setting a path pins it."
          value={s.arena_log_location}
          onSave={(v) => patchSettings({ arena_log_location: v })}
          browse={() => pickFile('Locate Player.log', [{ name: 'Player.log', extensions: ['log'] }])}
        />
        <PathRow
          label="MTGA_Data location"
          hint="Folder containing Downloads/Raw, used to recognize new cards"
          value={s.database_location}
          onSave={async (v) => {
            try {
              await api.locateMtgaData(v)
              await refreshConfig()
            } catch (e) {
              toast((e as Error).message, 'error')
            }
          }}
          browse={() => pickFolder('Select the MTGA_Data folder')}
        />
      </Section>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={reset}>Restore defaults</Button>
        <span className="text-[11px] text-stone-500">Overlay v{APP_VERSION} · Engine v{meta.version}</span>
      </div>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-[12px]" title={hint}>
      <span className="text-stone-300">{label}</span>
      {children}
    </div>
  )
}

function PathRow({ label, hint, value, onSave, browse }: { label: string; hint: string; value: string; onSave: (v: string) => void; browse: () => Promise<string | null> }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = (v: string) => v !== value && onSave(v)
  return (
    <div className="flex flex-col gap-1 py-1.5">
      <span className="text-[12px] text-stone-300" title={hint}>{label}</span>
      <div className="flex gap-1.5">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commit(draft.trim())} onKeyDown={(e) => e.key === 'Enter' && commit(draft.trim())} className="flex-1" placeholder="Auto-detect" />
        <Button onClick={async () => { const p = await browse(); if (p) { setDraft(p); commit(p) } }}>Browse…</Button>
      </div>
      <span className="text-[11px] text-stone-500">{hint}</span>
    </div>
  )
}
