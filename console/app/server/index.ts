/**
 * Sub2API 统一运维控制台 —— 后端总装。
 * 观测(只读 PG) + 账号池管理(admin API + PG 提权) 合一；多站点；统一密码门禁。
 * §10：实体数据一律实时回源 sub2api；SQLite 仅存派生/元数据。
 */
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, getSetting } from './db.js'
import { ensureAdminPassword } from './config.js'
import { changePassword, isAuthed, login, logout, requireAuth } from './auth.js'
import * as sites from './sites.js'
import * as obs from './observability.js'
import * as pool from './pool.js'
import * as importer from './importer.js'
import * as inventory from './inventory.js'
import * as cleanup from './cleanup.js'
import * as users from './users.js'
import { AdminApi } from './adminApi.js'

db()                       // 初始化 SQLite schema
ensureAdminPassword()      // 从 env 播种管理员密码哈希(若提供)

const app = express()
const port = Number(process.env.PORT || 21013)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, '..', 'dist')

app.use(express.json({ limit: '32mb' }))
app.use(express.static(publicDir))

const wrap = (fn: (req: express.Request, res: express.Response) => unknown) =>
  (req: express.Request, res: express.Response) =>
    Promise.resolve(fn(req, res)).catch((e) => res.status(500).json({ error: e instanceof Error ? e.message : String(e) }))

const qSite = (req: express.Request) => Number(req.query.site || 1)
const bSite = (req: express.Request) => Number((req.body || {}).site_id || 1)

// ---------- 公共(免登录) ----------
app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.get('/api/session', (req, res) => res.json({
  authed: isAuthed(req),
  password_set: !!getSetting('admin_pass_hash'),
  sites: getSetting('admin_pass_hash') && isAuthed(req) ? sites.getAllSites().map(sites.sitePublic) : [],
}))
app.post('/api/login', login)
app.post('/api/logout', logout)

// ---------- 门禁后 ----------
app.use('/api', requireAuth)

// 本平台 SSH 公钥（接入远程站点时需把它加到目标机 ~/.ssh/authorized_keys）
app.get('/api/console-pubkey', (_req, res) => {
  let pubkey = ''
  for (const p of ['/root/.ssh/id_ed25519.pub', '/root/.ssh/id_rsa.pub']) {
    try { pubkey = fs.readFileSync(p, 'utf8').trim(); if (pubkey) break } catch { /* next */ }
  }
  res.json({ pubkey })
})

// 站点
app.get('/api/sites', (_req, res) => res.json(sites.getAllSites().map(sites.sitePublic)))
app.post('/api/sites', wrap((req, res) => res.json(sites.addSite(req.body))))
app.put('/api/sites/:id', wrap((req, res) => res.json(sites.updateSite(Number(req.params.id), req.body))))
app.delete('/api/sites/:id', wrap((req, res) => res.json(sites.deleteSite(Number(req.params.id)))))
app.post('/api/sites/:id/check', wrap(async (req, res) => res.json(await sites.checkSite(Number(req.params.id)))))
app.post('/api/sites/probe', wrap(async (req, res) => {
  const base = (req.body.base_url || '').trim().replace(/\/+$/, '')
  const key = req.body.admin_key || ''
  if (!base || !key) return res.json({ url_ok: false, error: '需 base_url + admin_key（手动填 Key 接入）' })
  try { await new AdminApi(base, key).listAccounts({ page: 1, pageSize: 1 }); res.json({ url_ok: true, auth_ok: true, admin_key_ready: true, admin_key: key, stage: 'ok' }) }
  catch (e) { res.json({ url_ok: true, auth_ok: false, error: `admin-key 验证失败：${e instanceof Error ? e.message : e}`, stage: 'auth' }) }
}))

// 观测(本机走 pg / 远程走 ssh 通道)
app.get('/api/summary', wrap(async (req, res) => res.json(await obs.summary(qSite(req), req.query.window))))
app.get('/api/requests', wrap(async (req, res) => res.json(await obs.requests(qSite(req), { window: req.query.window, q: req.query.q as string, model: req.query.model as string, status: req.query.status as string }))))
app.get('/api/attention', wrap(async (req, res) => res.json(await obs.attention(qSite(req)))))

// 账号池(读)
app.get('/api/groups', wrap(async (req, res) => { const d = await sites.getClient(qSite(req)).listGroups(1, 200); res.json(Array.isArray(d) ? d : (d?.items || [])) }))
app.get('/api/proxies', wrap(async (req, res) => { const d = await sites.getClient(qSite(req)).listProxies(); res.json(d?.items || []) }))
app.get('/api/group-accounts', wrap(async (req, res) => res.json(await pool.groupAccounts(qSite(req), Number(req.query.group || 0)))))
app.get('/api/all-accounts', wrap(async (req, res) => res.json(await pool.allAccounts(qSite(req), (req.query.status as string) || undefined, (req.query.search as string) || undefined))))
app.get('/api/pool-overview', wrap(async (req, res) => res.json(await pool.poolOverview(qSite(req)))))
app.get('/api/batches', wrap(async (req, res) => res.json(await pool.batches(qSite(req)))))
app.get('/api/dead-accounts', wrap((req, res) => {
  const vs = String(req.query.verdicts || 'dead,auth_fail').split(',').filter(Boolean)
  const sh = Math.min(8760, Math.max(0, Number(req.query.stale_hours || 48)))
  res.json(pool.deadAccounts(qSite(req), vs, sh))
}))
app.get('/api/recycle', wrap((req, res) => res.json(pool.recycleList(qSite(req)))))
app.get('/api/inventory-status', (req, res) => res.json(inventory.getInv(qSite(req))))
app.get('/api/cleanup-status', (req, res) => res.json(cleanup.getCleanup(qSite(req))))
app.get('/api/users', wrap(async (req, res) => res.json(await users.usersList(qSite(req)))))

// 账号池(写)
app.post('/api/import', wrap(async (req, res) => res.json(await importer.doImport(req.body))))
app.post('/api/upstream-import', wrap(async (req, res) => res.json(await importer.upstreamImport(req.body))))
app.post('/api/inventory', wrap((req, res) => res.json(inventory.startInventory(req.body))))
app.post('/api/bulk', wrap(async (req, res) => res.json(await pool.bulk(req.body))))
app.post('/api/cleanup', wrap((req, res) => res.json(cleanup.startCleanup(req.body))))
app.post('/api/cleanup-abort', wrap((req, res) => { cleanup.getCleanup(bSite(req)).abort = true; res.json({ aborting: true }) }))
app.post('/api/recycle-restore', wrap(async (req, res) => res.json(await pool.restoreRecycle(req.body))))
app.delete('/api/batches/:id', wrap(async (req, res) => res.json(await pool.deleteBatch(qSite(req), Number(req.params.id), String(req.query.remote ?? '1') !== '0'))))
app.delete('/api/groups/:id', wrap(async (req, res) => res.json(await pool.deleteGroup(qSite(req), Number(req.params.id), String(req.query.remote ?? '1') !== '0'))))

// 改管理员密码
app.post('/api/admin-password', changePassword)

// 用户管理(写)
app.post('/api/users/role', wrap(async (req, res) => res.json(await users.setRole(req.body))))
app.post('/api/users/status', wrap(async (req, res) => res.json(await users.setUserStatus(req.body))))

// SPA 回退
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next()
  res.sendFile(path.join(publicDir, 'index.html'))
})
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'console_internal_error', message: err instanceof Error ? err.message : String(err) })
})

app.listen(port, '0.0.0.0', () => console.log(`Sub2API Console listening on :${port}`))
