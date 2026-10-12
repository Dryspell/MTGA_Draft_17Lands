import { useState } from 'react'
import { Segmented } from '../components/primitives'
import { DatasetsView } from './DatasetsView'
import { TierListsView } from './TierListsView'

type Section = 'datasets' | 'tiers'

export function DataView() {
  const [section, setSectionState] = useState<Section>(() => (localStorage.getItem('data-section') === 'tiers' ? 'tiers' : 'datasets'))
  const setSection = (s: Section) => {
    localStorage.setItem('data-section', s)
    setSectionState(s)
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex">
        <Segmented value={section} onChange={setSection} options={[{ value: 'datasets', label: '17Lands datasets' }, { value: 'tiers', label: 'Tier lists' }]} />
      </div>
      {section === 'datasets' ? <DatasetsView /> : <TierListsView />}
    </div>
  )
}
