# Sub2API Console

> 一个**个人自用**的 [sub2api](https://github.com/Wei-Shaw/sub2api) 辅助管理工具：把「请求观测」与「多站点账号池管理」合到一个浅色数据中台风格的 Web 面板里。

个人项目，按需自取；不附带任何保证，请在你自己的环境评估后使用。

**L1 外挂定位**：不修改 sub2api 源码，只通过官方 admin API +（可选）直连 postgres 扩展功能，保证 sub2api 可安全升级。

## 特性
- **观测**：成功率/请求量/失败/P95、趋势、错误归因、按 request_id/用户/Key/错误反查（读 sub2api 的 usage_logs / ops_error_logs）。
- **账号池**：分组/批次、账号表、批量改优先级/并发/代理/分组、清错误/清限流/删除、回收站、按条件选中。
- **盘点(探活)**：oauth 账号直连 ChatGPT codex 测真实额度；apikey/中转账号经 sub2api 测试端点实测上游（两类逻辑分流）。
- **用户管理**：列表 + 启/禁 + 改 role（role 走 postgres 提权，因官方 API 不开放 role）。
- **多站点**：一个平台管多个 sub2api 实例；顶栏切换。
- **统一密码门禁**；浅色「数据中台」UI（中/英）；加载骨架/过渡等动效。
- **单一真相源**：账号/分组/成员/token/role 一律实时回源 sub2api，本地 SQLite 只存派生元数据（批次名/盘点快照/回收站/站点注册/密码哈希）。

## 截图
<!-- TODO: docs/screenshots/overview.png 等 -->
（观测总览 / 账号管理 / 站点管理 截图待补）

## 架构
- 技术栈：React 19 + Vite + Express 5 + TypeScript；DB 用 Node 内置 `node:sqlite`（零原生依赖）；探活代理 `socks-proxy-agent`。
- 部署：单 Docker 容器（node:24-alpine），加入 sub2api 的 docker 网络以容器名互通。
- 站点提权：本机站点走 pg 连接；远程站点走 `ssh + docker exec psql`（token 回源 / 改 role / 观测）。

## 前置条件
- 已运行的 sub2api（含其 postgres 容器），且本平台容器能加入同一 docker 网络。
- Docker + docker compose。
- sub2api 的 **只读 PG 用户**（观测/本机 token 回源）与 **可写 PG 用户**（改 role）。最简：只读用 `observer_readonly`，可写直接用 sub2api 自身 PG 用户。建只读用户示例：
  ```sql
  CREATE USER observer_readonly WITH PASSWORD '...';
  GRANT CONNECT ON DATABASE sub2api TO observer_readonly;
  GRANT USAGE ON SCHEMA public TO observer_readonly;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO observer_readonly;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO observer_readonly;
  ```

## Quick Start
```bash
git clone <this-repo> && cd <repo>/console
cp .env.example .env          # ① 填 DATABASE_URL / ADMIN_DATABASE_URL / CONSOLE_ADMIN_PASSWORD / SUB2API_NETWORK
mkdir -p data secrets/ssh     # ② 生成远程站点提权用 keypair(没有远程站点也建议生成)
ssh-keygen -t ed25519 -N '' -f secrets/ssh/id_ed25519
docker-compose up -d          # ③ 首次会构建镜像
```
浏览器打开 `http://<host>:<CONSOLE_PORT>` → 用 `CONSOLE_ADMIN_PASSWORD` 登录 → 「站点管理 → 添加站点」接入第一个 sub2api。

> 远程站点提权：把本平台公钥（站点弹层里一键复制，或 `GET /api/console-pubkey`）加到目标机 `~/.ssh/authorized_keys`。

## 接入一个 sub2api 站点（站点契约）
**A. 必填（基础管理：账号池/批量/清理/删除/用户启禁）**

| 信息 | 含义 | 如何获取 |
|---|---|---|
| 站点名 | 任意标签 | 自取 |
| Base URL | `http://<host>:<网关端口>/api/v1` | sub2api 网关地址 + `/api/v1`；同 docker 网可用容器名 `http://sub2api:8080/api/v1` |
| Admin API Key | admin REST 鉴权(x-api-key) | 登录该 sub2api 管理员 → 首次接受合规承诺 → 管理员设置 → Admin API Key → 生成 |
| 类型 | local（与本平台同 docker 网）/ remote | 自判 |

**B. 选填（提权通道，再解锁：改 role + oauth 盘点 + 观测）**

| 信息 | 含义 | 如何获取 |
|---|---|---|
| ssh_host | 目标机 SSH `root@host`（非22端口 `root@host:port`） | 目标机 SSH 登录；把本平台公钥加入其 `~/.ssh/authorized_keys` |
| pg_container | sub2api postgres 容器名 | 目标机 `docker ps`；官方部署默认 `sub2api-postgres` |

本机(local)站点无需 ssh（token/role 走 pg 连接、观测走只读连接）。提权通道是统一开关：配好即同时点亮 改role/盘点/观测。

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `CONSOLE_PORT` | 否 | 21013 | 对外 Web 端口（宿主机） |
| `SUB2API_NETWORK` | 是 | sub2api_sub2api-net | 加入的 docker 网络（须与 sub2api postgres 同网） |
| `DATABASE_URL` | 是* | — | 本机站点 sub2api PG「只读」连接（观测 + 本机 token 回源） |
| `ADMIN_DATABASE_URL` | 否 | =DATABASE_URL | 本机站点「可写」连接（改 role 用 UPDATE） |
| `CONSOLE_ADMIN_PASSWORD` | 是 | — | 管理员登录密码（首启播种为哈希存库） |
| `CONSOLE_MASTER_KEY` | 否 | 自动生成 | 凭据加密主密钥；自动生成后存库，请随 data 卷备份 |
| `CONSOLE_DB_PATH` | 否 | /data/console.db | 工具侧 SQLite 路径 |
| `CONSOLE_PROBE_MODEL` | 否 | gpt-5.5 | 探活用模型 |
| `CONSOLE_PROBE_PROXY` | 否 | 空(直连) | oauth 探活访问 openai 的出口代理（socks5h/http），如 `socks5h://host:port` |
| `PORT` | 否 | 21013 | 容器内监听端口，**勿改**（compose 已映射 21013） |

\* 至少要有一个本机站点才需要 `DATABASE_URL`；纯远程站点可不填（走 ssh 通道）。

## 安全提示
- **务必改掉 `CONSOLE_ADMIN_PASSWORD`**；平台具备写/删除/改 role 能力且默认公网可达。
- `.env`、`data/`（含密码哈希、master_key、加密后的站点凭据）、`secrets/ssh`（提权私钥）**绝不入库**（已在 .gitignore）。
- `CONSOLE_MASTER_KEY` 丢失则无法解密已存站点凭据，请随 `data/` 一起备份。
- `secrets/ssh` 私钥只读挂载；远程站点只需把对应**公钥**装到目标机。
- 单一真相源：本地 SQLite 可随时从 sub2api 重建，不持有权威副本。

## 许可证
MIT（见 [LICENSE](./LICENSE)；版权人请发布前自填）。
