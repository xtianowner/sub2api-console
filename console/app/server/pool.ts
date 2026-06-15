/**
 * 账号池读取 + 批量编辑 + 批次/回收站。移植自 web_server.py 的 _merge_accounts/_pool_overview/_batches/_bulk/...
 * §10：分组与成员一律实时取自 sub2api(list_groups/list_accounts)，本地只叠加 probe 判活(派生)与批次名(元数据)。
 */
import { db, nowCst } from './db.js'
import { getClient } from './sites.js'
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

export function mergeAccounts(siteId: number, accts: AdminAccount[]): any[] {
  const probes = latestProbes(siteId)
  return accts.map((a) => {
    const ex = (a.extra || {}) as any
    const cred = (a.credentials || {}) as any
    const pr = probes.get(a.id)
    let v = pr?.verdict ?? null
    if (v === 'active') v = null // 旧 fallback 误把 sub2 status 当 verdict → 视为未盘点
    const up = pr?.codex_7d_pct
    const u5 = pr?.codex_5h_pct
    return {
      id: a.id, name: a.name,
      email: cred.email || a.name,
      type: a.type, platform: a.platform,
      has_token: a.type === 'oauth',
      status: a.status, schedulable: a.schedulable, verdict: v,
      priority: a.priority, concurrency: a.concurrency,
      used_primary: up != null ? up : ex.codex_7d_used_percent,
      used_5h: u5 != null ? u5 : ex.codex_5h_used_percent,
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
  const bygrp: any[] = []
  for (const g of groups) {
    if (!g || typeof g !== 'object') continue
    const gid = g.id; const gname = g.name
    let members: AdminAccount[] = []
    try { members = (await client.listAccounts({ group: gid, pageSize: 1000 }))?.items || [] } catch { members = [] }
    const mids = members.map((m) => m.id)
    if (!mids.length && !bmeta.has(gid)) continue
    const meta = bmeta.get(gid)
    const alive = mids.filter((id) => vmap.get(id)?.verdict === 'alive').length
    const dead = mids.filter((id) => { const v = vmap.get(id)?.verdict; return v === 'dead' || v === 'auth_fail' }).length
    bygrp.push({ batch_id: meta?.batch_id, name: meta?.name || gname, group: gid, total: mids.length, alive, dead })
  }
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
  for (const b of rows) {
    if (b.sub2_group_id != null) {
      try { b.account_count = ((await client.listAccounts({ group: b.sub2_group_id, pageSize: 1000 }))?.items || []).length } catch { b.account_count = null }
    } else b.account_count = 0
    b.orphaned = !!(liveGroups != null && !liveGroups.has(b.sub2_group_id))
    const snap = db().prepare('SELECT * FROM inventory_snapshots WHERE batch_id=? AND site_id=? ORDER BY id DESC LIMIT 1').get(b.id, siteId)
    b.last_snapshot = snap || null
  }
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
