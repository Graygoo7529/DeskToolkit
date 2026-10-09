import { useEffect, useRef, useState } from 'react'
import type { Home, Provider, ProbeTask, Scene, State } from '../types'
import * as api from '../api'
import { useInspections } from '../useInspections'
import ProviderCard from './ProviderCard'
import TargetCard from './TargetCard'
import { ConfirmModal, HomeModal, ModalShell, ProviderModal } from './Modals'
import { ClaudeHomeModal, ClaudeProviderModal } from './ClaudeModals'
import InspectionModal from './InspectionModal'
import SortableList from './SortableList'
import ProviderInspection, { taskLabels } from './ProviderInspection'
import Icon from './Icon'
import { providerStyle } from '../providerColor'

type Modal = { kind: 'home'; original: Home | null } | { kind: 'provider'; original: Provider | null } | { kind: 'inspection'; provider: Provider } | { kind: 'provider-detail' | 'home-detail'; name: string } | null
type Confirm = { kind: 'home' | 'provider'; name: string } | null

export default function ScenePanel({ scene, state, onState, pushToast }: {
  scene: Scene; state: State; onState: (state: State) => void
  pushToast: (kind: 'success' | 'error', text: string) => void
}) {
  const isClaude = scene === 'claude'
  const providers = isClaude ? state.claude_providers : state.providers
  const homes = isClaude ? state.claude_homes : state.homes
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [allSelected, setAllSelected] = useState(false)
  const [search, setSearch] = useState('')
  const [homeSearch, setHomeSearch] = useState('')
  const [modal, setModal] = useState<Modal>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [mutating, setMutating] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [flashed, setFlashed] = useState<string | null>(null)
  const mutationLock = useRef(false)
  const started = useRef(false)
  const inspections = useInspections(scene)
  // 两个场景始终挂载；启动时只检查连接一次，不阻塞选择、应用或排序。
  useEffect(() => {
    if (started.current) return
    started.current = true
    void inspections.run(providers.map((p) => p.name), ['connection'], true)
  }, [])
  const selected = providers.find((p) => p.name === selectedName) ?? null
  const detailProvider = modal?.kind === 'provider-detail' ? providers.find((p) => p.name === modal.name) : null
  const detailHome = modal?.kind === 'home-detail' ? homes.find((h) => h.name === modal.name) : null
  const filteredProviders = providers.filter((p) => `${p.name} ${p.url}`.toLowerCase().includes(search.toLowerCase()))
  const filteredHomes = homes.filter((h) => `${h.name} ${h.location}`.toLowerCase().includes(homeSearch.toLowerCase()))
  const HomeEditor = isClaude ? ClaudeHomeModal : HomeModal
  const ProviderEditor = isClaude ? ClaudeProviderModal : ProviderModal
  const getCurrent = (name: string) => (isClaude ? state.claude_statuses[name] : state.statuses[name])?.matched_provider ?? null

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
      if (kind === 'provider') { inspections.invalidate(name); if (selectedName === name) setSelectedName(null) }
      setConfirm(null); pushToast('success', `已移除「${name}」`)
    })
  }
  const apply = async (home: Home) => {
    if (!selected || mutationLock.current) return
    setApplying(home.name)
    await mutate(() => (isClaude ? api.applyClaudeProvider : api.applyProvider)(home.name, selected.name), () => {
      setFlashed(home.name); window.setTimeout(() => setFlashed(null), 1600)
      pushToast('success', `已将「${selected.name}」应用到「${home.name}」`)
    })
    setApplying(null)
  }
  const run = (tasks: ProbeTask[]) => void inspections.run(providers.map((p) => p.name), tasks)
  const p = inspections.progress
  const detailStatus = detailHome ? (isClaude ? state.claude_statuses[detailHome.name] : state.statuses[detailHome.name]) : null

  return <>
    <div className="scene-workspace">
      <section className="provider-pane" aria-label="Provider 列表">
        <div className="pane-head"><div><span className="eyebrow">01 / 选择来源</span><h2>Providers <span className="count">{providers.length}</span></h2></div>
          <button className="icon-btn add-btn" disabled={mutating} aria-label="添加 Provider" onClick={() => setModal({ kind: 'provider', original: null })}><Icon name="plus" /></button>
        </div>
        <div className="list-tools"><label className="search-box"><Icon name="search" size={15} /><input aria-label="搜索 Provider" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索名称或地址" /></label>
          <button className={`text-btn${allSelected ? ' active' : ''}`} aria-pressed={allSelected} disabled={!providers.length} onClick={() => setAllSelected((v) => !v)}>{allSelected ? '取消全选' : '全选'}</button>
        </div>
        {allSelected && <div className="batch-toolbar">
          <div className="batch-label">全部 {providers.length} 个 Provider <span>仅用于查询</span></div>
          <div className="batch-actions">{(['connection', 'models', 'quota'] as const).map((task) => <button key={task} className="btn btn-ghost" disabled={inspections.busy || mutating} onClick={() => run([task])}>{taskLabels[task]}</button>)}
            <button className="text-btn" disabled={inspections.busy || mutating} onClick={() => run(['connection', 'models', 'quota'])}>全部检查</button>
          </div>
        </div>}
        <div className="pane-scroll providers-scroll">
          {!providers.length ? <div className="empty"><Icon name="layers" size={28} /><strong>添加你的 API 来源</strong><span>一个 Provider，可以应用到多个目标。</span></div> : !filteredProviders.length ? <div className="empty">没有匹配的 Provider</div> :
            <SortableList items={filteredProviders} className={`provider-list${allSelected ? ' bulk-selected' : ''}`} disabled={mutating || !!search}
              onReorder={(names) => void mutate(() => api.reorderItems(scene, 'providers', names))}
              render={(provider) => <ProviderCard provider={provider} selected={selectedName === provider.name} results={inspections.results[provider.name]} appliedCount={homes.filter((h) => getCurrent(h.name) === provider.name).length}
                onSelect={() => setSelectedName(provider.name)} onDetails={() => setModal({ kind: 'provider-detail', name: provider.name })} />}
            />}
        </div>
        <div className="pane-footer">
          {inspections.busy ? <><span className="tiny-dot checking" /><span>{inspections.background ? '启动连接检查' : '查询中'} {p.done} / {p.total}</span><button className="text-btn" onClick={inspections.stop}>停止</button></> :
            <><span className="tiny-dot" /><span>{p.total ? `${inspections.background ? '启动检查' : '查询'}完成 · ${p.ok} 成功${p.error ? ` / ${p.error} 失败` : ''}` : '直接拖动卡片排序'}</span><span title="聚焦卡片后按 Alt + ↑ / ↓ 排序" className="sort-hint">↕ 拖动排序</span></>}
        </div>
        {p.total > 0 && !inspections.background && <div className="batch-progress" role="status">{p.done} / {p.total} 项 · 成功 {p.ok} · 部分 {p.partial} · 失败 {p.error} · 跳过 {p.skipped}{p.cancelled ? ` · 已取消 ${p.cancelled}` : ''}</div>}
      </section>
      <section className="target-pane" aria-label="目标配置">
        <div className="pane-head"><div><span className="eyebrow">02 / 应用到目标</span><h2>{isClaude ? 'Claude 配置' : 'Codex Homes'} <span className="count">{homes.length}</span></h2></div>
          <button className="btn btn-ghost" disabled={mutating} onClick={() => setModal({ kind: 'home', original: null })}><Icon name="plus" size={15} />添加目标</button>
        </div>
        <div style={providerStyle(selected)} className={`apply-context${selected ? ' ready' : ''}`}>
          <div className="context-icon"><Icon name="arrow" size={19} /></div>
          <div className="context-copy"><span>{selected ? `待应用来源 · ${homes.filter((h) => getCurrent(h.name) === selected.name).length} 个目标已生效` : '从左侧选择一个 Provider'}</span><strong>{selected?.name ?? '选好来源，再点击目标上的应用'}</strong></div>
          {selected && <button className="icon-btn" aria-label="取消待应用 Provider" onClick={() => setSelectedName(null)}><Icon name="close" size={15} /></button>}
        </div>
        {homes.length > 4 && <label className="search-box target-search"><Icon name="search" size={15} /><input aria-label="搜索目标配置" value={homeSearch} onChange={(e) => setHomeSearch(e.target.value)} placeholder="搜索目标名称或路径" /></label>}
        <div className="pane-scroll targets-scroll">
          {!homes.length ? <div className="empty"><Icon name="folder" size={28} /><strong>添加目标配置目录</strong><span>{isClaude ? '例如 D:\\ClaudeData' : '例如 C:\\Users\\you\\.codex'}</span></div> : !filteredHomes.length ? <div className="empty">没有匹配的目标</div> :
            <SortableList items={filteredHomes} className="home-list" disabled={mutating || !!homeSearch} onReorder={(names) => void mutate(() => api.reorderItems(scene, 'homes', names))}
              render={(home) => <TargetCard home={home} current={getCurrent(home.name)} currentProvider={providers.find((p) => p.name === getCurrent(home.name))} selected={selected} busy={mutating} applying={applying === home.name} flashed={flashed === home.name}
                onApply={() => void apply(home)} onDetails={() => setModal({ kind: 'home-detail', name: home.name })} />}
            />}
        </div>
        <div className="pane-footer"><span>每个目标独立应用</span><span className="dim">配置详情与管理见 ···</span></div>
      </section>
    </div>
    {detailProvider && <ModalShell drawer title={detailProvider.name} onClose={() => setModal(null)}>
      <p className="drawer-subtitle">Provider 详情</p><div className="detail-address">{detailProvider.url}</div><div className="detail-key mono">{detailProvider.key_masked}</div>
      <ProviderInspection results={inspections.results[detailProvider.name]} busy={inspections.busy || mutating} configuredQuota={detailProvider.inspection.quota.adapter !== 'none'}
        onRun={(task) => void inspections.run([detailProvider.name], [task])} onSettings={() => setModal({ kind: 'inspection', provider: detailProvider })} />
      <div className="drawer-actions"><button className="btn btn-ghost" disabled={mutating} onClick={() => setModal({ kind: 'provider', original: detailProvider })}>编辑 Provider</button>
        <button className="btn btn-ghost" disabled={mutating} onClick={() => setModal({ kind: 'inspection', provider: detailProvider })}>查询设置</button>
        <button className="text-btn danger" disabled={mutating} onClick={() => { setModal(null); setConfirm({ kind: 'provider', name: detailProvider.name }) }}>删除</button></div>
    </ModalShell>}
    {detailHome && <ModalShell drawer title={detailHome.name} onClose={() => setModal(null)}>
      <p className="drawer-subtitle">目标配置</p><dl className="detail-fields"><dt>配置目录</dt><dd>{detailHome.location}</dd><dt>当前 Provider</dt><dd>{getCurrent(detailHome.name) ?? '未匹配'}</dd><dt>当前 Base URL</dt><dd>{detailStatus?.base_url ?? '未设置'}</dd>
        <dt>{isClaude ? 'Auth Token' : 'API Key'}</dt><dd>{detailHome && (isClaude ? state.claude_statuses[detailHome.name]?.auth_token_masked : state.statuses[detailHome.name]?.api_key_masked) || '未设置'}</dd>
        <dt>配置文件</dt><dd>{isClaude ? (state.claude_statuses[detailHome.name]?.settings_exists ? 'settings.json 已存在' : 'settings.json 不存在，应用时创建') : `config.toml ${state.statuses[detailHome.name]?.config_exists ? '已存在' : '不存在'} / auth.json ${state.statuses[detailHome.name]?.auth_exists ? '已存在' : '不存在'}`}</dd>
      </dl><div className="drawer-actions"><button className="btn btn-ghost" disabled={mutating} onClick={() => setModal({ kind: 'home', original: detailHome })}>编辑配置</button><button className="text-btn danger" disabled={mutating} onClick={() => { setModal(null); setConfirm({ kind: 'home', name: detailHome.name }) }}>移除目标</button></div>
    </ModalShell>}
    {modal?.kind === 'home' && <HomeEditor original={modal.original} onClose={() => !mutating && setModal(null)} onSave={saveHome} />}
    {modal?.kind === 'provider' && <ProviderEditor original={modal.original} onClose={() => !mutating && setModal(null)} onSave={saveProvider} />}
    {modal?.kind === 'inspection' && <InspectionModal provider={modal.provider} onClose={() => setModal(null)} onSave={async (settings) => {
      onState(await api.saveInspection(scene, modal.provider.name, settings)); inspections.invalidate(modal.provider.name); pushToast('success', '已保存查询设置')
    }} />}
    {confirm && <ConfirmModal title={confirm.kind === 'home' ? '移除配置' : '删除 Provider'} message={`确定移除「${confirm.name}」？${confirm.kind === 'home' ? '仅移除面板记录，不删除实际配置文件。' : '已应用到 Home 的配置仍会保留。'}`} onCancel={() => !mutating && setConfirm(null)} onConfirm={remove} />}
  </>
}
