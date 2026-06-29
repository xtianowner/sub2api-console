/**
 * 对一个分组/选中账号做真实库存盘点（多站点）。**按账号类型分流**：
 * - oauth：用实时回源的 token 直连 ChatGPT codex 探活 + 真实额度(x-codex-*)。
 * - apikey/upstream(中转)：走 sub2api 自带测试端点(POST /admin/accounts/:id/test)实测上游，
 *   在 sub2api 内部用账号自己的 base_url+api_key+代理跑，不经 console 出口；429/401/403 从错误文本归类。
 * → 聚合 → 写快照+历史。
 */
import { db, nowCst, tx } from './db.js'
import { getClient, siteProbeModel } from './sites.js'
import { fetchTokens } from './sourceTokens.js'
import { probeOne, type ProbeResult } from './prober.js'

/** apikey 测试失败 → verdict 归类(429→限流 / 401·403·key→失效 / 其它→error)。 */
function classifyApikeyError(err: string): string {
  const e = (err || '').toLowerCase()
  if (/429|rate.?limit|too many|quota/.test(e)) return 'rate_limited'
  if (/401|403|unauthor|forbidden|invalid.*key|no auth|api[_ ]?key/.test(e)) return 'auth_fail'
  return 'error'
}

export interface InvState {
  running: boolean; done: number; total: number; current: number | null
  group: number | null; error: string | null
}
const _invBySite = new Map<number, InvState>()
export function getInv(siteId: number): InvState {
  if (!_invBySite.has(siteId)) _invBySite.set(siteId, { running: false, done: 0, total: 0, current: null, group: null, error: null })
  return _invBySite.get(siteId)!
}

async function pool<T>(items: T[], workers: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const runners = Array.from({ length: Math.max(1, workers) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]) }
  })
  await Promise.all(runners)
}

export async function runInventory(opts: {
  siteId: number; group: number; limit?: number; model?: string; maxWorkers?: number; onlyIds?: number[]
}): Promise<ProbeResult[]> {
  const { siteId, group } = opts
  const client = getClient(siteId)
  const model = opts.model || siteProbeModel(siteId)
  const inv = getInv(siteId)

  // 拉账号(含 type)以区分 oauth / apikey(中转)
  const accts = group
    ? ((await client.listAccounts({ group, pageSize: 1000 }))?.items || [])
    : await client.listAllAccounts()
  const typeById = new Map<number, string | undefined>(accts.map((a) => [a.id, a.type]))
  let ids: number[] = (opts.onlyIds && opts.onlyIds.length) ? opts.onlyIds.map(Number) : accts.map((a) => a.id)
  if (opts.limit) ids = ids.slice(0, opts.limit)

  const tokens = await fetchTokens(siteId)
  // 分流：oauth 且有 token → codex 直探；非 oauth(apikey/upstream/中转) → sub2api 测试端点；oauth 无 token/未知类型 → 跳过
  type Work = { id: number; kind: 'oauth' | 'apikey' }
  const work: Work[] = []
  for (const id of ids) {
    const ty = typeById.get(id)
    if (ty === 'oauth' && tokens[id]?.access_token) work.push({ id, kind: 'oauth' })
    else if (ty && ty !== 'oauth') work.push({ id, kind: 'apikey' })
  }
  inv.total = work.length
  inv.done = 0

  // 批次 id（仅分组盘点写聚合快照）
  let batchId: number | null = null
  if (group && !(opts.onlyIds && opts.onlyIds.length)) {
    const b = db().prepare('SELECT id FROM batches WHERE sub2_group_id=? AND site_id=?').get(group, siteId) as { id: number } | undefined
    batchId = b ? b.id : null
  }

  const transient = (id: number, email: string | null, e: unknown): ProbeResult => ({
    sub2_account_id: id, cpa_email: email, verdict: 'transient', plan_type: null, is_deactivated: null,
    used_5h_percent: null, used_7d_percent: null, primary_reset_after_seconds: null, primary_reset_at: null,
    secondary_reset_at: null, primary_window_minutes: null, check_status: null, probe_status: String(e).slice(0, 60),
  })

  const results: ProbeResult[] = []
  await pool(work, opts.maxWorkers || 6, async (w) => {
    let r: ProbeResult
    if (w.kind === 'oauth') {
      try { r = await probeOne(tokens[w.id], model) } catch (e) { r = transient(w.id, tokens[w.id]?.cpa_email || null, e) }
    } else {
      // apikey/中转：sub2api 测试端点实测上游
      try {
        const t = await client.testAccount(w.id)
        r = {
          sub2_account_id: w.id, cpa_email: null, verdict: t.ok ? 'alive' : classifyApikeyError(t.error),
          plan_type: null, is_deactivated: null, used_5h_percent: null, used_7d_percent: null,
          primary_reset_after_seconds: null, primary_reset_at: null, secondary_reset_at: null,
          primary_window_minutes: null, check_status: null, probe_status: t.ok ? 200 : t.error.slice(0, 60),
        }
      } catch (e) { r = transient(w.id, null, e) }
    }
    results.push(r)
    inv.done++
    inv.current = w.id
  })

  // 聚合
  const vc: Record<string, number> = {}
  const pc: Record<string, number> = {}
  for (const r of results) {
    const v = r.verdict || 'pending'; vc[v] = (vc[v] || 0) + 1
    if (r.plan_type) pc[r.plan_type] = (pc[r.plan_type] || 0) + 1
  }

  const d = db()
  tx(() => {
    if (batchId != null) {
      d.prepare(`INSERT INTO inventory_snapshots(site_id,batch_id,taken_at,total,alive,rate_limited,dead,no_codex_perm,tier_free,tier_plus,tier_pro,raw_json)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        siteId, batchId, nowCst(), results.length, vc.alive || 0, vc.rate_limited || 0,
        vc.dead || 0, vc.no_codex_perm || 0, pc.free || 0, pc.plus || 0, pc.pro || 0,
        JSON.stringify(results))
    }
    const ins = d.prepare(`INSERT INTO probe_results(site_id,sub2_account_id,probed_at,verdict,codex_5h_pct,codex_7d_pct,plan_type,is_deactivated,http_status,note,primary_reset_at,secondary_reset_at)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    for (const r of results) {
      // 列序：codex_5h_pct, codex_7d_pct —— 必须分别写 5h / 7d，别再写反。
      ins.run(siteId, r.sub2_account_id, nowCst(), r.verdict, r.used_5h_percent, r.used_7d_percent,
        r.plan_type, r.is_deactivated ? 1 : 0, typeof r.probe_status === 'number' ? r.probe_status : null,
        null, r.primary_reset_at, r.secondary_reset_at)
    }
  })
  return results
}

const _invStartLock = { busy: false }
export function startInventory(body: any): { started: boolean; msg?: string } {
  const siteId = Number(body.site_id || 1)
  const group = Number(body.group || 0)
  const limit = Number(body.limit || 0)
  const maxWorkers = Math.min(32, Math.max(1, Number(body.max_workers || 6)))
  const onlyIds = (body.account_ids || []).map(Number).filter(Boolean)
  const inv = getInv(siteId)
  if (inv.running || _invStartLock.busy) return { started: false, msg: '该站点已有盘点在进行中' }
  inv.running = true; inv.done = 0; inv.total = 0; inv.current = null; inv.group = group; inv.error = null
  runInventory({ siteId, group, limit, maxWorkers, onlyIds: onlyIds.length ? onlyIds : undefined })
    .catch((e) => { inv.error = e instanceof Error ? e.message : String(e) })
    .finally(() => { inv.running = false })
  return { started: true }
}
