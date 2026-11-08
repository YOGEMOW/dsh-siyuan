# 思源接入 DSH —— 设计方案 v2（落地版）

> 承接思源笔记 `/领域知识库/AI/DeepSeek Harness/DSH项目/思源接入DSH-方案计划`（v1，写于另一台电脑）。
> 本文件记录「在本机真正把这个插件做出来」的架构、取舍、与原方案的偏差、验证结果。
> 实现位于 `E:\DSH-workspace\dsh-siyuan`，包名 `@yogemow/dsh-siyuan`，已以 link 方式装进 `desktop` profile。

---

## 一、先做调研：GitHub 上已经有什么

| 项目 | 形态 | 与本方案的关系 |
| --- | --- | --- |
| [SherinG-official/dsh-siyuan-api](https://github.com/SherinG-official/dsh-siyuan-api) | DSH 插件，5 个 `siyuan_*` 工具（status/notebooks/search/create_doc/block），Node 内置 fetch 直连内核 | 思路最接近：同样走内核 HTTP API、不碰 `.sy`/`siyuan.db`、只读 SQL 双保险、错误可自愈。**没有 UI**，工具面偏少（无 recent/sql 独立工具/日记/深链），写入用 `confirm=true` 硬摩擦 |
| [yoursc/dsh-siyuan](https://github.com/yoursc/dsh-siyuan) | DSH 插件，17 个工具 + 独立设置页（连接/Token/默认笔记本/逐工具开关），Token 进凭据库 | 功能最全的现成实现。**设置页是它的主界面**，没有侧栏浏览/预览/回答动作；工具默认按组合开关 |
| SiYuan 官方 MCP（`POST /mcp`） | 思源内置，35 个工具 / 87 KB schema | v1 已实测可用。上下文成本高、Token 需明文进 profile 配置，只适合「先体验 10 分钟」 |
| [siyuan-note-mcp](https://www.npmjs.com/package/siyuan-note-mcp) / [PurpleLiu/siyuan-mcp](https://github.com/PurpleLiu/siyuan-mcp) / [OpaqueGlass/syplugin-anMCPServer](https://github.com/OpaqueGlass/syplugin-anMCPServer) | 通用 MCP server（13/66 工具） | 面向任意 MCP 客户端，不解决 DSH 侧 UI 与凭据；可作为兜底 |
| [siyuan-mcp-server](https://pypi.org/project/siyuan-mcp-server/) | Python MCP（只读或全量读写） | 需要 Python/uvx，多一层运行环境 |

**选型结论不变：走 v1 的 B 方案（自研 DSH 插件）。** 理由在本机被再次验证：

- 工具面可控（9 个，schema 约 8 KB），而官方 MCP 每轮都背 87 KB；
- Token 存 DSH 凭据库，浏览器拿不到；MCP 方案要明文写进 profile 配置；
- 只有自研才能同时拿到 **侧栏面板 + 回答动作 + 设置页** 三个界面入口（用户的目标是"不用来回切窗口"）。

与两个现成 DSH 插件的差异：**本实现 = dsh-siyuan-api 的克制工具面 + yoursc/dsh-siyuan 的凭据/设置 + v1 要的侧栏/回答动作**。没有直接 fork 的原因：两者都不提供 v1 的 L2/L3，且 webfetch 不到它们的完整实现，重写反而更短（Host ~1.1k 行、Client ~2.1k 行）。

---

## 二、架构

```
┌─────────────────────────── DSH Web UI（浏览器）───────────────────────────┐
│ client.js（纯 JS，ModuleLoader 懒加载）                                    │
│  sidebar.panellist  main(key=siyuan)  settings.section  assistant-actions  │
│         │                │                  │                │            │
│         └──────── fetch('/siyuan/*') ───────┴────────────────┘            │
└──────────────────────────────────┬────────────────────────────────────────┘
                                   │ 同源 HTTP（写操作带 x-dsh-siyuan 头）
┌──────────────────────────────────▼────────────────────────────────────────┐
│ index.js（Host）                                                          │
│  · 9 个 siyuan_* Agent 工具（ctx.tools.register）                          │
│  · /siyuan/* 路由（webServer.register，延迟注入；刻意避开 /api）           │
│  · 设置：$DSH_HOME/storages/siyuan/config.json                            │
│  · Token：ctx.credentials（CredentialKey=siyuan，kind=api-key）            │
│  · 系统提示词一小段（siyuan:usage）                                        │
└──────────────────────────────────┬────────────────────────────────────────┘
                                   │ 内核 HTTP API（默认 127.0.0.1:6806）
┌──────────────────────────────────▼────────────────────────────────────────┐
│ 思源内核（3.8.9）：query/sql、exportMdContent、createDocWithMd、           │
│ createDocByParent、appendBlock、insertBlock、createDailyNote、            │
│ exportMdContent(yfm:false)、filetree/getIDsByHPath …                      │
└───────────────────────────────────────────────────────────────────────────┘
```

**为什么 Client 不直连思源**：浏览器直连 6806 需要把 Token 放进页面（或依赖思源对本机免鉴权），既有泄露面也无法在非 127.0.0.1 部署；而且要让"回答动作"能从会话日志取正文，只能在 Host 做。所以 Client 只跟自己的 Host 说话。

**为什么路由不用 `/api`**：`/api` 前缀被宿主的 connection 共享 handler 接管并要求认证（study-equity 的注释与实测一致），挂 `/siyuan/*` 才能被同源页面直接 fetch。

---

## 三、L1：Agent 工具（9 个，默认只读）

| 工具 | 作用 | 读/写 |
| --- | --- | --- |
| `siyuan_status` | 版本、地址、Token 是否配置、写入开关、笔记本清单（含文档数） | 读 |
| `siyuan_notebooks` | 笔记本列表 + 默认笔记本 | 读 |
| `siyuan_search` | 全库子串检索（正文/标题/别名/备注），返回块 id、所属文档、hPath、片段 | 读 |
| `siyuan_read_doc` | 按文档/块 id 读 Markdown，行分页（offset/limit，上限 1200 行） | 读 |
| `siyuan_recent` | 最近更新文档 | 读 |
| `siyuan_sql` | 只读 SQL：单条 SELECT/WITH/EXPLAIN、无 LIMIT 自动补、内核侧 `mode:'readonly'` 双保险 | 读 |
| `siyuan_create_doc` | 新建文档（笔记本/父文档/标题/Markdown） | 写 |
| `siyuan_append` | 追加/前后插入 Markdown；`id="daily"` 追加到今日日记 | 写 |
| `siyuan_open` | 生成 `siyuan://blocks/<id>`、Web 链接、块引用语法 | 读 |

**与 v1 的偏差：写入开关的落点。** v1 写的是「`write: true` 才注册写工具」，实现改为**工具始终注册、执行时判定 `write`**：

- 好处：面板里拨开关立即生效（不用重启 Host、不用重开会话），工具 schema 稳定，模型能看到"有这个能力但当前被禁用"并给出正确引导；
- 安全性等价：`siyuan_create_doc` / `siyuan_append` / `/siyuan/save-message` 在 `write=false` 时统一返回 `SIYUAN_WRITE_DISABLED`（e2e 覆盖）；
- 代价：模型上下文里多两个写工具的 schema（约 1 KB）。

**写入的硬规则**（比 v1 更保守）：一期没有删除、移动、重命名；append 不做批量；`siyuan_sql` 永远只读。删除类能力要等用户明确要求再单独立项。

---

## 四、L2：界面合一（Client 四处 slot）

| slot | 内容 |
| --- | --- |
| `sidebar.panellist`（id `siyuan`，order 20） | 思源图标（currentColor，跟随主题） |
| `main`（key `siyuan`） | 主面板：连接状态点 + 版本 + 端点 + 只读标记；刷新；齿轮打开设置抽屉；笔记本下拉（全部/某个）；回车搜索；结果列表（标题/hPath/片段/格式化时间）；默认列表走 `/recent`；文档预览（pre-wrap 纯文本，不用 `dangerouslySetInnerHTML`）；「在思源打开」/「复制块链接」/「追加内容」（文本域+确认）；「新建文档」（标题/正文/目标笔记本） |
| `settings.section`（id `siyuan`，order 60） | 端点、API Token（只写不读，留空不改）、默认笔记本、写入开关、测试连接、保存、重新读取 |
| `conversation.chat.assistant-actions`（id `siyuan-save`，order 30） | 「存入思源」：弹层选笔记本、标题（留空取回答首行）、可选"追加到已有文档"（先搜索再选）；**只有点确认才写入**；成功后就地给「已存入 · 查看」+ `siyuan://blocks/<id>` |

实现约束（照宿主规矩）：纯 `React.createElement`、无 JSX/构建/第三方依赖；唯一 `require('react')`；颜色/背景/边框全部 `--dsw-alias-*` token；不写全局 CSS、不碰 `document.body`、不读别的插件 DOM；请求同源相对路径，写请求带 `x-dsh-siyuan`；卸载时 abort 在途请求；任何失败都落成一行带 code 的中文提示，不白屏。

---

## 五、L3：回答旁「存入思源」怎么拿到正文

`conversation.chat.assistant-actions` 的 owner props 只有 `messageId`（外加 standard props 里的 `sessionId`），**拿不到正文**。做法：

1. Client 只发 `{sessionId, messageId, notebook?, title?, docId?}`；
2. Host 用 `ctx.sessions.get(sessionId).deriveMessages()` 找到该条消息，取 `content` 里 `type='text'` 的块拼成 Markdown；
3. 没有 `docId` 就新建文档（默认笔记本或弹层选的），有 `docId` 就追加到该文档；
4. 标题缺省取正文首行（去 `#`/`**`，截 60 字）。

实测（本机，真实 sessionId + 真实 messageId）：查到消息 → 返回「这条消息没有可保存的文本内容」（该轮是纯工具调用，无正文）；伪造 messageId → `SIYUAN_NOT_FOUND`；伪造 sessionId → 会话级 `SIYUAN_NOT_FOUND`。三条分支都对，且正文来源不经过浏览器。

---

## 六、数据安全与幂等

| 风险 | 处理 |
| --- | --- |
| 误写/误删 | 默认只读；写工具运行时开关；无删除/移动能力；`/siyuan/save-message` 必须用户点确认 |
| 只读 SQL 被执行写 | 插件侧单条 SELECT 预检 + **内核 `mode:'readonly'`**（实测 3.8.9：带 mode 的 UPDATE/DELETE 报 `SQL statement is not a read-only query`；不带 mode 的 UPDATE 真执行——所以这个参数是必需项，不是装饰） |
| Token 泄露 | 存 `ctx.credentials`；路由永不回显；日志不打印；浏览器拿不到 |
| CSRF | 写路由要求 `x-dsh-siyuan: 1`（缺失 → HTTP 400），同源 fetch 才会带 |
| 跨站读取 | 路由只注册 exact path、`Cache-Control: no-store`；数据仅本机 Host 可读 |
| 3.8.9 路径歧义 | 建子文档走 `createDocByParent`（按父 id，不解析路径），规避同名父文档 `pathAmbiguous`；根文档标题里的 `/` 换成全角 `／`（path 语义无法表达字面斜杠） |
| 索引异步 | 新建/追加后 0.6s 内读可能 `NOT_FOUND`；Client 预览失败自动重试一次（600ms）；e2e 用轮询 |
| 同名文档 | `createDocWithMd` 同 path 会建出两篇同名文档（内核不报错）——当前不做自动去重，写前应确认标题；后续可用 `getIDsByHPath` 查重 |

---

## 七、与原方案 v1 的偏差一览

| v1 | 实现 | 原因 |
| --- | --- | --- |
| 配置用 `Config` schema / cordis.patch | 设置存 `storages/siyuan/config.json`，Token 进 credentials | 面板改设置即时生效、不用改 profile 配置重启；Config 仍需改 patch 才能持久化 |
| 8~10 个工具，`write:true` 才注册写工具 | 9 个工具，工具常驻、运行时判定 write | 见 §三 |
| `siyuan_read_doc` 读 Markdown/kramdown 分页 | Markdown 为主，`exportMdContent {yfm:false, addTitle:false}` 直接取纯正文；kramdown 未做 | 模型读 Markdown 更省 token；kramdown 的 IAL 噪音大，需要时再加 |
| 侧栏面板 + 回答动作 + 设置 | 同左，另加"测试连接"、设置抽屉、追加/新建 | 面板内闭环，不逼用户去设置页 |
| 未定 L3 取正文方式 | Host 从会话日志取 | 见 §五 |
| 未涉及 3.8.9 新接口 | `createDocByParent`、`removeDocByID`（测试用）、`getDailyNoteInfo` | 内核 3.8.9 的 path 解析变了；不用新接口会在重名/斜杠标题上失败 |
| 诊断路由 `/dsh-siyuan-api/status` 之类 | 无独立诊断路由，`/siyuan/status` 兼职 | 少一个暴露面 |

---

## 八、验证记录（本机实测）

- **装载**：`plugin_manager install_bundle` → `application: applied`，link 依赖 `@yogemow/dsh-siyuan`。
- **工具**：9 个全部出现在 Agent 工具表；`siyuan_status` 返回 3.8.9 + 9 个笔记本；`siyuan_search` / `siyuan_read_doc` / `siyuan_sql` / `siyuan_open` 实测通过；`siyuan_create_doc` 在 `write=false` 时返回 `SIYUAN_WRITE_DISABLED`。
- **路由**：`GET /siyuan/status` 形状正确（含顶层 `write`）；写路由缺头 → 400；`/siyuan/test` 探活通过；`/siyuan/doc` / `/siyuan/search` 正常。
- **Client**：`Slots.listSubTree` 四处均 active —— `sidebar.panellist#siyuan`、`main#siyuan`、`settings.section#siyuan`、`conversation.chat.assistant-actions#siyuan-save`。
- **端到端**：`node test/e2e.mjs` → **34 PASS / 0 FAIL / 0 WARN / 0 SKIP**（覆盖 status/notebooks/search/doc/recent/create/append/open/settings/test/save-message + CSRF + 写开关 + 每日日记 + 清理复查）。
- **数据基线**：测试前后「99-辅助工具」都是 3 篇文档 / 58 blocks，`write=false`；所有测试文档带 `dsh-e2e-` 前缀、按 id 删除、sleep 3s 复查。
- **未验证（需要人眼/人点）**：面板视觉与鼠标交互、`siyuan://` 是否真唤起桌面端、真实回答正文的「存入思源」落库（本机当前没有带正文的助手消息可测；正文取用逻辑已用三条分支实测）。

---

## 九、后续可做

1. 一次人工验收：刷新页面 → 侧栏图标 → 搜索/预览/新建/追加 → 设置页保存 → 回答旁存入一条真实回答。
2. `/doc` 的"加载更多"（现在默认 400 行，超了只提示截断）。
3. 可选能力：删除/移动（要独立确认设计）、按标签/日期检索、附件上传、块引用自动补全。
4. 发布形态：目前是 workspace 内 link 安装；要分发需补 `package.json` 的 `engines`/`dsh.compatibility`、`dsh plugin add` 的 tarball 流程。
5. Token 可选走环境变量（当前只支持面板写入凭据库）。

---

## 十、v2：文档树排序 + 右栏笔记视图（Agentero 风格）

用户要求：「文档结构根据文档树排序；思源笔记需要有会话视图，类似 agentero-dsh 那样」。
选型确认后落成两件事：左栏改成**文档树优先**，另加**右侧栏「思源笔记」标签**（聊天在中间、笔记在右边）。

### 10.1 文档树为什么不用 SQL 平铺

- `blocks` 表能按 `updated`/`sort` 排，但**不套用笔记本的排序设置**（自定义排序、名称/更新时间/创建时间排序都在文件树层）；
- 内核 `POST /api/filetree/listDocsByPath {notebook, path}` 返回该层的文件列表，**顺序就是文档树里的顺序**，还带 `subFileCount`、`icon`、`memo`、`mTime`；
- 所以 Host 递归调用它（depth 1..8，默认 4）拼出嵌套树，`GET /siyuan/tree` 原样返回；客户端只按数组顺序渲染，不做二次排序。
- 每个有子文档的节点一次内核调用；同 notebook+depth 结果缓存 30s，`refresh=1` 强制刷新，新建文档 / 写今日日记后清缓存。
- 实测顺序验收：`/siyuan/tree` 根层 name 序列与内核 `listDocsByPath` 的 `files[].name` **逐项相同**，且与 `blocks.updated` 倒序**不同**（e2e 断言）。

### 10.2 右栏笔记视图怎么接（DSH 0.2.x 的右栏 API）

参照本机已装的 `dsh-context` / `dsh-image-gen`，右栏是「tab 类型注册 + 正文 slot」两段式：

```js
ctx.inject(['sidebarRightTabs'], (owner) => {
  const tabs = owner.get('sidebarRightTabs')
  owner.effect(() => tabs.register({
    id: 'dsh-siyuan/note', kind: 'dsh-siyuan-note',
    title: () => '思源笔记',
    guide: [{ id: 'siyuan', order: 30, title: () => '思源笔记', description: () => '按文档树浏览笔记，边聊边读' }],
    keepMounted: true
  }))
  owner.slots.inject('sidebar.right.pane.tab', () => owner.slots.register(
    { name: 'sidebar.right.pane.tab', key: 'dsh-siyuan/note' }, NoteSidebarView))
})
// 打开：ctx.get('sidebarRight').openTab.call(sr, 'dsh-siyuan-note')
```

- 引导标签（`+` 里的卡片）由 `guide` 数组提供，`order:30` 排在 terminal 等之后；
- 打开动作在点文档时触发；`openTab` 会让右栏自动展开；
- 服务缺失（老版本 / 非 Web 宿主）时整块静默降级：`try/catch` 包住 `ctx.inject`、注册、打开三处，失败只走左栏内联预览；
- 左右两栏共享「当前笔记」用模块级 `noteState` + `Set` 订阅（同页同模块实例），不落 localStorage。

### 10.3 与 v1 的差异

| v1 | v2 |
| --- | --- |
| 左栏默认 `/recent` 平铺（按更新时间） | 左栏默认 `/siyuan/tree` 嵌套树（按思源文档树顺序），搜索时才平铺 |
| 主面板内联预览 | 点笔记优先开右栏；右栏不可用才退回内联预览 |
| 只有 4 个 slot | 加 `sidebarRightTabs` tab 类型 + `sidebar.right.pane.tab` 正文，仍保留原 4 个 |

### 10.4 验收

- `GET /siyuan/tree` 形状 / 顺序 / depth / refresh / 默认笔记本 / 错误分支 / 写后缓存失效，共 9 项新增断言；
- e2e 总计 **43 项全绿**（原 34 + 新 9），跑前后「99-辅助工具」仍是 3 篇 / 58 blocks，`write=false`；
- 客户端：node --check + jsdom/React18 冒烟 62 项（无右栏服务降级、有右栏注册与 openTab、树渲染/折叠、右栏正文/追加/新建、tab 注册抛错不外抛等）。
- 待人工：刷新页面后右栏标签的真实渲染与交互（浏览器侧无法被路由测试覆盖）。

### 10.5 已知限制

- 右栏的「当前笔记」是全局状态，不按会话隔离；左右两栏笔记本下拉各自独立。
- 左栏没有「全部笔记本」合并树（树按单个笔记本取）。
- 右栏尚未做「把选段引用进当前对话」；需要时可接 tab standardProps 里的 `inputActions`。

---

## 十一、v3：用户实际使用后的 5 条反馈

| 反馈 | 落点 |
| --- | --- |
| 文档树层级显示不够 | Host `/siyuan/tree` 支持 depth 1–8；新增 `/siyuan/tree/children` 单节点懒加载。客户端默认 depth=8，`hasMore` 节点点开时按需续层；重开恢复展开状态时也会自动补载未加载的深层节点。 |
| 文档内容会截断 | `/siyuan/doc` 缺省行数 400 → **1500**（上限 3000）；客户端在 `truncated` 时显示「加载更多（已显示 x/y 行）」，按 offset 续读并追加。 |
| 重新点开不保留上级位置 | 模块级 `treeMemory` 按「surface:notebook」记住展开集合/选中项/滚动位置；重开恢复并 `scrollIntoView`。顶栏「重置」= 清本 notebook 记忆 + 折叠 + 回顶（有默认文档则打开它）。 |
| 需要设置路径默认打开一个文档 | 设置新增 `defaultDoc`（文档 id 或精确 /完整/路径）；Host `resolveDocRef` 用 `blocks.hpath` 精确解析；左栏/右栏首次挂载且没有当前笔记时自动打开。 |
| 会话里不显示思源笔记标签 | 新增 `conversation.input.left` 的「思源」按钮作为会话内入口；打开右栏的逻辑改为先用 `ctx.inject(['sidebarRight'])` 捕获服务，再退 `ctx.get`，失败时提示并退到左侧栏面板。 |

实现细节与取舍：

- **深树性能**：`listDocChildren` 原来逐个 await 兄弟节点，depth=8 首次读取要 ~3s；改成同层 `Promise.all` 并发后首次 ~1.6s、命中 30s 缓存 ~0.5s（含笔记本列表查询）。再深的层级交给 `/tree/children` 懒加载。
- **路径解析**：`resolveDocRef` 只做精确 hpath 匹配（不做模糊），避免默认文档配错时打开到错的东西；报错里说明可传文档 id。
- **默认文档的边界**：只在左栏/右栏挂载时触发，不会「进会话就自动弹右栏」；若默认文档属于另一个笔记本，正文正确显示但树不会自动切笔记本（已知限制）。
- **滚动位置恢复**：实现为「离开时记录 scrollTop、重挂载后套用」，jsdom 冒烟只覆盖了展开/选中/补载，像素级滚动需要真机验证。

### 11.1 验证

- e2e 扩到 **53 项全绿**（新增 tree/children 顺序硬验收、hpath 读取、doc 缺省 1500 行与 offset 分页、defaultDoc 设置/清空）。
- 测试会把 `write` 恢复成「测试前记录的原值」而不是硬编码 false（用户当时开着写）。
- 客户端：node --check + jsdom/React18 冒烟 56 项（懒加载、失败重试、恢复展开+自动补载、重置、双端分页、defaultDoc 自动打开/失败回退、输入栏两种打开路径）。
- 页面侧已确认 `conversation.input.left#siyuan` 与 `sidebar.right.pane.tab#dsh-siyuan/note` 均 active。

---

## 十二、v4：入口显示开关（对话区页签 / 输入框按钮）

需求：不需要思源的会话不该被入口打扰，所以把「对话区页签」和「输入框按钮」做成设置项。

设计：

- **两个独立开关**（`settings.showViewTab` / `settings.showComposerButton`，默认 true）：
  - `showViewTab` 控制 `conversation.view` 里的「思源笔记」页签（order 15）；
  - `showComposerButton` 控制 `conversation.input.left` 的「思源」按钮；
  - 左栏「思源笔记」面板、右栏「思源笔记」标签、回答动作**不受这两个开关影响**（关掉只是不在对话区露入口，随时还能从侧栏用）。
- **页签是动态注册/注销**：`ctx.slots.inject('conversation.view', …)` 的返回值当 disposer，开关切换时调用/重建；这样关掉后页签是真的从「视图」行消失，而不是留一个渲染空白的死页签。
  - 代价：启动时先按默认 true 注册、拿到 `GET /settings` 再撤销，极短时间内可能闪一下；若改成「等设置回来再注册」，网络卡住时页签就不出现——选了前者。
- **输入框按钮常驻注册、组件按开关返回 null**：切换立刻生效、不需要刷新，代价是 slot 里留一个零尺寸条目（视觉上无痕迹）。
- **生效时机**：设置页保存成功后客户端拿新 settings → 更新 `uiFlags` → 同步页签注册，就地生效；只拨开关不保存不会变。若通过别的途径改了配置，刷新页面即可。
- 设置页新增「入口显示」卡片：两个 Toggle + 一句说明「只影响这两个入口；左栏面板与右栏标签不受影响，保存后立即生效」。

验证：settings 的四个字段读写往返正常；页面侧 `conversation.view#siyuan` active；客户端 jsdom 冒烟 28 项（默认 true、关闭后页签注销/按钮消失、再打开恢复、启动即 false 时撤销、GET 失败保默认、缺字段按 true）；e2e 53 项仍全绿。

已知限制：

- 关闭页签时客户端拿不到「当前是否正停在思源视图」的可靠信号，所以无条件提示「切回『对话』即可」——不会误伤，只是可能多一句。
- 若想让左栏/右栏也受开关控制，需要重新定义开关语义（当前有意不受控）。



