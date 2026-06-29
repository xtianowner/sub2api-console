/**
 * 用户权限管理。改 role 官方 API 不开放 → 直连 sub2api postgres 提权：本机站点走 pg 可写连接，远程走 ssh docker exec。
 * 启用/禁用(status) 仍走官方 API。移植自 web_server.py 用户段 + _pg_set_role。
 */
import { getClient, getSite, localPool, sshPsql } from './sites.js'
import { db, getSetting, setSetting, nowCst, tx } from './db.js'

export async function usersList(siteId: number): Promise<any[]> {
  const users = await getClient(siteId).listUsersAll()
  return users.map((u) => ({
    id: u.id, email: u.email, username: u.username, role: u.role, status: u.status,
    balance: u.balance, concurrency: u.concurrency, created_at: u.created_at,
    last_active_at: u.last_active_at ?? null, total_recharged: Number(u.total_recharged ?? 0),
  }))
}

// 用户最近使用 IP：持久化进 console SQLite（派生缓存，源=sub2api usage_logs.ip_address），增量同步 + 秒级读。
const IP_WM_KEY = (siteId: number) => `user_ip_wm:${siteId}`            // 水位线：已同步到的最大 created_at
const IP_SYNCED_KEY = (siteId: number) => `user_ip_synced_at:${siteId}` // 上次同步本地时间(CST)

/** 读 SQLite 里某站的「用户→最近IP / IP集」（不打远端，秒级）。 */
export function getUserIps(siteId: number): any {
  const rows = db().prepare('SELECT user_id, last_ip, last_at, all_ips FROM user_ip WHERE site_id=?').all(siteId) as any[]
  const ips: Record<number, { last_ip: string; last_at: string; all_ips: string[] }> = {}
  for (const r of rows) {
    let all: string[] = []
    try { all = JSON.parse(r.all_ips || '[]') } catch { all = r.last_ip ? [r.last_ip] : [] }
    ips[Number(r.user_id)] = { last_ip: r.last_ip, last_at: r.last_at, all_ips: all }
  }
  return { ips, users_with_ip: rows.length, synced_at: getSetting(IP_SYNCED_KEY(siteId)) }
}

const ipSyncLocks = new Set<number>()
const tsMs = (s: string): number => { const t = Date.parse(s); return Number.isNaN(t) ? 0 : t }

/**
 * 增量同步：按 created_at 倒序拉 /admin/usage，撞到「上次水位线 - 60s slack」之前才停（只取新增行），合并 upsert 进 user_ip、推进水位线。
 * 用 epoch-ms 比较而非字符串：sub2api(Python) 整秒时 created_at 省略小数（`...00Z` vs `...00.5Z` 字典序与时间序相反）→ 字符串比会漏行；
 * 60s slack 统一兜底小数秒缺省 / 提交序 / 时钟偏移的边界漏行（重处理几行，幂等无害）。
 * 首次（无水位线）做有上限回填（8×1000）。某站 /admin/usage 不兼容/超时则静默保留已得、不抛、且不更新 synced_at（不撒谎）。
 */
export async function syncUserIps(siteId: number, opts: { full?: boolean } = {}): Promise<any> {
  if (ipSyncLocks.has(siteId)) return { scanned: 0, touched: 0, skipped: true }   // 防同站重叠（后台轮 + 手动点）
  ipSyncLocks.add(siteId)
  try {
    const client = getClient(siteId)
    const wm = opts.full ? '' : (getSetting(IP_WM_KEY(siteId)) || '')
    const wmMs = wm ? tsMs(wm) : 0
    const SLACK_MS = 60_000
    const maxPages = wm ? 60 : 8   // 增量通常远早于上限就撞水位线；首次回填封顶 8000 行
    const touched = new Map<number, { lastIp: string; lastAt: string; lastMs: number; ips: Set<string> }>()
    let newest = wm; let newestMs = wmMs
    let scanned = 0; let stop = false; let ok = false
    for (let p = 1; p <= maxPages && !stop; p++) {
      let items: any[] = []
      try { const d = await client.listUsage(p, 1000); items = Array.isArray(d) ? d : (d?.items || []); ok = true }
      catch { break }   // 某站 /admin/usage 不兼容/超时：保留已得、停（IP 是增强，别弄崩）
      if (!items.length) break
      for (const r of items) {
        const ip = r.ip_address; const uid = Number(r.user_id); const at = String(r.created_at || '')
        if (!ip || !uid || !at) continue
        const atMs = tsMs(at)
        if (wm && atMs && atMs < wmMs - SLACK_MS) { stop = true; break }   // slack 之前才停（不可解析时 atMs=0 → 不停、照常处理）
        if (atMs > newestMs) { newestMs = atMs; newest = at }
        scanned++
        let e = touched.get(uid)
        if (!e) { e = { lastIp: ip, lastAt: at, lastMs: atMs, ips: new Set() }; touched.set(uid, e) }
        e.ips.add(ip)
        if (atMs > e.lastMs) { e.lastMs = atMs; e.lastAt = at; e.lastIp = ip }
      }
      if (items.length < 1000) break
    }
    if (touched.size) {
      const sel = db().prepare('SELECT last_ip, last_at, all_ips FROM user_ip WHERE site_id=? AND user_id=?')
      const up = db().prepare('INSERT INTO user_ip(site_id,user_id,last_ip,last_at,all_ips,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(site_id,user_id) DO UPDATE SET last_ip=excluded.last_ip,last_at=excluded.last_at,all_ips=excluded.all_ips,updated_at=excluded.updated_at')
      const now = nowCst()
      tx(() => {
        for (const [uid, e] of touched) {
          let lastIp = e.lastIp, lastAt = e.lastAt, lastMs = e.lastMs
          const ipset = e.ips
          const ex = sel.get(siteId, uid) as any
          if (ex) {
            try { for (const ip of JSON.parse(ex.all_ips || '[]')) ipset.add(ip) } catch { if (ex.last_ip) ipset.add(ex.last_ip) }
            const exMs = tsMs(String(ex.last_at || ''))
            if (exMs > lastMs) { lastAt = ex.last_at; lastIp = ex.last_ip; lastMs = exMs }
          }
          up.run(siteId, uid, lastIp, lastAt, JSON.stringify(Array.from(ipset).slice(0, 50)), now)
        }
      })
    }
    if (newest && newest !== wm) setSetting(IP_WM_KEY(siteId), newest)
    if (ok) setSetting(IP_SYNCED_KEY(siteId), nowCst())   // 只有至少成功取回一页才更新"已同步时间"
    return { scanned, touched: touched.size }
  } finally { ipSyncLocks.delete(siteId) }
}

export async function setRole(body: any): Promise<any> {
  const siteId = Number(body.site_id || 1)
  const uid = Number(body.user_id)
  const role = body.role
  if (role !== 'admin' && role !== 'user') return { error: 'role 只能是 admin 或 user' }
  if (!Number.isInteger(uid)) return { error: 'user_id 非法' }
  const site = getSite(siteId)
  if (!site) return { error: '站点不存在' }
  try {
    let dbRes: string
    if (site.kind === 'local') {
      const r = await localPool(true).query(`UPDATE users SET role=$1 WHERE id=$2`, [role, uid])
      dbRes = `UPDATE ${r.rowCount}`
    } else {
      const ssh = (site.ssh_host || '').trim()
      const pgc = (site.pg_container || '').trim()
      if (!ssh || !pgc) return { error: '该站点未配置提权通道（ssh_host + pg_container）' }
      dbRes = await sshPsql(ssh, pgc, `UPDATE users SET role='${role}' WHERE id=${uid};`)
    }
    return { ok: true, site_id: siteId, user_id: uid, role, db: dbRes }
  } catch (e) {
    return { error: `改 role 失败: ${e instanceof Error ? e.message : e}` }
  }
}

export async function setUserStatus(body: any): Promise<any> {
  const siteId = Number(body.site_id || 1)
  const uid = Number(body.user_id)
  const status = body.status
  if (status !== 'active' && status !== 'disabled') return { error: 'status 只能是 active 或 disabled' }
  await getClient(siteId).setUserStatus(uid, status)
  return { ok: true, user_id: uid, status }
}

/**
 * 批量删用户（清理恶意注册）。sub2api 无批量删端点 → 逐个调 DELETE /admin/users/:id（软删 + 级联软删其 key）。
 * 限并发避免打爆远端；admin 角色后端会硬拒、计入 failed。返回 {requested, deleted, failed, errors}。
 */
export async function bulkDeleteUsers(body: any): Promise<any> {
  const siteId = Number(body.site_id || 1)
  const raw: unknown[] = Array.isArray(body.user_ids) ? body.user_ids : []
  const ids: number[] = Array.from(new Set(raw.map((x) => Number(x)).filter((n) => Number.isInteger(n))))
  if (!ids.length) return { error: '未选择用户' }
  if (ids.length > 2000) return { error: `单次最多删 2000 个（本次 ${ids.length}），请分批` }
  const client = getClient(siteId)
  let deleted = 0
  const okIds: number[] = []
  const errors: Array<{ id: number; error: string }> = []
  const CONC = 5
  for (let i = 0; i < ids.length; i += CONC) {
    const chunk = ids.slice(i, i + CONC)
    const rs = await Promise.allSettled(chunk.map((id) => client.deleteUser(id)))
    rs.forEach((r, j) => {
      if (r.status === 'fulfilled') { deleted++; okIds.push(chunk[j]) }
      else errors.push({ id: chunk[j], error: r.reason instanceof Error ? r.reason.message : String(r.reason) })
    })
  }
  // 清掉被删用户在本地 IP 缓存里的孤儿行（批量删 bot 正是本功能核心场景，否则 user_ip 行无界堆积）
  if (okIds.length) { const del = db().prepare('DELETE FROM user_ip WHERE site_id=? AND user_id=?'); tx(() => { for (const id of okIds) del.run(siteId, id) }) }
  return { ok: true, requested: ids.length, deleted, failed: errors.length, errors: errors.slice(0, 50) }
}
