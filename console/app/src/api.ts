// Sub2API Console 前端 API 客户端：观测 + 账号池 + 用户/站点 + 鉴权。同源 fetch，会话走 httpOnly cookie。

export class ApiError extends Error {
  status: number
  needLogin: boolean
  constructor(message: string, status: number, needLogin = false) { super(message); this.status = status; this.needLogin = needLogin }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = { error: text } }
  if (!res.ok) throw new ApiError(data?.error || data?.message || `${res.status}`, res.status, !!data?.need_login || res.status === 401)
  return data as T
}
const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

// ---- 鉴权/会话 ----
export interface SiteInfo {
  id: number; name: string; base_url: string; gateway_url: string; probe_model: string
  is_active: number; health: string; last_checked_at?: string; last_latency_ms?: number
  kind: string; has_admin_key: boolean; has_gateway_key: boolean
  pg_container: string; ssh_host: string; role_channel: boolean; observability: boolean
}
export interface Session { authed: boolean; password_set: boolean; sites: SiteInfo[] }
export const getSession = () => req<Session>('GET', '/api/session')
export const login = (password: string) => req<{ ok: boolean }>('POST', '/api/login', { password })
export const logout = () => req<{ ok: boolean }>('POST', '/api/logout')

// ---- 观测 ----
export type Owner = 'client' | 'provider' | 'platform' | 'normal' | 'unknown'
export interface SummaryResponse {
  window: string
  metrics: { total: number; success: number; failed: number; successRate: number; avgDurationMs: number; p95DurationMs: number; avgFirstTokenMs: number; slowRequests: number }
  trend: Array<{ bucket: string; success: number; error: number }>
  owners: Array<{ owner: Owner | string; label: string; count: number }>
  models: Array<{ model: string; count: number }>
}
export interface RequestRow {
  kind: 'success' | 'error'; created_at: string; request_id: string; client_request_id: string
  user_label: string; key_label: string; model: string; status_code: number; owner: Owner; phase: string
  duration_ms: number; first_token_ms: number; message: string
}
export interface AttentionRow { owner: Owner; label: string; phase: string; type: string; model: string; count: number; last_seen: string; message: string }
export const getSummary = (site: number, window: string) => req<SummaryResponse>('GET', `/api/summary${qs({ site, window })}`)
export const getRequests = (site: number, p: { window: string; q?: string; model?: string; status?: string }) => req<{ rows: RequestRow[] }>('GET', `/api/requests${qs({ site, ...p })}`)
export const getAttention = (site: number) => req<{ rows: AttentionRow[] }>('GET', `/api/attention${qs({ site })}`)

// ---- 账号池 ----
export interface AccountRow {
  id: number; name?: string; email?: string; type?: string; platform?: string; has_token: boolean
  status?: string; schedulable?: boolean; verdict?: string | null; priority?: number; concurrency?: number
  used_primary?: number | null; used_5h?: number | null; usage_updated?: string | null; last_probe_at?: string | null
  expires_at?: string | number | null; proxy_id?: number | null; primary_reset_at?: number | null; secondary_reset_at?: number | null; rate_limit_reset_at?: string | number | null
}
export interface PoolOverview { total: number; by_verdict: Record<string, number>; by_status: Record<string, number>; expiring_7d: number; rate_limited: number; by_group: Array<{ batch_id?: number; name?: string; group: number; total: number; alive: number; dead: number }> }
export interface BatchRow { id: number; name: string; sub2_group_id: number | null; imported_at?: string; default_priority?: number; default_concurrency?: number; account_count: number | null; orphaned: boolean; last_snapshot: any }
export interface GroupRow { id: number; name?: string; [k: string]: unknown }

export const getGroups = (site: number) => req<GroupRow[]>('GET', `/api/groups${qs({ site })}`)
export const getProxies = (site: number) => req<any[]>('GET', `/api/proxies${qs({ site })}`)
export const getAllAccounts = (site: number, p: { status?: string; search?: string } = {}) => req<AccountRow[]>('GET', `/api/all-accounts${qs({ site, ...p })}`)
export const getGroupAccounts = (site: number, group: number) => req<AccountRow[]>('GET', `/api/group-accounts${qs({ site, group })}`)
export const getPoolOverview = (site: number) => req<PoolOverview>('GET', `/api/pool-overview${qs({ site })}`)
export const getBatches = (site: number) => req<BatchRow[]>('GET', `/api/batches${qs({ site })}`)
export const getDeadAccounts = (site: number, verdicts: string, staleHours: number) => req<{ accounts: any[]; total: number; stale_count: number; by_verdict: Record<string, number> }>('GET', `/api/dead-accounts${qs({ site, verdicts, stale_hours: staleHours })}`)
export const getRecycle = (site: number) => req<any[]>('GET', `/api/recycle${qs({ site })}`)
export interface InvStatus { running: boolean; done: number; total: number; current: number | null; group: number | null; error: string | null }
export const getInventoryStatus = (site: number) => req<InvStatus>('GET', `/api/inventory-status${qs({ site })}`)
export interface CleanupStatus { running: boolean; done: number; total: number; deleted: number; failed: number; current: number | null; abort: boolean; errors: string[] }
export const getCleanupStatus = (site: number) => req<CleanupStatus>('GET', `/api/cleanup-status${qs({ site })}`)

export const doImport = (body: any) => req<any>('POST', '/api/import', body)
export const doUpstreamImport = (body: any) => req<any>('POST', '/api/upstream-import', body)
export const startInventory = (body: any) => req<{ started: boolean; msg?: string }>('POST', '/api/inventory', body)
export const doBulk = (body: any) => req<any>('POST', '/api/bulk', body)
export const startCleanup = (body: any) => req<{ started: boolean; msg?: string; total?: number }>('POST', '/api/cleanup', body)
export const abortCleanup = (site_id: number) => req<any>('POST', '/api/cleanup-abort', { site_id })
export const restoreRecycle = (body: any) => req<any>('POST', '/api/recycle-restore', body)
export const deleteBatch = (site: number, id: number, remote = true) => req<any>('DELETE', `/api/batches/${id}${qs({ site, remote: remote ? 1 : 0 })}`)
export const deleteGroup = (site: number, id: number, remote = true) => req<any>('DELETE', `/api/groups/${id}${qs({ site, remote: remote ? 1 : 0 })}`)

// ---- 用户 ----
export interface UserRow { id: number; email?: string; username?: string; role?: string; status?: string; balance?: number; concurrency?: number; created_at?: string }
export const getUsers = (site: number) => req<UserRow[]>('GET', `/api/users${qs({ site })}`)
export const setUserRole = (body: { site_id: number; user_id: number; role: string }) => req<any>('POST', '/api/users/role', body)
export const setUserStatus = (body: { site_id: number; user_id: number; status: string }) => req<any>('POST', '/api/users/status', body)

// ---- 站点 ----
export const getSites = () => req<SiteInfo[]>('GET', '/api/sites')
export const addSite = (body: any) => req<any>('POST', '/api/sites', body)
export const updateSite = (id: number, body: any) => req<any>('PUT', `/api/sites/${id}`, body)
export const deleteSite = (id: number) => req<any>('DELETE', `/api/sites/${id}`)
export const checkSite = (id: number) => req<any>('POST', `/api/sites/${id}/check`)
export const probeSite = (body: any) => req<any>('POST', '/api/sites/probe', body)
export const getConsolePubkey = () => req<{ pubkey: string }>('GET', '/api/console-pubkey')
export const changeAdminPassword = (old_password: string, new_password: string) => req<{ ok: boolean }>('POST', '/api/admin-password', { old_password, new_password })
