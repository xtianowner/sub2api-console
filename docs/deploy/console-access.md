<!-- purpose: Sub2API 控制台「当前访问方式 + HTTPS 架构 + 运维速查」权威参考（现状型，非流水日志；变更经过见 00TEM/NowTodo/review.md） -->
创建时间：2026-06-16 21:42:49
更新时间：2026-06-16 21:42:49

# 控制台访问与 HTTPS 运维速查

> 凭据（口令 / CF token / DB 密码）一律不写本文件，用占位符。明文存放：机器自身 env / systemd / SQLite（随卷备份）。

## 1. 怎么访问（canonical）
- 入口：**https://<CONSOLE-DOMAIN>**（Cloudflare 真证书）。旧的明文 `http://<VPS-IP>:<PORT>` **已关闭**。
- 登录：**用户名 + 密码**。主账号 **<管理员账号>**（口令私密、不入库），role=master，看全部站点 + 管成员/站点。
- 子账号：master 在「控制台 → 成员管理」里建，勾选可见站点；在授权站点内为完整运维权限（越权由后端 403 拦截）。
- SSH 运维：`sshpass -e ssh -p <SSH-PORT> root@<VPS-IP>`（直连，**不套代理**）。

## 2. HTTPS 架构（Cloudflare Tunnel）
NAT 机无 80/443，普通 CF 橙云代理走不通 → 用 **CF Tunnel**（出站连接器，无入站端口、无需备案）。

```
浏览器 ──https──▶ Cloudflare 边缘(sjc) ──QUIC隧道──▶ cloudflared(机器,host systemd)
                                                        └─http─▶ localhost:<PORT> ─▶ 容器:21013
```

- 隧道名 `<TUNNEL-NAME>`，TunnelID `<TUNNEL-ID>`。
- **本地托管配置**（绕开 ZT 界面"公共主机名"难找）：
  - `/etc/cloudflared/config.yml` → ingress `<CONSOLE-DOMAIN> → http://localhost:<PORT>`
  - 凭据 `/root/.cloudflared/<TunnelID>.json`（由 dashboard 连接器 token 拆 a/t/s → AccountTag/TunnelID/TunnelSecret 生成）
  - systemd drop-in `/etc/systemd/system/cloudflared.service.d/override.conf` 把 ExecStart 改成 `--config ...`（不用 `--token`）
- DNS：CF 里 `smar` = **橙云代理 CNAME → <TunnelID>.cfargotunnel.com**（⚠ 必须橙云；"私有主机名"是 WARP 内网用，错误）。
- 后端 `app.set('trust proxy', true)`（server/index.ts）→ 据 X-Forwarded-Proto 判 https，会话 cookie 带 `Secure`。

## 3. 安全：明文入口已关
- 容器端口绑 **`127.0.0.1:<PORT>`**（非 0.0.0.0）；DNAT 仅对 `-d 127.0.0.1` 生效。cloudflared 经 localhost 回源照常。
- 公网/局域网直连 `:<PORT>` → refused。`http://<VPS-IP>:<PORT>` 经腾讯网关返回 **502**（后端拒，非面板，不泄露）。
- 彻底干净（可选）：腾讯云控制台删 <PORT> 端口转发/CLB 规则；**<SSH-PORT>(SSH) 勿动**。

## 4. 运维速查
- 隧道状态：`systemctl status cloudflared` / `journalctl -u cloudflared -n 30`（看 `Registered tunnel connection`）。
- **DNS 坑（已修，勿回退）**：cloudflared edge 发现要查 SRV `_v2-origintunneld._tcp.argotunnel.com`；机器原 114.114.114.114 对 SRV 不稳会导致启动失败。已把 `/etc/resolv.conf` 改 `<DNS>` + `/etc/systemd/resolved.conf` 持久化。
- **重建容器**（env 已 commit 进 `sub2api-console:local` 镜像，无需重列 -e）：
  ```bash
  docker run -d --name sub2api-console --restart unless-stopped \
    -p 127.0.0.1:<PORT>:21013 \
    -v /opt/sub2api-console/data:/data \
    -v /opt/sub2api-console/secrets/ssh:/root/.ssh:ro \
    sub2api-console:local
  ```
- 改前端/后端的部署法：见 review.md「docker cp + commit」段（无新依赖时本地 build → cp dist/server-dist → restart → commit）。

## 5. 关联
- 变更经过（流水）：`00TEM/NowTodo/review.md` 各 2026-06-16 段。
- 部署位置/镜像/迁移约束：见集中记忆 `sub2-console-deploy-location`。
