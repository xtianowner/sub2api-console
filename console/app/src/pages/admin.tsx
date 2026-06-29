// 平台管理：用户管理 / 站点管理 / 设置 / 登录。
import { useCallback, useEffect, useState } from 'react'
import * as api from '../api'
import type { SiteInfo, UserRow } from '../api'
import { copy, Modal, Pager, SkeletonCards, SkeletonRows, Spinner, cls, useResource, useToast, type Lang } from '../lib'
import './admin.css'

// 客户端分页页大小（用户列表已整批拉回，纯前端切片，选中态按 id 跨页保留）。
const USERS_PAGE_SIZE = 50
// 常见一次性 / 临时邮箱域名（注册机最爱）；点击预置或「全部」填入筛选框。
const DISPOSABLE_DOMAINS = ['sharklasers.com', 'guerrillamail.com', 'guerrillamail.net', 'grr.la', 'web-library.net', 'mailinator.com', '10minutemail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'maildrop.cc', 'throwawaymail.com', 'getnada.com', 'mohmal.com', 'dropmail.me', 'linshiyouxiang.net']
const fmtDt = (s?: string | null) => (s ? String(s).replace('T', ' ').replace(/\.\d+Z?$/, '').replace('Z', '').slice(0, 16) : '—')
const emailLocal = (e: string) => { const i = e.indexOf('@'); return i < 0 ? e : e.slice(0, i) }
// 域名/后缀 token 匹配：以 '.' 开头按纯后缀(如 .top)，否则按域名/子域(边界安全，不误伤 evilsharklasers.com)。
function matchDomainToken(email: string, tok: string): boolean {
  const e = email.toLowerCase().trim()
  const k = tok.toLowerCase().trim().replace(/^@/, '')
  if (!k) return false
  if (k.startsWith('.')) return e.endsWith(k)
  return e.endsWith('@' + k) || e.endsWith('.' + k)
}
const ICON_FILTER = <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4, verticalAlign: '-2px' }}><path d="M3 4h18l-7 8v6l-4 2v-8z" /></svg>
const ICON_TRASH = <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 3, verticalAlign: '-2px' }}><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" /></svg>
const ICON_WARN = <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 3, verticalAlign: '-2px' }}><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
const ICON_GLOBE = <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 3, verticalAlign: '-2px' }}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" /></svg>

// ---------- 用户管理（含恶意账号清理：域名/后缀/+号别名/子串 筛选 → 多选 → 批量删/禁；最近使用 IP 按需拉）----------
export function UsersPage({ siteInfo, lang }: { siteInfo: SiteInfo; lang: Lang }) {
  const site = siteInfo.id; const t = copy[lang]; const toast = useToast()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState(1)
  const [ipMap, setIpMap] = useState<Record<number, api.UserIpInfo>>({})
  const [ipMeta, setIpMeta] = useState<{ users: number; synced_at: string | null } | null>(null)
  const [ipSyncing, setIpSyncing] = useState(false)
  const [ipQ, setIpQ] = useState('')
  const [delProg, setDelProg] = useState<{ done: number; total: number } | null>(null)
  // 恶意筛选条件
  const [mcOpen, setMcOpen] = useState(false)
  const [domains, setDomains] = useState('')
  const [plusAlias, setPlusAlias] = useState(false)
  const [substr, setSubstr] = useState('')
  const [zeroOnly, setZeroOnly] = useState(false)
  const [mcOn, setMcOn] = useState(false)        // 筛选生效 → 表格仅显示匹配

  const { data: rowsData, loading, refreshing, refresh: refreshUsers } = useResource(`users:${site}`, () => api.getUsers(site), (e: any) => toast(String(e?.message || e), 'err'))
  const rows = rowsData || []
  // 改/删后：清选择 + 退出筛选 + 重拉（SWR 静默替换，不白屏）
  const load = useCallback(() => { setSel(new Set()); setMcOn(false); refreshUsers() }, [refreshUsers])
  // 最近使用 IP：读 console 本地 SQLite 缓存（秒级，后台每~10分钟自动增量同步），进页自动读；「刷新IP」触发一次即时增量同步。
  const loadIpMap = useCallback(() => { api.getUsersIpMap(site).then((r) => { setIpMap(r.ips); setIpMeta({ users: r.users_with_ip, synced_at: r.synced_at }) }).catch(() => { setIpMap({}); setIpMeta(null) }) }, [site])
  useEffect(() => { setIpMap({}); setIpMeta(null); setIpQ(''); loadIpMap() }, [loadIpMap])
  const syncIp = async () => { if (ipSyncing) return; setIpSyncing(true); try { const r = await api.syncUsersIp(site); setIpMap(r.ips); setIpMeta({ users: r.users_with_ip, synced_at: r.synced_at }) } catch (e: any) { toast(String(e.message || e), 'err') } finally { setIpSyncing(false) } }
  const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))

  const setRole = async (u: UserRow, role: string) => { try { const r = await api.setUserRole({ site_id: site, user_id: u.id, role }); if (r.error) throw new Error(r.error); toast(`role → ${role} ✓`); load() } catch (e: any) { toast(String(e.message || e), 'err') } }
  const setStatus = async (u: UserRow, status: string) => { try { const r = await api.setUserStatus({ site_id: site, user_id: u.id, status }); if (r.error) throw new Error(r.error); toast(`status → ${status} ✓`); load() } catch (e: any) { toast(String(e.message || e), 'err') } }

  // 恶意匹配（OR：任一条件命中即算；zeroOnly 再 AND 收窄到零充值）。admin 永不计入。
  const isMalicious = useCallback((u: UserRow) => {
    if (u.role === 'admin') return false
    const email = (u.email || '').toLowerCase()
    if (!email) return false
    const toks = domains.split(/[\s,]+/).filter(Boolean)
    let hit = false
    if (toks.length && toks.some((tk) => matchDomainToken(email, tk))) hit = true
    if (plusAlias && emailLocal(email).includes('+')) hit = true
    if (substr.trim() && email.includes(substr.trim().toLowerCase())) hit = true
    if (!hit) return false
    if (zeroOnly && (Number(u.total_recharged || 0) > 0 || Number(u.balance || 0) > 0)) return false
    return true
  }, [domains, plusAlias, substr, zeroOnly])
  const hasCriteria = domains.split(/[\s,]+/).filter(Boolean).length > 0 || plusAlias || !!substr.trim()
  const matchedCount = hasCriteria ? rows.filter(isMalicious).length : 0

  const applyFilter = () => {
    if (!hasCriteria) { toast(t.mc_noCriteria, 'err'); return }
    const matched = rows.filter(isMalicious)
    setMcOn(true); setSel(new Set(matched.map((u) => u.id))); setPage(1)
  }
  const clearFilter = () => { setMcOn(false); setSel(new Set()) }
  const addPreset = (d: string) => setDomains((s) => { const toks = s.split(/[\s,]+/).filter(Boolean); return toks.includes(d) ? s : (s.trim() ? `${s.trim()}, ${d}` : d) })
  const addAllPresets = () => setDomains((s) => { const toks = new Set(s.split(/[\s,]+/).filter(Boolean)); DISPOSABLE_DOMAINS.forEach((d) => toks.add(d)); return Array.from(toks).join(', ') })

  // 可见集：筛选中 → 仅匹配；否则 → 邮箱/ID 搜索 + IP 搜索（IP 命中=该用户用过的任一 IP 含 ipQ 子串）。
  const ipMatch = (u: UserRow) => { const v = ipQ.trim(); if (!v) return true; const info = ipMap[u.id]; return !!info && info.all_ips.some((ip) => ip.includes(v)) }
  const base = mcOn ? rows.filter(isMalicious) : rows.filter((u) => (!q || (u.email || '').toLowerCase().includes(q.toLowerCase()) || String(u.id) === q) && ipMatch(u))
  useEffect(() => { setPage(1) }, [q, ipQ, mcOn, site])
  const totalPages = Math.max(1, Math.ceil(base.length / USERS_PAGE_SIZE))
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [page, totalPages])
  const pageRows = base.slice((page - 1) * USERS_PAGE_SIZE, page * USERS_PAGE_SIZE)

  const selectable = (u: UserRow) => u.role !== 'admin'
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const pageSelectable = pageRows.filter(selectable)
  const allPageSel = pageSelectable.length > 0 && pageSelectable.every((r) => sel.has(r.id))
  const toggleAll = () => setSel((s) => { const n = new Set(s); if (pageSelectable.every((r) => n.has(r.id))) pageSelectable.forEach((r) => n.delete(r.id)); else pageSelectable.forEach((r) => n.add(r.id)); return n })

  // 删除目标：mcOn 时只删「仍命中当前(已锁定)筛选」的 id（防御层，即便选中态含越界 id 也不误删）。
  // 分块串行(每块 ≤200)，避免单请求过长被 CF Tunnel(~100s) 截断后前端误报失败而后端仍在删。
  const doDelete = async () => {
    if (!sel.size || busy) return
    const matched = mcOn ? new Set(rows.filter(isMalicious).map((u) => u.id)) : null
    const ids = Array.from(sel).filter((id) => !matched || matched.has(id))
    if (!ids.length) return
    if (!confirm(fill(t.mc_confirmDelete, { n: ids.length }))) return
    setBusy(true); setDelProg({ done: 0, total: ids.length })
    let ok = 0, fail = 0
    try {
      for (let i = 0; i < ids.length; i += 200) {
        const r = await api.bulkDeleteUsers({ site_id: site, user_ids: ids.slice(i, i + 200) })
        if (r.error) throw new Error(r.error)
        ok += r.deleted; fail += r.failed; setDelProg({ done: Math.min(i + 200, ids.length), total: ids.length })
      }
      toast(fill(t.mc_doneTpl, { ok, fail, req: ids.length }), fail ? 'err' : 'ok')
    } catch (e: any) { toast(`${fill(t.mc_doneTpl, { ok, fail, req: ids.length })} · ${String(e.message || e)}`, 'err') }
    finally { setBusy(false); setDelProg(null); load(); loadIpMap() }
  }

  const ipCell = (u: UserRow) => {
    const info = ipMap[u.id]
    if (info?.last_ip) return <span className="mono" title={info.all_ips.length > 1 ? `${info.all_ips.length} IP: ${info.all_ips.join(', ')}` : undefined}>{info.last_ip}{info.all_ips.length > 1 ? <span className="muted"> +{info.all_ips.length - 1}</span> : null}</span>
    return <span className="muted">—</span>
  }

  return <>
    <div className="toolbar">
      <input style={{ flex: '1 1 160px' }} placeholder={t.accountSearch} value={q} onChange={(e) => setQ(e.target.value)} disabled={mcOn} />
      <span className="users-ip-search">{ICON_GLOBE}<input placeholder={ipMeta && ipMeta.users > 0 ? t.mc_ipSearchPh : t.mc_ipNeedSync} value={ipQ} onChange={(e) => setIpQ(e.target.value)} disabled={mcOn || !ipMeta || ipMeta.users === 0} /></span>
      <button className="btn btn-sm" onClick={syncIp} disabled={ipSyncing || mcOn} title={t.mc_ipMetaHint}>{ipSyncing ? <><Spinner /> {t.mc_ipLoading}</> : <>{ICON_GLOBE}{t.mc_ipReload}</>}</button>
      <button className="btn" onClick={load} disabled={loading || refreshing}>{(loading || refreshing) ? <><Spinner /> {t.refresh}</> : t.refresh}</button>
      <button className={cls('btn', mcOpen && 'btn-primary')} onClick={() => setMcOpen((v) => !v)}>{ICON_FILTER}{mcOpen ? t.mc_hide : t.mc_toggle}</button>
      <div className="bulk-spacer" />
      {ipMeta && <span className="kv users-ip-kv" title={t.mc_ipMetaHint}>{ICON_GLOBE}{fill(t.mc_ipMeta, { n: ipMeta.users })}{ipMeta.synced_at ? ` · ${ipMeta.synced_at.slice(5, 16)}` : ''}</span>}
      {!siteInfo.role_channel && <span className="kv adm-warn-kv">⚠ {t.roleChannelOff}</span>}
    </div>

    {mcOpen && <div className="panel mc-panel">
      <div className="mc-head">{ICON_FILTER}<b>{t.mc_title}</b></div>
      <p className="muted mc-desc">{t.mc_desc}</p>
      <div className="mc-row">
        <label className="mc-label">{t.mc_domains}</label>
        <input className="mc-domains" placeholder={t.mc_domainsPh} value={domains} onChange={(e) => setDomains(e.target.value)} disabled={mcOn} />
      </div>
      <div className="mc-presets">
        <span className="mc-presets-lbl">{t.mc_presets}:</span>
        {DISPOSABLE_DOMAINS.slice(0, 8).map((d) => <button key={d} className="cond-pill" onClick={() => addPreset(d)} disabled={mcOn}>{d}</button>)}
        <button className="cond-pill mc-pill-all" onClick={addAllPresets} disabled={mcOn}>+ {t.condAll}</button>
      </div>
      <div className="mc-row mc-row-wrap">
        <label className="mc-check"><input type="checkbox" checked={plusAlias} onChange={(e) => setPlusAlias(e.target.checked)} disabled={mcOn} /> {t.mc_plusAlias}</label>
        <span className="mc-inline"><span className="mc-label">{t.mc_substr}</span><input className="mc-substr" placeholder={t.mc_substrPh} value={substr} onChange={(e) => setSubstr(e.target.value)} disabled={mcOn} /></span>
        <label className="mc-check"><input type="checkbox" checked={zeroOnly} onChange={(e) => setZeroOnly(e.target.checked)} disabled={mcOn} /> {t.mc_zeroOnly}</label>
        <div className="bulk-spacer" />
        <span className="muted mc-matched">{fill(t.mc_matched, { n: matchedCount, m: rows.length })}</span>
        <button className="btn btn-primary btn-sm" onClick={applyFilter} disabled={mcOn}>{t.mc_filterSelect}</button>
      </div>
    </div>}

    {mcOn && <div className="mc-active-bar"><span className="mc-active-tag">{ICON_FILTER}{t.mc_filterActive}</span><button className="mini-btn" onClick={clearFilter}>{t.mc_clearFilter}</button></div>}

    {sel.size > 0 && <div className="bulk-bar">
      <span className="bulk-count">{t.selected} {sel.size}</span>
      <button className="mini-btn" onClick={() => setSel(new Set())}>{t.clearSel}</button>
      <div className="bulk-spacer" />
      <div className="danger-zone">
        <span className="dz-label">{ICON_WARN}{t.dangerLabel}</span>
        {delProg && <span className="mc-matched">{delProg.done}/{delProg.total}</span>}
        <button className="danger-pill-solid" onClick={doDelete} disabled={busy}>{busy ? <><Spinner /> {t.mc_deleting}</> : <>{ICON_TRASH}{t.mc_deleteSel}</>}</button>
      </div>
    </div>}

    {mcOpen && <p className="muted mc-ip-note">{t.mc_ipUnavail}</p>}

    <div className="table-wrap"><table className="users-table">
      <thead><tr>
        <th className="col-check"><input type="checkbox" checked={allPageSel} onChange={toggleAll} aria-label="select all" /></th>
        <th>{t.colId}</th><th>{t.colEmail}</th><th>{t.colRole}</th><th>{t.colUserStatus}</th>
        <th>{t.mc_colCreated}</th><th>{t.mc_colRecharged}</th><th>{t.mc_colLastIp}</th><th></th>
      </tr></thead>
      <tbody>{loading && !base.length && <SkeletonRows cols={9} />}{pageRows.map((u) => <tr key={u.id} className={cls(mcOn && 'mc-hit-row')}>
        <td className="col-check">{selectable(u) ? <input type="checkbox" checked={sel.has(u.id)} onChange={() => toggle(u.id)} /> : <span className="muted" title="admin">—</span>}</td>
        <td className="mono">{u.id}</td>
        <td className="adm-user-email" title={u.email || u.username || '-'}>{u.email || u.username || '-'}</td>
        <td><span className={cls('tag', u.role === 'admin' ? 'role-admin' : 'role-user')}>{u.role === 'admin' ? t.roleAdmin : t.roleUser}</span></td>
        <td><span className={cls('tag', u.status === 'disabled' ? 'disabled' : 'active')}>{u.status === 'disabled' ? t.statusDisabled : t.statusActive}</span></td>
        <td className="muted mono adm-dt">{fmtDt(u.created_at)}</td>
        <td className="adm-num">{Number(u.total_recharged || 0) > 0 ? u.total_recharged : <span className="muted">0</span>}</td>
        <td>{ipCell(u)}</td>
        <td><div className="row-actions">
          {siteInfo.role_channel && (u.role === 'admin' ? <button className="btn btn-sm" onClick={() => setRole(u, 'user')}>{t.setUser}</button> : <button className="btn btn-sm" onClick={() => setRole(u, 'admin')}>{t.setAdmin}</button>)}
          {u.status === 'disabled' ? <button className="btn btn-sm" onClick={() => setStatus(u, 'active')}>{t.enable}</button> : <button className="danger-pill" onClick={() => setStatus(u, 'disabled')}>{t.disable}</button>}
        </div></td>
      </tr>)}{!loading && !base.length && <tr><td colSpan={9} className="empty">{(mcOn || q || ipQ) ? t.mc_noMatch : t.noData}</td></tr>}</tbody>
    </table></div>
    <Pager page={page} pageSize={USERS_PAGE_SIZE} total={base.length} onPage={setPage} lang={lang} />
  </>
}

// ---------- 站点管理 ----------
export function SitesPage({ lang, onSitesChanged }: { lang: Lang; onSitesChanged: () => void }) {
  const t = copy[lang]; const toast = useToast()
  const [edit, setEdit] = useState<SiteInfo | null>(null); const [adding, setAdding] = useState(false)
  const { data: sitesData, loading, refresh: load } = useResource('sites', () => api.getSites(), (e: any) => toast(String(e?.message || e), 'err'))
  const sites = sitesData || []
  const check = async (s: SiteInfo) => { try { const r = await api.checkSite(s.id); toast(r.health === 'healthy' ? `${s.name}: ${t.siteProbeOk} ${r.latency_ms}ms` : `${s.name}: ${r.error || 'unhealthy'}`, r.health === 'healthy' ? 'ok' : 'err'); load() } catch (e: any) { toast(String(e.message || e), 'err') } }
  const del = async (s: SiteInfo) => { if (!confirm(t.deleteSiteConfirm)) return; try { await api.deleteSite(s.id); toast(`${s.name} ${t.delete} ✓`); load(); onSitesChanged() } catch (e: any) { toast(String(e.message || e), 'err') } }
  return <>
    <div className="toolbar"><div className="bulk-spacer" /><button className="btn btn-primary" onClick={() => setAdding(true)}>{t.addSite}</button></div>
    {loading && !sites.length ? <SkeletonCards n={3} /> : <div className="site-grid">{sites.map((s) => <div className="site-card" key={s.id}>
      <h3 className="adm-site-card-h"><span className={cls('site-dot', s.health)} style={{ display: 'inline-block' }} />{s.name}</h3>
      <div className="sub">{s.base_url}</div>
      <div className="kvs" style={{ margin: '12px 0' }}>
        <span className="kv">{s.kind === 'local' ? t.siteLocal : t.siteRemote}</span>
        {s.observability && <span className="kv adm-kv-on">obs ✓</span>}
        <span className={cls('kv', s.health === 'healthy' ? 'adm-kv-health-ok' : 'adm-kv-health-bad')}>{t.siteHealth}: <b>{s.health}</b>{s.last_latency_ms ? ` ${s.last_latency_ms}ms` : ''}</span>
        <span className={cls('kv', s.role_channel ? 'adm-kv-on' : 'adm-kv-off')}>role: <b>{s.role_channel ? '✓' : '—'}</b></span>
        <span className={cls('kv', s.has_admin_login ? 'adm-kv-on' : 'adm-kv-off')}>{t.siteAdminLogin}: <b>{s.has_admin_login ? '✓' : '—'}</b></span>
      </div>
      <div className="card-actions"><button className="btn btn-sm" onClick={() => check(s)}>{t.siteCheck}</button><button className="btn btn-sm" onClick={() => setEdit(s)}>{t.edit}</button><button className="danger-pill" onClick={() => del(s)}>{t.delete}</button></div>
    </div>)}{!sites.length && <div className="notice"><b>{t.firstSiteTitle}</b><div style={{ marginTop: 6 }}>{t.firstSiteCta}</div><button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>{t.addFirstSite}</button></div>}</div>}
    {(adding || edit) && <SiteModal lang={lang} site={edit} onClose={() => { setAdding(false); setEdit(null) }} onDone={() => { setAdding(false); setEdit(null); load(); onSitesChanged() }} />}
  </>
}

function SiteModal({ lang, site, onClose, onDone }: { lang: Lang; site: SiteInfo | null; onClose: () => void; onDone: () => void }) {
  const t = copy[lang]; const toast = useToast()
  const [f, setF] = useState<any>(site ? { name: site.name, base_url: site.base_url, kind: site.kind, pg_container: site.pg_container || 'sub2api-postgres', ssh_host: site.ssh_host, admin_key: '', admin_login_email: '', admin_login_password: '' } : { name: '', base_url: '', kind: 'remote', pg_container: 'sub2api-postgres', ssh_host: '', admin_key: '', admin_login_email: '', admin_login_password: '' })
  const [busy, setBusy] = useState(false)
  const [pubkey, setPubkey] = useState('')
  useEffect(() => { api.getConsolePubkey().then((r) => setPubkey(r.pubkey)).catch(() => {}) }, [])
  const set = (k: string, v: any) => setF((o: any) => ({ ...o, [k]: v }))
  const submit = async () => {
    setBusy(true)
    try {
      if (site) { await api.updateSite(site.id, f); toast(`${f.name} ${t.save} ✓`) }
      else { const r = await api.addSite(f); if (r.error) throw new Error(r.error); toast(`${f.name} ${t.addSite} ✓`) }
      onDone()
    } catch (e: any) { toast(String(e.message || e), 'err') } finally { setBusy(false) }
  }
  const copyPub = () => { navigator.clipboard?.writeText(pubkey).then(() => toast(t.sitePubkeyCopied)).catch(() => {}) }
  // 整条一键授权命令：自动注入公钥指纹片段(幂等去重) + 完整公钥行，目标机粘贴即用。
  const sshCmd = pubkey
    ? `mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && grep -vF '${pubkey.split(/\s+/)[1] || ''}' ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.tmp && mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys && printf '%s\\n' '${pubkey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`
    : ''
  const copyCmd = () => { navigator.clipboard?.writeText(sshCmd).then(() => toast(t.siteSshCmdCopied)).catch(() => {}) }
  return <Modal title={site ? t.editSiteTitle : t.addSiteTitle} onClose={onClose} actions={<><button className="btn" onClick={onClose}>{t.cancel}</button><button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? <><Spinner /> {t.save}</> : t.save}</button></>}>
    <p className="muted" style={{ marginTop: -6 }}>{t.siteBasicHint}</p>
    <label>{t.siteName}</label><input value={f.name} onChange={(e) => set('name', e.target.value)} />
    <label>{t.siteBaseUrl}</label><input value={f.base_url} onChange={(e) => set('base_url', e.target.value)} placeholder="http://host:port/api/v1" />
    <small className="muted" style={{ display: 'block', marginTop: 6 }}>{t.siteBaseUrlHint}</small>
    <label>{t.siteAdminKey}{site ? ' (留空不改)' : ''}</label><input value={f.admin_key} onChange={(e) => set('admin_key', e.target.value)} placeholder="x-api-key" />
    <small className="muted" style={{ display: 'block', marginTop: 6 }}>{t.siteKeyHowto}</small>
    <div className="field-row" style={{ marginTop: 10 }}>
      <div><label>{t.siteAdminEmail}</label><input value={f.admin_login_email} onChange={(e) => set('admin_login_email', e.target.value)} placeholder="admin@sub2api.local" /></div>
      <div><label>{t.siteAdminPwd}{site ? ' (留空沿用已存)' : ''}</label><input type="password" value={f.admin_login_password} onChange={(e) => set('admin_login_password', e.target.value)} /></div>
    </div>
    <small className="muted" style={{ display: 'block', marginTop: 6 }}>{t.siteAdminLoginHint}{site && site.has_admin_login ? ` · ${t.siteAdminConfigured}` : ''}</small>
    <div className="field-row">
      <div><label>{t.siteKind}</label><select value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="local">{t.siteLocal}</option><option value="remote">{t.siteRemote}</option></select></div>
      <div><label>{t.sitePgContainer}</label><input value={f.pg_container} onChange={(e) => set('pg_container', e.target.value)} placeholder="sub2api-postgres" /></div>
    </div>
    {f.kind === 'remote' && <>
      <div className="notice" style={{ textAlign: 'left', marginTop: 14, fontSize: 13 }}>
        {t.siteChannelHint}
        {pubkey ? <><div style={{ marginTop: 10, fontWeight: 700 }}>{t.sitePubkeyTitle}</div>
          <div className="adm-pubkey-row">
            <code className="adm-pubkey-box">{pubkey}</code>
            <button type="button" className="btn btn-sm" onClick={copyPub}>{lang === 'zh' ? '复制' : 'Copy'}</button>
          </div>
          <div style={{ marginTop: 10, fontWeight: 700 }}>{t.siteSshCmdTitle}</div>
          <div className="adm-pubkey-row">
            <code className="adm-pubkey-box">{sshCmd}</code>
            <button type="button" className="btn btn-sm" onClick={copyCmd}>{lang === 'zh' ? '复制' : 'Copy'}</button>
          </div>
          <small className="muted" style={{ display: 'block', marginTop: 6 }}>{t.siteSshCmdHint}</small></> : <div className="adm-pubkey-missing">⚠ {t.pubkeyMissing}</div>}
      </div>
      <label>{t.siteSshHost}</label><input value={f.ssh_host} onChange={(e) => set('ssh_host', e.target.value)} placeholder="root@1.2.3.4 (非22端口: root@1.2.3.4:2222)" />
    </>}
  </Modal>
}

// ---------- 设置 ----------
export function SettingsPage({ lang, setLang, onLogout }: { lang: Lang; setLang: (l: Lang) => void; onLogout: () => void }) {
  const t = copy[lang]; const toast = useToast()
  const [oldPw, setOldPw] = useState(''); const [newPw, setNewPw] = useState(''); const [busy, setBusy] = useState(false)
  const changePw = async () => {
    setBusy(true)
    try { await api.changeAdminPassword(oldPw, newPw); toast(t.changePwOk); setOldPw(''); setNewPw('') }
    catch (e: any) { toast(String(e.message || e), 'err') } finally { setBusy(false) }
  }
  return <section className="panel settings-panel">
    <div className="settings-head"><div><h2>{t.settingsTitle}</h2><p className="muted">{t.theme}</p></div><button className="btn" onClick={onLogout}>{t.logout}</button></div>
    <div className="settings-grid">
      <div className="setting-card setting-card-wide"><div><span>{t.language}</span><strong>{lang === 'zh' ? '中文界面' : 'English UI'}</strong></div><div className="lang-switch segmented" role="group"><button className={lang === 'zh' ? 'active' : ''} onClick={() => setLang('zh')}>中文</button><button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button></div></div>
      <div className="setting-card setting-card-wide adm-pw-card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <span>{t.changePw}</span>
        <div className="field-row" style={{ marginTop: 8 }}>
          <input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} placeholder={t.changePwOld} />
          <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder={t.changePwNew} />
        </div>
        <div style={{ marginTop: 10 }}><button className="btn btn-primary btn-sm" onClick={changePw} disabled={busy || newPw.length < 6}>{busy ? <><Spinner /> {t.changePwApply}</> : t.changePwApply}</button></div>
      </div>
      <div className="setting-card adm-principle-card"><span>{t.sourceTruth}</span><strong style={{ fontSize: 16 }}>§10</strong><small>{t.sourceTruthDesc}</small></div>
      <div className="setting-card adm-principle-card adm-principle-danger"><span>{t.settingsNoModify}</span><strong style={{ fontSize: 16 }}>L1</strong><small>{t.settingsNoModifyDesc}</small></div>
    </div>
  </section>
}

// ---------- 登录 / 首次配置 ----------
export function Login({ lang, passwordSet, onLoggedIn }: { lang: Lang; passwordSet: boolean; onLoggedIn: () => void }) {
  const t = copy[lang]
  const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true); setErr('')
    try { await api.login(pw); onLoggedIn() }
    catch (e: any) { setErr(e?.status === 409 ? t.setupHint : t.loginErr) }
    finally { setBusy(false) }
  }
  if (!passwordSet) return <div className="login-shell adm-login-shell"><div className="login-card adm-login-card">
    <div className="brand-mark">S</div>
    <h1>{t.setupTitle}</h1><p style={{ marginBottom: 16 }}>{t.loginDesc}</p>
    <div className="adm-setup-note">{t.setupHint}</div>
  </div></div>
  return <div className="login-shell adm-login-shell"><div className="login-card adm-login-card">
    <div className="brand-mark">S</div>
    <h1>{t.loginTitle}</h1><p>{t.loginDesc}</p>
    {err && <div className="login-err adm-login-err">{err}</div>}
    <input type="password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder={t.password} />
    <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? <><Spinner /> {t.login}</> : t.login}</button>
  </div></div>
}
