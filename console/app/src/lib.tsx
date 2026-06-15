// 共享层：i18n 文案 + 格式化 + 通用组件(Modal/Toast/Tag/Usage/MetricCard)。
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type Lang = 'zh' | 'en'

export const copy = {
  zh: {
    brand: 'Sub2API 控制台', brandSub: '统一运维平台',
    login: '登录', logout: '退出', password: '管理员密码', loginTitle: '登录控制台', loginDesc: '请输入管理员密码以访问平台。', loginErr: '密码错误',
    site: '站点', addSite: '添加站点', refresh: '刷新', search: '搜索', apply: '应用', cancel: '取消', confirm: '确定', save: '保存', close: '关闭', edit: '编辑', delete: '删除', loading: '加载中…', noData: '暂无数据', noRecords: '暂无记录',
    // 导航分组
    navObs: '观测', navPool: '账号池', navAdmin: '平台管理',
    nav_overview: '请求总览', nav_feedback: '反馈核对', nav_errors: '错误日志', nav_slow: '慢请求', nav_timeline: '请求趋势',
    nav_pool: '账号池总览', nav_accounts: '账号管理', nav_batches: '导入批次', nav_recycle: '回收站',
    nav_users: '用户管理', nav_sites: '站点管理', nav_settings: '设置',
    // 观测
    total: '总请求', success: '成功', failed: '失败', successRate: '成功率', p95: 'P95 延迟', allRecorded: '已记录总量', currentWindow: '当前时间窗', firstToken: '首字',
    successHint: '成功请求数', failedHint: '失败请求数',
    feedbackDesc: '用用户提供的时间、模型、Key、错误或 Request ID 反查记录。',
    allModels: '全部模型', allStatus: '全部状态', statusSuccess: '成功', statusError: '失败',
    requestPlaceholder: 'Request ID / 用户邮箱 / API Key / 错误关键词',
    colTime: '时间', colRequest: '请求', colUserKey: '用户/Key', colModel: '模型', colResult: '结果', colOwner: '归因', colLatency: '耗时', colSummary: '摘要',
    trend: '请求趋势', attribution: '错误归因', errors: '错误', attention: '最近需要处理', attentionDesc: '按错误量、影响面聚合。', noHotErrors: '暂无高频错误', noHotErrorsDesc: '当前 1 小时没有明显错误聚合。',
    obsUnavailable: '该站点未接入可观测（需 sub2api postgres 直连）。观测仅对本机站点可用。',
    // 账号池总览
    poolTotal: '账号总数', poolAlive: '存活', poolRateLimited: '限流', poolDead: '失效', poolNoCodex: '无 codex 权限', poolPending: '待盘点', poolExpiring: '7天内到期',
    byGroup: '分组分布', grpAlive: '存活', grpDead: '失效', grpTotal: '总量', probeGroup: '盘点本组', deleteGroup: '删除整组',
    // 账号管理
    accounts: '账号', importAccounts: '导入账号', upstreamImport: '中转接入', probeSelected: '盘点选中', selected: '已选', clearSel: '清空',
    bulkEdit: '批量编辑', opPriority: '优先级', opConcurrency: '并发', opProxy: '代理', opGroup: '分组', dangerLabel: '清理/删除', clearError: '清错误', clearRate: '清限流', deleteAccount: '删除账号',
    selByCond: '按条件选中', condDead: '失效', condRate: '限流', condNoCodex: '无codex权限', condPending: '待盘点', condAlive: '满额活号', condAll: '全部',
    colId: 'ID', colName: '名称/邮箱', colType: '类型', colVerdict: '判活', colStatus: '平台状态', colUsage: '用量(主/5h)', colPriority: '优先级', colProbe: '上次盘点',
    accountSearch: '搜索 邮箱 / 名称', selectGroup: '选择分组', allGroups: '全部分组', noProxy: '不设代理',
    probing: '盘点中', cleaning: '清理中', stop: '急停',
    confirmDelete: '确认删除选中账号？该操作会从 sub2api 真删（可在回收站恢复有 refresh_token 的号）。',
    confirmClearErr: '确认清除选中账号的错误状态？', confirmClearRate: '确认清除选中账号的限流状态？',
    // 批次
    batches: '导入批次', batchesDesc: '「导入批次」指某一次导入操作纳入的一批账号（每批对应平台里的一个分组）。', batchName: '批次名', batchAccounts: '账号数', batchImported: '导入时间', batchLastSnap: '最近盘点', probeBatch: '盘点', deleteBatch: '删除批次',
    confirmDeleteBatch: '删除该批次会连带删除 sub2api 远端账号与分组，确认？',
    // 回收站
    recycle: '回收站', recycleDeletedAt: '删除时间', recycleReason: '原因', restore: '恢复', canRestore: '可恢复', cannotRestore: '无 token',
    // 用户
    users: '用户', colEmail: '邮箱', colRole: '角色', colUserStatus: '状态', colBalance: '余额', colConcurrency: '并发', roleAdmin: '管理员', roleUser: '普通', statusActive: '启用', statusDisabled: '禁用', setAdmin: '设为管理员', setUser: '设为普通', enable: '启用', disable: '禁用',
    roleChannelOff: '该站点未配置提权通道，无法改 role',
    // 站点
    sites: '站点', siteName: '站点名', siteBaseUrl: 'Base URL (/api/v1)', siteAdminKey: 'Admin API Key', siteKind: '类型', siteLocal: '本机', siteRemote: '远程', sitePgContainer: 'PG 容器名', siteSshHost: 'SSH 目标(远程)', siteHealth: '健康', siteCheck: '测连接', siteProbeOk: '连接成功', addSiteTitle: '添加站点', editSiteTitle: '编辑站点', deleteSiteConfirm: '删除站点会清空其本地派生数据（不影响 sub2api），确认？',
    siteBasicHint: '必填(基础管理：账号池/批量/清理/删除/用户启禁)：站点名 + Base URL + Admin API Key + 类型。',
    siteChannelHint: '选填(提权通道，解锁 改role + oauth盘点 + 观测)：远程站点填 SSH 目标(root@IP，非22端口写 root@IP:端口) + PG 容器名(目标机 docker ps 查，官方部署默认 sub2api-postgres)。',
    sitePubkeyTitle: '① 先把本平台 SSH 公钥加到目标机 ~/.ssh/authorized_keys：',
    sitePubkeyCopied: '公钥已复制',
    siteKeyHowto: 'Admin API Key 获取：登录该 sub2api 管理员 → 接受合规承诺 → 管理员设置→Admin API Key→生成。',
    siteBaseUrlHint: '与本平台同 docker 网络可用容器名，如 http://sub2api:8080/api/v1（填公网 IP 容器内可能不通）。',
    pubkeyMissing: '未检测到本平台 SSH 公钥：请在部署目录生成 secrets/ssh/id_ed25519 并随 compose 挂载，否则远程站点提权(改role/盘点/观测)不可用。',
    setupTitle: '首次配置', setupHint: '系统尚未设置管理员密码。请在部署目录的 .env 里设置 CONSOLE_ADMIN_PASSWORD=<你的密码>，然后 docker-compose up -d 重启，再回此页登录。',
    firstSiteTitle: '欢迎使用 Sub2API 控制台', firstSiteCta: '还没有站点。点此添加第一个 sub2api 站点开始。', addFirstSite: '添加第一个站点',
    changePw: '修改管理员密码', changePwOld: '原密码', changePwNew: '新密码(≥6位)', changePwApply: '更新密码', changePwOk: '密码已更新',
    // 导入弹层
    importTitle: '导入账号(批次)', importDesc: '粘贴 CPA 单号 JSON 或 sub2 导出 JSON（每行一个或一个数组）。', importBatchName: '批次名(可选)', importPriority: '优先级', importConcurrency: '并发', importContent: '账号 JSON',
    upstreamTitle: '中转接入', upstreamDesc: '把一个中转(上游 base_url + api_key)接入为 apikey 账号并绑定分组；可选同时建渠道监控。', upstreamBaseUrl: '上游 Base URL (含 /v1)', upstreamTiers: '档位',
    upRelayName: '账号名', upPlatform: '平台', upGroup: '分组名', upGroupPh: '留空默认用账号名', upApiKey: '上游 API Key', upModelMap: '模型映射(可选)',
    upMonitor: '同时创建渠道监控(监控此上游)', upMonModel: '探测模型', upMonInterval: '间隔(秒)', upMonHint: '监控直接打 base_url 的 origin(需 https)，用上面的 api_key。',
    upKeyNote: '', upRelayNeed: '至少一档需填 账号名 + api_key，且填 base_url',
    upTiers: '档位（账号名 + api_key，可加多档批量）', upAddTier: '加一档',
    upCreateKey: '同时创建「使用用」API Key（需 sub2api 用户登录）', upUserEmail: 'sub2api 用户邮箱', upUserPass: '密码',
    upKeyLoginHint: '用此登录(JWT)调 /keys 建 key 绑分组；凭据仅本次使用、不存储；明文 key 仅返回一次。',
    upDone: '接入完成', upResultAcc: '建账号', upKeyOnce: '使用 API Key（明文仅此一次，请立即保存）：',
    // 设置
    settingsTitle: '面板设置', language: '语言', theme: '浅色数据中台', sourceTruth: '单一真相源',
    sourceTruthDesc: '账号/分组/成员/token 一律实时回源 sub2api；本地仅存派生元数据。',
    settingsNoModify: '不修改 sub2api 源码', settingsNoModifyDesc: '通过补充代码扩展，保证 sub2api 升级安全。',
  },
  en: {
    brand: 'Sub2API Console', brandSub: 'Unified Ops Platform',
    login: 'Sign in', logout: 'Sign out', password: 'Admin password', loginTitle: 'Console Login', loginDesc: 'Enter admin password to access the platform.', loginErr: 'Wrong password',
    site: 'Site', addSite: 'Add site', refresh: 'Refresh', search: 'Search', apply: 'Apply', cancel: 'Cancel', confirm: 'Confirm', save: 'Save', close: 'Close', edit: 'Edit', delete: 'Delete', loading: 'Loading…', noData: 'No data', noRecords: 'No records',
    navObs: 'Observe', navPool: 'Account Pool', navAdmin: 'Admin',
    nav_overview: 'Overview', nav_feedback: 'Feedback', nav_errors: 'Error Logs', nav_slow: 'Slow', nav_timeline: 'Trend',
    nav_pool: 'Pool Overview', nav_accounts: 'Accounts', nav_batches: 'Import Batches', nav_recycle: 'Recycle Bin',
    nav_users: 'Users', nav_sites: 'Sites', nav_settings: 'Settings',
    total: 'Total', success: 'Success', failed: 'Failed', successRate: 'Success Rate', p95: 'P95 Latency', allRecorded: 'all recorded', currentWindow: 'current window', firstToken: 'first token',
    successHint: 'successful', failedHint: 'failed',
    feedbackDesc: 'Trace records by time, model, key, error or Request ID from user reports.',
    allModels: 'All models', allStatus: 'All status', statusSuccess: 'Success', statusError: 'Error',
    requestPlaceholder: 'Request ID / user email / API key / error keyword',
    colTime: 'Time', colRequest: 'Request', colUserKey: 'User/Key', colModel: 'Model', colResult: 'Result', colOwner: 'Owner', colLatency: 'Latency', colSummary: 'Summary',
    trend: 'Request Trend', attribution: 'Error Attribution', errors: 'errors', attention: 'Needs Attention', attentionDesc: 'Aggregated by error volume and impact.', noHotErrors: 'No hot errors', noHotErrorsDesc: 'No obvious error cluster in the last hour.',
    obsUnavailable: 'Observability not available for this site (needs direct sub2api postgres). Local site only.',
    poolTotal: 'Total accounts', poolAlive: 'Alive', poolRateLimited: 'Rate limited', poolDead: 'Dead', poolNoCodex: 'No codex perm', poolPending: 'Pending', poolExpiring: 'Expiring 7d',
    byGroup: 'By Group', grpAlive: 'alive', grpDead: 'dead', grpTotal: 'total', probeGroup: 'Probe group', deleteGroup: 'Delete group',
    accounts: 'Accounts', importAccounts: 'Import', upstreamImport: 'Upstream', probeSelected: 'Probe selected', selected: 'Selected', clearSel: 'Clear',
    bulkEdit: 'Bulk edit', opPriority: 'Priority', opConcurrency: 'Concurrency', opProxy: 'Proxy', opGroup: 'Group', dangerLabel: 'Clean / Delete', clearError: 'Clear error', clearRate: 'Clear rate-limit', deleteAccount: 'Delete',
    selByCond: 'Select by', condDead: 'Dead', condRate: 'Rate-limited', condNoCodex: 'No codex', condPending: 'Pending', condAlive: 'Healthy', condAll: 'All',
    colId: 'ID', colName: 'Name/Email', colType: 'Type', colVerdict: 'Verdict', colStatus: 'Status', colUsage: 'Usage(main/5h)', colPriority: 'Priority', colProbe: 'Last probe',
    accountSearch: 'Search email / name', selectGroup: 'Select group', allGroups: 'All groups', noProxy: 'No proxy',
    probing: 'Probing', cleaning: 'Cleaning', stop: 'Stop',
    confirmDelete: 'Delete selected accounts? This really deletes them from sub2api (restorable from recycle bin if refresh_token exists).',
    confirmClearErr: 'Clear error state of selected accounts?', confirmClearRate: 'Clear rate-limit state of selected accounts?',
    batches: 'Import Batches', batchesDesc: 'An "import batch" is the group of accounts brought in by one import (each maps to one platform group).', batchName: 'Batch', batchAccounts: 'Accounts', batchImported: 'Imported', batchLastSnap: 'Last probe', probeBatch: 'Probe', deleteBatch: 'Delete batch',
    confirmDeleteBatch: 'Deleting this batch will also delete its sub2api accounts and group. Confirm?',
    recycle: 'Recycle Bin', recycleDeletedAt: 'Deleted at', recycleReason: 'Reason', restore: 'Restore', canRestore: 'Restorable', cannotRestore: 'No token',
    users: 'Users', colEmail: 'Email', colRole: 'Role', colUserStatus: 'Status', colBalance: 'Balance', colConcurrency: 'Concurrency', roleAdmin: 'Admin', roleUser: 'User', statusActive: 'Active', statusDisabled: 'Disabled', setAdmin: 'Make admin', setUser: 'Make user', enable: 'Enable', disable: 'Disable',
    roleChannelOff: 'No escalation channel configured for this site',
    sites: 'Sites', siteName: 'Name', siteBaseUrl: 'Base URL (/api/v1)', siteAdminKey: 'Admin API Key', siteKind: 'Kind', siteLocal: 'Local', siteRemote: 'Remote', sitePgContainer: 'PG container', siteSshHost: 'SSH host (remote)', siteHealth: 'Health', siteCheck: 'Test', siteProbeOk: 'Connected', addSiteTitle: 'Add Site', editSiteTitle: 'Edit Site', deleteSiteConfirm: 'Deleting a site clears its local derived data (sub2api untouched). Confirm?',
    siteBasicHint: 'Required (basic mgmt: pool/bulk/cleanup/delete/user-status): Name + Base URL + Admin API Key + Kind.',
    siteChannelHint: 'Optional (escalation channel → unlocks role change + oauth probe + observability): for remote, set SSH host (root@IP, non-22: root@IP:port) + PG container (docker ps on target; default sub2api-postgres).',
    sitePubkeyTitle: '① First add this console SSH public key to the target machine ~/.ssh/authorized_keys:',
    sitePubkeyCopied: 'Public key copied',
    siteKeyHowto: 'Get Admin API Key: log into that sub2api as admin → accept compliance → Admin Settings → Admin API Key → generate.',
    siteBaseUrlHint: 'On the same docker network you can use the container name, e.g. http://sub2api:8080/api/v1 (a public IP may be unreachable from inside the container).',
    pubkeyMissing: 'No console SSH public key found: generate secrets/ssh/id_ed25519 in the deploy dir and mount it via compose, otherwise remote-site escalation (role/probe/observability) is unavailable.',
    setupTitle: 'First-time setup', setupHint: 'No admin password is set yet. Put CONSOLE_ADMIN_PASSWORD=<your password> in the deploy dir .env, run docker-compose up -d to restart, then come back and log in.',
    firstSiteTitle: 'Welcome to Sub2API Console', firstSiteCta: 'No sites yet. Add your first sub2api site to get started.', addFirstSite: 'Add first site',
    changePw: 'Change admin password', changePwOld: 'Current password', changePwNew: 'New password (≥6)', changePwApply: 'Update password', changePwOk: 'Password updated',
    importTitle: 'Import accounts (batch)', importDesc: 'Paste CPA account JSON or sub2 export JSON (one per line or an array).', importBatchName: 'Batch name (optional)', importPriority: 'Priority', importConcurrency: 'Concurrency', importContent: 'Account JSON',
    upstreamTitle: 'Relay import', upstreamDesc: 'Onboard a relay (upstream base_url + api_key) as an apikey account bound to a group; optionally create a channel monitor.', upstreamBaseUrl: 'Upstream Base URL (with /v1)', upstreamTiers: 'Tiers',
    upRelayName: 'Account name', upPlatform: 'Platform', upGroup: 'Group name', upGroupPh: 'blank = use account name', upApiKey: 'Upstream API Key', upModelMap: 'Model mapping (optional)',
    upMonitor: 'Also create a channel monitor (for this upstream)', upMonModel: 'Probe model', upMonInterval: 'Interval (s)', upMonHint: 'Monitor hits the origin of base_url (https required) using the api_key above.',
    upKeyNote: '', upRelayNeed: 'Need at least one tier (account name + api_key) and base_url',
    upTiers: 'Tiers (account name + api_key; add multiple for batch)', upAddTier: 'Add tier',
    upCreateKey: 'Also create a usage API Key (requires sub2api user login)', upUserEmail: 'sub2api user email', upUserPass: 'Password',
    upKeyLoginHint: 'Uses this login (JWT) to call /keys and bind the group; credentials used only now, not stored; plaintext key returned once.',
    upDone: 'Onboarded', upResultAcc: 'Accounts', upKeyOnce: 'Usage API Key (plaintext shown once — save it now):',
    settingsTitle: 'Panel Settings', language: 'Language', theme: 'Light data console', sourceTruth: 'Single source of truth',
    sourceTruthDesc: 'Accounts/groups/members/tokens always read live from sub2api; only derived metadata stored locally.',
    settingsNoModify: 'No sub2api modification', settingsNoModifyDesc: 'Extended via supplementary code; safe for sub2api upgrades.',
  },
} as const

export type Copy = typeof copy['zh']

// ---- 格式化 ----
export const formatInt = (v: number) => new Intl.NumberFormat('en-US').format(Math.round(v || 0))
export const formatPercent = (v: number) => `${(v || 0).toFixed(2)}%`
export const formatMs = (v: number) => (!v ? '0ms' : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`)
export function formatTime(value: string, lang: Lang) {
  if (!value) return '-'
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value))
}

export const OWNER_COLORS: Record<string, string> = { provider: '#f59e0b', client: '#2563eb', platform: '#e11d48', normal: '#059669', unknown: '#94a3b8' }
export const ownerColor = (o: string) => OWNER_COLORS[o] || OWNER_COLORS.unknown
export function ownerLabel(o: string, lang: Lang) {
  const m: Record<string, [string, string]> = { provider: ['上游', 'Provider'], client: ['用户', 'Client'], platform: ['平台', 'Platform'], normal: ['正常', 'Normal'], unknown: ['未知', 'Unknown'] }
  return (m[o] || m.unknown)[lang === 'zh' ? 0 : 1]
}
export function verdictLabel(v: string | null | undefined, lang: Lang) {
  const m: Record<string, [string, string]> = { alive: ['存活', 'Alive'], dead: ['失效', 'Dead'], auth_fail: ['失效', 'Auth fail'], rate_limited: ['限流', 'Rate-limited'], no_codex_perm: ['无codex', 'No codex'], transient: ['抖动', 'Transient'], pending: ['待盘点', 'Pending'] }
  return (m[v || 'pending'] || ['待盘点', 'Pending'])[lang === 'zh' ? 0 : 1]
}

export const cls = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(' ')

// ---- 组件 ----
export function MetricCard({ label, value, hint, tone = 'blue' }: { label: string; value: string; hint?: string; tone?: string }) {
  return <div className="metric-card"><span>{label}</span><strong className={tone}>{value}</strong>{hint && <small>{hint}</small>}</div>
}

export function VerdictTag({ v, lang }: { v: string | null | undefined; lang: Lang }) {
  const k = v || 'pending'
  return <span className={cls('tag', k)}>{verdictLabel(v, lang)}</span>
}

export function Usage({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return <span className="muted">—</span>
  const p = Math.max(0, Math.min(100, pct))
  const tone = p >= 90 ? 'high' : p >= 70 ? 'warn' : ''
  return <span className="usage"><span className="usage-bar"><span className={cls('usage-fill', tone)} style={{ width: `${p}%` }} /></span><small>{Math.round(p)}%</small></span>
}

export function Spinner() { return <span className="spinner" aria-hidden="true" /> }

/** 表格加载骨架行（占位防跳动）。放进 <tbody> 用。 */
export function SkeletonRows({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return <>{Array.from({ length: rows }).map((_, i) => (
    <tr key={`sk${i}`}>{Array.from({ length: cols }).map((__, j) => (
      <td key={j}><span className="skeleton sk-cell" /></td>
    ))}</tr>
  ))}</>
}

/** 卡片加载骨架（总览类）。 */
export function SkeletonCards({ n = 6 }: { n?: number }) {
  return <div className="skeleton-cards">{Array.from({ length: n }).map((_, i) => <div key={i} className="skeleton sk-card" />)}</div>
}

export function Modal({ title, desc, onClose, children, actions }: { title: string; desc?: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  // 用 portal 挂到 document.body：脱离 .fade-rise(transform 动画) 子树，避免 position:fixed 定位基准错乱/被顶栏遮挡。
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {desc && <p className="muted">{desc}</p>}
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  )
}

// ---- Toast ----
type Toast = { id: number; msg: string; kind: 'ok' | 'err' }
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'err') => void>(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.floor(performance.now())
    setToasts((t) => [...t, { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500)
  }, [])
  return <ToastCtx.Provider value={push}>{children}<div className="toast-wrap">{toasts.map((t) => <div key={t.id} className={cls('toast', t.kind)}>{t.msg}</div>)}</div></ToastCtx.Provider>
}
