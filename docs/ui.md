<!-- purpose: Sub2API Console 前端 UI/动效设计记录 -->
创建时间：2026-06-15 16:00:00
更新时间：2026-06-15 16:00:00

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
