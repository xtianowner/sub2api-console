/**
 * 批次分类导入 + 中转接入。移植自 importer.py + web_server._upstream_import。
 * §10：只写本地批次元数据(batches，每平台分组一条)，成员/token 一律以 sub2api 为准，不存第二副本。
 */
import { db, nowCst } from './db.js'
import { getClient, getSiteAdminLogin } from './sites.js'

function defaultBatchName(): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `batch-${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`
}

export interface AccountObj { access_token?: string; refresh_token?: string; id_token?: string; email?: string; name?: string; user_agent?: string }

/** 把一个 sub2 账号对象(credentials/extra/name) 归一化为 AccountObj 并 push(有 access_token 才收)。 */
function pushSub2Account(out: Array<[string, AccountObj]>, key: string, a: any): void {
  const cred = a.credentials || {}
  const ex = a.extra || {}
  const acc: AccountObj = {
    access_token: cred.access_token, refresh_token: cred.refresh_token || ex.refresh_token,
    id_token: cred.id_token, email: cred.email || ex.email || a.name,
    user_agent: ex.user_agent || cred.user_agent, name: a.name,
  }
  if (acc.access_token) out.push([key, acc])
}

/** 展开账号文件为统一 account 列表。fmt: 'cpa'|'sub2'|undefined(自动)。
 * 兼容三种载荷：① CPA 单号(顶层 access_token)；② sub2 导出包裹({accounts:[{credentials...}]})；
 * ③ sub2 裸账号对象(顶层 credentials，无 accounts)——sub2 导出有时是账号对象数组而非包裹对象。 */
export function expandInputs(rawList: Array<[string, any]>, fmt?: string): Array<[string, AccountObj]> {
  const out: Array<[string, AccountObj]> = []
  for (const [src, obj] of rawList) {
    if (!obj || typeof obj !== 'object') continue
    const isCpa = !!obj.access_token
    const isSub2Wrap = Array.isArray(obj.accounts)
    const isSub2Acct = !isSub2Wrap && !!obj.credentials && typeof obj.credentials === 'object'
    const isSub2 = isSub2Wrap || isSub2Acct
    if (fmt === 'cpa' && !isCpa) continue
    if (fmt === 'sub2' && !isSub2) continue
    if (isCpa) {
      out.push([src, obj])
    } else if (isSub2Wrap) {
      obj.accounts.forEach((a: any, i: number) => pushSub2Account(out, `${src}#a${i}`, a))
    } else if (isSub2Acct) {
      pushSub2Account(out, src, obj)
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
 * 中转接入（按 sub2api 真实工作流，支持一次建多个分组、不同账号绑不同分组）。
 * 每个分组独立闭包：① 建/复用分组(POST /admin/groups，rate_multiplier 须>0)
 *  ② 建 type=apikey 账号并 inline group_ids:[gid] 绑该组（无独立绑定端点；credentials={base_url,api_key,model_mapping?}）
 *  ③ 可选：用户登录(JWT) 建「使用用」API Key 绑该组（POST /keys，group_id 单值=一 key 一组；明文仅返回一次，不落库）
 *  ④ 可选：建渠道监控（group_name 仅展示标签、无外键；endpoint=base_url 的 https 纯 origin）
 * 全程只调官方 admin REST + 用户 /keys，不改 sub2api 源码(L1)。base_url/platform/model_mapping 整批共享(同一上游)。
 * 兼容旧单组载荷：无 body.groups 时把 tiers[]/单档+body.group+顶层 create_key/monitor 包成一组。
 */
export async function upstreamImport(body: any): Promise<any> {
  const siteId = Number(body.site_id || 1)
  const platform = body.platform || 'openai'
  const baseUrl = (body.base_url || '').trim()
  if (!baseUrl) return { error: '缺少 base_url' }

  // model_mapping 整批共享：对象，或 "src:dst"/"src=dst" 每行
  let modelMapping: Record<string, string> | undefined
  if (body.model_mapping && typeof body.model_mapping === 'object') modelMapping = body.model_mapping
  else if (typeof body.model_mapping === 'string' && body.model_mapping.trim()) {
    const m: Record<string, string> = {}
    for (const line of body.model_mapping.split('\n')) { const [s, d2] = line.split(/[:=]/).map((x: string) => (x || '').trim()); if (s && d2) m[s] = d2 }
    if (Object.keys(m).length) modelMapping = m
  }

  // 账号归一化（账号级覆盖 → 顶层默认）
  const normAcc = (a: any) => ({
    name: (a.name || '').trim(), api_key: (a.api_key || '').trim(),
    priority: Number(a.priority ?? body.priority ?? 50), concurrency: Number(a.concurrency ?? body.concurrency ?? 10),
    rate: Number(a.rate_multiplier ?? a.rate ?? body.rate_multiplier ?? 1),
  })

  // 归一化为 groups[]：优先 body.groups；否则把旧 tiers/单档包成单组（向后兼容）
  let rawGroups: any[]
  if (Array.isArray(body.groups) && body.groups.length) {
    rawGroups = body.groups.map((g: any) => ({
      name: (g.name || '').trim(), group_id: g.group_id ? Number(g.group_id) : null,
      rate_multiplier: g.rate_multiplier != null ? Number(g.rate_multiplier) : undefined,
      accounts: (Array.isArray(g.accounts) ? g.accounts : []).map(normAcc).filter((a: any) => a.name && a.api_key),
      create_key: g.create_key, monitor: g.monitor,
    }))
  } else {
    const rawTiers = (Array.isArray(body.tiers) && body.tiers.length) ? body.tiers
      : [{ name: body.name, api_key: body.api_key, priority: body.priority, concurrency: body.concurrency, rate_multiplier: body.rate_multiplier }]
    rawGroups = [{
      name: (body.group || '').trim(), group_id: body.group_id ? Number(body.group_id) : null,
      rate_multiplier: undefined as number | undefined,
      accounts: rawTiers.map(normAcc).filter((a: any) => a.name && a.api_key),
      create_key: body.create_key, monitor: body.monitor,
    }]
  }
  const groups = rawGroups.filter((g) => g.accounts.length)
  if (!groups.length) return { error: '至少一个分组需含一个有效账号（账号名 + api_key）' }

  const c = getClient(siteId)

  // 预取分组缓存（name→id），避免每组都拉一次；新建组回填防同名重复建
  const nameToId = new Map<string, number>()
  try {
    const gl = await c.listGroups(1, 300)
    const glist = Array.isArray(gl) ? gl : (gl?.items || [])
    for (const g of glist) { const n = (g.name || '').trim(); if (n && g.id != null) nameToId.set(n, g.id) }
  } catch (e) { return { error: `取分组列表失败: ${msg(e)}` } }

  const d = db()
  const results: any[] = []

  for (const g of groups) {
    const gname = g.name || g.accounts[0].name
    const r: any = { group_name: gname, group_id: null, accounts: [], created: 0, total: g.accounts.length }

    // ① 复用/建分组（rate_multiplier 须>0：取组级或首账号 rate）
    let gid: number | null = g.group_id || nameToId.get(gname) || null
    if (!gid) {
      try {
        const grp: any = await c.createGroup(gname, { platform, rate_multiplier: g.rate_multiplier ?? g.accounts[0].rate })
        gid = (grp && typeof grp === 'object') ? grp.id : grp
        if (gid) nameToId.set(gname, gid)
      } catch (e) { r.group_error = `建/取分组失败: ${msg(e)}`; results.push(r); continue }
    }
    r.group_id = gid

    // ② 建 apikey 账号并 inline 绑该组
    for (const a of g.accounts) {
      try {
        const cred: Record<string, unknown> = { base_url: baseUrl, api_key: a.api_key }
        if (modelMapping) cred.model_mapping = modelMapping
        const acc: any = await c.createAccount({
          name: a.name, platform, type: 'apikey', credentials: cred,
          group_ids: [gid], priority: a.priority, concurrency: a.concurrency, rate_multiplier: a.rate,
          confirm_mixed_channel_risk: true,
        })
        r.accounts.push({ name: a.name, account_id: (acc && typeof acc === 'object') ? acc.id : acc })
      } catch (e) { r.accounts.push({ name: a.name, error: msg(e) }) }
    }
    r.created = r.accounts.filter((x: any) => x.account_id).length

    // 本地批次元数据（§10：每分组一条，只写派生元数据）
    if (gid && r.created) {
      const b = d.prepare('SELECT id FROM batches WHERE site_id=? AND sub2_group_id=?').get(siteId, gid)
      if (!b) d.prepare(`INSERT INTO batches(site_id,name,sub2_group_id,source_path,imported_at,default_priority,default_concurrency,total_count)
                         VALUES(?,?,?,?,?,?,?,?)`).run(siteId, gname, gid, 'relay:' + baseUrl, nowCst(), g.accounts[0].priority, g.accounts[0].concurrency, r.created)
    }

    // ③ 可选 key（该组；留空回退站点 admin 登录；group_id 单值=一 key 一组）
    if (g.create_key && g.create_key.enabled) {
      let email = (g.create_key.email || '').trim()
      let password = g.create_key.password || ''
      if (!email || !password) { const def = getSiteAdminLogin(siteId); if (!email) email = def.email; if (!password) password = def.password }
      if (!gid) r.key_error = '无分组，跳过建 key'
      else if (!email || !password) r.key_error = '建 key 留空但服务端未配管理员密码：设 CONSOLE_SUB2_ADMIN_PASSWORD 或在表单填写'
      else { try { r.key = await c.createUsageKey(email, password, { name: `${gname}-key`, group_id: gid }) } catch (e) { r.key_error = msg(e) } }
    }

    // ④ 可选监控（该组；group_name 仅展示标签；endpoint=https 纯 origin；api_key 取本组首账号）
    if (g.monitor && g.monitor.enabled) {
      const endpoint = originOf(baseUrl)
      if (!endpoint.startsWith('https://')) r.monitor_error = `渠道监控要求 https 的纯 origin，base_url(${endpoint}) 非 https，已跳过`
      else {
        const m = g.monitor
        try {
          const mon: any = await c.createChannelMonitor({
            name: `${gname}-monitor`, provider: m.provider || platform, endpoint, api_key: g.accounts[0].api_key,
            primary_model: (m.primary_model || '').trim(), interval_seconds: Math.min(3600, Math.max(15, Number(m.interval_seconds || 60))),
            enabled: true, api_mode: m.api_mode || 'chat_completions', extra_models: [], group_name: gname,
          })
          r.monitor_id = (mon && typeof mon === 'object') ? mon.id : mon
        } catch (e) { r.monitor_error = `建渠道监控失败: ${msg(e)}` }
      }
    }

    results.push(r)
  }

  const created = results.reduce((s, r) => s + (r.created || 0), 0)
  const total = results.reduce((s, r) => s + (r.total || 0), 0)
  return { ok: created > 0, groups: results, created, total }
}
