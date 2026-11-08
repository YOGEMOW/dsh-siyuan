# dsh-siyuan · Host ⇄ Client 契约（v1）

插件包名 `@local/dsh-siyuan`，Host 入口 `index.js`，Client 入口 `client.js`。
Client 只通过下面这组同源 HTTP 路由与 Host 通信；**Token 永不进浏览器**。

路由前缀 `/siyuan`，刻意避开 `/api`（`/api` 由宿主 connection 共享 handler 接管并要求认证）。
写操作请求必须带请求头 `x-dsh-siyuan: 1`（Host 侧轻量防跨站）。

所有响应都是 JSON。失败统一为 `{ ok: false, code, message }`，
`code ∈ SIYUAN_UNREACHABLE | SIYUAN_TIMEOUT | SIYUAN_AUTH_FAILED | SIYUAN_BAD_RESPONSE | SIYUAN_API_ERROR | SIYUAN_INVALID_ARGUMENT | SIYUAN_WRITE_DISABLED | SIYUAN_NOT_FOUND`。

## GET `/siyuan/status`

```json
{
  "ok": true,
  "endpoint": "http://127.0.0.1:6806",
  "version": "3.8.9",
  "notebooks": [{"id":"...","name":"00-收件箱","closed":false}],
  "settings": {"endpoint":"http://127.0.0.1:6806","defaultNotebook":"20250325103122-268nkpu","write":false},
  "tokenConfigured": false,
  "write": false
}
```

连接失败时 `ok:false`，并附 `version:null`、`notebooks:[]`、`settings`、`message`。

## GET `/siyuan/notebooks`

```json
{"ok":true,"notebooks":[{"id":"...","name":"...","closed":false,"docCount":123}]}
```

## GET `/siyuan/search?q=&notebook=&limit=`

- `q` 必填，关键词（子串、不区分大小写）
- `notebook` 可选：笔记本 id / 全名 / 唯一子串
- `limit` 可选，默认 20，上限 100

```json
{"ok":true,"items":[
  {"id":"块id","rootId":"文档id","box":"笔记本id","notebook":"名称",
   "hpath":"/领域知识库/AI","title":"文档标题","snippet":"命中片段",
   "type":"p","updated":"20261106101147"}
]}
```

## GET `/siyuan/recent?limit=`

同 search 的 `items` 形状（仅文档，按 `updated` 倒序）。

## GET `/siyuan/tree?notebook=&depth=&refresh=`

**按思源文档树顺序**返回嵌套文档树（内核 `listDocsByPath` 已套用笔记本的排序设置），
不是按 `updated` 平铺。`notebook` 缺省用默认笔记本；`depth` 默认 4、上限 8；
`refresh=1` 跳过 30 秒缓存。

```json
{"ok":true,"notebook":{"id":"...","name":"02-智·补天心"},"depth":4,"order":"document-tree",
 "fetchedAt":"2026-11-08T21:00:00.000Z",
 "nodes":[
   {"id":"...","name":"领域知识库","hpath":"/领域知识库","icon":"","memo":"",
    "subFileCount":7,"mtime":"2026-06-16 22:16:32, 4 个月前",
    "hasMore":false,
    "children":[{"id":"...","name":"AI","hpath":"/领域知识库/AI","subFileCount":7,"children":[],"hasMore":true}]}
 ]}
```

- 节点顺序就是思源文档树里的顺序（含自定义排序），客户端按数组顺序原样渲染。
- `hasMore:true` 表示这一层还有子文档但已达到 depth 限制。
- 新建文档 / daily 写入后 Host 会清缓存。

## GET `/siyuan/tree/children?id=&notebook=`

懒加载某一篇文档的**直接子文档**（树层级不够时逐层展开）。

```json
{"ok":true,"parentId":"<父文档 id>","order":"document-tree",
 "nodes":[{"id":"...","name":"AI","hpath":"/领域知识库/AI","subFileCount":7,"children":[],"hasMore":false}]}
```

## 设置项 `defaultDoc`

`GET/POST /siyuan/settings` 的 `settings.defaultDoc`：默认打开文档，接受 **22 位文档 id** 或 **精确 /完整/路径**（如 `/领域知识库/AI/DeepSeek Harness/DSH项目/思源接入DSH-方案计划`）。空字符串表示不自动打开。

## 设置项 `showViewTab` / `showComposerButton`

两个布尔开关（默认 `true`），只影响对话区入口：

- `showViewTab`：是否注册对话区顶部「视图」行里的「思源笔记」页签（`conversation.view`）。
- `showComposerButton`：是否显示输入框工具行的「思源」按钮（`conversation.input.left`）。

关闭后左栏「思源笔记」面板与右侧栏「思源笔记」标签不受影响。客户端保存设置后就地生效。

## GET `/siyuan/doc?id=`

`id` 可以是文档 id、块 id，或**精确的 /完整/路径**；缺省返回前 1500 行（`limit` 可调，上限 3000）。

```json
{"ok":true,"id":"文档id","title":"...","hpath":"/a/b",
 "markdown":"# 标题\n\n正文…","updated":"20261106101147","totalLines":4200,"offset":0,"truncated":true}
```

`truncated:true` 时用 `offset=<已读行数>` 继续取下一页。

## POST `/siyuan/create`

```json
{"notebook":"名称或id","title":"文档标题","markdown":"正文","parentID":"可选父文档id"}
```

成功：`{"ok":true,"id":"新文档id","title":"...","hpath":"/a/标题"}`

## POST `/siyuan/append`

```json
{"id":"文档或块id，或 'daily'","markdown":"要追加的 Markdown","position":"append|after|before"}
```

成功：`{"ok":true,"id":"目标id","daily":"daily 模式返回日记文档 id"}`

## POST `/siyuan/open`

```json
{"id":"块或文档id"}
```

成功：`{"ok":true,"appLink":"siyuan://blocks/xxx","webLink":"http://127.0.0.1:6806/stage/build/desktop/?id=xxx"}`

## POST `/siyuan/save-message`

把某条已完成的助手回答存进思源。Host 用 `sessionId + messageId` 从会话日志取正文，浏览器不传正文。

```json
{"sessionId":"...","messageId":"...","notebook":"可选","title":"可选，缺省取正文首行","docId":"可选，追加到已有文档"}
```

成功：`{"ok":true,"id":"...","hpath":"...","created":true}`

## GET `/siyuan/settings` / POST `/siyuan/settings`

GET 返回：`{"ok":true,"settings":{...},"tokenConfigured":false,"write":false}`

POST（只提交要改的字段）：

```json
{"endpoint":"http://127.0.0.1:6806","token":"可选，只写不读","defaultNotebook":"id或名称","write":false}
```

成功：`{"ok":true,"settings":{...},"tokenConfigured":true}`

## POST `/siyuan/test`

不落盘，直接用传入值探活：

```json
{"endpoint":"http://127.0.0.1:6806","token":"可选"}
```

成功：`{"ok":true,"version":"3.8.9","notebooks":9}`；失败：`{"ok":false,"code":"...","message":"..."}`

---

# Client 侧要求（client.js）

文件形态照抄宿主模板：`window.__ModuleLoader__.load({ id: '@local/dsh-siyuan', factory(require){ ... } })`，
模块 id 必须等于包名。React 从 `require('react')` 取，纯 `React.createElement`（`const h = React.createElement`），
**不要用 JSX、不要 import 任何宿主 Client 包**。

注册四处：

1. `sidebar.panellist`，`id: 'siyuan'`, `order: 20`, `label: () => '思源笔记'`
   - 组件只画图标，props：`{ size, active }`，用 `currentColor` 描边，图标要能被主题色驱动。
2. `main`，`key: 'siyuan'` → 面板组件（props 里有 `sessionId`，其它按需忽略）
3. `settings.section`，`id: 'siyuan'`, `order: 60`, `label: () => '思源笔记'` → 连接设置页（端点 / Token / 默认笔记本 / 写入开关 / 测试连接）
4. `conversation.chat.assistant-actions`，`id: 'siyuan-save'`, `order: 30`, `label: () => '存入思源'`
   - 组件 props：`{ messageId, sessionId }`；点击后弹小面板：选笔记本、标题（默认取回答首行）、可选追加到已有文档（先搜索再选），确认后 POST `/siyuan/save-message`，成功后就地显示「已存入 · 查看」并给 `siyuan://blocks/<id>` 链接。
   - 不得自动写入，必须用户点确认。

面板最少要有：

- 顶部：连接状态点 + 版本；「刷新」；齿轮打开设置抽屉（设置页与面板内共用同一组表单逻辑即可）
- 笔记本下拉（全部 / 某个）
- 搜索框（回车触发），结果列表（标题、hpath、片段、更新时间），点击进入文档预览
- 文档预览：标题、路径、Markdown 文本（按纯文本渲染即可，保留换行；不要把 HTML 直接塞进 dangerouslySetInnerHTML）
- 预览底部操作：「在思源打开」（POST /siyuan/open 后用 `location.href = appLink`，失败给 webLink）、「复制块链接」、「追加内容」（文本域 + 确认）
- 「新建文档」：标题 + 正文 + 目标笔记本，创建后刷新列表并提示
- 全部请求用相对路径 `fetch('/siyuan/...')`；写请求带 `x-dsh-siyuan: 1`
- 样式：只用 `var(--dsw-alias-*)` 主题 token（bg-base/layer-1/layer-2、border-l1/l2、label-primary/secondary/tertiary、brand-primary、state-*）；圆角 8–10、字号 12–14，和宿主列表页一致；不写全局 CSS、不 append 到 body。

错误处理：任何失败都显示成一行可读提示（带 code），不要抛异常、不要白屏。
