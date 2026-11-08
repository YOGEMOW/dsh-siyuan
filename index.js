/**
 * dsh-siyuan · Host 半
 *
 * 把思源笔记 (SiYuan) 接入 DeepSeek Harness：
 *  - L1：9 个 siyuan_* 工具（默认只读；写工具运行时受设置开关约束）
 *  - L2：给 Client 面板/设置页提供同源 HTTP 路由（/siyuan/*），Token 只在 Host
 *  - L3：回答旁「存入思源」由 Host 从会话日志取正文后落库
 *
 * 只走思源内核 HTTP API（默认 http://127.0.0.1:6806），不碰 .sy 文件、不直连 siyuan.db。
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const STORAGE_DIR = path.join(DSH_HOME, 'storages', 'siyuan')
const CONFIG_FILE = path.join(STORAGE_DIR, 'config.json')
const CREDENTIAL_KEY = 'siyuan'
const DEFAULT_ENDPOINT = 'http://127.0.0.1:6806'
const MAX_LIMIT = 100
const ROUTE_PREFIX = '/siyuan'

const DEFAULT_SETTINGS = {
  endpoint: DEFAULT_ENDPOINT,
  defaultNotebook: '',
  defaultDoc: '',
  write: false,
  readOnlySqlLimit: 100,
  showViewTab: true,
  showComposerButton: true
}

/* ------------------------------------------------------------------ */
/* 错误                                                                */
/* ------------------------------------------------------------------ */

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  error.userMessage = message
  return error
}

function asFailure(error) {
  const code = (error && error.code) || 'SIYUAN_UNKNOWN'
  const message =
    (error && (error.userMessage || error.message)) || '未知错误'
  return { ok: false, code, message: String(message) }
}

/** 工具执行统一入口：失败也是正常返回值，不打断整轮对话。 */
async function run(operation) {
  try {
    return await operation()
  } catch (error) {
    return asFailure(error)
  }
}

/* ------------------------------------------------------------------ */
/* 设置与凭据                                                          */
/* ------------------------------------------------------------------ */

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function loadSettings() {
  const saved = await readJsonFile(CONFIG_FILE, {})
  return { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) }
}

async function saveSettings(patch) {
  const current = await loadSettings()
  const next = { ...current, ...(patch || {}) }
  next.endpoint = normalizeEndpoint(next.endpoint)
  next.defaultNotebook = String(next.defaultNotebook || '').trim()
  next.defaultDoc = String(next.defaultDoc || '').trim()
  next.write = Boolean(next.write)
  next.showViewTab = next.showViewTab !== false
  next.showComposerButton = next.showComposerButton !== false
  await fs.mkdir(STORAGE_DIR, { recursive: true })
  await fs.writeFile(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8')
  return next
}

async function readToken(ctx) {
  try {
    const credentials = ctx.get('credentials')
    if (!credentials) return ''
    const record = await credentials.readRecord(CREDENTIAL_KEY)
    if (!record || record.kind !== 'api-key') return ''
    return typeof record.key === 'string' ? record.key : ''
  } catch {
    return ''
  }
}

async function writeToken(ctx, token) {
  const credentials = ctx.get('credentials')
  if (!credentials) {
    throw fail(
      'SIYUAN_AUTH_FAILED',
      '宿主没有凭据服务，无法保存 API Token（可以在启动 dsh 前设置环境变量 SIYUAN_TOKEN）'
    )
  }
  const value = String(token || '').trim()
  if (!value) {
    await credentials.deleteRecord(CREDENTIAL_KEY)
    return
  }
  await credentials.modifyRecord(CREDENTIAL_KEY, async () => ({
    kind: 'api-key',
    key: value
  }))
}

/* ------------------------------------------------------------------ */
/* 内核客户端                                                          */
/* ------------------------------------------------------------------ */

function normalizeEndpoint(input) {
  let value = String(input || '').trim()
  if (!value) return DEFAULT_ENDPOINT
  if (!/^https?:\/\//i.test(value)) value = 'http://' + value
  value = value.replace(/\/+$/, '')
  // 错误地填成 Web 界面地址时，提示改用内核地址
  if (/\/(stage|check|extract)\b/i.test(value)) {
    throw fail(
      'SIYUAN_INVALID_ARGUMENT',
      `这个地址看起来是思源 Web 界面地址，请改成内核地址，例如 ${DEFAULT_ENDPOINT}`
    )
  }
  return value
}

async function kernel(ep, token, apiPath, body, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetch(ep + apiPath, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Token ' + token } : {})
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal
    })
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw fail('SIYUAN_TIMEOUT', `思源在 ${timeoutMs}ms 内没有响应（${ep}）`)
    }
    const reason = (error && error.message) || String(error)
    throw fail(
      'SIYUAN_UNREACHABLE',
      `连不上思源内核 ${ep}：${reason}。请确认思源正在运行、内核地址正确。`
    )
  } finally {
    clearTimeout(timer)
  }

  const text = await response.text()
  if (response.status === 401 || response.status === 403) {
    throw fail(
      'SIYUAN_AUTH_FAILED',
      '思源拒绝了请求（401/403）：API Token 不对或没有配置。可在「设置 → 关于 → API token」复制。'
    )
  }
  if (!response.ok) {
    throw fail('SIYUAN_BAD_RESPONSE', `思源返回 HTTP ${response.status}：${text.slice(0, 160)}`)
  }
  let envelope
  try {
    envelope = JSON.parse(text)
  } catch {
    throw fail(
      'SIYUAN_BAD_RESPONSE',
      `思源返回了非 JSON 响应（HTTP ${response.status}）：${text.slice(0, 160)}`
    )
  }
  if (!envelope || envelope.code !== 0) {
    throw fail('SIYUAN_API_ERROR', `思源内核报错：${(envelope && envelope.msg) || '未知错误'}`)
  }
  return envelope.data
}

async function sqlQuery(ep, token, stmt, timeoutMs) {
  return kernel(ep, token, '/api/query/sql', { stmt }, timeoutMs)
}

function sqlString(value) {
  return String(value == null ? '' : value).replace(/'/g, "''")
}

function escapeLike(value) {
  return sqlString(value).replace(/[%_]/g, (ch) => '\\' + ch)
}

async function listNotebooks(ep, token) {
  const data = await kernel(ep, token, '/api/notebook/lsNotebooks', {})
  const notebooks = (data && data.notebooks) || []
  let counts = {}
  try {
    const rows = await sqlQuery(ep, token, 'select box as box, count(*) as n from blocks where type = \'d\' group by box')
    for (const row of rows || []) counts[row.box] = row.n
  } catch {
    counts = {}
  }
  return notebooks.map((notebook) => ({
    id: notebook.id,
    name: notebook.name,
    closed: Boolean(notebook.closed),
    docCount: counts[notebook.id] || 0
  }))
}

function resolveNotebook(notebooks, hint, settings) {
  const wanted = String(hint || settings.defaultNotebook || '').trim()
  if (!wanted) {
    throw fail(
      'SIYUAN_INVALID_ARGUMENT',
      '没有目标笔记本：请传 notebook 参数，或在「思源笔记」面板设置里指定默认笔记本。可选笔记本：' +
        notebooks.map((n) => n.name).join('、')
    )
  }
  const byId = notebooks.find((n) => n.id === wanted)
  if (byId) return byId
  const byExactName = notebooks.find((n) => n.name === wanted)
  if (byExactName) return byExactName
  const bySubstring = notebooks.filter((n) => n.name.includes(wanted))
  if (bySubstring.length === 1) return bySubstring[0]
  if (bySubstring.length > 1) {
    throw fail(
      'SIYUAN_INVALID_ARGUMENT',
      `笔记本「${wanted}」有多个候选：${bySubstring.map((n) => n.name).join('、')}。请写完整名称。`
    )
  }
  throw fail(
    'SIYUAN_NOT_FOUND',
    `找不到笔记本「${wanted}」。可选：` + notebooks.map((n) => n.name).join('、')
  )
}

function stripFrontmatter(markdown) {
  return String(markdown || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
}

function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function snippet(text, size = 160) {
  const plain = stripHtml(text)
  return plain.length > size ? plain.slice(0, size) + '…' : plain
}

async function docTitles(ep, token, ids) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return {}
  const list = unique.map((id) => `'${sqlString(id)}'`).join(',')
  const rows = await sqlQuery(
    ep,
    token,
    `select id, content from blocks where type = 'd' and id in (${list}) limit ${unique.length}`
  )
  const map = {}
  for (const row of rows || []) map[row.id] = row.content
  return map
}

async function searchBlocks(ep, token, options) {
  const query = String(options.query || '').trim()
  if (!query) throw fail('SIYUAN_INVALID_ARGUMENT', 'query 不能为空')
  const limit = clampLimit(options.limit, 20)
  const notebookId = options.notebook ? options.notebook.id : ''
  const like = `%${escapeLike(query)}%`
  const boxClause = notebookId ? ` and box = '${sqlString(notebookId)}'` : ''
  const rows = await sqlQuery(
    ep,
    token,
    `select id, root_id, box, path, hpath, content, name, alias, memo, type, subtype, updated
       from blocks
      where (content like '${like}' or name like '${like}' or alias like '${like}' or memo like '${like}')${boxClause}
      order by updated desc
      limit ${limit}`
  )
  const titles = await docTitles(ep, token, (rows || []).map((row) => row.root_id || row.id))
  const notebooks = await listNotebooks(ep, token)
  const nameOf = {}
  for (const notebook of notebooks) nameOf[notebook.id] = notebook.name
  return {
    ok: true,
    query,
    count: (rows || []).length,
    items: (rows || []).map((row) => ({
      id: row.id,
      rootId: row.root_id || row.id,
      box: row.box,
      notebook: nameOf[row.box] || '',
      hpath: row.hpath || '',
      title: titles[row.root_id] || row.hpath || row.id,
      snippet: snippet(row.content || row.name || row.alias || row.memo),
      type: row.type,
      subtype: row.subtype || '',
      updated: row.updated
    }))
  }
}

async function recentDocs(ep, token, options) {
  const limit = clampLimit(options.limit, 10)
  const notebookId = options.notebook ? options.notebook.id : ''
  const boxClause = notebookId ? ` and box = '${sqlString(notebookId)}'` : ''
  const rows = await sqlQuery(
    ep,
    token,
    `select id, box, path, hpath, content, updated
       from blocks
      where type = 'd'${boxClause}
      order by updated desc
      limit ${limit}`
  )
  const notebooks = await listNotebooks(ep, token)
  const nameOf = {}
  for (const notebook of notebooks) nameOf[notebook.id] = notebook.name
  return {
    ok: true,
    count: (rows || []).length,
    items: (rows || []).map((row) => ({
      id: row.id,
      rootId: row.id,
      box: row.box,
      notebook: nameOf[row.box] || '',
      hpath: row.hpath || '',
      title: row.content || row.hpath || row.id,
      snippet: '',
      type: 'd',
      updated: row.updated
    }))
  }
}

function clampLimit(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), MAX_LIMIT)
}

/* 文档树：按思源内核的文档树顺序（listDocsByPath 已套用笔记本排序设置），
 * 而不是按 updated 平铺。短时缓存，写入后清掉。 */
const treeCache = new Map()
const TREE_TTL_MS = 30 * 1000
const TREE_MAX_DEPTH = 8

function clearTreeCache() {
  treeCache.clear()
}

async function listDocChildren(ep, token, notebookId, sourcePath, parentHpath, depthLeft) {
  const data = await kernel(ep, token, '/api/filetree/listDocsByPath', {
    notebook: notebookId,
    path: sourcePath
  })
  const files = (data && data.files) || []
  // 同层并发取子节点：深树整体从「秒级」降到「几百毫秒」
  return Promise.all(
    files.map(async (file) => {
      const name = String(file.name || '')
      const node = {
        id: String(file.id || ''),
        name,
        hpath: (parentHpath === '/' ? '' : parentHpath) + '/' + name,
        icon: file.icon || '',
        memo: file.memo || '',
        subFileCount: Number(file.subFileCount) || 0,
        mtime: file.hMtime || '',
        children: [],
        hasMore: false
      }
      if (node.subFileCount > 0) {
        if (depthLeft > 1) {
          node.children = await listDocChildren(
            ep,
            token,
            notebookId,
            String(file.path || ''),
            node.hpath,
            depthLeft - 1
          )
        } else {
          node.hasMore = true
        }
      }
      return node
    })
  )
}

async function documentTree(ep, token, notebook, options) {
  const depth = Math.min(Math.max(1, Number(options.depth) || 4), TREE_MAX_DEPTH)
  const key = `${ep}|${notebook.id}|${depth}`
  const cached = treeCache.get(key)
  if (!options.refresh && cached && Date.now() - cached.at < TREE_TTL_MS) {
    return cached.value
  }
  const nodes = await listDocChildren(ep, token, notebook.id, '/', '/', depth)
  const value = {
    ok: true,
    notebook: { id: notebook.id, name: notebook.name },
    depth,
    order: 'document-tree',
    nodes,
    fetchedAt: new Date().toISOString()
  }
  treeCache.set(key, { at: Date.now(), value })
  return value
}

async function blockRow(ep, token, id) {
  const rows = await sqlQuery(
    ep,
    token,
    `select id, root_id, box, path, hpath, content, type from blocks where id = '${sqlString(id)}' limit 1`
  )
  return (rows && rows[0]) || null
}

/** 把「文档 id / 完整 hpath」统一解析成文档 id。 */
async function resolveDocRef(ep, token, ref) {
  const value = String(ref || '').trim()
  if (!value) throw fail('SIYUAN_INVALID_ARGUMENT', 'id 不能为空')
  if (/^\d{14}-[a-z0-9]{7}$/i.test(value)) return value
  const hpath = value.startsWith('/') ? value : '/' + value
  const rows = await sqlQuery(
    ep,
    token,
    `select id from blocks where type = 'd' and hpath = '${sqlString(hpath)}' limit 1`
  )
  if (rows && rows[0]) return String(rows[0].id)
  throw fail(
    'SIYUAN_NOT_FOUND',
    `找不到文档「${value}」：请传 22 位文档 id，或精确的 /完整/路径（可在面板文档树里看到路径）。`
  )
}

/** 懒加载某篇文档的直接子文档（文档树层级不够时逐层展开用）。 */
async function documentChildren(ep, token, notebook, parentId) {
  const row = await blockRow(ep, token, parentId)
  if (!row) throw fail('SIYUAN_NOT_FOUND', `找不到文档 ${parentId}`)
  const nodes = await listDocChildren(ep, token, notebook.id, row.path, row.hpath, 1)
  return {
    ok: true,
    parentId,
    order: 'document-tree',
    nodes
  }
}

async function readDocument(ep, token, options) {
  let id = String(options.id || '').trim()
  if (!/^\d{14}-[a-z0-9]{7}$/i.test(id)) {
    id = await resolveDocRef(ep, token, id)
  }
  if (!id) throw fail('SIYUAN_INVALID_ARGUMENT', 'id 不能为空')
  const row = await blockRow(ep, token, id)
  if (!row) throw fail('SIYUAN_NOT_FOUND', `找不到块或文档 ${id}`)
  const docId = row.root_id || row.id
  const docRow = row.type === 'd' ? row : await blockRow(ep, token, docId)
  // yfm=false / addTitle=false：让内核直接给纯正文（不带 YAML frontmatter 和 H1）
  const data = await kernel(ep, token, '/api/export/exportMdContent', {
    id: docId,
    yfm: false,
    addTitle: false
  })
  const markdown = stripFrontmatter((data && data.content) || '')
  const lines = markdown.split('\n')
  const offset = Math.max(0, Number(options.offset) || 0)
  const limit = Math.min(Math.max(1, Number(options.limit) || 400), 3000)
  const page = lines.slice(offset, offset + limit).join('\n')
  return {
    ok: true,
    id: docId,
    title: (docRow && docRow.content) || id,
    hpath: (docRow && docRow.hpath) || '',
    markdown: page,
    totalLines: lines.length,
    offset,
    truncated: offset + limit < lines.length,
    updated: ''
  }
}

async function createDocument(ep, token, settings, options) {
  const notebooks = await listNotebooks(ep, token)
  const notebook = resolveNotebook(notebooks, options.notebook, settings)
  const title = String(options.title || '').trim()
  if (!title) throw fail('SIYUAN_INVALID_ARGUMENT', 'title 不能为空')
  const markdown = String(options.markdown || '')
  let parentHpath = ''
  if (options.parentID) {
    const parent = await blockRow(ep, token, String(options.parentID).trim())
    if (!parent) throw fail('SIYUAN_NOT_FOUND', `找不到父文档 ${options.parentID}`)
    parentHpath = parent.hpath || ''
    if (parent.box !== notebook.id) {
      throw fail('SIYUAN_INVALID_ARGUMENT', '父文档不属于目标笔记本，请检查 notebook 参数')
    }
  }
  // 建子文档：3.8.9 的 createDocByParent 按父文档 id 建，天然免疫同名歧义与标题含 "/"
  if (options.parentID) {
    let id
    try {
      id = await kernel(ep, token, '/api/filetree/createDocByParent', {
        notebook: notebook.id,
        parentID: String(options.parentID).trim(),
        id: newBlockId(),
        title: { format: 'plain', text: title },
        markdown
      })
    } catch (error) {
      if (String(error && error.message).includes('metadata is not ready')) {
        await new Promise((resolve) => setTimeout(resolve, 400))
        id = await kernel(ep, token, '/api/filetree/createDocByParent', {
          notebook: notebook.id,
          parentID: String(options.parentID).trim(),
          id: newBlockId(),
          title: { format: 'plain', text: title },
          markdown
        })
      } else {
        throw error
      }
    }
    const createdId = String((id && (id.id || id.ID)) || id || '')
    if (!createdId) throw fail('SIYUAN_API_ERROR', '创建子文档失败：内核没有返回文档 id')
    const created = await blockRow(ep, token, createdId)
    return {
      ok: true,
      id: createdId,
      title,
      hpath: (created && created.hpath) || parentHpath + '/' + title,
      notebook: notebook.name,
      write: true
    }
  }

  // 根文档：path 的 "/" 是层级分隔符，标题里的 "/" 用全角规避（3.8.9 无法用 path 表达字面斜杠）
  const safeTitle = title.replace(/\//g, '／')
  const docPath = '/' + safeTitle
  const request = { notebook: notebook.id, path: docPath, markdown }
  let id
  try {
    id = await kernel(ep, token, '/api/filetree/createDocWithMd', request)
  } catch (error) {
    // 内核偶发「document metadata is not ready」，稍等重试一次
    if (String(error && error.message).includes('metadata is not ready')) {
      await new Promise((resolve) => setTimeout(resolve, 400))
      id = await kernel(ep, token, '/api/filetree/createDocWithMd', request)
    } else {
      throw error
    }
  }
  const created = await blockRow(ep, token, String(id))
  return {
    ok: true,
    id: String(id),
    title,
    hpath: (created && created.hpath) || docPath,
    notebook: notebook.name,
    write: true
  }
}

/** 生成合法思源块 id：14 位时间戳 + '-' + 7 位小写字母数字。 */
function newBlockId() {
  const now = new Date()
  const pad = (value, width) => String(value).padStart(width, '0')
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}` +
    `${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}`
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let suffix = ''
  for (let index = 0; index < 7; index += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return `${stamp}-${suffix}`
}

async function appendMarkdown(ep, token, settings, options) {
  const markdown = String(options.markdown || '')
  if (!markdown.trim()) throw fail('SIYUAN_INVALID_ARGUMENT', 'markdown 不能为空')
  const position = ['append', 'after', 'before'].includes(options.position)
    ? options.position
    : 'append'
  let targetId = String(options.id || '').trim()
  let daily = false
  if (!targetId || targetId === 'daily') {
    const notebooks = await listNotebooks(ep, token)
    const notebook = resolveNotebook(notebooks, options.notebook, settings)
    const created = await kernel(ep, token, '/api/filetree/createDailyNote', {
      notebook: notebook.id,
      app: ep
    })
    targetId = String((created && (created.id || created.ID)) || created || '')
    if (!targetId) throw fail('SIYUAN_API_ERROR', '创建今日日记失败：内核没有返回文档 id')
    daily = true
  }
  if (position === 'append') {
    await kernel(ep, token, '/api/block/appendBlock', {
      dataType: 'markdown',
      data: markdown,
      parentID: targetId
    })
  } else if (position === 'after') {
    await kernel(ep, token, '/api/block/insertBlock', {
      dataType: 'markdown',
      data: markdown,
      previousID: targetId
    })
  } else {
    await kernel(ep, token, '/api/block/insertBlock', {
      dataType: 'markdown',
      data: markdown,
      nextID: targetId
    })
  }
  return { ok: true, id: targetId, position, daily, write: true }
}

function openLinks(endpoint, id) {
  const clean = String(id || '').trim()
  if (!clean) throw fail('SIYUAN_INVALID_ARGUMENT', 'id 不能为空')
  return {
    ok: true,
    id: clean,
    appLink: `siyuan://blocks/${clean}`,
    webLink: `${endpoint}/stage/build/desktop/?id=${encodeURIComponent(clean)}`,
    blockLink: `((${clean} '思源块'))`
  }
}

/** 只读 SQL 预检：单条、SELECT/WITH/EXPLAIN、必有上限。 */
function guardReadonlySql(sql, maxRows) {
  const text = String(sql || '').trim()
  if (!text) throw fail('SIYUAN_INVALID_ARGUMENT', 'sql 不能为空')
  const stripped = text
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''")
  if (!/^(select|with|explain)\b/i.test(stripped)) {
    throw fail('SIYUAN_INVALID_ARGUMENT', '只允许单条 SELECT / WITH / EXPLAIN 查询')
  }
  if (/;/.test(stripped.replace(/;\s*$/, ''))) {
    throw fail('SIYUAN_INVALID_ARGUMENT', '只允许单条 SQL，不要用分号拼接多条语句')
  }
  const single = text.replace(/;\s*$/, '')
  if (!/\blimit\b/i.test(single)) return `${single} limit ${maxRows}`
  return single
}

async function runReadonlySql(ep, token, sql, maxRows) {
  const guarded = guardReadonlySql(sql, maxRows)
  const data = await kernel(ep, token, '/api/query/sql', { stmt: guarded, mode: 'readonly' })
  const rows = Array.isArray(data) ? data : []
  return {
    ok: true,
    sql: guarded,
    rows: rows.slice(0, maxRows),
    count: rows.length,
    truncated: rows.length > maxRows
  }
}

/* ------------------------------------------------------------------ */
/* 会话日志里取某条助手回答                                            */
/* ------------------------------------------------------------------ */

function messageText(ctx, sessionId, messageId) {
  const sessions = ctx.get('sessions')
  const session = sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : undefined
  if (!session) {
    throw fail(
      'SIYUAN_NOT_FOUND',
      '找不到这个会话（可能已关闭或只存在于磁盘）。请刷新页面后重试。'
    )
  }
  let messages = []
  try {
    messages = typeof session.deriveMessages === 'function' ? session.deriveMessages() : []
  } catch {
    messages = []
  }
  const message = (messages || []).find(
    (item) => String(item && (item.id || item.messageId)) === String(messageId)
  )
  if (!message) throw fail('SIYUAN_NOT_FOUND', '找不到这条回答，可能已被压缩或替换。')
  const blocks = Array.isArray(message.content) ? message.content : []
  const text = blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
  if (!text) throw fail('SIYUAN_INVALID_ARGUMENT', '这条消息没有可保存的文本内容。')
  return text
}

function titleFromMarkdown(markdown) {
  const lines = String(markdown || '').split('\n')
  for (const line of lines) {
    const text = line.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim()
    if (text) return text.slice(0, 60)
  }
  return '来自 DSH 的回答'
}

/* ------------------------------------------------------------------ */
/* Client HTTP 路由                                                    */
/* ------------------------------------------------------------------ */

async function readJsonBody(req, limitBytes = 2 * 1024 * 1024) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limitBytes) throw fail('SIYUAN_INVALID_ARGUMENT', '请求体过大')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw fail('SIYUAN_INVALID_ARGUMENT', '请求体不是合法 JSON')
  }
}

function makeHttpHandler(ctx) {
  return async function handler(req, res) {
    const send = (status, payload) => {
      try {
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        })
        res.end(JSON.stringify(payload))
      } catch {
        /* 连接已断开 */
      }
    }
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const pathname = url.pathname
      const method = req.method || 'GET'
      const settings = await loadSettings()
      const token = await readToken(ctx)
      const endpoint = normalizeEndpoint(settings.endpoint)

      const kernelNow = (apiPath, body) => kernel(endpoint, token, apiPath, body)

      // 写操作要求同源调用方带自定义头（简单 CSRF 防护）
      const mutating =
        method === 'POST' &&
        ['/create', '/append', '/save-message', '/settings', '/diag'].includes(
          pathname.slice(ROUTE_PREFIX.length)
        )
      if (mutating && req.headers['x-dsh-siyuan'] !== '1') {
        send(400, {
          ok: false,
          code: 'SIYUAN_INVALID_ARGUMENT',
          message: '缺少 x-dsh-siyuan 请求头：请从「思源笔记」面板或回答动作发起写入。'
        })
        return
      }

      if (pathname === `${ROUTE_PREFIX}/status` && method === 'GET') {
        const tokenConfigured = Boolean(token)
        try {
          const version = await kernelNow('/api/system/version', {})
          const notebooks = await listNotebooks(endpoint, token)
          send(200, {
            ok: true,
            endpoint,
            version: String(version || ''),
            notebooks,
            settings: { ...settings, endpoint },
            tokenConfigured,
            write: Boolean(settings.write)
          })
        } catch (error) {
          const failure = asFailure(error)
          send(200, {
            ...failure,
            endpoint,
            version: null,
            notebooks: [],
            settings: { ...settings, endpoint },
            tokenConfigured,
            write: Boolean(settings.write)
          })
        }
        return
      }

      if (pathname === `${ROUTE_PREFIX}/notebooks` && method === 'GET') {
        const notebooks = await listNotebooks(endpoint, token)
        send(200, { ok: true, notebooks })
        return
      }

      if (pathname === `${ROUTE_PREFIX}/search` && method === 'GET') {
        const query = url.searchParams.get('q') || ''
        const notebookHint = url.searchParams.get('notebook') || ''
        const limit = url.searchParams.get('limit') || ''
        const notebooks = await listNotebooks(endpoint, token)
        const notebook = notebookHint ? resolveNotebook(notebooks, notebookHint, settings) : null
        const result = await searchBlocks(endpoint, token, { query, notebook, limit })
        send(200, result)
        return
      }

      if (pathname === `${ROUTE_PREFIX}/recent` && method === 'GET') {
        const limit = url.searchParams.get('limit') || ''
        const notebookHint = url.searchParams.get('notebook') || ''
        const notebooks = await listNotebooks(endpoint, token)
        const notebook = notebookHint ? resolveNotebook(notebooks, notebookHint, settings) : null
        const result = await recentDocs(endpoint, token, { limit, notebook })
        send(200, result)
        return
      }

      if (pathname === `${ROUTE_PREFIX}/tree` && method === 'GET') {
        const notebookHint = url.searchParams.get('notebook') || ''
        const depth = url.searchParams.get('depth') || ''
        const refresh = url.searchParams.get('refresh') === '1'
        const notebooks = await listNotebooks(endpoint, token)
        const notebook = resolveNotebook(notebooks, notebookHint, settings)
        const result = await documentTree(endpoint, token, notebook, { depth, refresh })
        send(200, result)
        return
      }

      if (pathname === `${ROUTE_PREFIX}/tree/children` && method === 'GET') {
        const parentId = url.searchParams.get('id') || ''
        const notebookHint = url.searchParams.get('notebook') || ''
        const notebooks = await listNotebooks(endpoint, token)
        const notebook = resolveNotebook(notebooks, notebookHint, settings)
        const result = await documentChildren(endpoint, token, notebook, parentId)
        send(200, result)
        return
      }

      if (pathname === `${ROUTE_PREFIX}/doc` && method === 'GET') {
        const id = url.searchParams.get('id') || ''
        const offset = url.searchParams.get('offset') || ''
        const limit = url.searchParams.get('limit') || '1500'
        const result = await readDocument(endpoint, token, { id, offset, limit })
        send(200, result)
        return
      }

      if (pathname === `${ROUTE_PREFIX}/create` && method === 'POST') {
        if (!settings.write) {
          send(200, {
            ok: false,
            code: 'SIYUAN_WRITE_DISABLED',
            message: '写入未启用：请在「思源笔记 → 设置」里打开写入开关。'
          })
          return
        }
        const body = await readJsonBody(req)
        const result = await createDocument(endpoint, token, settings, body)
        clearTreeCache()
        send(200, result)
        return
      }

      if (pathname === `${ROUTE_PREFIX}/append` && method === 'POST') {
        if (!settings.write) {
          send(200, {
            ok: false,
            code: 'SIYUAN_WRITE_DISABLED',
            message: '写入未启用：请在「思源笔记 → 设置」里打开写入开关。'
          })
          return
        }
        const body = await readJsonBody(req)
        const result = await appendMarkdown(endpoint, token, settings, body)
        if (result.daily) clearTreeCache()
        send(200, result)
        return
      }

      if (pathname === `${ROUTE_PREFIX}/open` && method === 'POST') {
        const body = await readJsonBody(req)
        send(200, openLinks(endpoint, body.id))
        return
      }

      if (pathname === `${ROUTE_PREFIX}/save-message` && method === 'POST') {
        if (!settings.write) {
          send(200, {
            ok: false,
            code: 'SIYUAN_WRITE_DISABLED',
            message: '写入未启用：请在「思源笔记 → 设置」里打开写入开关。'
          })
          return
        }
        const body = await readJsonBody(req)
        const sessionId = String(body.sessionId || '').trim()
        const messageId = String(body.messageId || '').trim()
        if (!sessionId || !messageId) {
          throw fail('SIYUAN_INVALID_ARGUMENT', 'sessionId 和 messageId 都不能为空')
        }
        const text = messageText(ctx, sessionId, messageId)
        const title = String(body.title || '').trim() || titleFromMarkdown(text)
        if (body.docId) {
          const appended = await appendMarkdown(endpoint, token, settings, {
            id: String(body.docId),
            markdown: text,
            position: 'append',
            notebook: body.notebook
          })
          const target = await blockRow(endpoint, token, appended.id)
          send(200, {
            ok: true,
            id: appended.id,
            hpath: (target && target.hpath) || '',
            title: (target && target.content) || '',
            created: false,
            appended: true
          })
          return
        }
        const created = await createDocument(endpoint, token, settings, {
          notebook: body.notebook,
          title,
          markdown: text
        })
        clearTreeCache()
        send(200, { ...created, created: true, appended: false })
        return
      }

      if (pathname === `${ROUTE_PREFIX}/settings` && method === 'GET') {
        send(200, {
          ok: true,
          settings: { ...settings, endpoint },
          tokenConfigured: Boolean(token),
          write: Boolean(settings.write)
        })
        return
      }

      if (pathname === `${ROUTE_PREFIX}/settings` && method === 'POST') {
        const body = await readJsonBody(req)
        const patch = {}
        if (Object.prototype.hasOwnProperty.call(body, 'endpoint')) patch.endpoint = body.endpoint
        if (Object.prototype.hasOwnProperty.call(body, 'defaultNotebook')) {
          patch.defaultNotebook = body.defaultNotebook
        }
        if (Object.prototype.hasOwnProperty.call(body, 'defaultDoc')) {
          patch.defaultDoc = body.defaultDoc
        }
        if (Object.prototype.hasOwnProperty.call(body, 'showViewTab')) {
          patch.showViewTab = Boolean(body.showViewTab)
        }
        if (Object.prototype.hasOwnProperty.call(body, 'showComposerButton')) {
          patch.showComposerButton = Boolean(body.showComposerButton)
        }
        if (Object.prototype.hasOwnProperty.call(body, 'write')) patch.write = Boolean(body.write)
        if (Object.prototype.hasOwnProperty.call(body, 'token')) {
          await writeToken(ctx, body.token)
        }
        const next = await saveSettings(patch)
        send(200, {
          ok: true,
          settings: next,
          tokenConfigured: Boolean(await readToken(ctx)),
          write: Boolean(next.write)
        })
        return
      }

      if (pathname === `${ROUTE_PREFIX}/test` && method === 'POST') {
        const body = await readJsonBody(req)
        const testEndpoint = normalizeEndpoint(body.endpoint || settings.endpoint)
        const testToken = Object.prototype.hasOwnProperty.call(body, 'token')
          ? String(body.token || '')
          : token
        const version = await kernel(testEndpoint, testToken, '/api/system/version', {})
        const notebooks = await listNotebooks(testEndpoint, testToken)
        send(200, {
          ok: true,
          endpoint: testEndpoint,
          version: String(version || ''),
          notebooks: notebooks.length
        })
        return
      }

      // 客户端排障用：把「右栏打不开」之类的现场写到 storages/siyuan/diag.log
      if (pathname === `${ROUTE_PREFIX}/diag` && method === 'POST') {
        const body = await readJsonBody(req)
        const line = JSON.stringify({ at: new Date().toISOString(), ...body })
        try {
          await fs.mkdir(STORAGE_DIR, { recursive: true })
          await fs.appendFile(path.join(STORAGE_DIR, 'diag.log'), line + '\n', 'utf8')
        } catch {
          /* 排障日志失败不影响主流程 */
        }
        send(200, { ok: true })
        return
      }

      if (pathname === `${ROUTE_PREFIX}/diag` && method === 'GET') {
        let text = ''
        try {
          text = await fs.readFile(path.join(STORAGE_DIR, 'diag.log'), 'utf8')
        } catch {
          text = ''
        }
        const lines = text.trim() ? text.trim().split('\n').slice(-40) : []
        send(200, { ok: true, lines })
        return
      }

      send(404, { ok: false, code: 'SIYUAN_NOT_FOUND', message: `未知路由 ${method} ${pathname}` })
    } catch (error) {
      send(200, asFailure(error))
    }
  }
}

/* ------------------------------------------------------------------ */
/* Agent 工具                                                          */
/* ------------------------------------------------------------------ */

function textRender(value) {
  if (value && typeof value === 'object') {
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
  }
  return [{ type: 'text', text: String(value == null ? '' : value) }]
}

function makeTool(definition) {
  return {
    ...definition,
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textRender(value)
    }
  }
}

function buildTools(ctx) {
  const statusOf = async (settings) => {
    const token = await readToken(ctx)
    const endpoint = normalizeEndpoint(settings.endpoint)
    const version = await kernel(endpoint, token, '/api/system/version', {})
    const notebooks = await listNotebooks(endpoint, token)
    return {
      ok: true,
      endpoint,
      version: String(version || ''),
      tokenConfigured: Boolean(token),
      write: Boolean(settings.write),
      notebooks: notebooks.map((n) => ({
        id: n.id,
        name: n.name,
        docCount: n.docCount,
        closed: n.closed
      }))
    }
  }

  return [
    makeTool({
      name: 'siyuan_status',
      description:
        '思源笔记连通性自检：内核版本、API 地址、Token 是否配置、写入开关、笔记本清单。第一次操作思源或报错时先调它。',
      parameters: { type: 'object', properties: {}, required: [] },
      async execute() {
        return run(async () => statusOf(await loadSettings()))
      }
    }),

    makeTool({
      name: 'siyuan_notebooks',
      description: '列出思源笔记本（id、名称、文档数、是否关闭）。写入前用它确认目标笔记本名称。',
      parameters: { type: 'object', properties: {}, required: [] },
      async execute() {
        return run(async () => {
          const settings = await loadSettings()
          const token = await readToken(ctx)
          const endpoint = normalizeEndpoint(settings.endpoint)
          const notebooks = await listNotebooks(endpoint, token)
          return {
            ok: true,
            defaultNotebook: settings.defaultNotebook || '',
            notebooks
          }
        })
      }
    }),

    makeTool({
      name: 'siyuan_search',
      description:
        '在思源全库检索（正文/标题/别名/备注的子串匹配，中文友好），返回块 id、所属文档、路径、命中片段。定位文档或片段后用 siyuan_read_doc 读全文。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词（中文/英文，子串匹配）' },
          notebook: { type: 'string', description: '可选：限定笔记本（名称或 id）' },
          limit: { type: 'number', description: `可选：返回条数，默认 20，上限 ${MAX_LIMIT}` }
        },
        required: ['query']
      },
      async execute(args) {
        return run(async () => {
          const settings = await loadSettings()
          const token = await readToken(ctx)
          const endpoint = normalizeEndpoint(settings.endpoint)
          const notebooks = await listNotebooks(endpoint, token)
          const notebook = args.notebook ? resolveNotebook(notebooks, args.notebook, settings) : null
          return searchBlocks(endpoint, token, {
            query: args.query,
            notebook,
            limit: args.limit
          })
        })
      }
    }),

    makeTool({
      name: 'siyuan_read_doc',
      description:
        '按 id 读思源文档正文（Markdown）。id 可以是文档 id、任意块 id（自动找所属文档），或精确的 /完整/路径。长文档分页：offset 是行偏移，limit 是行数（默认 400）。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '文档 id / 块 id，或精确的 /完整/路径（例如 /领域知识库/AI/某篇）'
          },
          offset: { type: 'number', description: '可选：起始行，默认 0' },
          limit: { type: 'number', description: '可选：读取行数，默认 400，上限 3000' }
        },
        required: ['id']
      },
      async execute(args) {
        return run(async () => {
          const settings = await loadSettings()
          const token = await readToken(ctx)
          const endpoint = normalizeEndpoint(settings.endpoint)
          return readDocument(endpoint, token, args)
        })
      }
    }),

    makeTool({
      name: 'siyuan_recent',
      description: '列出最近更新的思源文档，用于了解用户最近在记什么。',
      parameters: {
        type: 'object',
        properties: {
          notebook: { type: 'string', description: '可选：限定笔记本（名称或 id）' },
          limit: { type: 'number', description: '可选：条数，默认 10' }
        },
        required: []
      },
      async execute(args) {
        return run(async () => {
          const settings = await loadSettings()
          const token = await readToken(ctx)
          const endpoint = normalizeEndpoint(settings.endpoint)
          const notebooks = await listNotebooks(endpoint, token)
          const notebook = args.notebook ? resolveNotebook(notebooks, args.notebook, settings) : null
          return recentDocs(endpoint, token, { limit: args.limit, notebook })
        })
      }
    }),

    makeTool({
      name: 'siyuan_sql',
      description:
        '对思源索引库执行只读 SQL（单条 SELECT/WITH/EXPLAIN，自动补 LIMIT）。适合统计、按类型/标签筛选、找未完成 TODO 等结构化查询；不确定表结构就先用 blocks 表。',
      parameters: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: '单条只读 SQL，例如 select id, content from blocks where type=\'d\' order by updated desc limit 10' },
          limit: { type: 'number', description: '可选：返回行数上限，默认 100' }
        },
        required: ['sql']
      },
      async execute(args) {
        return run(async () => {
          const settings = await loadSettings()
          const token = await readToken(ctx)
          const endpoint = normalizeEndpoint(settings.endpoint)
          const maxRows = Math.min(Math.max(1, Number(args.limit) || settings.readOnlySqlLimit || 100), 500)
          return runReadonlySql(endpoint, token, args.sql, maxRows)
        })
      }
    }),

    makeTool({
      name: 'siyuan_create_doc',
      description:
        '在思源新建一篇文档（Markdown 正文）。需要用户明确同意写入；写入开关未开启时会返回 SIYUAN_WRITE_DISABLED。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '文档标题（同时是文件名）' },
          markdown: { type: 'string', description: 'Markdown 正文，可为空' },
          notebook: { type: 'string', description: '可选：目标笔记本（名称或 id），缺省用默认笔记本' },
          parentID: { type: 'string', description: '可选：父文档 id，建子文档时用' }
        },
        required: ['title']
      },
      async execute(args) {
        return run(async () => {
          const settings = await loadSettings()
          if (!settings.write) {
            throw fail(
              'SIYUAN_WRITE_DISABLED',
              '写入未启用：请让用户在「思源笔记 → 设置」里打开写入开关，或明确说明要直接写。'
            )
          }
          const token = await readToken(ctx)
          const endpoint = normalizeEndpoint(settings.endpoint)
          return createDocument(endpoint, token, settings, args)
        })
      }
    }),

    makeTool({
      name: 'siyuan_append',
      description:
        '给思源文档/块追加 Markdown（append 追加为子块，after/before 插入同级块）。id 传 "daily" 表示追加到指定/默认笔记本的今日日记。写入开关未开启时会拒绝。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '目标文档或块 id；"daily" 表示今日日记' },
          markdown: { type: 'string', description: '要追加的 Markdown' },
          notebook: { type: 'string', description: '可选：daily 模式或标题定位时用的笔记本（名称或 id）' },
          position: {
            type: 'string',
            enum: ['append', 'after', 'before'],
            description: '可选：append（默认）/ after / before'
          }
        },
        required: ['id', 'markdown']
      },
      async execute(args) {
        return run(async () => {
          const settings = await loadSettings()
          if (!settings.write) {
            throw fail(
              'SIYUAN_WRITE_DISABLED',
              '写入未启用：请让用户在「思源笔记 → 设置」里打开写入开关。'
            )
          }
          const token = await readToken(ctx)
          const endpoint = normalizeEndpoint(settings.endpoint)
          return appendMarkdown(endpoint, token, settings, args)
        })
      }
    }),

    makeTool({
      name: 'siyuan_open',
      description:
        '生成打开思源文档/块的链接（siyuan:// 深链、Web 链接、块引用语法）。只读，不修改数据。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '文档或块 id' }
        },
        required: ['id']
      },
      async execute(args) {
        return run(async () => {
          const settings = await loadSettings()
          const endpoint = normalizeEndpoint(settings.endpoint)
          const links = openLinks(endpoint, args.id)
          // 有 Web 界面宿主时补一个可直接点的会话内链接
          try {
            const webApp = ctx.get('webApp')
            if (webApp && typeof webApp.getAdvertisedUrl === 'function') {
              links.hostUrl = String(webApp.getAdvertisedUrl() || '')
            }
          } catch {
            /* 可选 */
          }
          return links
        })
      }
    })
  ]
}

const SYSTEM_PROMPT_SECTION = `思源笔记 (SiYuan) 已在工具里接入（siyuan_*）。
- 搜索/读取是只读、随时可用；写入默认关闭，需用户在插件设置里打开。
- 引用笔记时带上文档标题与路径；写入前先确认目标（笔记本、父文档），不要凭空猜 id。
- 思源正文是 Markdown，块 id 形如 20260919135122-lw63vfz。`

/* ------------------------------------------------------------------ */
/* 插件入口                                                            */
/* ------------------------------------------------------------------ */

export function apply(ctx) {
  ctx.inject(['tools'], (toolsContext) => {
    try {
      const tools = buildTools(ctx)
      for (const tool of tools) {
        toolsContext.effect(() => toolsContext.tools.register(tool))
      }
    } catch (error) {
      console.error('[dsh-siyuan] 工具注册失败', error)
    }
  })

  ctx.inject(['systemPrompt'], (promptContext) => {
    try {
      promptContext.effect(() =>
        promptContext.systemPrompt.section({
          name: 'siyuan:usage',
          order: 900,
          text: SYSTEM_PROMPT_SECTION
        })
      )
    } catch (error) {
      console.error('[dsh-siyuan] 系统提示词注入失败', error)
    }
  })

  // 路由：webServer 只在 Web 宿主存在，用延迟注入避免 headless 卡在 PENDING
  ctx.inject(['webServer'], (webContext) => {
    const handler = makeHttpHandler(ctx)
    const routes = [
      `${ROUTE_PREFIX}/status`,
      `${ROUTE_PREFIX}/notebooks`,
      `${ROUTE_PREFIX}/search`,
      `${ROUTE_PREFIX}/recent`,
      `${ROUTE_PREFIX}/tree`,
      `${ROUTE_PREFIX}/tree/children`,
      `${ROUTE_PREFIX}/doc`,
      `${ROUTE_PREFIX}/create`,
      `${ROUTE_PREFIX}/append`,
      `${ROUTE_PREFIX}/open`,
      `${ROUTE_PREFIX}/save-message`,
      `${ROUTE_PREFIX}/settings`,
      `${ROUTE_PREFIX}/test`,
      `${ROUTE_PREFIX}/diag`
    ]
    for (const route of routes) {
      webContext.effect(() => webContext.webServer.register({ kind: 'exact', path: route, handler }))
    }
  })
}
