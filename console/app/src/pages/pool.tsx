// 账号池：总览 / 账号管理(表+批量栏+条件选中+盘点+导入) / 批次 / 回收站。
import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../api'
import type { AccountRow, BatchRow, GroupRow, PoolOverview, SiteInfo } from '../api'
import { copy, formatInt, MetricCard, Modal, SkeletonCards, SkeletonRows, Spinner, Usage, useToast, VerdictTag, cls, type Lang } from '../lib'

const ICON = {
  trash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg>,
  warn: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>,
  bolt: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>,
}

// ---------- 账号池总览 ----------
export function PoolOverviewPage({ site, lang }: { site: number; lang: Lang }) {
  const t = copy[lang]
  const [ov, setOv] = useState<PoolOverview | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { let on = true; api.getPoolOverview(site).then((d) => on && setOv(d)).catch((e) => on && setErr(String(e.message || e))); return () => { on = false } }, [site])
  if (err) return <div className="error-banner">{err}</div>
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
  return <>
    <section className="metrics-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>{cards.map((c) => <MetricCard key={c.label} {...c} />)}</section>
    <section className="panel" style={{ marginTop: 16 }}>
      <h2>{t.byGroup}</h2>
      <div className="grp-grid">{(ov.by_group || []).map((g) => <div className="grp-card" key={g.group}>
        <h3>{g.name || `group#${g.group}`}</h3><div className="sub">group #{g.group}</div>
        <div className="grp-stats"><div><b>{g.total}</b>{t.grpTotal}</div><div><b style={{ color: 'var(--success)' }}>{g.alive}</b>{t.grpAlive}</div><div><b style={{ color: 'var(--danger)' }}>{g.dead}</b>{t.grpDead}</div></div>
      </div>)}{!ov.by_group?.length && <div className="notice">{t.noData}</div>}</div>
    </section>
  </>
}

// ---------- 账号管理 ----------
export function AccountsPage({ siteInfo, lang }: { siteInfo: SiteInfo; lang: Lang }) {
  const site = siteInfo.id
  const t = copy[lang]
  const toast = useToast()
  const [rows, setRows] = useState<AccountRow[]>([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('all')
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [proxies, setProxies] = useState<any[]>([])
  const [editField, setEditField] = useState<'priority' | 'concurrency' | 'proxy' | 'group'>('priority')
  const [bulkVal, setBulkVal] = useState('')
  const [inv, setInv] = useState<api.InvStatus | null>(null)
  const [cleanup, setCleanup] = useState<api.CleanupStatus | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [upstreamOpen, setUpstreamOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const accs = groupFilter === 'all' ? await api.getAllAccounts(site, { search: search || undefined }) : await api.getGroupAccounts(site, Number(groupFilter))
      setRows(accs)
    } catch (e: any) { toast(String(e.message || e), 'err') } finally { setLoading(false) }
  }, [site, groupFilter, search, toast])

  useEffect(() => { load() }, [load])
  useEffect(() => { setSel(new Set()); api.getGroups(site).then(setGroups).catch(() => {}); api.getProxies(site).then(setProxies).catch(() => {}) }, [site])

  // 盘点/清理进度轮询
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

  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allVisibleSelected = rows.length > 0 && rows.every((r) => sel.has(r.id))
  const toggleAll = () => setSel((s) => { if (allVisibleSelected) return new Set() ; const n = new Set(s); rows.forEach((r) => n.add(r.id)); return n })
  const selectByCond = (cond: string) => {
    const match = (r: AccountRow) => {
      const v = r.verdict || 'pending'
      if (cond === 'all') return true
      if (cond === 'dead') return v === 'dead' || v === 'auth_fail'
      if (cond === 'alive') return v === 'alive' && (r.used_primary == null || r.used_primary < 100)
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
    try { await api.doBulk(body); toast(t.apply + ' ✓'); setBulkVal(''); load() } catch (e: any) { toast(String(e.message || e), 'err') }
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
  return <>
    <div className="toolbar">
      <input style={{ flex: '1 1 240px' }} placeholder={t.accountSearch} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
      <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}><option value="all">{t.allGroups}</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name || `#${g.id}`}</option>)}</select>
      <button className="btn" onClick={load} disabled={loading}>{loading ? <><Spinner /> {t.refresh}</> : t.refresh}</button>
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
    {running && prog && <div className="panel" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>{inv?.running ? t.probing : t.cleaning} {prog.done}/{prog.total}{cleanup?.running ? ` · 删${cleanup.deleted} 失败${cleanup.failed}` : ''}</span>{cleanup?.running && <button className="danger-pill" onClick={() => api.abortCleanup(site)}>{t.stop}</button>}</div>
      <div className="prog"><div className="prog-fill" style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} /></div>
    </div>}

    {/* 批量操作栏 */}
    {sel.size > 0 && <div className="bulk-bar">
      <span className="bulk-count">{t.selected} {sel.size}</span>
      <button className="mini-btn" onClick={() => setSel(new Set())}>{t.clearSel}</button>
      <div className="bar-div" />
      <button className="mini-btn green" onClick={doProbe} disabled={running}>{ICON.bolt}{t.probeSelected}</button>
      <div className="bar-div" />
      <div className="seg-wrap">{(['priority', 'concurrency', 'proxy', 'group'] as const).map((f) => <button key={f} className={cls('seg-btn', editField === f && 'active')} onClick={() => setEditField(f)}>{f === 'priority' ? t.opPriority : f === 'concurrency' ? t.opConcurrency : f === 'proxy' ? t.opProxy : t.opGroup}</button>)}</div>
      {editField === 'proxy' ? <select className="bulk-val" value={bulkVal} onChange={(e) => setBulkVal(e.target.value)}><option value="">{t.noProxy}</option>{proxies.map((p) => <option key={p.id} value={p.id}>{p.name || `#${p.id}`}</option>)}</select>
        : editField === 'group' ? <select className="bulk-val" value={bulkVal} onChange={(e) => setBulkVal(e.target.value)}><option value="">{t.selectGroup}</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name || `#${g.id}`}</option>)}</select>
        : <input className="bulk-val" type="number" value={bulkVal} onChange={(e) => setBulkVal(e.target.value)} placeholder={editField === 'priority' ? t.opPriority : t.opConcurrency} />}
      <button className="btn btn-primary btn-sm" onClick={doBulkEdit}>{t.apply}</button>
      <div className="bulk-spacer" />
      <div className="danger-zone">
        <span className="dz-label">{ICON.warn}{t.dangerLabel}</span>
        <button className="danger-pill" onClick={() => doDanger('clear-error')}>{t.clearError}</button>
        <button className="danger-pill" onClick={() => doDanger('clear-rate-limit')}>{t.clearRate}</button>
        <button className="danger-pill-solid" onClick={() => doDanger('delete')}>{ICON.trash}{t.deleteAccount}</button>
      </div>
    </div>}

    {/* 账号表 */}
    <div className="table-wrap"><table>
      <thead><tr>
        <th className="col-check"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="select all" /></th>
        <th>{t.colId}</th><th>{t.colName}</th><th>{t.colType}</th><th>{t.colVerdict}</th><th>{t.colStatus}</th><th>{t.colUsage}</th><th>{t.colPriority}</th><th>{t.colProbe}</th>
      </tr></thead>
      <tbody>
        {loading && !rows.length && <SkeletonRows cols={9} />}
        {rows.map((r) => <tr key={r.id}>
          <td className="col-check"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
          <td className="mono">{r.id}</td>
          <td><span className="trunc trunc-user" title={r.email || r.name || ''}>{r.email || r.name || '-'}</span></td>
          <td>{r.type}</td>
          <td><VerdictTag v={r.verdict} lang={lang} /></td>
          <td><span className="mono">{r.status || '-'}</span></td>
          <td><Usage pct={r.used_primary} /> <small className="muted">{r.used_5h != null ? `/${Math.round(r.used_5h)}%` : ''}</small></td>
          <td>{r.priority ?? '-'}</td>
          <td className="muted">{r.last_probe_at || '—'}</td>
        </tr>)}
        {!loading && !rows.length && <tr><td colSpan={9} className="empty">{t.noData}</td></tr>}
      </tbody>
    </table></div>

    {importOpen && <ImportModal site={site} lang={lang} groups={groups} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); load() }} />}
    {upstreamOpen && <UpstreamModal site={site} lang={lang} onClose={() => setUpstreamOpen(false)} onDone={() => { setUpstreamOpen(false); load() }} />}
  </>
}

function ImportModal({ site, lang, groups, onClose, onDone }: { site: number; lang: Lang; groups: GroupRow[]; onClose: () => void; onDone: () => void }) {
  const t = copy[lang]; const toast = useToast()
  const [name, setName] = useState(''); const [prio, setPrio] = useState('50'); const [conc, setConc] = useState('3'); const [content, setContent] = useState(''); const [busy, setBusy] = useState(false)
  void groups
  const submit = async () => {
    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean)
    const cpa: any[] = []
    for (const l of lines) { try { const o = JSON.parse(l); Array.isArray(o) ? cpa.push(...o) : cpa.push(o) } catch { /* skip */ } }
    if (!cpa.length) { toast('无有效 JSON', 'err'); return }
    setBusy(true)
    try { const r = await api.doImport({ site_id: site, cpa_list: cpa, name: name || undefined, priority: Number(prio), concurrency: Number(conc) }); toast(`导入: ${JSON.stringify(r.result || r).slice(0, 80)}`); onDone() } catch (e: any) { toast(String(e.message || e), 'err') } finally { setBusy(false) }
  }
  return <Modal title={t.importTitle} desc={t.importDesc} onClose={onClose} actions={<><button className="btn" onClick={onClose}>{t.cancel}</button><button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? <><Spinner /> {t.importAccounts}</> : t.importAccounts}</button></>}>
    <label>{t.importBatchName}</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="batch-..." />
    <div className="field-row"><div><label>{t.importPriority}</label><input type="number" value={prio} onChange={(e) => setPrio(e.target.value)} /></div><div><label>{t.importConcurrency}</label><input type="number" value={conc} onChange={(e) => setConc(e.target.value)} /></div></div>
    <label>{t.importContent}</label><textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder='{"access_token":"...","refresh_token":"...","email":"..."}' />
  </Modal>
}

function UpstreamModal({ site, lang, onClose, onDone }: { site: number; lang: Lang; onClose: () => void; onDone: () => void }) {
  const t = copy[lang]; const toast = useToast()
  const [baseUrl, setBaseUrl] = useState(''); const [tiers, setTiers] = useState(''); const [busy, setBusy] = useState(false)
  const submit = async () => {
    const parsed = tiers.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [group, api_key, rate] = l.split(',').map((x) => x.trim()); return { group, api_key, rate_multiplier: Number(rate || 1) } }).filter((x) => x.api_key)
    if (!baseUrl || !parsed.length) { toast('缺 base_url 或档位', 'err'); return }
    setBusy(true)
    try { const r = await api.doUpstreamImport({ site_id: site, base_url: baseUrl, tiers: parsed }); toast(`中转: created ${r.created}/${r.total}`); onDone() } catch (e: any) { toast(String(e.message || e), 'err') } finally { setBusy(false) }
  }
  return <Modal title={t.upstreamTitle} desc={t.upstreamDesc} onClose={onClose} actions={<><button className="btn" onClick={onClose}>{t.cancel}</button><button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? <><Spinner /> {t.upstreamImport}</> : t.upstreamImport}</button></>}>
    <label>{t.upstreamBaseUrl}</label><input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://upstream.example.com/v1" />
    <label>{t.upstreamTiers}</label><textarea value={tiers} onChange={(e) => setTiers(e.target.value)} placeholder={'plus,sk-xxx,1\npro,sk-yyy,2'} />
  </Modal>
}

// ---------- 批次 ----------
export function BatchesPage({ site, lang }: { site: number; lang: Lang }) {
  const t = copy[lang]; const toast = useToast()
  const [rows, setRows] = useState<BatchRow[]>([]); const [loading, setLoading] = useState(true)
  const load = useCallback(() => { setLoading(true); api.getBatches(site).then(setRows).catch((e) => toast(String(e.message || e), 'err')).finally(() => setLoading(false)) }, [site, toast])
  useEffect(() => { load() }, [load])
  const del = async (b: BatchRow) => { if (!confirm(t.confirmDeleteBatch)) return; try { const r = await api.deleteBatch(site, b.id, true); toast(`删除: ${r.batch_name} (远端${r.deleted_remote})`); load() } catch (e: any) { toast(String(e.message || e), 'err') } }
  return <>
    <p className="muted" style={{ marginTop: -6, marginBottom: 14 }}>{t.batchesDesc}</p>
    <div className="table-wrap"><table>
    <thead><tr><th>{t.batchName}</th><th>group</th><th>{t.batchAccounts}</th><th>{t.batchImported}</th><th>{t.batchLastSnap}</th><th></th></tr></thead>
    <tbody>{loading && !rows.length && <SkeletonRows cols={6} />}{rows.map((b) => <tr key={b.id}>
      <td>{b.name}</td><td className="mono">{b.sub2_group_id ?? '-'}</td><td>{b.account_count ?? '?'}</td><td className="muted">{b.imported_at || '-'}</td>
      <td className="muted">{b.last_snapshot ? `✓${b.last_snapshot.alive} ✗${b.last_snapshot.dead} (${b.last_snapshot.taken_at?.slice(5, 16)})` : '—'}</td>
      <td><button className="danger-pill" onClick={() => del(b)}>{t.deleteBatch}</button></td>
    </tr>)}{!loading && !rows.length && <tr><td colSpan={6} className="empty">{t.noData}</td></tr>}</tbody>
  </table></div>
  </>
}

// ---------- 回收站 ----------
export function RecyclePage({ site, lang }: { site: number; lang: Lang }) {
  const t = copy[lang]; const toast = useToast()
  const [rows, setRows] = useState<any[]>([]); const [loading, setLoading] = useState(true)
  const load = useCallback(() => { setLoading(true); api.getRecycle(site).then(setRows).catch((e) => toast(String(e.message || e), 'err')).finally(() => setLoading(false)) }, [site, toast])
  useEffect(() => { load() }, [load])
  const restore = async (id: number) => { try { const r = await api.restoreRecycle({ site_id: site, recycle_id: id }); toast(r.restored ? t.restore + ' ✓' : (r.error || 'fail'), r.restored ? 'ok' : 'err'); load() } catch (e: any) { toast(String(e.message || e), 'err') } }
  return <div className="table-wrap"><table>
    <thead><tr><th>{t.colId}</th><th>{t.colEmail}</th><th>{t.colVerdict}</th><th>{t.recycleDeletedAt}</th><th>{t.recycleReason}</th><th></th></tr></thead>
    <tbody>{loading && !rows.length && <SkeletonRows cols={6} />}{rows.map((r) => <tr key={r.id}>
      <td className="mono">{r.sub2_account_id}</td><td>{r.cpa_email || '-'}</td><td><VerdictTag v={r.verdict} lang={lang} /></td><td className="muted">{r.deleted_at}</td><td className="muted">{r.reason}</td>
      <td>{r.can_restore ? <button className="btn btn-sm" onClick={() => restore(r.id)}>{t.restore}</button> : <span className="muted">{t.cannotRestore}</span>}</td>
    </tr>)}{!loading && !rows.length && <tr><td colSpan={6} className="empty">{t.noData}</td></tr>}</tbody>
  </table></div>
}
