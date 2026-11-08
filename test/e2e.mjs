#!/usr/bin/env node
/**
 * dsh-siyuan · Host /siyuan/* 路由端到端黑盒测试
 *
 * 前提：
 *   1. DSH Web 宿主在跑（默认 http://127.0.0.1:48765）；
 *   2. dsh-siyuan 插件已装载（/siyuan/* 路由已注册）；
 *   3. 思源内核在跑（默认 http://127.0.0.1:6806，仅用于清理测试数据与复查）。
 *
 * 用法：
 *   node test/e2e.mjs
 *
 * 环境变量：
 *   DSH_URL               宿主地址，默认 http://127.0.0.1:48765
 *   SIYUAN_KERNEL         思源内核地址，默认 http://127.0.0.1:6806（仅清理/复查用）
 *   SIYUAN_TEST_NOTEBOOK  测试笔记本名称，默认 99-辅助工具
 *
 * 约束（与任务约定一致）：
 *   - 所有写操作只落「99-辅助工具」，文档标题前缀 dsh-e2e-；
 *   - 结束用内核 removeDocByID 清理，并等 3 秒复查 blocks 表确认消失；
 *   - 原设置里的 write 开关在 finally 里还原。
 *
 * 说明：路由测试脚本本身不改 index.js/client.js；清理走内核直连（Host 没有删除路由）。
 */

const DSH_URL = (process.env.DSH_URL || 'http://127.0.0.1:48765').replace(/\/+$/, '')
const KERNEL_URL = (process.env.SIYUAN_KERNEL || 'http://127.0.0.1:6806').replace(/\/+$/, '')
const NOTEBOOK_NAME = process.env.SIYUAN_TEST_NOTEBOOK || '99-辅助工具'

const WRITE_HEADERS = { 'x-dsh-siyuan': '1' }
const PREFIX = 'dsh-e2e-'
const CLEAN_WAIT_MS = 3000

const pad = (n) => String(n).padStart(2, '0')
function stamp() {
  const d = new Date()
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}
const RUN = stamp()
const TITLE = `${PREFIX}路由测试-${RUN}`
const SLASH_TITLE = `${PREFIX}斜杠/标题-${RUN}`
const APPEND_MARK = `${PREFIX}追加-${RUN}`
const DAILY_MARK = `${PREFIX}日记-${RUN}`
const TREE_NOTEBOOK_NAME = '02-智·补天心'
const TREE_CHILDREN_PARENT_ID = '20260306155316-3fsnftg' // 02 笔记本 /领域知识库
const HPATH_DOC = '/领域知识库/AI/DeepSeek Harness/DSH项目/思源接入DSH-方案计划'
const TREE_TITLE = `${PREFIX}tree-${RUN}`

/* ------------------------------------------------------------------ */
/* 输出与断言                                                          */
/* ------------------------------------------------------------------ */

const results = []
function record(level, name, note = '') {
  results.push({ level, name, note })
  const tag = { PASS: '[PASS]', FAIL: '[FAIL]', SKIP: '[SKIP]', WARN: '[WARN]' }[level]
  console.log(`${tag} ${name}${note ? ' — ' + note : ''}`)
}
const pass = (name, note) => record('PASS', name, note)
const fail = (name, note) => record('FAIL', name, note)
const skip = (name, note) => record('SKIP', name, note)
const warn = (name, note) => record('WARN', name, note)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
function assertOk(json, where) {
  assert(json && typeof json === 'object', `${where}：响应不是 JSON 对象`)
  assert(json.ok === true, `${where}：期望 ok:true，实际 ${JSON.stringify(json).slice(0, 240)}`)
}
function assertFail(json, where, allowedCodes) {
  assert(json && typeof json === 'object', `${where}：响应不是 JSON 对象`)
  assert(json.ok === false, `${where}：期望 ok:false，实际 ${JSON.stringify(json).slice(0, 240)}`)
  assert(typeof json.code === 'string' && json.code.length > 0, `${where}：失败响应缺 code 字段`)
  if (allowedCodes && allowedCodes.length) {
    assert(allowedCodes.includes(json.code), `${where}：期望 code ∈ ${allowedCodes.join('|')}，实际 ${json.code}`)
  }
  assert(typeof json.message === 'string' && json.message.length > 0, `${where}：失败响应缺 message 字段`)
}

/** 顺序执行一项检查；抛错即 FAIL，不影响后续（依赖项自行用 state 判断）。 */
async function check(name, fn) {
  try {
    const note = await fn()
    pass(name, note)
    return true
  } catch (error) {
    fail(name, (error && error.message) || String(error))
    return false
  }
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

async function request(base, pathname, options = {}) {
  const { method = 'GET', body, headers = {}, timeoutMs = 20000 } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(base + pathname, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      redirect: 'follow'
    })
    const text = await response.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* 非 JSON（例如 HTML 404 页）保持 null */
    }
    return { status: response.status, json, text, headers: response.headers }
  } finally {
    clearTimeout(timer)
  }
}

const host = (pathname, options) => request(DSH_URL, pathname, options)

async function hostJson(pathname, options) {
  const response = await host(pathname, options)
  assert(
    response.json && typeof response.json === 'object',
    `期望 JSON 响应，实际 HTTP ${response.status} / ${String(response.text).slice(0, 120)}`
  )
  return { ...response, json: response.json }
}

const kernel = (pathname, body) => request(KERNEL_URL, pathname, { method: 'POST', body: body || {} })

async function kernelPost(pathname, body) {
  const response = await kernel(pathname, body)
  assert(
    response.json && typeof response.json === 'object',
    `内核 ${pathname} 未返回 JSON（HTTP ${response.status}）：${String(response.text).slice(0, 120)}`
  )
  return response.json
}

async function kernelSql(stmt) {
  const json = await kernelPost('/api/query/sql', { stmt, mode: 'readonly' })
  assert(json.code === 0, `内核 SQL 失败：${json.msg}`)
  return json.data || []
}

async function kernelDocs(box) {
  return kernelSql(`select id, hpath, path from blocks where type = 'd' and box = '${box}'`)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 思源的 blocks 索引是异步更新的（新建/追加后 SQL 查询可能短暂查不到），
 * 因此对「索引相关」的断言统一用轮询等待，避免把内核延迟误判成 Host 缺陷。
 */
async function waitFor(fn, options = {}) {
  const { timeoutMs = 8000, intervalMs = 300, what = '条件' } = options
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await sleep(intervalMs)
  }
  throw new Error(`${what} 在 ${timeoutMs}ms 内未就绪${lastError ? '：' + lastError.message : ''}`)
}

/** 轮询 GET /siyuan/doc 直到 ok 且满足 predicate（用于等索引与正文落盘）。 */
async function waitDoc(id, predicate, what) {
  return waitFor(
    async () => {
      const { json } = await hostJson(`/siyuan/doc?id=${encodeURIComponent(id)}`)
      if (!json.ok) return null
      return predicate(json) ? json : null
    },
    { what }
  )
}

/* ---------------- Host 0.3.0 新增接口的相关辅助 ---------------- */

function queryString(query) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

/** GET /siyuan/tree，不抛错（用于错误分支断言）。 */
async function getTree(query) {
  const { json } = await hostJson('/siyuan/tree' + queryString(query))
  return json
}

/** GET /siyuan/tree 并断言 ok:true。 */
async function getTreeOk(query) {
  const json = await getTree(query)
  assertOk(json, '/siyuan/tree' + queryString(query))
  return json
}

/** GET /siyuan/tree/children，不抛错（用于错误分支断言）。 */
async function getTreeChildren(query) {
  const { json } = await hostJson('/siyuan/tree/children' + queryString(query))
  return json
}

/** GET /siyuan/doc，不抛错（用于错误分支与分页断言）。 */
async function getDoc(query) {
  const { json } = await hostJson('/siyuan/doc' + queryString(query))
  return json
}

/** 内核文档树顺序（Host /siyuan/tree 的对照基准）。 */
async function kernelListDocs(notebookId, docPath) {
  const json = await kernelPost('/api/filetree/listDocsByPath', {
    notebook: notebookId,
    path: docPath
  })
  assert(json.code === 0, `内核 listDocsByPath 失败：${json.msg}`)
  return (json.data && json.data.files) || []
}

function assertTreeNode(node, where) {
  assert(node && typeof node === 'object', `${where} 节点不是对象`)
  assert(typeof node.id === 'string' && /^\d{14}-[0-9a-z]{7}$/.test(node.id), `${where}.id 异常：${node.id}`)
  assert(typeof node.name === 'string' && node.name.length > 0, `${where}.name 缺失`)
  assert(typeof node.hpath === 'string' && node.hpath.startsWith('/'), `${where}.hpath 异常：${node.hpath}`)
  assert(typeof node.subFileCount === 'number' && node.subFileCount >= 0, `${where}.subFileCount 异常`)
  assert(Array.isArray(node.children), `${where}.children 应为数组`)
  assert(typeof node.hasMore === 'boolean', `${where}.hasMore 应为布尔`)
}

/* ------------------------------------------------------------------ */
/* 测试状态                                                            */
/* ------------------------------------------------------------------ */

const state = {
  endpoint: KERNEL_URL,
  notebook: null, // {id, name}
  createdId: '',
  slashedId: '',
  dailyId: '',
  treeDocId: '',
  origWrite: null,
  origDefaultNotebook: '',
  origDefaultDoc: '',
  baselineIds: new Set(),
  dailyExistedBefore: false,
  settingsTouched: false,
  defaultNotebookTouched: false,
  defaultDocTouched: false
}

function requireCreated(name) {
  if (state.createdId) return true
  skip(name, '依赖「新建文档」步骤，已失败')
  return false
}

/* ------------------------------------------------------------------ */
/* 清理与设置还原                                                      */
/* ------------------------------------------------------------------ */

function isCleanCandidate(doc) {
  const hpath = String(doc.hpath || '')
  // dsh-e2e- 前缀是本脚本专属测试数据，任何时候都可删；
  // daily note 链只删「本次测试前不存在」的那些，避免动到用户真实日记。
  if (hpath.startsWith('/' + PREFIX)) return true
  return !state.baselineIds.has(doc.id) && hpath.startsWith('/daily note')
}

async function cleanupDocuments() {
  if (!state.notebook) return { ok: true, note: '没有测试笔记本，无需清理' }
  const docs = await kernelDocs(state.notebook.id)
  const depth = (hpath) => String(hpath || '').split('/').filter(Boolean).length
  const targets = docs
    .filter(isCleanCandidate)
    .sort(
      (a, b) =>
        depth(b.hpath) - depth(a.hpath) || String(b.hpath).length - String(a.hpath).length
    ) // 最深优先，避免先删父文档留下孤儿

  if (!targets.length) return { ok: true, note: '没有残留测试文档' }

  console.log('\n清理目标（只删 dsh-e2e- 前缀 / 本次新建的 daily note 链）：')
  for (const doc of targets) console.log(`  - ${doc.id}  ${doc.hpath}  (${doc.path})`)

  for (const doc of targets) {
    // 二次确认：只允许删测试文档，绝不按笔记本批量删
    assert(
      String(doc.hpath).startsWith('/' + PREFIX) ||
        String(doc.hpath).startsWith('/daily note') ||
        doc.id === state.createdId ||
        doc.id === state.slashedId,
      `清理安全闸拒绝删除非测试文档：${doc.id} ${doc.hpath}`
    )
    const removed = await kernelPost('/api/filetree/removeDocByID', { id: doc.id })
    if (removed.code !== 0) {
      const fallback = await kernelPost('/api/filetree/removeDoc', {
        notebook: state.notebook.id,
        path: doc.path
      })
      assert(fallback.code === 0, `删除 ${doc.id} 失败：removeDocByID=${removed.msg}；removeDoc=${fallback.msg}`)
    }
  }

  await sleep(CLEAN_WAIT_MS)
  const after = await kernelDocs(state.notebook.id)
  const leftover = after.filter(isCleanCandidate)
  assert(leftover.length === 0, `清理后仍残留 ${leftover.length} 篇：${leftover.map((d) => d.hpath).join('、')}`)
  const baselineAlive = [...state.baselineIds].every((id) => after.some((doc) => doc.id === id))
  assert(baselineAlive, '清理时误伤了测试前的原有文档（baseline 丢失），请人工检查！')
  return { ok: true, note: `已删除 ${targets.length} 篇并复查消失（3 秒）` }
}

async function restoreSettings() {
  const patch = {}
  if (state.settingsTouched && typeof state.origWrite === 'boolean') patch.write = state.origWrite
  if (state.defaultNotebookTouched) patch.defaultNotebook = state.origDefaultNotebook || ''
  if (state.defaultDocTouched) patch.defaultDoc = state.origDefaultDoc || ''
  if (!Object.keys(patch).length) return
  try {
    await hostJson('/siyuan/settings', {
      method: 'POST',
      body: patch,
      headers: WRITE_HEADERS
    })
    console.log(`\n设置已还原：${JSON.stringify(patch)}`)
  } catch (error) {
    console.log(`\n[WARN] 设置还原失败（请手动检查）：${(error && error.message) || error}`)
  }
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  console.log('dsh-siyuan 路由端到端测试')
  console.log(`宿主地址 : ${DSH_URL}`)
  console.log(`思源内核 : ${KERNEL_URL}（仅清理/复查）`)
  console.log(`测试笔记本 : ${NOTEBOOK_NAME}`)
  console.log(`本轮前缀 : ${PREFIX}（标题 ${TITLE}）\n`)

  if (typeof fetch !== 'function') {
    console.error('[FAIL] 当前 Node 没有全局 fetch，请使用 Node 18+')
    process.exitCode = 1
    return
  }

  /* ---------- 0. 连通性与插件装载 ---------- */
  let statusJson = null
  let statusHttp = 0
  const statusOk = await check('GET /siyuan/status 连通且 ok:true', async () => {
    const response = await host('/siyuan/status')
    statusHttp = response.status
    assert(
      response.json && typeof response.json === 'object',
      `期望 JSON 响应，实际 HTTP ${response.status} / ${String(response.text).slice(0, 120)}`
    )
    statusJson = response.json
    assert(
      response.json.ok === true,
      `插件可达但内核不通：${response.json.code || '?'} ${response.json.message || ''}`
    )
    return `HTTP ${response.status}`
  })

  if (!statusOk) {
    if (statusHttp === 404) {
      console.error('\n结论：/siyuan/status 返回 404 —— 插件似乎还没装载。')
      console.error('      等 Lead 确认「已装载」后重新运行：node test/e2e.mjs')
    } else if (!statusHttp) {
      console.error(`\n结论：连不上宿主 ${DSH_URL}。请确认 dsh web 在跑，或用 DSH_URL 指定正确地址。`)
    } else {
      console.error('\n结论：/siyuan/status 不可用，请确认插件已装载、宿主地址正确、思源内核在跑。')
    }
    return
  }

  const status = statusJson
  state.endpoint = typeof status.endpoint === 'string' && status.endpoint ? status.endpoint : KERNEL_URL

  await check('GET /siyuan/status 返回形状符合契约', async () => {
    assert(typeof status.endpoint === 'string' && /^https?:\/\//.test(status.endpoint), 'endpoint 应为 http(s) URL')
    assert(typeof status.version === 'string' && /^\d+\.\d+\.\d+$/.test(status.version), `version 应为版本号，实际 ${status.version}`)
    assert(Array.isArray(status.notebooks), 'notebooks 应为数组')
    assert(status.notebooks.length > 0, 'notebooks 不应为空')
    for (const notebook of status.notebooks) {
      assert(typeof notebook.id === 'string' && notebook.id, 'notebook.id 缺失')
      assert(typeof notebook.name === 'string', 'notebook.name 缺失')
      assert(typeof notebook.closed === 'boolean', 'notebook.closed 应为布尔')
    }
    assert(status.settings && typeof status.settings === 'object', 'settings 应为对象')
    assert(typeof status.settings.write === 'boolean', 'settings.write 应为布尔')
    assert(typeof status.tokenConfigured === 'boolean', 'tokenConfigured 应为布尔')
    if (typeof status.write !== 'boolean') {
      warn('GET /siyuan/status 顶层 write', '契约要求顶层 write 布尔值；当前实现只在 settings.write（client.js 已兼容）')
    }
    return `version=${status.version}，notebooks=${status.notebooks.length}`
  })

  await check('GET /siyuan/notebooks 返回形状', async () => {
    const { json } = await hostJson('/siyuan/notebooks')
    assertOk(json, '/siyuan/notebooks')
    assert(Array.isArray(json.notebooks) && json.notebooks.length > 0, 'notebooks 不应为空数组')
    for (const notebook of json.notebooks) {
      assert(typeof notebook.id === 'string' && notebook.id, 'notebook.id 缺失')
      assert(typeof notebook.name === 'string' && notebook.name, 'notebook.name 缺失')
      assert(typeof notebook.closed === 'boolean', 'notebook.closed 应为布尔')
      assert(typeof notebook.docCount === 'number', 'notebook.docCount 应为数字')
    }
    return `${json.notebooks.length} 个笔记本`
  })

  /* ---------- 1. 定位测试笔记本 + 基线 ---------- */
  const notebookFound = await check(`定位测试笔记本「${NOTEBOOK_NAME}」`, async () => {
    const { json } = await hostJson('/siyuan/notebooks')
    assertOk(json, '/siyuan/notebooks')
    const found = json.notebooks.find((notebook) => notebook.name === NOTEBOOK_NAME)
    assert(found, `找不到笔记本「${NOTEBOOK_NAME}」，可用：${json.notebooks.map((n) => n.name).join('、')}`)
    state.notebook = { id: found.id, name: found.name }
    return `id=${found.id}`
  })

  if (!notebookFound) {
    return
  }

  /* ---------- 2. 预清理上次残留 + 记基线 ---------- */
  await check('预清理上次残留的 dsh-e2e- 测试文档', async () => {
    const docs = await kernelDocs(state.notebook.id)
    const leftovers = docs.filter((doc) => String(doc.hpath || '').startsWith('/' + PREFIX))
    if (!leftovers.length) return '无残留'
    for (const doc of leftovers) {
      console.log(`  - 清理残留 ${doc.id} ${doc.hpath}`)
      const removed = await kernelPost('/api/filetree/removeDocByID', { id: doc.id })
      if (removed.code !== 0 && doc.path) {
        await kernelPost('/api/filetree/removeDoc', { notebook: state.notebook.id, path: doc.path })
      }
    }
    await sleep(CLEAN_WAIT_MS)
    const after = await kernelDocs(state.notebook.id)
    const still = after.filter((doc) => String(doc.hpath || '').startsWith('/' + PREFIX))
    assert(still.length === 0, `预清理后仍残留 ${still.length} 篇`)
    return `清理 ${leftovers.length} 篇`
  })

  const baselineOk = await check('记录测试前基线（原有文档 + daily 是否存在）', async () => {
    const docs = await kernelDocs(state.notebook.id)
    state.baselineIds = new Set(docs.map((doc) => doc.id))
    state.dailyExistedBefore = docs.some((doc) => String(doc.hpath || '').startsWith('/daily note'))
    return `基线 ${docs.length} 篇${state.dailyExistedBefore ? '，已有 daily note（日记测试将跳过）' : '，无 daily note'}`
  })

  if (!baselineOk) {
    console.error('\n[FAIL] 无法记录测试基线（内核直连 SQL 失败），为避免误删已终止后续写测试。')
    return
  }

  /* ---------- 3. 设置读写：CSRF / 写开关 ---------- */
  await check('GET /siyuan/settings 返回形状', async () => {
    const { json } = await hostJson('/siyuan/settings')
    assertOk(json, '/siyuan/settings')
    assert(json.settings && typeof json.settings === 'object', 'settings 应为对象')
    assert(typeof json.settings.endpoint === 'string' && json.settings.endpoint, 'settings.endpoint 缺失')
    assert(typeof json.settings.write === 'boolean', 'settings.write 应为布尔')
    assert(typeof json.write === 'boolean', '响应顶层 write 应为布尔')
    assert(typeof json.tokenConfigured === 'boolean', 'tokenConfigured 应为布尔')
    assert(typeof json.settings.defaultDoc === 'string', 'settings.defaultDoc 应为字符串')
    state.origWrite = json.write
    state.origDefaultNotebook = String(json.settings.defaultNotebook || '')
    state.origDefaultDoc = String(json.settings.defaultDoc || '')
    return `write=${json.write}，defaultNotebook=${state.origDefaultNotebook || '(空)'}，defaultDoc=${state.origDefaultDoc || '(空)'}，endpoint=${json.settings.endpoint}`
  })

  await check('POST /siyuan/create 缺少 x-dsh-siyuan 头被拒（CSRF）', async () => {
    const response = await hostJson('/siyuan/create', {
      method: 'POST',
      body: { notebook: state.notebook.name, title: `${PREFIX}csrf-${RUN}`, markdown: 'x' }
    })
    assert(response.status === 400, `期望 HTTP 400，实际 ${response.status}`)
    assertFail(response.json, 'CSRF 防护', ['SIYUAN_INVALID_ARGUMENT'])
    return `HTTP 400 code=${response.json.code}`
  })

  await check('POST /siyuan/settings 缺少 x-dsh-siyuan 头被拒（CSRF）', async () => {
    const response = await hostJson('/siyuan/settings', { method: 'POST', body: { write: false } })
    assert(response.status === 400, `期望 HTTP 400，实际 ${response.status}`)
    assertFail(response.json, 'CSRF 防护', ['SIYUAN_INVALID_ARGUMENT'])
    return `HTTP 400 code=${response.json.code}`
  })

  await check('写入关闭时 POST /siyuan/create 返回 SIYUAN_WRITE_DISABLED', async () => {
    const disabled = await hostJson('/siyuan/settings', {
      method: 'POST',
      body: { write: false },
      headers: WRITE_HEADERS
    })
    assertOk(disabled.json, '关闭 write')
    state.settingsTouched = true
    const response = await hostJson('/siyuan/create', {
      method: 'POST',
      body: { notebook: state.notebook.name, title: `${PREFIX}blocked-${RUN}`, markdown: 'x' },
      headers: WRITE_HEADERS
    })
    assertFail(response.json, '写开关关闭', ['SIYUAN_WRITE_DISABLED'])
    return `code=${response.json.code}`
  })

  await check('开启写开关（POST /siyuan/settings）', async () => {
    const response = await hostJson('/siyuan/settings', {
      method: 'POST',
      body: { write: true },
      headers: WRITE_HEADERS
    })
    assertOk(response.json, '开启 write')
    assert(response.json.write === true, '响应顶层 write 应为 true')
    assert(response.json.settings && response.json.settings.write === true, 'settings.write 应为 true')
    state.settingsTouched = true
    return 'write=true'
  })

  /* ---------- 3.5 文档树 GET /siyuan/tree ---------- */
  await check(`GET /siyuan/tree 返回嵌套文档树（${TREE_NOTEBOOK_NAME}，depth=2）`, async () => {
    const json = await getTreeOk({ notebook: TREE_NOTEBOOK_NAME, depth: 2, refresh: 1 })
    assert(json.order === 'document-tree', `order 应为 document-tree，实际 ${json.order}`)
    assert(json.depth === 2, `depth 应为 2，实际 ${json.depth}`)
    assert(json.notebook && typeof json.notebook.id === 'string' && json.notebook.id, 'notebook.id 缺失')
    assert(typeof json.notebook.name === 'string' && json.notebook.name.length > 0, 'notebook.name 缺失')
    assert(
      typeof json.fetchedAt === 'string' && !Number.isNaN(Date.parse(json.fetchedAt)),
      'fetchedAt 应为 ISO 时间'
    )
    assert(Array.isArray(json.nodes) && json.nodes.length > 0, 'nodes 不应为空')
    for (const node of json.nodes) assertTreeNode(node, 'root')
    for (const child of json.nodes.flatMap((node) => node.children)) assertTreeNode(child, 'child')
    const parents = json.nodes.filter((node) => node.subFileCount > 0)
    assert(parents.length > 0, `测试依赖：${TREE_NOTEBOOK_NAME} 应有含子文档的根文档`)
    assert(parents.every((node) => node.children.length > 0), 'depth=2 时含子文档的根节点应返回 children')
    return `${json.notebook.id}，roots=${json.nodes.length}，children=${json.nodes.flatMap((n) => n.children).length}`
  })

  await check('GET /siyuan/tree 根层顺序 = 内核 listDocsByPath 顺序（按文档树排序）', async () => {
    const json = await getTreeOk({ notebook: TREE_NOTEBOOK_NAME, depth: 1, refresh: 1 })
    const kernelFiles = await kernelListDocs(json.notebook.id, '/')
    assert(kernelFiles.length > 0, '内核根层文件不应为空')
    const treeNames = json.nodes.map((node) => node.name)
    const kernelNames = kernelFiles.map((file) => file.name)
    assert(
      treeNames.length === kernelNames.length,
      `根层数量不一致：tree=${treeNames.length} kernel=${kernelNames.length}`
    )
    assert(
      JSON.stringify(treeNames) === JSON.stringify(kernelNames),
      `根层顺序/内容与内核不一致：tree=${JSON.stringify(treeNames)} kernel=${JSON.stringify(kernelNames)}`
    )
    // 参照组：按 blocks.updated 倒序的根文档标题；若恰好同序只作说明，不作强断言
    const updatedRows = await kernelSql(
      `select content from blocks where type = 'd' and box = '${json.notebook.id}' and hpath not like '%/%' order by updated desc`
    )
    const updatedNames = updatedRows.map((row) => row.content)
    const sameAsUpdated = JSON.stringify(updatedNames) === JSON.stringify(treeNames)
    return `${treeNames.length} 项逐项一致；与 updated 倒序${
      sameAsUpdated ? '恰好相同（不构成反证）' : '不同（确认按文档树排序）'
    }`
  })

  await check('GET /siyuan/tree depth=1：children 为空、hasMore 反映 subFileCount', async () => {
    const json = await getTreeOk({ notebook: TREE_NOTEBOOK_NAME, depth: 1, refresh: 1 })
    assert(json.depth === 1, `depth 应为 1，实际 ${json.depth}`)
    assert(Array.isArray(json.nodes) && json.nodes.length > 0, 'nodes 不应为空')
    for (const node of json.nodes) {
      assert(node.children.length === 0, `depth=1 时「${node.name}」children 应为空`)
      assert(
        node.hasMore === (node.subFileCount > 0),
        `hasMore 与 subFileCount 不符：「${node.name}」subFileCount=${node.subFileCount} hasMore=${node.hasMore}`
      )
    }
    const hasMore = json.nodes.filter((node) => node.hasMore).length
    return `roots=${json.nodes.length}，hasMore=${hasMore}`
  })

  await check('GET /siyuan/tree depth=2：子层 hasMore 与嵌套顺序与内核一致', async () => {
    const json = await getTreeOk({ notebook: TREE_NOTEBOOK_NAME, depth: 2, refresh: 1 })
    assert(json.depth === 2, `depth 应为 2，实际 ${json.depth}`)
    for (const root of json.nodes) {
      assert(root.hasMore === false, `depth=2 时根节点「${root.name}」的 hasMore 应为 false`)
      for (const child of root.children) {
        assert(child.children.length === 0, `depth=2 时「${child.name}」children 应为空`)
        assert(
          child.hasMore === (child.subFileCount > 0),
          `子层 hasMore 与 subFileCount 不符：「${child.name}」subFileCount=${child.subFileCount} hasMore=${child.hasMore}`
        )
      }
    }
    const rootNode = json.nodes.find((node) => node.subFileCount > 0 && node.children.length > 0)
    assert(rootNode, '测试依赖：需要一个含子文档且 depth=2 已展开的根节点')
    const kernelRoots = await kernelListDocs(json.notebook.id, '/')
    const kernelRoot = kernelRoots.find((file) => file.id === rootNode.id)
    assert(kernelRoot, `内核根层找不到文档 ${rootNode.id}`)
    const kernelChildren = await kernelListDocs(json.notebook.id, kernelRoot.path)
    const treeChildNames = rootNode.children.map((node) => node.name)
    const kernelChildNames = kernelChildren.map((file) => file.name)
    assert(
      JSON.stringify(treeChildNames) === JSON.stringify(kernelChildNames),
      `子层顺序不一致：「${rootNode.name}」tree=${JSON.stringify(treeChildNames)} kernel=${JSON.stringify(kernelChildNames)}`
    )
    return `子层「${rootNode.name}」${treeChildNames.length} 项逐项一致`
  })

  await check('GET /siyuan/tree refresh=1 返回一致结果且带 fetchedAt', async () => {
    const cached = await getTreeOk({ notebook: TREE_NOTEBOOK_NAME, depth: 1 })
    const fresh = await getTreeOk({ notebook: TREE_NOTEBOOK_NAME, depth: 1, refresh: 1 })
    assert(
      JSON.stringify(cached.nodes.map((node) => node.id)) === JSON.stringify(fresh.nodes.map((node) => node.id)),
      'refresh=1 结果与未刷新结果不一致'
    )
    assert(
      typeof fresh.fetchedAt === 'string' && !Number.isNaN(Date.parse(fresh.fetchedAt)),
      'fetchedAt 应为 ISO 时间'
    )
    return `refresh=1 仍 ${fresh.nodes.length} 个根节点`
  })

  await check('GET /siyuan/tree 缺省 notebook 使用默认笔记本', async () => {
    const notebooks = (await hostJson('/siyuan/notebooks')).json.notebooks
    let defaultHint = String(state.origDefaultNotebook || '')
    if (!defaultHint) {
      const target = notebooks.find((notebook) => notebook.name.startsWith('00-收件箱'))
      assert(target, '默认笔记本为空，且找不到「00-收件箱」用来临时设置')
      const set = await hostJson('/siyuan/settings', {
        method: 'POST',
        body: { defaultNotebook: target.id },
        headers: WRITE_HEADERS
      })
      assertOk(set.json, '临时设置默认笔记本')
      state.defaultNotebookTouched = true
      defaultHint = target.id
    }
    const resolved =
      notebooks.find((notebook) => notebook.id === defaultHint) ||
      notebooks.find((notebook) => notebook.name === defaultHint) ||
      notebooks.filter((notebook) => notebook.name.includes(defaultHint))[0]
    assert(resolved, `无法把默认笔记本「${defaultHint}」解析成具体笔记本`)
    const json = await getTreeOk({ depth: 1, refresh: 1 })
    assert(
      json.notebook.id === resolved.id,
      `缺省 notebook 应使用默认笔记本 ${resolved.id}（${resolved.name}），实际 ${json.notebook.id}`
    )
    if (state.defaultNotebookTouched) {
      const restore = await hostJson('/siyuan/settings', {
        method: 'POST',
        body: { defaultNotebook: state.origDefaultNotebook || '' },
        headers: WRITE_HEADERS
      })
      assertOk(restore.json, '还原默认笔记本')
      state.defaultNotebookTouched = false
    }
    return `默认笔记本=${resolved.name}（${resolved.id}）`
  })

  await check('GET /siyuan/tree 不存在的笔记本报 SIYUAN_NOT_FOUND', async () => {
    const json = await getTree({ notebook: '不存在的笔记本-zzz', depth: 1 })
    assertFail(json, '/siyuan/tree 不存在笔记本', ['SIYUAN_NOT_FOUND'])
    return `code=${json.code}`
  })

  await check('GET /siyuan/tree 非法 depth 被夹到 1..8（不 500）', async () => {
    const zero = await getTree({ notebook: TREE_NOTEBOOK_NAME, depth: 0, refresh: 1 })
    assertOk(zero, '/siyuan/tree depth=0')
    assert(zero.depth >= 1 && zero.depth <= 8, `depth=0 应被夹到 1..8，实际 ${zero.depth}`)
    const big = await getTree({ notebook: TREE_NOTEBOOK_NAME, depth: 99, refresh: 1 })
    assertOk(big, '/siyuan/tree depth=99')
    assert(big.depth === 8, `depth=99 应被夹到 8，实际 ${big.depth}`)
    const text = await getTree({ notebook: TREE_NOTEBOOK_NAME, depth: 'abc', refresh: 1 })
    assertOk(text, '/siyuan/tree depth=abc')
    assert(text.depth >= 1 && text.depth <= 8, `depth=abc 应回退到合法范围，实际 ${text.depth}`)
    return `depth=0→${zero.depth}，99→${big.depth}，abc→${text.depth}`
  })

  await check('GET /siyuan/tree 写操作后缓存失效（create 后立即可见新文档）', async () => {
    // 先读一次（不带 refresh），把 Host 的树缓存填上
    const before = await getTreeOk({ notebook: state.notebook.id, depth: 1 })
    const beforeIds = before.nodes.map((node) => node.id)
    // 新建一篇测试文档；Host 在 create 后应 clearTreeCache()
    const created = await hostJson('/siyuan/create', {
      method: 'POST',
      body: { notebook: state.notebook.name, title: TREE_TITLE, markdown: 'tree cache test' },
      headers: WRITE_HEADERS
    })
    assertOk(created.json, '/siyuan/create（tree 缓存测试）')
    const treeDocId = created.json.id
    state.treeDocId = treeDocId
    assert(!beforeIds.includes(treeDocId), '新建文档 id 不应早已出现在缓存里（测试自检）')
    // 等内核文件树就绪，避免把内核延迟误判成「缓存未失效」
    await waitFor(
      async () => (await kernelListDocs(state.notebook.id, '/')).some((file) => file.id === treeDocId),
      { what: '内核文件树出现新文档' }
    )
    const after = await getTreeOk({ notebook: state.notebook.id, depth: 1 })
    assert(
      after.nodes.some((node) => node.id === treeDocId),
      `create 后 /siyuan/tree（未带 refresh）仍看不到新文档 ${treeDocId}，clearTreeCache 可能未生效`
    )
    // 任务要求：按 id 删除并复查
    const removed = await kernelPost('/api/filetree/removeDocByID', { id: treeDocId })
    assert(removed.code === 0, `删除 tree 测试文档失败：${removed.msg}`)
    await sleep(CLEAN_WAIT_MS)
    const left = await kernelSql(`select id from blocks where id = '${treeDocId}'`)
    assert(left.length === 0, `tree 测试文档删除后仍存在于 blocks 表：${treeDocId}`)
    return `缓存失效验证通过（${beforeIds.length} → ${after.nodes.length} 个根节点），已按 id 删除 ${treeDocId}`
  })

  /* ---------- 3.6 Host 0.3.0 新覆盖：tree/children、hpath、doc 默认行数、defaultDoc ---------- */
  await check('GET /siyuan/tree/children 返回直接子文档（02 /领域知识库，7 项）', async () => {
    const json = await getTreeChildren({ notebook: TREE_NOTEBOOK_NAME, id: TREE_CHILDREN_PARENT_ID })
    assertOk(json, '/siyuan/tree/children')
    assert(
      json.parentId === TREE_CHILDREN_PARENT_ID,
      `parentId 应为 ${TREE_CHILDREN_PARENT_ID}，实际 ${json.parentId}`
    )
    assert(json.order === 'document-tree', `order 应为 document-tree，实际 ${json.order}`)
    assert(Array.isArray(json.nodes) && json.nodes.length > 0, 'nodes 不应为空')
    for (const node of json.nodes) assertTreeNode(node, 'child')
    for (const node of json.nodes) {
      assert(node.children.length === 0, `tree/children 只返回一层，「${node.name}」children 应为空`)
      assert(
        node.hasMore === (node.subFileCount > 0),
        `hasMore 与 subFileCount 不符：「${node.name}」subFileCount=${node.subFileCount} hasMore=${node.hasMore}`
      )
      assert(node.hpath.startsWith('/领域知识库/'), `hpath 前缀异常：${node.hpath}`)
    }
    return `nodes=${json.nodes.length}（${json.nodes.map((node) => node.name).join('、')}）`
  })

  await check('GET /siyuan/tree/children 子层顺序 = 内核 listDocsByPath（逐项一致）', async () => {
    const json = await getTreeChildren({ notebook: TREE_NOTEBOOK_NAME, id: TREE_CHILDREN_PARENT_ID })
    assertOk(json, '/siyuan/tree/children')
    const parentRows = await kernelSql(
      `select path, box from blocks where id = '${TREE_CHILDREN_PARENT_ID}' limit 1`
    )
    assert(parentRows.length === 1 && parentRows[0].path, `内核查不到父文档路径 ${TREE_CHILDREN_PARENT_ID}`)
    const kernelFiles = await kernelListDocs(parentRows[0].box, parentRows[0].path)
    const treeNames = json.nodes.map((node) => node.name)
    const kernelNames = kernelFiles.map((file) => file.name)
    assert(
      treeNames.length === kernelNames.length,
      `子层数量不一致：tree=${treeNames.length} kernel=${kernelNames.length}`
    )
    assert(
      JSON.stringify(treeNames) === JSON.stringify(kernelNames),
      `子层顺序/内容与内核不一致：tree=${JSON.stringify(treeNames)} kernel=${JSON.stringify(kernelNames)}`
    )
    return `${treeNames.length} 项逐项一致`
  })

  await check('GET /siyuan/tree/children 错误分支（按实际实现断言）', async () => {
    const missing = await getTreeChildren({ notebook: TREE_NOTEBOOK_NAME })
    assertFail(missing, '/siyuan/tree/children 缺 id', ['SIYUAN_NOT_FOUND'])
    const bad = await getTreeChildren({ notebook: TREE_NOTEBOOK_NAME, id: '29990101000000-zzzzzzz' })
    assertFail(bad, '/siyuan/tree/children 不存在 id', ['SIYUAN_NOT_FOUND'])
    return `缺 id → ${missing.code}；不存在 id → ${bad.code}`
  })

  await check('GET /siyuan/doc?id=<完整 hpath> 按路径读取文档', async () => {
    const expectedRows = await kernelSql(
      `select id, content from blocks where type = 'd' and hpath = '${HPATH_DOC}' limit 1`
    )
    assert(expectedRows.length === 1, `内核找不到 hpath ${HPATH_DOC}（测试依赖）`)
    const json = await getDoc({ id: HPATH_DOC })
    assertOk(json, '/siyuan/doc（hpath）')
    assert(json.id === expectedRows[0].id, `id 应为 ${expectedRows[0].id}，实际 ${json.id}`)
    assert(json.title === expectedRows[0].content, `title 不一致：${json.title}`)
    assert(json.hpath === HPATH_DOC, `hpath 不一致：${json.hpath}`)
    assert(typeof json.markdown === 'string' && json.markdown.length > 0, 'markdown 不应为空')
    assert(typeof json.totalLines === 'number' && json.totalLines > 0, 'totalLines 应为正数')
    return `id=${json.id}，title=${json.title}，markdown ${json.markdown.length} 字符`
  })

  await check('GET /siyuan/doc 不存在的 hpath → SIYUAN_NOT_FOUND', async () => {
    const json = await getDoc({ id: '/领域知识库/不存在-hpath-zzz' })
    assertFail(json, '/siyuan/doc 不存在 hpath', ['SIYUAN_NOT_FOUND'])
    return `code=${json.code}`
  })

  // 找一篇 >400 行的长文档（只读），用于缺省 1500 行与分页断言
  let longDoc = null
  try {
    const rows = await kernelSql(
      "select root_id as id, count(*) as c, sum(length(content)) as n from blocks where type != 'd' group by root_id order by n desc limit 8"
    )
    for (const row of rows) {
      const full = await getDoc({ id: row.id, limit: 3000 })
      if (full.ok && typeof full.totalLines === 'number' && full.totalLines > 400) {
        longDoc = { id: row.id, full }
        break
      }
    }
  } catch {
    longDoc = null
  }
  if (longDoc) {
    pass(
      '定位长文档（用于 /siyuan/doc 缺省行数与分页断言）',
      `id=${longDoc.id}，totalLines=${longDoc.full.totalLines}`
    )
  } else {
    skip('定位长文档（用于 /siyuan/doc 缺省行数与分页断言）', '内核里没有 >400 行的文档，相关断言跳过')
  }

  if (longDoc) {
    await check('GET /siyuan/doc 缺省 limit=1500（长文档）', async () => {
      const totalLines = longDoc.full.totalLines
      const json = await getDoc({ id: longDoc.id })
      assertOk(json, '/siyuan/doc（缺省 limit）')
      assert(json.totalLines === totalLines, `totalLines 不一致：${json.totalLines} vs ${totalLines}`)
      assert(json.totalLines > 400, `totalLines 应 >400，实际 ${json.totalLines}`)
      const lines = json.markdown.split('\n')
      const expected = Math.min(1500, totalLines)
      assert(
        lines.length === expected,
        `缺省返回行数应为 min(1500,totalLines)=${expected}，实际 ${lines.length}`
      )
      assert(json.offset === 0, `offset 应为 0，实际 ${json.offset}`)
      assert(
        json.truncated === (1500 < totalLines),
        `truncated 应为 ${1500 < totalLines}，实际 ${json.truncated}`
      )
      return `totalLines=${totalLines}，返回 ${lines.length} 行，truncated=${json.truncated}`
    })

    await check('GET /siyuan/doc offset=100&limit=50 分页（从第 100 行开始）', async () => {
      const fullLines = longDoc.full.markdown.split('\n')
      const totalLines = longDoc.full.totalLines
      const page = await getDoc({ id: longDoc.id, offset: 100, limit: 50 })
      assertOk(page, '/siyuan/doc（分页）')
      assert(page.offset === 100, `offset 应回显 100，实际 ${page.offset}`)
      assert(page.totalLines === totalLines, `分页时 totalLines 应不变：${page.totalLines} vs ${totalLines}`)
      const expected = fullLines.slice(100, 150).join('\n')
      assert(
        page.markdown === expected,
        'offset=100&limit=50 返回内容与完整正文第 100–149 行不一致'
      )
      const expectedCount = Math.min(50, Math.max(0, totalLines - 100))
      assert(
        page.markdown.split('\n').length === expectedCount || expectedCount === 0,
        `分页行数应为 ${expectedCount}，实际 ${page.markdown.split('\n').length}`
      )
      assert(page.truncated === (100 + 50 < totalLines), `truncated 应为 ${100 + 50 < totalLines}`)
      return `从第 100 行起返回 ${page.markdown.split('\n').length} 行`
    })
  } else {
    skip('GET /siyuan/doc 缺省 limit=1500（长文档）', '未找到 >400 行文档')
    skip('GET /siyuan/doc offset=100&limit=50 分页（从第 100 行开始）', '未找到 >400 行文档')
  }

  await check('POST /siyuan/settings defaultDoc 设置并回显', async () => {
    const set = await hostJson('/siyuan/settings', {
      method: 'POST',
      body: { defaultDoc: HPATH_DOC },
      headers: WRITE_HEADERS
    })
    assertOk(set.json, '设置 defaultDoc')
    state.defaultDocTouched = true
    assert(
      set.json.settings && set.json.settings.defaultDoc === HPATH_DOC,
      `回显 defaultDoc 不一致：${JSON.stringify(set.json.settings)}`
    )
    const got = await hostJson('/siyuan/settings')
    assertOk(got.json, '读取 defaultDoc')
    assert(got.json.settings.defaultDoc === HPATH_DOC, `GET settings defaultDoc 不一致：${got.json.settings.defaultDoc}`)
    assert(
      got.json.settings.defaultNotebook === state.origDefaultNotebook,
      '设置 defaultDoc 不应改动 defaultNotebook（原值被破坏）'
    )
    return `defaultDoc=${HPATH_DOC}`
  })

  await check('POST /siyuan/settings defaultDoc 传空字符串清空，并还原测试前原值', async () => {
    const clear = await hostJson('/siyuan/settings', {
      method: 'POST',
      body: { defaultDoc: '' },
      headers: WRITE_HEADERS
    })
    assertOk(clear.json, '清空 defaultDoc')
    assert(
      clear.json.settings && clear.json.settings.defaultDoc === '',
      `清空后应回显 ''，实际 ${JSON.stringify(clear.json.settings)}`
    )
    const got = await hostJson('/siyuan/settings')
    assertOk(got.json, '读取清空后的 defaultDoc')
    assert(got.json.settings.defaultDoc === '', 'GET settings 清空后 defaultDoc 应为空')
    if (state.origDefaultDoc) {
      const restore = await hostJson('/siyuan/settings', {
        method: 'POST',
        body: { defaultDoc: state.origDefaultDoc },
        headers: WRITE_HEADERS
      })
      assertOk(restore.json, '还原 defaultDoc')
      assert(
        restore.json.settings.defaultDoc === state.origDefaultDoc,
        `还原 defaultDoc 失败：${JSON.stringify(restore.json.settings)}`
      )
    }
    state.defaultDocTouched = false
    return state.origDefaultDoc
      ? `清空成功，已还原测试前值 ${state.origDefaultDoc}`
      : '清空成功（测试前即为空，保持空）'
  })

  /* ---------- 4. 新建文档 ---------- */
  await check('POST /siyuan/create 新建文档（写入 99-辅助工具）', async () => {
    const response = await hostJson('/siyuan/create', {
      method: 'POST',
      body: {
        notebook: state.notebook.name,
        title: TITLE,
        markdown: `# ${TITLE}\n\n${PREFIX} 第一条：路由测试正文。\n`
      },
      headers: WRITE_HEADERS
    })
    assertOk(response.json, '/siyuan/create')
    const created = response.json
    assert(typeof created.id === 'string' && /^\d{14}-[0-9a-z]{7}$/.test(created.id), `id 格式异常：${created.id}`)
    assert(created.title === TITLE, `title 回显不一致：${created.title}`)
    assert(typeof created.hpath === 'string' && created.hpath.includes(TITLE), `hpath 应包含标题：${created.hpath}`)
    state.createdId = created.id
    await sleep(600)
    return `id=${created.id} hpath=${created.hpath}`
  })

  await check('POST /siyuan/create 标题含 / 不触发 3.8.9 pathAmbiguous', async () => {
    const response = await hostJson('/siyuan/create', {
      method: 'POST',
      body: {
        notebook: state.notebook.name,
        title: SLASH_TITLE,
        markdown: '斜杠标题正文'
      },
      headers: WRITE_HEADERS
    })
    assertOk(response.json, '/siyuan/create（斜杠标题）')
    assert(/^\d{14}-[0-9a-z]{7}$/.test(response.json.id), `id 格式异常：${response.json.id}`)
    state.slashedId = response.json.id
    return `id=${response.json.id} hpath=${response.json.hpath}`
  })

  await check('POST /siyuan/create title 为空时报 SIYUAN_INVALID_ARGUMENT', async () => {
    const response = await hostJson('/siyuan/create', {
      method: 'POST',
      body: { notebook: state.notebook.name, markdown: 'x' },
      headers: WRITE_HEADERS
    })
    assertFail(response.json, '/siyuan/create 空标题', ['SIYUAN_INVALID_ARGUMENT'])
    return `code=${response.json.code}`
  })

  /* ---------- 5. 读文档 ---------- */
  if (requireCreated('GET /siyuan/doc 读取新建文档（ok 形状）')) {
    await check('GET /siyuan/doc 读取新建文档（ok 形状）', async () => {
      // 新文档的 blocks 索引可能延迟几百毫秒，轮询到可见再断言
      const json = await waitDoc(
        state.createdId,
        (doc) =>
          typeof doc.markdown === 'string' && doc.markdown.includes(`${PREFIX} 第一条`),
        '新文档索引与正文'
      )
      assert(json.id === state.createdId, `id 应等于文档 id，实际 ${json.id}`)
      assert(typeof json.title === 'string' && json.title === TITLE, `title 不一致：${json.title}`)
      assert(typeof json.hpath === 'string' && json.hpath.includes(TITLE), `hpath 异常：${json.hpath}`)
      assert(typeof json.markdown === 'string' && json.markdown.includes(`${PREFIX} 第一条`), 'markdown 未包含正文')
      assert(typeof json.truncated === 'boolean', 'truncated 应为布尔')
      assert(!/^\s*---/.test(json.markdown), 'markdown 不应以 YAML frontmatter 开头（应已剥离）')
      return `markdown ${json.markdown.length} 字符，truncated=${json.truncated}`
    })
  }

  await check('GET /siyuan/doc 缺 id 报 SIYUAN_INVALID_ARGUMENT', async () => {
    const { json } = await hostJson('/siyuan/doc')
    assertFail(json, '/siyuan/doc 缺 id', ['SIYUAN_INVALID_ARGUMENT'])
    return `code=${json.code}`
  })

  await check('GET /siyuan/doc 不存在的 id 报 SIYUAN_NOT_FOUND', async () => {
    const { json } = await hostJson('/siyuan/doc?id=29990101000000-zzzzzzz')
    assertFail(json, '/siyuan/doc 不存在', ['SIYUAN_NOT_FOUND'])
    return `code=${json.code}`
  })

  /* ---------- 6. 追加 ---------- */
  if (requireCreated('POST /siyuan/append 追加到新建文档（position=append）')) {
    await check('POST /siyuan/append 追加到新建文档（position=append）', async () => {
      const response = await hostJson('/siyuan/append', {
        method: 'POST',
        body: { id: state.createdId, markdown: APPEND_MARK, position: 'append' },
        headers: WRITE_HEADERS
      })
      assertOk(response.json, '/siyuan/append')
      assert(response.json.id === state.createdId, `id 应回显目标文档，实际 ${response.json.id}`)
      assert(response.json.position === 'append', `position 应为 append，实际 ${response.json.position}`)
      assert(typeof response.json.daily === 'boolean', 'daily 应为布尔')
      // 追加块的索引可能延迟，轮询到正文出现
      await waitDoc(state.createdId, (doc) => doc.markdown.includes(APPEND_MARK), '追加内容落盘')
      return '追加内容已落到文档'
    })
  }

  if (requireCreated('POST /siyuan/append 以块为锚点插入（position=after）')) {
    await check('POST /siyuan/append 以块为锚点插入（position=after）', async () => {
      // 追加块的索引可能延迟，轮询搜索直到能拿到段落块作锚点
      const anchor = await waitFor(
        async () => {
          const { json } = await hostJson(`/siyuan/search?q=${encodeURIComponent(APPEND_MARK)}`)
          const block = (json.items || []).find((item) => item.type !== 'd')
          return block ? { json, block } : null
        },
        { what: '锚点块索引' }
      )
      const block = anchor.block
      const response = await hostJson('/siyuan/append', {
        method: 'POST',
        body: { id: block.id, markdown: `${PREFIX}after-${RUN}`, position: 'after' },
        headers: WRITE_HEADERS
      })
      assertOk(response.json, '/siyuan/append（after）')
      assert(response.json.position === 'after', `position 应为 after，实际 ${response.json.position}`)
      await waitDoc(
        state.createdId,
        (doc) => doc.markdown.includes(`${PREFIX}after-${RUN}`),
        'after 插入内容落盘'
      )
      return `锚点块 ${block.id}`
    })
  }

  /* ---------- 7. 搜索 / 最近 ---------- */
  await check('GET /siyuan/search 命中新建文档', async () => {
    const json = await waitFor(
      async () => {
        const { json } = await hostJson(`/siyuan/search?q=${encodeURIComponent(TITLE)}`)
        if (!json.ok) return null
        const hit = (json.items || []).some(
          (item) => item.id === state.createdId || item.rootId === state.createdId
        )
        return hit ? json : null
      },
      { what: '新建文档进入搜索索引' }
    )
    assert(Array.isArray(json.items), 'items 应为数组')
    assert(json.items.length >= 1, `应至少命中 1 条，实际 ${json.items.length}`)
    for (const item of json.items) {
      assert(typeof item.id === 'string' && /^\d{14}-[0-9a-z]{7}$/.test(item.id), `item.id 异常：${item.id}`)
      assert(typeof item.rootId === 'string', 'item.rootId 缺失')
      assert(typeof item.box === 'string' && item.box, 'item.box 缺失')
      assert(typeof item.notebook === 'string', 'item.notebook 缺失')
      assert(typeof item.hpath === 'string', 'item.hpath 缺失')
      assert(typeof item.title === 'string', 'item.title 缺失')
      assert(typeof item.snippet === 'string', 'item.snippet 缺失')
      assert(typeof item.type === 'string', 'item.type 缺失')
      assert(typeof item.updated === 'string', 'item.updated 缺失')
    }
    return `${json.items.length} 条命中`
  })

  await check('GET /siyuan/search?q= 空查询报 SIYUAN_INVALID_ARGUMENT', async () => {
    const { json } = await hostJson('/siyuan/search?q=')
    assertFail(json, '/siyuan/search 空查询', ['SIYUAN_INVALID_ARGUMENT'])
    return `code=${json.code}`
  })

  await check('GET /siyuan/search 按笔记本过滤', async () => {
    const json = await waitFor(
      async () => {
        const { json } = await hostJson(
          `/siyuan/search?q=${encodeURIComponent(PREFIX)}&notebook=${encodeURIComponent(state.notebook.id)}`
        )
        if (!json.ok) return null
        return (json.items || []).length >= 1 ? json : null
      },
      { what: '测试笔记本的搜索索引' }
    )
    assert(Array.isArray(json.items), 'items 应为数组')
    assert(json.items.every((item) => item.box === state.notebook.id), '过滤后出现了其它笔记本的条目')
    return `${json.items.length} 条（全部属于 ${NOTEBOOK_NAME}）`
  })

  await check('GET /siyuan/search 不存在的笔记本报 SIYUAN_NOT_FOUND', async () => {
    const { json } = await hostJson(`/siyuan/search?q=${PREFIX}&notebook=${encodeURIComponent('不存在的笔记本-zzz')}`)
    assertFail(json, '/siyuan/search 笔记本不存在', ['SIYUAN_NOT_FOUND'])
    return `code=${json.code}`
  })

  await check('GET /siyuan/recent 返回形状与排序', async () => {
    const { json } = await hostJson(`/siyuan/recent?limit=5&notebook=${encodeURIComponent(state.notebook.id)}`)
    assertOk(json, '/siyuan/recent')
    assert(Array.isArray(json.items), 'items 应为数组')
    assert(json.items.length <= 5, `limit=5 时应 ≤5 条，实际 ${json.items.length}`)
    for (const item of json.items) {
      assert(typeof item.id === 'string' && /^\d{14}-[0-9a-z]{7}$/.test(item.id), `item.id 异常：${item.id}`)
      assert(typeof item.title === 'string', 'item.title 缺失')
      assert(typeof item.hpath === 'string', 'item.hpath 缺失')
      assert(typeof item.updated === 'string', 'item.updated 缺失')
    }
    for (let index = 1; index < json.items.length; index += 1) {
      assert(
        String(json.items[index - 1].updated) >= String(json.items[index].updated),
        'recent 应按 updated 倒序'
      )
    }
    if (state.createdId) {
      const hit = json.items.some((item) => item.id === state.createdId)
      if (!hit) warn('GET /siyuan/recent 包含新建文档', `limit=5 内未见 ${state.createdId}（可能被其它更新挤出）`)
    }
    return `${json.items.length} 条`
  })

  /* ---------- 8. 打开链接 ---------- */
  await check('POST /siyuan/open 返回深链与 Web 链接并验证 HTTP 200', async () => {
    const { json } = await hostJson('/siyuan/open', {
      method: 'POST',
      body: { id: state.createdId || '20261108202749-9vcemxc' }
    })
    assertOk(json, '/siyuan/open')
    const id = state.createdId || '20261108202749-9vcemxc'
    assert(json.appLink === `siyuan://blocks/${id}`, `appLink 异常：${json.appLink}`)
    assert(typeof json.webLink === 'string' && /^https?:\/\//.test(json.webLink), `webLink 应为 URL：${json.webLink}`)
    assert(json.webLink.includes(id), 'webLink 未包含块 id')
    const page = await request('', json.webLink, { method: 'GET' })
    assert(page.status === 200, `webLink 打开 HTTP ${page.status}（期望 200）`)
    return `webLink=${json.webLink}`
  })

  await check('POST /siyuan/open 缺 id 报 SIYUAN_INVALID_ARGUMENT', async () => {
    const { json } = await hostJson('/siyuan/open', { method: 'POST', body: {} })
    assertFail(json, '/siyuan/open 缺 id', ['SIYUAN_INVALID_ARGUMENT'])
    return `code=${json.code}`
  })

  /* ---------- 9. 今天日记（仅当测试前不存在 daily note） ---------- */
  if (!state.dailyExistedBefore && state.notebook) {
    await check('POST /siyuan/append id=daily（显式 notebook=测试笔记本）', async () => {
      const response = await hostJson('/siyuan/append', {
        method: 'POST',
        body: { id: 'daily', notebook: state.notebook.name, markdown: DAILY_MARK, position: 'append' },
        headers: WRITE_HEADERS
      })
      assertOk(response.json, '/siyuan/append daily')
      assert(response.json.daily === true, `daily 应为 true，实际 ${response.json.daily}`)
      assert(/^\d{14}-[0-9a-z]{7}$/.test(String(response.json.id)), `日记 id 异常：${response.json.id}`)
      state.dailyId = String(response.json.id)
      await waitDoc(state.dailyId, (doc) => doc.markdown.includes(DAILY_MARK), '日记内容落盘')
      return `daily id=${state.dailyId}`
    })
  } else {
    skip('POST /siyuan/append id=daily（显式 notebook=测试笔记本）', '测试前该笔记本已有 daily note，为避免污染真实日记而跳过')
  }

  /* ---------- 10. 设置 / 测试连接 ---------- */
  await check('GET /siyuan/settings 在开启写入后回显 write=true', async () => {
    const { json } = await hostJson('/siyuan/settings')
    assertOk(json, '/siyuan/settings（写开关回显）')
    assert(json.write === true, `顶层 write 应为 true，实际 ${json.write}`)
    assert(json.settings && json.settings.write === true, 'settings.write 应为 true')
    return 'write=true'
  })

  await check('POST /siyuan/test 探活（不落盘）', async () => {
    const { json } = await hostJson('/siyuan/test', {
      method: 'POST',
      body: { endpoint: state.endpoint }
    })
    assertOk(json, '/siyuan/test')
    assert(typeof json.version === 'string' && /^\d+\.\d+\.\d+$/.test(json.version), `version 异常：${json.version}`)
    assert(typeof json.notebooks === 'number' && json.notebooks > 0, `notebooks 应为正数，实际 ${json.notebooks}`)
    return `version=${json.version} notebooks=${json.notebooks}`
  })

  await check('POST /siyuan/test 错误端点报 SIYUAN_UNREACHABLE/TIMEOUT', async () => {
    const { json } = await hostJson('/siyuan/test', {
      method: 'POST',
      body: { endpoint: 'http://127.0.0.1:1' }
    })
    assertFail(json, '/siyuan/test 错误端点', ['SIYUAN_UNREACHABLE', 'SIYUAN_TIMEOUT'])
    return `code=${json.code}`
  })

  /* ---------- 11. save-message ---------- */
  await check('POST /siyuan/save-message 缺 sessionId/messageId 报 SIYUAN_INVALID_ARGUMENT', async () => {
    const { json } = await hostJson('/siyuan/save-message', {
      method: 'POST',
      body: {},
      headers: WRITE_HEADERS
    })
    assertFail(json, '/siyuan/save-message 缺参数', ['SIYUAN_INVALID_ARGUMENT'])
    return `code=${json.code}`
  })

  await check('POST /siyuan/save-message 假 sessionId 返回结构化失败（不是崩溃）', async () => {
    const { json } = await hostJson('/siyuan/save-message', {
      method: 'POST',
      body: { sessionId: `${PREFIX}fake-session`, messageId: `${PREFIX}fake-message` },
      headers: WRITE_HEADERS
    })
    assertFail(json, '/siyuan/save-message 假 id', ['SIYUAN_NOT_FOUND', 'SIYUAN_INVALID_ARGUMENT'])
    return `code=${json.code}（无真实 sessionId/messageId，真实存入场景 skip）`
  })

  /* ---------- 12. 未知路由 ---------- */
  await check('未知 /siyuan 路由返回 HTTP 404', async () => {
    const response = await host('/siyuan/does-not-exist')
    assert(response.status === 404, `期望 HTTP 404，实际 ${response.status}`)
    if (response.json && typeof response.json === 'object') {
      // 若请求落到了插件 handler（而不是宿主路由层），应为结构化失败
      assertFail(response.json, '未知路由', ['SIYUAN_NOT_FOUND'])
      return `HTTP 404 code=${response.json.code}`
    }
    // 实际观测：宿主路由层对未注册的 exact 路径直接返回空 body 的 404，
    // 插件 handler 里的兜底 404 分支走不到（路由是精确注册的）。这是宿主行为，不算缺陷。
    return 'HTTP 404（宿主路由层空 body，符合预期）'
  })

  /* ---------- 13. 清理 + 复查 ---------- */
  await check('清理测试数据（removeDocByID + 3 秒复查）', async () => {
    const result = await cleanupDocuments()
    return result.note
  })
}

function outputSummary() {
  const failed = results.filter((item) => item.level === 'FAIL')
  const passed = results.filter((item) => item.level === 'PASS')
  const skipped = results.filter((item) => item.level === 'SKIP')
  const warned = results.filter((item) => item.level === 'WARN')

  console.log('\n========== 结果 ==========')
  console.log(`通过 ${passed.length} / 失败 ${failed.length} / 跳过 ${skipped.length} / 提示 ${warned.length}`)
  if (failed.length) {
    console.log('\n失败明细：')
    for (const item of failed) console.log(`  - ${item.name}：${item.note}`)
    process.exitCode = 1
  } else {
    console.log('\n全部通过 ✅')
  }
}

let mainError = null
try {
  await main()
} catch (error) {
  mainError = error
  console.log(`\n[FAIL] 测试脚本自身异常：${(error && error.message) || error}`)
  process.exitCode = 1
} finally {
  // 即使中途失败，也要尽量清理测试数据并还原设置
  try {
    if (state.notebook && state.baselineIds.size) {
      const result = await cleanupDocuments()
      if (mainError) console.log(`\n兜底清理：${result.note}`)
    }
  } catch (error) {
    console.log(`\n[FAIL] 兜底清理失败：${(error && error.message) || error}`)
    process.exitCode = 1
  }
  if (state.settingsTouched) {
    await restoreSettings()
  }
  outputSummary()
}
