// 共享层：i18n 文案 + 格式化 + 通用组件(Modal/Toast/Tag/Usage/MetricCard) + 跨页 SWR 缓存。
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type Lang = 'zh' | 'en'

export const copy = {
  zh: {
    brand: 'Sub2API 控制台', brandSub: '统一运维平台',
    login: '登录', logout: '退出', password: '管理员密码', loginTitle: '登录控制台', loginDesc: '请输入管理员密码以访问平台。', loginErr: '密码错误',
    themeLight: '浅色', themeDark: '深色', themeToggle: '切换主题',
    site: '站点', addSite: '添加站点', refresh: '刷新', search: '搜索', apply: '应用', cancel: '取消', confirm: '确定', save: '保存', close: '关闭', edit: '编辑', delete: '删除', loading: '加载中…', noData: '暂无数据', noRecords: '暂无记录',
    // 导航分组
    navObs: '观测', navPool: '账号池', navAdmin: '平台管理',
    nav_overview: '请求总览', nav_feedback: '反馈核对', nav_errors: '错误日志', nav_slow: '慢请求', nav_timeline: '请求趋势', nav_usage: '用户用量',
    nav_pool: '账号池总览', nav_accounts: '账号管理', nav_groups: '分组管理', nav_batches: '导入批次', nav_recycle: '回收站',
    nav_users: '用户管理', nav_sites: '站点管理', nav_settings: '设置',
    // 观测
    total: '总请求', success: '成功', failed: '失败', successRate: '成功率', p95: 'P95 延迟', allRecorded: '已记录总量', currentWindow: '当前时间窗', firstToken: '首字',
    tokens: 'Token 消耗', cost: '费用', tokensHint: '入 {in} / 出 {out}', showing: '显示 {n} / 共 {total} 条', slowCount: '慢请求',
    successHint: '成功请求数', failedHint: '失败请求数',
    feedbackDesc: '用用户提供的时间、模型、Key、错误或 Request ID 反查记录。',
    allModels: '全部模型', allStatus: '全部状态', statusSuccess: '成功', statusError: '失败',
    requestPlaceholder: 'Request ID / 用户邮箱 / API Key / 错误关键词',
    colTime: '时间', colRequest: '请求', colUserKey: '用户/Key', colModel: '模型', colResult: '结果', colOwner: '归因', colLatency: '耗时', colSummary: '摘要', colTokens: '消耗(入/出)', colUpstream: '上游账号',
    trend: '请求趋势', attribution: '错误归因', errors: '错误', attention: '最近需要处理', attentionDesc: '按错误量、影响面聚合。', noHotErrors: '暂无高频错误', noHotErrorsDesc: '当前 1 小时没有明显错误聚合。',
    obsUnavailable: '该站点未接入可观测（需 sub2api postgres 直连）。观测仅对本机站点可用。',
    // 观测：自定义时段 + 翻页
    obsRangeCustom: '自定义', obsRangeStart: '开始', obsRangeEnd: '结束', obsRangeHint: '起止时间（上海时区）', obsRangeInvalid: '开始时间需早于结束时间',
    pagePrev: '上一页', pageNext: '下一页', pageInfo: '第 {page}/{pages} 页 · 共 {total} 条', pageSizeLabel: '每页',
    // 用户用量报告
    ur_title: '用户用量报告', ur_desc: '输入用户邮箱与时间段，核对该用户的消费与缓存构成（可直接截图发给用户）。',
    ur_emailPlaceholder: '用户邮箱（精确或模糊关键词）', ur_lookup: '查询', ur_enterEmail: '输入用户邮箱、选择时间段后点「查询」。',
    ur_rangeToday: '今天', ur_range7d: '近7天', ur_range30d: '近30天', ur_rangeMonth: '本月', ur_rangeCustom: '自定义',
    ur_startDate: '起始', ur_endDate: '结束', ur_tzNote: '时区：上海(UTC+8)', ur_period: '报告时段',
    ur_notFound: '未找到该邮箱用户', ur_notFoundHint: '请检查邮箱拼写，或换用模糊关键词重试。',
    ur_ambiguous: '匹配到多个用户，请点选其一', ur_colCandidate: '候选用户',
    ur_role: '角色', ur_status: '状态', ur_created: '注册时间', ur_lastActive: '最近活跃', ur_keysHit: '命中 Key 数',
    ur_totalCost: '时段总消费', ur_cacheReadCostShare: '缓存读取占费', ur_totalTokens: '总 Token 量', ur_cacheReadMultiple: '缓存读 ÷ 真实输入',
    ur_successRequests: '成功请求数', ur_avgCostPerReq: '每次请求均价', ur_reconcileDiff: '账面对账差额', ur_balance: '余额 / 累计充值',
    ur_cacheHitRate: '缓存命中率', ur_reconcileOk: '账面对平', ur_reconcileBad: '存在偏差，待核',
    ur_failedHint: '另有 {n} 次失败请求(不计费)', ur_cacheReadHint: '其中缓存读取 {v}',
    ur_verdict: '一句话结论', ur_copyVerdict: '复制结论', ur_copied: '已复制',
    ur_verdictTpl: '用户 {email} 在 {start} ~ {end} 共 {n} 次成功请求，消费 {total}；其中 {cacheReadCost}（占 {pct}）来自「缓存读取」——即模型重复读取你之前对话的上下文，token 量达 {cacheReadTokens}，是新增输入的 {ratio}。费用与请求一一对应，无异常扣费。',
    ur_costBreakdown: '消费构成（缓存 vs 真实生成）', ur_tokenBreakdown: 'Token 去向',
    ur_costInput: '输入(真实提问)', ur_costOutput: '输出(模型回答)', ur_costCacheCreation: '缓存创建', ur_costCacheRead: '缓存读取',
    ur_cacheExplainTitle: '缓存是什么 · 给用户的话',
    ur_cacheExplainBody: '缓存读取(cache read) = 你每次提问，模型都要重新读一遍你这次对话里之前说过的全部内容，才能接着回答。对话越长、轮次越多，每轮要重读的就越多，所以 token 会快速累积。这部分按更低单价计费，但因量大仍占可观费用——属按量计费的正常现象，非平台多扣。',
    ur_dailyTrend: '逐日用量与核对', ur_byModel: '按模型拆分', ur_byKey: '按 API Key 拆分', ur_topRequests: '最贵的若干请求',
    ur_byAccount: '上游账号分布', ur_acctPrimary: '主力',
    ur_acctSummaryMulti: '本时段 {n} 个上游账号承接；主力 {top} 占请求 {share}、命中率 {hit}；其余 {rest} 个合计占 {restShare}。',
    ur_acctSummaryOne: '本时段全部请求集中在 1 个上游账号 {top}，命中率 {hit}——高度集中，缓存条件最佳。',
    ur_acctExplain: '缓存亲和绑定在上游账号上：同一对话粘在同一个号才会命中缓存。请求越集中在少数号、命中率越高；分散到越多号、缓存越易被打散——可对照逐日表的「上游号数」看。',
    ur_integrityTitle: '计费诚信声明',
    ur_integrityBody: '数据直接来自 sub2api 计费库 usage_logs，仅统计成功请求；失败请求不计费（本时段 {failed} 条）。缓存读取为按上游缓存命中计费的真实 token，单价低于普通输入但量大。报告时段：{start} ~ {end}（上海时区）。',
    ur_colDay: '日期', ur_colRequests: '请求数', ur_colModel: '模型', ur_colKey: 'API Key', ur_colQuota: '配额', ur_colQuotaUsed: '已用配额',
    ur_colInputTokens: '输入 Token', ur_colOutputTokens: '输出 Token', ur_colCacheReadTokens: '缓存读 Token',
    ur_colAccount: '上游账号', ur_colPlatform: '平台', ur_colReqShare: '请求占比', ur_colAccounts: '上游号数',
    ur_colTotalCost: '费用', ur_colCacheShare: '缓存占费', ur_colDiff: '差额', ur_colTime: '时间', ur_total: '合计',
    ur_noUsage: '该时段无成功请求', ur_noUsageFailed: '该时段全为失败请求、未产生费用（{n} 条）',
    // 账号池总览
    poolTotal: '账号总数', poolAlive: '存活', poolRateLimited: '限流', poolDead: '失效', poolNoCodex: '无 codex 权限', poolPending: '待盘点', poolExpiring: '7天内到期',
    byGroup: '分组分布', grpAlive: '存活', grpDead: '失效', grpTotal: '总量', probeGroup: '盘点本组', deleteGroup: '删除整组',
    // 分组管理（账号↔分组 成员）
    grpManageTitle: '分组管理', grpManageDesc: '从分组视角管理：选择一个分组，勾选哪些账号属于它。API 按分组路由，勾中的账号即该分组可用的上游号。',
    grpPickGroup: '选择分组', grpPickGroupHint: '点选上方分组以编辑其成员账号。', grpMembersCount: '成员',
    grpColInGroup: '属于本组', grpColGroups: '所属分组', grpSave: '保存更改', grpRevert: '撤销', grpNoChanges: '无改动',
    grpPendingTpl: '待加入 {a} · 待移出 {r}', grpSavedTpl: '已加入 {a} · 已移出 {r}（失败 {f}）',
    grpSearchAcct: '搜索账号 邮箱/名称', grpFilterAll: '全部', grpFilterMembers: '本组成员', grpFilterNon: '非成员',
    grpRate: '倍率', grpConfirmSave: '确认：加入 {a} 个、移出 {r} 个账号？', grpEmptyAccts: '该站点暂无账号', grpEmptyGroups: '该站点暂无分组', grpSelectedCount: '已勾选 {n}',
    grpSearchGroup: '搜索分组', grpSortName: '名称', grpSortCount: '成员', grpJoinGroup: '加入本组', grpLeaveGroup: '移出本组', grpMemberYes: '本组',
    grpJoinedTpl: '已加入 {n}（失败 {f}）', grpLeftTpl: '已移出 {n}（失败 {f}）',
    grpSortCustom: '自定义', grpReorderHint: '拖动排序', grpOrderSaved: '顺序已保存',
    // 分组密钥（本组「使用用」API Key）
    gkTitle: '本组 API 密钥', gkDesc: '以站点管理员账号管理：绑定本组的「使用用」密钥。明文仅创建时显示一次。',
    gkNew: '新建密钥', gkNamePlaceholder: '密钥名称（可留空，自动命名）', gkCreate: '创建', gkCreating: '创建中…',
    gkColName: '名称', gkColKey: '密钥', gkColStatus: '状态', gkColQuota: '额度(用/限)', gkColCreated: '创建于', gkColUsed: '最近使用', gkColAction: '操作',
    gkCreated: '密钥已创建', gkDeleted: '密钥已删除', gkCopied: '已复制到剪贴板', gkCopy: '复制',
    gkPlainHint: '请立即复制并妥善保存——明文仅此一次，关闭后无法再查看。', gkDismiss: '我已保存',
    gkConfirmDelete: '确认删除密钥「{name}」？删除后用此 key 的调用将立即失效。',
    gkNoKeys: '本组暂无密钥', gkNever: '从未',
    gkNoAdminLogin: '该站点未配置 sub2api 管理员登录，无法管理密钥。请在「站点」里填写管理员邮箱+密码后重试。',
    // 账号管理
    accounts: '账号', importAccounts: '导入账号', upstreamImport: '中转接入', probeSelected: '盘点选中', selected: '已选', clearSel: '清空',
    bulkEdit: '批量编辑', opPriority: '优先级', opConcurrency: '并发', opProxy: '代理', opGroup: '分组', dangerLabel: '清理/删除', clearError: '清错误', clearRate: '清限流', deleteAccount: '删除账号',
    selByCond: '按条件选中', condDead: '失效', condRate: '限流', condNoCodex: '无codex权限', condPending: '待盘点', condAlive: '满额活号', condAll: '全部',
    colId: 'ID', colName: '名称/邮箱', colType: '类型', colVerdict: '判活', colStatus: '平台状态', colUsage: '用量 5h/7d', colPriority: '优先级', colProbe: '上次盘点',
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
    // 恶意账号清理
    mc_title: '恶意账号清理', mc_toggle: '恶意账号清理', mc_hide: '收起',
    mc_desc: '按邮箱「域名 / 后缀 / +号别名 / 子串」筛选可疑注册并批量删除：先点「筛选并全选」预览、核对后再删。删除为 sub2api 软删 + 级联软删其 API key，admin 账号自动跳过。筛选生效后条件会锁定（只能在命中集里取消勾选），要改条件先点「清除筛选」。',
    mc_domains: '域名 / 后缀', mc_domainsPh: '如 sharklasers.com, web-library.net, .top（逗号/空格/换行分隔）',
    mc_presets: '常见一次性域名', mc_plusAlias: '含 + 号别名', mc_substr: '邮箱含子串', mc_substrPh: '子串(可空)',
    mc_zeroOnly: '仅零充值零余额(更安全)', mc_filterSelect: '筛选并全选匹配', mc_clearFilter: '清除筛选',
    mc_matched: '匹配 {n} / 共 {m}', mc_filterActive: '筛选中(条件已锁定，仅显示并选中命中项)', mc_noCriteria: '请先填域名/后缀、勾选别名或填子串',
    mc_deleteSel: '删除选中', mc_deleting: '删除中…',
    mc_confirmDelete: '确认从 sub2api 删除选中的 {n} 个用户？\n软删 + 级联软删其 API key；admin 账号会被跳过。',
    mc_doneTpl: '删除完成：成功 {ok} · 失败 {fail}(共 {req})',
    mc_colLastIp: '最近使用IP', mc_colCreated: '注册时间', mc_colRecharged: '累计充值',
    mc_ipSearchPh: '按使用IP搜索', mc_ipLoading: '同步中…', mc_ipMeta: '已载入 {n} 个号的IP',
    mc_ipReload: '刷新IP', mc_ipNeedSync: '暂无, 点「刷新IP」同步',
    mc_ipMetaHint: '最近使用IP 读自 console 本地缓存（后台每~10分钟自动增量同步）；只覆盖调用过 API 的号；列里 +N=该号还用过 N 个别的 IP（悬停看全部）；点「刷新IP」立即同步一次。',
    mc_ipUnavail: 'ℹ 注册 IP sub2api 不记录（仅用于 Turnstile、用后即弃）；「最近使用IP」列与「按使用IP搜索」均来自 usage_logs（仅调用过 API 的号有，缓存后台增量更新）。可输入攻击者 IP 反查其名下账号，再多选→删除（=按 IP 清号）。',
    mc_noMatch: '无匹配用户',
    // 站点
    sites: '站点', siteName: '站点名', siteBaseUrl: 'Base URL (/api/v1)', siteAdminKey: 'Admin API Key', siteKind: '类型', siteLocal: '本机', siteRemote: '远程', sitePgContainer: 'PG 容器名', siteSshHost: 'SSH 目标(远程)', siteHealth: '健康', siteCheck: '测连接', siteProbeOk: '连接成功', addSiteTitle: '添加站点', editSiteTitle: '编辑站点', deleteSiteConfirm: '删除站点会清空其本地派生数据（不影响 sub2api），确认？',
    siteBasicHint: '必填(基础管理：账号池/批量/清理/删除/用户启禁)：站点名 + Base URL + Admin API Key + 类型。',
    siteChannelHint: '选填(提权通道，解锁 改role + oauth盘点 + 观测)：远程站点填 SSH 目标(root@IP，非22端口写 root@IP:端口) + PG 容器名(目标机 docker ps 查，官方部署默认 sub2api-postgres)。',
    sitePubkeyTitle: '① 先把本平台 SSH 公钥加到目标机 ~/.ssh/authorized_keys：',
    sitePubkeyCopied: '公钥已复制',
    siteSshCmdTitle: '② 或直接复制整条授权命令，到目标机粘贴执行（幂等，可重复跑）：',
    siteSshCmdHint: '以 ssh_host 里那个用户身份执行；之后回来填 SSH 目标，并在目标机安全组放行本控制台所在主机的出口 IP。',
    siteSshCmdCopied: '授权命令已复制',
    obsRefreshing: '刷新中…', obsUpdated: '更新于',
    siteKeyHowto: 'Admin API Key 获取：登录该 sub2api 管理员 → 接受合规承诺 → 管理员设置→Admin API Key→生成。',
    siteAdminEmail: '管理员登录邮箱', siteAdminPwd: '管理员登录密码', siteAdminLogin: 'admin 登录', siteAdminConfigured: '已配 admin 登录',
    siteAdminLoginHint: '中转接入「建 key」用：以此 sub2api 管理员登录拿 JWT 建 key（admin x-api-key 不能建 key，必须登录态）。每站点设一次，中转接入默认复用。',
    siteBaseUrlHint: '与本平台同 docker 网络可用容器名，如 http://sub2api:8080/api/v1（填公网 IP 容器内可能不通）。',
    pubkeyMissing: '未检测到本平台 SSH 公钥：请在部署目录生成 secrets/ssh/id_ed25519 并随 compose 挂载，否则远程站点提权(改role/盘点/观测)不可用。',
    setupTitle: '首次配置', setupHint: '系统尚未设置管理员密码。请在部署目录的 .env 里设置 CONSOLE_ADMIN_PASSWORD=<你的密码>，然后 docker-compose up -d 重启，再回此页登录。',
    firstSiteTitle: '欢迎使用 Sub2API 控制台', firstSiteCta: '还没有站点。点此添加第一个 sub2api 站点开始。', addFirstSite: '添加第一个站点',
    changePw: '修改管理员密码', changePwOld: '原密码', changePwNew: '新密码(≥6位)', changePwApply: '更新密码', changePwOk: '密码已更新',
    // 导入弹层
    importTitle: '导入账号(批次)', importDesc: '粘贴 CPA 单号 JSON 或 sub2 导出 JSON（整段 JSON / 数组 / 每行一个均可）。', importBatchName: '批次名(可选)', importPriority: '优先级', importConcurrency: '并发', importContent: '账号 JSON',
    importFormat: '账号格式', fmtAuto: '自动识别', fmtCpa: 'CPA 单号', fmtSub2: 'sub2 导出',
    importDrop: '拖入 .json 文件到此，或点击选择（可多选）',
    upstreamTitle: '中转接入', upstreamDesc: '把一个中转(上游 base_url + api_key)接入为 apikey 账号并绑定分组；可选同时建渠道监控。', upstreamBaseUrl: '上游 Base URL (含 /v1)', upstreamTiers: '档位',
    upRelayName: '账号名', upPlatform: '平台', upGroup: '分组名', upGroupPh: '留空默认用账号名', upApiKey: '上游 API Key', upModelMap: '模型映射(可选)',
    upMonitor: '同时创建渠道监控(监控此上游)', upMonModel: '探测模型', upMonInterval: '间隔(秒)', upMonHint: '监控直接打 base_url 的 origin(需 https)，用上面的 api_key。',
    upKeyNote: '', upRelayNeed: '至少一档需填 账号名 + api_key，且填 base_url',
    upTiers: '账号（账号名 + api_key，可加多个绑同组）', upAddTier: '加一个账号', upAddGroup: '加一个分组', upRemoveGroup: '删除此组',
    upCreateKey: '同时创建「使用用」API Key（默认用本站点 admin）', upUserEmail: 'sub2api 用户邮箱', upUserPass: '密码',
    upKeyUseSiteAdmin: '默认用本站点已配的管理员账号登录建 key（在「站点」里设置一次）。', upKeyOverride: '自定义登录账号（仅覆盖本次）',
    upKeyLoginHint: '留空 = 用本站点已配 admin 登录；勾选「自定义登录」可临时换别的账号。明文 key 仅返回一次。',
    upDone: '接入完成', upResultAcc: '建账号', upKeyOnce: '使用 API Key（明文仅此一次，请立即保存）：',
    // 设置
    settingsTitle: '面板设置', language: '语言', theme: '浅色数据中台', sourceTruth: '单一真相源',
    sourceTruthDesc: '账号/分组/成员/token 一律实时回源 sub2api；本地仅存派生元数据。',
    settingsNoModify: '不修改 sub2api 源码', settingsNoModifyDesc: '通过补充代码扩展，保证 sub2api 升级安全。',
  },
  en: {
    brand: 'Sub2API Console', brandSub: 'Unified Ops Platform',
    login: 'Sign in', logout: 'Sign out', password: 'Admin password', loginTitle: 'Console Login', loginDesc: 'Enter admin password to access the platform.', loginErr: 'Wrong password',
    themeLight: 'Light', themeDark: 'Dark', themeToggle: 'Toggle theme',
    site: 'Site', addSite: 'Add site', refresh: 'Refresh', search: 'Search', apply: 'Apply', cancel: 'Cancel', confirm: 'Confirm', save: 'Save', close: 'Close', edit: 'Edit', delete: 'Delete', loading: 'Loading…', noData: 'No data', noRecords: 'No records',
    navObs: 'Observe', navPool: 'Account Pool', navAdmin: 'Admin',
    nav_overview: 'Overview', nav_feedback: 'Feedback', nav_errors: 'Error Logs', nav_slow: 'Slow', nav_timeline: 'Trend', nav_usage: 'Usage Report',
    nav_pool: 'Pool Overview', nav_accounts: 'Accounts', nav_groups: 'Group Mgmt', nav_batches: 'Import Batches', nav_recycle: 'Recycle Bin',
    nav_users: 'Users', nav_sites: 'Sites', nav_settings: 'Settings',
    total: 'Total', success: 'Success', failed: 'Failed', successRate: 'Success Rate', p95: 'P95 Latency', allRecorded: 'all recorded', currentWindow: 'current window', firstToken: 'first token',
    tokens: 'Tokens', cost: 'Cost', tokensHint: 'in {in} / out {out}', showing: 'showing {n} of {total}', slowCount: 'Slow',
    successHint: 'successful', failedHint: 'failed',
    feedbackDesc: 'Trace records by time, model, key, error or Request ID from user reports.',
    allModels: 'All models', allStatus: 'All status', statusSuccess: 'Success', statusError: 'Error',
    requestPlaceholder: 'Request ID / user email / API key / error keyword',
    colTime: 'Time', colRequest: 'Request', colUserKey: 'User/Key', colModel: 'Model', colResult: 'Result', colOwner: 'Owner', colLatency: 'Latency', colSummary: 'Summary', colTokens: 'Tokens(in/out)', colUpstream: 'Upstream acct',
    trend: 'Request Trend', attribution: 'Error Attribution', errors: 'errors', attention: 'Needs Attention', attentionDesc: 'Aggregated by error volume and impact.', noHotErrors: 'No hot errors', noHotErrorsDesc: 'No obvious error cluster in the last hour.',
    obsUnavailable: 'Observability not available for this site (needs direct sub2api postgres). Local site only.',
    obsRangeCustom: 'Custom', obsRangeStart: 'From', obsRangeEnd: 'To', obsRangeHint: 'Start–end (Asia/Shanghai)', obsRangeInvalid: 'Start must be before end',
    pagePrev: 'Prev', pageNext: 'Next', pageInfo: 'Page {page}/{pages} · {total} total', pageSizeLabel: 'Per page',
    // User Usage Report
    ur_title: 'User Usage Report', ur_desc: "Enter a user email and period to audit that user's spend and cache composition (screenshot-ready for the user).",
    ur_emailPlaceholder: 'User email (exact or fuzzy)', ur_lookup: 'Look up', ur_enterEmail: 'Enter a user email, pick a period, then Look up.',
    ur_rangeToday: 'Today', ur_range7d: 'Last 7d', ur_range30d: 'Last 30d', ur_rangeMonth: 'This month', ur_rangeCustom: 'Custom',
    ur_startDate: 'Start', ur_endDate: 'End', ur_tzNote: 'Timezone: Asia/Shanghai (UTC+8)', ur_period: 'Report period',
    ur_notFound: 'No user found for this email', ur_notFoundHint: 'Check the spelling, or try a fuzzy keyword.',
    ur_ambiguous: 'Multiple users matched — pick one', ur_colCandidate: 'Candidate',
    ur_role: 'Role', ur_status: 'Status', ur_created: 'Registered', ur_lastActive: 'Last active', ur_keysHit: 'Keys hit',
    ur_totalCost: 'Total Cost (Period)', ur_cacheReadCostShare: 'Cache-Read Cost Share', ur_totalTokens: 'Total Tokens', ur_cacheReadMultiple: 'Cache-Read vs Input',
    ur_successRequests: 'Successful Requests', ur_avgCostPerReq: 'Avg Cost / Request', ur_reconcileDiff: 'Reconciliation Diff', ur_balance: 'Balance / Recharged',
    ur_cacheHitRate: 'Cache Hit Rate', ur_reconcileOk: 'Reconciled', ur_reconcileBad: 'Diff flagged',
    ur_failedHint: 'plus {n} failed requests (not billed)', ur_cacheReadHint: 'of which cache-read {v}',
    ur_verdict: 'One-Line Verdict', ur_copyVerdict: 'Copy verdict', ur_copied: 'Copied',
    ur_verdictTpl: 'User {email} made {n} successful requests during {start} ~ {end}, spending {total}; of which {cacheReadCost} ({pct}) came from cache-read — the model re-reading your prior conversation context, totaling {cacheReadTokens} tokens, {ratio} the new input. Every charge maps to a real request; no abnormal billing.',
    ur_costBreakdown: 'Cost Breakdown (Cache vs Real)', ur_tokenBreakdown: 'Where the Tokens Went',
    ur_costInput: 'Input (real prompt)', ur_costOutput: 'Output (model reply)', ur_costCacheCreation: 'Cache creation', ur_costCacheRead: 'Cache read',
    ur_cacheExplainTitle: 'What Is Cache · For the User',
    ur_cacheExplainBody: 'Cache read = on every request the model re-reads everything you said earlier in this conversation before it can continue. The longer the conversation, the more it must re-read each turn, so tokens pile up fast. This is billed at a lower unit price, but the sheer volume still accounts for a notable share — normal pay-as-you-go behavior, not overcharging.',
    ur_dailyTrend: 'Daily Usage & Reconciliation', ur_byModel: 'By Model', ur_byKey: 'By API Key', ur_topRequests: 'Top Costly Requests',
    ur_byAccount: 'Upstream Account Distribution', ur_acctPrimary: 'Primary',
    ur_acctSummaryMulti: '{n} upstream accounts served this period; primary {top} took {share} of requests at {hit} hit rate; the other {rest} took {restShare} combined.',
    ur_acctSummaryOne: 'All requests this period landed on a single upstream account {top}, {hit} hit rate — highly concentrated, best cache conditions.',
    ur_acctExplain: 'Cache affinity is bound to the upstream account: a conversation must stick to the same account to hit cache. The more requests concentrate on a few accounts, the higher the hit rate; spreading across many accounts scatters the cache — compare with the "Accounts" column in the daily table.',
    ur_integrityTitle: 'Billing Integrity Statement',
    ur_integrityBody: 'Data comes directly from the sub2api billing table usage_logs and counts successful requests only; failed requests are not billed ({failed} this period). Cache-read tokens are real tokens billed on upstream cache hits, priced below normal input but high in volume. Report period: {start} ~ {end} (Asia/Shanghai).',
    ur_colDay: 'Date', ur_colRequests: 'Requests', ur_colModel: 'Model', ur_colKey: 'API Key', ur_colQuota: 'Quota', ur_colQuotaUsed: 'Quota used',
    ur_colInputTokens: 'Input tokens', ur_colOutputTokens: 'Output tokens', ur_colCacheReadTokens: 'Cache-read tokens',
    ur_colAccount: 'Account', ur_colPlatform: 'Platform', ur_colReqShare: 'Req. share', ur_colAccounts: 'Accounts',
    ur_colTotalCost: 'Cost', ur_colCacheShare: 'Cache share', ur_colDiff: 'Diff', ur_colTime: 'Time', ur_total: 'Total',
    ur_noUsage: 'No successful requests in this period', ur_noUsageFailed: 'All requests failed this period; no charges ({n})',
    poolTotal: 'Total accounts', poolAlive: 'Alive', poolRateLimited: 'Rate limited', poolDead: 'Dead', poolNoCodex: 'No codex perm', poolPending: 'Pending', poolExpiring: 'Expiring 7d',
    byGroup: 'By Group', grpAlive: 'alive', grpDead: 'dead', grpTotal: 'total', probeGroup: 'Probe group', deleteGroup: 'Delete group',
    grpManageTitle: 'Group Management', grpManageDesc: "Manage from the group's angle: pick a group, choose which accounts belong to it. The API routes by group; checked accounts are the upstreams that group can use.",
    grpPickGroup: 'Pick a group', grpPickGroupHint: 'Select a group above to edit its member accounts.', grpMembersCount: 'members',
    grpColInGroup: 'In group', grpColGroups: 'Groups', grpSave: 'Save changes', grpRevert: 'Revert', grpNoChanges: 'No changes',
    grpPendingTpl: '+{a} to add · -{r} to remove', grpSavedTpl: 'Added {a} · Removed {r} (failed {f})',
    grpSearchAcct: 'Search accounts by email/name', grpFilterAll: 'All', grpFilterMembers: 'Members', grpFilterNon: 'Non-members',
    grpRate: 'Rate', grpConfirmSave: 'Confirm: add {a}, remove {r} accounts?', grpEmptyAccts: 'No accounts on this site', grpEmptyGroups: 'No groups on this site', grpSelectedCount: '{n} selected',
    grpSearchGroup: 'Search groups', grpSortName: 'Name', grpSortCount: 'Members', grpJoinGroup: 'Add to group', grpLeaveGroup: 'Remove', grpMemberYes: 'Member',
    grpJoinedTpl: 'Added {n} (failed {f})', grpLeftTpl: 'Removed {n} (failed {f})',
    grpSortCustom: 'Custom', grpReorderHint: 'Drag to reorder', grpOrderSaved: 'Order saved',
    // Group keys (usage API keys of this group)
    gkTitle: 'API keys of this group', gkDesc: 'Managed as the site admin account: usage keys bound to this group. Plaintext is shown once, on creation only.',
    gkNew: 'New key', gkNamePlaceholder: 'Key name (optional, auto-named)', gkCreate: 'Create', gkCreating: 'Creating…',
    gkColName: 'Name', gkColKey: 'Key', gkColStatus: 'Status', gkColQuota: 'Quota(used/limit)', gkColCreated: 'Created', gkColUsed: 'Last used', gkColAction: '',
    gkCreated: 'Key created', gkDeleted: 'Key deleted', gkCopied: 'Copied to clipboard', gkCopy: 'Copy',
    gkPlainHint: 'Copy and store it now — the plaintext is shown only once and cannot be retrieved after closing.', gkDismiss: 'I saved it',
    gkConfirmDelete: 'Delete key "{name}"? Calls using this key will stop working immediately.',
    gkNoKeys: 'No keys in this group yet', gkNever: 'Never',
    gkNoAdminLogin: 'This site has no sub2api admin login configured, so keys cannot be managed. Add the admin email + password under "Sites" and retry.',
    accounts: 'Accounts', importAccounts: 'Import', upstreamImport: 'Upstream', probeSelected: 'Probe selected', selected: 'Selected', clearSel: 'Clear',
    bulkEdit: 'Bulk edit', opPriority: 'Priority', opConcurrency: 'Concurrency', opProxy: 'Proxy', opGroup: 'Group', dangerLabel: 'Clean / Delete', clearError: 'Clear error', clearRate: 'Clear rate-limit', deleteAccount: 'Delete',
    selByCond: 'Select by', condDead: 'Dead', condRate: 'Rate-limited', condNoCodex: 'No codex', condPending: 'Pending', condAlive: 'Healthy', condAll: 'All',
    colId: 'ID', colName: 'Name/Email', colType: 'Type', colVerdict: 'Verdict', colStatus: 'Status', colUsage: 'Usage 5h/7d', colPriority: 'Priority', colProbe: 'Last probe',
    accountSearch: 'Search email / name', selectGroup: 'Select group', allGroups: 'All groups', noProxy: 'No proxy',
    probing: 'Probing', cleaning: 'Cleaning', stop: 'Stop',
    confirmDelete: 'Delete selected accounts? This really deletes them from sub2api (restorable from recycle bin if refresh_token exists).',
    confirmClearErr: 'Clear error state of selected accounts?', confirmClearRate: 'Clear rate-limit state of selected accounts?',
    batches: 'Import Batches', batchesDesc: 'An "import batch" is the group of accounts brought in by one import (each maps to one platform group).', batchName: 'Batch', batchAccounts: 'Accounts', batchImported: 'Imported', batchLastSnap: 'Last probe', probeBatch: 'Probe', deleteBatch: 'Delete batch',
    confirmDeleteBatch: 'Deleting this batch will also delete its sub2api accounts and group. Confirm?',
    recycle: 'Recycle Bin', recycleDeletedAt: 'Deleted at', recycleReason: 'Reason', restore: 'Restore', canRestore: 'Restorable', cannotRestore: 'No token',
    users: 'Users', colEmail: 'Email', colRole: 'Role', colUserStatus: 'Status', colBalance: 'Balance', colConcurrency: 'Concurrency', roleAdmin: 'Admin', roleUser: 'User', statusActive: 'Active', statusDisabled: 'Disabled', setAdmin: 'Make admin', setUser: 'Make user', enable: 'Enable', disable: 'Disable',
    roleChannelOff: 'No escalation channel configured for this site',
    // Malicious account cleanup
    mc_title: 'Malicious cleanup', mc_toggle: 'Malicious cleanup', mc_hide: 'Hide',
    mc_desc: 'Filter suspicious signups by email domain / suffix / +alias / substring, then bulk-delete: click "Filter & select" to preview, verify, then delete. Delete is a sub2api soft-delete + cascade soft-delete of their API keys; admin accounts are auto-skipped. Once a filter is applied the criteria lock (you can only deselect within the matched set) — click "Clear filter" to change them.',
    mc_domains: 'Domains / suffix', mc_domainsPh: 'e.g. sharklasers.com, web-library.net, .top (comma/space/newline)',
    mc_presets: 'Common disposables', mc_plusAlias: 'Plus-alias (+)', mc_substr: 'Email contains', mc_substrPh: 'substring (optional)',
    mc_zeroOnly: 'Zero recharge & balance only (safer)', mc_filterSelect: 'Filter & select matches', mc_clearFilter: 'Clear filter',
    mc_matched: '{n} / {m} matched', mc_filterActive: 'Filtered (criteria locked, matches only)', mc_noCriteria: 'Enter a domain/suffix, tick plus-alias, or fill a substring first',
    mc_deleteSel: 'Delete selected', mc_deleting: 'Deleting…',
    mc_confirmDelete: 'Delete the {n} selected users from sub2api?\nSoft-delete + cascade soft-delete of their API keys; admin accounts are skipped.',
    mc_doneTpl: 'Done: {ok} ok · {fail} failed (of {req})',
    mc_colLastIp: 'Last used IP', mc_colCreated: 'Registered', mc_colRecharged: 'Recharged',
    mc_ipSearchPh: 'Search by used IP', mc_ipLoading: 'Syncing…', mc_ipMeta: 'IPs loaded for {n} users',
    mc_ipReload: 'Reload IPs', mc_ipNeedSync: 'Empty — click "Reload IPs"',
    mc_ipMetaHint: 'Last-used IP is read from the console local cache (auto-synced incrementally every ~10 min); only users who called the API have an IP; "+N" means the user also used N other IPs (hover to see all); click "Reload IPs" to sync now.',
    mc_ipUnavail: 'ℹ sub2api records no registration IP (used only for Turnstile, then discarded). The "Last used IP" column and "search by used IP" both come from usage_logs (only users who called the API; cache refreshed incrementally in the background). Enter an attacker IP to trace the accounts behind it, then multi-select → delete (delete-by-IP).',
    mc_noMatch: 'No matching users',
    sites: 'Sites', siteName: 'Name', siteBaseUrl: 'Base URL (/api/v1)', siteAdminKey: 'Admin API Key', siteKind: 'Kind', siteLocal: 'Local', siteRemote: 'Remote', sitePgContainer: 'PG container', siteSshHost: 'SSH host (remote)', siteHealth: 'Health', siteCheck: 'Test', siteProbeOk: 'Connected', addSiteTitle: 'Add Site', editSiteTitle: 'Edit Site', deleteSiteConfirm: 'Deleting a site clears its local derived data (sub2api untouched). Confirm?',
    siteBasicHint: 'Required (basic mgmt: pool/bulk/cleanup/delete/user-status): Name + Base URL + Admin API Key + Kind.',
    siteChannelHint: 'Optional (escalation channel → unlocks role change + oauth probe + observability): for remote, set SSH host (root@IP, non-22: root@IP:port) + PG container (docker ps on target; default sub2api-postgres).',
    sitePubkeyTitle: '① First add this console SSH public key to the target machine ~/.ssh/authorized_keys:',
    sitePubkeyCopied: 'Public key copied',
    siteSshCmdTitle: '② Or copy the full authorize command and run it on the target (idempotent, re-runnable):',
    siteSshCmdHint: 'Run as the ssh_host user; then fill the SSH host below and allow this console host\'s egress IP in the target firewall / security group.',
    siteSshCmdCopied: 'Authorize command copied',
    obsRefreshing: 'Refreshing…', obsUpdated: 'Updated',
    siteKeyHowto: 'Get Admin API Key: log into that sub2api as admin → accept compliance → Admin Settings → Admin API Key → generate.',
    siteAdminEmail: 'Admin login email', siteAdminPwd: 'Admin login password', siteAdminLogin: 'admin login', siteAdminConfigured: 'admin login set',
    siteAdminLoginHint: 'Used by Upstream "create key": logs in as this sub2api admin to get a JWT and create keys (admin x-api-key cannot create keys). Set once per site; Upstream reuses it by default.',
    siteBaseUrlHint: 'On the same docker network you can use the container name, e.g. http://sub2api:8080/api/v1 (a public IP may be unreachable from inside the container).',
    pubkeyMissing: 'No console SSH public key found: generate secrets/ssh/id_ed25519 in the deploy dir and mount it via compose, otherwise remote-site escalation (role/probe/observability) is unavailable.',
    setupTitle: 'First-time setup', setupHint: 'No admin password is set yet. Put CONSOLE_ADMIN_PASSWORD=<your password> in the deploy dir .env, run docker-compose up -d to restart, then come back and log in.',
    firstSiteTitle: 'Welcome to Sub2API Console', firstSiteCta: 'No sites yet. Add your first sub2api site to get started.', addFirstSite: 'Add first site',
    changePw: 'Change admin password', changePwOld: 'Current password', changePwNew: 'New password (≥6)', changePwApply: 'Update password', changePwOk: 'Password updated',
    importTitle: 'Import accounts (batch)', importDesc: 'Paste CPA account JSON or sub2 export JSON (whole JSON / array / one per line).', importBatchName: 'Batch name (optional)', importPriority: 'Priority', importConcurrency: 'Concurrency', importContent: 'Account JSON',
    importFormat: 'Format', fmtAuto: 'Auto-detect', fmtCpa: 'CPA single', fmtSub2: 'sub2 export',
    importDrop: 'Drop .json files here, or click to choose (multiple)',
    upstreamTitle: 'Relay import', upstreamDesc: 'Onboard a relay (upstream base_url + api_key) as an apikey account bound to a group; optionally create a channel monitor.', upstreamBaseUrl: 'Upstream Base URL (with /v1)', upstreamTiers: 'Tiers',
    upRelayName: 'Account name', upPlatform: 'Platform', upGroup: 'Group name', upGroupPh: 'blank = use account name', upApiKey: 'Upstream API Key', upModelMap: 'Model mapping (optional)',
    upMonitor: 'Also create a channel monitor (for this upstream)', upMonModel: 'Probe model', upMonInterval: 'Interval (s)', upMonHint: 'Monitor hits the origin of base_url (https required) using the api_key above.',
    upKeyNote: '', upRelayNeed: 'Need at least one tier (account name + api_key) and base_url',
    upTiers: 'Accounts (name + api_key; add multiple to bind same group)', upAddTier: 'Add account', upAddGroup: 'Add group', upRemoveGroup: 'Remove group',
    upCreateKey: 'Also create a usage API Key (uses site admin)', upUserEmail: 'sub2api user email', upUserPass: 'Password',
    upKeyUseSiteAdmin: 'Uses the site-configured admin account by default (set once under Sites).', upKeyOverride: 'Custom login (override)',
    upKeyLoginHint: 'Blank = use the site-configured admin login; check "Custom login" to use a different account this time. Plaintext key returned once.',
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
export const formatTokens = (v: number) => { const n = Math.round(v || 0); if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`; if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`; return String(n) }
export const formatCost = (v: number) => `$${(v || 0).toFixed(v && Math.abs(v) < 1 ? 4 : 2)}`
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

// ---- 跨页 SWR 缓存 ----
// 模块级缓存（活在 React 树外）→ 切页卸载/重挂后仍在：进页先吐缓存秒显示、后台 revalidate、好了静默替换。
// 只缓存「读」；实体数据仍实时回源 sub2api（§10），缓存只是把"上次结果"留着避免每次进页都白屏等网络。
const swrCache = new Map<string, unknown>()
const swrInflight = new Map<string, Promise<unknown>>()
const SWR_MAX = 80   // 缓存条数上限：超出淘汰最早插入的（防搜索前缀等瞬时 key 无界堆积）
const cacheSet = (k: string, v: unknown) => {
  if (swrCache.has(k)) swrCache.delete(k)
  swrCache.set(k, v)
  if (swrCache.size > SWR_MAX) { const oldest = swrCache.keys().next().value; if (oldest !== undefined) swrCache.delete(oldest) }
}
/** 失效缓存：传完整 key 或前缀（带分隔符，如 `accounts:3:`）——删/改后调用，使相关页下次进入必拉新。 */
export const invalidateResource = (keyOrPrefix: string) => {
  for (const k of [...swrCache.keys()]) if (k === keyOrPrefix || k.startsWith(keyOrPrefix)) swrCache.delete(k)
  for (const k of [...swrInflight.keys()]) if (k === keyOrPrefix || k.startsWith(keyOrPrefix)) swrInflight.delete(k)
}

/**
 * SWR 读取：key 唯一标识一次查询（含站点/筛选等参数）；fetcher 拉数据。
 * - 有缓存 → 立即返回缓存（loading=false，不白屏），同时后台 revalidate（refreshing=true）。
 * - 无缓存（首次/新参数）→ loading=true 冷拉。
 * - 拉取失败 → 保留旧数据，走 onError（不清屏）。key=null → 跳过（用于按需/未就绪）。
 * fetcher 走 ref，不入依赖，避免每次渲染的新闭包触发重拉。
 */
export function useResource<T>(key: string | null, fetcher: () => Promise<T>, onError?: (e: unknown) => void): { data: T | undefined; loading: boolean; refreshing: boolean; refresh: () => void } {
  const [data, setData] = useState<T | undefined>(() => (key && swrCache.has(key) ? (swrCache.get(key) as T) : undefined))
  const [loading, setLoading] = useState<boolean>(() => !!key && !swrCache.has(key))
  const [refreshing, setRefreshing] = useState(false)
  const fetcherRef = useRef(fetcher); fetcherRef.current = fetcher
  const onErrRef = useRef(onError); onErrRef.current = onError
  const aliveKey = useRef<string | null>(key)

  const run = useCallback((k: string) => {
    if (swrCache.has(k)) setRefreshing(true); else setLoading(true)
    let p = swrInflight.get(k)
    if (!p) {
      const pr = Promise.resolve().then(() => fetcherRef.current()).then((d) => { cacheSet(k, d); return d })
      pr.finally(() => { if (swrInflight.get(k) === pr) swrInflight.delete(k) })   // 只删自己那条，避免并发 refresh 误删新条目
      swrInflight.set(k, pr); p = pr
    }
    p.then((d) => { if (aliveKey.current === k) setData(d as T) })
      .catch((e) => { if (aliveKey.current === k) onErrRef.current?.(e) })   // 失败保留旧数据
      .finally(() => { if (aliveKey.current === k) { setLoading(false); setRefreshing(false) } })
  }, [])

  useEffect(() => {
    aliveKey.current = key
    if (!key) { setData(undefined); setLoading(false); setRefreshing(false); return }
    if (swrCache.has(key)) { setData(swrCache.get(key) as T); setLoading(false) } else { setData(undefined); setLoading(true) }
    run(key)
  }, [key, run])

  // 强制重拉（手动刷新 / 改动后）：清在飞标记 → 保留旧缓存继续展示 → revalidate 静默替换。
  const refresh = useCallback(() => { const k = aliveKey.current; if (k) { swrInflight.delete(k); run(k) } }, [run])
  return { data, loading, refreshing, refresh }
}

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

/** 通用翻页器（前后翻 + 页码信息）。total=过滤后总数；仅一页且在首页时不渲染。复用 pagePrev/pageNext/pageInfo 文案。 */
export function Pager({ page, pageSize, total, onPage, lang }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; lang: Lang }) {
  const t = copy[lang]
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  if (total <= pageSize && page <= 1) return null
  return <div className="pager">
    <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}>{t.pagePrev}</button>
    <span className="muted">{t.pageInfo.replace('{page}', String(page)).replace('{pages}', String(pages)).replace('{total}', formatInt(total))}</span>
    <button onClick={() => onPage(Math.min(pages, page + 1))} disabled={page >= pages}>{t.pageNext}</button>
  </div>
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
