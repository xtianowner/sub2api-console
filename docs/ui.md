<!-- purpose: Sub2API Console 前端 UI/动效设计记录 -->
创建时间：2026-06-15 16:00:00
更新时间：2026-06-16 15:42:48

# UI / 动效设计

风格：沿用 Observer **浅色数据中台**（手写 CSS token，见 `app/src/App.css` `:root`）。Phase 1 功能闭环后做 Phase 2 动效（经 ui-ux-pro-max 决策）。

## Phase 2 动效（2026-06-15，克制、专业、可访问）
依据 ui-ux-pro-max(ux 域)：加载态 skeleton(>300ms)、时长 150–300ms、用 transform/opacity、占位防跳动、每屏 1–2 处关键动效、ease-out 入场、尊重 prefers-reduced-motion。

- **加载骨架**（解决"点总览/管理等数据时无反馈"）：
  - 表格 `SkeletonRows`(扫光占位行，尺寸匹配表头列数，防 layout shift)：账号管理/导入批次/回收站/用户/反馈表。
  - 卡片 `SkeletonCards`：账号池总览、观测 KPI。
  - 扫光用伪元素 `transform: translateX` 动画（性能友好）。
- **内容/页面切换**：主内容区按 `page:siteId` 加 key 的 `.fade-rise`（opacity+translateY 8px，220ms ease-out），切页/切站点重新淡入。
- **卡片入场错峰**：总览/分组/站点卡 `cardIn` 26ms 起 4 档延迟（≤16ms*4），不超过 1-2 处观感原则的合理延伸。
- **微交互**：卡片 hover 微抬升(translateY -2px+阴影)；按钮 hover 色彩过渡(原有)。
- **按钮异步态**：`Spinner`（边框旋转）用于 登录/刷新/搜索/导入/中转/保存站点，busy 时禁用+转圈。
- **Toast/弹层入场**：toastIn / modalIn（淡入+轻微位移/缩放，150–200ms）。
- **进度条**：`.prog-fill` width 过渡 350ms（盘点/清理进度平滑）。
- **可访问**：`@media (prefers-reduced-motion: reduce)` 全局关动画/过渡；`html{scroll-behavior:smooth}`。

组件入口：`app/src/lib.tsx` 的 `Spinner / SkeletonRows / SkeletonCards`；样式在 `app/src/App.css` 末段"动效/加载态"。

## 全面重构（2026-06-16，双主题 light+dark）

用户确认 Phase 1 闭环后做全面 UI/UX 重构，定为 **light + dark 双主题**（顶栏 ☀/🌙 切换，`localStorage['console-theme']`，首次取 `prefers-color-scheme`，应用于 `document.documentElement[data-theme]`）。

**架构（CSS-class 设计系统，分两层）：**
- **基础层**：`App.css` 全色值 token 化——`:root`（light）+ `:root[data-theme="dark"]`（dark 覆盖），定义块外零裸 hex；全部既有共享 class **保持类名 API 不变**（仅换 token 实现 + 补暗色 + 升级观感）。`App.tsx` 加主题切换、`lib.tsx` 共享原语、`index.css` 设 `color-scheme`。
- **页面层**：每页样式落到独立的 `pages/<name>.css`（前缀隔离 `obs-/pool-/adm-`，只引 `var(--token)`），由该页 tsx import；**不碰** App.css/lib.tsx/api.ts。

**完整 token 清单 + 共享 class 全目录 + 页面 10 条硬规则**：见 `docs/ui-theme-contract.md`（唯一真相源，本文件不重复）。

**多 agent 编排（详见 `00TEM/NowTodo/review.md` 调度日志）：** R1 基础层先行（串行，定双主题契约）→ R2 三页面并行（按文件分区零互踩，本仓库非 git 无法用 worktree 隔离，靠文件分区）→ R3 UX 督察审计（双主题渲染 + 对比度实算 + 响应式 + 回归）→ 主 agent 收口修复。

**R3 审计修复（已落地）：** ① 移动端(375) 顶栏溢出（`.topbar` 允许换行 + 收缩 brand/actions/lang 按钮）② 账号页 `.bulk-edit-zone/.danger-zone/.seg-wrap` 移动端放开换行（原 nowrap 撑破布局）③ `.pool-up-result-warn/-err` 浅色对比改用 `--warning-text/--danger-text` ④ `.sidebar-group` `--subtle`→`--muted`（达 AA）。`npm run build`(tsc+vite) exit 0。
