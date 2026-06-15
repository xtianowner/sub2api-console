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
function intervalFor(value: unknown): string { return windows[String(value || '15m') as WindowKey] || windows['15m'] }
function num(v: unknown): number { if (v == null) return 0; const n = Number(v); return Number.isFinite(n) ? n : 0 }
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
    },
    trend: trend || [],
    owners: (owners || []).map((r: any) => ({ ...r, label: ownerLabel(r.owner) })),
    models: models || [],
  }
}

export async function summary(siteId: number, windowKey: unknown): Promise<any> {
  const site = getSite(siteId)
  const mode = obsMode(site)
  if (!mode) throw new Error('该站点未接入可观测（需配置 ssh_host + pg_container 提权通道）')
  const interval = intervalFor(windowKey)
  if (mode === 'local') {
    const pool = localPool(false)
    const [sr, er, tr, or_, mr, slr] = await Promise.all([
      pool.query(`select count(*)::int as count, coalesce(avg(duration_ms),0)::float as avg_duration_ms, coalesce(percentile_cont(0.95) within group (order by duration_ms),0)::float as p95_duration_ms, coalesce(avg(first_token_ms),0)::float as avg_first_token_ms from usage_logs where created_at >= now() - $1::interval`, [interval]),
      pool.query(`select count(*)::int as count, coalesce(percentile_cont(0.95) within group (order by duration_ms),0)::float as p95_duration_ms from ops_error_logs where created_at >= now() - $1::interval`, [interval]),
      pool.query(`with buckets as (select generate_series(date_trunc('minute', now() - $1::interval), date_trunc('minute', now()), ($1::interval / 8)) as bucket), success as (select date_bin(($1::interval / 8), created_at, timestamp '2000-01-01') as bucket, count(*)::int as count from usage_logs where created_at >= now() - $1::interval group by 1), errors as (select date_bin(($1::interval / 8), created_at, timestamp '2000-01-01') as bucket, count(*)::int as count from ops_error_logs where created_at >= now() - $1::interval group by 1) select b.bucket, coalesce(s.count,0)::int as success, coalesce(e.count,0)::int as error from buckets b left join success s on s.bucket = date_bin(($1::interval / 8), b.bucket, timestamp '2000-01-01') left join errors e on e.bucket = date_bin(($1::interval / 8), b.bucket, timestamp '2000-01-01') order by b.bucket`, [interval]),
      pool.query(`select coalesce(error_owner,'unknown') as owner, count(*)::int as count from ops_error_logs where created_at >= now() - $1::interval group by 1 order by count desc`, [interval]),
      pool.query(`select coalesce(nullif(requested_model,''), nullif(model,''), 'unknown') as model, count(*)::int as count from usage_logs where created_at >= now() - $1::interval group by 1 order by count desc limit 8`, [interval]),
      pool.query(`select count(*)::int as count from usage_logs where created_at >= now() - $1::interval and (duration_ms >= 30000 or first_token_ms >= 10000)`, [interval]),
    ])
    return shapeSummary(sr.rows[0], er.rows[0], tr.rows, or_.rows, mr.rows, slr.rows[0]?.count, windowKey)
  }
  // ssh：一次查询返回组合 JSON
  const i = `interval ${lit(interval)}`
  const sql = `select json_build_object(
    'success',(select row_to_json(t) from (select count(*)::int as count, coalesce(avg(duration_ms),0)::float as avg_duration_ms, coalesce(percentile_cont(0.95) within group (order by duration_ms),0)::float as p95_duration_ms, coalesce(avg(first_token_ms),0)::float as avg_first_token_ms from usage_logs where created_at >= now() - ${i}) t),
    'error',(select row_to_json(t) from (select count(*)::int as count, coalesce(percentile_cont(0.95) within group (order by duration_ms),0)::float as p95_duration_ms from ops_error_logs where created_at >= now() - ${i}) t),
    'trend',(select coalesce(json_agg(row_to_json(x) order by x.bucket),'[]'::json) from (with buckets as (select generate_series(date_trunc('minute', now() - ${i}), date_trunc('minute', now()), (${i} / 8)) as bucket), success as (select date_bin((${i} / 8), created_at, timestamp '2000-01-01') as bucket, count(*)::int as count from usage_logs where created_at >= now() - ${i} group by 1), errors as (select date_bin((${i} / 8), created_at, timestamp '2000-01-01') as bucket, count(*)::int as count from ops_error_logs where created_at >= now() - ${i} group by 1) select b.bucket, coalesce(s.count,0)::int as success, coalesce(e.count,0)::int as error from buckets b left join success s on s.bucket = date_bin((${i} / 8), b.bucket, timestamp '2000-01-01') left join errors e on e.bucket = date_bin((${i} / 8), b.bucket, timestamp '2000-01-01') order by b.bucket) x),
    'owners',(select coalesce(json_agg(row_to_json(o)),'[]'::json) from (select coalesce(error_owner,'unknown') as owner, count(*)::int as count from ops_error_logs where created_at >= now() - ${i} group by 1 order by count desc) o),
    'models',(select coalesce(json_agg(row_to_json(m)),'[]'::json) from (select coalesce(nullif(requested_model,''), nullif(model,''), 'unknown') as model, count(*)::int as count from usage_logs where created_at >= now() - ${i} group by 1 order by count desc limit 8) m),
    'slow',(select count(*)::int from usage_logs where created_at >= now() - ${i} and (duration_ms >= 30000 or first_token_ms >= 10000))
  ) as r`
  const j = await runJson<any>(site!, sql) || {}
  return shapeSummary(j.success, j.error, j.trend, j.owners, j.models, j.slow, windowKey)
}

export async function requests(siteId: number, params: { window?: unknown; q?: string; model?: string; status?: string }): Promise<any> {
  const site = getSite(siteId)
  const mode = obsMode(site)
  if (!mode) throw new Error('该站点未接入可观测（需配置 ssh_host + pg_container 提权通道）')
  const interval = intervalFor(params.window || '1h')
  const q = String(params.q || '').trim()
  const model = String(params.model || '').trim()
  const status = String(params.status || 'all').trim()
  const includeSuccess = status === 'all' || status === 'success'
  const includeError = status === 'all' || status === 'error'

  if (mode === 'local') {
    const pool = localPool(false)
    const values: unknown[] = [interval]
    const sw = ['u.created_at >= now() - $1::interval']
    const ew = ['e.created_at >= now() - $1::interval']
    if (q) { values.push(`%${q}%`); const x = values.length; sw.push(`(u.request_id ilike $${x} or coalesce(u.requested_model,u.model) ilike $${x} or coalesce(k.name,'') ilike $${x} or coalesce(us.email,'') ilike $${x})`); ew.push(`(e.request_id ilike $${x} or e.client_request_id ilike $${x} or coalesce(e.error_message,'') ilike $${x} or coalesce(e.requested_model,e.model) ilike $${x} or coalesce(k.name,'') ilike $${x} or coalesce(us.email,'') ilike $${x})`) }
    if (model && model !== 'all') { values.push(model); const x = values.length; sw.push(`coalesce(nullif(u.requested_model,''), u.model) = $${x}`); ew.push(`coalesce(nullif(e.requested_model,''), e.model) = $${x}`) }
    values.push(80); const lx = values.length
    const parts: string[] = []
    if (includeSuccess) parts.push(successSel('u', sw.join(' and ')))
    if (includeError) parts.push(errorSel('e', ew.join(' and ')))
    if (!parts.length) return { rows: [] }
    const result = await pool.query(`select * from (${parts.join(' union all ')}) x order by created_at desc limit $${lx}`, values)
    return { rows: result.rows.map((r: any) => ({ ...r, owner: normalizeOwner(r.owner, r.kind) })) }
  }
  // ssh：字面量内联 + json_agg
  const i = `interval ${lit(interval)}`
  const sw = [`u.created_at >= now() - ${i}`]
  const ew = [`e.created_at >= now() - ${i}`]
  if (q) { const L = lit(`%${q}%`); sw.push(`(u.request_id ilike ${L} or coalesce(u.requested_model,u.model) ilike ${L} or coalesce(k.name,'') ilike ${L} or coalesce(us.email,'') ilike ${L})`); ew.push(`(e.request_id ilike ${L} or e.client_request_id ilike ${L} or coalesce(e.error_message,'') ilike ${L} or coalesce(e.requested_model,e.model) ilike ${L} or coalesce(k.name,'') ilike ${L} or coalesce(us.email,'') ilike ${L})`) }
  if (model && model !== 'all') { const L = lit(model); sw.push(`coalesce(nullif(u.requested_model,''), u.model) = ${L}`); ew.push(`coalesce(nullif(e.requested_model,''), e.model) = ${L}`) }
  const parts: string[] = []
  if (includeSuccess) parts.push(successSel('u', sw.join(' and ')))
  if (includeError) parts.push(errorSel('e', ew.join(' and ')))
  if (!parts.length) return { rows: [] }
  const sql = `select coalesce(json_agg(row_to_json(x) order by x.created_at desc),'[]'::json) from (select * from (${parts.join(' union all ')}) y order by created_at desc limit 80) x`
  const rows = (await runJson<any[]>(site!, sql)) || []
  return { rows: rows.map((r: any) => ({ ...r, owner: normalizeOwner(r.owner, r.kind) })) }
}

// 两条 union 子句(success/error)，本机与远程共用(where 子句由调用方拼)
function successSel(_alias: string, where: string): string {
  return `select 'success' as kind, u.created_at, u.request_id, '' as client_request_id, coalesce(us.email,'#'||u.user_id::text) as user_label, coalesce(k.name, left(k.key, 10), '#'||u.api_key_id::text) as key_label, coalesce(nullif(u.requested_model,''), u.model, 'unknown') as model, 200::int as status_code, 'normal' as owner, 'success' as phase, coalesce(u.duration_ms,0)::int as duration_ms, coalesce(u.first_token_ms,0)::int as first_token_ms, 'completed' as message from usage_logs u left join users us on us.id = u.user_id left join api_keys k on k.id = u.api_key_id where ${where}`
}
function errorSel(_alias: string, where: string): string {
  return `select 'error' as kind, e.created_at, e.request_id, e.client_request_id, coalesce(us.email,'#'||e.user_id::text) as user_label, coalesce(k.name, e.deleted_key_name, e.api_key_prefix, e.attempted_key_prefix, '#'||e.api_key_id::text) as key_label, coalesce(nullif(e.requested_model,''), e.model, 'unknown') as model, coalesce(e.status_code,0)::int as status_code, coalesce(e.error_owner,'unknown') as owner, coalesce(e.error_phase,'unknown') as phase, coalesce(e.duration_ms,0)::int as duration_ms, coalesce(e.time_to_first_token_ms,0)::int as first_token_ms, coalesce(nullif(e.error_message,''), nullif(e.upstream_error_message,''), e.error_type, 'error') as message from ops_error_logs e left join users us on us.id = e.user_id left join api_keys k on k.id = e.api_key_id where ${where}`
}

export async function attention(siteId: number): Promise<any> {
  const site = getSite(siteId)
  const mode = obsMode(site)
  if (!mode) throw new Error('该站点未接入可观测（需配置 ssh_host + pg_container 提权通道）')
  const inner = `select coalesce(error_owner,'unknown') as owner, coalesce(error_phase,'unknown') as phase, coalesce(error_type,'unknown') as type, coalesce(nullif(requested_model,''), model, 'unknown') as model, count(*)::int as count, max(created_at) as last_seen, max(coalesce(error_message, upstream_error_message, error_type)) as message from ops_error_logs where created_at >= now() - interval '1 hour' group by 1,2,3,4 order by count desc limit 8`
  let rows: any[]
  if (mode === 'local') {
    rows = (await localPool(false).query(inner)).rows
  } else {
    rows = (await runJson<any[]>(site!, `select coalesce(json_agg(row_to_json(a) order by a.count desc),'[]'::json) from (${inner}) a`)) || []
  }
  return { rows: rows.map((r: any) => ({ ...r, owner: normalizeOwner(r.owner), label: ownerLabel(r.owner) })) }
}
