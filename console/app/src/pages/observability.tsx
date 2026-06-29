// 观测页：总览 / 反馈核对 / 错误日志 / 慢请求 / 请求趋势。移植自原 Observer App.tsx。仅本机站点可用。
import { useEffect, useMemo, useRef, useState } from 'react'
import { getAttention, getRequests, getSummary, type AttentionRow, type RequestRow, type SummaryResponse } from '../api'
import { copy, formatCost, formatInt, formatMs, formatPercent, formatTime, formatTokens, MetricCard, ownerColor, ownerLabel, SkeletonCards, SkeletonRows, Spinner, type Lang } from '../lib'
import './observability.css'

export type ObsPage = 'overview' | 'feedback' | 'errors' | 'slow' | 'timeline' | 'usage'
const windows = ['5m', '15m', '1h', '24h']
const PAGE_SIZE = 50
// datetime-local 值 'YYYY-MM-DDTHH:mm' → 服务端格式 'YYYY-MM-DD HH:mm'（仅换 'T' 为空格）。
function toServerTs(v: string): string { return v ? v.replace('T', ' ') : '' }

function OwnerBadge({ owner, lang }: { owner: string; lang: Lang }) {
  return <span className={`badge ${owner}`}>{ownerLabel(owner, lang)}</span>
}

// 单行：点击整行展开「详情」子行。详情里**不展示请求ID**（按要求），只完整、可选中地展示
// 用户/Key、模型、结果、归因、延迟(含首字)、token、全文摘要——长字段在此完整可读，解决截断。
// 请求ID仍可在搜索框按 request_id 命中（只是不在界面上显示）。
function RequestRowItem({ row, lang }: { row: RequestRow; lang: Lang }) {
  const t = copy[lang]
  const [open, setOpen] = useState(false)
  const result = row.kind === 'success' ? t.statusSuccess : `${t.statusError} ${row.status_code || ''}`
  const tokenCell = row.kind === 'success' && (row.input_tokens || row.output_tokens)
    ? <span title={`cache ${formatInt(row.cache_tokens || 0)} · ${formatCost(row.cost || 0)}`}>↑{formatTokens(row.input_tokens)} ↓{formatTokens(row.output_tokens)}</span>
    : '-'
  return <>
    <tr className={open ? 'req-row req-row-open' : 'req-row'} onClick={() => setOpen((o) => !o)}>
      <td><span className="req-caret" aria-hidden>{open ? '▾' : '▸'}</span>{formatTime(row.created_at, lang)}</td>
      <td><span className="trunc trunc-user" title={`${row.user_label} / ${row.key_label}`}>{row.user_label} / {row.key_label}</span></td>
      <td>{row.model}</td>
      <td><span className="trunc trunc-user" title={row.upstream_account || ''}>{row.upstream_account || '-'}</span></td>
      <td>{result}</td>
      <td><OwnerBadge owner={row.owner} lang={lang} /></td>
      <td>{formatMs(row.duration_ms)}{row.first_token_ms ? <span className="req-ftm"> · {t.firstToken} {formatMs(row.first_token_ms)}</span> : null}</td>
      <td className="mono">{tokenCell}</td>
      <td><span className="trunc trunc-msg" title={row.message || ''}>{row.message}</span></td>
    </tr>
    {open && <tr className="req-detail-row"><td colSpan={9}>
      <div className="req-detail">
        <dl className="req-detail-grid">
          <div><dt>{t.colUserKey}</dt><dd className="sel">{row.user_label} / {row.key_label}</dd></div>
          <div><dt>{t.colUpstream}</dt><dd className="sel">{row.upstream_account || '-'}</dd></div>
          <div><dt>{t.colModel}</dt><dd className="sel">{row.model}</dd></div>
          <div><dt>{t.colResult}</dt><dd>{result}</dd></div>
          <div><dt>{t.colOwner}</dt><dd>{ownerLabel(row.owner, lang)} / {row.phase || '-'}</dd></div>
          <div><dt>{t.colLatency}</dt><dd>{formatMs(row.duration_ms)} · {t.firstToken} {formatMs(row.first_token_ms)}</dd></div>
          <div><dt>{t.colTokens}</dt><dd>{row.kind === 'success' ? `↑${formatInt(row.input_tokens)} ↓${formatInt(row.output_tokens)} · cache ${formatInt(row.cache_tokens || 0)} · ${formatCost(row.cost || 0)}` : '-'}</dd></div>
        </dl>
        <div className="req-detail-msg"><dt>{t.colSummary}</dt><div className="req-detail-msg-body sel">{row.message || '-'}</div></div>
      </div>
    </td></tr>}
  </>
}

function RequestsTable({ rows, lang, emptyText, loading }: { rows: RequestRow[]; lang: Lang; emptyText: string; loading?: boolean }) {
  const t = copy[lang]
  return (
    <div className="table-wrap"><table><thead><tr><th>{t.colTime}</th><th>{t.colUserKey}</th><th>{t.colModel}</th><th>{t.colUpstream}</th><th>{t.colResult}</th><th>{t.colOwner}</th><th>{t.colLatency}</th><th>{t.colTokens}</th><th>{t.colSummary}</th></tr></thead><tbody>
      {loading && !rows.length && <SkeletonRows cols={9} />}
      {rows.map((row, i) => <RequestRowItem key={`${row.kind}-${row.request_id || row.client_request_id}-${i}`} row={row} lang={lang} />)}
      {!loading && !rows.length && <tr><td colSpan={9} className="empty">{emptyText}</td></tr>}
    </tbody></table></div>
  )
}

export function Observability({ page, lang, site }: { page: ObsPage; lang: Lang; site: number }) {
  const t = copy[lang]
  const [windowKey, setWindowKey] = useState('15m')
  // custom 时间窗：start/end 为正在编辑的草稿（datetime-local 值），applied* 才是实际用于取数的已应用值。
  // 打字不触发取数，点「应用」才把草稿提交为 applied（custom 历史范围是静态的）。
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [appliedStart, setAppliedStart] = useState('')
  const [appliedEnd, setAppliedEnd] = useState('')
  const [rangeErr, setRangeErr] = useState('')   // custom 起止非法时的内联提示
  const [query, setQuery] = useState('')
  const [model, setModel] = useState('all')
  const [status, setStatus] = useState('all')
  const [page_, setPage] = useState(1)   // 当前页（从 1 起）
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [total, setTotal] = useState(0)   // 过滤后服务端真实总数（用于翻页器「共 M 条」/页数）
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const [attention, setAttention] = useState<AttentionRow[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)   // 后台静默刷新中(不清屏)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const inFlight = useRef(false)
  const isCustom = windowKey === 'custom'
  // 实际下发给服务端的时间窗参数：custom 用 applied 起止，快捷窗只带 window。
  const rangeParams = isCustom
    ? { window: 'custom', start: toServerTs(appliedStart), end: toServerTs(appliedEnd) }
    : { window: windowKey }

  // background=true：后台静默刷新——不进 loading、不清空已有数据、失败不弹错保留旧数据，仅成功时整体换新。
  // 解决"已拿到数据后，自动刷新把请求表打回骨架屏/loading，用户看不到数据"。前台(首次/切窗口/手动)才走 loading。
  async function refresh(background = false) {
    if (background && inFlight.current) return
    // custom 但起止尚未应用（任一为空）：不取数，避免落到回退窗造成误导。
    if (isCustom && (!appliedStart || !appliedEnd)) { if (!background) setLoading(false); return }
    inFlight.current = true
    if (background) setRefreshing(true); else { setError(''); setLoading(true) }
    try {
      const [s, r, a] = await Promise.all([
        getSummary(site, rangeParams),
        getRequests(site, { ...rangeParams, q: query, model, status, slow: page === 'slow', page: page_, pageSize }),
        getAttention(site, rangeParams),
      ])
      setSummary(s); setRequests(r.rows); setTotal(r.total ?? r.rows.length)
      if (r.pageSize) setPageSize(r.pageSize)   // 服务端回填真实 pageSize（默认 50 / 钳制）
      // 越界回收：若当前页超出新总页数（如静默刷新后数据变少），回退到最后一页。
      const lastPage = Math.max(1, Math.ceil((r.total ?? r.rows.length) / Math.max(1, r.pageSize || pageSize)))
      if (page_ > lastPage) setPage(lastPage)
      setAttention(a.rows); setLastUpdated(Date.now()); setError('')
    } catch (e) {
      if (!background) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (background) setRefreshing(false); else setLoading(false)
      inFlight.current = false
    }
  }
  const ref = useRef(refresh); ref.current = refresh
  // 取数副作用统一在此：先把「非翻页类」变更（窗口/范围/筛选/站点/页型）归一到第 1 页，再取数。
  // 用 prevKey 区分「翻页」与「筛选变更」：筛选变更时若当前不在第 1 页，则只 setPage(1)（其引发的
  // page_ 变化会再次进入本 effect 并取数），避免先用越界旧页取一次再取一次的双发与闪烁。
  const prevKey = useRef('')
  useEffect(() => {
    const key = JSON.stringify([windowKey, appliedStart, appliedEnd, model, status, page, site])
    const filtersChanged = prevKey.current !== key
    prevKey.current = key
    if (filtersChanged && page_ !== 1) { setPage(1); return }   // 归一到第 1 页，下一轮再取
    ref.current(false)
  }, [windowKey, appliedStart, appliedEnd, model, status, page, site, page_])
  // 30s 轮询，仅标签页可见时打且走「后台静默刷新」；隐藏暂停（不空转拖慢前台），重新可见补一次。
  // custom 历史范围是静态的 → 跳过自动轮询（仍可手动「搜索」刷新）。
  useEffect(() => {
    if (isCustom) return
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') ref.current(true) }, 30000)
    const onVis = () => { if (document.visibilityState === 'visible') ref.current(true) }
    document.addEventListener('visibilitychange', onVis)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVis) }
  }, [isCustom])

  // 提交搜索（Search 按钮 / 输入框回车）：回到第 1 页后取数。query 不在 effect 依赖里（打字不实时取数），
  // 故这里显式驱动：若已在第 1 页则直接取数；否则 setPage(1) 由 effect 取数（避免用旧页取一次再取一次）。
  function submitSearch() {
    if (page_ === 1) ref.current()
    else setPage(1)
  }
  // 「应用」custom 起止：校验 start<end，合法则提交为 applied（触发取数），否则内联报错且不取数。
  function applyRange() {
    if (!start || !end || start >= end) { setRangeErr(t.obsRangeInvalid); return }
    setRangeErr(''); setPage(1); setAppliedStart(start); setAppliedEnd(end)
  }
  // 翻页器：共 pages 页，首页禁「上一页」、末页禁「下一页」。换页保留筛选/范围。
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  function Pager() {
    if (total <= pageSize && page_ <= 1) return null
    return <div className="obs-pager">
      <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page_ <= 1 || loading}>{t.pagePrev}</button>
      <span className="muted">{t.pageInfo.replace('{page}', String(page_)).replace('{pages}', String(pages)).replace('{total}', formatInt(total))}</span>
      <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page_ >= pages || loading}>{t.pageNext}</button>
    </div>
  }

  const metrics = useMemo(() => {
    const m = summary?.metrics
    const has = (m?.total || 0) > 0
    return [
      { label: t.total, value: formatInt(m?.total || 0), hint: t.allRecorded, tone: 'blue' },
      { label: t.success, value: formatInt(m?.success || 0), hint: t.successHint, tone: 'green' },
      { label: t.failed, value: formatInt(m?.failed || 0), hint: t.failedHint, tone: 'red' },
      { label: t.successRate, value: has ? formatPercent(m?.successRate ?? 100) : t.noData, hint: t.currentWindow, tone: has ? 'blue' : 'dim' },
      { label: t.p95, value: has ? formatMs(m?.p95DurationMs || 0) : t.noData, hint: `${t.firstToken} ${has ? formatMs(m?.avgFirstTokenMs || 0) : '—'}`, tone: has ? 'amber' : 'dim' },
      { label: t.tokens, value: formatTokens(m?.totalTokens || 0), hint: t.tokensHint.replace('{in}', formatTokens(m?.inputTokens || 0)).replace('{out}', formatTokens(m?.outputTokens || 0)), tone: 'blue' },
      { label: t.cost, value: formatCost(m?.totalCost || 0), hint: t.allRecorded, tone: 'green' },
    ]
  }, [summary, t])

  // 慢请求改为服务端过滤（slow=page==='slow'，按耗时倒序返回），这里直接用 requests，与「慢请求」统计口径一致。
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
  function FeedbackPanel({ title, rows, total }: { title: string; rows: RequestRow[]; total?: number }) {
    return <section className="panel">
      <div className="panel-head"><div><h2>{title}</h2><p>{t.feedbackDesc}</p></div>
        <span className="muted" style={{ marginLeft: 'auto', marginRight: 12, fontSize: 12 }}>{total != null ? t.showing.replace('{n}', formatInt(rows.length)).replace('{total}', formatInt(total)) : ''}</span>
        <button className="primary" onClick={submitSearch} disabled={loading}>{loading ? <><Spinner /> {t.search}</> : t.search}</button></div>
      <div className="filters">
        <input aria-label={t.requestPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitSearch()} placeholder={t.requestPlaceholder} />
        <select aria-label={t.allModels} value={model} onChange={(e) => setModel(e.target.value)}><option value="all">{t.allModels}</option>{(summary?.models || []).map((m) => <option key={m.model} value={m.model}>{m.model}</option>)}</select>
        <select aria-label={t.allStatus} value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">{t.allStatus}</option><option value="success">{t.statusSuccess}</option><option value="error">{t.statusError}</option></select>
      </div>
      <RequestsTable rows={rows} lang={lang} emptyText={t.noRecords} loading={loading} />
      <Pager />
    </section>
  }
  function AttentionPanel() {
    return <aside className="panel"><h2>{t.attention}</h2><p className="muted">{t.attentionDesc}</p><div className="attention-list">
      {attention.map((it) => <div className="attention-card" key={`${it.owner}-${it.phase}-${it.type}-${it.model}`}><div><b>{it.label} · {it.model} · {it.count}</b><p>{it.phase} / {it.type}: {it.message}</p></div><OwnerBadge owner={it.owner} lang={lang} /></div>)}
      {!attention.length && <div className="attention-card"><div><b>{t.noHotErrors}</b><p>{t.noHotErrorsDesc}</p></div><OwnerBadge owner="normal" lang={lang} /></div>}
    </div></aside>
  }

  return <div className="obs-page">
    <div className="page-title obs-toolbar" style={{ marginBottom: 18 }}>
      <span className="obs-range-label">{t.currentWindow}</span>
      <div className="range-tabs">
        {windows.map((w) => <button key={w} className={windowKey === w ? 'active' : ''} onClick={() => setWindowKey(w)}>{w}</button>)}
        <button className={isCustom ? 'active' : ''} onClick={() => setWindowKey('custom')}>{t.obsRangeCustom}</button>
      </div>
      {isCustom && <div className="obs-custom-range" title={t.obsRangeHint}>
        <label>{t.obsRangeStart}<input type="datetime-local" value={start} onChange={(e) => { setStart(e.target.value); setRangeErr('') }} aria-label={t.obsRangeStart} /></label>
        <label>{t.obsRangeEnd}<input type="datetime-local" value={end} onChange={(e) => { setEnd(e.target.value); setRangeErr('') }} aria-label={t.obsRangeEnd} /></label>
        <button className="primary" onClick={applyRange}>{t.apply}</button>
        {rangeErr ? <span className="obs-range-warn">{rangeErr}</span> : <span className="muted obs-range-hint">{t.obsRangeHint}</span>}
      </div>}
      <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{refreshing ? t.obsRefreshing : (lastUpdated ? `${t.obsUpdated} ${new Date(lastUpdated).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', { hour12: false })}` : '')}</span>
    </div>
    {error && <div className="error-banner">API Error: {error}</div>}
    {page === 'overview' && (!summary && loading ? <SkeletonCards n={5} /> : <section className="metrics-grid">{metrics.map((m) => <MetricCard key={m.label} {...m} />)}</section>)}
    {page === 'overview' && <div className="overview-stack">
      <FeedbackPanel title={t.nav_feedback} rows={requests} total={total} />
      <section className="content-grid"><section className="lower-grid"><TrendPanel /><AttributionPanel /></section><AttentionPanel /></section>
    </div>}
    {page === 'feedback' && <FeedbackPanel title={t.nav_feedback} rows={requests} total={total} />}
    {page === 'errors' && <FeedbackPanel title={t.nav_errors} rows={errorRows} />}
    {page === 'slow' && <FeedbackPanel title={t.nav_slow} rows={requests} total={total} />}
    {page === 'timeline' && <section className="lower-grid"><TrendPanel /><AttributionPanel /></section>}
  </div>
}
