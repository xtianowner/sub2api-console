/**
 * 站点注册 + 提权路由。
 * - admin REST：每站点一个 AdminApi（缓存，解密 admin_key）。
 * - PG 提权(token 回源 SELECT / 改 role UPDATE)：本机站点(kind=local)走 pg 连接池；
 *   远程站点(ssh_host)走 ssh + docker exec psql（无状态，沿用 pool-manager source_tokens 思路）。
 * 凭据只在内存解密供调用，绝不外泄/打印。
 */
import { execFile } from 'node:child_process'
import pg from 'pg'
import { db, nowCst } from './db.js'
import { ADMIN_DATABASE_URL, DATABASE_URL, PROBE_MODEL, decryptCredential, encryptCredential } from './config.js'
import { AdminApi } from './adminApi.js'

const { Pool } = pg

export interface SiteRow {
  id: number; name: string; base_url: string; gateway_url: string
  admin_key_enc?: string; gateway_key_enc?: string; probe_model?: string
  is_active?: number; health?: string; last_checked_at?: string; last_latency_ms?: number
  pg_container?: string; ssh_host?: string; kind?: string; created_at?: string
}

export function getSite(id: number): SiteRow | null {
  return (db().prepare('SELECT * FROM sites WHERE id=?').get(id) as unknown as SiteRow) || null
}
export function getAllSites(): SiteRow[] {
  return db().prepare('SELECT * FROM sites ORDER BY id').all() as unknown as SiteRow[]
}

export function sitePublic(s: SiteRow) {
  const pgc = (s.pg_container || '').trim()
  const ssh = (s.ssh_host || '').trim()
  return {
    id: s.id, name: s.name, base_url: s.base_url, gateway_url: s.gateway_url,
    probe_model: s.probe_model, is_active: s.is_active, health: s.health,
    last_checked_at: s.last_checked_at, last_latency_ms: s.last_latency_ms, created_at: s.created_at,
    kind: s.kind || 'remote',
    has_admin_key: !!s.admin_key_enc, has_gateway_key: !!s.gateway_key_enc,
    pg_container: pgc, ssh_host: ssh,
    // 提权通道可用：本机有 pg 连接串 OR 远程配了 ssh_host+容器名
    role_channel: (s.kind === 'local' && !!ADMIN_DATABASE_URL) || (!!ssh && !!pgc),
    // 可观测：本机有 pg 连接 OR 远程配了 ssh+pg 通道(观测 SQL 走 ssh docker exec psql)
    observability: (s.kind === 'local' && !!DATABASE_URL) || (!!ssh && !!pgc),
  }
}

// ---- AdminApi 缓存 ----
const _clients = new Map<number, AdminApi>()
export function getClient(siteId: number): AdminApi {
  if (_clients.has(siteId)) return _clients.get(siteId)!
  const s = getSite(siteId)
  if (!s) throw new Error(`站点 ${siteId} 不存在`)
  const c = new AdminApi(s.base_url, decryptCredential(s.admin_key_enc || ''))
  _clients.set(siteId, c)
  return c
}
export function invalidateSite(siteId?: number) {
  if (siteId === undefined) _clients.clear()
  else _clients.delete(siteId)
}
export function siteProbeModel(siteId: number): string {
  return getSite(siteId)?.probe_model || PROBE_MODEL
}

// ---- 本机 PG 连接池（仅 kind=local 站点 = 部署所在的 sub2api）----
let _ro: pg.Pool | null = null
let _rw: pg.Pool | null = null
export function localPool(write = false): pg.Pool {
  if (write) { if (!_rw) _rw = new Pool({ connectionString: ADMIN_DATABASE_URL }); return _rw }
  if (!_ro) _ro = new Pool({ connectionString: DATABASE_URL }); return _ro
}

// ---- 远程 ssh + docker exec psql ----
function execFileP(cmd: string, args: string[], input?: string, timeoutMs = 40000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || stdout || String(err)).slice(0, 200)))
      resolve(String(stdout).trim())
    })
    if (input !== undefined && child.stdin) { child.stdin.write(input); child.stdin.end() }
  })
}

/** 远程站点经 ssh + docker exec 把 sql 经 stdin 喂给 sub2api postgres，返回 stdout(-tA)。
 * sshHost 支持 user@host 或 user@host:port(非 22 端口)。 */
export function sshPsql(sshHost: string, pgContainer: string, sql: string): Promise<string> {
  let host = sshHost.trim()
  let port = ''
  const m = host.match(/^(.*):(\d+)$/) // 末尾 :数字 视为端口
  if (m) { host = m[1]; port = m[2] }
  const inner = 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA'
  const remoteCmd = `docker exec -i ${pgContainer} sh -c '${inner}'`
  const args = ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']
  if (port) args.push('-p', port)
  args.push(host, remoteCmd)
  return execFileP('ssh', args, sql)
}

// ---- 站点 CRUD ----
export function setHealth(siteId: number, health: string, latency?: number | null) {
  db().prepare('UPDATE sites SET health=?, last_checked_at=?, last_latency_ms=? WHERE id=?')
    .run(health, nowCst(), latency ?? null, siteId)
}

export function addSite(body: any): any {
  const name = (body.name || '').trim()
  const base = (body.base_url || '').trim().replace(/\/+$/, '')
  const gw = (body.gateway_url || '').trim().replace(/\/+$/, '') || base.replace('/api/v1', '')
  const adminKey = body.admin_key || ''
  if (!name || !base || !adminKey) return { error: '缺少 name / base_url / admin_key' }
  const kind = body.kind === 'local' ? 'local' : 'remote'
  try {
    const info = db().prepare(
      `INSERT INTO sites(name,base_url,gateway_url,admin_key_enc,gateway_key_enc,probe_model,pg_container,ssh_host,kind,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ).run(name, base, gw, encryptCredential(adminKey), encryptCredential(body.gateway_key || ''),
      body.probe_model || PROBE_MODEL, (body.pg_container || '').trim(), (body.ssh_host || '').trim(), kind, nowCst())
    const sid = Number(info.lastInsertRowid)
    invalidateSite(sid)
    return { site_id: sid, name }
  } catch (e) {
    return { error: `站点名重复或写入失败：${e instanceof Error ? e.message : String(e)}` }
  }
}

export function updateSite(sid: number, body: any): any {
  const sets: string[] = []
  const vals: any[] = []
  for (const col of ['name', 'base_url', 'gateway_url', 'probe_model', 'is_active', 'kind']) {
    if (col in body && body[col] !== null && body[col] !== '') {
      sets.push(`${col}=?`)
      vals.push(typeof body[col] === 'string' && col.endsWith('_url') ? body[col].replace(/\/+$/, '') : body[col])
    }
  }
  for (const col of ['pg_container', 'ssh_host']) {
    if (col in body) { sets.push(`${col}=?`); vals.push((body[col] || '').trim()) }
  }
  if (body.admin_key) { sets.push('admin_key_enc=?'); vals.push(encryptCredential(body.admin_key)) }
  if (body.gateway_key) { sets.push('gateway_key_enc=?'); vals.push(encryptCredential(body.gateway_key)) }
  if (sets.length) { vals.push(sid); db().prepare(`UPDATE sites SET ${sets.join(',')} WHERE id=?`).run(...vals) }
  invalidateSite(sid)
  return { site_id: sid, updated: true }
}

const SITED_TABLES = ['batches', 'inventory_snapshots', 'probe_results', 'recycle']
export function deleteSite(sid: number): any {
  const d = db()
  for (const t of SITED_TABLES) d.prepare(`DELETE FROM ${t} WHERE site_id=?`).run(sid)
  d.prepare('DELETE FROM sites WHERE id=?').run(sid)
  invalidateSite(sid)
  return { deleted: sid }
}

export async function checkSite(sid: number): Promise<any> {
  const t0 = Date.now()
  try {
    await getClient(sid).listGroups(1, 1)
    const ms = Date.now() - t0
    setHealth(sid, 'healthy', ms)
    return { health: 'healthy', latency_ms: ms }
  } catch (e) {
    setHealth(sid, 'unhealthy')
    return { health: 'unhealthy', error: e instanceof Error ? e.message : String(e) }
  }
}
