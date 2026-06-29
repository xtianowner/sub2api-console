<!-- purpose: Sub2API Console 设计教训记录，避免重复踩坑 -->
创建时间：2026-06-15 15:30:00
更新时间：2026-06-16 14:36:00

# Sub2API Console 设计教训

## 1. better-sqlite3 在 alpine/musl 上 node-gyp 源码编译奇慢 → 改用 Node 内置 node:sqlite
**问题**：首版用 better-sqlite3，alpine 无 musl 预编译二进制，回退 node-gyp 编译 sqlite3.c（~25万行）+ 卡在缓慢下载 node headers，单次构建 20-30min，且 deps/runner 两阶段各编译一次。
**替代（已采用）**：改用 **Node 24 内置 `node:sqlite`(DatabaseSync)** —— 零原生依赖、零编译、构建秒级、跨平台 lock 干净。API 与 better-sqlite3 近似(prepare/run/get/all)，差异：① pragma 用 `exec('PRAGMA ...')`；② 无 `.transaction()`，自写 `tx()` 包 BEGIN/COMMIT/ROLLBACK；③ `.all()/.get()` 返回 `Record<string,SQLOutputValue>`，转富接口需 `as unknown as T`；④ node 24 免 flag(仅一条 ExperimentalWarning)。
**教训**：容器内有原生依赖时优先选无需编译的方案；Node 22.5+ 的 node:sqlite 对"工具侧派生元数据"这类轻量 SQLite 足够。

## 2. 跨平台 npm lock 缺 musl 可选依赖 → 用 npm install 而非 npm ci
**问题**：macOS 生成的 package-lock 缺 linux/musl 的可选依赖(rollup 的 `@emnapi/*` 等)，alpine 上 `npm ci` 严格校验 EUSAGE 失败。
**替代**：Dockerfile 用 `npm install`(按本平台解析) 而非 `npm ci`。轻微牺牲可复现性，换跨平台可构建。

## 3. 43(国内) 直连不通 openai → 探活必须经出口代理
**问题**：探活直连 `chatgpt.com/backend-api/codex` 判活/真实额度。pool-manager 跑在 远程站(海外) 能连所以正常；合并平台跑在本机(国内) **直连 timeout**，探活全判 transient。
**替代（已采用）**：prober 加 `CONSOLE_PROBE_PROXY`(socks-proxy-agent + node:https)；本平台所在机起 systemd `console-probe-proxy`(ssh -D <docker-gw>:1080 → 海外出口机 <proxy-host> 出墙)，容器经 docker 网关 <docker-gw> 走它。验证：经隧道 openai→401、出口IP=海外出口机；探活得真实 verdict(rate_limited)。
**教训**：把探活/外呼类功能从"能连外网的机器"迁到"不能连的机器"时，出口是硬依赖，需先确认或配代理。其它管理功能(admin API/PG)不受影响。

## 4. 单一真相源(§10)实证：平台侧新增账号被实时读到
**现象**：迁移时远程站池=4 个号；过程中用户在 sub2api 直接加了 Qz-Plus/Qz-Pro，平台 all-accounts **立即变 6**（无需任何对帐）。证明读路径实时回源、SQLite 不持权威副本，"不同步"在结构上不可能发生。继承全局 §10（pool-manager 已退役，其两条原始踩坑见本文 §9）。

## 5. 绑定服务器的开发：本地编写大型 TS/React + 单向推 43 + 全部验证在云端
**做法**：本地工作副本编写(大型前后端无法 ssh-sed 手改)，tar 单向推部署机 + checksum/重建，**每次验证都在部署机对真实 sub2api/真实 PG/真实远程站点跑**(本地无真实环境绝不下结论)。源真相=部署机。原则：验证面必须真(真 sub2api/真 PG/真站点)，且本地↔部署机不漂移。

## 7. 盘点必须按账号类型分流：oauth 直探 codex，apikey/中转走 sub2api 测试端点
**问题（用户发现）**：apikey/中转账号在账号表永久显示"待盘点"。根因：`source_tokens` 只回源 `type='oauth'` 的 token，`inventory` 又只盘"有 token"的号 → apikey 全被剔除、从不探活（pool-manager 原版同病）。
**为什么不能用同一逻辑**：apikey 是 `{base_url, api_key}` 上游中转，没有 oauth token，连不了 chatgpt.com codex；它的"活"= 上游能否服务请求。
**替代（已采用）**：`inventory` 先拉账号 type，分流——
- oauth(有 token) → 直连 codex 探活 + 真实额度(x-codex-*)，经 海外出口机 出口。
- apikey/upstream → 调 sub2api 自带 `POST /admin/accounts/:id/test`(SSE)，在 sub2api 内部用账号自己的 base_url+api_key+代理实测上游（**不经 console 出口**）。解析 SSE 终态：`{"type":"test_complete","success":true}`→alive；`{"type":"error","error":"API returned 401/429/..."}`→按文本归类 auth_fail/rate_limited/error。
**真机验证(远程站)**：apikey 159 Qz-Pro→alive、160 Qz-Plus→error、147 上游→error("Upstream request failed")，与直连 sub2api 测试端点一致。
**注意**：apikey 盘点 = 对上游发真实测试请求(消耗中转配额)，按需触发。

## 8. 中转接入必须按 sub2api 真实工作流：账号(type=apikey) + 分组 + (可选)渠道监控
**问题（用户发现）**：旧 `upstreamImport` 用 `type=upstream` 建账号 → 看似建了空壳分组、中转不工作。
**根因（源码确认）**：`Account.GetBaseURL()` 里 `if a.Type != AccountTypeAPIKey { return "" }` —— **base_url 只对 `type=apikey` 生效**；type=upstream 时 base_url 被忽略 → 请求不路由到上游 = 非功能账号。真实中转账号(Qz-Pro/上游)都是 `type=apikey`、credentials={base_url, api_key, model_mapping}。
**sub2api 真实工作流**：① 建账号 `POST /admin/accounts`(type=apikey, credentials 三键, group_ids 绑分组, 混渠道冲突加 `confirm_mixed_channel_risk:true` 跳 409) → ② 建/绑分组 `POST /admin/groups`(必传 rate_multiplier) → ③ 建使用用 API Key `POST /api/v1/keys`(**用户态 jwtAuth，admin x-api-key 不可调**，明文 key 仅创建时返回一次) → ④ 渠道监控 `POST /admin/channel-monitors`(endpoint=上游 origin 纯 https、api_key=上游 key、group_name 仅展示无外键)。
**已采用**：`upstreamImport` 重做为 ①+②+④(可选)；③ 建 key 需用户 JWT，admin-key 不行 —— **每站点在「站点」表单存一份 admin 登录(email+密码，加密落 `settings.site_admin_email/pwd:<siteId>`)**，中转接入「建 key」默认复用该站点 admin、**无需再输入**（可展开「自定义登录」临时换账号覆盖）；优先级 per-site > env 全局兜底(`CONSOLE_SUB2_ADMIN_*`) > 缺省 `admin@sub2api.local`（2026-06-16 增）。监控 endpoint 取 base_url 的 origin，非 https 则跳过并提示。
> **免密路径不存在（3 agent + 对抗式复核 confidence=high 钉死，勿再找）**：建 user key 唯一路由 `POST /api/v1/keys` 卡死在 `jwtAuth`（只认 `Authorization: Bearer <user-JWT>`，从不读 x-api-key）；admin x-api-key 仅经 `adminAuth` 进 `/admin/*`，那里只有 `PUT /api-keys/:id`(UpdateGroup)、**无 Create / impersonate / 换 JWT / service-token**；用户 JWT 仅靠 `/auth/login`(密码) 等凭据签发。故"复用 admin"本质=存一份能登录的 admin 密码。建 key 只能官方 `POST /keys`，不走 PG 直插 apikeys（绑 sub2api 内部 schema/哈希、随上游升级脆裂，违 L1）。该密码是登录凭据、非实体副本，仅加密存 settings/env，真相(key)仍在 sub2api。
**多分组（2026-06-16 增，3 agent + 对抗式复核 confidence=high 钉死契约）**：`upstreamImport` 重做为按 `groups[]` 迭代——一次建多个分组、不同账号绑不同组。请求体 `{platform, base_url, model_mapping, groups:[{name, rate_multiplier?, accounts:[{name,api_key,priority?,concurrency?,rate?}], create_key?, monitor?}]}`（base_url/platform/model_mapping 整批共享=同一上游）；无 `groups` 时把旧 `tiers`/单档+顶层 create_key/monitor 包成单组（向后兼容）。每组闭包：复用/建组→建账号→可选 key→可选 monitor→写本地批次(每组一条)。key/monitor **下放到每组**。关键 API 契约（源码确认，避免再踩）：
> - **账号↔分组绑定 = 建账号时 inline `group_ids:[]int64`（数组=可多组），无独立绑定端点**；改绑用 `PUT /admin/accounts/:id` 的 `group_ids`，底层 `BindGroups` 是 **REPLACE**（先删全部再重建，传部分会丢旧绑定）。用户脑中的"第3步绑分组"在 API 上不是独立调用。
> - **key 用单数 `group_id`（一 key 一组）**，不是 `group_ids`；要 N 组就建 N 把 key（账号 M2M 多组，但 key 单组，不对称）。
> - **monitor 的 `group_name` 仅展示字符串、无外键**（删改分组不级联）。
> - 坑：`rate_multiplier` 业务必填且须 >0；建账号 `group_ids` 留空会被自动绑到 `{platform}-default`（故须显式传）；混渠道 409 仅 Anthropic↔Antigravity 互斥，带 `confirm_mixed_channel_risk:true` 跳过；monitor endpoint 须 https 纯 origin（无 path/query、非私网）。
> 全程只调官方 admin REST + 用户 `/keys`，不改 sub2api 源码（L1）。
**真机验证(43)**：账号 type=apikey、credentials=[base_url,model_mapping]、绑入分组、监控建成(endpoint=https://api.openai.com)；清理 `DELETE /admin/channel-monitors/:id` + 删分组级联。

## 6. sub2api 取 admin-api-key 需先做合规确认(ADMIN_COMPLIANCE_ACK_REQUIRED)
**现象**：regenerate admin-api-key 返回 `ADMIN_COMPLIANCE_ACK_REQUIRED`(version)。
**解**：先 `POST /api/v1/admin/compliance/accept` 带 `{phrase: <ack_phrase_en/zh>, version}`(短语来自 `GET /admin/compliance` 的 ack_phrase；**EN 短语纯 ASCII 经 ssh/heredoc 不走样，zh 易被 UTF-8 转义破坏**)，再 regenerate。本机 sub2api 的 admin 密码经 PG 直改 bcrypt(`$2b$` Go 兼容)重置后可登录。

## 9. 单一真相源铁律的两条原始踩坑（迁移自已退役的 sub2api-pool-manager，**全局 `~/.claude/CLAUDE.md §10` 教训源**）
> pool-manager（console 的 Python 前身）于 2026-06 退役、目录删除。删除前将其 LESSONS 中被全局 §10 引用的两条核心教训迁移至此，作为 §10 的唯一真相源。

### 9a. 看板批次不对帐 → 工具侧持有独立副本必然漂移，根治是"读路径实时回源"
**现象**：pool-manager 本地 SQLite 维护了一套与平台脱钩的批次/成员/计数（`batches`/`batch_accounts`/`total_count`）。用户在 sub2api 平台直接删分组/加账号（如把 153/155 加进 team、建"上游"组）后，看板要么继续列已删的"孤儿批次"、统计虚高，要么对平台侧新增视而不见（team 显 1 实为 3，"上游"组整个不出现）。
**根因**：`reconcile`（对帐）是在"两份独立数据"之上打补丁——只能单向删本地孤儿、从不回填平台新增，追不上、迟早漂移。
**根治（已采用）**：确立单一真相源——分组/成员/计数/token 一律实时回源平台 `list_groups`/`list_accounts`（+提权通道读 PG token），工具本地库只存平台装不下的派生元数据；`reconcile` 退役为可选 GC。console 用 TS+PG 重写时直接内建此原则（实证见本文 §4）。
**自检三问**：① 关掉工具本地库 UI 还能从源还原吗？② 源里删一条工具会不会还显示？③ 有没有两处在写同一份外部状态？任一不合格即违规。

### 9b. token 双刷致号失效 → 刷新权必须由源系统独占
**现象/根因**：oauth token 在工具与 sub2api 两处各存一份、各自刷新。sub2api 默认就主动刷（每 5min 查、过期前 30min 刷，同端点 `auth.openai.com/oauth/token`+同 client_id，带分布式锁+DB重读）；工具在外面也轮换 refresh_token → sub2api 拿到旧 rt 去刷 → `invalid_grant`/`refresh_token_reused` → sub2api `SetError` 踢号、**不可恢复**。
**处置（已采用）**：移除工具一切自刷（面板刷新按钮 + 巡检自刷 + `/api/refresh` 全停），刷新 100% 交 sub2api 独占；工具改"读 sub2api 当前 token"作单一真相源。**铁律**：跨副本写同一外部资源（双方都刷同一 oauth token）= 互踩，绝对禁止，只能由源系统独占。

## 10. 项目整合：pool-manager / cpa-to-sub2api-web / sub2api-2dev 退役，唯一维护 1c2(console)
**决策（2026-06-16，用户）**：sub2 工作区收敛为单一维护对象 = 部署在 1c2(`<VPS-IP>:<PORT>`) 的本通用控制工具(sub2api-console)。
- **sub2api-pool-manager**（Python 前身）：模块与理念已被 console 用 TS+PG 重写吸收并增强（+观测/apikey分流/中转接入），不再迭代 → 删除（§10 教训已迁移至本文 §9）。
- **cpa-to-sub2api-web**（CPA→sub2api 导入向导）：导入逻辑已在 console 内实现，冗余 → 删除。
- **sub2api-2dev**（官方上游纯克隆）：只读参考、re-clonable → 删除（需要时 `git clone https://github.com/Wei-Shaw/sub2api`）。
**为什么可行**：console 是上述能力的超集且唯一在维护；删除项均无"独有且不可重建"的资产——教训已保全、上游可重新 clone、导入逻辑已并入。

## 11. 「用户用量报告」功能 + 改前必先拉线上源码作基线（2026-06-19）
**新增功能**：观测组新增「用户用量」子页（`usageReport.ts` + `pages/usageReport.tsx`），按**邮箱+时间段**拉单用户消费/缓存报告，专为回应「额度怎么没的/平台坑我吗」。
- 关键口径：金额/缓存只统计成功请求(usage_logs)，失败请求(ops_error_logs 无 token/cost)仅计数不计费；成本拆 input/output/cache_creation/cache_read 四项且 `reconcileDiff=total-四项之和` 实测=0（可对账）；缓存讲清三件事——**缓存读取占费**(cacheReadCostShare)、**缓存命中率**(cacheReadTokens/(input+cacheRead))、**缓存读÷输入倍率**；自动生成可截图的「一句话结论」。
- 双模式同 observability：本机 pg 全参数化；远程 ssh psql 把整份报告聚合成单个 `json_build_object` 一次返回（email 走 `lit()` 转义、自定义日期走 `^\d{4}-\d{2}-\d{2}$` 白名单、user_id 整数）。注入探针 `x' or '1'='1` 实测 → notFound 不报 500。
- 时区：`created_at AT TIME ZONE 'Asia/Shanghai'` 后切日，避免 UTC 跨日错切（测试用户消费全集中在 1 天，UTC 切日会错切成两天被用户抓）。
- token 求和一律 `::float8`（cache_read 可达 5000 万级，int4 累加溢出 + bigint 会被 pg 序列化成字符串破坏前端 formatTokens）；per-row top 请求用 `::int`（单请求不溢出）避免字符串化。
- 实测示范（zkjg 站 <用户邮箱>，近7天）：391 成功/1 失败，$41.53，其中 cache_read $25.06(60.3%)、缓存命中率 96.2%、缓存读 25.6×、总 Token 52.3M——「额度去向」一眼可解释。

**改前必先拉线上源码作基线（强化 §5 + ui-regression）**：本轮发现 **Mac 本地仓库比线上部署旧**（线上 `/opt/sub2api-console/app` 有 6-17 的 token 列/慢请求口径/schema 容错等热修，本地没有）。若直接在本地旧基线上改并重部署，会**覆盖回退线上热修**（正是 ui-regression 教训的复发链）。**正确流程**：动手前先 `rsync 线上 /opt/sub2api-console/app/{server,src} → 本地覆盖`，在线上源码基线上叠加改动，构建后再推回（本地↔线上双向收敛），并 `docker commit` 固化进 `:local` 镜像。
**另一坑**：线上实际是**单密码登录**（`/api/session` 无 user 字段、index.js 无 requireMaster），但旧记忆/Mac 仓库残留「多用户(<管理员账号> master)」未部署版本——以**线上运行态**为准，别信旧记忆。`tsc -p tsconfig.server.json` **不删无源 .js**：server-dist 残留过的 `consoleUsers.js`（多用户遗留）需手动 `rm`，否则随 tar 一直带着（虽 index.js 不引用=无害死代码）。
