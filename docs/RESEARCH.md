# 思源笔记 (SiYuan) × DeepSeek Harness 调研归档

> 项目状态：**已归档（不再维护）**。插件已从 DSH 卸载；本仓库保留调研、设计、内核 API 实测与代码，供以后参考。
> 归档时间：2026-11-22。

## 1. 为什么做、为什么停

- 目标：让「记笔记 / 查笔记 / 让 Agent 读写笔记 / 存对话产出」都在 DSH 一个地方完成（来自思源里的方案计划 v1）。
- 做到的部分：Agent 工具层、文档树、右栏笔记视图、回答一键存入、入口开关、设置页，均可用（e2e 53 项通过）。
- 停止的原因：**未能满足「在 DSH 里像浏览器登录思源那样使用完整界面」的核心诉求**。完整界面内嵌受浏览器安全模型限制（见 §4），而简易视图的操作体验达不到用户期望，因此归档。

## 2. 方案调研：GitHub 上已有的同类项目

| 项目 | 形态 | 结论 |
| --- | --- | --- |
| [SherinG-official/dsh-siyuan-api](https://github.com/SherinG-official/dsh-siyuan-api) | DSH 插件，5 个工具，无 UI | 思路最接近：走内核 HTTP API、不碰 `.sy`、只读 SQL 双保险 |
| [yoursc/dsh-siyuan](https://github.com/yoursc/dsh-siyuan) | DSH 插件，17 工具 + 设置页 | 功能最全，但只有设置页，无侧栏浏览/回答动作 |
| SiYuan 官方 MCP（`POST /mcp`） | 思源内置，35 工具 / 87 KB schema | 能力全，但上下文成本高、Token 需明文进配置 |
| [siyuan-note-mcp](https://www.npmjs.com/package/siyuan-note-mcp) / [PurpleLiu/siyuan-mcp](https://github.com/PurpleLiu/siyuan-mcp) / [OpaqueGlass/syplugin-anMCPServer](https://github.com/OpaqueGlass/syplugin-anMCPServer) | 通用 MCP server | 面向任意 MCP 客户端，不解决 DSH 侧 UI 与凭据 |

选型：自研 DSH 插件（工具面可控 + Token 进 DSH 凭据库 + 有界面入口）。

## 3. 思源内核 API 实测要点

完整字段级实测见 [KERNEL-NOTES.md](KERNEL-NOTES.md)（对着思源 3.8.9/3.8.11 逐条验证）。最关键的几条：

- `createDocWithMd` 的 `path` 是文档树路径：父文档缺失/重名会报 `document metadata is not ready` / `path is ambiguous`，改「标题 2」重试无效；建子文档要用 3.8.9+ 的 `filetree/createDocByParent`（按父文档 id，标题可含 `/`）。
- `/api/query/sql` **默认具备写能力**：必须显式传 `mode:'readonly'`，否则 `UPDATE/DELETE` 会真的执行。
- 删除是异步的：`removeDocByID` 返回 0 后 2–3 秒索引才消失，清理脚本要等后再复查。
- `createDailyNote` 同天幂等，但会连带创建 3 层父文档（测试清理要删 4 篇）。
- `exportMdContent` 传 `{yfm:false, addTitle:false}` 直接拿纯正文；`getBlockKramdown` 带 IAL。
- 深链只有 `siyuan://blocks/<id>`；内核不提供 Web 链接，自己拼 `${endpoint}/stage/build/desktop/?id=<id>`。
- 浏览器可打开的 Web 地址：`http://127.0.0.1:6806/?id=<docId>`（302 到 desktop 构建页）。

## 4. 为什么「在 DSH 里内嵌完整思源界面」没做成

尝试顺序与结论：

1. **直接 iframe 6806** → 内核拒绝浏览器跨站请求（`Sec-Fetch-Site` 非 `same-origin`/`none` 返回 401「不允许跨站请求」）。
2. **本机反向代理 + 随机凭证 + `SameSite=Strict` cookie** → DSH 桌面端页面是 `dsh-app://app/` 自定义协议，iframe 属于**跨站子框架**；浏览器按顶层站点计算 SameSite，Strict cookie 不随子资源发送 → JS/CSS/API 全部 403，界面空白 + 裂图（用无头浏览器复现）。
3. **改用 `Sec-Fetch-Site` 放行** → 仍受跨站子框架策略影响，稳定性不可控；继续做需要 Service Worker 注入鉴权头等复杂机制，收益不抵成本。

结论：**不做内嵌**。完整界面改为顶栏「浏览器打开」在系统浏览器里打开思源原生 Web UI；DSH 内保留简易视图（文档树、搜索、预览、追加、新建、回答存入）。

## 5. 这套代码里值得复用的部分

- `docs/KERNEL-NOTES.md`：思源 3.8.9/3.8.11 内核 API 字段级实测（含版本差异与坑）。
- `docs/CONTRACT.md`：Host ⇄ Client 的同源路由契约（避开宿主 `/api`、CSRF 头、错误码约定）。
- `docs/DESIGN.md`：v1 方案 → v2/v3/v4 迭代 → v5 内嵌失败与回滚的完整决策记录。
- `test/e2e.mjs`：53 项黑盒测试（真实内核 + 干净数据 + 清理复查）。
- `index.js`：Host 侧 9 个 `siyuan_*` 工具与 `/siyuan/*` 路由（只读 SQL 双保险、Token 进凭据库）。
- `client.js`：纯 `React.createElement` 的 DSH Client 插件写法（侧栏面板、右栏 tab、对话区视图、输入框按钮、设置页）。

## 6. 时间线

- 2026-11-06：在思源里写方案计划 v1（另一台电脑）。
- 2026-11-08：本机实现 v1（工具 + 面板 + 回答动作）；v2 文档树排序 + 右栏笔记视图；v3 深浅树懒加载/正文续读/位置记忆/默认文档；v4 入口显示开关。
- 2026-11-22：v5 尝试 iframe 内嵌与本地反向代理，受浏览器跨站 SameSite 限制失败；回滚内嵌，改为「浏览器打开」；随后归档、转私有、卸载插件。
