# 思源内核 API 复核笔记（SiYuan 3.8.9）

复核人：verifier　复核时间：2026-11-08 20:20–20:35（本机）
内核：`http://127.0.0.1:6806`（`/api/system/version` → `{"code":0,"msg":"","data":"3.8.9"}`）
工作空间：`G:\思源-工作空间\siyuan`；测试笔记本：`99-辅助工具`（`20250420231349-2wocnae`，基线 3 篇文档 / 58 blocks）
复核方式：全部真实 HTTP 调用；临时数据落 `99-辅助工具`，标题前缀 `dsh-e2e-`，结束用 `filetree/removeDocByID` 删除并等 3 秒复查 blocks 表（已确认回到 3 篇 / 58 blocks）。

> 说明：本机所有 `/api/*` 调用**未带 Token、未带 Origin 头**，均成功（与任务环境事实一致）。所有内核响应都是 `{code, msg, data}`，`code === 0` 为成功；失败时 `code === -1`，`msg` 是原文错误。
> 另：契约复核中发现 `/api/query/sql` **默认允许写 SQL**，Host 必须显式传 `mode:'readonly'`（见 §6）。

---

## 0. 3.8.9 的新能力（会影响 Host 实现）

`/api/notebook/getNotebookConf {notebook}` 返回：

```json
{"code":0,"msg":"","data":{
  "box":"20250420231349-2wocnae","name":"99-辅助工具",
  "conf":{"name":"99-辅助工具","sort":9,"icon":"1f30c","closed":false,
          "docCreateSaveBox":"","docCreateSavePath":"","docCreateTemplatePath":"",
          "dailyNoteSavePath":"/daily note/{{now | date \"2006/01\"}}/{{now | date \"2006-01-02\"}}",
          "dailyNoteTemplatePath":"","sortMode":15,"encrypted":false,"boxCrypt":null},
  "documentCapabilities":{"structuredPaths":true,"literalSlash":true,
                          "titleFormats":["plain"],"indexState":"ready",
                          "revision":"3:20250420231349-2wocnae:2"}}}
```

结论：3.8.9 的文档创建 API 从「路径字符串 = hpath」升级为**结构化路径 + 文档树解析**：
`structuredPaths:true`（按文档树解析 path）、`literalSlash:true`（标题里可以真的有 `/`）、`titleFormats:["plain"]`（标题是对象，不是字符串）。
这就是 §1 / §2 一系列新错误的根因，也是 `createDocByParent`、`resolveDocPath`、`getIDsByHPath` 等新接口的来源。

内核二进制里可确认 3.8.9 新增的路由（节选）：
`filetree/createDocByParent`、`filetree/resolveDocPath`、`filetree/planDocCreate`、`filetree/getIDsByHPath`、`filetree/getFullHPathByID`、`filetree/removeDocByID`、`filetree/getDailyNoteInfo`、`history/rollbackDocHistory`、`repo/*`、`block/getBlockKramdowns`。

---

## 1. `createDocWithMd` 的 path 语义

### 1.1 单层 path（成功，返回文档 id 字符串）

请求：

```json
POST /api/filetree/createDocWithMd
{"notebook":"20250420231349-2wocnae","path":"/dsh-e2e-plain","markdown":"# dsh-e2e-plain\n\nbody"}
```

响应：

```json
{"code":0,"msg":"","data":"20261108202335-2ik623u"}
```

`data` 是**文档 id 字符串**（不是对象）。随后 SQL 可查到：

```json
{"id":"20261108202335-2ik623u","content":"dsh-e2e-plain",
 "hpath":"/dsh-e2e-plain","path":"/20261108202335-2ik623u.sy","type":"d","box":"20250420231349-2wocnae"}
```

- `blocks.id` = 返回值；
- `blocks.path` = `/<id>.sy`（根文档）、`/<父文档id>/<id>.sy`（子文档）；
- `blocks.hpath` = 由标题拼出的展示路径（`/父标题/本文档标题`）。
- `path` 开头不写 `/` 也行：`path:"dsh-e2e-nolead"` 同样创建出 `hpath:"/dsh-e2e-nolead"`。
- `path:""` 会创建一个标题为 `.`、`hpath` 为 `/.` 的怪文档（**不要传空 path**）。

### 1.2 多层 path：父文档必须已存在且无同名歧义

- 父文档存在后，多层创建**可行**（实测：父文档创建后稍等再建子文档，均成功）：

```json
{"notebook":"...","path":"/dsh-e2e-p1/child-unique","markdown":"child body"}
→ {"code":0,"data":"20261108202750-vedo9ob"}   // hpath "/dsh-e2e-p1/child-unique"
```

- 父文档不存在时，多层 path **直接失败，且不会自动补建父文档**：

```json
{"notebook":"...","path":"/dsh-e2e-p2/x/y","markdown":"deep"}
→ {"code":-1,"msg":"document metadata is not ready","data":null}
```

复查 SQL：`/dsh-e2e-p2` 及 `/dsh-e2e-p2/x` **都没有被创建**。结论：Host 建子文档必须先确定父文档 id（`parentID`），不能指望内核自动补父链。

### 1.3 同一个 path 调两次 = 建出两篇同名文档（不报错、不覆盖）

```json
{"path":"/dsh-e2e-dup"} → {"code":0,"data":"20261108202841-v64boid"}
{"path":"/dsh-e2e-dup"} → {"code":0,"data":"20261108202841-svb2uz2"}
```

两篇文档 `hpath` 都是 `/dsh-e2e-dup`。**这是后续一切“歧义”的源头**，Host 若要防重复，应先用 `filetree/getIDsByHPath` 查重：

```json
POST /api/filetree/getIDsByHPath {"notebook":"...","path":"/dsh-e2e-p1"}
→ {"code":0,"msg":"","data":["20261108202749-9vcemxc"]}      // 无结果时 data:null
```

（注意参数名是 **`path`**，不是 `hpath`。）

### 1.4 同名歧义：`document path is ambiguous`（3.8.9 新增）

两个同名父文档存在后，再在它下面建子文档：

```json
{"notebook":"...","path":"/dsh-e2e-dup/child","markdown":"child"}
→ {"code":-1,"msg":"document path is ambiguous; use a document ID or resolveDocPath",
   "data":{"reason":"pathAmbiguous","cleanIDs":["20261108202841-svb2uz2","20261108202841-v64boid"]}}
```

- 把叶子标题改成 `child 2` **仍然失败**（歧义发生在**祖先层**，与叶子标题无关）：
  同样的 `pathAmbiguous` / 同一组 `cleanIDs`。
- 所以「捕获歧义后改用『标题 2/3』重试」这条路**不通**。正确做法二选一：
  1. 建子文档时改用 `createDocByParent`（按父文档 id，完全绕开路径解析，见 §2）；
  2. 或用 `getIDsByHPath` 定位/校验父文档，再决定是否建、建在谁下面。
- 另一变体：父文档标题里含 `/` 时，用 path 建子文档会报 `pathAmbiguous` + `unsupportedIDs`：

```json
{"path":"/dsh-e2e-p1/dsh-e2e-slash/a/b/kid"}
→ {"code":-1,"msg":"document path is ambiguous; use a document ID or resolveDocPath",
   "data":{"reason":"pathAmbiguous","unsupportedIDs":["20261108202922-dsh0002"]}}
```

### 1.5 标题里带 `/` 怎么办

`createDocWithMd` 的 `path` 永远是“层级”，标题里的 `/` 会被当成层级分隔，**无法**用它建出标题含 `/` 的文档。3.8.9 的正确做法是 `createDocByParent` + `title:{format:"plain", text:"a/b"}`（见 §2），实测可以建出：

```json
POST /api/filetree/createDocByParent
{"notebook":"20250420231349-2wocnae","parentID":"20261108202749-9vcemxc",
 "id":"20261108202922-dsh0002","title":{"format":"plain","text":"dsh-e2e-slash/a/b"},
 "markdown":"cbp body 2 slash"}
→ {"code":0,"data":{"id":"20261108202922-dsh0002","document":{...,
   "title":{"format":"plain","text":"dsh-e2e-slash/a/b","empty":false},
   "segments":[{"id":"...","text":"dsh-e2e-p1","empty":false},
               {"id":"20261108202922-dsh0002","text":"dsh-e2e-slash/a/b","empty":false}],
   "depth":2,"displayPath":"/dsh-e2e-p1/dsh-e2e-slash/a/b","revision":"1:e958..."}}}
```

SQL 复查：`hpath` 存的是字面量 `/dsh-e2e-p1/dsh-e2e-slash/a/b`（含 `/`）。
它的子文档也只能用 `createDocByParent` 建（path 方式同上例 `unsupportedIDs`）。
> 对 Host 的含义：契约里 `POST /siyuan/create {title, parentID}`，如果用户标题含 `/`，现有实现把 `/` 换成全角 `／` 规避歧义（可行但改标题）；若想保留字面 `/`，应改用 `createDocByParent`。

---

## 2. `createDocByParent`（3.8.9 新接口，建子文档/字面斜杠标题的正解）

请求（`id` 由调用方生成，必须是合法块 id：`14 位时间戳-7 位小写字母数字`）：

```json
{"notebook":"20250420231349-2wocnae","parentID":"20261108202749-9vcemxc",
 "id":"20261108202922-dsh0001","title":{"format":"plain","text":"dsh-e2e-cbp-title"},
 "markdown":"cbp body 1"}
```

响应：

```json
{"code":0,"msg":"","data":{"id":"20261108202922-dsh0001","document":{
  "notebook":"20250420231349-2wocnae","id":"20261108202922-dsh0001",
  "parentID":"20261108202749-9vcemxc","path":"/20261108202749-9vcemxc/20261108202922-dsh0001.sy",
  "title":{"format":"plain","text":"dsh-e2e-cbp-title","empty":false},
  "segments":[{"id":"20261108202749-9vcemxc","text":"dsh-e2e-p1","empty":false},
              {"id":"20261108202922-dsh0001","text":"dsh-e2e-cbp-title","empty":false}],
  "depth":2,"displayPath":"/dsh-e2e-p1/dsh-e2e-cbp-title","revision":"1:1ffc..."}}}
```

参数细节（按内核报错逐步确认）：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `notebook` | 是 | 目标笔记本 id |
| `parentID` | 是 | 父文档 id（文档 id，不是笔记本 id） |
| `id` | 是 | 新文档 id，必须合法块 id（形如 `20261108202922-dsh0002`，14 位时间戳 + `-` + 7 位小写字母数字）；长度/格式不对 → `{"code":-1,"msg":"invalid document ID or too many name conditions"}` |
| `title` | 是 | **对象**：`{"format":"plain","text":"..."}`；缺 format → `missing or null title field: format`；传字符串 → `cannot unmarshal string into Go struct field plain.title of type apicontract.DocumentCreateTitle` |
| `markdown` | 是 | 正文 Markdown（可空串） |

结论：建子文档优先用它——不解析路径，天然免疫同名歧义与标题含 `/`；`title.text` 里可以放任意 `/`。

---

## 3. `insertBlock` 的 after / before 与 `appendBlock` 的区别

实测（文档内有 para-A / para-B / para-C 三个段落，先取块 id）：

```json
POST /api/block/insertBlock {"dataType":"markdown","data":"AFTER-A","previousID":"<para-C id>"}
→ {"code":0,"data":[{"timestamp":0,"doOperations":[{"action":"insert","id":"20261108202757-grhm1tb",
   "parentID":"<doc id>","previousID":"<para-C id>","nextID":""},...]}]}
```

- `previousID` → 插到该块**后面**（同级）。响应 `doOperations[0].previousID` 回显锚点。
- `nextID` → 插到该块**前面**（同级）。
- `parentID`（只传它）→ 插成父块的**第一个子块**（prepend 语义）。
- 三个都不传 → `{"code":-1,"msg":"at least one of parentID, previousID or nextID is required"}`
- 传入的 `dataType` 目前用 `"markdown"`；响应是事务数组，`doOperations[0].id` 就是新块 id。

`appendBlock`：

```json
POST /api/block/appendBlock {"dataType":"markdown","data":"APPENDED-LAST","parentID":"<doc id>"}
→ code 0；doOperations[0].previousID = 原最后一个块 id（即追加到末尾）
```

对比结论：
- **`appendBlock`**：只有“追加为 `parentID` 的最后一个子块”一种语义（对应契约的 `position:"append"`）。
- **`insertBlock`**：由 `previousID`（after）/ `nextID`（before）/ `parentID`（作为第一个子块）决定位置（对应契约的 `after`/`before`）。
- 两者返回结构相同。契约里的 `position` 三值映射分别是 `appendBlock(parentID)`、`insertBlock(previousID)`、`insertBlock(nextID)`。

顺序核对（`getBlockKramdown` 按文档树顺序）：插入前 `para-A, para-B, para-C`；插入后
`CHILD-P, para-A, BEFORE-B, para-B, para-C, AFTER-A, APPENDED-LAST`，与上面语义一致。

---

## 4. `createDailyNote` 与 `getDailyNoteInfo`

```json
POST /api/filetree/createDailyNote {"notebook":"20250420231349-2wocnae"}
→ {"code":0,"msg":"","data":{"id":"20261108202722-ul20abn"}}
```

- 参数：`notebook` 必填（缺 → `Field [notebook] is required`）；`app` 可选（传 `"http://127.0.0.1:6806"` 也成功，结果相同，说明被忽略/仅作来源标记）。
- 返回：`data` 是**对象** `{ "id": "文档id" }`（不是裸字符串）。
- **同一天调用两次幂等**：第二次返回**同一个 id**。

```json
第 1 次 → {"code":0,"data":{"id":"20261108202722-ul20abn"}}
第 2 次 → {"code":0,"data":{"id":"20261108202722-ul20abn"}}
```

- 副作用：会按笔记本 conf 的 `dailyNoteSavePath`（这里是 `/daily note/{{now | date "2006/01"}}/{{now | date "2006-01-02"}}`）**连带创建父文档**。实测新增 4 篇文档：

```json
/daily note                      (id 20261108202722-6cy9ybs)
/daily note/2026                 (id 20261108202722-fu9hpvj)
/daily note/2026/11              (id 20261108202722-lhwziyq)
/daily note/2026/11/2026-11-08   (id 20261108202722-ul20abn)  ← 日记正文
```

  → 测试/清理时：**先删叶子再删父文档**（`removeDocByID`，最深优先），等 3 秒复查。同一篇日记再调 `createDailyNote` 不会重复建。

`getDailyNoteInfo`：

```json
POST /api/filetree/getDailyNoteInfo {"notebook":"20250420231349-2wocnae"}
→ {"code":0,"msg":"","data":{"id":"20261108202722-ul20abn",
   "hPath":"/daily note/2026/11/2026-11-08","title":"2026-11-08","existed":true}}
```

`existed`：当日日记已存在时为 `true`（刚建完再查是 true；未建时按理为 false，本次未构造“未建”环境，未实测）。

---

## 5. `getBlockKramdown` 与 `exportMdContent` 的 frontmatter

### 5.1 getBlockKramdown

```json
POST /api/block/getBlockKramdown {"id":"20261108202749-9vcemxc"}   // 文档 id
→ {"code":0,"msg":"","data":{"id":"20261108202749-9vcemxc",
   "kramdown":"CHILD-P\n{: id=\"20261108202759-hbmzerv\" updated=\"20261108202759\"}\n\npara-A\n{: id=\"...\" updated=\"...\"}\n...\n{: id=\"20261108202749-9vcemxc\" updated=\"20261108202801\" type=\"doc\" title=\"dsh-e2e-p1\"}"}}
```

- 字段只有 `id`、`kramdown`；`kramdown` 里每个块带 IAL（`{: id="..." updated="..." }`），文档级 IAL 在最后。
- 传段块 id 时返回该块自己的 kramdown（含 IAL），不展开整篇文档。
- 批量版 `block/getBlockKramdowns` 参数 `{ids:[...]}`。

### 5.2 exportMdContent

```json
POST /api/export/exportMdContent {"id":"20261108202749-9vcemxc"}
→ {"code":0,"msg":"","data":{"hPath":"/dsh-e2e-p1",
   "content":"---\ntitle: dsh-e2e-p1\ndate: 2026-11-08T20:27:49+08:00\nlastmod: 2026-11-08T20:28:01+08:00\n---\n\n# dsh-e2e-p1\n\nCHILD-P\n\n..."}}
```

- 只返回 `hPath`、`content` 两个字段。
- **默认 content = YAML frontmatter + `# 标题` + 正文**（frontmatter 是导出接口自带的，与 `conf.export.markdownYFM` 无关；H1 由 `conf.export.addTitle` 控制）。
- 更稳的做法：直接传 `{id, yfm:false, addTitle:false}`，内核返回**纯正文**（实测）：

```json
{"id":"...","yfm":false,"addTitle":false}
→ {"code":0,"data":{"hPath":"/dsh-e2e-p1","content":"CHILD-P\n\npara-A\n\nBEFORE-B\n..."}}
```

- 如果坚持剥离 frontmatter，正则可用（实测能整段吃掉默认头）：

```js
markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
```

  注意：这个正则只该在**开头**匹配，且 `[\s\S]*?` 非贪婪保证不会吃正文；正文里自己写的 `---` 分隔线在开头之外的不会被误删。

---

## 6. 深链、Web 链接与「内核能否给出 URL」

### 6.1 深链格式

- 通用且唯一稳定的协议链接是 **`siyuan://blocks/<块 id>`**（文档 id 也是块 id，可直接开文档）。
- 渲染进程 / Electron 代码里检索 `siyuan://`，除 `blocks` 外没有其它可用 scheme；另有一个 AV（属性视图）行链接变体：
  `siyuan://blocks/<块id>?avViewID=<视图>&avItemID=<行>&avStandalone=1`。
- 结论：`/siyuan/open` 的 `appLink` 用 `siyuan://blocks/${id}` 正确，无需换格式。

### 6.2 内核不会给 Web 链接

- `/api/system/getConf` 里没有 `url` 字段（只有 `api.token`、`system.*`、`serverAddrs` 等，`serverAddrs` 是 LAN 服务地址，不是文档链接）；`/api/filetree/getDoc` 等接口也没有 url 字段。
- 因此 Web 链接必须由 Host 用「当前端点的 origin + 文档 id」自己拼。实测（GET，无 token）：

| URL | 结果 |
| --- | --- |
| `http://127.0.0.1:6806/stage/build/desktop/?id=<docId>` | **200**，`content-type: text/html; charset=utf-8` |
| `http://127.0.0.1:6806/?id=<docId>` | **302** → `Location: /stage/build/desktop/?id=<docId>&r=...`（跟随跳转后 200） |
| `http://127.0.0.1:6806/stage/build/mobile/?id=<docId>` | 200（移动端 UI） |
| `http://127.0.0.1:6806/stage/build/app/?id=<docId>` | 200（桌面壳 UI） |
| `http://127.0.0.1:6806/stage/build/desktop/index.html?id=<docId>` | 301 → `./?id=<docId>` |

- 思源自己的「复制网页链接」（`copyWebURL`）用的形式是 **`${location.origin}?id=<id>`**（桌面端即 `http://127.0.0.1:6806/?id=<docId>`，302 到 desktop 界面）。
- 建议 Host：`webLink = ${endpoint}/stage/build/desktop/?id=${id}`（直接 200），或 `${endpoint}/?id=${id}`（302→200，和思源原生行为一致）。两种都在浏览器可打开，且只要思源内核在跑即可。

---

## 7. 只读 SQL（`/api/query/sql` 的 `mode:'readonly'`）

- 3.8.9 **接受**参数 `mode`。`SELECT` 带不带 `mode` 都正常：

```json
{"stmt":"SELECT 1 AS one"}               → {"code":0,"data":[{"one":1}],"limit":64,"truncated":false}
{"stmt":"SELECT 1 AS one","mode":"readonly"} → {"code":0,"data":[{"one":1}],"limit":64,"truncated":false}
```

- **带 `mode:'readonly'` 时 UPDATE / DELETE 会被拦下**：

```json
{"stmt":"UPDATE blocks SET content='RO-UPDATED' WHERE id='<para id>'","mode":"readonly"}
→ {"code":-1,"msg":"SQL statement is not a read-only query","data":null}
{"stmt":"DELETE FROM blocks WHERE id='<para id>'","mode":"readonly"}
→ {"code":-1,"msg":"SQL statement is not a read-only query","data":null}
```

  复查 blocks 表：目标段落内容未变、行未消失 → 确实拦住了（不是执行后 0 行）。
- **不带 `mode` 时 SQL 可写**（危险！）：

```json
{"stmt":"UPDATE blocks SET content='PLAIN-UPDATED' WHERE id='<para id>'"}
→ {"code":0,"data":[]}     // 复查该段落：content 已变成 PLAIN-UPDATED
```

- 结论：`/api/query/sql` 默认具备写能力，Host 的只读 SQL 通道**必须显式传 `mode:'readonly'`**（`index.js` 的 `runReadonlySql` 已经这么做了，保留）；前端永远不要直接透传用户 SQL。
- 响应形状：`{code,msg,data:[{...}],limit:64,truncated:false}`（`limit` 是内核默认分页 64，`truncated` 表示是否被截断）。

---

## 8. `removeDoc` / `removeDocByID` 与清理纪律

- 契约里 `removeDoc` 的 `{notebook, path}` 中 **`path` 是 .sy 文件路径，不是 hpath**：

```json
{"notebook":"20250420231349-2wocnae","path":"/dsh-e2e-plain"}      → {"code":-1,"msg":"block not found"}
{"notebook":"20250420231349-2wocnae","path":"/20261108202335-2ik623u.sy"} → {"code":0,"msg":"","data":null}
```

- 3.8.9 新增 **`filetree/removeDocByID {id}`**，直接按文档 id 删除（更好用，且不依赖已可能被链改的 path）：

```json
{"id":"20261108202750-vedo9ob"} → {"code":0,"msg":"","data":null}
```

- 删除是**异步落库**：`code:0` 后 blocks 里的行还要等，实测 **2–3 秒**后复查才消失。清理脚本务必：删除 → `sleep(3000)` → `select ... where id='...'` 复查为空。
- 删父文档前先删子文档（或确认 `removeDocByID` 对带子文档的父文档的行为；本次按“最深优先”执行，安全）。
- 删除会写入数据历史：`G:\思源-工作空间\siyuan\history\<时间>-delete\...`。若误删文档，可用
  `history/rollbackDocHistory {historyPath:"/history/<快照目录>/<notebookId>/<docId>.sy"}` **完整恢复**（实测成功，连带子文档分别恢复）。这条在生产环境是救命绳，Host 的写入工具不要碰。

---

## 9. 补充：`/api/search/fullTextSearchBlock`（`/siyuan/search` 若改用内核搜索时的形状）

```json
POST /api/search/fullTextSearchBlock {"query":"dsh-e2e","method":0,"page":1,"pageSize":5,"box":"20250420231349-2wocnae"}
→ {"code":0,"data":{
   "blocks":[{"box":"20250420231349-2wocnae","path":"/.../xxx.sy","hPath":"/dsh-e2e-p1/",
              "id":"...","rootID":"...","parentID":"","content":"<mark>dsh-e2e</mark>-cbp-title",
              "fcontent":"dsh-e2e-cbp-title","ial":{"id":"...","title":"dsh-e2e-cbp-title","type":"doc","updated":"..."},
              "type":"NodeDocument","created":"...","updated":"..."}, ...],
   "matchedBlockCount":7,"matchedRootCount":7,"pageCount":2,"docMode":false}}
```

- `content` 是带 `<mark>` 高亮的 HTML，`fcontent` 是纯文本；`hPath` 是**父路径**（带结尾 `/`，不是文档完整 hpath）。
- `method:1` 对同一 query 返回空（`blocks:[]`）；`method:0` 才是关键字匹配。
- `box` 参数可限定笔记本。
- 另：`filetree/getFullHPathByID {id}` → `"99-辅助工具/dsh-e2e-p1/dsh-e2e-cbp-title"`（含笔记本名前缀）。

> 现有 Host 的 `/siyuan/search` 用 SQL `LIKE` 实现（不依赖此接口），形状与契约一致；此节仅作备选方案记录。

---

## 10. 对 Host 实现（index.js）的落地建议

1. **建子文档**：用 `createDocByParent {notebook, parentID, id, title:{format:"plain",text}, markdown}`，不要在父文档 hpath 上拼 path 再 `createDocWithMd`——3.8.9 会让「父文档重名」或「父标题含 `/`」直接失败（`pathAmbiguous`）。
2. **标题含 `/`**：`createDocWithMd` 无法表达；用 `createDocByParent` 的 `title.text` 原样保留，或维持现有「`/`→`／`」规避。
3. **防重复**：`createDocWithMd` 同名 path 会真建两篇；要幂等就先 `getIDsByHPath {notebook, path}` 查一下。
4. **「标题 2/3」重试无效**：`pathAmbiguous` 是祖先层歧义，改叶子标题不会解决。
5. **append 三态**：`append` → `appendBlock {parentID}`；`after` → `insertBlock {previousID}`；`before` → `insertBlock {nextID}`（已与实现一致）。
6. **daily**：`createDailyNote {notebook, app}` 返回 `{id}`（对象/字符串取 `data.id` 即可，现有实现兼容）；同天幂等；会连带建 3 层父文档，测试清理要删 4 篇。
7. **读文档**：`exportMdContent {id, yfm:false, addTitle:false}` 最干净；若保留默认，frontmatter 正则可继续用（现有 `stripFrontmatter` 正确）。
8. **只读 SQL**：必须带 `mode:'readonly'`；`SELECT`/`WITH`/`EXPLAIN` 预检可保留（内核拦 UPDATE/DELETE 的兜底）。
9. **Web 链接**：`${endpoint}/stage/build/desktop/?id=${id}`（200）或 `${endpoint}/?id=${id}`（302→200），两者实测可开；内核不提供 url。
10. **测试清理**：只按 `removeDocByID` + `hpath` 前缀 `dsh-e2e-` 精确删除；删完 `sleep(3000)` 用 SQL 复查；日记会连带父文档。**绝不要按笔记本批量删文档**（血的教训：误删 3 篇用户文档后用 `history/rollbackDocHistory` 恢复）。
11. **blocks 索引是异步的**（真路由测试实测）：`createDocWithMd` / `appendBlock` 返回 `code:0` 后，紧随其后的 `/api/query/sql`（以及基于它的 blockRow 查询）可能**短暂查不到**刚写入的文档/块（实测 ~0.6s 内偶发 `找不到块或文档`，通常 1–2s 内自愈）。对刚写入对象的读取要容错：延迟 300–500ms 再读、或失败自动重试一次；e2e 已用轮询（8s 上限）处理。
