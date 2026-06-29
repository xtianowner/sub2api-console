// 用户用量报告：按邮箱+时间段拉取某用户的消费与缓存构成，用于回应「额度去哪了/平台坑我吗」。
// 通用面板/卡片/donut/bars/表格复用 observability.css（根带 obs-page 类）；ur- 专属样式在 usageReport.css。
import { useEffect, useRef, useState } from 'react'
import { getUsageReport, type BreakdownKey, type UsageReportResponse, type UsageUser } from '../api'
import { copy, formatCost, formatInt, formatPercent, formatTokens, MetricCard, SkeletonCards, Spinner, useToast, type Lang } from '../lib'
import './observability.css'
import './usageReport.css'

const RANGES: Array<{ key: string; k: keyof typeof copy['zh'] }> = [
  { key: 'today', k: 'ur_rangeToday' }, { key: '7d', k: 'ur_range7d' }, { key: '30d', k: 'ur_range30d' },
  { key: 'month', k: 'ur_rangeMonth' }, { key: 'custom', k: 'ur_rangeCustom' },
]
// 四项成本/Token 配色：input 蓝 / output 绿 / cache_creation 紫 / cache_read 琥珀(醒目=质疑焦点)
const SEG_COLOR: Record<BreakdownKey, string> = { input: '#2563eb', output: '#059669', cache_creation: '#8b5cf6', cache_read: '#f59e0b' }
const SEG_LABEL: Record<BreakdownKey, keyof typeof copy['zh']> = { input: 'ur_costInput', output: 'ur_costOutput', cache_creation: 'ur_costCacheCreation', cache_read: 'ur_costCacheRead' }
const ratioStr = (x: number) => (x ? `${x.toFixed(1)}×` : '—')

export function UsageReport({ site, lang }: { site: number; lang: Lang }) {
  const t = copy[lang]
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [range, setRange] = useState('7d')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [data, setData] = useState<UsageReportResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const lastId = useRef<{ q?: string; uid?: number } | null>(null)

  async function run(id: { q?: string; uid?: number }) {
    if (!id.q && id.uid == null) return
    lastId.current = id
    setLoading(true); setError('')
    try {
      const d = await getUsageReport(site, { ...id, range, start: range === 'custom' ? start : undefined, end: range === 'custom' ? end : undefined })
      setData(d)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }
  const runRef = useRef(run); runRef.current = run
  function doLookup() { const q = email.trim(); if (q) run({ q }) }
  function applyCustom() { run(lastId.current ?? { q: email.trim() }) }
  function pickCandidate(u: UsageUser) { setEmail(u.email); run({ uid: u.user_id }) }

  // 切时间段(非自定义)：用同一身份重查，保持连续；自定义需点「应用」。切站点：清空。
  useEffect(() => { if (range !== 'custom' && lastId.current) runRef.current(lastId.current) }, [range])
  useEffect(() => { lastId.current = null; setData(null); setError(''); setEmail('') }, [site])

  const m = data?.metrics
  const u = data?.user
  const hasUsage = !!m && m.successRequests > 0

  // 一句话结论文本（可复制）
  function verdictText(): string {
    if (!u || !m) return ''
    let s = t.ur_verdictTpl
      .replace('{email}', u.email).replace('{start}', data!.period.start).replace('{end}', data!.period.end)
      .replace('{n}', formatInt(m.successRequests)).replace('{total}', formatCost(m.totalCost))
      .replace('{cacheReadCost}', formatCost(m.cacheReadCost)).replace('{pct}', formatPercent(m.cacheReadCostShare * 100))
      .replace('{cacheReadTokens}', formatTokens(m.cacheReadTokens)).replace('{ratio}', ratioStr(m.cacheReadMultiple))
    if (m.failedRequests > 0) s += ' ' + t.ur_failedHint.replace('{n}', formatInt(m.failedRequests))
    return s
  }
  async function copyVerdict() {
    try { await navigator.clipboard.writeText(verdictText()); toast(t.ur_copied, 'ok') } catch { /* ignore */ }
  }

  const metricCards = m ? [
    { label: t.ur_totalCost, value: formatCost(m.totalCost), hint: `${data!.period.start} ~ ${data!.period.end}`, tone: 'blue' },
    { label: t.ur_cacheReadCostShare, value: formatPercent(m.cacheReadCostShare * 100), hint: t.ur_cacheReadHint.replace('{v}', formatCost(m.cacheReadCost)), tone: 'amber' },
    { label: t.ur_totalTokens, value: formatTokens(m.totalTokens), hint: t.ur_cacheReadHint.replace('{v}', formatTokens(m.cacheReadTokens)), tone: 'blue' },
    { label: t.ur_cacheReadMultiple, value: ratioStr(m.cacheReadMultiple), hint: `${t.ur_cacheHitRate} ${formatPercent(m.cacheHitRate * 100)}`, tone: 'amber' },
    { label: t.ur_successRequests, value: formatInt(m.successRequests), hint: t.ur_failedHint.replace('{n}', formatInt(m.failedRequests)), tone: 'dim' },
    { label: t.ur_avgCostPerReq, value: formatCost(m.avgCostPerReq), hint: `${formatInt(m.successRequests)} ·`, tone: 'green' },
    { label: t.ur_reconcileDiff, value: formatCost(m.reconcileDiff), hint: Math.abs(m.reconcileDiff) < 0.005 ? t.ur_reconcileOk : t.ur_reconcileBad, tone: Math.abs(m.reconcileDiff) < 0.005 ? 'green' : 'red' },
    { label: t.ur_balance, value: formatCost(u?.balance || 0), hint: `${t.ur_balance}: ${formatCost(u?.total_recharged || 0)}`, tone: 'dim' },
  ] : []

  function CostDonut() {
    const cb = data?.costBreakdown || []
    const total = m?.totalCost || 0
    let acc = 0
    const stops = cb.filter((s) => s.cost > 0).map((s) => { const a = (acc / total) * 100; acc += s.cost; return `${SEG_COLOR[s.key]} ${a}% ${(acc / total) * 100}%` }).join(', ')
    return <section className="panel"><h2>{t.ur_costBreakdown}</h2><div className="donut-wrap">
      <div className="donut" role="img" aria-label={t.ur_costBreakdown} style={{ background: total > 0 ? `conic-gradient(${stops})` : 'var(--border)' }}>
        <span>{formatCost(total)}<br /><small>{t.ur_totalCost}</small></span>
      </div>
      <div className="ur-cost-legend">{cb.map((s) => <div key={s.key}>
        <i style={{ background: SEG_COLOR[s.key] }} /><span className="k">{t[SEG_LABEL[s.key]]}</span>
        <span className="v">{formatCost(s.cost)}</span><span className="p">{formatPercent(s.pct * 100)}</span>
      </div>)}</div>
    </div></section>
  }
  function TokenBars() {
    const tb = data?.tokenBreakdown || []
    const max = tb.reduce((mx, s) => Math.max(mx, s.tokens), 0)
    return <section className="panel"><h2>{t.ur_tokenBreakdown}</h2><div className="ur-tokenbars">{tb.map((s) => <div className="ur-bar-row" key={s.key}>
      <span className="k">{t[SEG_LABEL[s.key]]}</span>
      <div className="ur-bar-track"><div className="ur-bar-fill" style={{ width: `${max > 0 ? Math.max(s.tokens > 0 ? 2 : 0, (s.tokens / max) * 100) : 0}%`, background: SEG_COLOR[s.key] }} /></div>
      <span className="v">{formatTokens(s.tokens)}<small>{formatPercent(s.pct * 100)}</small></span>
    </div>)}</div></section>
  }
  function DailyPanel() {
    const rows = data?.daily || []
    const maxCost = rows.reduce((mx, d) => Math.max(mx, d.totalCost), 0)
    const sum = rows.reduce((a, d) => ({ requests: a.requests + d.requests, inputTokens: a.inputTokens + d.inputTokens, outputTokens: a.outputTokens + d.outputTokens, cacheReadTokens: a.cacheReadTokens + d.cacheReadTokens, cacheReadCost: a.cacheReadCost + d.cacheReadCost, totalCost: a.totalCost + d.totalCost, reconcileDiff: a.reconcileDiff + d.reconcileDiff }), { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheReadCost: 0, totalCost: 0, reconcileDiff: 0 })
    // 缓存命中率 = 缓存读 ÷ (真实输入 + 缓存读)；缓存占费 = 缓存读成本 ÷ 总费用。用于逐日横向比较缓存效果。
    const hitRate = (inp: number, cr: number) => (inp + cr > 0 ? cr / (inp + cr) : 0)
    const costShare = (crc: number, tc: number) => (tc > 0 ? crc / tc : 0)
    // 整段时段去重的上游账号数（= byAccount 行数），合计行用它而非逐日 distinct 求和。
    const periodAccounts = (data?.byAccount || []).length
    return <section className="panel"><h2>{t.ur_dailyTrend}</h2>
      {maxCost > 0 && <div className="bars ur-daily-bars" role="img" aria-label={t.ur_dailyTrend}>{rows.map((d) => <div key={d.day} className="bar" title={`${d.day} · ${formatCost(d.totalCost)} · ${formatInt(d.requests)} · ${t.ur_colAccounts} ${formatInt(d.accounts)} · ${t.ur_cacheHitRate} ${formatPercent(hitRate(d.inputTokens, d.cacheReadTokens) * 100)}`} style={{ height: `${Math.max(4, Math.round((d.totalCost / maxCost) * 100))}%`, background: 'var(--primary)' }} />)}</div>}
      <div className="table-wrap"><table><thead><tr>
        <th>{t.ur_colDay}</th><th className="ur-num">{t.ur_colRequests}</th><th className="ur-num">{t.ur_colInputTokens}</th><th className="ur-num">{t.ur_colOutputTokens}</th><th className="ur-num">{t.ur_colCacheReadTokens}</th><th className="ur-num">{t.ur_colAccounts}</th><th className="ur-num ur-cache-pct">{t.ur_cacheHitRate}</th><th className="ur-num ur-cache-pct">{t.ur_colCacheShare}</th><th className="ur-num">{t.ur_colTotalCost}</th><th className="ur-num">{t.ur_colDiff}</th>
      </tr></thead><tbody>
        {rows.map((d) => <tr key={d.day}>
          <td>{d.day}</td><td className="ur-num">{formatInt(d.requests)}</td><td className="ur-num">{formatTokens(d.inputTokens)}</td><td className="ur-num">{formatTokens(d.outputTokens)}</td><td className="ur-num">{formatTokens(d.cacheReadTokens)}</td><td className="ur-num">{formatInt(d.accounts)}</td><td className="ur-num ur-cache-pct">{formatPercent(hitRate(d.inputTokens, d.cacheReadTokens) * 100)}</td><td className="ur-num ur-cache-pct">{formatPercent(costShare(d.cacheReadCost, d.totalCost) * 100)}</td><td className="ur-num">{formatCost(d.totalCost)}</td>
          <td className={`ur-num ${Math.abs(d.reconcileDiff) < 0.005 ? 'ur-diff-ok' : 'ur-diff-bad'}`}>{formatCost(d.reconcileDiff)}</td>
        </tr>)}
        {rows.length > 0 && <tr className="ur-total-row"><td>{t.ur_total}</td><td className="ur-num">{formatInt(sum.requests)}</td><td className="ur-num">{formatTokens(sum.inputTokens)}</td><td className="ur-num">{formatTokens(sum.outputTokens)}</td><td className="ur-num">{formatTokens(sum.cacheReadTokens)}</td><td className="ur-num">{formatInt(periodAccounts)}</td><td className="ur-num ur-cache-pct">{formatPercent(hitRate(sum.inputTokens, sum.cacheReadTokens) * 100)}</td><td className="ur-num ur-cache-pct">{formatPercent(costShare(sum.cacheReadCost, sum.totalCost) * 100)}</td><td className="ur-num">{formatCost(sum.totalCost)}</td><td className="ur-num">{formatCost(sum.reconcileDiff)}</td></tr>}
        {!rows.length && <tr><td colSpan={10} className="empty">{t.ur_noUsage}</td></tr>}
      </tbody></table></div>
    </section>
  }
  function ByModelPanel() {
    const rows = data?.byModel || []
    return <section className="panel"><h2>{t.ur_byModel}</h2><div className="table-wrap"><table><thead><tr>
      <th>{t.ur_colModel}</th><th className="ur-num">{t.ur_colRequests}</th><th className="ur-num">{t.ur_colInputTokens}</th><th className="ur-num">{t.ur_colOutputTokens}</th><th className="ur-num">{t.ur_colCacheReadTokens}</th><th className="ur-num">{t.ur_colTotalCost}</th><th className="ur-num">{t.ur_colCacheShare}</th>
    </tr></thead><tbody>
      {rows.map((r) => <tr key={r.model}><td>{r.model}</td><td className="ur-num">{formatInt(r.requests)}</td><td className="ur-num">{formatTokens(r.inputTokens)}</td><td className="ur-num">{formatTokens(r.outputTokens)}</td><td className="ur-num">{formatTokens(r.cacheReadTokens)}</td><td className="ur-num">{formatCost(r.totalCost)}</td><td className="ur-num">{formatPercent(r.cacheReadCostShare * 100)}</td></tr>)}
      {!rows.length && <tr><td colSpan={7} className="empty">{t.ur_noUsage}</td></tr>}
    </tbody></table></div></section>
  }
  function ByKeyPanel() {
    const rows = data?.byKey || []
    return <section className="panel"><h2>{t.ur_byKey}</h2><div className="table-wrap"><table><thead><tr>
      <th>{t.ur_colKey}</th><th className="ur-num">{t.ur_colQuota}</th><th className="ur-num">{t.ur_colQuotaUsed}</th><th className="ur-num">{t.ur_colRequests}</th><th className="ur-num">{t.ur_colTotalCost}</th>
    </tr></thead><tbody>
      {rows.map((r) => <tr key={r.api_key_id}><td>{r.name}</td><td className="ur-num">{r.quota == null ? '—' : formatCost(r.quota)}</td><td className="ur-num">{r.quota_used == null ? '—' : formatCost(r.quota_used)}</td><td className="ur-num">{formatInt(r.requests)}</td><td className="ur-num">{formatCost(r.totalCost)}</td></tr>)}
      {!rows.length && <tr><td colSpan={5} className="empty">{t.ur_noUsage}</td></tr>}
    </tbody></table></div></section>
  }
  function ByAccountPanel() {
    const rows = data?.byAccount || []
    if (!rows.length) return null
    const top = rows[0]
    const rest = rows.slice(1)
    const restShare = rest.reduce((s, a) => s + a.requestShare, 0)
    const summary = rows.length === 1
      ? t.ur_acctSummaryOne.replace('{top}', top.name).replace('{hit}', formatPercent(top.cacheHitRate * 100))
      : t.ur_acctSummaryMulti.replace('{n}', String(rows.length)).replace('{top}', top.name).replace('{share}', formatPercent(top.requestShare * 100)).replace('{hit}', formatPercent(top.cacheHitRate * 100)).replace('{rest}', String(rest.length)).replace('{restShare}', formatPercent(restShare * 100))
    return <section className="panel"><h2>{t.ur_byAccount}</h2>
      <p className="ur-acct-summary">{summary}</p>
      <div className="table-wrap"><table><thead><tr>
        <th>{t.ur_colAccount}</th><th>{t.ur_colPlatform}</th><th className="ur-num">{t.ur_colRequests}</th><th>{t.ur_colReqShare}</th><th className="ur-num ur-cache-pct">{t.ur_cacheHitRate}</th><th className="ur-num ur-cache-pct">{t.ur_colCacheShare}</th><th className="ur-num">{t.ur_colCacheReadTokens}</th><th className="ur-num">{t.ur_colTotalCost}</th>
      </tr></thead><tbody>
        {rows.map((a, i) => <tr key={a.account_id} className={i === 0 ? 'ur-acct-top' : ''}>
          <td className="ur-acct-name">{i === 0 && <span className="ur-badge">{t.ur_acctPrimary}</span>}<span className="ur-acct-id">{a.name}</span></td>
          <td>{a.platform || '-'}</td>
          <td className="ur-num">{formatInt(a.requests)}</td>
          <td><div className="ur-share"><span className="ur-share-track"><span className="ur-share-fill" style={{ width: `${Math.round(a.requestShare * 100)}%` }} /></span><span className="ur-share-val">{formatPercent(a.requestShare * 100)}</span></div></td>
          <td className="ur-num ur-cache-pct">{formatPercent(a.cacheHitRate * 100)}</td>
          <td className="ur-num ur-cache-pct">{formatPercent(a.cacheReadCostShare * 100)}</td>
          <td className="ur-num">{formatTokens(a.cacheReadTokens)}</td>
          <td className="ur-num">{formatCost(a.totalCost)}</td>
        </tr>)}
      </tbody></table></div>
      <div className="ur-note-box ur-amber ur-acct-explain">{t.ur_acctExplain}</div>
    </section>
  }
  function TopPanel() {
    const rows = data?.topRequests || []
    return <section className="panel"><h2>{t.ur_topRequests}</h2><div className="table-wrap"><table><thead><tr>
      <th>{t.ur_colTime}</th><th>{t.ur_colModel}</th><th className="ur-num">{t.ur_colInputTokens}</th><th className="ur-num">{t.ur_colOutputTokens}</th><th className="ur-num">{t.ur_colCacheReadTokens}</th><th className="ur-num">{t.ur_colTotalCost}</th><th className="ur-num">{t.ur_colCacheShare}</th>
    </tr></thead><tbody>
      {rows.map((r, i) => <tr key={i}><td>{r.created_at}</td><td>{r.model}</td><td className="ur-num">{formatTokens(r.inputTokens)}</td><td className="ur-num">{formatTokens(r.outputTokens)}</td><td className="ur-num">{formatTokens(r.cacheReadTokens)}</td><td className="ur-num">{formatCost(r.totalCost)}</td><td className="ur-num">{formatPercent(r.cacheReadCostShare * 100)}</td></tr>)}
      {!rows.length && <tr><td colSpan={7} className="empty">{t.ur_noUsage}</td></tr>}
    </tbody></table></div></section>
  }

  return <div className="obs-page usage-report">
    {/* 查询条 */}
    <div className="ur-lookup panel">
      <div className="ur-lookup-row">
        <input className="ur-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doLookup()} placeholder={t.ur_emailPlaceholder} aria-label={t.ur_emailPlaceholder} />
        <button className="primary" onClick={doLookup} disabled={loading}>{loading ? <><Spinner /> {t.ur_lookup}</> : t.ur_lookup}</button>
      </div>
      <div className="ur-lookup-row">
        <div className="range-tabs">{RANGES.map((r) => <button key={r.key} className={range === r.key ? 'active' : ''} onClick={() => setRange(r.key)}>{t[r.k]}</button>)}</div>
        {range === 'custom' && <span className="ur-custom">
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label={t.ur_startDate} />
          <span className="muted">~</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label={t.ur_endDate} />
          <button className="primary" onClick={applyCustom} disabled={loading}>{t.apply}</button>
        </span>}
        <span className="muted ur-tz">{t.ur_tzNote}</span>
      </div>
    </div>

    {error && <div className="error-banner">API Error: {error}</div>}

    {/* 首次空白：引导 */}
    {!data && !loading && !error && <div className="notice">{t.ur_enterEmail}</div>}
    {!data && loading && <SkeletonCards n={8} />}

    {/* 未找到 / 多命中 */}
    {data?.resolve === 'notFound' && <div className="panel"><h2>{t.ur_notFound}</h2><p className="muted">{t.ur_notFoundHint}</p></div>}
    {data?.resolve === 'ambiguous' && <div className="panel"><div className="panel-head"><div><h2>{t.ur_ambiguous}</h2><p>{t.ur_colCandidate}</p></div></div>
      <div className="ur-candidates">{(data.candidates || []).map((c) => <div key={c.user_id} className="ur-cand" onClick={() => pickCandidate(c)}>
        <div><b>{c.email}</b> <small>#{c.user_id} · {c.role || '-'} · {c.status || '-'}</small></div>
        <small>{t.ur_balance}: {formatCost(c.balance)} · {t.ur_lastActive}: {c.last_active_at || '-'}</small>
      </div>)}</div>
    </div>}

    {/* 命中：报告 */}
    {data?.resolve === 'found' && u && <div className="ur-stack">
      {/* 身份卡 */}
      <section className="panel"><div className="ur-identity">
        <div><span className="k">{t.colEmail}</span><b>{u.email}</b></div>
        <div><span className="k">ID</span><b>#{u.user_id}</b></div>
        <div><span className="k">{t.ur_role}</span><b>{u.role || '-'}</b></div>
        <div><span className="k">{t.ur_status}</span><b>{u.status || '-'}</b></div>
        <div><span className="k">{t.ur_created}</span><b>{u.created_at || '-'}</b></div>
        <div><span className="k">{t.ur_lastActive}</span><b>{u.last_active_at || '-'}</b></div>
        <div><span className="k">{t.ur_keysHit}</span><b>{(data.byKey || []).length}</b></div>
        <div><span className="k">{t.ur_period}</span><b><span className="ur-period-chip">{data.period.start} ~ {data.period.end} · {t.ur_tzNote}</span></b></div>
      </div></section>

      {hasUsage ? <>
        {/* 一句话结论 */}
        <section className="panel ur-verdict">
          <div className="ur-verdict-head"><h2>{t.ur_verdict}</h2><button className="ur-copy" onClick={copyVerdict}>{t.ur_copyVerdict}</button></div>
          <p className="ur-verdict-text">{verdictText()}</p>
        </section>

        {/* 核心指标卡 */}
        <section className="metrics-grid">{metricCards.map((c) => <MetricCard key={c.label} {...c} />)}</section>

        {/* 消费构成 + Token 去向 */}
        <section className="lower-grid"><CostDonut /><TokenBars /></section>

        {/* 缓存解释 */}
        <div className="ur-note-box ur-amber"><h2>{t.ur_cacheExplainTitle}</h2>{t.ur_cacheExplainBody}</div>

        <DailyPanel />
        <ByAccountPanel />
        <ByModelPanel />
        <ByKeyPanel />
        <TopPanel />
      </> : <div className="notice">{m && m.failedRequests > 0 ? t.ur_noUsageFailed.replace('{n}', formatInt(m.failedRequests)) : t.ur_noUsage}</div>}

      {/* 计费诚信声明（始终展示） */}
      <div className="ur-note-box ur-integrity">{t.ur_integrityBody.replace('{failed}', formatInt(m?.failedRequests || 0)).replace('{start}', data.period.start).replace('{end}', data.period.end)}</div>
    </div>}
  </div>
}
