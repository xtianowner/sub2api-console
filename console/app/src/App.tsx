import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { getSession, logout as apiLogout, type SiteInfo } from './api'
import { copy, cls, ToastProvider, type Lang } from './lib'
import { Observability, type ObsPage } from './pages/observability'
import { AccountsPage, BatchesPage, PoolOverviewPage, RecyclePage } from './pages/pool'
import { Login, SettingsPage, SitesPage, UsersPage } from './pages/admin'

type PageKey = ObsPage | 'pool' | 'accounts' | 'batches' | 'recycle' | 'users' | 'sites' | 'settings'

function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('console-lang') as Lang) || 'zh')
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [pwSet, setPwSet] = useState(true)
  const [sites, setSites] = useState<SiteInfo[]>([])
  const [siteId, setSiteId] = useState<number>(() => Number(localStorage.getItem('console-site') || 0))
  const [page, setPage] = useState<PageKey>('overview')
  const t = copy[lang]

  async function loadSession() {
    try {
      const s = await getSession()
      setAuthed(s.authed)
      setPwSet(s.password_set)
      if (s.authed) {
        setSites(s.sites)
        if (!s.sites.length) setPage('sites') // 零站点：引导去站点管理添加第一个
        // 默认选中本机观测站点（用户偏好的观测面板），否则第一个
        else if (!s.sites.some((x) => x.id === siteId)) setSiteId((s.sites.find((x) => x.observability) || s.sites[0]).id)
      }
    } catch { setAuthed(false) }
  }
  useEffect(() => { loadSession() }, [])
  useEffect(() => { localStorage.setItem('console-lang', lang); document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en' }, [lang])
  useEffect(() => { if (siteId) localStorage.setItem('console-site', String(siteId)) }, [siteId])

  const site = useMemo(() => sites.find((s) => s.id === siteId) || sites[0], [sites, siteId])
  async function reloadSites() { try { const s = await getSession(); setSites(s.sites) } catch { /* ignore */ } }
  async function doLogout() { await apiLogout().catch(() => {}); setAuthed(false) }

  if (authed === null) return <div className="login-shell"><div className="muted">{t.loading}</div></div>
  if (!authed) return <ToastProvider><Login lang={lang} passwordSet={pwSet} onLoggedIn={loadSession} /></ToastProvider>

  const obsItems: Array<{ key: ObsPage; label: string }> = [
    { key: 'overview', label: t.nav_overview }, { key: 'feedback', label: t.nav_feedback },
    { key: 'errors', label: t.nav_errors }, { key: 'slow', label: t.nav_slow }, { key: 'timeline', label: t.nav_timeline },
  ]
  const poolItems: Array<{ key: PageKey; label: string }> = [
    { key: 'pool', label: t.nav_pool }, { key: 'accounts', label: t.nav_accounts },
    { key: 'batches', label: t.nav_batches }, { key: 'recycle', label: t.nav_recycle },
  ]
  const adminItems: Array<{ key: PageKey; label: string }> = [
    { key: 'users', label: t.nav_users }, { key: 'sites', label: t.nav_sites }, { key: 'settings', label: t.nav_settings },
  ]
  const labelOf = (k: PageKey): string =>
    [...obsItems, ...poolItems, ...adminItems].find((i) => i.key === k)?.label || ''

  const showObs = !!site?.observability
  const needSite = (['pool', 'accounts', 'batches', 'recycle', 'users'] as PageKey[]).includes(page)

  return (
    <ToastProvider>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand"><div className="brand-mark">S</div><div><b>{t.brand}</b><span>{t.brandSub}</span></div></div>
          <div className="topbar-actions">
            {sites.length > 0 && <span className="site-switch"><span className={cls('site-dot', site?.health)} /><select value={siteId} onChange={(e) => setSiteId(Number(e.target.value))} style={{ border: 0, background: 'transparent', padding: '2px 4px' }}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></span>}
            <div className="lang-switch segmented" role="group"><button className={lang === 'zh' ? 'active' : ''} onClick={() => setLang('zh')}>中</button><button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button></div>
            <button className="icon-btn" onClick={doLogout}>{t.logout}</button>
          </div>
        </header>

        <div className="layout">
          <aside className="sidebar">
            {showObs && <><div className="sidebar-group">{t.navObs}</div>{obsItems.map((i) => <button key={i.key} className={page === i.key ? 'active' : ''} onClick={() => setPage(i.key)}>{i.label}</button>)}</>}
            <div className="sidebar-group">{t.navPool}</div>{poolItems.map((i) => <button key={i.key} className={page === i.key ? 'active' : ''} onClick={() => setPage(i.key)}>{i.label}</button>)}
            <div className="sidebar-group">{t.navAdmin}</div>{adminItems.map((i) => <button key={i.key} className={page === i.key ? 'active' : ''} onClick={() => setPage(i.key)}>{i.label}</button>)}
            <div className="sidebar-note"><b>{t.settingsNoModify}</b><p>{t.sourceTruthDesc}</p></div>
          </aside>

          <main className="main">
            <section className="page-title"><div><h1>{labelOf(page)}</h1><p>{site ? `${t.site}: ${site.name}` : ''}</p></div></section>

            <div className="fade-rise" key={`${page}:${siteId}`}>
            {needSite && !site ? <div className="notice">{t.noData} — {t.addSite}</div> : <>
              {(['overview', 'feedback', 'errors', 'slow', 'timeline'] as PageKey[]).includes(page) && (showObs && site
                ? <Observability page={page as ObsPage} lang={lang} site={site.id} />
                : <div className="notice">{t.obsUnavailable}</div>)}
              {page === 'pool' && site && <PoolOverviewPage site={site.id} lang={lang} />}
              {page === 'accounts' && site && <AccountsPage siteInfo={site} lang={lang} />}
              {page === 'batches' && site && <BatchesPage site={site.id} lang={lang} />}
              {page === 'recycle' && site && <RecyclePage site={site.id} lang={lang} />}
              {page === 'users' && site && <UsersPage siteInfo={site} lang={lang} />}
              {page === 'sites' && <SitesPage lang={lang} onSitesChanged={reloadSites} />}
              {page === 'settings' && <SettingsPage lang={lang} setLang={setLang} onLogout={doLogout} />}
            </>}
            </div>
          </main>
        </div>
      </div>
    </ToastProvider>
  )
}

export default App
