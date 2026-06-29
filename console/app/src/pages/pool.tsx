// 账号池：总览 / 账号管理(表+批量栏+条件选中+盘点+导入) / 批次 / 回收站。
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import * as api from '../api'
import type { AccountRow, BatchRow, GroupRow, SiteInfo } from '../api'
import { copy, formatInt, invalidateResource, MetricCard, Modal, Pager, SkeletonCards, SkeletonRows, Spinner, Usage, useResource, useToast, VerdictTag, cls, type Lang } from '../lib'
import './pool.css'

// 账号管理 / 分组管理表的客户端分页页大小（数据已整批拉回，纯前端切片，选中态按 id 跨页保留）。
const PAGE_SIZE = 50

const ICON = {
  trash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg>,
  warn: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>,
  bolt: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>,
  grip: <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>,
  plus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>,
  key: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 8.3-8.3M16 6l3 3M14 8l3 3" /></svg>,
  copy: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>,
}

const fmtKeyDate = (s?: string | null) => { if (!s) return '-'; const d = String(s); return d.length >= 10 ? d.slice(0, 10) : d }
const fmtKeyQuota = (k: api.GroupKey) => { const used = Number(k.quota_used || 0); const lim = Number(k.quota || 0); return `${used.toFixed(2)}/${lim > 0 ? lim.toFixed(0) : '∞'}` }

// ---------- 账号池总览 ----------
export function PoolOverviewPage({ site, lang }: { site: number; lang: Lang }) {
  const t = copy[lang]
  const [err, setErr] = useState('')
  const { data: ov } = useResource(`pool-overview:${site}`, () => api.getPoolOverview(site), (e: any) => setErr(String(e?.message || e)))
  if (err && !ov) return <div className="error-banner">{err}</div>
  if (!ov) return <SkeletonCards n={7} />
  const v = ov.by_verdict
  const cards = [
    { label: t.poolTotal, value: formatInt(ov.total), tone: 'blue' },
    { label: t.poolAlive, value: formatInt(v.alive || 0), tone: 'green' },
    { label: t.poolRateLimited, value: formatInt(ov.rate_limited || 0), tone: 'amber' },
    { label: t.poolDead, value: formatInt((v.dead || 0) + (v.auth_fail || 0)), tone: 'red' },
    { label: t.poolNoCodex, value: formatInt(v.no_codex_perm || 0), tone: 'dim' },
    { label: t.poolPending, value: formatInt(v.pending || 0), tone: 'dim' },
    { label: t.poolExpiring, value: formatInt(ov.expiring_7d || 0), tone: 'amber' },
  ]
  return <div className="pool-page">
    <section className="metrics-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>{cards.map((c) => <MetricCard key={c.label} {...c} />)}</section>
    <section className="panel pool-grp-section">
      <h2>{t.byGroup}</h2>
      <div className="grp-grid">{(ov.by_group || []).map((g) => <div className="grp-card" key={g.group}>
        <h3>{g.name || `group#${g.group}`}</h3><div className="sub">group #{g.group}</div>
        <div className="grp-stats"><div><b>{g.total}</b>{t.grpTotal}</div><div><b style={{ color: 'var(--success)' }}>{g.alive}</b>{t.grpAlive}</div><div><b style={{ color: 'var(--danger)' }}>{g.dead}</b>{t.grpDead}</div></div>
      </div>)}{!ov.by_group?.length && <div className="notice">{t.noData}</div>}</div>
    </section>
  </div>
}

// ---------- 账号管理 ----------
export function AccountsPage({ siteInfo, lang }: { siteInfo: SiteInfo; lang: Lang }) {
  const site = siteInfo.id
  const t = copy[lang]
  const toast = useToast()
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState('')
  const [debSearch, setDebSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('all')
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [proxies, setProxies] = useState<any[]>([])
  const [editField, setEditField] = useState<'priority' | 'concurrency' | 'proxy' | 'group'>('priority')
  const [bulkVal, setBulkVal] = useState('')
  const [inv, setInv] = useState<api.InvStatus | null>(null)
  const [cleanup, setCleanup] = useState<api.CleanupStatus | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [upstreamOpen, setUpstreamOpen] = useState(false)
  const [page, setPage] = useState(1)   // 客户端当前页（从 1 起）

  // 跨页 SWR：key 含 site+分组筛选+防抖搜索；改/删后 refresh() 静默重拉（不白屏）。
  const { data: rowsData, loading, refreshing, refresh: load } = useResource(
    `accounts:${site}:${groupFilter}:${debSearch}`,
    () => (groupFilter === 'all' ? api.getAllAccounts(site, { search: debSearch || undefined }) : api.getGroupAccounts(site, Number(groupFilter))),
    (e: any) => toast(String(e?.message || e), 'err'),
  )
  const rows = rowsData || []
  // 搜索防抖 250ms 再进 key：避免逐键击重拉 + 表格闪空骨架（Enter 立即应用）。
  useEffect(() => { const id = setTimeout(() => setDebSearch(search), 250); return () => clearTimeout(id) }, [search])
  // 删/批量改账号后，失效兄弟页缓存（总览/分组成员），下次进入即拉新而非显示残影。
  const invalidateSiblings = () => { invalidateResource(`pool-overview:${site}`); invalidateResource(`group-membership:${site}`) }
  useEffect(() => { setSel(new Set()); api.getGroups(site).then(setGroups).catch(() => {}); api.getProxies(site).then(setProxies).catch(() => {}) }, [site])

  // 盘点/清理进度轮询
  const pollRef = useRef<number | null>(null)
  useEffect(() => {
    if (!inv?.running && !cleanup?.running) { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }; return }
    if (pollRef.current) return
    pollRef.current = window.setInterval(async () => {
      const [i, c] = await Promise.all([api.getInventoryStatus(site).catch(() => null), api.getCleanupStatus(site).catch(() => null)])
      setInv(i); setCleanup(c)
      if (i && !i.running && c && !c.running) { if (pollRef.current) clearInterval(pollRef.current); pollRef.current = null; invalidateSiblings(); load() }
    }, 1500)
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [inv?.running, cleanup?.running, site, load])

  // 筛选/站点变化回到第 1 页；数据变少时把越界页钳回最后一页（按条件选中仍跨全量，不受分页影响）。
  useEffect(() => { setPage(1) }, [groupFilter, search, site])
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [page, totalPages])
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  // 表头「全选」按**当前页**切换（跨页选中由「按条件选中→全部」覆盖，见下方 cond-row）。
  const allVisibleSelected = pageRows.length > 0 && pageRows.every((r) => sel.has(r.id))
  const toggleAll = () => setSel((s) => { const n = new Set(s); if (pageRows.every((r) => n.has(r.id))) pageRows.forEach((r) => n.delete(r.id)); else pageRows.forEach((r) => n.add(r.id)); return n })
  const selectByCond = (cond: string) => {
    const match = (r: AccountRow) => {
      const v = r.verdict || 'pending'
      if (cond === 'all') return true
      if (cond === 'dead') return v === 'dead' || v === 'auth_fail'
      if (cond === 'alive') return v === 'alive' && (r.used_5h == null || r.used_5h < 100)
      return v === cond
    }
    setSel((s) => { const n = new Set(s); rows.forEach((r) => { if (match(r)) n.add(r.id) }); return n })
  }

  const selIds = () => Array.from(sel)
  const doProbe = async () => {
    if (!sel.size) return
    const r = await api.startInventory({ site_id: site, account_ids: selIds() }).catch((e) => ({ started: false, msg: String(e.message || e) }))
    if (r.started) { setInv({ running: true, done: 0, total: sel.size, current: null, group: null, error: null }); toast(t.probing + '…') } else toast(r.msg || 'fail', 'err')
  }
  const doBulkEdit = async () => {
    if (!sel.size) return
    const body: any = { site_id: site, op: editField, account_ids: selIds(), value: bulkVal }
    try { await api.doBulk(body); toast(t.apply + ' ✓'); setBulkVal(''); invalidateSiblings(); load() } catch (e: any) { toast(String(e.message || e), 'err') }
  }
  const doDanger = async (op: string) => {
    if (!sel.size) return
    const msg = op === 'delete' ? t.confirmDelete : op === 'clear-error' ? t.confirmClearErr : t.confirmClearRate
    if (!confirm(msg)) return
    if (op === 'delete') {
      const r = await api.startCleanup({ site_id: site, account_ids: selIds() }).catch((e) => ({ started: false, msg: String(e.message || e) }))
      if (r.started) { setCleanup({ running: true, done: 0, total: sel.size, deleted: 0, failed: 0, current: null, abort: false, errors: [] }); toast(t.cleaning + '…') } else toast(r.msg || 'fail', 'err')
      return
    }
    try { const r = await api.doBulk({ site_id: site, op, account_ids: selIds() }); toast(`${op} ✓ ${JSON.stringify(r).slice(0, 80)}`); load() } catch (e: any) { toast(String(e.message || e), 'err') }
  }

  const running = inv?.running || cleanup?.running
  const prog = inv?.running ? inv : cleanup
  return <div className="pool-page">
    <div className="toolbar">
      <input className="pool-search" placeholder={t.accountSearch} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setDebSearch(search)} />
      <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}><option value="all">{t.allGroups}</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name || `#${g.id}`}</option>)}</select>
      <button className="btn" onClick={load} disabled={loading || refreshing}>{(loading || refreshing) ? <><Spinner /> {t.refresh}</> : t.refresh}</button>
      <div className="bulk-spacer" />
      <button className="btn btn-primary" onClick={() => setImportOpen(true)}>{t.importAccounts}</button>
      <button className="btn" onClick={() => setUpstreamOpen(true)}>{t.upstreamImport}</button>
    </div>

    {/* 按条件选中 */}
    <div className="cond-row">
      <span className="cond-label">{t.selByCond}:</span>
      {[['dead', t.condDead], ['rate_limited', t.condRate], ['no_codex_perm', t.condNoCodex], ['pending', t.condPending], ['alive', t.condAlive], ['all', t.condAll]].map(([k, lbl]) => <button key={k} className="cond-pill" onClick={() => selectByCond(k)}>{lbl}</button>)}
    </div>

    {/* 进度 */}
    {running && prog && <div className="panel pool-progress">
      <div className="pool-progress-head"><span>{inv?.running ? t.probing : t.cleaning} {prog.done}/{prog.total}{cleanup?.running ? ` · 删${cleanup.deleted} 失败${cleanup.failed}` : ''}</span>{cleanup?.running && <button className="danger-pill" onClick={() => api.abortCleanup(site)}>{t.stop}</button>}</div>
      <div className="prog"><div className="prog-fill" style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} /></div>
    </div>}

    {/* 批量操作栏 */}
    {sel.size > 0 && <div className="bulk-bar">
      <span className="bulk-count">{t.selected} {sel.size}</span>
      <button className="mini-btn" onClick={() => setSel(new Set())}>{t.clearSel}</button>
      <div className="bar-div" />
      <button className="mini-btn green" onClick={doProbe} disabled={running}>{ICON.bolt}{t.probeSelected}</button>
      <div className="bar-div" />
      <div className="bulk-edit-zone">
        <div className="seg-wrap">{(['priority', 'concurrency', 'proxy', 'group'] as const).map((f) => <button key={f} className={cls('seg-btn', editField === f && 'active')} onClick={() => setEditField(f)}>{f === 'priority' ? t.opPriority : f === 'concurrency' ? t.opConcurrency : f === 'proxy' ? t.opProxy : t.opGroup}</button>)}</div>
        {editField === 'proxy' ? <select className="bulk-val" value={bulkVal} onChange={(e) => setBulkVal(e.target.value)}><option value="">{t.noProxy}</option>{proxies.map((p) => <option key={p.id} value={p.id}>{p.name || `#${p.id}`}</option>)}</select>
          : editField === 'group' ? <select className="bulk-val" value={bulkVal} onChange={(e) => setBulkVal(e.target.value)}><option value="">{t.selectGroup}</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name || `#${g.id}`}</option>)}</select>
          : <input className="bulk-val" type="number" value={bulkVal} onChange={(e) => setBulkVal(e.target.value)} placeholder={editField === 'priority' ? t.opPriority : t.opConcurrency} />}
        <button className="btn btn-primary btn-sm" onClick={doBulkEdit}>{t.apply}</button>
      </div>
      <div className="bulk-spacer" />
      <div className="danger-zone">
        <span className="dz-label">{ICON.warn}{t.dangerLabel}</span>
        <button className="danger-pill" onClick={() => doDanger('clear-error')}>{t.clearError}</button>
        <button className="danger-pill" onClick={() => doDanger('clear-rate-limit')}>{t.clearRate}</button>
        <button className="danger-pill-solid" onClick={() => doDanger('delete')}>{ICON.trash}{t.deleteAccount}</button>
      </div>
    </div>}

    {/* 账号表 */}
    <div className="table-wrap"><table className="pool-acct-table">
      <thead><tr>
        <th className="col-check"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="select all" /></th>
        <th>{t.colId}</th><th>{t.colName}</th><th>{t.colType}</th><th>{t.colVerdict}</th><th>{t.colStatus}</th><th>{t.colUsage}</th><th>{t.colPriority}</th><th>{t.colProbe}</th>
      </tr></thead>
      <tbody>
        {loading && !rows.length && <SkeletonRows cols={9} />}
        {pageRows.map((r) => <tr key={r.id}>
          <td className="col-check"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
          <td className="mono">{r.id}</td>
          <td><span className="trunc trunc-user" title={r.email || r.name || ''}>{r.email || r.name || '-'}</span></td>
          <td>{r.type}</td>
          <td><VerdictTag v={r.verdict} lang={lang} /></td>
          <td><span className="mono">{r.status || '-'}</span></td>
          <td>{r.has_token
            ? <div className="usage-2"><div className="usage-row"><span className="usage-lbl">5h</span><Usage pct={r.used_5h} /></div><div className="usage-row"><span className="usage-lbl">7d</span><Usage pct={r.used_7d} /></div></div>
            : <span className="muted" title="api/中转账号无 codex 5h/7d 额度">—</span>}</td>
          <td>{r.priority ?? '-'}</td>
          <td className="muted">{r.last_probe_at || '—'}</td>
        </tr>)}
        {!loading && !rows.length && <tr><td colSpan={9} className="empty">{t.noData}</td></tr>}
      </tbody>
    </table></div>
    <Pager page={page} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage} lang={lang} />

    {importOpen && <ImportModal site={site} lang={lang} groups={groups} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); load() }} />}
    {upstreamOpen && <UpstreamModal site={site} lang={lang} onClose={() => setUpstreamOpen(false)} onDone={() => { setUpstreamOpen(false); load() }} />}
  </div>
}

// ---------- 分组管理（主从布局：左有序分组列表 / 右账号管理面板）----------
// 选一个分组 → 右侧表格列出账号（默认本组成员）；勾选后可：加入/移出本组、盘点、改优先级·并发·代理、清错误·清限流·删除。
// 成员增删走增量 add/remove（读-改-整套回写，REPLACE 安全）；其余批量操作复用账号管理同款 admin API。
export function GroupManagePage({ siteInfo, lang }: { siteInfo: SiteInfo; lang: Lang }) {
  const site = siteInfo.id
  const t = copy[lang]
  const toast = useToast()
  const [gid, setGid] = useState<number | null>(null)        // 当前选中分组
  const [sel, setSel] = useState<Set<number>>(new Set())     // 选中账号（批量操作对象，按 id 跨页保留）
  const [groupSearch, setGroupSearch] = useState('')
  const [sortBy, setSortBy] = useState<'custom' | 'name' | 'count'>('custom')
  const [order, setOrder] = useState<number[]>([])     // 自定义顺序的分组 id 序列（源自 sort_order，可拖拽）
  const [dragId, setDragId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'members' | 'non'>('members')
  const [proxies, setProxies] = useState<any[]>([])
  const [editField, setEditField] = useState<'priority' | 'concurrency' | 'proxy'>('priority')
  const [bulkVal, setBulkVal] = useState('')
  const [inv, setInv] = useState<api.InvStatus | null>(null)
  const [cleanup, setCleanup] = useState<api.CleanupStatus | null>(null)
  const [page, setPage] = useState(1)

  // 跨页 SWR：membership 进页先吐缓存秒显示，后台 revalidate；改/删/加入移出后 load()=refresh() 静默重拉。
  const { data: membership, loading, refresh: load } = useResource(`group-membership:${site}`, () => api.getGroupMembership(site), (e: any) => toast(String(e?.message || e), 'err'))
  useEffect(() => { setGid(null); setSel(new Set()); setSearch(''); setGroupSearch(''); setFilter('members'); api.getProxies(site).then(setProxies).catch(() => {}) }, [site])

  // 盘点/清理进度轮询（与账号管理同款）
  const pollRef = useRef<number | null>(null)
  useEffect(() => {
    if (!inv?.running && !cleanup?.running) { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }; return }
    if (pollRef.current) return
    pollRef.current = window.setInterval(async () => {
      const [i, c] = await Promise.all([api.getInventoryStatus(site).catch(() => null), api.getCleanupStatus(site).catch(() => null)])
      setInv(i); setCleanup(c)
      if (i && !i.running && c && !c.running) { if (pollRef.current) clearInterval(pollRef.current); pollRef.current = null; load() }
    }, 1500)
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [inv?.running, cleanup?.running, site, load])

  const accounts = membership?.accounts || []
  const groups = membership?.groups || []
  const memberCount = useCallback((g: number) => accounts.filter((a) => a.group_ids.includes(g)).length, [accounts])
  // 自定义顺序：membership 变化时从各分组 sort_order 初始化 order（拖拽保存后重载会再同步回来）。
  useEffect(() => {
    const byOrder = [...(membership?.groups || [])].sort((a, b) => (Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)) || a.id - b.id)
    setOrder(byOrder.map((g) => g.id))
  }, [membership])
  // 左侧分组列表：自定义(可拖拽) / 名称 / 成员 三种排序 + 搜索过滤。
  const orderedGroups = sortBy === 'name'
    ? [...groups].sort((a, b) => String(a.name || `#${a.id}`).localeCompare(String(b.name || `#${b.id}`), undefined, { numeric: true }))
    : sortBy === 'count'
      ? [...groups].sort((a, b) => memberCount(b.id) - memberCount(a.id) || a.id - b.id)
      : (() => { const idx = new Map(order.map((id, i) => [id, i])); return [...groups].sort((a, b) => (idx.get(a.id) ?? 1e9) - (idx.get(b.id) ?? 1e9)) })()
  const shownGroups = orderedGroups.filter((g) => !groupSearch || String(g.name || `#${g.id}`).toLowerCase().includes(groupSearch.toLowerCase()))
  const canDrag = sortBy === 'custom' && !groupSearch
  const orderRef = useRef<number[]>([]); orderRef.current = order
  // 拖拽排序：dragover 实时把被拖项移到目标位置（仅本地 order），dragend 持久化各分组 sort_order。
  const onDragOverItem = (e: DragEvent, targetId: number) => {
    e.preventDefault()
    if (dragId == null || dragId === targetId) return
    setOrder((o) => { const a = o.includes(dragId) ? [...o] : [...o, dragId]; a.splice(a.indexOf(dragId), 1); const to = a.indexOf(targetId); a.splice(to < 0 ? a.length : to, 0, dragId); return a })
  }
  const onDragEndItem = async () => {
    const id = dragId; setDragId(null)
    if (id == null) return
    try { await api.setGroupOrder(site, orderRef.current); toast(t.grpOrderSaved, 'ok'); load() } catch (e: any) { toast(String(e.message || e), 'err') }
  }
  const pickGroup = (g: number) => { setGid(g); setSel(new Set()); setSearch(''); setFilter('members'); setPage(1) }

  const fill = (tpl: string, vars: Record<string, number | string>) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
  const selIds = () => Array.from(sel)
  const inGroup = (a: api.MemberAccount) => gid != null && a.group_ids.includes(gid)

  // 可见账号：搜索（邮箱/名称）+ 成员/非成员筛选（按当前组归属），分页。
  const visible = accounts.filter((a) => {
    if (search) { const q = search.toLowerCase(); if (!((a.email || '').toLowerCase().includes(q) || (a.name || '').toLowerCase().includes(q))) return false }
    if (filter === 'members') return inGroup(a)
    if (filter === 'non') return !inGroup(a)
    return true
  })
  useEffect(() => { setPage(1) }, [gid, search, filter])
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [page, totalPages])
  const pageRows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allPageSel = pageRows.length > 0 && pageRows.every((r) => sel.has(r.id))
  const toggleAll = () => setSel((s) => { const n = new Set(s); if (pageRows.every((r) => n.has(r.id))) pageRows.forEach((r) => n.delete(r.id)); else pageRows.forEach((r) => n.add(r.id)); return n })

  const running = inv?.running || cleanup?.running
  const prog = inv?.running ? inv : cleanup

  // ---- 批量操作 ----
  const doJoin = async () => { if (gid == null || !sel.size) return; try { const r = await api.addToGroup({ site_id: site, group_id: gid, account_ids: selIds() }); toast(fill(t.grpJoinedTpl, { n: r.added, f: r.failed }), r.failed ? 'err' : 'ok'); setSel(new Set()); load() } catch (e: any) { toast(String(e.message || e), 'err') } }
  const doLeave = async () => { if (gid == null || !sel.size) return; try { const r = await api.removeFromGroup({ site_id: site, group_id: gid, account_ids: selIds() }); toast(fill(t.grpLeftTpl, { n: r.removed, f: r.failed }), r.failed ? 'err' : 'ok'); setSel(new Set()); load() } catch (e: any) { toast(String(e.message || e), 'err') } }
  const doProbe = async () => { if (!sel.size) return; const r = await api.startInventory({ site_id: site, account_ids: selIds() }).catch((e) => ({ started: false, msg: String(e.message || e) })); if (r.started) { setInv({ running: true, done: 0, total: sel.size, current: null, group: null, error: null }); toast(t.probing + '…') } else toast((r as any).msg || 'fail', 'err') }
  const doBulkEdit = async () => { if (!sel.size) return; try { await api.doBulk({ site_id: site, op: editField, account_ids: selIds(), value: bulkVal }); toast(t.apply + ' ✓'); setBulkVal(''); load() } catch (e: any) { toast(String(e.message || e), 'err') } }
  const doDanger = async (op: string) => {
    if (!sel.size) return
    const msg = op === 'delete' ? t.confirmDelete : op === 'clear-error' ? t.confirmClearErr : t.confirmClearRate
    if (!confirm(msg)) return
    if (op === 'delete') { const r = await api.startCleanup({ site_id: site, account_ids: selIds() }).catch((e) => ({ started: false, msg: String(e.message || e) })); if (r.started) { setCleanup({ running: true, done: 0, total: sel.size, deleted: 0, failed: 0, current: null, abort: false, errors: [] }); toast(t.cleaning + '…') } else toast((r as any).msg || 'fail', 'err'); return }
    try { await api.doBulk({ site_id: site, op, account_ids: selIds() }); toast(`${op} ✓`); setSel(new Set()); load() } catch (e: any) { toast(String(e.message || e), 'err') }
  }

  return <div className="pool-page grp-mgr">
    <header className="grp-head"><h2 className="grp-title">{t.grpManageTitle}</h2><p className="muted grp-desc">{t.grpManageDesc}</p></header>

    {loading && !membership && <SkeletonRows cols={9} />}
    {!loading && !groups.length && <div className="notice">{t.grpEmptyGroups}</div>}

    {groups.length > 0 && <div className="grp-layout">
      {/* 左：有序、可搜索的分组列表 */}
      <aside className="grp-list">
        <div className="grp-list-head">
          <input className="grp-list-search" placeholder={t.grpSearchGroup} value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} />
          <div className="seg-wrap grp-sort">{([['custom', t.grpSortCustom], ['name', t.grpSortName], ['count', t.grpSortCount]] as const).map(([k, lbl]) => <button key={k} className={cls('seg-btn', sortBy === k && 'active')} onClick={() => setSortBy(k)}>{lbl}</button>)}</div>
          {canDrag && <div className="grp-reorder-hint muted">{ICON.grip}{t.grpReorderHint}</div>}
        </div>
        <div className="grp-list-items">
          {shownGroups.map((g) => <button key={g.id}
            className={cls('grp-list-item', gid === g.id && 'active', canDrag && 'draggable', dragId === g.id && 'dragging')}
            draggable={canDrag}
            onDragStart={canDrag ? () => setDragId(g.id) : undefined}
            onDragOver={canDrag ? (e) => onDragOverItem(e, g.id) : undefined}
            onDragEnd={canDrag ? onDragEndItem : undefined}
            onClick={() => pickGroup(g.id)}>
            {canDrag && <span className="grp-grip" aria-hidden>{ICON.grip}</span>}
            <span className="grp-list-name" title={String(g.name || `#${g.id}`)}>{g.name || `#${g.id}`}</span>
            <span className="grp-list-count">{memberCount(g.id)}</span>
          </button>)}
          {!shownGroups.length && <div className="grp-list-empty muted">{t.noData}</div>}
        </div>
      </aside>

      {/* 右：账号管理面板 */}
      <section className="grp-detail">
        {gid == null ? <div className="notice grp-pick-hint">{t.grpPickGroupHint}</div> : <>
          <div className="toolbar grp-toolbar">
            <input className="pool-search" placeholder={t.grpSearchAcct} value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="seg-wrap">{([['members', t.grpFilterMembers], ['non', t.grpFilterNon], ['all', t.grpFilterAll]] as const).map(([k, lbl]) => <button key={k} className={cls('seg-btn', filter === k && 'active')} onClick={() => setFilter(k)}>{lbl}</button>)}</div>
            <div className="bulk-spacer" />
            <span className="muted grp-detail-count">{fill(t.grpSelectedCount, { n: sel.size })}</span>
          </div>

          {running && prog && <div className="panel pool-progress">
            <div className="pool-progress-head"><span>{inv?.running ? t.probing : t.cleaning} {prog.done}/{prog.total}{cleanup?.running ? ` · 删${cleanup.deleted} 失败${cleanup.failed}` : ''}</span>{cleanup?.running && <button className="danger-pill" onClick={() => api.abortCleanup(site)}>{t.stop}</button>}</div>
            <div className="prog"><div className="prog-fill" style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} /></div>
          </div>}

          {sel.size > 0 && <div className="bulk-bar">
            <span className="bulk-count">{t.selected} {sel.size}</span>
            <button className="mini-btn" onClick={() => setSel(new Set())}>{t.clearSel}</button>
            <div className="bar-div" />
            <button className="mini-btn green" onClick={doJoin}>{t.grpJoinGroup}</button>
            <button className="mini-btn" onClick={doLeave}>{t.grpLeaveGroup}</button>
            <div className="bar-div" />
            <button className="mini-btn green" onClick={doProbe} disabled={running}>{ICON.bolt}{t.probeSelected}</button>
            <div className="bar-div" />
            <div className="bulk-edit-zone">
              <div className="seg-wrap">{(['priority', 'concurrency', 'proxy'] as const).map((f) => <button key={f} className={cls('seg-btn', editField === f && 'active')} onClick={() => setEditField(f)}>{f === 'priority' ? t.opPriority : f === 'concurrency' ? t.opConcurrency : t.opProxy}</button>)}</div>
              {editField === 'proxy' ? <select className="bulk-val" value={bulkVal} onChange={(e) => setBulkVal(e.target.value)}><option value="">{t.noProxy}</option>{proxies.map((p) => <option key={p.id} value={p.id}>{p.name || `#${p.id}`}</option>)}</select>
                : <input className="bulk-val" type="number" value={bulkVal} onChange={(e) => setBulkVal(e.target.value)} placeholder={editField === 'priority' ? t.opPriority : t.opConcurrency} />}
              <button className="btn btn-primary btn-sm" onClick={doBulkEdit}>{t.apply}</button>
            </div>
            <div className="bulk-spacer" />
            <div className="danger-zone">
              <span className="dz-label">{ICON.warn}{t.dangerLabel}</span>
              <button className="danger-pill" onClick={() => doDanger('clear-error')}>{t.clearError}</button>
              <button className="danger-pill" onClick={() => doDanger('clear-rate-limit')}>{t.clearRate}</button>
              <button className="danger-pill-solid" onClick={() => doDanger('delete')}>{ICON.trash}{t.deleteAccount}</button>
            </div>
          </div>}

          <div className="table-wrap"><table className="pool-acct-table">
            <thead><tr>
              <th className="col-check"><input type="checkbox" checked={allPageSel} onChange={toggleAll} aria-label="select all" /></th>
              <th>{t.colId}</th><th>{t.colName}</th><th>{t.colType}</th><th>{t.grpColInGroup}</th><th>{t.colVerdict}</th><th>{t.colStatus}</th><th>{t.colUsage}</th><th>{t.colPriority}</th>
            </tr></thead>
            <tbody>
              {loading && !accounts.length && <SkeletonRows cols={9} />}
              {pageRows.map((a) => <tr key={a.id}>
                <td className="col-check"><input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} /></td>
                <td className="mono">{a.id}</td>
                <td><span className="trunc trunc-user" title={a.email || a.name || ''}>{a.email || a.name || '-'}</span></td>
                <td>{a.type || '-'}</td>
                <td>{inGroup(a) ? <span className="tag alive">{t.grpMemberYes}</span> : <span className="muted">—</span>}</td>
                <td><VerdictTag v={a.verdict} lang={lang} /></td>
                <td><span className="mono">{a.status || '-'}</span></td>
                <td>{a.has_token
                  ? <div className="usage-2"><div className="usage-row"><span className="usage-lbl">5h</span><Usage pct={a.used_5h} /></div><div className="usage-row"><span className="usage-lbl">7d</span><Usage pct={a.used_7d} /></div></div>
                  : <span className="muted">—</span>}</td>
                <td>{a.priority ?? '-'}</td>
              </tr>)}
              {!loading && !visible.length && <tr><td colSpan={9} className="empty">{t.noData}</td></tr>}
            </tbody>
          </table></div>
          <Pager page={page} pageSize={PAGE_SIZE} total={visible.length} onPage={setPage} lang={lang} />

          <GroupKeysPanel site={site} gid={gid} hasAdminLogin={!!siteInfo.has_admin_login} lang={lang} />
        </>}
      </section>
    </div>}
  </div>
}

/**
 * 本组「使用用」API 密钥面板：列出绑定本组的 key、新建（明文仅一次、可复制）、删除。
 * 经站点存的 sub2api 管理员登录操作（admin-api-key 无法管理 key）；站点未配登录则显式提示。
 */
function GroupKeysPanel({ site, gid, hasAdminLogin, lang }: { site: number; gid: number; hasAdminLogin: boolean; lang: Lang }) {
  const t = copy[lang]; const toast = useToast()
  const [keys, setKeys] = useState<api.GroupKey[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [adminLogin, setAdminLogin] = useState(hasAdminLogin)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<{ id: number; key: string } | null>(null)
  const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))

  const load = useCallback(async () => {
    if (!hasAdminLogin) { setAdminLogin(false); setKeys([]); return }
    setLoading(true)
    try { const r = await api.getGroupKeys(site, gid); setKeys(r.keys); setAdminLogin(r.admin_login) }
    catch (e: any) { toast(String(e.message || e), 'err'); setKeys([]) }
    finally { setLoading(false) }
  }, [site, gid, hasAdminLogin, toast])
  useEffect(() => { setCreated(null); setNewName(''); load() }, [load])

  const doCreate = async () => {
    if (creating) return
    setCreating(true)
    try { const r = await api.createGroupKey({ site_id: site, group_id: gid, name: newName.trim() || undefined }); setCreated(r); setNewName(''); toast(t.gkCreated, 'ok'); load() }
    catch (e: any) { toast(String(e.message || e), 'err') }
    finally { setCreating(false) }
  }
  const doDelete = async (k: api.GroupKey) => {
    if (!confirm(fill(t.gkConfirmDelete, { name: k.name || `#${k.id}` }))) return
    try { await api.deleteGroupKey(site, k.id); toast(t.gkDeleted, 'ok'); if (created?.id === k.id) setCreated(null); load() }
    catch (e: any) { toast(String(e.message || e), 'err') }
  }
  const copyKey = (s: string) => { try { navigator.clipboard?.writeText(s); toast(t.gkCopied, 'ok') } catch { /* ignore */ } }

  return <div className="panel gk-panel">
    <div className="gk-head">
      <span className="gk-title">{ICON.key}{t.gkTitle}{keys ? <span className="gk-badge">{keys.length}</span> : null}</span>
      <span className="muted gk-desc">{t.gkDesc}</span>
    </div>

    {!adminLogin ? <div className="notice gk-noadmin">{ICON.warn}{t.gkNoAdminLogin}</div> : <>
      {created && <div className="gk-plain">
        <div className="gk-plain-top"><span className="gk-plain-lbl">{ICON.key}{t.gkCreated}</span><button className="mini-btn" onClick={() => setCreated(null)}>{t.gkDismiss}</button></div>
        <div className="gk-plain-row"><code className="gk-plain-key">{created.key}</code><button className="mini-btn green" onClick={() => copyKey(created.key)}>{ICON.copy}{t.gkCopy}</button></div>
        <div className="gk-plain-hint">{ICON.warn}{t.gkPlainHint}</div>
      </div>}

      <div className="gk-create">
        <input className="gk-name-input" placeholder={t.gkNamePlaceholder} value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doCreate() }} />
        <button className="btn btn-primary btn-sm" onClick={doCreate} disabled={creating}>{creating ? <><Spinner /> {t.gkCreating}</> : <>{ICON.plus}{t.gkNew}</>}</button>
      </div>

      <div className="table-wrap"><table className="pool-acct-table gk-table">
        <thead><tr>
          <th>{t.gkColName}</th><th>{t.gkColKey}</th><th>{t.gkColStatus}</th><th>{t.gkColQuota}</th><th>{t.gkColCreated}</th><th>{t.gkColUsed}</th><th className="gk-col-act">{t.gkColAction}</th>
        </tr></thead>
        <tbody>
          {loading && !keys && <SkeletonRows cols={7} />}
          {(keys || []).map((k) => <tr key={k.id}>
            <td><span className="trunc" title={k.name || ''}>{k.name || `#${k.id}`}</span></td>
            <td className="mono gk-key-cell">{k.key
              ? <div className="gk-key-wrap"><span className="trunc" title={k.key}>{k.key}</span><button className="gk-copy-btn" title={t.gkCopy} onClick={() => copyKey(k.key!)}>{ICON.copy}</button></div>
              : <span className="muted">#{k.id}</span>}</td>
            <td><span className={cls('tag', k.status === 'active' && 'alive')}>{k.status || '-'}</span></td>
            <td className="mono">{fmtKeyQuota(k)}</td>
            <td className="mono gk-date">{fmtKeyDate(k.created_at)}</td>
            <td className="mono gk-date">{k.last_used_at ? fmtKeyDate(k.last_used_at) : <span className="muted">{t.gkNever}</span>}</td>
            <td className="gk-col-act"><button className="danger-pill" title={t.deleteAccount} onClick={() => doDelete(k)}>{ICON.trash}</button></td>
          </tr>)}
          {!loading && keys && !keys.length && <tr><td colSpan={7} className="empty">{t.gkNoKeys}</td></tr>}
        </tbody>
      </table></div>
    </>}
  </div>
}

function ImportModal({ site, lang, groups, onClose, onDone }: { site: number; lang: Lang; groups: GroupRow[]; onClose: () => void; onDone: () => void }) {
  const t = copy[lang]; const toast = useToast()
  const [name, setName] = useState(''); const [prio, setPrio] = useState('50'); const [conc, setConc] = useState('3'); const [content, setContent] = useState(''); const [busy, setBusy] = useState(false)
  const [fmt, setFmt] = useState<'auto' | 'cpa' | 'sub2'>('auto')
  const [files, setFiles] = useState<{ name: string; text: string }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  void groups
  // 拖入/选择 .json 文件：逐个读成文本入 files（每个文件单独 parse，避免多份多行 JSON 拼接后整体解析失败）。
  const readFiles = (list: FileList | null) => {
    if (!list || !list.length) return
    Array.from(list).forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => setFiles((fs) => [...fs, { name: file.name, text: String(reader.result || '') }])
      reader.onerror = () => toast(`读取 ${file.name} 失败`, 'err')
      reader.readAsText(file)
    })
  }
  // 兼容两种格式：先按「整段 JSON / JSON 数组」解析（sub2 导出多为多行 pretty JSON，一个对象含 accounts[]）；
  // 失败再退化为「每行一个 JSON」（CPA 单号 JSONL）。后端 expandInputs(fmt) 据 format 展开/过滤。
  const parseContent = (text: string): any[] => {
    const out: any[] = []
    const trimmed = text.trim()
    if (!trimmed) return out
    try {
      const whole = JSON.parse(trimmed)
      return Array.isArray(whole) ? whole : [whole]
    } catch { /* not a single JSON document → try JSONL */ }
    for (const l of trimmed.split('\n').map((x) => x.trim()).filter(Boolean)) {
      try { const o = JSON.parse(l); Array.isArray(o) ? out.push(...o) : out.push(o) } catch { /* skip bad line */ }
    }
    return out
  }
  const submit = async () => {
    const cpa: any[] = []
    for (const f of files) cpa.push(...parseContent(f.text))   // 拖入/选择的文件
    cpa.push(...parseContent(content))                          // 手动粘贴的文本
    if (!cpa.length) { toast('无有效 JSON（拖入文件或粘贴内容）', 'err'); return }
    setBusy(true)
    try { const r = await api.doImport({ site_id: site, cpa_list: cpa, format: fmt === 'auto' ? undefined : fmt, name: name || undefined, priority: Number(prio), concurrency: Number(conc) }); toast(`导入: ${JSON.stringify(r.result || r).slice(0, 80)}`); onDone() } catch (e: any) { toast(String(e.message || e), 'err') } finally { setBusy(false) }
  }
  return <Modal title={t.importTitle} desc={t.importDesc} onClose={onClose} actions={<><button className="btn" onClick={onClose}>{t.cancel}</button><button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? <><Spinner /> {t.importAccounts}</> : t.importAccounts}</button></>}>
    <label>{t.importBatchName}</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="batch-..." />
    <label>{t.importFormat}</label>
    <div className="seg-wrap">
      {([['auto', t.fmtAuto], ['cpa', t.fmtCpa], ['sub2', t.fmtSub2]] as const).map(([v, lbl]) => (
        <button type="button" key={v} className={cls('seg-btn', fmt === v && 'active')} onClick={() => setFmt(v)}>{lbl}</button>
      ))}
    </div>
    <div className="field-row"><div><label>{t.importPriority}</label><input type="number" value={prio} onChange={(e) => setPrio(e.target.value)} /></div><div><label>{t.importConcurrency}</label><input type="number" value={conc} onChange={(e) => setConc(e.target.value)} /></div></div>
    <label>{t.importContent}</label>
    <div
      className={cls('import-drop', dragOver && 'over')}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); readFiles(e.dataTransfer.files) }}
      onClick={() => fileRef.current?.click()}
    >
      {files.length
        ? <div className="import-files">{files.map((f, i) => <span key={i} className="import-file-chip" title={f.name}>{f.name}<button type="button" onClick={(e) => { e.stopPropagation(); setFiles((fs) => fs.filter((_, j) => j !== i)) }} aria-label="remove">×</button></span>)}</div>
        : <span className="import-drop-hint">{t.importDrop}</span>}
      <input ref={fileRef} type="file" accept=".json,application/json" multiple style={{ display: 'none' }} onChange={(e) => { readFiles(e.target.files); e.currentTarget.value = '' }} />
    </div>
    <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder={fmt === 'sub2' ? '{"accounts":[{"credentials":{"access_token":"...","refresh_token":"..."},"name":"..."}]}' : '{"access_token":"...","refresh_token":"...","email":"..."}'} />
  </Modal>
}

function UpstreamModal({ site, lang, onClose, onDone }: { site: number; lang: Lang; onClose: () => void; onDone: () => void }) {
  const t = copy[lang]; const toast = useToast()
  const newGroup = () => ({ name: '', accounts: [{ name: '', api_key: '' }], key: { enabled: false, override: false, email: '', password: '' }, mon: { enabled: false, primary_model: '', interval_seconds: '60' } })
  const [f, setF] = useState<any>({ platform: 'openai', base_url: '', model_mapping: '', priority: '50', concurrency: '10', rate_multiplier: '1' })
  const [groups, setGroups] = useState<any[]>([newGroup()])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<any>(null)
  const set = (k: string, v: any) => setF((o: any) => ({ ...o, [k]: v }))
  const setGroup = (gi: number, patch: any) => setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, ...patch } : g)))
  const setAccount = (gi: number, ai: number, k: string, v: any) => setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, accounts: g.accounts.map((a: any, j: number) => (j === ai ? { ...a, [k]: v } : a)) } : g)))
  const addAccount = (gi: number) => setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, accounts: [...g.accounts, { name: '', api_key: '' }] } : g)))
  const removeAccount = (gi: number, ai: number) => setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, accounts: g.accounts.length > 1 ? g.accounts.filter((_: any, j: number) => j !== ai) : g.accounts } : g)))
  const addGroup = () => setGroups((gs) => [...gs, newGroup()])
  const removeGroup = (gi: number) => setGroups((gs) => (gs.length > 1 ? gs.filter((_, i) => i !== gi) : gs))
  const setKeyF = (gi: number, k: string, v: any) => setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, key: { ...g.key, [k]: v } } : g)))
  const setMonF = (gi: number, k: string, v: any) => setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, mon: { ...g.mon, [k]: v } } : g)))
  const submit = async () => {
    const outGroups = groups.map((g) => ({
      name: g.name.trim(),
      accounts: g.accounts.filter((a: any) => a.name.trim() && a.api_key.trim()).map((a: any) => ({ name: a.name.trim(), api_key: a.api_key.trim() })),
      create_key: g.key.enabled ? { enabled: true, email: g.key.override ? g.key.email.trim() : '', password: g.key.override ? g.key.password : '' } : undefined,
      monitor: g.mon.enabled ? { enabled: true, provider: f.platform, primary_model: g.mon.primary_model.trim(), interval_seconds: Number(g.mon.interval_seconds) } : undefined,
    })).filter((g) => g.accounts.length)
    if (!f.base_url.trim() || !outGroups.length) { toast(t.upRelayNeed, 'err'); return }
    setBusy(true)
    try {
      const body: any = { site_id: site, platform: f.platform, base_url: f.base_url.trim(), model_mapping: f.model_mapping, priority: Number(f.priority), concurrency: Number(f.concurrency), rate_multiplier: Number(f.rate_multiplier), groups: outGroups }
      const r = await api.doUpstreamImport(body)
      if (r.error) throw new Error(r.error)
      setResult(r)
      const anyKey = (r.groups || []).some((x: any) => x.key)
      toast(`✓ ${t.upResultAcc} ${r.created}/${r.total}`)
      if (!anyKey) onDone()
    } catch (e: any) { toast(String(e.message || e), 'err') } finally { setBusy(false) }
  }

  if (result) return <Modal title={t.upstreamTitle} onClose={() => onDone()} actions={<button className="btn btn-primary" onClick={() => onDone()}>{t.close}</button>}>
    <div className="notice pool-up-result">
      <b className="pool-up-result-head">✓ {t.upDone}</b> — {t.upResultAcc}: {result.created}/{result.total}
      {(result.groups || []).map((g: any, i: number) => <div key={i} className="pool-up-result-group">
        <div className="pool-up-result-title">{t.upGroup}: {g.group_name}{g.group_id ? ` #${g.group_id}` : ''} · {g.created}/{g.total}{g.monitor_id ? ` · ${t.upMonitor}#${g.monitor_id}` : ''}</div>
        {(g.group_error || g.monitor_error || g.key_error) && <div className="pool-up-result-warn">{[g.group_error, g.monitor_error, g.key_error].filter(Boolean).join('；')}</div>}
        {g.accounts?.some((a: any) => a.error) && <div className="pool-up-result-err">{g.accounts.filter((a: any) => a.error).map((a: any) => `${a.name}: ${a.error}`).join('；')}</div>}
        {g.key && <>
          <div className="pool-up-key-label">⚠ {t.upKeyOnce}</div>
          <div className="pool-up-key-row">
            <code className="pool-up-key-code">{g.key.key}</code>
            <button className="btn btn-sm" onClick={() => { navigator.clipboard?.writeText(g.key.key); toast(t.sitePubkeyCopied) }}>{lang === 'zh' ? '复制' : 'Copy'}</button>
          </div>
        </>}
      </div>)}
    </div>
  </Modal>

  return <Modal title={t.upstreamTitle} desc={t.upstreamDesc} onClose={onClose} actions={<><button className="btn" onClick={onClose}>{t.cancel}</button><button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? <><Spinner /> {t.upstreamImport}</> : t.upstreamImport}</button></>}>
    <div className="pool-up-shared">
      <div className="field-row">
        <div><label>{t.upPlatform}</label><select value={f.platform} onChange={(e) => set('platform', e.target.value)}><option value="openai">openai</option><option value="anthropic">anthropic</option><option value="gemini">gemini</option></select></div>
        <div><label>{t.upstreamBaseUrl}</label><input value={f.base_url} onChange={(e) => set('base_url', e.target.value)} placeholder="https://relay.example.com/v1" /></div>
      </div>
      <label>{t.upModelMap}</label><textarea className="pool-up-modelmap" value={f.model_mapping} onChange={(e) => set('model_mapping', e.target.value)} placeholder={'gpt-5.5:gpt-5.5  (每行 源:目标，可空，全批共用)'} />
      <div className="field-row"><div><label>{t.opPriority}</label><input type="number" value={f.priority} onChange={(e) => set('priority', e.target.value)} /></div><div><label>{t.opConcurrency}</label><input type="number" value={f.concurrency} onChange={(e) => set('concurrency', e.target.value)} /></div></div>
    </div>

    {groups.map((g, gi) => <div key={gi} className="pool-up-group">
      <div className="pool-up-group-head">
        <b className="pool-up-group-badge">{t.upGroup} {gi + 1}</b>
        <input value={g.name} onChange={(e) => setGroup(gi, { name: e.target.value })} placeholder={t.upGroupPh} />
        <button type="button" className="btn btn-sm" onClick={() => removeGroup(gi)} disabled={groups.length <= 1}>{t.upRemoveGroup}</button>
      </div>
      <label className="pool-up-group-label">{t.upTiers}</label>
      {g.accounts.map((a: any, ai: number) => <div key={ai} className="pool-up-acct-row">
        <input className="pool-up-acct-name" value={a.name} onChange={(e) => setAccount(gi, ai, 'name', e.target.value)} placeholder={t.upRelayName} />
        <input className="pool-up-acct-key" value={a.api_key} onChange={(e) => setAccount(gi, ai, 'api_key', e.target.value)} placeholder="api_key (sk-...)" />
        <button type="button" className="btn btn-sm pool-up-acct-del" onClick={() => removeAccount(gi, ai)} disabled={g.accounts.length <= 1} aria-label="remove account">×</button>
      </div>)}
      <button type="button" className="btn btn-sm pool-up-add" onClick={() => addAccount(gi)}>+ {t.upAddTier}</button>

      <div className="pool-up-section">
        <label className="pool-up-toggle"><input type="checkbox" checked={g.key.enabled} onChange={(e) => setKeyF(gi, 'enabled', e.target.checked)} />{t.upCreateKey}</label>
        {g.key.enabled && <div className="pool-up-fold">
          <small className="muted pool-up-hint">{t.upKeyUseSiteAdmin}</small>
          <label className="pool-up-subtoggle"><input type="checkbox" checked={g.key.override} onChange={(e) => setKeyF(gi, 'override', e.target.checked)} />{t.upKeyOverride}</label>
          {g.key.override && <div className="field-row pool-up-override">
            <div><label>{t.upUserEmail}</label><input value={g.key.email} onChange={(e) => setKeyF(gi, 'email', e.target.value)} placeholder="admin@sub2api.local" /></div>
            <div><label>{t.upUserPass}</label><input type="password" value={g.key.password} onChange={(e) => setKeyF(gi, 'password', e.target.value)} /></div>
          </div>}
          <small className="muted pool-up-hint">{t.upKeyLoginHint}</small>
        </div>}
      </div>

      <div className="pool-up-section">
        <label className="pool-up-toggle"><input type="checkbox" checked={g.mon.enabled} onChange={(e) => setMonF(gi, 'enabled', e.target.checked)} />{t.upMonitor}</label>
        {g.mon.enabled && <div className="pool-up-fold">
          <div className="field-row">
            <div><label>{t.upMonModel}</label><input value={g.mon.primary_model} onChange={(e) => setMonF(gi, 'primary_model', e.target.value)} placeholder="gpt-5.5" /></div>
            <div><label>{t.upMonInterval}</label><input type="number" value={g.mon.interval_seconds} onChange={(e) => setMonF(gi, 'interval_seconds', e.target.value)} placeholder="60 (15-3600)" /></div>
          </div>
          <small className="muted pool-up-hint">{t.upMonHint}</small>
        </div>}
      </div>
    </div>)}
    <button type="button" className="btn btn-sm pool-up-add" onClick={addGroup}>+ {t.upAddGroup}</button>
  </Modal>
}

// ---------- 批次 ----------
export function BatchesPage({ site, lang }: { site: number; lang: Lang }) {
  const t = copy[lang]; const toast = useToast()
  const { data: rowsData, loading, refresh: load } = useResource(`batches:${site}`, () => api.getBatches(site), (e: any) => toast(String(e?.message || e), 'err'))
  const rows = rowsData || []
  const del = async (b: BatchRow) => { if (!confirm(t.confirmDeleteBatch)) return; try { const r = await api.deleteBatch(site, b.id, true); toast(`删除: ${r.batch_name} (远端${r.deleted_remote})`); invalidateResource(`pool-overview:${site}`); invalidateResource(`accounts:${site}:`); invalidateResource(`group-membership:${site}`); load() } catch (e: any) { toast(String(e.message || e), 'err') } }
  return <div className="pool-page">
    <p className="muted pool-batches-desc">{t.batchesDesc}</p>
    <div className="table-wrap"><table>
    <thead><tr><th>{t.batchName}</th><th>group</th><th>{t.batchAccounts}</th><th>{t.batchImported}</th><th>{t.batchLastSnap}</th><th></th></tr></thead>
    <tbody>{loading && !rows.length && <SkeletonRows cols={6} />}{rows.map((b) => <tr key={b.id}>
      <td>{b.name}</td><td className="mono">{b.sub2_group_id ?? '-'}</td><td>{b.account_count ?? '?'}</td><td className="muted">{b.imported_at || '-'}</td>
      <td className="muted">{b.last_snapshot ? `✓${b.last_snapshot.alive} ✗${b.last_snapshot.dead} (${b.last_snapshot.taken_at?.slice(5, 16)})` : '—'}</td>
      <td><button className="danger-pill" onClick={() => del(b)}>{t.deleteBatch}</button></td>
    </tr>)}{!loading && !rows.length && <tr><td colSpan={6} className="empty">{t.noData}</td></tr>}</tbody>
  </table></div>
  </div>
}

// ---------- 回收站 ----------
export function RecyclePage({ site, lang }: { site: number; lang: Lang }) {
  const t = copy[lang]; const toast = useToast()
  const { data: rowsData, loading, refresh: load } = useResource(`recycle:${site}`, () => api.getRecycle(site), (e: any) => toast(String(e?.message || e), 'err'))
  const rows = rowsData || []
  const restore = async (id: number) => { try { const r = await api.restoreRecycle({ site_id: site, recycle_id: id }); toast(r.restored ? t.restore + ' ✓' : (r.error || 'fail'), r.restored ? 'ok' : 'err'); load() } catch (e: any) { toast(String(e.message || e), 'err') } }
  return <div className="pool-page"><div className="table-wrap"><table>
    <thead><tr><th>{t.colId}</th><th>{t.colEmail}</th><th>{t.colVerdict}</th><th>{t.recycleDeletedAt}</th><th>{t.recycleReason}</th><th></th></tr></thead>
    <tbody>{loading && !rows.length && <SkeletonRows cols={6} />}{rows.map((r) => <tr key={r.id}>
      <td className="mono">{r.sub2_account_id}</td><td>{r.cpa_email || '-'}</td><td><VerdictTag v={r.verdict} lang={lang} /></td><td className="muted">{r.deleted_at}</td><td className="muted">{r.reason}</td>
      <td>{r.can_restore ? <button className="btn btn-sm" onClick={() => restore(r.id)}>{t.restore}</button> : <span className="muted">{t.cannotRestore}</span>}</td>
    </tr>)}{!loading && !rows.length && <tr><td colSpan={6} className="empty">{t.noData}</td></tr>}</tbody>
  </table></div></div>
}
