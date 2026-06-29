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
  kind: string; has_admin_key: boolean; has_gateway_key: boolean; has_admin_login: boolean
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
  metrics: { total: number; success: number; failed: number; successRate: number; avgDurationMs: number; p95DurationMs: number; avgFirstTokenMs: number; slowRequests: number; inputTokens: number; outputTokens: number; totalTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalCost: number }
  trend: Array<{ bucket: string; success: number; error: number }>
  owners: Array<{ owner: Owner | string; label: string; count: number }>
  models: Array<{ model: string; count: number }>
}
export interface RequestRow {
  kind: 'success' | 'error'; created_at: string; request_id: string; client_request_id: string
  user_label: string; key_label: string; model: string; status_code: number; owner: Owner; phase: string
  duration_ms: number; first_token_ms: number; message: string
  input_tokens: number; output_tokens: number; cache_tokens: number; cost: number
  upstream_account: string
}
export interface AttentionRow { owner: Owner; label: string; phase: string; type: string; model: string; count: number; last_seen: string; message: string }
// 时间窗：window 为快捷窗(5m/15m/1h/24h) 或 'custom'。custom 时附带 start/end（上海时区，
// 'YYYY-MM-DD HH:mm' 或 'YYYY-MM-DD'）。getRequests 支持 page(从1开始)/pageSize 翻页。
export type ObsRange = { window: string; start?: string; end?: string }
export const getSummary = (site: number, p: ObsRange) => req<SummaryResponse>('GET', `/api/summary${qs({ site, ...p })}`)
export const getRequests = (site: number, p: ObsRange & { q?: string; model?: string; status?: string; slow?: boolean; page?: number; pageSize?: number }) => req<{ rows: RequestRow[]; total: number; page: number; pageSize: number }>('GET', `/api/requests${qs({ site, ...p, slow: p.slow ? 1 : undefined })}`)
export const getAttention = (site: number, p: ObsRange = { window: '15m' }) => req<{ rows: AttentionRow[] }>('GET', `/api/attention${qs({ site, ...p })}`)

// ---- 用户用量报告 ----
export interface UsageUser { user_id: number; email: string; role: string; status: string; balance: number; total_recharged: number; created_at: string | null; last_active_at: string | null }
export interface UsageMetrics {
  totalCost: number; inputCost: number; outputCost: number; cacheCreationCost: number; cacheReadCost: number; actualCost: number; reconcileDiff: number
  inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; cacheCreation5mTokens: number; cacheCreation1hTokens: number; totalTokens: number
  successRequests: number; failedRequests: number
  cacheReadCostShare: number; cacheCostShare: number; cacheTokenShare: number; cacheHitRate: number; cacheReadMultiple: number; avgCostPerReq: number
}
export type BreakdownKey = 'input' | 'output' | 'cache_creation' | 'cache_read'
export interface UsageReportResponse {
  resolve: 'found' | 'notFound' | 'ambiguous'
  period: { range: string; start: string; end: string; tz: string }
  candidates?: UsageUser[]
  user?: UsageUser
  metrics?: UsageMetrics
  costBreakdown?: Array<{ key: BreakdownKey; cost: number; pct: number }>
  tokenBreakdown?: Array<{ key: BreakdownKey; tokens: number; pct: number }>
  daily?: Array<{ day: string; requests: number; accounts: number; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; inputCost: number; outputCost: number; cacheCreationCost: number; cacheReadCost: number; totalCost: number; reconcileDiff: number }>
  byModel?: Array<{ model: string; requests: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; totalTokens: number; totalCost: number; cacheReadCost: number; cacheReadCostShare: number }>
  byKey?: Array<{ api_key_id: number; name: string; quota: number | null; quota_used: number | null; requests: number; totalCost: number; totalTokens: number }>
  byAccount?: Array<{ account_id: number; name: string; platform: string; status: string; requests: number; inputTokens: number; cacheReadTokens: number; totalCost: number; cacheReadCost: number; cacheHitRate: number; cacheReadCostShare: number; requestShare: number }>
  topRequests?: Array<{ created_at: string; model: string; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; totalCost: number; cacheReadCostShare: number }>
}
export const getUsageReport = (site: number, p: { q?: string; uid?: number; range?: string; start?: string; end?: string }) =>
  req<UsageReportResponse>('GET', `/api/usage-report${qs({ site, ...p })}`)

// ---- 账号池 ----
export interface AccountRow {
  id: number; name?: string; email?: string; type?: string; platform?: string; has_token: boolean
  status?: string; schedulable?: boolean; verdict?: string | null; priority?: number; concurrency?: number
  used_5h?: number | null; used_7d?: number | null; usage_updated?: string | null; last_probe_at?: string | null
  expires_at?: string | number | null; proxy_id?: number | null; primary_reset_at?: number | null; secondary_reset_at?: number | null; rate_limit_reset_at?: string | number | null
}
export interface PoolOverview { total: number; by_verdict: Record<string, number>; by_status: Record<string, number>; expiring_7d: number; rate_limited: number; by_group: Array<{ batch_id?: number; name?: string; group: number; total: number; alive: number; dead: number }> }
export interface BatchRow { id: number; name: string; sub2_group_id: number | null; imported_at?: string; default_priority?: number; default_concurrency?: number; account_count: number | null; orphaned: boolean; last_snapshot: any }
export interface GroupRow { id: number; name?: string; sort_order?: number; [k: string]: unknown }

// ---- 分组管理（账号↔分组 成员关系，从分组视角增删成员）----
// MemberAccount.group_ids = 该账号当前所属的全部分组 id（sub2api 账号本就支持多分组）。
// 成员账号 = 完整账号字段(AccountRow) + 该号当前所属分组集合，使分组管理页具备与账号管理同等的编辑能力。
export interface MemberAccount extends AccountRow { group_ids: number[] }
export interface GroupMembership { groups: GroupRow[]; accounts: MemberAccount[] }
export const getGroupMembership = (site: number) => req<GroupMembership>('GET', `/api/group-membership${qs({ site })}`)
// add/remove 为「增量」：仅在每个账号现有分组集合上并入/移除目标分组，不影响其它分组归属（避免 REPLACE 误清）。
// 持久化自定义分组顺序（写各分组 sort_order，按 group_ids 下标排）。
export const setGroupOrder = (site: number, group_ids: number[]) => req<{ ok: boolean; updated: number }>('POST', '/api/groups/sort-order', { site_id: site, group_ids })
export const addToGroup = (body: { site_id: number; group_id: number; account_ids: number[] }) => req<{ added: number; failed: number; errors: string[] }>('POST', '/api/group-membership/add', body)
export const removeFromGroup = (body: { site_id: number; group_id: number; account_ids: number[] }) => req<{ removed: number; failed: number; errors: string[] }>('POST', '/api/group-membership/remove', body)

// ---- 分组密钥（本组「使用用」API Key：列/建/删；用户态经站点管理员登录）----
// 一个 key 绑 0/1 个分组（group_id 单值）。明文 key 仅创建时返回一次（getGroupKeys 列表里的 key 为掩码/占位）。
// admin_login=false 表示该站点未配 sub2api 管理员登录、无法管理密钥。
export interface GroupKey { id: number; name?: string; key?: string; status?: string; group_id?: number | null; group?: { id: number; name?: string }; quota?: number; quota_used?: number; created_at?: string; last_used_at?: string | null; expires_at?: string | null }
export const getGroupKeys = (site: number, group: number) => req<{ keys: GroupKey[]; total: number; admin_login: boolean }>('GET', `/api/group-keys${qs({ site, group })}`)
export const createGroupKey = (body: { site_id: number; group_id: number; name?: string }) => req<{ id: number; key: string }>('POST', '/api/group-keys', body)
export const deleteGroupKey = (site: number, id: number) => req<{ deleted: boolean }>('DELETE', `/api/group-keys/${id}${qs({ site })}`)

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
// 注册 IP sub2api 不记录；最近使用 IP 经 /api/users/ip-map（批量拉 usage_logs）单取，不进 UserRow。
export interface UserRow { id: number; email?: string; username?: string; role?: string; status?: string; balance?: number; concurrency?: number; created_at?: string; last_active_at?: string | null; total_recharged?: number }
export const getUsers = (site: number) => req<UserRow[]>('GET', `/api/users${qs({ site })}`)
export const setUserRole = (body: { site_id: number; user_id: number; role: string }) => req<any>('POST', '/api/users/role', body)
export const setUserStatus = (body: { site_id: number; user_id: number; status: string }) => req<any>('POST', '/api/users/status', body)
export interface BulkDeleteResult { ok?: boolean; error?: string; requested: number; deleted: number; failed: number; errors: Array<{ id: number; error: string }> }
export const bulkDeleteUsers = (body: { site_id: number; user_ids: number[] }) => req<BulkDeleteResult>('POST', '/api/users/bulk-delete', body)
export interface UserIpInfo { last_ip: string; last_at: string; all_ips: string[] }
export interface UsersIpMap { ips: Record<number, UserIpInfo>; users_with_ip: number; synced_at: string | null }
export const getUsersIpMap = (site: number) => req<UsersIpMap>('GET', `/api/users/ip-map${qs({ site })}`)   // 读本地缓存，秒级
export const syncUsersIp = (site: number) => req<UsersIpMap>('POST', '/api/users/ip-sync', { site_id: site })  // 触发增量同步后回读

// ---- 站点 ----
export const getSites = () => req<SiteInfo[]>('GET', '/api/sites')
export const addSite = (body: any) => req<any>('POST', '/api/sites', body)
export const updateSite = (id: number, body: any) => req<any>('PUT', `/api/sites/${id}`, body)
export const deleteSite = (id: number) => req<any>('DELETE', `/api/sites/${id}`)
export const checkSite = (id: number) => req<any>('POST', `/api/sites/${id}/check`)
export const probeSite = (body: any) => req<any>('POST', '/api/sites/probe', body)
export const getConsolePubkey = () => req<{ pubkey: string }>('GET', '/api/console-pubkey')
export const changeAdminPassword = (old_password: string, new_password: string) => req<{ ok: boolean }>('POST', '/api/admin-password', { old_password, new_password })
