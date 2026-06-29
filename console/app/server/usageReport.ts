/**
 * 用户用量报告：按「邮箱 + 时间段」拉取某用户在该时段的**消费与缓存**构成，用于回应
 * 「额度怎么这么快没了 / 平台是不是坑我」这类质疑——一页给出可截图、可核账的证据。
 *
 * **站点感知**（与 observability.ts 同构）：
 * - 本机站点(kind=local)：env DATABASE_URL 只读连接池，全参数化查询。
 * - 远程站点(ssh_host+pg_container)：复用 `ssh docker exec psql`，整份报告聚合成单个 JSON 一次返回。
 *   email 走 lit() '' 转义、自定义日期走 ^\d{4}-\d{2}-\d{2}$ 白名单校验后内联，user_id 为整数；防注入。
 *
 * 口径：金额/缓存只统计**成功请求**(usage_logs)；失败请求(ops_error_logs 无 token/cost 列)仅计数、不计费。
 * 时区：created_at 为 timestamptz，按 **Asia/Shanghai** 切日，避免 UTC 跨日错切。
 */
import { getSite, localPool, sshPsql } from './sites.js'
import { obsMode } from './observability.js'

const TZ = 'Asia/Shanghai'
const YMD = /^\d{4}-\d{2}-\d{2}$/

function num(v: unknown): number { if (v == null) return 0; const n = Number(v); return Number.isFinite(n) ? n : 0 }
function round(v: number, d = 6): number { const p = Math.pow(10, d); return Math.round((num(v)) * p) / p }
/** SQL 字符串字面量(standard_conforming_strings 下 '' 转义即安全)。 */
function lit(s: string): string { return `'${String(s).replace(/'/g, "''")}'` }
async function runJson<T = any>(sshHost: string, pgContainer: string, sql: string): Promise<T | null> {
  const out = await sshPsql(sshHost, pgContainer, sql)
  return out ? (JSON.parse(out) as T) : null
}

// ---- 时间段解析（上海时区，日粒度，含起止两端）----
function ymdInTz(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
export function resolveRange(range: string, start?: string, end?: string): { range: string; start: string; end: string } {
  const today = ymdInTz(new Date())
  if (range === 'custom') {
    let s = YMD.test(String(start)) ? String(start) : today
    let e = YMD.test(String(end)) ? String(end) : today
    if (s > e) { const t = s; s = e; e = t }
    if (addDaysYmd(s, 366) < e) s = addDaysYmd(e, -366) // 钳制最大跨度 366 天
    return { range: 'custom', start: s, end: e }
  }
  if (range === 'today') return { range, start: today, end: today }
  if (range === '30d') return { range, start: addDaysYmd(today, -29), end: today }
  if (range === 'month') return { range, start: `${today.slice(0, 8)}01`, end: today }
  return { range: '7d', start: addDaysYmd(today, -6), end: today } // 默认近 7 天
}

// ---- 共用列投影（表别名 u；where 子句由调用方拼，本机=占位符 / 远程=内联字面量）----
const METRIC_COLS = `
  count(*)::int as success_requests,
  coalesce(sum(u.input_tokens),0)::float8 as input_tokens,
  coalesce(sum(u.output_tokens),0)::float8 as output_tokens,
  coalesce(sum(u.cache_creation_tokens),0)::float8 as cache_creation_tokens,
  coalesce(sum(u.cache_read_tokens),0)::float8 as cache_read_tokens,
  coalesce(sum(u.cache_creation_5m_tokens),0)::float8 as cache_creation_5m_tokens,
  coalesce(sum(u.cache_creation_1h_tokens),0)::float8 as cache_creation_1h_tokens,
  coalesce(sum(u.input_cost),0)::float8 as input_cost,
  coalesce(sum(u.output_cost),0)::float8 as output_cost,
  coalesce(sum(u.cache_creation_cost),0)::float8 as cache_creation_cost,
  coalesce(sum(u.cache_read_cost),0)::float8 as cache_read_cost,
  coalesce(sum(u.total_cost),0)::float8 as total_cost,
  coalesce(sum(u.actual_cost),0)::float8 as actual_cost`
const DAILY_COLS = `
  to_char((u.created_at at time zone '${TZ}')::date,'YYYY-MM-DD') as day, count(*)::int as requests,
  count(distinct u.account_id)::int as accounts,
  coalesce(sum(u.input_tokens),0)::float8 as input_tokens, coalesce(sum(u.output_tokens),0)::float8 as output_tokens,
  coalesce(sum(u.cache_creation_tokens),0)::float8 as cache_creation_tokens, coalesce(sum(u.cache_read_tokens),0)::float8 as cache_read_tokens,
  coalesce(sum(u.input_cost),0)::float8 as input_cost, coalesce(sum(u.output_cost),0)::float8 as output_cost,
  coalesce(sum(u.cache_creation_cost),0)::float8 as cache_creation_cost, coalesce(sum(u.cache_read_cost),0)::float8 as cache_read_cost,
  coalesce(sum(u.total_cost),0)::float8 as total_cost`
const MODEL_COLS = `
  coalesce(nullif(u.requested_model,''),u.model,'unknown') as model, count(*)::int as requests,
  coalesce(sum(u.input_tokens),0)::float8 as input_tokens, coalesce(sum(u.output_tokens),0)::float8 as output_tokens,
  coalesce(sum(u.cache_read_tokens),0)::float8 as cache_read_tokens, coalesce(sum(u.total_cost),0)::float8 as total_cost,
  coalesce(sum(u.cache_read_cost),0)::float8 as cache_read_cost`
// 上游账号维度（usage_logs.account_id 每条必填 → join accounts 取可读名/平台/状态）。
// 用于回答"请求实际打到了哪些上游、各占多少"——缓存亲和绑在账号上，集中度↔命中率。
const ACCOUNT_COLS = `
  u.account_id::int as account_id, coalesce(nullif(a.name,''),'#'||u.account_id::text) as name,
  coalesce(a.platform,'') as platform, coalesce(a.status,'') as status,
  count(*)::int as requests,
  coalesce(sum(u.input_tokens),0)::float8 as input_tokens, coalesce(sum(u.cache_read_tokens),0)::float8 as cache_read_tokens,
  coalesce(sum(u.total_cost),0)::float8 as total_cost, coalesce(sum(u.cache_read_cost),0)::float8 as cache_read_cost`
const KEY_COLS = `
  u.api_key_id::int as api_key_id, coalesce(k.name,'#'||u.api_key_id::text) as name,
  k.quota::float8 as quota, k.quota_used::float8 as quota_used,
  count(*)::int as requests, coalesce(sum(u.total_cost),0)::float8 as total_cost,
  coalesce(sum(u.input_tokens+u.output_tokens+u.cache_creation_tokens+u.cache_read_tokens),0)::float8 as total_tokens`
const TOP_COLS = `
  to_char(u.created_at at time zone '${TZ}','YYYY-MM-DD HH24:MI:SS') as created_at,
  coalesce(nullif(u.requested_model,''),u.model,'unknown') as model,
  coalesce(u.input_tokens,0)::int as input_tokens, coalesce(u.output_tokens,0)::int as output_tokens,
  coalesce(u.cache_creation_tokens,0)::int as cache_creation_tokens, coalesce(u.cache_read_tokens,0)::int as cache_read_tokens,
  coalesce(u.total_cost,0)::float8 as total_cost, coalesce(u.cache_read_cost,0)::float8 as cache_read_cost`
const USER_COLS = `
  id::int as user_id, email, coalesce(role,'') as role, coalesce(status,'') as status,
  balance::float8 as balance, total_recharged::float8 as total_recharged,
  to_char(created_at at time zone '${TZ}','YYYY-MM-DD HH24:MI:SS') as created_at,
  to_char(last_active_at at time zone '${TZ}','YYYY-MM-DD HH24:MI:SS') as last_active_at`

interface UserRow { user_id: number; email: string; role: string; status: string; balance: number; total_recharged: number; created_at: string | null; last_active_at: string | null }

/** 把解析出的多行用户判定为 未找到 / 多命中 / 单命中。exact 行优先（_rank=1）。 */
function decideResolve(rows: any[]): { resolve: 'found' | 'notFound' | 'ambiguous'; user?: UserRow; candidates?: UserRow[] } {
  const norm = (r: any): UserRow => ({ user_id: num(r.user_id), email: r.email, role: r.role || '', status: r.status || '', balance: num(r.balance), total_recharged: num(r.total_recharged), created_at: r.created_at || null, last_active_at: r.last_active_at || null })
  if (!rows.length) return { resolve: 'notFound', candidates: [] }
  const exact = rows.filter((r) => Number(r._rank) === 1)
  if (exact.length === 1) return { resolve: 'found', user: norm(exact[0]) }
  if (rows.length === 1) return { resolve: 'found', user: norm(rows[0]) }
  return { resolve: 'ambiguous', candidates: rows.slice(0, 20).map(norm) }
}

/** 把后端聚合的 sum 行与失败数派生成对外 metrics + 成本/Token 四项拆分。 */
function shapeMetrics(m: any, failed: number) {
  m = m || {}
  const inputCost = num(m.input_cost), outputCost = num(m.output_cost), cacheCreationCost = num(m.cache_creation_cost), cacheReadCost = num(m.cache_read_cost)
  const totalCost = num(m.total_cost)
  const inputTokens = num(m.input_tokens), outputTokens = num(m.output_tokens), cacheCreationTokens = num(m.cache_creation_tokens), cacheReadTokens = num(m.cache_read_tokens)
  const totalTokens = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens
  const successRequests = num(m.success_requests)
  const partsSum = inputCost + outputCost + cacheCreationCost + cacheReadCost
  const metrics = {
    totalCost, inputCost, outputCost, cacheCreationCost, cacheReadCost, actualCost: num(m.actual_cost),
    reconcileDiff: round(totalCost - partsSum),
    inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens,
    cacheCreation5mTokens: num(m.cache_creation_5m_tokens), cacheCreation1hTokens: num(m.cache_creation_1h_tokens),
    totalTokens, successRequests, failedRequests: num(failed),
    cacheReadCostShare: totalCost ? cacheReadCost / totalCost : 0,
    cacheCostShare: totalCost ? (cacheReadCost + cacheCreationCost) / totalCost : 0,
    cacheTokenShare: totalTokens ? cacheReadTokens / totalTokens : 0,
    cacheHitRate: inputTokens + cacheReadTokens ? cacheReadTokens / (inputTokens + cacheReadTokens) : 0,
    cacheReadMultiple: inputTokens ? cacheReadTokens / inputTokens : 0,
    avgCostPerReq: successRequests ? totalCost / successRequests : 0,
  }
  const costBreakdown = [
    { key: 'input', cost: inputCost }, { key: 'output', cost: outputCost },
    { key: 'cache_creation', cost: cacheCreationCost }, { key: 'cache_read', cost: cacheReadCost },
  ].map((x) => ({ ...x, pct: totalCost ? x.cost / totalCost : 0 }))
  const tokenBreakdown = [
    { key: 'input', tokens: inputTokens }, { key: 'output', tokens: outputTokens },
    { key: 'cache_creation', tokens: cacheCreationTokens }, { key: 'cache_read', tokens: cacheReadTokens },
  ].map((x) => ({ ...x, pct: totalTokens ? x.tokens / totalTokens : 0 }))
  return { metrics, costBreakdown, tokenBreakdown }
}
function shapeDaily(rows: any[]) {
  return (rows || []).map((d: any) => {
    const totalCost = num(d.total_cost)
    const parts = num(d.input_cost) + num(d.output_cost) + num(d.cache_creation_cost) + num(d.cache_read_cost)
    return {
      day: d.day, requests: num(d.requests), accounts: num(d.accounts),
      inputTokens: num(d.input_tokens), outputTokens: num(d.output_tokens), cacheCreationTokens: num(d.cache_creation_tokens), cacheReadTokens: num(d.cache_read_tokens),
      inputCost: num(d.input_cost), outputCost: num(d.output_cost), cacheCreationCost: num(d.cache_creation_cost), cacheReadCost: num(d.cache_read_cost),
      totalCost, reconcileDiff: round(totalCost - parts),
    }
  })
}
/** 上游账号分布：每账号承接的请求/命中率/占费，并派生"请求占比"(占该用户本时段总请求)。按请求数降序。 */
function shapeByAccount(rows: any[]) {
  const list = (rows || []).map((a: any) => {
    const totalCost = num(a.total_cost), inputTokens = num(a.input_tokens), cacheReadTokens = num(a.cache_read_tokens)
    return {
      account_id: num(a.account_id), name: a.name, platform: a.platform || '', status: a.status || '',
      requests: num(a.requests), inputTokens, cacheReadTokens, totalCost, cacheReadCost: num(a.cache_read_cost),
      cacheHitRate: inputTokens + cacheReadTokens ? cacheReadTokens / (inputTokens + cacheReadTokens) : 0,
      cacheReadCostShare: totalCost ? num(a.cache_read_cost) / totalCost : 0,
    }
  })
  const totalReq = list.reduce((s, a) => s + a.requests, 0)
  return list.map((a) => ({ ...a, requestShare: totalReq ? a.requests / totalReq : 0 }))
}
function shapeByModel(rows: any[]) {
  return (rows || []).map((m: any) => {
    const totalCost = num(m.total_cost)
    return {
      model: m.model, requests: num(m.requests),
      inputTokens: num(m.input_tokens), outputTokens: num(m.output_tokens), cacheReadTokens: num(m.cache_read_tokens),
      totalTokens: num(m.input_tokens) + num(m.output_tokens) + num(m.cache_read_tokens),
      totalCost, cacheReadCost: num(m.cache_read_cost), cacheReadCostShare: totalCost ? num(m.cache_read_cost) / totalCost : 0,
    }
  })
}
function shapeByKey(rows: any[]) {
  return (rows || []).map((k: any) => ({
    api_key_id: num(k.api_key_id), name: k.name, quota: k.quota == null ? null : num(k.quota), quota_used: k.quota_used == null ? null : num(k.quota_used),
    requests: num(k.requests), totalCost: num(k.total_cost), totalTokens: num(k.total_tokens),
  }))
}
function shapeTop(rows: any[]) {
  return (rows || []).map((r: any) => {
    const totalCost = num(r.total_cost)
    return {
      created_at: r.created_at, model: r.model,
      inputTokens: num(r.input_tokens), outputTokens: num(r.output_tokens), cacheCreationTokens: num(r.cache_creation_tokens), cacheReadTokens: num(r.cache_read_tokens),
      totalCost, cacheReadCostShare: totalCost ? num(r.cache_read_cost) / totalCost : 0,
    }
  })
}

export interface UsageReportParams { q?: string; uid?: string | number; range?: string; start?: string; end?: string }

export async function userUsageReport(siteId: number, params: UsageReportParams): Promise<any> {
  const site = getSite(siteId)
  const mode = obsMode(site)
  if (!mode) throw new Error('该站点未接入可观测（需配置 ssh_host + pg_container 提权通道）')
  const period = resolveRange(String(params.range || '7d'), params.start ? String(params.start) : undefined, params.end ? String(params.end) : undefined)
  const tzPeriod = { ...period, tz: TZ }
  const q = String(params.q || '').trim()
  const uid = params.uid != null && String(params.uid).trim() !== '' && Number.isFinite(Number(params.uid)) ? Math.trunc(Number(params.uid)) : null
  if (!q && uid == null) return { resolve: 'notFound', candidates: [], period: tzPeriod }

  if (mode === 'local') return localReport(siteId, q, uid, period, tzPeriod)
  return sshReport(site!.ssh_host!.trim(), site!.pg_container!.trim(), q, uid, period, tzPeriod)
}

// ---------- 本机：参数化查询 ----------
async function localReport(_siteId: number, q: string, uid: number | null, period: { start: string; end: string }, tzPeriod: any) {
  const pool = localPool(false)
  // 1) 解析用户
  let userRows: any[]
  if (uid != null) {
    userRows = (await pool.query(`select ${USER_COLS}, 1 as _rank from users where id = $1`, [uid])).rows
  } else {
    userRows = (await pool.query(
      `select * from (
         select ${USER_COLS}, 1 as _rank from users where email = $1
         union all
         select ${USER_COLS}, 2 as _rank from users where email ilike '%'||$1||'%' and email <> $1
       ) x order by _rank, last_active_at desc nulls last limit 50`, [q])).rows
  }
  const r = decideResolve(userRows)
  if (r.resolve !== 'found' || !r.user) return { ...r, period: tzPeriod }

  // 2) 聚合（同时段；usage_logs 计费、ops_error_logs 仅计失败数）
  const uId = r.user.user_id
  const whereU = `u.user_id = $1 and (u.created_at at time zone '${TZ}') >= $2::date and (u.created_at at time zone '${TZ}') < ($3::date + 1)`
  const whereE = `e.user_id = $1 and (e.created_at at time zone '${TZ}') >= $2::date and (e.created_at at time zone '${TZ}') < ($3::date + 1)`
  const p = [uId, period.start, period.end]
  const [mr, fr, dr, modr, keyr, acctr, topr] = await Promise.all([
    pool.query(`select ${METRIC_COLS} from usage_logs u where ${whereU}`, p),
    pool.query(`select count(*)::int as failed from ops_error_logs e where ${whereE}`, p),
    pool.query(`select ${DAILY_COLS} from usage_logs u where ${whereU} group by 1 order by 1`, p),
    pool.query(`select ${MODEL_COLS} from usage_logs u where ${whereU} group by 1 order by total_cost desc limit 30`, p),
    pool.query(`select ${KEY_COLS} from usage_logs u left join api_keys k on k.id = u.api_key_id where ${whereU} group by u.api_key_id, k.name, k.quota, k.quota_used order by total_cost desc limit 50`, p),
    pool.query(`select ${ACCOUNT_COLS} from usage_logs u left join accounts a on a.id = u.account_id where ${whereU} group by u.account_id, a.name, a.platform, a.status order by requests desc limit 50`, p),
    pool.query(`select ${TOP_COLS} from usage_logs u where ${whereU} order by u.total_cost desc nulls last limit 10`, p),
  ])
  const { metrics, costBreakdown, tokenBreakdown } = shapeMetrics(mr.rows[0], fr.rows[0]?.failed)
  return {
    resolve: 'found', period: tzPeriod, user: r.user, metrics, costBreakdown, tokenBreakdown,
    daily: shapeDaily(dr.rows), byModel: shapeByModel(modr.rows), byKey: shapeByKey(keyr.rows), byAccount: shapeByAccount(acctr.rows), topRequests: shapeTop(topr.rows),
  }
}

// ---------- 远程：ssh docker exec psql，整份报告聚合成单个 JSON ----------
async function sshReport(sshHost: string, pgContainer: string, q: string, uid: number | null, period: { start: string; end: string }, tzPeriod: any) {
  if (!YMD.test(period.start) || !YMD.test(period.end)) throw new Error('时间段格式非法')
  // 1) 解析用户
  const resolveSql = uid != null
    ? `select coalesce(json_agg(row_to_json(u)),'[]'::json) from (select ${USER_COLS}, 1 as _rank from users where id = ${uid}) u`
    : `select coalesce(json_agg(row_to_json(u)),'[]'::json) from (
         select * from (
           select ${USER_COLS}, 1 as _rank from users where email = ${lit(q)}
           union all
           select ${USER_COLS}, 2 as _rank from users where email ilike ${lit(`%${q}%`)} and email <> ${lit(q)}
         ) x order by _rank, last_active_at desc nulls last limit 50
       ) u`
  const userRows = (await runJson<any[]>(sshHost, pgContainer, resolveSql)) || []
  const r = decideResolve(userRows)
  if (r.resolve !== 'found' || !r.user) return { ...r, period: tzPeriod }

  // 2) 聚合（一次 round-trip）
  const uId = r.user.user_id
  const whereU = `u.user_id = ${uId} and (u.created_at at time zone '${TZ}') >= '${period.start}'::date and (u.created_at at time zone '${TZ}') < ('${period.end}'::date + 1)`
  const whereE = `e.user_id = ${uId} and (e.created_at at time zone '${TZ}') >= '${period.start}'::date and (e.created_at at time zone '${TZ}') < ('${period.end}'::date + 1)`
  const sql = `select json_build_object(
    'metrics',(select row_to_json(t) from (select ${METRIC_COLS} from usage_logs u where ${whereU}) t),
    'failed',(select count(*)::int from ops_error_logs e where ${whereE}),
    'daily',(select coalesce(json_agg(row_to_json(d) order by d.day),'[]'::json) from (select ${DAILY_COLS} from usage_logs u where ${whereU} group by 1) d),
    'byModel',(select coalesce(json_agg(row_to_json(m) order by m.total_cost desc),'[]'::json) from (select ${MODEL_COLS} from usage_logs u where ${whereU} group by 1 order by total_cost desc limit 30) m),
    'byKey',(select coalesce(json_agg(row_to_json(k) order by k.total_cost desc),'[]'::json) from (select ${KEY_COLS} from usage_logs u left join api_keys k on k.id = u.api_key_id where ${whereU} group by u.api_key_id, k.name, k.quota, k.quota_used order by total_cost desc limit 50) k),
    'byAccount',(select coalesce(json_agg(row_to_json(ac) order by ac.requests desc),'[]'::json) from (select ${ACCOUNT_COLS} from usage_logs u left join accounts a on a.id = u.account_id where ${whereU} group by u.account_id, a.name, a.platform, a.status order by requests desc limit 50) ac),
    'topRequests',(select coalesce(json_agg(row_to_json(rq) order by rq.total_cost desc),'[]'::json) from (select ${TOP_COLS} from usage_logs u where ${whereU} order by u.total_cost desc nulls last limit 10) rq)
  ) as r`
  const j = (await runJson<any>(sshHost, pgContainer, sql)) || {}
  const { metrics, costBreakdown, tokenBreakdown } = shapeMetrics(j.metrics, j.failed)
  return {
    resolve: 'found', period: tzPeriod, user: r.user, metrics, costBreakdown, tokenBreakdown,
    daily: shapeDaily(j.daily), byModel: shapeByModel(j.byModel), byKey: shapeByKey(j.byKey), byAccount: shapeByAccount(j.byAccount), topRequests: shapeTop(j.topRequests),
  }
}
