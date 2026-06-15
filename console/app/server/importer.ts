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

const msg = (e: unknown) => String(e instanceof Error ? e.message : e).slice(0, 200)
function originOf(url: string): string { try { const u = new URL(url); return `${u.protocol}//${u.host}` } catch { return url } }

/**
 * 中转接入（按 sub2api 真实工作流，支持批量多档）：
 *  ① 建中转账号 type=apikey（credentials={base_url, api_key, model_mapping?}；base_url 仅对 apikey 生效）
 *  ② 建/复用分组并把各档账号绑进去（group_ids）
 *  ③ 可选：经 sub2api 用户登录(JWT) 建「使用用」API Key 绑分组（admin-api-key 无此接口；明文仅返回一次，不落库）
 *  ④ 可选：建渠道监控（监控上游：endpoint=base_url 的 origin，api_key=上游 key）
 */
export async function upstreamImport(body: any): Promise<any> {
  const siteId = Number(body.site_id || 1)
  const platform = body.platform || 'openai'
  const baseUrl = (body.base_url || '').trim()
  if (!baseUrl) return { error: '缺少 base_url' }
  // 归一化档位：批量 tiers[]，或单档(name+api_key)
  const raw = (Array.isArray(body.tiers) && body.tiers.length) ? body.tiers
    : [{ name: body.name, api_key: body.api_key, priority: body.priority, concurrency: body.concurrency, rate_multiplier: body.rate_multiplier }]
  const tiers = raw.map((t: any) => ({
    name: (t.name || '').trim(), api_key: (t.api_key || '').trim(),
    priority: Number(t.priority ?? body.priority ?? 50), concurrency: Number(t.concurrency ?? body.concurrency ?? 10),
    rate: Number(t.rate_multiplier ?? body.rate_multiplier ?? 1),
  })).filter((t: any) => t.name && t.api_key)
  if (!tiers.length) return { error: '至少一档需填 账号名 + api_key' }
  const c = getClient(siteId)

  // model_mapping 共享：对象，或 "src:dst"/"src=dst" 每行
  let modelMapping: Record<string, string> | undefined
  if (body.model_mapping && typeof body.model_mapping === 'object') modelMapping = body.model_mapping
  else if (typeof body.model_mapping === 'string' && body.model_mapping.trim()) {
    const m: Record<string, string> = {}
    for (const line of body.model_mapping.split('\n')) { const [s, d2] = line.split(/[:=]/).map((x: string) => (x || '').trim()); if (s && d2) m[s] = d2 }
    if (Object.keys(m).length) modelMapping = m
  }

  // ① 分组（复用同名或新建；默认用首档名）
  let gid: number | null = body.group_id ? Number(body.group_id) : null
  const gname = (body.group || '').trim() || tiers[0].name
  try {
    if (!gid) {
      const gl = await c.listGroups(1, 300)
      const glist = Array.isArray(gl) ? gl : (gl?.items || [])
      const ex = glist.find((g: any) => (g.name || '').trim() === gname)
      if (ex) gid = ex.id
      else { const grp: any = await c.createGroup(gname, { platform, rate_multiplier: tiers[0].rate }); gid = (grp && typeof grp === 'object') ? grp.id : grp }
    }
  } catch (e) { return { error: `建/取分组失败: ${msg(e)}` } }

  // ② 各档建 apikey 账号并绑分组
  const accounts: any[] = []
  for (const t of tiers) {
    try {
      const cred: Record<string, unknown> = { base_url: baseUrl, api_key: t.api_key }
      if (modelMapping) cred.model_mapping = modelMapping
      const acc: any = await c.createAccount({
        name: t.name, platform, type: 'apikey', credentials: cred,
        ...(gid ? { group_ids: [gid] } : {}), priority: t.priority, concurrency: t.concurrency, rate_multiplier: t.rate,
        confirm_mixed_channel_risk: true,
      })
      accounts.push({ name: t.name, account_id: (acc && typeof acc === 'object') ? acc.id : acc })
    } catch (e) { accounts.push({ name: t.name, error: msg(e) }) }
  }
  const created = accounts.filter((a) => a.account_id).length

  // 本地批次元数据
  if (gid && created) {
    const d = db()
    const b = d.prepare('SELECT id FROM batches WHERE site_id=? AND sub2_group_id=?').get(siteId, gid)
    if (!b) d.prepare(`INSERT INTO batches(site_id,name,sub2_group_id,source_path,imported_at,default_priority,default_concurrency,total_count)
                       VALUES(?,?,?,?,?,?,?,?)`).run(siteId, gname, gid, 'relay:' + baseUrl, nowCst(), tiers[0].priority, tiers[0].concurrency, created)
  }

  // ③ 可选：经用户登录建使用 key（明文仅一次返回，不落库）
  let key: { id: number; key: string } | undefined
  let keyError: string | undefined
  if (body.create_key && body.create_key.enabled) {
    const email = (body.create_key.email || '').trim()
    const password = body.create_key.password || ''
    if (!email || !password) keyError = '建 key 需 sub2api 用户邮箱+密码'
    else if (!gid) keyError = '无分组，跳过建 key'
    else { try { key = await c.createUsageKey(email, password, { name: `${gname}-key`, group_id: gid }) } catch (e) { keyError = msg(e) } }
  }

  // ④ 可选渠道监控（监控上游：endpoint=origin，api_key=首档上游 key）
  let monitorId: number | undefined
  let monitorError: string | undefined
  if (body.monitor && body.monitor.enabled) {
    const endpoint = originOf(baseUrl)
    if (!endpoint.startsWith('https://')) monitorError = `渠道监控要求 https 的纯 origin，base_url(${endpoint}) 非 https，已跳过`
    else {
      const m = body.monitor
      try {
        const mon: any = await c.createChannelMonitor({
          name: `${gname}-monitor`, provider: m.provider || platform, endpoint, api_key: tiers[0].api_key,
          primary_model: (m.primary_model || '').trim(), interval_seconds: Math.min(3600, Math.max(15, Number(m.interval_seconds || 60))),
          enabled: true, api_mode: m.api_mode || 'chat_completions', extra_models: [], group_name: gname,
        })
        monitorId = (mon && typeof mon === 'object') ? mon.id : mon
      } catch (e) { monitorError = `建渠道监控失败: ${msg(e)}` }
    }
  }

  return { ok: created > 0, group_id: gid, group_name: gname, accounts, created, total: tiers.length, key, key_error: keyError, monitor_id: monitorId, monitor_error: monitorError }
}
