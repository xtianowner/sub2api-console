<!-- purpose: Sub2API Console 后端 TS 模块登记 -->
创建时间：2026-06-15 15:30:00
更新时间：2026-06-15 15:30:00

# 模块登记（console/app/server/*.ts）

| 模块 | 职责 | 输入 | 输出 | 依赖 | 移植自 pool-manager |
|---|---|---|---|---|---|
| `db.ts` | node:sqlite schema + 连接 + 事务 tx() + settings + nowCst | - | DatabaseSync | node:sqlite | `db.py`(去 token_store/batch_accounts) |
| `config.ts` | env + 凭据 PBKDF2/HMAC 加解密 + 管理员密码门 + 会话密钥 | env/settings | 加解密/校验 | node:crypto | `config.py` |
| `sites.ts` | 站点注册 CRUD + 提权路由(本机 pg 连接/远程 ssh psql) + AdminApi 缓存 | site_id/body | SiteRow/AdminApi/pg | pg、child_process | `web_server` sites + `onboard` |
| `adminApi.ts` | sub2api 官方 admin REST 客户端(全分页) + `testAccount`(SSE 测试端点 /admin/accounts/:id/test，apikey 实测上游) | method/path/body | data | fetch | `api_client.py` |
| `sourceTokens.ts` | §10 token 实时回源(本机 pg / 远程 ssh psql) | site_id | {id:tokenRow} | sites | `source_tokens.py` |
| `prober.ts` | 直连 chatgpt codex 探活+真实额度(经 CONSOLE_PROBE_PROXY 出墙) | tokenRow | verdict+额度 | node:https、socks-proxy-agent | `prober.py` |
| `inventory.ts` | **按账号类型分流**盘点：oauth→codex 直探(真实额度)、apikey/中转→`adminApi.testAccount` 实测上游；聚合+写快照(并发池+进度) | site/group/ids | results | prober、adminApi、sourceTokens、db | `inventory.py` |
| `importer.ts` | 分批导入 + 中转接入(仅写批次元数据) | cpa_list/tiers | batch/results | adminApi、db | `importer.py`+`_upstream_import` |
| `pool.ts` | 账号合并/分组/批次/池总览/批量编辑/回收站/删批次组 | site/body | rows/聚合 | adminApi、sourceTokens、db | `web_server` _merge/_pool_overview/_batches/_bulk/... |
| `cleanup.ts` | 失效号异步清理(进度+急停+回收快照) | site/ids | 状态 | adminApi、sourceTokens、db | `web_server._run_cleanup` |
| `users.ts` | 用户列表 + 改 role 提权(本机 pg/远程 ssh) + 启禁(admin API) | site/body | rows/结果 | sites、adminApi | `web_server` 用户段+`_pg_set_role` |
| `observability.ts` | **站点感知** summary/requests/attention：本机→pg 池(参数化)、远程→ssh docker exec psql(SQL 返单个 JSON，window 白名单 + q/model 字面量转义防注入) | site/window/q | 指标/行 | pg(localPool)、sshPsql | 原 Observer `server/index.ts` |
| `auth.ts` | 密码门:登录发签名会话cookie+中间件保护写/读 | password/req | 会话 | config | pool-manager X-Admin-Pass 升级 |
| `index.ts` | Express 总装:公共 login/session/health + 门禁后全端点 + SPA | - | - | 全部 | - |

## 关键契约
- **提权路由**：site.kind=local → pg 连接(token 用 DATABASE_URL 只读、role 用 ADMIN_DATABASE_URL 可写)；否则有 ssh_host+pg_container → `ssh docker exec psql`(经 ./secrets/ssh key)。`sitePublic.role_channel/observability` 驱动前端按钮/导航。
- **§10**：实体一律回源；本地仅派生元数据。自检三问全过(关 SQLite UI 仍能从源还原 / 源删则平台不显 / 无两处写同一外部状态)。
- **探活出口**：`CONSOLE_PROBE_PROXY=socks5h://<docker-gw>:1080`(指向宿主 systemd ssh -D 隧道→海外出口机→openai)；空=直连。
- **建分组必传 rate_multiplier**；**429→rate_limited**(不判死)；**is_deactivated 才判 dead**；accounts/check 被 Cloudflare 403 不作 auth_fail。
