/**
 * 可观测：读 sub2api postgres 的 usage_logs/ops_error_logs/users/api_keys。**站点感知**：
 * - 本机站点(kind=local)：走 env DATABASE_URL 的 pg 只读连接池(参数化查询)。
 * - 远程站点(配了 ssh_host+pg_container)：复用提权通道 `ssh docker exec psql`，SQL 返回单个 JSON 再解析
 *   (window 来自白名单、q/model 做 SQL 字面量转义防注入；不开隧道、不暴露 PG 端口、不动 sub2api)。
 */
import { getSite, localPool, sshPsql, type SiteRow } from './sites.js'
import { DATABASE_URL } from './config.js'

type WindowKey = '5m' | '15m' | '1h' | '24h'
const windows: Record<WindowKey, string> = { '5m': '5 minutes', '15m': '15 minutes', '1h': '1 hour', '24h': '24 hours' }
function num(v: unknown): number { if (v == null) return 0; const n = Number(v); return Number.isFinite(n) ? n : 0 }

// 项目规范时区(与 usageReport.ts 一致)：custom 起止按上海时区墙钟解释为 timestamptz 再与 created_at(timestamptz) 比较。
const TZ = 'Asia/Shanghai'
// custom 起止严格校验：'YYYY-MM-DD' 或 'YYYY-MM-DD HH:mm[:ss]'（容忍 'T' 分隔，下面归一为空格）。
const TS_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/

/**
 * 时间窗解析 → 三段 **可安全内联** 的 SQL 片段：lowerExpr / upperExpr / bucketExpr。
 * 安全模型：快捷窗的 interval 文本取自白名单 `windows`；custom 的 start/end 先经 TS_RE 严格校验
 * 才内联成 SQL 字面量。二者均非用户原样拼接，故 local(参数化路径) 与 ssh(字面量路径) 都可直接内联。
 * 调用方仍须把 q/model/分页参数继续参数化(local)或走 lit()(ssh)，本解析器不碰那些。
 * - 快捷窗：lowerExpr = now() - interval '<白名单文本>'，upperExpr = now()。
 * - custom：start 与 end 任一不合法 → 回退默认 '15m' 快捷窗。归一 'T'→空格；
 *   每个边界构造 (timestamp '<已校验>' at time zone 'Asia/Shanghai')。start>end 则交换。
 *   span 超过 92 天则上移下界(钳制最大跨度)以防病态全表扫描。
 * - bucketExpr = greatest((upper-lower)/8, interval '1 second')（8 个趋势桶；start==end 时防零宽）。
 */
function resolveRange(opts: { window?: unknown; start?: unknown; end?: unknown }): { lowerExpr: string; upperExpr: string; bucketExpr: string } {
  const quick = (key: WindowKey): { lowerExpr: string; upperExpr: string; bucketExpr: string } => {
    const lowerExpr = `now() - interval '${windows[key]}'`
    const upperExpr = `now()`
    // bucketExpr 的减法**两操作数都必须再包一层括号**：lowerExpr 本身是 `now() - interval`，
    // 若写成 `up - lo` 会被解析成 `now() - now() - interval`（=负），greatest 退化成 1 秒 → 桶数=窗口秒数（如 24h=86400 个），趋势条把页面撑爆。
    return { lowerExpr, upperExpr, bucketExpr: `greatest(((${upperExpr}) - (${lowerExpr})) / 8, interval '1 second')` }
  }
  if (String(opts.window || '15m') !== 'custom') {
    const key = (String(opts.window || '15m') as WindowKey)
    return quick(windows[key] ? key : '15m')
  }
  let start = String(opts.start ?? '').trim()
  let end = String(opts.end ?? '').trim()
  if (!TS_RE.test(start) || !TS_RE.test(end)) return quick('15m')   // 任一不合法 → 回退 15m
  start = start.replace('T', ' '); end = end.replace('T', ' ')
  if (start > end) { const t = start; start = end; end = t }         // 顺序颠倒则交换
  // 钳制最大跨度 92 天：若 (end-start) 超限，上移下界。lower/upper 均为 TS_RE 校验过的字面量，内联安全。
  let lowerExpr = `(timestamp '${start}' at time zone '${TZ}')`
  const upperExpr = `(timestamp '${end}' at time zone '${TZ}')`
  lowerExpr = `greatest(${lowerExpr}, ${upperExpr} - interval '92 days')`
  return { lowerExpr, upperExpr, bucketExpr: `greatest(((${upperExpr}) - (${lowerExpr})) / 8, interval '1 second')` }
}
// 慢请求口径：首字(first token)耗时 >= 20s。count 与可搜索列表共用同一口径，列表按首字倒序排。
// 纯数值常量，内联进 SQL 无注入风险。usage_logs 用 first_token_ms；ops_error_logs 用 time_to_first_token_ms。
const SLOW_FIRST_TOKEN_MS = 20000
const slowSuccessCond = `(u.first_token_ms >= ${SLOW_FIRST_TOKEN_MS})`
const slowErrorCond = `(e.time_to_first_token_ms >= ${SLOW_FIRST_TOKEN_MS})`
function ownerLabel(o: string | null): string { return ({ client: '用户', provider: '上游', platform: '平台' } as Record<string, string>)[o || ''] || '未知' }
function normalizeOwner(o: string | null, kind?: string): string {
  if (kind === 'success') return 'normal'
  if (o === 'client' || o === 'provider' || o === 'platform') return o
  return 'unknown'
}
/** SQL 字符串字面量(standard_conforming_strings 下 '' 转义即安全)。 */
function lit(s: string): string { return `'${String(s).replace(/'/g, "''")}'` }

export type ObsMode = 'local' | 'ssh' | null
export function obsMode(site: SiteRow | null): ObsMode {
  if (!site) return null
  if (site.kind === 'local' && DATABASE_URL) return 'local'
  if ((site.ssh_host || '').trim() && (site.pg_container || '').trim()) return 'ssh'
  return null
}
async function runJson<T = any>(site: SiteRow, sql: string): Promise<T | null> {
  const out = await sshPsql((site.ssh_host || '').trim(), (site.pg_container || '').trim(), sql)
  return out ? (JSON.parse(out) as T) : null
}

function shapeSummary(s: any, e: any, trend: any[], owners: any[], models: any[], slow: number, windowKey: unknown) {
  s = s || {}; e = e || {}
  const successCount = num(s.count)
  const errorCount = num(e.count)
  const total = successCount + errorCount
  return {
    window: windowKey || '15m',
    metrics: {
      total, success: successCount, failed: errorCount,
      successRate: total > 0 ? (successCount / total) * 100 : 100,
      avgDurationMs: num(s.avg_duration_ms),
      p95DurationMs: Math.max(num(s.p95_duration_ms), num(e.p95_duration_ms)),
      avgFirstTokenMs: num(s.avg_first_token_ms), slowRequests: num(slow),
      // token 消耗（仅成功请求计入；错误日志不记 token）。totalTokens = 入+出（缓存另列）。
      inputTokens: num(s.input_tokens), outputTokens: num(s.output_tokens),
      cacheReadTokens: num(s.cache_read_tokens), cacheCreationTokens: num(s.cache_creation_tokens),
      totalTokens: num(s.input_tokens) + num(s.output_tokens),
      totalCost: num(s.total_cost),
    },
    trend: trend || [],
    owners: (owners || []).map((r: any) => ({ ...r, label: ownerLabel(r.owner) })),
    models: models || [],
  }
}

export async function summary(siteId: number, opts: { window?: unknown; start?: unknown; end?: unknown }): Promise<any> {
  const site = getSite(siteId)
  const mode = obsMode(site)
  if (!mode) throw new Error('该站点未接入可观测（需配置 ssh_host + pg_container 提权通道）')
  const windowKey = opts.window
  // lo/up/bk 为白名单/正则校验后的 SQL 片段，内联安全(见 resolveRange 注释)；下面 local/ssh 都直接内联。
  const { lowerExpr: lo, upperExpr: up, bucketExpr: bk } = resolveRange(opts)
  if (mode === 'local') {
    const pool = localPool(false)
    const [sr, er, tr, or_, mr, slr, eslr] = await Promise.all([
      pool.query(`select count(*)::int as count, coalesce(avg(duration_ms),0)::float as avg_duration_ms, coalesce(percentile_cont(0.95) within group (order by duration_ms),0)::float as p95_duration_ms, coalesce(avg(first_token_ms),0)::float as avg_first_token_ms, coalesce(sum(input_tokens),0)::float8 as input_tokens, coalesce(sum(output_tokens),0)::float8 as output_tokens, coalesce(sum(cache_read_tokens),0)::float8 as cache_read_tokens, coalesce(sum(cache_creation_tokens),0)::float8 as cache_creation_tokens, coalesce(sum(total_cost),0)::float8 as total_cost from usage_logs where created_at >= (${lo}) and created_at <= (${up})`),
      pool.query(`select count(*)::int as count, coalesce(percentile_cont(0.95) within group (order by duration_ms),0)::float as p95_duration_ms from ops_error_logs where created_at >= (${lo}) and created_at <= (${up})`),
      pool.query(`with buckets as (select generate_series(date_trunc('second',(${lo})), (${up}), (${bk})) as bucket), success as (select date_bin((${bk}), created_at, (${lo})) as bucket, count(*)::int as count from usage_logs where created_at >= (${lo}) and created_at <= (${up}) group by 1), errors as (select date_bin((${bk}), created_at, (${lo})) as bucket, count(*)::int as count from ops_error_logs where created_at >= (${lo}) and created_at <= (${up}) group by 1) select b.bucket, coalesce(s.count,0)::int as success, coalesce(e.count,0)::int as error from buckets b left join success s on s.bucket = date_bin((${bk}), b.bucket, (${lo})) left join errors e on e.bucket = date_bin((${bk}), b.bucket, (${lo})) order by b.bucket`),
      pool.query(`select coalesce(error_owner,'unknown') as owner, count(*)::int as count from ops_error_logs where created_at >= (${lo}) and created_at <= (${up}) group by 1 order by count desc`),
      pool.query(`select coalesce(nullif(requested_model,''), nullif(model,''), 'unknown') as model, count(*)::int as count from usage_logs where created_at >= (${lo}) and created_at <= (${up}) group by 1 order by count desc limit 8`),
      pool.query(`select count(*)::int as count from usage_logs where created_at >= (${lo}) and created_at <= (${up}) and first_token_ms >= ${SLOW_FIRST_TOKEN_MS}`),
      pool.query(`select count(*)::int as count from ops_error_logs where created_at >= (${lo}) and created_at <= (${up}) and time_to_first_token_ms >= ${SLOW_FIRST_TOKEN_MS}`),
    ])
    return shapeSummary(sr.rows[0], er.rows[0], tr.rows, or_.rows, mr.rows, num(slr.rows[0]?.count) + num(eslr.rows[0]?.count), windowKey)
  }
  // ssh：一次查询返回组合 JSON
  const sql = `select json_build_object(
    'success',(select row_to_json(t) from (select count(*)::int as count, coalesce(avg(duration_ms),0)::float as avg_duration_ms, coalesce(percentile_cont(0.95) within group (order by duration_ms),0)::float as p95_duration_ms, coalesce(avg(first_token_ms),0)::float as avg_first_token_ms, coalesce(sum(input_tokens),0)::float8 as input_tokens, coalesce(sum(output_tokens),0)::float8 as output_tokens, coalesce(sum(cache_read_tokens),0)::float8 as cache_read_tokens, coalesce(sum(cache_creation_tokens),0)::float8 as cache_creation_tokens, coalesce(sum(total_cost),0)::float8 as total_cost from usage_logs where created_at >= (${lo}) and created_at <= (${up})) t),
    'error',(select row_to_json(t) from (select count(*)::int as count, coalesce(percentile_cont(0.95) within group (order by duration_ms),0)::float as p95_duration_ms from ops_error_logs where created_at >= (${lo}) and created_at <= (${up})) t),
    'trend',(select coalesce(json_agg(row_to_json(x) order by x.bucket),'[]'::json) from (with buckets as (select generate_series(date_trunc('second',(${lo})), (${up}), (${bk})) as bucket), success as (select date_bin((${bk}), created_at, (${lo})) as bucket, count(*)::int as count from usage_logs where created_at >= (${lo}) and created_at <= (${up}) group by 1), errors as (select date_bin((${bk}), created_at, (${lo})) as bucket, count(*)::int as count from ops_error_logs where created_at >= (${lo}) and created_at <= (${up}) group by 1) select b.bucket, coalesce(s.count,0)::int as success, coalesce(e.count,0)::int as error from buckets b left join success s on s.bucket = date_bin((${bk}), b.bucket, (${lo})) left join errors e on e.bucket = date_bin((${bk}), b.bucket, (${lo})) order by b.bucket) x),
    'owners',(select coalesce(json_agg(row_to_json(o)),'[]'::json) from (select coalesce(error_owner,'unknown') as owner, count(*)::int as count from ops_error_logs where created_at >= (${lo}) and created_at <= (${up}) group by 1 order by count desc) o),
    'models',(select coalesce(json_agg(row_to_json(m)),'[]'::json) from (select coalesce(nullif(requested_model,''), nullif(model,''), 'unknown') as model, count(*)::int as count from usage_logs where created_at >= (${lo}) and created_at <= (${up}) group by 1 order by count desc limit 8) m),
    'slow',(select (select count(*) from usage_logs where created_at >= (${lo}) and created_at <= (${up}) and first_token_ms >= ${SLOW_FIRST_TOKEN_MS}) + (select count(*) from ops_error_logs where created_at >= (${lo}) and created_at <= (${up}) and time_to_first_token_ms >= ${SLOW_FIRST_TOKEN_MS}))::int
  ) as r`
  const j = await runJson<any>(site!, sql) || {}
  return shapeSummary(j.success, j.error, j.trend, j.owners, j.models, j.slow, windowKey)
}

export async function requests(siteId: number, params: { window?: unknown; start?: unknown; end?: unknown; q?: string; model?: string; status?: string; slow?: boolean; page?: number; pageSize?: number }): Promise<any> {
  const site = getSite(siteId)
  const mode = obsMode(site)
  if (!mode) throw new Error('该站点未接入可观测（需配置 ssh_host + pg_container 提权通道）')
  // lo/up 为白名单/正则校验后的 SQL 片段，内联安全(见 resolveRange)。q/model 仍按下文参数化(local)/lit()(ssh)。
  const { lowerExpr: lo, upperExpr: up } = resolveRange(params)
  const q = String(params.q || '').trim()
  const model = String(params.model || '').trim()
  const status = String(params.status || 'all').trim()
  const includeSuccess = status === 'all' || status === 'success'
  const includeError = status === 'all' || status === 'error'
  // 慢请求页：服务端按与「慢请求」卡片一致的阈值过滤，并按耗时倒序，确保「搜得出」最慢的那些请求
  // （旧实现在前端从最近 80 条里 filter，慢请求若不在最近 80 条内就永远显示不出来 → 与统计数对不上）。
  const slow = params.slow === true
  // 慢请求按首字耗时倒序（最慢首字排最前），与「首字>=20s」口径一致。
  const orderBy = slow ? 'first_token_ms desc nulls last, created_at desc' : 'created_at desc'
  // 分页：pageSize<=0 取默认 50，上限 500；page 从 1 起，offset=(page-1)*pageSize。
  const pageSize = Math.min(500, Number(params.pageSize) > 0 ? Number(params.pageSize) : 50)
  const page = Math.max(1, Number(params.page) || 1)
  const offset = (page - 1) * pageSize

  if (mode === 'local') {
    const pool = localPool(false)
    const values: unknown[] = []
    const sw = [`u.created_at >= (${lo}) and u.created_at <= (${up})`]
    const ew = [`e.created_at >= (${lo}) and e.created_at <= (${up})`]
    if (q) { values.push(`%${q}%`); const x = values.length; sw.push(`(u.request_id ilike $${x} or coalesce(u.requested_model,u.model) ilike $${x} or coalesce(k.name,'') ilike $${x} or coalesce(us.email,'') ilike $${x} or coalesce(ac.name,'') ilike $${x} or coalesce(ac.credentials->>'email','') ilike $${x})`); ew.push(`(e.request_id ilike $${x} or e.client_request_id ilike $${x} or coalesce(e.error_message,'') ilike $${x} or coalesce(e.requested_model,e.model) ilike $${x} or coalesce(k.name,'') ilike $${x} or coalesce(us.email,'') ilike $${x} or coalesce(ac.name,'') ilike $${x} or coalesce(ac.credentials->>'email','') ilike $${x})`) }
    if (model && model !== 'all') { values.push(model); const x = values.length; sw.push(`coalesce(nullif(u.requested_model,''), u.model) = $${x}`); ew.push(`coalesce(nullif(e.requested_model,''), e.model) = $${x}`) }
    if (slow) { sw.push(slowSuccessCond); ew.push(slowErrorCond) }
    const parts: string[] = []
    if (includeSuccess) parts.push(successSel('u', sw.join(' and ')))
    if (includeError) parts.push(errorSel('e', ew.join(' and ')))
    if (!parts.length) return { rows: [], total: 0, page, pageSize }
    values.push(pageSize); const lx = values.length
    values.push(offset); const ox = values.length
    // count(*) over() 在 LIMIT/OFFSET 之前对整个匹配集求值，故每行携带「过滤后真实总数」，翻页时 total 仍准确。
    const result = await pool.query(`select *, count(*) over()::int as match_total from (${parts.join(' union all ')}) x order by ${orderBy} limit $${lx} offset $${ox}`, values)
    const total = num(result.rows[0]?.match_total)
    const rows = result.rows.map((r: any) => { const { match_total, ...rest } = r; void match_total; return { ...rest, owner: normalizeOwner(rest.owner, rest.kind) } })
    return { total, rows, page, pageSize }
  }
  // ssh：字面量内联 + json_agg
  const sw = [`u.created_at >= (${lo}) and u.created_at <= (${up})`]
  const ew = [`e.created_at >= (${lo}) and e.created_at <= (${up})`]
  if (q) { const L = lit(`%${q}%`); sw.push(`(u.request_id ilike ${L} or coalesce(u.requested_model,u.model) ilike ${L} or coalesce(k.name,'') ilike ${L} or coalesce(us.email,'') ilike ${L} or coalesce(ac.name,'') ilike ${L} or coalesce(ac.credentials->>'email','') ilike ${L})`); ew.push(`(e.request_id ilike ${L} or e.client_request_id ilike ${L} or coalesce(e.error_message,'') ilike ${L} or coalesce(e.requested_model,e.model) ilike ${L} or coalesce(k.name,'') ilike ${L} or coalesce(us.email,'') ilike ${L} or coalesce(ac.name,'') ilike ${L} or coalesce(ac.credentials->>'email','') ilike ${L})`) }
  if (model && model !== 'all') { const L = lit(model); sw.push(`coalesce(nullif(u.requested_model,''), u.model) = ${L}`); ew.push(`coalesce(nullif(e.requested_model,''), e.model) = ${L}`) }
  if (slow) { sw.push(slowSuccessCond); ew.push(slowErrorCond) }
  const parts: string[] = []
  if (includeSuccess) parts.push(successSel('u', sw.join(' and ')))
  if (includeError) parts.push(errorSel('e', ew.join(' and ')))
  if (!parts.length) return { rows: [], total: 0, page, pageSize }
  const rowOrder = slow ? 'x.first_token_ms desc nulls last, x.created_at desc' : 'x.created_at desc'
  // 同 local：count(*) over() 给过滤后真实总数；行内再剔除 match_total，rows 仅含展示字段。offset 内联整数。
  const inner = `select *, count(*) over()::int as match_total from (${parts.join(' union all ')}) y order by ${orderBy} limit ${pageSize} offset ${offset}`
  const sql = `select json_build_object('total', coalesce(max(x.match_total),0), 'rows', coalesce(jsonb_agg((to_jsonb(x) - 'match_total') order by ${rowOrder}),'[]'::jsonb)) as r from (${inner}) x`
  const res = (await runJson<{ total: number; rows: any[] }>(site!, sql)) || { total: 0, rows: [] }
  return { total: num(res.total), rows: (res.rows || []).map((r: any) => ({ ...r, owner: normalizeOwner(r.owner, r.kind) })), page, pageSize }
}

// 两条 union 子句(success/error)，本机与远程共用(where 子句由调用方拼)
function successSel(_alias: string, where: string): string {
  return `select 'success' as kind, u.created_at, u.request_id, '' as client_request_id, coalesce(us.email,'#'||u.user_id::text) as user_label, coalesce(k.name, left(k.key, 10), '#'||u.api_key_id::text) as key_label, coalesce(nullif(u.requested_model,''), u.model, 'unknown') as model, 200::int as status_code, 'normal' as owner, 'success' as phase, coalesce(u.duration_ms,0)::int as duration_ms, coalesce(u.first_token_ms,0)::int as first_token_ms, coalesce(u.input_tokens,0)::int as input_tokens, coalesce(u.output_tokens,0)::int as output_tokens, (coalesce(u.cache_read_tokens,0)+coalesce(u.cache_creation_tokens,0))::int as cache_tokens, coalesce(u.total_cost,0)::float8 as cost, coalesce(ac.name, ac.credentials->>'email', case when u.account_id is null then '-' else '#'||u.account_id::text end) as upstream_account, 'completed' as message from usage_logs u left join users us on us.id = u.user_id left join api_keys k on k.id = u.api_key_id left join accounts ac on ac.id = u.account_id where ${where}`
}
function errorSel(_alias: string, where: string): string {
  return `select 'error' as kind, e.created_at, e.request_id, e.client_request_id, coalesce(us.email,'#'||e.user_id::text) as user_label, coalesce(k.name, to_jsonb(e)->>'deleted_key_name', to_jsonb(e)->>'api_key_prefix', to_jsonb(e)->>'attempted_key_prefix', '#'||e.api_key_id::text) as key_label, coalesce(nullif(e.requested_model,''), e.model, 'unknown') as model, coalesce(e.status_code,0)::int as status_code, coalesce(e.error_owner,'unknown') as owner, coalesce(e.error_phase,'unknown') as phase, coalesce(e.duration_ms,0)::int as duration_ms, least(coalesce(e.time_to_first_token_ms,0), 2147483647)::int as first_token_ms, 0::int as input_tokens, 0::int as output_tokens, 0::int as cache_tokens, 0::float8 as cost, coalesce(ac.name, ac.credentials->>'email', case when e.account_id is null then '-' else '#'||e.account_id::text end) as upstream_account, coalesce(nullif(e.error_message,''), nullif(e.upstream_error_message,''), e.error_type, 'error') as message from ops_error_logs e left join users us on us.id = e.user_id left join api_keys k on k.id = e.api_key_id left join accounts ac on ac.id = e.account_id where ${where}`
}

export async function attention(siteId: number, opts: { window?: unknown; start?: unknown; end?: unknown } = {}): Promise<any> {
  const site = getSite(siteId)
  const mode = obsMode(site)
  if (!mode) throw new Error('该站点未接入可观测（需配置 ssh_host + pg_container 提权通道）')
  // 改用解析后的时间窗：custom 范围也能反映到「需要处理」面板（旧实现硬编码 interval '1 hour'）。lo/up 内联安全。
  const { lowerExpr: lo, upperExpr: up } = resolveRange(opts)
  const inner = `select coalesce(error_owner,'unknown') as owner, coalesce(error_phase,'unknown') as phase, coalesce(error_type,'unknown') as type, coalesce(nullif(requested_model,''), model, 'unknown') as model, count(*)::int as count, max(created_at) as last_seen, max(coalesce(error_message, upstream_error_message, error_type)) as message from ops_error_logs where created_at >= (${lo}) and created_at <= (${up}) group by 1,2,3,4 order by count desc limit 8`
  let rows: any[]
  if (mode === 'local') {
    rows = (await localPool(false).query(inner)).rows
  } else {
    rows = (await runJson<any[]>(site!, `select coalesce(json_agg(row_to_json(a) order by a.count desc),'[]'::json) from (${inner}) a`)) || []
  }
  return { rows: rows.map((r: any) => ({ ...r, owner: normalizeOwner(r.owner), label: ownerLabel(r.owner) })) }
}
