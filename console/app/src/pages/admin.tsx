// 平台管理：用户管理 / 站点管理 / 设置 / 登录。
import { useCallback, useEffect, useState } from 'react'
import * as api from '../api'
import type { SiteInfo, UserRow } from '../api'
import { copy, Modal, SkeletonCards, SkeletonRows, Spinner, cls, useToast, type Lang } from '../lib'

// ---------- 用户管理 ----------
export function UsersPage({ siteInfo, lang }: { siteInfo: SiteInfo; lang: Lang }) {
  const site = siteInfo.id; const t = copy[lang]; const toast = useToast()
  const [rows, setRows] = useState<UserRow[]>([]); const [loading, setLoading] = useState(true); const [q, setQ] = useState('')
  const load = useCallback(() => { setLoading(true); api.getUsers(site).then(setRows).catch((e) => toast(String(e.message || e), 'err')).finally(() => setLoading(false)) }, [site, toast])
  useEffect(() => { load() }, [load])
  const setRole = async (u: UserRow, role: string) => { try { const r = await api.setUserRole({ site_id: site, user_id: u.id, role }); if (r.error) throw new Error(r.error); toast(`role → ${role} ✓`); load() } catch (e: any) { toast(String(e.message || e), 'err') } }
  const setStatus = async (u: UserRow, status: string) => { try { const r = await api.setUserStatus({ site_id: site, user_id: u.id, status }); if (r.error) throw new Error(r.error); toast(`status → ${status} ✓`); load() } catch (e: any) { toast(String(e.message || e), 'err') } }
  const filtered = rows.filter((u) => !q || (u.email || '').toLowerCase().includes(q.toLowerCase()) || String(u.id) === q)
  return <>
    <div className="toolbar"><input style={{ flex: '1 1 240px' }} placeholder={t.accountSearch} value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn" onClick={load} disabled={loading}>{loading ? <><Spinner /> {t.refresh}</> : t.refresh}</button>
      {!siteInfo.role_channel && <span className="kv">⚠ {t.roleChannelOff}</span>}</div>
    <div className="table-wrap"><table>
      <thead><tr><th>{t.colId}</th><th>{t.colEmail}</th><th>{t.colRole}</th><th>{t.colUserStatus}</th><th>{t.colBalance}</th><th>{t.colConcurrency}</th><th></th></tr></thead>
      <tbody>{loading && !filtered.length && <SkeletonRows cols={7} />}{filtered.map((u) => <tr key={u.id}>
        <td className="mono">{u.id}</td><td>{u.email || u.username || '-'}</td>
        <td><span className={cls('tag', u.role === 'admin' ? 'role-admin' : 'role-user')}>{u.role === 'admin' ? t.roleAdmin : t.roleUser}</span></td>
        <td><span className={cls('tag', u.status === 'disabled' ? 'disabled' : 'active')}>{u.status === 'disabled' ? t.statusDisabled : t.statusActive}</span></td>
        <td>{u.balance ?? '-'}</td><td>{u.concurrency ?? '-'}</td>
        <td><div className="row-actions">
          {siteInfo.role_channel && (u.role === 'admin' ? <button className="btn btn-sm" onClick={() => setRole(u, 'user')}>{t.setUser}</button> : <button className="btn btn-sm" onClick={() => setRole(u, 'admin')}>{t.setAdmin}</button>)}
          {u.status === 'disabled' ? <button className="btn btn-sm" onClick={() => setStatus(u, 'active')}>{t.enable}</button> : <button className="danger-pill" onClick={() => setStatus(u, 'disabled')}>{t.disable}</button>}
        </div></td>
      </tr>)}{!loading && !filtered.length && <tr><td colSpan={7} className="empty">{t.noData}</td></tr>}</tbody>
    </table></div>
  </>
}

// ---------- 站点管理 ----------
export function SitesPage({ lang, onSitesChanged }: { lang: Lang; onSitesChanged: () => void }) {
  const t = copy[lang]; const toast = useToast()
  const [sites, setSites] = useState<SiteInfo[]>([]); const [edit, setEdit] = useState<SiteInfo | null>(null); const [adding, setAdding] = useState(false); const [loading, setLoading] = useState(true)
  const load = useCallback(() => { setLoading(true); api.getSites().then(setSites).catch((e) => toast(String(e.message || e), 'err')).finally(() => setLoading(false)) }, [toast])
  useEffect(() => { load() }, [load])
  const check = async (s: SiteInfo) => { try { const r = await api.checkSite(s.id); toast(r.health === 'healthy' ? `${s.name}: ${t.siteProbeOk} ${r.latency_ms}ms` : `${s.name}: ${r.error || 'unhealthy'}`, r.health === 'healthy' ? 'ok' : 'err'); load() } catch (e: any) { toast(String(e.message || e), 'err') } }
  const del = async (s: SiteInfo) => { if (!confirm(t.deleteSiteConfirm)) return; try { await api.deleteSite(s.id); toast(`${s.name} ${t.delete} ✓`); load(); onSitesChanged() } catch (e: any) { toast(String(e.message || e), 'err') } }
  return <>
    <div className="toolbar"><div className="bulk-spacer" /><button className="btn btn-primary" onClick={() => setAdding(true)}>{t.addSite}</button></div>
    {loading && !sites.length ? <SkeletonCards n={3} /> : <div className="site-grid">{sites.map((s) => <div className="site-card" key={s.id}>
      <h3><span className={cls('site-dot', s.health)} style={{ display: 'inline-block', marginRight: 8 }} />{s.name}</h3>
      <div className="sub">{s.base_url}</div>
      <div className="kvs" style={{ margin: '12px 0' }}>
        <span className="kv">{s.kind === 'local' ? t.siteLocal : t.siteRemote}</span>
        {s.observability && <span className="kv">obs ✓</span>}
        <span className="kv">{t.siteHealth}: <b>{s.health}</b>{s.last_latency_ms ? ` ${s.last_latency_ms}ms` : ''}</span>
        <span className="kv">role: <b>{s.role_channel ? '✓' : '—'}</b></span>
      </div>
      <div className="card-actions"><button className="btn btn-sm" onClick={() => check(s)}>{t.siteCheck}</button><button className="btn btn-sm" onClick={() => setEdit(s)}>{t.edit}</button><button className="danger-pill" onClick={() => del(s)}>{t.delete}</button></div>
    </div>)}{!sites.length && <div className="notice"><b>{t.firstSiteTitle}</b><div style={{ marginTop: 6 }}>{t.firstSiteCta}</div><button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>{t.addFirstSite}</button></div>}</div>}
    {(adding || edit) && <SiteModal lang={lang} site={edit} onClose={() => { setAdding(false); setEdit(null) }} onDone={() => { setAdding(false); setEdit(null); load(); onSitesChanged() }} />}
  </>
}

function SiteModal({ lang, site, onClose, onDone }: { lang: Lang; site: SiteInfo | null; onClose: () => void; onDone: () => void }) {
  const t = copy[lang]; const toast = useToast()
  const [f, setF] = useState<any>(site ? { name: site.name, base_url: site.base_url, kind: site.kind, pg_container: site.pg_container, ssh_host: site.ssh_host, admin_key: '' } : { name: '', base_url: '', kind: 'remote', pg_container: 'sub2api-postgres', ssh_host: '', admin_key: '' })
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
  return <Modal title={site ? t.editSiteTitle : t.addSiteTitle} onClose={onClose} actions={<><button className="btn" onClick={onClose}>{t.cancel}</button><button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? <><Spinner /> {t.save}</> : t.save}</button></>}>
    <p className="muted" style={{ marginTop: -6 }}>{t.siteBasicHint}</p>
    <label>{t.siteName}</label><input value={f.name} onChange={(e) => set('name', e.target.value)} />
    <label>{t.siteBaseUrl}</label><input value={f.base_url} onChange={(e) => set('base_url', e.target.value)} placeholder="http://host:port/api/v1" />
    <small className="muted" style={{ display: 'block', marginTop: 6 }}>{t.siteBaseUrlHint}</small>
    <label>{t.siteAdminKey}{site ? ' (留空不改)' : ''}</label><input value={f.admin_key} onChange={(e) => set('admin_key', e.target.value)} placeholder="x-api-key" />
    <small className="muted" style={{ display: 'block', marginTop: 6 }}>{t.siteKeyHowto}</small>
    <div className="field-row">
      <div><label>{t.siteKind}</label><select value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="local">{t.siteLocal}</option><option value="remote">{t.siteRemote}</option></select></div>
      <div><label>{t.sitePgContainer}</label><input value={f.pg_container} onChange={(e) => set('pg_container', e.target.value)} placeholder="sub2api-postgres" /></div>
    </div>
    {f.kind === 'remote' && <>
      <div className="notice" style={{ textAlign: 'left', marginTop: 14, fontSize: 13 }}>
        {t.siteChannelHint}
        {pubkey ? <><div style={{ marginTop: 10, fontWeight: 700 }}>{t.sitePubkeyTitle}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 6 }}>
            <code style={{ flex: 1, fontSize: 11, wordBreak: 'break-all', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>{pubkey}</code>
            <button type="button" className="btn btn-sm" onClick={copyPub}>{lang === 'zh' ? '复制' : 'Copy'}</button>
          </div></> : <div style={{ marginTop: 10, color: 'var(--danger)', fontWeight: 600 }}>⚠ {t.pubkeyMissing}</div>}
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
      <div className="setting-card setting-card-wide" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <span>{t.changePw}</span>
        <div className="field-row" style={{ marginTop: 8 }}>
          <input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} placeholder={t.changePwOld} />
          <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder={t.changePwNew} />
        </div>
        <div style={{ marginTop: 10 }}><button className="btn btn-primary btn-sm" onClick={changePw} disabled={busy || newPw.length < 6}>{busy ? <><Spinner /> {t.changePwApply}</> : t.changePwApply}</button></div>
      </div>
      <div className="setting-card"><span>{t.sourceTruth}</span><strong style={{ fontSize: 16 }}>§10</strong><small>{t.sourceTruthDesc}</small></div>
      <div className="setting-card"><span>{t.settingsNoModify}</span><strong style={{ fontSize: 16 }}>L1</strong><small>{t.settingsNoModifyDesc}</small></div>
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
  if (!passwordSet) return <div className="login-shell"><div className="login-card">
    <div className="brand-mark">S</div>
    <h1>{t.setupTitle}</h1><p>{t.setupHint}</p>
  </div></div>
  return <div className="login-shell"><div className="login-card">
    <div className="brand-mark">S</div>
    <h1>{t.loginTitle}</h1><p>{t.loginDesc}</p>
    {err && <div className="login-err">{err}</div>}
    <input type="password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder={t.password} />
    <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? <><Spinner /> {t.login}</> : t.login}</button>
  </div></div>
}
