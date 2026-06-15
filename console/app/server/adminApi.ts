/**
 * 封装 sub2api 官方 admin REST API（L1 外挂：只读写官方 API，不碰其源码）。移植自 pool-manager api_client.py。
 * base_url 形如 http://host:port/api/v1；admin 端点形如 /admin/groups。鉴权 header x-api-key。
 */

export class ApiError extends Error {}

export interface AdminAccount {
  id: number
  name?: string
  type?: string
  platform?: string
  status?: string
  schedulable?: boolean
  priority?: number
  concurrency?: number
  proxy_id?: number | null
  expires_at?: string | number | null
  rate_limit_reset_at?: string | number | null
  credentials?: Record<string, unknown>
  extra?: Record<string, unknown>
  [k: string]: unknown
}

export interface AdminGroup { id: number; name?: string; [k: string]: unknown }

export class AdminApi {
  base: string
  adminKey: string
  timeout: number
  constructor(baseUrl: string, adminKey: string, timeout = 30000) {
    this.base = (baseUrl || '').replace(/\/+$/, '')
    this.adminKey = adminKey || ''
    this.timeout = timeout
  }

  async req<T = any>(method: string, path: string, jsonBody?: unknown, timeoutMs?: number): Promise<T> {
    const ctrl = new AbortController()
    const tm = setTimeout(() => ctrl.abort(), timeoutMs || this.timeout)
    let status = 0
    let text = ''
    try {
      const res = await fetch(this.base + path, {
        method,
        headers: {
          'x-api-key': this.adminKey,
          ...(jsonBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
        signal: ctrl.signal,
      })
      status = res.status
      text = await res.text()
    } catch (e) {
      throw new ApiError(`${method} ${path} -> network: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      clearTimeout(tm)
    }
    let body: any
    try { body = JSON.parse(text) } catch { throw new ApiError(`${method} ${path} -> ${status}: ${text.slice(0, 200)}`) }
    if (status >= 400) throw new ApiError(`${method} ${path} -> ${status}: ${JSON.stringify(body).slice(0, 300)}`)
    return (body && typeof body === 'object' && 'data' in body) ? body.data : body
  }

  // ---- 分组 ----
  createGroup(name: string, opts: { platform?: string; description?: string; rate_multiplier?: number } = {}) {
    return this.req('POST', '/admin/groups', {
      name, platform: opts.platform || 'openai', description: opts.description || '',
      rate_multiplier: opts.rate_multiplier ?? 1.0, subscription_type: 'standard',
    })
  }
  listGroups(page = 1, pageSize = 100) {
    return this.req<{ items?: AdminGroup[] } | AdminGroup[]>('GET', `/admin/groups?page=${page}&page_size=${pageSize}`)
  }
  deleteGroup(groupId: number) { return this.req('DELETE', `/admin/groups/${groupId}`) }

  // ---- 账号 ----
  importCodexSession(body: Record<string, unknown>) {
    return this.req('POST', '/admin/accounts/import/codex-session', body, 120000)
  }
  createAccount(body: Record<string, unknown>) { return this.req('POST', '/admin/accounts', body) }
  getAccount(accountId: number) { return this.req<AdminAccount>('GET', `/admin/accounts/${accountId}`) }

  listAccounts(opts: { group?: number; status?: string; platform?: string; page?: number; pageSize?: number; search?: string } = {}) {
    let q = `?page=${opts.page || 1}&page_size=${opts.pageSize || 200}`
    if (opts.platform) q += `&platform=${opts.platform}`
    if (opts.group !== undefined && opts.group !== null) q += `&group=${opts.group}`
    if (opts.status) q += `&status=${opts.status}`
    if (opts.search) q += `&search=${encodeURIComponent(opts.search)}`
    return this.req<{ items?: AdminAccount[]; total?: number }>('GET', `/admin/accounts${q}`)
  }

  /** 全分页拉取（sub2api page_size 上限 1000，必须真翻页）。 */
  async listAllAccounts(opts: { group?: number; status?: string; search?: string; pageSize?: number } = {}): Promise<AdminAccount[]> {
    const pageSize = opts.pageSize || 1000
    const out: AdminAccount[] = []
    let page = 1
    while (page <= 100) {
      const data = await this.listAccounts({ ...opts, page, pageSize })
      const items = Array.isArray(data) ? data : (data?.items || [])
      out.push(...items)
      const total = Array.isArray(data) ? undefined : data?.total
      if (!items.length || items.length < pageSize || (total != null && out.length >= total)) break
      page++
    }
    return out
  }

  bulkUpdate(accountIds: number[] | null, fields: Record<string, unknown>, filters?: unknown) {
    const body: Record<string, unknown> = { ...fields }
    if (accountIds) body.account_ids = accountIds
    if (filters) body.filters = filters
    return this.req('POST', '/admin/accounts/bulk-update', body)
  }
  clearError(accountId: number) { return this.req('POST', `/admin/accounts/${accountId}/clear-error`) }
  clearRateLimit(accountId: number) { return this.req('POST', `/admin/accounts/${accountId}/clear-rate-limit`) }
  deleteAccount(accountId: number) { return this.req('DELETE', `/admin/accounts/${accountId}`) }

  /**
   * 测试账号连通性 —— sub2api 自带 SSE 端点 POST /admin/accounts/:id/test。
   * 对 apikey/中转账号实测上游(账号自己的 base_url+api_key+代理)，对 oauth 走 codex。
   * SSE: data:{"type":"test_complete","success":true} / data:{"type":"error","error":"API returned 401:..."}。
   * 测试在 sub2api 内部跑，不经 console 出口。返回 {ok, error}。
   */
  async testAccount(accountId: number, model?: string, timeoutMs = 60000): Promise<{ ok: boolean; error: string }> {
    const ctrl = new AbortController()
    const tm = setTimeout(() => ctrl.abort(), timeoutMs)
    let text = ''
    let httpStatus = 0
    try {
      const res = await fetch(`${this.base}/admin/accounts/${accountId}/test`, {
        method: 'POST',
        headers: { 'x-api-key': this.adminKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(model ? { model_id: model } : {}),
        signal: ctrl.signal,
      })
      httpStatus = res.status
      text = await res.text()
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      clearTimeout(tm)
    }
    let ok = false
    let error = ''
    for (const line of text.split('\n')) {
      const s = line.trim()
      if (!s.startsWith('data:')) continue
      try {
        const ev = JSON.parse(s.slice(5).trim())
        if (ev.type === 'test_complete' && ev.success) ok = true
        if (ev.type === 'error' && ev.error) error = String(ev.error)
      } catch { /* 忽略非 JSON 的 data 行(增量文本) */ }
    }
    if (ok) return { ok: true, error: '' }
    return { ok: false, error: error || (httpStatus >= 400 ? `HTTP ${httpStatus}` : '测试未完成(无 test_complete)') }
  }

  // ---- 代理 ----
  listProxies() { return this.req<{ items?: unknown[] }>('GET', '/admin/proxies?page=1&page_size=100') }

  // ---- 用户 ----
  async listUsersAll(): Promise<any[]> {
    const out: any[] = []
    let page = 1
    while (page <= 100) {
      const d = await this.req<{ items?: any[]; total?: number }>('GET', `/admin/users?page=${page}&page_size=200`)
      const items = Array.isArray(d) ? d : (d?.items || [])
      out.push(...items)
      const total = Array.isArray(d) ? undefined : d?.total
      if (!items.length || items.length < 200 || (total != null && out.length >= total)) break
      page++
    }
    return out
  }
  setUserStatus(uid: number, status: string) { return this.req('PUT', `/admin/users/${uid}`, { status }) }
}
