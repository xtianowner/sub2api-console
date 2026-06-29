/**
 * 账号池读取 + 批量编辑 + 批次/回收站。移植自 web_server.py 的 _merge_accounts/_pool_overview/_batches/_bulk/...
 * §10：分组与成员一律实时取自 sub2api(list_groups/list_accounts)，本地只叠加 probe 判活(派生)与批次名(元数据)。
 */
import { db, nowCst } from './db.js'
import { getClient, getSiteAdminLogin } from './sites.js'
import { fetchTokens } from './sourceTokens.js'
import type { AdminAccount } from './adminApi.js'

function expTs(v: unknown): number | null {
  if (!v) return null
  if (typeof v === 'number') return v
  const s = String(v)
  if (/^\d+$/.test(s)) return Number(s)
  const t = Date.parse(s.replace('Z', '+00:00'))
  return Number.isFinite(t) ? t / 1000 : null
}
function expWithin(v: unknown, nowSec: number, days: number): boolean {
  const ts = expTs(v)
  return !!(ts && ts - nowSec >= 0 && ts - nowSec <= days * 86400)
}
function ageHours(probedAt: string | null): number | null {
  if (!probedAt) return null
  const t = Date.parse(probedAt.replace(' ', 'T') + '+08:00')
  if (!Number.isFinite(t)) return null
  return (Date.now() - t) / 3600000
}

interface ProbeRow { sub2_account_id: number; verdict: string | null; codex_5h_pct: number | null; codex_7d_pct: number | null; probed_at: string | null; primary_reset_at: number | null; secondary_reset_at: number | null }
function latestProbes(siteId: number): Map<number, ProbeRow> {
  const rows = db().prepare(
    `SELECT * FROM probe_results WHERE id IN (SELECT MAX(id) FROM probe_results WHERE site_id=? GROUP BY sub2_account_id)`,
  ).all(siteId) as unknown as ProbeRow[]
  const m = new Map<number, ProbeRow>()
  for (const r of rows) m.set(r.sub2_account_id, r)
  return m
}

/** 限流并行：把原本串行的 N 次 admin-REST 回源压到 ceil(N/limit) 波，墙钟大降而不改语义/顺序。 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  const lanes = Math.max(1, Math.min(limit, items.length || 1))
  await Promise.all(Array.from({ length: lanes }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx) }
  }))
  return out
}

export function mergeAccounts(siteId: number, accts: AdminAccount[]): any[] {
  const probes = latestProbes(siteId)
  return accts.map((a) => {
    const ex = (a.extra || {}) as any
    const cred = (a.credentials || {}) as any
    const pr = probes.get(a.id)
    let v = pr?.verdict ?? null
    if (v === 'active') v = null // 旧 fallback 误把 sub2 status 当 verdict → 视为未盘点
    const u5 = pr?.codex_5h_pct   // 5h 窗口
    const u7 = pr?.codex_7d_pct   // 7d(周) 窗口
    return {
      id: a.id, name: a.name,
      email: cred.email || a.name,
      type: a.type, platform: a.platform,
      has_token: a.type === 'oauth',
      status: a.status, schedulable: a.schedulable, verdict: v,
      priority: a.priority, concurrency: a.concurrency,
      used_5h: u5 != null ? u5 : ex.codex_5h_used_percent,
      used_7d: u7 != null ? u7 : ex.codex_7d_used_percent,
      usage_updated: pr?.probed_at || ex.codex_usage_updated_at,
      last_probe_at: pr?.probed_at || null,
      expires_at: a.expires_at || cred.expires_at,
      proxy_id: a.proxy_id,
      primary_reset_at: pr?.primary_reset_at ?? null,
      secondary_reset_at: pr?.secondary_reset_at ?? null,
      rate_limit_reset_at: a.rate_limit_reset_at,
    }
  })
}

/**
 * 分组管理（从分组视角增删成员）。MemberAccount 形如
 * { id, name, email, type, status, verdict, group_ids[] }——group_ids 直接取自账号体 a.group_ids（sub2api 列表已填充）。
 */
export async function accountsWithGroups(siteId: number): Promise<{ groups: any[]; accounts: any[] }> {
  const client = getClient(siteId)
  let groups: any[] = []
  try { const gl = await client.listGroups(1, 300); groups = Array.isArray(gl) ? gl : (gl?.items || []) } catch { groups = [] }
  const raw = await client.listAllAccounts({})
  const gidByA = new Map<number, number[]>(raw.map((a) => [a.id, (a.group_ids as number[]) || []]))
  // 复用 mergeAccounts 拿完整账号字段（priority/并发/用量/判活/代理等），再附 group_ids，
  // 让分组管理页与账号管理同等可编辑（不止看成员，还能改优先级/并发/代理/盘点/清理/删除）。
  const accounts = mergeAccounts(siteId, raw).map((r) => ({ ...r, group_ids: gidByA.get(r.id) || [] }))
  return { groups, accounts }
}

/**
 * 分组密钥管理（从分组视角 列/建/删「使用用」API Key）。
 * sub2api 的 key 一律用户态管理（admin-api-key 不可），故用站点存的 sub2api 管理员登录换 JWT 操作；
 * 列出的是「该管理员账号名下、绑定本组」的 key（上游无跨用户 admin 列 key 端点）。
 * key 与分组 1:1/1:0（group_id 单值）；明文仅创建时返回一次，不落库。
 */
export async function groupKeys(siteId: number, groupId: number): Promise<{ keys: any[]; total: number; admin_login: boolean }> {
  const { email, password } = getSiteAdminLogin(siteId)
  if (!email || !password) return { keys: [], total: 0, admin_login: false }
  const { items, total } = await getClient(siteId).listGroupKeys(email, password, groupId)
  return { keys: items, total, admin_login: true }
}

export async function createGroupKey(siteId: number, groupId: number, name?: string): Promise<{ id: number; key: string }> {
  if (!groupId) throw new Error('未选择分组')
  const { email, password } = getSiteAdminLogin(siteId)
  if (!email || !password) throw new Error('未配置该站点的 sub2api 管理员登录凭据，无法创建密钥（在「站点」设置里填写管理员邮箱+密码）')
  const nm = (name || '').trim() || `group-${groupId}-key`
  return getClient(siteId).createUsageKey(email, password, { name: nm, group_id: groupId })
}

export async function deleteGroupKey(siteId: number, keyId: number): Promise<{ deleted: boolean }> {
  if (!keyId) throw new Error('缺少 key id')
  const { email, password } = getSiteAdminLogin(siteId)
  if (!email || !password) throw new Error('未配置该站点的 sub2api 管理员登录凭据，无法删除密钥')
  await getClient(siteId).deleteUsageKey(email, password, keyId)
  return { deleted: true }
}

/** 持久化分组顺序：按传入的有序 id 列表，写每个分组的 sort_order（下标即顺序，越小越靠前）。 */
export async function setGroupOrder(siteId: number, orderedIds: number[]): Promise<any> {
  const updates = orderedIds.map((id, i) => ({ id: Number(id), sort_order: i }))
  if (!updates.length) return { ok: true, updated: 0 }
  await getClient(siteId).updateGroupSortOrder(updates)
  return { ok: true, updated: updates.length }
}

/**
 * 把若干账号「加入」目标分组。增量语义：sub2api 写 group_ids 是 REPLACE（删全部+重建），
 * 故必须读各号现有分组集合 → 并入 {groupId} → 整套回写，避免误清该号在其它分组的归属。
 */
export async function addAccountsToGroup(siteId: number, groupId: number, accountIds: number[]): Promise<{ added: number; failed: number; errors: string[] }> {
  const client = getClient(siteId)
  // 一次性快照全量分组归属，避免逐号 GET（注意：并发外部改动会令快照变陈旧，本批以快照为准）。
  const raw = await client.listAllAccounts({})
  const cur = new Map<number, number[]>()
  for (const a of raw) cur.set(a.id, (a.group_ids as number[]) || [])
  let added = 0, failed = 0; const errors: string[] = []
  await mapLimit(accountIds, 6, async (id) => {
    const set = cur.get(id) || []
    if (set.includes(groupId)) return // 已是成员 → 跳过
    const newSet = Array.from(new Set([...set, groupId]))
    try { await client.updateAccount(id, { group_ids: newSet }); added++ }
    catch (e) { failed++; errors.push(`#${id}: ${String(e instanceof Error ? e.message : e).slice(0, 60)}`) }
  })
  return { added, failed, errors: errors.slice(0, 20) }
}

/**
 * 把若干账号「移出」目标分组。同样增量：读现有集合 → 减去 {groupId} → 整套回写（REPLACE 安全）。
 * 移出最后一个分组（→ []）允许。
 */
export async function removeAccountsFromGroup(siteId: number, groupId: number, accountIds: number[]): Promise<{ removed: number; failed: number; errors: string[] }> {
  const client = getClient(siteId)
  const raw = await client.listAllAccounts({})
  const cur = new Map<number, number[]>()
  for (const a of raw) cur.set(a.id, (a.group_ids as number[]) || [])
  let removed = 0, failed = 0; const errors: string[] = []
  await mapLimit(accountIds, 6, async (id) => {
    const set = cur.get(id) || []
    const newSet = set.filter((g) => g !== groupId)
    if (newSet.length === set.length) return // 本就不在该组 → 跳过
    try { await client.updateAccount(id, { group_ids: newSet }); removed++ }
    catch (e) { failed++; errors.push(`#${id}: ${String(e instanceof Error ? e.message : e).slice(0, 60)}`) }
  })
  return { removed, failed, errors: errors.slice(0, 20) }
}

export async function groupAccounts(siteId: number, group: number): Promise<any[]> {
  const d = await getClient(siteId).listAccounts({ group, pageSize: 1000 })
  return mergeAccounts(siteId, d?.items || [])
}
export async function allAccounts(siteId: number, status?: string, search?: string): Promise<any[]> {
  const accts = await getClient(siteId).listAllAccounts({ status, search })
  return mergeAccounts(siteId, accts)
}

export async function poolOverview(siteId: number): Promise<any> {
  const rows = await allAccounts(siteId)
  const vc: Record<string, number> = {}
  const sc: Record<string, number> = {}
  for (const r of rows) {
    const k = r.verdict || 'pending'; vc[k] = (vc[k] || 0) + 1
    const s = r.status || '?'; sc[s] = (sc[s] || 0) + 1
  }
  const nowSec = Date.now() / 1000
  const expiring = rows.filter((r) => expWithin(r.expires_at, nowSec, 7)).length
  const client = getClient(siteId)
  let groups: any[] = []
  try { const gl = await client.listGroups(1, 300); groups = Array.isArray(gl) ? gl : (gl?.items || []) } catch { groups = [] }
  const bmeta = new Map<number, { batch_id: number; name: string }>()
  for (const b of db().prepare('SELECT id,name,sub2_group_id FROM batches WHERE site_id=?').all(siteId) as any[]) {
    if (b.sub2_group_id != null && !bmeta.has(b.sub2_group_id)) bmeta.set(b.sub2_group_id, { batch_id: b.id, name: b.name })
  }
  const vmap = latestProbes(siteId)
  // 每个分组要列成员算 alive/dead（账号体不带 group 字段，无法从已拉全量里就地分组），
  // 故仍按组回源，但从串行 await 改为限流并行（cap 6），墙钟从 N×RTT 降到 ⌈N/6⌉×RTT。
  const validGroups = groups.filter((g) => g && typeof g === 'object')
  const bygrp = (await mapLimit(validGroups, 6, async (g) => {
    const gid = g.id; const gname = g.name
    let members: AdminAccount[] = []
    try { members = (await client.listAccounts({ group: gid, pageSize: 1000 }))?.items || [] } catch { members = [] }
    const mids = members.map((m) => m.id)
    if (!mids.length && !bmeta.has(gid)) return null
    const meta = bmeta.get(gid)
    const alive = mids.filter((id) => vmap.get(id)?.verdict === 'alive').length
    const dead = mids.filter((id) => { const v = vmap.get(id)?.verdict; return v === 'dead' || v === 'auth_fail' }).length
    return { batch_id: meta?.batch_id, name: meta?.name || gname, group: gid, total: mids.length, alive, dead }
  })).filter(Boolean)
  return { total: rows.length, by_verdict: vc, by_status: sc, expiring_7d: expiring, rate_limited: vc.rate_limited || 0, by_group: bygrp }
}

export async function batches(siteId: number): Promise<any[]> {
  const rows = db().prepare('SELECT * FROM batches WHERE site_id=? ORDER BY id DESC').all(siteId) as any[]
  let liveGroups: Set<number> | null = null
  try {
    const data = await getClient(siteId).listGroups(1, 300)
    const glist = Array.isArray(data) ? data : (data?.items || [])
    liveGroups = new Set(glist.map((g: any) => g.id))
  } catch { liveGroups = null }
  const client = getClient(siteId)
  // 并行回源各批次账号数；只取 total（pageSize:1），不再把整页 1000 行拉回来仅为 .length。
  await mapLimit(rows, 6, async (b) => {
    if (b.sub2_group_id != null) {
      try {
        const d = await client.listAccounts({ group: b.sub2_group_id, pageSize: 1 })
        const total = Array.isArray(d) ? d.length : d?.total
        // total 缺失时退回全量统计兜底（极少见，保证数字准确）。
        b.account_count = total != null ? total : ((await client.listAccounts({ group: b.sub2_group_id, pageSize: 1000 }))?.items || []).length
      } catch { b.account_count = null }
    } else b.account_count = 0
    b.orphaned = !!(liveGroups != null && !liveGroups.has(b.sub2_group_id))
    const snap = db().prepare('SELECT * FROM inventory_snapshots WHERE batch_id=? AND site_id=? ORDER BY id DESC LIMIT 1').get(b.id, siteId)
    b.last_snapshot = snap || null
  })
  return liveGroups != null ? rows.filter((b) => !b.orphaned) : rows
}

export function deadAccounts(siteId: number, verdicts: string[], staleHours: number): any {
  const latest = new Map<number, any>()
  for (const r of db().prepare('SELECT sub2_account_id,verdict,probed_at FROM probe_results WHERE site_id=? ORDER BY id DESC').all(siteId) as any[]) {
    if (!latest.has(r.sub2_account_id)) latest.set(r.sub2_account_id, r)
  }
  const items: any[] = []; let stale = 0; const byV: Record<string, number> = {}
  for (const [aid, pr] of latest) {
    const v = pr.verdict
    if (!verdicts.includes(v)) continue
    const age = ageHours(pr.probed_at)
    const isStale = !!(age != null && staleHours && age > staleHours)
    if (isStale) stale++
    byV[v] = (byV[v] || 0) + 1
    items.push({ id: aid, verdict: v, last_probe_at: pr.probed_at, age_hours: age != null ? Math.round(age * 10) / 10 : null, stale: isStale })
  }
  items.sort((a, b) => (Number(a.stale) - Number(b.stale)) || (a.id - b.id))
  return { accounts: items, total: items.length, stale_count: stale, by_verdict: byV }
}

export function recycleList(siteId: number): any[] {
  return db().prepare(
    `SELECT id,sub2_account_id,cpa_email,verdict,deleted_at,reason,
            (refresh_token IS NOT NULL AND length(refresh_token)>0) AS can_restore
     FROM recycle WHERE site_id=? ORDER BY id DESC LIMIT 500`,
  ).all(siteId)
}

export async function restoreRecycle(body: any): Promise<any> {
  const siteId = Number(body.site_id || 1)
  const rid = Number(body.recycle_id || 0)
  const r = db().prepare('SELECT * FROM recycle WHERE id=? AND site_id=?').get(rid, siteId) as any
  if (!r) return { error: '回收记录不存在' }
  if (!r.access_token) return { error: '无 token，无法重新导入' }
  const { importFromObjects } = await import('./importer.js')
  const res = await importFromObjects([[r.cpa_email || 'restore', { access_token: r.access_token, refresh_token: r.refresh_token, id_token: r.id_token, email: r.cpa_email }]], { siteId, batchName: 'recycle-restore', priority: 50, concurrency: 3 })
  if (res) db().prepare('DELETE FROM recycle WHERE id=? AND site_id=?').run(rid, siteId)
  return { restored: !!res, result: res?.result || null }
}

/** 批量编辑：op=priority/concurrency/proxy/group/clear-error/clear-rate-limit/delete。 */
export async function bulk(body: any): Promise<any> {
  const siteId = Number(body.site_id || 1)
  const ids: number[] = (body.account_ids || []).map(Number)
  if (!ids.length) return { error: '未选择账号' }
  const c = getClient(siteId)
  const op = body.op
  if (op === 'delete') {
    const tokens = await fetchTokens(siteId)
    const vmap = latestProbes(siteId)
    let ok = 0, fail = 0; const errs: string[] = []
    const d = db()
    const insRecycle = d.prepare(`INSERT INTO recycle(site_id,sub2_account_id,cpa_email,name,access_token,refresh_token,id_token,verdict,deleted_at,reason)
                                  VALUES(?,?,?,?,?,?,?,?,?,?)`)
    const delProbe = d.prepare('DELETE FROM probe_results WHERE sub2_account_id=? AND site_id=?')
    for (const aid of ids) {
      try { await c.deleteAccount(aid) } catch (e) { fail++; errs.push(`#${aid}: ${String(e instanceof Error ? e.message : e).slice(0, 60)}`); continue }
      const t = tokens[aid]
      insRecycle.run(siteId, aid, t?.cpa_email || null, null, t?.access_token || null, null, t?.id_token || null, vmap.get(aid)?.verdict || null, nowCst(), 'bulk-delete')
      delProbe.run(aid, siteId)
      ok++
    }
    return { deleted: ok, failed: fail, errors: errs.slice(0, 20) }
  }
  if (op === 'clear-error') return c.req('POST', '/admin/accounts/batch-clear-error', { account_ids: ids })
  if (op === 'clear-rate-limit') {
    let ok = 0, fail = 0; const errs: string[] = []
    for (const aid of ids) { try { await c.clearRateLimit(aid); ok++ } catch (e) { fail++; errs.push(`#${aid}: ${String(e instanceof Error ? e.message : e).slice(0, 60)}`) } }
    return { cleared: ok, failed: fail, errors: errs.slice(0, 20) }
  }
  const v = body.value
  let fields: Record<string, unknown>
  if (op === 'priority') fields = { priority: Number(v) }
  else if (op === 'concurrency') fields = { concurrency: Number(v) }
  else if (op === 'proxy') fields = { proxy_id: v ? Number(v) : null }
  else if (op === 'group') fields = { group_ids: v ? [Number(v)] : [] }
  else return { error: '未知操作' }
  return c.bulkUpdate(ids, fields)
}

export async function deleteGroup(siteId: number, gid: number, remote = true): Promise<any> {
  gid = Number(gid)
  const d = db()
  const brow = d.prepare('SELECT id,name FROM batches WHERE sub2_group_id=? AND site_id=?').get(gid, siteId) as any
  const localBatchId = brow?.id ?? null
  let name = brow?.name ?? null
  const c = getClient(siteId)
  if (name == null) {
    try { const data = await c.listGroups(1, 300); const glist = Array.isArray(data) ? data : (data?.items || []); for (const g of glist) if (g.id === gid) { name = g.name; break } } catch { /* ignore */ }
  }
  let deletedRemote = 0, groupDeleted = false; const errors: string[] = []; let memberIds: number[] = []
  if (remote) {
    try { memberIds = ((await c.listAccounts({ group: gid, pageSize: 1000 }))?.items || []).map((a) => a.id) } catch (e) { return { error: `列远端成员失败，已中止（未删任何数据），请重试: ${String(e instanceof Error ? e.message : e).slice(0, 80)}` } }
    for (const aid of memberIds) { try { await c.deleteAccount(aid); deletedRemote++ } catch (e) { errors.push(`删号${aid}: ${String(e instanceof Error ? e.message : e).slice(0, 60)}`) } }
    try { await c.deleteGroup(gid); groupDeleted = true } catch (e) { errors.push(`删分组${gid}: ${String(e instanceof Error ? e.message : e).slice(0, 60)}`) }
  }
  for (const aid of memberIds) d.prepare('DELETE FROM probe_results WHERE sub2_account_id=? AND site_id=?').run(aid, siteId)
  if (localBatchId) {
    d.prepare('DELETE FROM inventory_snapshots WHERE batch_id=? AND site_id=?').run(localBatchId, siteId)
    d.prepare('DELETE FROM batches WHERE id=? AND site_id=?').run(localBatchId, siteId)
  }
  return { deleted: true, batch_name: name || `group#${gid}`, deleted_remote: deletedRemote, group_deleted: groupDeleted, local_cleaned: memberIds.length, errors }
}

export async function deleteBatch(siteId: number, batchId: number, remote = true): Promise<any> {
  const b = db().prepare('SELECT sub2_group_id, name FROM batches WHERE id=? AND site_id=?').get(batchId, siteId) as any
  if (!b) return { error: '批次不存在' }
  if (b.sub2_group_id) return deleteGroup(siteId, b.sub2_group_id, remote)
  // 无关联分组的批次：仅清本地元数据
  db().prepare('DELETE FROM inventory_snapshots WHERE batch_id=? AND site_id=?').run(batchId, siteId)
  db().prepare('DELETE FROM batches WHERE id=? AND site_id=?').run(batchId, siteId)
  return { deleted: true, batch_name: b.name, deleted_remote: 0, group_deleted: false, local_cleaned: 0, errors: [] }
}
