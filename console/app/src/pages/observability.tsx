// 观测页：总览 / 反馈核对 / 错误日志 / 慢请求 / 请求趋势。移植自原 Observer App.tsx。仅本机站点可用。
import { useEffect, useMemo, useRef, useState } from 'react'
import { getAttention, getRequests, getSummary, type AttentionRow, type RequestRow, type SummaryResponse } from '../api'
import { copy, formatInt, formatMs, formatPercent, formatTime, MetricCard, ownerColor, ownerLabel, SkeletonCards, SkeletonRows, Spinner, type Lang } from '../lib'

export type ObsPage = 'overview' | 'feedback' | 'errors' | 'slow' | 'timeline'
const windows = ['5m', '15m', '1h', '24h']

function OwnerBadge({ owner, lang }: { owner: string; lang: Lang }) {
  return <span className={`badge ${owner}`}>{ownerLabel(owner, lang)}</span>
}

function RequestsTable({ rows, lang, emptyText, loading }: { rows: RequestRow[]; lang: Lang; emptyText: string; loading?: boolean }) {
  const t = copy[lang]
  return (
    <div className="table-wrap"><table><thead><tr><th>{t.colTime}</th><th>{t.colRequest}</th><th>{t.colUserKey}</th><th>{t.colModel}</th><th>{t.colResult}</th><th>{t.colOwner}</th><th>{t.colLatency}</th><th>{t.colSummary}</th></tr></thead><tbody>
      {loading && !rows.length && <SkeletonRows cols={8} />}
      {rows.map((row, i) => <tr key={`${row.kind}-${row.request_id}-${i}`}>
        <td>{formatTime(row.created_at, lang)}</td>
        <td className="mono"><span className="trunc trunc-id" title={row.request_id || row.client_request_id || ''}>{row.request_id || row.client_request_id || '-'}</span></td>
        <td><span className="trunc trunc-user" title={`${row.user_label} / ${row.key_label}`}>{row.user_label} / {row.key_label}</span></td>
        <td>{row.model}</td>
        <td>{row.kind === 'success' ? t.statusSuccess : `${t.statusError} ${row.status_code || ''}`}</td>
        <td><OwnerBadge owner={row.owner} lang={lang} /></td>
        <td>{formatMs(row.duration_ms)}</td>
        <td><span className="trunc trunc-msg" title={row.message || ''}>{row.message}</span></td>
      </tr>)}
      {!loading && !rows.length && <tr><td colSpan={8} className="empty">{emptyText}</td></tr>}
    </tbody></table></div>
  )
}

export function Observability({ page, lang, site }: { page: ObsPage; lang: Lang; site: number }) {
  const t = copy[lang]
  const [windowKey, setWindowKey] = useState('15m')
  const [query, setQuery] = useState('')
  const [model, setModel] = useState('all')
  const [status, setStatus] = useState('all')
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [attention, setAttention] = useState<AttentionRow[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  async function refresh() {
    setError(''); setLoading(true)
    try {
      const [s, r, a] = await Promise.all([getSummary(site, windowKey), getRequests(site, { window: windowKey, q: query, model, status }), getAttention(site)])
      setSummary(s); setRequests(r.rows); setAttention(a.rows)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
  }
  const ref = useRef(refresh); ref.current = refresh
  useEffect(() => { ref.current() }, [windowKey, model, status, page, site])
  useEffect(() => { const timer = window.setInterval(() => ref.current(), 30000); return () => window.clearInterval(timer) }, [])

  const metrics = useMemo(() => {
    const m = summary?.metrics
    const has = (m?.total || 0) > 0
    return [
      { label: t.total, value: formatInt(m?.total || 0), hint: t.allRecorded, tone: 'blue' },
      { label: t.success, value: formatInt(m?.success || 0), hint: t.successHint, tone: 'green' },
      { label: t.failed, value: formatInt(m?.failed || 0), hint: t.failedHint, tone: 'red' },
      { label: t.successRate, value: has ? formatPercent(m?.successRate ?? 100) : t.noData, hint: t.currentWindow, tone: has ? 'blue' : 'dim' },
      { label: t.p95, value: has ? formatMs(m?.p95DurationMs || 0) : t.noData, hint: `${t.firstToken} ${has ? formatMs(m?.avgFirstTokenMs || 0) : '—'}`, tone: has ? 'amber' : 'dim' },
    ]
  }, [summary, t])

  const slowRows = requests.filter((r) => r.duration_ms >= 30000 || r.first_token_ms >= 10000)
  const errorRows = requests.filter((r) => r.kind === 'error')

  function TrendPanel() {
    const trend = summary?.trend || []
    const max = trend.reduce((mx, p) => Math.max(mx, p.success + p.error), 0)
    return <section className="panel"><h2>{t.trend}</h2>{max > 0
      ? <div className="bars" role="img" aria-label={t.trend}>{trend.map((p, i) => { const total = p.success + p.error; return <div key={p.bucket || i} className={`bar ${p.error > p.success * 0.1 ? 'error' : ''}`} title={`${formatTime(p.bucket, lang)} ✓${p.success} ✗${p.error}`} style={{ height: `${total === 0 ? 0 : Math.max(4, Math.round((total / max) * 100))}%` }} /> })}</div>
      : <div className="chart-empty">{t.noData}</div>}</section>
  }
  function AttributionPanel() {
    const owners = summary?.owners || []
    const total = owners.reduce((s, r) => s + Number(r.count || 0), 0)
    let acc = 0
    const stops = owners.map((r) => { const a = (acc / total) * 100; acc += Number(r.count || 0); return `${ownerColor(r.owner)} ${a}% ${(acc / total) * 100}%` }).join(', ')
    const has = total > 0
    return <section className="panel"><h2>{t.attribution}</h2><div className="donut-wrap">
      <div className="donut" role="img" aria-label={t.attribution} style={{ background: has ? `conic-gradient(${stops})` : 'var(--border)' }}><span>{formatInt(summary?.metrics.failed || 0)}<br /><small>{t.errors}</small></span></div>
      <div className="legend">{owners.map((r) => <span key={r.owner}><i style={{ background: ownerColor(r.owner) }} />{ownerLabel(r.owner, lang)} {Math.round((Number(r.count) / total) * 100)}%</span>)}{!has && <span className="muted">{t.noData}</span>}</div>
    </div></section>
  }
  function FeedbackPanel({ title, rows }: { title: string; rows: RequestRow[] }) {
    return <section className="panel">
      <div className="panel-head"><div><h2>{title}</h2><p>{t.feedbackDesc}</p></div><button className="primary" onClick={() => ref.current()} disabled={loading}>{loading ? <><Spinner /> {t.search}</> : t.search}</button></div>
      <div className="filters">
        <input aria-label={t.requestPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ref.current()} placeholder={t.requestPlaceholder} />
        <select aria-label={t.allModels} value={model} onChange={(e) => setModel(e.target.value)}><option value="all">{t.allModels}</option>{(summary?.models || []).map((m) => <option key={m.model} value={m.model}>{m.model}</option>)}</select>
        <select aria-label={t.allStatus} value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">{t.allStatus}</option><option value="success">{t.statusSuccess}</option><option value="error">{t.statusError}</option></select>
      </div>
      <RequestsTable rows={rows} lang={lang} emptyText={t.noRecords} loading={loading} />
    </section>
  }
  function AttentionPanel() {
    return <aside className="panel"><h2>{t.attention}</h2><p className="muted">{t.attentionDesc}</p><div className="attention-list">
      {attention.map((it) => <div className="attention-card" key={`${it.owner}-${it.phase}-${it.type}-${it.model}`}><div><b>{it.label} · {it.model} · {it.count}</b><p>{it.phase} / {it.type}: {it.message}</p></div><OwnerBadge owner={it.owner} lang={lang} /></div>)}
      {!attention.length && <div className="attention-card"><div><b>{t.noHotErrors}</b><p>{t.noHotErrorsDesc}</p></div><OwnerBadge owner="normal" lang={lang} /></div>}
    </div></aside>
  }

  return <>
    <div className="page-title" style={{ marginBottom: 18 }}>
      <div />
      <div className="range-tabs">{windows.map((w) => <button key={w} className={windowKey === w ? 'active' : ''} onClick={() => setWindowKey(w)}>{w}</button>)}</div>
    </div>
    {error && <div className="error-banner">API Error: {error}</div>}
    {page === 'overview' && (!summary && loading ? <SkeletonCards n={5} /> : <section className="metrics-grid">{metrics.map((m) => <MetricCard key={m.label} {...m} />)}</section>)}
    {page === 'overview' && <div className="overview-stack">
      <FeedbackPanel title={t.nav_feedback} rows={requests} />
      <section className="content-grid"><section className="lower-grid"><TrendPanel /><AttributionPanel /></section><AttentionPanel /></section>
    </div>}
    {page === 'feedback' && <FeedbackPanel title={t.nav_feedback} rows={requests} />}
    {page === 'errors' && <FeedbackPanel title={t.nav_errors} rows={errorRows} />}
    {page === 'slow' && <FeedbackPanel title={t.nav_slow} rows={slowRows} />}
    {page === 'timeline' && <section className="lower-grid"><TrendPanel /><AttributionPanel /></section>}
  </>
}
