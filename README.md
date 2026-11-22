# dsh-siyuan

把 **思源笔记 (SiYuan)** 接入 **DeepSeek Harness**：Agent 能搜/读/写笔记，左侧栏能浏览检索，每条回答旁能一键存入思源。全部走思源内核 HTTP API，不碰 `.sy` 文件、不直连 `siyuan.db`。

- 包名：`@yogemow/dsh-siyuan`（scoped，GitHub 仓库同名；以 link 方式装进 `desktop` profile）
- 入口：`index.js`（Host 工具 + `/siyuan/*` 路由）、`client.js`（侧栏面板 / 设置页 / 回答动作）
- 设计说明：[docs/DESIGN.md](docs/DESIGN.md) · 内核 API 复核：[docs/KERNEL-NOTES.md](docs/KERNEL-NOTES.md) · Client 契约：[docs/CONTRACT.md](docs/CONTRACT.md)

## 能力

**Agent 工具（9 个，默认只读）**

| 工具 | 作用 | 读/写 |
| --- | --- | --- |
| `siyuan_status` | 连通性、版本、Token 状态、写入开关、笔记本清单 | 读 |
| `siyuan_notebooks` | 笔记本列表（id/名称/文档数） | 读 |
| `siyuan_search` | 全库检索（正文/标题/别名/备注子串） | 读 |
| `siyuan_read_doc` | 读文档 Markdown，行分页 | 读 |
| `siyuan_recent` | 最近更新的文档 | 读 |
| `siyuan_sql` | 只读 SQL（单条 SELECT，内核 `mode:'readonly'`） | 读 |
| `siyuan_create_doc` | 新建文档（可指定父文档） | 写 |
| `siyuan_append` | 追加/前后插入；`id="daily"` 写今日日记 | 写 |
| `siyuan_open` | 生成 `siyuan://` 深链 / Web 链接 / 块引用 | 读 |

**界面**

- **默认：完整嵌入思源 Web 界面**。左侧栏「思源笔记」、对话区「视图 → 思源笔记」页签、右侧栏「思源笔记」标签，三处都直接 iframe 打开 `http://127.0.0.1:6806/`（就是浏览器里登录思源看到的那个界面：文档树、编辑器、搜索、设置全都在）；顶栏有刷新 / 在浏览器打开 / 切换「简易视图」。
- **可切换：简易视图**。设置 → 思源笔记 →「显示方式」可以切回插件自带的轻量界面：文档树（按思源文档树顺序、懒加载）+ Markdown 预览 + 追加/新建，适合窄右栏或只读场景。
- 简易视图里：点笔记默认在右栏打开；正文默认一次读 1500 行，超过时「加载更多」续读；文档树记住展开/选中/滚动位置，顶栏「重置」回默认。
- **输入框工具行「思源」按钮**：随时打开右栏（完整界面或简易视图取决于「显示方式」）。
- 设置 →「思源笔记」：内核地址、API Token（只写不读）、默认笔记本、默认打开文档、显示方式、两个入口开关、写入开关、测试连接。
- 每条助手回答下方「存入思源」：选笔记本 / 标题（缺省取首行）/ 追加到已有文档，**确认后才写入**。

## 安装

前提：思源 3.8.x（桌面端运行中）、DSH 0.2.x。

### 1. 其它 profile（web / headless / 自建）

```
dsh plugin --profile web add github:YOGEMOW/dsh-siyuan
```

### 2. 桌面端（desktop profile）

桌面端 profile 由 Electron 独占，`dsh plugin --profile desktop` 会被 CLI 拒绝。先克隆到本地，再用 DSH 里的插件管理安装这个目录：

```
git clone https://github.com/YOGEMOW/dsh-siyuan "<本地目录>"
# 然后在 DSH 会话里：
plugin_manager install_bundle  target=<本地目录>
```

安装/卸载 bundle 后 Host 行需要重启对应 profile 才会重新装载；Client 半刷新页面后生效。

卸载：`plugin_manager remove_bundle  target=@yogemow/dsh-siyuan`。

### 依赖

运行时**不需要额外依赖**：`fetch` 用 Node 内置，React 由宿主提供；`@deepseek-ai/dsh-client-ui-conversation`、`-settings`、`-sidebar-right` 只在 `dsh.client.inject` 里做加载顺序声明。

## 配置

思源侧：

1. 思源桌面端保持运行（窗口最小化到托盘也算，内核是独立进程）。
2. 内核默认 `http://127.0.0.1:6806`；改过端口就用实际地址。
3. 本机 `127.0.0.1` 且没设「访问码/锁屏」时**免 Token**；否则在「设置 → 关于 → API token」复制，填进插件设置页。

插件侧（设置 → 思源笔记，或面板齿轮）：

| 项 | 默认 | 说明 |
| --- | --- | --- |
| 内核地址 | `http://127.0.0.1:6806` | 以 dsh 进程所在机器视角访问；填成 Web 界面地址会提示改内核地址 |
| API Token | 空 | 写入 DSH 凭据库（`CredentialKey=siyuan`），页面永不回显；留空保存 = 不修改 |
| 默认笔记本 | 空 | 写入、日记、回答动作不指定笔记本时用它 |
| 默认打开文档 | 空 | 22 位文档 id 或精确 /完整/路径；简易视图首次打开且没有当前笔记时自动打开（完整界面直接开思源 UI） |
| 显示方式 | **完整界面** | `完整界面` = iframe 嵌入思源 Web UI；`简易视图` = 插件自带的文档树 + Markdown 预览 |
| 显示对话区页签 | 开 | 关闭后「视图」行里不再出现「思源笔记」页签（左栏/右栏不受影响） |
| 显示输入框按钮 | 开 | 关闭后输入框工具行不再显示「思源」按钮（左栏/右栏不受影响） |
| 写入开关 | **关** | 关闭时所有写工具与写路由返回 `SIYUAN_WRITE_DISABLED` |

配置文件：`$DSH_HOME/storages/siyuan/config.json`（不含 Token）。

## 使用

- 直接对 Agent 说：「搜一下我记的 XX」「把这篇笔记读给我听」「把刚才的结论存到 00-收件箱」「今天日记里追加一条：…」。
- 默认在面板里直接用完整思源界面（文档树、编辑器、搜索都在）；想轻量时切「简易视图」再搜索 → 预览 → 在思源打开 / 追加 / 新建。
- 回答旁「存入思源」只在你点「确认存入」时落库。

## 安全模型

- 只走内核公开 HTTP API；不读写工作区文件、不做删除/移动/重命名（一期）。
- 写入默认关闭；即使打开，也只允许"新建/追加"，且回答动作需二次确认。
- `siyuan_sql` 只读双保险：插件侧单条 SELECT 预检 + 内核 `mode:'readonly'`（实测 3.8.9 不带 mode 的 UPDATE 会真执行）。
- Token 存 DSH 凭据库，只在 Host 进程内使用；`/siyuan/*` 路由不返回 Token。
- `/siyuan/*` 刻意避开 `/api`（宿主保留路径）；写路由要求自定义头 `x-dsh-siyuan: 1`。

## 开发

```
cd dsh-siyuan
node --check index.js
node --check client.js

# 黑盒端到端（需要插件已装载 + 思源在跑）
node test/e2e.mjs
# 可选环境变量：DSH_URL（默认 http://127.0.0.1:48765）
#               SIYUAN_KERNEL（默认 http://127.0.0.1:6806）
#               SIYUAN_TEST_NOTEBOOK（默认 99-辅助工具）
```

e2e 会在测试笔记本里建 `dsh-e2e-` 前缀的临时文档/日记，结束时按 id 删除、sleep 3s 复查，并还原 `write` 开关。

## 已知限制

- **完整界面是 iframe 嵌入**：思源 Web UI 有自己的主题、快捷键和弹窗，不受 DSH 主题影响；跨域无法读取 iframe 内部状态，因此刷新/切换时不会保留思源内的滚动与编辑位置（编辑内容本身会即时保存到思源）。
- 完整界面依赖思源自己的 Web 服务：思源必须运行，且地址（默认 127.0.0.1:6806）从 DSH 所在机器可访问；改端口后要同步改设置。
- `默认打开文档` 的自动打开只在简易视图生效；完整界面直接打开思源 UI（带当前笔记 id 时会拼 `?id=`）。
- 简易视图下：思源索引是异步的，新建后约 1 秒内读取可能 404（预览会自动重试一次）。
- 同名文档：`createDocWithMd` 在同一路径下会建出两篇同名文档，内核不报错；建文档前先确认标题。
- 根文档标题里的 `/` 会被替换成全角 `／`（内核 path 语义无法表达字面斜杠）；建**子文档**走 `createDocByParent`，标题可保留 `/`。
- `/doc` 默认 1500 行、上限 3000 行，更多用「加载更多」续读；工具 `siyuan_read_doc` 默认仍是 400 行（省上下文）。
- 简易视图的当前笔记是**全局状态**，不按会话隔离；左右两栏笔记本下拉各自独立。
- 未做：删除/移动/重命名、附件上传、块引用补全、Token 环境变量、npm 发布。
- `siyuan://` 深链在浏览器里是否唤起桌面端取决于系统协议注册；同时提供 Web 链接兜底。

## License

MIT。思源笔记本体是 AGPL-3.0，本项目只通过其公开 HTTP 接口交互。
