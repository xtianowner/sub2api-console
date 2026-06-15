/**
 * 用户权限管理。改 role 官方 API 不开放 → 直连 sub2api postgres 提权：本机站点走 pg 可写连接，远程走 ssh docker exec。
 * 启用/禁用(status) 仍走官方 API。移植自 web_server.py 用户段 + _pg_set_role。
 */
import { getClient, getSite, localPool, sshPsql } from './sites.js'

export async function usersList(siteId: number): Promise<any[]> {
  const users = await getClient(siteId).listUsersAll()
  return users.map((u) => ({
    id: u.id, email: u.email, username: u.username, role: u.role, status: u.status,
    balance: u.balance, concurrency: u.concurrency, created_at: u.created_at,
  }))
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
