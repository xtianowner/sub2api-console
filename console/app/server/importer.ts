/**
 * 批次分类导入 + 中转接入。移植自 importer.py + web_server._upstream_import。
 * §10：只写本地批次元数据(batches，每平台分组一条)，成员/token 一律以 sub2api 为准，不存第二副本。
 */
import { db, nowCst } from './db.js'
import { getClient } from './sites.js'

function defaultBatchName(): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `batch-${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`
}

export interface AccountObj { access_token?: string; refresh_token?: string; id_token?: string; email?: string; name?: string; user_agent?: string }

/** 展开账号文件为统一 account 列表。fmt: 'cpa'|'sub2'|undefined(自动)。 */
export function expandInputs(rawList: Array<[string, any]>, fmt?: string): Array<[string, AccountObj]> {
  const out: Array<[string, AccountObj]> = []
  for (const [src, obj] of rawList) {
    if (!obj || typeof obj !== 'object') continue
    const isCpa = !!obj.access_token
    const isSub2 = Array.isArray(obj.accounts)
    if (fmt === 'cpa' && !isCpa) continue
    if (fmt === 'sub2' && !isSub2) continue
    if (isCpa) {
      out.push([src, obj])
    } else if (isSub2) {
      obj.accounts.forEach((a: any, i: number) => {
        const cred = a.credentials || {}
        const ex = a.extra || {}
        const acc: AccountObj = {
          access_token: cred.access_token, refresh_token: cred.refresh_token || ex.refresh_token,
          id_token: cred.id_token, email: cred.email || ex.email || a.name,
          user_agent: ex.user_agent || cred.user_agent, name: a.name,
        }
        if (acc.access_token) out.push([`${src}#a${i}`, acc])
      })
    }
  }
  return out
}

export async function importFromObjects(items: Array<[string, AccountObj]>, opts: {
  siteId?: number; batchName?: string; priority?: number; concurrency?: number; proxyId?: number | null
  notes?: string | null; sourcePath?: string | null; extraGroupIds?: number[]
  rateMultiplier?: number | null; loadFactor?: number | null; expiresAt?: number | null
  autoPauseOnExpired?: unknown; updateExisting?: unknown
} = {}): Promise<any> {
  const siteId = opts.siteId || 1
  const client = getClient(siteId)
  items = items.filter(([, o]) => o.access_token)
  if (!items.length) return null
  const name = opts.batchName || defaultBatchName()
  const priority = opts.priority ?? 50
  const concurrency = opts.concurrency ?? 3

  // 去重：同名分组复用 id
  let groupId: number | null = null
  try {
    const existing = await client.listGroups(1, 200)
    const glist = Array.isArray(existing) ? existing : (existing?.items || [])
    for (const g of glist) if ((g.name || '').trim() === name.trim()) { groupId = g.id; break }
  } catch { /* ignore */ }
  if (groupId == null) {
    const grp: any = await client.createGroup(name, { platform: 'openai', description: `batch ${opts.sourcePath || 'web-upload'}` })
    groupId = (grp && typeof grp === 'object') ? grp.id : grp
  }

  const contents = items.map(([, obj]) => JSON.stringify(obj))
  const groupIds = [groupId, ...(opts.extraGroupIds || []).filter((g) => g && g !== groupId)]
  const body: Record<string, unknown> = { contents, group_ids: groupIds, priority, concurrency, notes: opts.notes || name }
  if (opts.proxyId != null) body.proxy_id = opts.proxyId
  if (opts.rateMultiplier != null) body.rate_multiplier = opts.rateMultiplier
  if (opts.loadFactor != null) body.load_factor = opts.loadFactor
  if (opts.expiresAt != null) body.expires_at = opts.expiresAt
  if (opts.autoPauseOnExpired != null) body.auto_pause_on_expired = opts.autoPauseOnExpired
  if (opts.updateExisting != null) body.update_existing = opts.updateExisting
  const res: any = await client.importCodexSession(body)

  // 本地仅写批次元数据（每平台分组一条，复用现有行）
  const d = db()
  const exist = d.prepare('SELECT id FROM batches WHERE site_id=? AND sub2_group_id=?').get(siteId, groupId) as { id: number } | undefined
  let batchId: number
  if (exist) {
    batchId = exist.id
    d.prepare('UPDATE batches SET name=?, imported_at=?, total_count=?, default_priority=?, default_concurrency=?, default_proxy_id=? WHERE id=?')
      .run(name, nowCst(), items.length, priority, concurrency, opts.proxyId ?? null, batchId)
  } else {
    const info = d.prepare(`INSERT INTO batches(site_id,name,sub2_group_id,source_path,imported_at,default_priority,default_concurrency,default_proxy_id,notes,total_count)
                            VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      siteId, name, groupId, opts.sourcePath || 'web-upload', nowCst(), priority, concurrency, opts.proxyId ?? null, opts.notes ?? null, items.length)
    batchId = Number(info.lastInsertRowid)
  }
  const imported = (res?.items || []).filter((it: any) => it.account_id).length || (res?.created || 0)
  return { batch_id: batchId, group_id: groupId, group_name: name, mapped: imported, result: res }
}

export async function doImport(body: any): Promise<any> {
  const siteId = Number(body.site_id || 1)
  const cpa = body.cpa_list || []
  const raw: Array<[string, any]> = cpa.map((c: any, i: number) => [c.__file || `upload-${i}`, c])
  const items = expandInputs(raw, body.format)
  const opt = (k: string, cast: (v: any) => any) => (body[k] != null && body[k] !== '' ? cast(body[k]) : null)
  const r = await importFromObjects(items, {
    siteId, batchName: body.name || undefined, priority: Number(body.priority ?? 50), concurrency: Number(body.concurrency ?? 3),
    proxyId: opt('proxy_id', Number), extraGroupIds: (body.group_ids || []).map(Number).filter(Boolean),
    notes: body.notes || null, rateMultiplier: opt('rate_multiplier', Number), loadFactor: opt('load_factor', Number),
    expiresAt: opt('expires_at', Number), autoPauseOnExpired: body.auto_pause_on_expired, updateExisting: body.update_existing,
  })
  return r || { error: '无可导入的号' }
}

/** 中转接入：一个上游 base_url + 多档(key)，逐档建 upstream 账号 + 建/绑分组。 */
export async function upstreamImport(body: any): Promise<any> {
  const siteId = Number(body.site_id || 1)
  const baseUrl = (body.base_url || '').trim()
  const platform = body.platform || 'openai'
  const atype = body.type || 'upstream'
  const tiers = body.tiers || []
  if (!baseUrl || !tiers.length) return { error: '缺少 base_url 或档位' }
  const c = getClient(siteId)
  let name2gid: Record<string, number> = {}
  try {
    const gl = await c.listGroups(1, 300)
    const glist = Array.isArray(gl) ? gl : (gl?.items || [])
    for (const g of glist) if (g.name) name2gid[(g.name as string).trim()] = g.id
  } catch { name2gid = {} }
  const results: any[] = []
  const d = db()
  for (const ti of tiers) {
    const tname = (ti.tier || '').trim()
    const key = (ti.api_key || '').trim()
    if (!key) { results.push({ tier: tname, ok: false, error: '缺 api_key' }); continue }
    const rate = Number(ti.rate_multiplier || 1.0)
    const prio = Number(ti.priority ?? 50)
    const conc = Number(ti.concurrency ?? 5)
    let gid = ti.group_id
    const gname = (ti.group || '').trim()
    try {
      if (!gid && gname) {
        gid = name2gid[gname]
        if (!gid) { const grp: any = await c.createGroup(gname, { platform, rate_multiplier: rate }); gid = (grp && typeof grp === 'object') ? grp.id : grp; name2gid[gname] = gid }
      }
      const aname = (ti.account_name || '').trim() || (tname || 'upstream')
      const acc: any = await c.createAccount({
        name: aname, platform, type: atype, credentials: { base_url: baseUrl, api_key: key },
        ...(gid ? { group_ids: [gid] } : {}), priority: prio, concurrency: conc, rate_multiplier: rate,
      })
      const aid = (acc && typeof acc === 'object') ? acc.id : acc
      results.push({ tier: tname, ok: true, account_id: aid, group_id: gid, name: aname })
      if (gid) {
        const b = d.prepare('SELECT id FROM batches WHERE site_id=? AND sub2_group_id=?').get(siteId, gid)
        if (!b) d.prepare(`INSERT INTO batches(site_id,name,sub2_group_id,source_path,imported_at,default_priority,default_concurrency,total_count)
                           VALUES(?,?,?,?,?,?,?,?)`).run(siteId, gname || aname, gid, 'upstream:' + baseUrl, nowCst(), prio, conc, 0)
      }
    } catch (e) {
      results.push({ tier: tname, ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 120) })
    }
  }
  return { created: results.filter((r) => r.ok).length, total: tiers.length, results }
}
