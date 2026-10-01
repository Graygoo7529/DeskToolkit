import { useRef, useState } from 'react'
import type { Home, Provider, ProbeTask, Scene, State } from '../types'
import * as api from '../api'
import { useInspections } from '../useInspections'
import ProviderCard from './ProviderCard'
import HomeCard from './HomeCard'
import ClaudeHomeCard from './ClaudeHomeCard'
import { ConfirmModal, HomeModal, ProviderModal } from './Modals'
import { ClaudeHomeModal, ClaudeProviderModal } from './ClaudeModals'
import InspectionModal from './InspectionModal'
import SortableList from './SortableList'
import { taskLabels } from './ProviderInspection'

type Modal = { kind: 'home'; original: Home | null } | { kind: 'provider'; original: Provider | null } | { kind: 'inspection'; provider: Provider } | null
type Confirm = { kind: 'home' | 'provider'; name: string } | null

export default function ScenePanel({ scene, state, onState, pushToast }: {
  scene: Scene; state: State; onState: (state: State) => void
  pushToast: (kind: 'success' | 'error', text: string) => void
}) {
  const isClaude = scene === 'claude'
  const providers = isClaude ? state.claude_providers : state.providers
  const homes = isClaude ? state.claude_homes : state.homes
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  const [modal, setModal] = useState<Modal>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [mutating, setMutating] = useState(false)
  const mutationLock = useRef(false)
  const inspections = useInspections(scene)
  const locked = mutating || inspections.busy
  const selected = providers.find((p) => p.name === selectedName) ?? null
  const checkedNames = providers.filter((p) => checked.includes(p.name)).map((p) => p.name)
  const HomeEditor = isClaude ? ClaudeHomeModal : HomeModal
  const ProviderEditor = isClaude ? ClaudeProviderModal : ProviderModal

  const mutate = async (action: () => Promise<State>, after?: () => void) => {
    if (mutationLock.current) return
    mutationLock.current = true; setMutating(true)
    try { onState(await action()); after?.() } catch (e) { pushToast('error', String(e)) }
    finally { mutationLock.current = false; setMutating(false) }
  }
  const saveProvider = (original: string | null, name: string, url: string, key: string) => mutate(
    () => (isClaude ? api.saveClaudeProvider : api.saveProvider)(original, name, url, key),
    () => {
      const newName = name.trim()
      if (original && selectedName === original) setSelectedName(newName)
      setChecked((old) => old.map((n) => n === original ? newName : n))
      if (original) inspections.invalidate(original)
      inspections.invalidate(newName)
      setModal(null); pushToast('success', `已保存 Provider「${newName}」`)
    },
  )
  const saveHome = (original: string | null, name: string, location: string) => mutate(
    () => (isClaude ? api.saveClaudeHome : api.saveHome)(original, name, location),
    () => { setModal(null); pushToast('success', `已保存配置「${name.trim()}」`) },
  )
  const remove = () => {
    if (!confirm) return
    const { kind, name } = confirm
    const action = kind === 'home' ? (isClaude ? api.deleteClaudeHome : api.deleteHome) : (isClaude ? api.deleteClaudeProvider : api.deleteProvider)
    void mutate(() => action(name), () => {
      if (kind === 'provider') { setChecked((old) => old.filter((n) => n !== name)); inspections.invalidate(name); if (selectedName === name) setSelectedName(null) }
      setConfirm(null); pushToast('success', `已移除「${name}」`)
    })
  }
  const run = (tasks: ProbeTask[]) => void inspections.run(checkedNames, tasks)
  const p = inspections.progress

  return <>
    <section className="section">
      <div className="section-head">
        <h2>{isClaude ? 'Claude 中转站' : 'Providers'} <span className="count">{providers.length}</span></h2>
        <button className="btn btn-primary" disabled={locked} onClick={() => setModal({ kind: 'provider', original: null })}>+ {isClaude ? '添加中转站' : '添加 Provider'}</button>
      </div>
      <p className="hint">点击卡片选择要应用的 Provider；勾选用于批量查询。拖动 ⠿ 调整顺序。</p>
      {providers.length > 0 && <>
        <div className="batch-toolbar">
          <label className="batch-select"><input type="checkbox" aria-label="全选 Provider" disabled={locked} checked={checkedNames.length === providers.length}
            ref={(element) => { if (element) element.indeterminate = checkedNames.length > 0 && checkedNames.length < providers.length }}
            onChange={(e) => setChecked(e.target.checked ? providers.map((item) => item.name) : [])} />全选</label>
          <span className="dim">已勾选 {checkedNames.length} / {providers.length}</span>
          <div className="batch-actions">
            {(['connection', 'models', 'quota'] as const).map((task) => <button key={task} className="btn btn-ghost" disabled={locked || !checkedNames.length} onClick={() => run([task])}>{taskLabels[task]}</button>)}
            <button className="btn btn-ghost" disabled={locked || !checkedNames.length} onClick={() => run(['connection', 'models', 'quota'])}>检查三项</button>
          </div>
        </div>
        {p.total > 0 && <div className="batch-progress" role="status">
          <span>{inspections.busy ? '查询中' : '查询完成'} · {p.done} / {p.total} 项</span>
          <span className="dim">成功 {p.ok} · 部分 {p.partial} · 失败 {p.error} · 跳过 {p.skipped}{p.cancelled > 0 ? ` · 已取消 ${p.cancelled}` : ''}</span>
          {inspections.busy && <button className="btn btn-ghost" onClick={inspections.stop}>停止待执行项</button>}
        </div>}
      </>}
      {!providers.length ? <div className="empty">添加第一个 {isClaude ? 'Claude 中转站' : 'Provider'}，再选择下方配置目录应用。</div> :
        <SortableList items={providers} className="provider-grid" disabled={locked}
          onReorder={(names) => void mutate(() => api.reorderItems(scene, 'providers', names))}
          render={(provider, handle) => <ProviderCard provider={provider} handle={handle} selected={selectedName === provider.name}
            checked={checkedNames.includes(provider.name)} busy={locked} results={inspections.results[provider.name]}
            onCheck={() => setChecked((old) => old.includes(provider.name) ? old.filter((n) => n !== provider.name) : [...old, provider.name])}
            onSelect={() => setSelectedName(selectedName === provider.name ? null : provider.name)}
            onEdit={() => setModal({ kind: 'provider', original: provider })}
            onDelete={() => setConfirm({ kind: 'provider', name: provider.name })}
            onSettings={() => setModal({ kind: 'inspection', provider })}
            onRun={(task) => void inspections.run([provider.name], [task])} />}
        />}
    </section>
    <section className="section">
      <div className="section-head"><h2>{isClaude ? 'Claude 配置' : 'Codex Homes'} <span className="count">{homes.length}</span></h2>
        <button className="btn btn-primary" disabled={mutating} onClick={() => setModal({ kind: 'home', original: null })}>+ {isClaude ? '添加配置' : '添加 Home'}</button>
      </div>
      {selected && <p className="hint selection-hint">待应用：{selected.name} · 选择下方目标并点击应用</p>}
      {!homes.length ? <div className="empty">添加配置目录后，可将上方选中的 Provider 应用到这里。</div> :
        <SortableList items={homes} className="home-list" disabled={mutating}
          onReorder={(names) => void mutate(() => api.reorderItems(scene, 'homes', names))}
          render={(home, handle) => {
            const common = { home, handle, selectedProvider: selected, busy: mutating,
              onApply: () => { if (selected) void mutate(() => (isClaude ? api.applyClaudeProvider : api.applyProvider)(home.name, selected.name), () => pushToast('success', `已将「${selected.name}」应用到「${home.name}」`)) },
              onEdit: () => setModal({ kind: 'home', original: home }), onDelete: () => setConfirm({ kind: 'home', name: home.name }),
            }
            return isClaude ? <ClaudeHomeCard {...common} status={state.claude_statuses[home.name]} /> : <HomeCard {...common} status={state.statuses[home.name]} />
          }} />}
    </section>
    {modal?.kind === 'home' && <HomeEditor original={modal.original} onClose={() => setModal(null)} onSave={saveHome} />}
    {modal?.kind === 'provider' && <ProviderEditor original={modal.original} onClose={() => setModal(null)} onSave={saveProvider} />}
    {modal?.kind === 'inspection' && <InspectionModal provider={modal.provider} onClose={() => setModal(null)} onSave={async (settings) => {
      onState(await api.saveInspection(scene, modal.provider.name, settings)); inspections.invalidate(modal.provider.name)
      pushToast('success', '已保存查询设置')
    }} />}
    {confirm && <ConfirmModal title={confirm.kind === 'home' ? '移除配置' : '删除 Provider'}
      message={`确定移除「${confirm.name}」？${confirm.kind === 'home' ? '仅移除面板记录，不删除实际配置文件。' : '已应用到 Home 的配置仍会保留。'}`}
      onCancel={() => setConfirm(null)} onConfirm={remove} />}
  </>
}
