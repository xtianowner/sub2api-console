<!-- purpose: Sub2API Console 设计教训记录，避免重复踩坑 -->
创建时间：2026-06-15 15:30:00
更新时间：2026-06-15 15:30:00

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
**现象**：迁移时远程站池=4 个号；过程中用户在 sub2api 直接加了 Qz-Plus/Qz-Pro，平台 all-accounts **立即变 6**（无需任何对帐）。证明读路径实时回源、SQLite 不持权威副本，"不同步"在结构上不可能发生。继承 pool-manager LESSONS 教训3 + 全局 §10。

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
**已采用**：`upstreamImport` 重做为 ①+②+④(可选)；③ 因需用户 JWT → 留给用户在 sub2api 自助(UI 明示)。监控 endpoint 取 base_url 的 origin，非 https 则跳过并提示。
**真机验证(43)**：账号 type=apikey、credentials=[base_url,model_mapping]、绑入分组、监控建成(endpoint=https://api.openai.com)；清理 `DELETE /admin/channel-monitors/:id` + 删分组级联。

## 6. sub2api 取 admin-api-key 需先做合规确认(ADMIN_COMPLIANCE_ACK_REQUIRED)
**现象**：regenerate admin-api-key 返回 `ADMIN_COMPLIANCE_ACK_REQUIRED`(version)。
**解**：先 `POST /api/v1/admin/compliance/accept` 带 `{phrase: <ack_phrase_en/zh>, version}`(短语来自 `GET /admin/compliance` 的 ack_phrase；**EN 短语纯 ASCII 经 ssh/heredoc 不走样，zh 易被 UTF-8 转义破坏**)，再 regenerate。本机 sub2api 的 admin 密码经 PG 直改 bcrypt(`$2b$` Go 兼容)重置后可登录。
