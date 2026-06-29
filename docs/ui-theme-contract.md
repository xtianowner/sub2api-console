<!-- purpose: sub2api-console UI 基础层契约 —— 双主题 token 清单 + 共享 class 全目录 + 页面 agent 硬规则。下游 3 个页面 agent 必读。 -->

创建时间: 2026-06-16 15:14:07
更新时间: 2026-06-16 15:14:07

# Sub2API Console — UI 主题契约（基础层）

本文档是「设计基础层」对下游 3 个页面 agent（观测 / 账号池 / 平台管理）的接口契约。
基础层已钉死：完整 light + dark 双主题 token 系统 + 全部共享 class（token 驱动）+ 主题切换机制。

- 基础层文件（页面 agent **禁止编辑**）：
  - `console/app/src/App.css` —— 全局 token + 全部共享 class（唯一允许出现颜色字面量的地方，且只能在 token 定义块内）
  - `console/app/src/App.tsx` —— 应用外壳 + 主题/语言切换
  - `console/app/src/index.css` —— base reset + `color-scheme`
  - `console/app/src/lib.tsx` —— 共享原语 + i18n copy + `OWNER_COLORS`
  - `console/app/src/api.ts` —— 数据层
- 页面文件（页面 agent 各自负责）：`console/app/src/pages/{observability,pool,admin}.tsx`

---

## (d) 主题机制

- 主题通过 **`<html data-theme="dark">`** 属性切换（无属性或 `data-theme="light"` = 浅色，默认）。
- App.tsx 状态：`localStorage['console-theme'] ∈ {'light','dark'}`，首次默认取 `matchMedia('(prefers-color-scheme: dark)')`。
- 顶栏有 ☀/🌙 segmented 切换（class `lang-switch segmented theme-switch`）。
- `index.css` 设 `html { color-scheme: light dark }`，body 背景走 `var(--bg)`。
- **页面局部覆盖写法**：页面如需对某主题微调，用属性选择器 + 页面前缀类：
  ```css
  .obs-foo { background: var(--surface); }
  :root[data-theme="dark"] .obs-foo { /* 仅暗色覆盖，仍只用 var(--token) */ }
  ```

---

## (a) 完整 Token 清单

> 所有 token 在 `App.css` 的 `:root`（light，默认）与 `:root[data-theme="dark"]`（dark 覆盖）两处定义。
> **未在 dark 块出现的 token 沿用 light 值。** 页面只准引用 `var(--token)`，永不写死颜色。

### 表面 / 层次
| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--bg` | `#f1f5f9` | `#0b0f17` | 应用底板（冷调 off-white / 近黑） |
| `--surface` | `#ffffff` | `#141a24` | 一级卡面 / 面板 / 表格容器 |
| `--surface-2` | `#f8fafc` | `#1b2330` | 二级面：表头、内嵌、渐变卡浅端、hover 行底、kv 底 |
| `--elevated` | `#ffffff` | `#1a212d` | 浮起元素：modal / toast |
| `--overlay` | `rgba(15,23,42,.45)` | `rgba(2,6,14,.62)` | modal 遮罩 |
| `--border` | `#e2e8f0` | `#283142` | 主描边 |
| `--border-strong` | `#cbd5e1` | `#3a4456` | 强描边 / hover 卡边 |
| `--hairline` | `#f1f5f9` | `#1f2734` | 表格行分隔细线 |

### 文字（含对比度，正文需 ≥4.5:1）
| Token | Light | Dark | 用途 / 对比注记 |
|---|---|---|---|
| `--text` | `#0f172a` | `#f3f6fb` | 正文。L 16.3:1 / D 17.7:1 on `--bg` |
| `--text-2` | `#334155` | `#cbd5e1` | 次正文 / 按钮文字 / mono。L 10.4:1 / D 11.8:1 on surface |
| `--muted` | `#5b6675` | `#94a3b8` | 次要文字。L 5.3:1 on bg / D 7.5:1。正文安全 |
| `--subtle` | `#94a3b8` | `#64748b` | 分组标题 / placeholder。**仅大字/装饰**，勿用于正文 |
| `--on-accent` | `#ffffff` | `#07101f` | **实心强调色背景**上的前景（关键：dark 下强调色被提亮→前景用深色） |
| `--on-dark` | `#ffffff` | `#0b0f17` | **`--text` 色填充块**（brand-mark / sidebar.active / segmented.active / `.primary`）上的前景 |

### 强调 / 语义（实心色）
| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--primary` | `#2563eb` | `#60a5fa` | 主强调（按钮实心 / range-tab active / seg-btn active 文字） |
| `--primary-hover` | `#1d4ed8` | `#93c5fd` | primary 悬停 |
| `--primary-ring` | `rgba(37,99,235,.14)` | `rgba(96,165,250,.22)` | 输入聚焦光环 |
| `--success` | `#059669` | `#34d399` | 成功（dot / 大数字 / btn-success） |
| `--success-hover` | `#047857` | `#6ee7b7` | success 悬停 |
| `--success-ring` | `rgba(5,150,105,.14)` | `rgba(52,211,153,.20)` | 健康 dot 光环 |
| `--danger` | `#e11d48` | `#fb7185` | 危险（实心删除 / login-err / 大数字） |
| `--danger-hover` | `#be123c` | `#fda4af` | danger 悬停 |
| `--warning` | `#d97706` | `#fbbf24` | 警告（amber 大数字） |

### 语义文字（soft 底上的文字，全部 ≥4.5:1）
| Token | Light | Dark | 用在 |
|---|---|---|---|
| `--primary-text` | `#1d4ed8` | `#93c5fd` | badge.client/normal, tag.role-admin, status-pill |
| `--success-text` | `#047857` | `#6ee7b7` | tag.alive/active, mini-btn.green, toast.ok |
| `--danger-text` | `#be123c` | `#fda4af` | tag.dead/auth_fail/disabled, badge.platform, danger-pill, dz-label, toast.err, error-banner |
| `--warning-text` | `#c2410c` | `#fcd34d` | tag.rate_limited, badge.provider |
| `--violet-text` | `#6d28d9` | `#c4b5fd` | tag.no_codex_perm |
| `--neutral-text` | `#475569` | `#cbd5e1` | tag.pending/transient/role-user, cond-pill, seg-btn, legend, kv, range-tabs |

### soft 背景 / 边框
| Token | Light | Dark |
|---|---|---|
| `--soft-blue` / `--soft-blue-border` | `#eff6ff` / `#bfdbfe` | `#16263f` / `#2b4a6f` |
| `--soft-red` / `--soft-red-border` / `--soft-red-border-2` | `#fff1f2` / `#fda4af` / `#fecdd3` | `#3a1620` / `#6b2434` / `#5a2030` |
| `--soft-amber` | `#fff7ed` | `#3a2410` |
| `--soft-green` / `--soft-green-2` / `--soft-green-border` | `#ecfdf5` / `#d1fae5` / `#a7f3d0` | `#0e2c22` / `#14422f` / `#1d5c44` |
| `--soft-violet` | `#f5f3ff` | `#241b3d` |
| `--soft-neutral` | `#f1f5f9` | `#1f2734` |
| `--danger-zone-bg` | `#fff5f6` | `#2a141c` |
| `--attention-bg` | `#fbfdff` | `#161d28` | attention/notice 卡底 |

### 控件 / 渐变 / 归因 / 阴影 / 杂项
| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--input-bg` | `#ffffff` | `#10161f` | input/select/textarea 底 |
| `--field-track` | `#e2e8f0` | `#283142` | usage-bar / prog 轨道 |
| `--grad-blue-from/to` | `#60a5fa`/`#2563eb` | `#3b82f6`/`#60a5fa` | bar / prog-fill |
| `--grad-red-from/to` | `#fb7185`/`#e11d48` | `#e11d48`/`#fb7185` | bar.error / usage-fill.high |
| `--grad-green-from/to` | `#34d399`/`#059669` | `#059669`/`#34d399` | usage-fill |
| `--grad-amber-from/to` | `#fbbf24`/`#d97706` | `#d97706`/`#fbbf24` | usage-fill.warn |
| `--owner-provider/client/platform/normal/unknown` | `#f59e0b`/`#2563eb`/`#e11d48`/`#059669`/`#94a3b8` | `#fbbf24`/`#60a5fa`/`#fb7185`/`#34d399`/`#64748b` | `*-dot` class。**与 `lib.tsx` OWNER_COLORS 对应**（见下方注意） |
| `--shadow-sm/md/lg/xl/hover/inset-active/seg-active` | 浅阴影 | 深黑阴影 | 卡片/弹层/按钮浮起 |
| `--topbar-bg` | `rgba(255,255,255,.82)` | `rgba(15,21,31,.78)` | 顶栏半透明（blur） |
| `--login-glow` | `#eef2ff` | `#16263f` | 登录页径向辉光 |
| `--skeleton-base` / `--skeleton-sheen` | `#e9eef4` / `rgba(255,255,255,.65)` | `#1f2734` / `rgba(255,255,255,.07)` | 骨架屏 |

### 非颜色 token（两主题恒定）
- 半径：`--radius-sm 8` / `--radius 10` / `--radius-md 12` / `--radius-lg 16` / `--radius-xl 20` / `--radius-full 999`（px）
- 动效：`--dur-fast .15s` / `--dur-base .22s` / `--dur-slow .35s` / `--ease-out cubic-bezier(.16,1,.3,1)`

---

## (b) 共享 class 全目录

> 这些 class 已在 `App.css` 定义且页面正在引用。**禁止改名/删除**。页面直接复用即可，无需重定义。

### 外壳
`app-shell` `topbar` `topbar-actions` `brand` `brand-mark` `global-search` `readonly`
`layout` `sidebar` `sidebar-group` `sidebar-note` `main`
`page-title`（内含 `h1`/`p`）`range-tabs`（子 `button` + `.active`）
`site-switch` `site-dot`（+ `.healthy` / `.unhealthy`）`icon-btn`
`lang-switch segmented`（子 `button` + `.active`）— 主题切换额外加 `theme-switch` 修饰类

### 按钮家族
- `btn`（基础）+ `btn-primary` / `btn-success` / `btn-sm`，`:disabled` 自动半透明
- `primary`（深色实心，用 `--text` 底 + `--on-dark` 文字）
- `mini-btn`（+ `.green`）批量栏小按钮
- `cond-pill` 条件选中 pill
- `seg-wrap` + `seg-btn`（+ `.active`）分段选择器
- `danger-pill`（描边红）/ `danger-pill-solid`（实心红）/ `danger-zone`（含 `.dz-label`）

### 面板 / 卡片
- `panel`（内含 `h2`）`panel-head`（含 `p`）`muted`
- `metric-card`（内 `span`/`strong`/`small`；tone 类：`.green` `.red` `.amber` `.blue` `.dim` 加在 `strong` 上）
- `grp-card` / `site-card`（内 `h3` / `.sub` / `grp-stats`(含 `b`) / `card-actions`），网格 `grp-grid` / `site-grid`
- `setting-card`（+ `.setting-card-wide`）`settings-panel` `settings-head` `settings-grid` `status-pill`
- `overview-stack` `content-grid` `lower-grid` 布局网格

### 表格
- `table-wrap`（横向滚动容器）`table` `th` `td` `tr`（hover 高亮）
- `trunc`（+ `.trunc-id` / `.trunc-user` / `.trunc-msg`）`mono`
- `col-check`（复选列，内 `input[checkbox]`）`empty`（空态行）

### Badge / Tag（动态拼接，组合类全清单）
- `badge` + 其一：`provider` / `client` / `platform` / `normal`
- `tag` + 其一：`alive` / `dead` / `auth_fail` / `rate_limited` / `no_codex_perm` / `pending` / `transient` / `active` / `disabled` / `role-admin` / `role-user`
- 归因 dot：`normal-dot` / `unknown-dot` / `provider-dot` / `client-dot` / `platform-dot`

### 表单 input / select / textarea
- 全局 `input` `select` `textarea` 已 token 化（聚焦光环 `--primary-ring`）。`.bulk-val` 定宽变体。
- `filters`（含 `> input` / `> select`）`field-row`（两列网格）`toolbar`

### 弹层 / Toast
- `modal-backdrop` `modal`（内 `h3` / `label` / `input` / `textarea` / `code`）`modal-actions`
- `toast-wrap` `toast`（+ `.ok` / `.err`）

### 用量 / 进度 / 条件 / 批量
- `usage` `usage-bar` `usage-fill`（+ `.warn` / `.high`）
- `prog` `prog-fill`
- `cond-row` `cond-label` `cond-pill`
- `bulk-bar` `bulk-count` `bulk-spacer` `bulk-edit-zone` `bar-div`

### 图表
- `bars` `bar`（+ `.error`）`chart-empty` `donut-wrap` `donut` `legend`（含 `i`）`error-banner`
- `attention-list` `attention-card`

### 其它
- `kvs` `kv`（含 `b`）`notice`（含 `b`）`row-actions`
- 登录：`login-shell` `login-card` `login-err`

### 骨架 / spinner / 动效
- `skeleton`（+ `.sk-line` / `.sk-cell` / `.sk-card`）`skeleton-cards` `spinner`
- 入场动画 class：`fade-rise`（页面切换）；`metric-card`/`grp-card`/`site-card` 自带 `cardIn` 错峰入场 + hover 抬升
- 共享原语（来自 `lib.tsx`，直接 import 用）：`Spinner` `SkeletonRows` `SkeletonCards` `MetricCard` `VerdictTag` `Usage` `Modal` `ToastProvider`/`useToast`

---

## (c) 页面 agent 硬规则

1. **只准用 `var(--token)`，永不写死颜色**。内联 `style={{}}` 里也只能写 `var(--token)`（如 `style={{ color:'var(--success)' }}`）。禁止任何裸 hex / rgb / 颜色名。
2. **页面样式写到 `pages/<name>.css`**，并在该页 `.tsx` 顶部 `import './<name>.css'`。不准把样式塞回 App.css。
3. **所有新增 class 必须带页面前缀**防全局撞名：
   - 观测页 → `obs-`，账号池页 → `pool-`，平台管理页 → `adm-`
   - 例：`.obs-trend-axis`、`.pool-tier-row`、`.adm-pubkey-box`
4. **禁止编辑** `App.css` / `App.tsx` / `lib.tsx` / `index.css` / `api.ts`。需要新共享 token / class 时，提给基础层，不要自己加到 App.css。
5. **禁止重命名/删除任何现有 class**（上方 (b) 全目录），页面逻辑依赖它们。
6. **两套主题都要正确**：任何新样式，浅色 + 暗色都要测。需主题差异化时用 `:root[data-theme="dark"] .前缀-xxx {}`。新颜色一律走已有 token；确需新色值时申请加到基础层两主题块。
7. **禁止新增任何 npm 依赖**（本项目刻意零额外依赖，纯 CSS + React）。
8. **不改功能 / 数据流 / props / 事件 handler / i18n 键语义**。纯视觉。i18n 文案如需新增键，须 `zh` + `en` 成对加（基础层负责 lib.tsx，页面 agent 不动 lib.tsx → 文案需求提给基础层）。
9. 正文文字对比 ≥4.5:1；大字（≥18.66px bold 或 ≥24px）≥3:1；focus ring 可见（基础层已全局给 `:focus-visible`）；icon-only 按钮带 `aria-label`。
10. 动效克制：仅 transform/opacity，150–250ms，复用基础层动画 token（`--dur-*` / `--ease-out`）。已有全局 `prefers-reduced-motion` 兜底，不要新增无限动画。

---

## 注意：`lib.tsx` 的 `OWNER_COLORS`（基础层维护，页面只读）

`lib.tsx` 导出 `OWNER_COLORS`（JS 常量，含裸 hex），驱动观测页 donut conic-gradient / legend `i` 的内联 `style.background`：
```ts
OWNER_COLORS = { provider:'#f59e0b', client:'#2563eb', platform:'#e11d48', normal:'#059669', unknown:'#94a3b8' }
```
- 这是 JS 内联颜色源（CSS `var()` 无法注入 conic-gradient 的逐段 stop），与 CSS 的 `--owner-*` token 在 **light 下数值一致**。
- **页面 agent 不要在自己代码里复制这些 hex**，调用 `ownerColor(o)` 即可。
- 已知小瑕疵（基础层 backlog，页面 agent 勿自行修）：`OWNER_COLORS` 是单值，暗色下未跟随 `--owner-*` 提亮，故暗色 donut/legend 用的是 light 值。视觉可接受（donut 在 `--surface` 上，legend 文字另由 `--neutral-text` 控制）。如需暗色精确化，由基础层把 `ownerColor()` 改为读 `getComputedStyle` 的 `--owner-*`。

---

## (扫描结果) pages/*.tsx 内联硬编码颜色清单 — 待页面 agent 修复

**扫描结论：三个页面文件的内联 `style={{}}` 中无任何裸 hex / rgb 颜色。** 全部已正确使用 `var(--token)`：
- `pages/pool.tsx`：内联色全为 `var(--success)` / `var(--danger)` / `var(--warning)` / `var(--bg)` / `var(--border)`（grp-stats 数字、upstream 结果区 code 块、error 文字等）。
- `pages/admin.tsx`：内联色全为 `var(--danger)` / `var(--bg)` / `var(--border)`（pubkey code 块、缺密钥告警）。
- `pages/observability.tsx`：内联色用 `var(--border)`（donut 空态）与 `ownerColor()`（来自 lib.tsx，非页面内联字面量）。

→ **页面 agent 无需修复硬编码颜色**。重构时注意保持这些 `var()` 写法，新增内联色继续只用 `var(--token)`。
唯一 JS 侧裸 hex 是 `lib.tsx` 的 `OWNER_COLORS`，归基础层（见上节），页面勿动。
