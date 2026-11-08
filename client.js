window.__ModuleLoader__.load({
  id: '@yogemow/dsh-siyuan',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // ─────────────────────────────────────────────────────────────
    // 主题 token：只使用宿主的 --dsw-alias-*，不写全局 CSS、不碰 body
    // ─────────────────────────────────────────────────────────────
    const T = {
      bg: 'var(--dsw-alias-bg-base)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      layer3: 'var(--dsw-alias-bg-layer-3)',
      border1: 'var(--dsw-alias-border-l1)',
      border2: 'var(--dsw-alias-border-l2)',
      border3: 'var(--dsw-alias-border-l3)',
      text: 'var(--dsw-alias-label-primary)',
      sub: 'var(--dsw-alias-label-secondary)',
      dim: 'var(--dsw-alias-label-tertiary)',
      brand: 'var(--dsw-alias-brand-primary)',
      onBrand: 'var(--dsw-alias-label-primary-foreground)',
      hover: 'var(--dsw-alias-interactive-bg-hover)',
      active: 'var(--dsw-alias-interactive-bg-active)',
      ok: 'var(--dsw-alias-state-success-primary)',
      err: 'var(--dsw-alias-state-error-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)'
    }

    const API = '/siyuan'
    const GHOST = 'var(--dsw-alias-label-tertiary)'

    // ─────────────────────────────────────────────────────────────
    // 纯函数工具
    // ─────────────────────────────────────────────────────────────
    function textOf(value) {
      return String(value == null ? '' : value)
    }

    function messageOf(error) {
      if (error == null) return '未知错误'
      if (typeof error === 'string') return error
      if (typeof error.message === 'string' && error.message) return error.message
      return String(error)
    }

    function stripTags(value) {
      return textOf(value)
        .replace(/<[^>]*>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
    }

    function fmtTime(value) {
      const s = textOf(value).trim()
      if (!/^\d{14}$/.test(s)) return s
      return (
        s.slice(0, 4) +
        '-' +
        s.slice(4, 6) +
        '-' +
        s.slice(6, 8) +
        ' ' +
        s.slice(8, 10) +
        ':' +
        s.slice(10, 12)
      )
    }

    /** 一行可读的中文失败提示，始终带 code。 */
    function failText(fail) {
      const code = textOf(fail && fail.code) || 'SIYUAN_API_ERROR'
      const message = textOf(fail && fail.message) || '操作未完成'
      return message + '（' + code + '）'
    }

    function pickFail(result) {
      return {
        code: textOf(result && result.code) || 'SIYUAN_API_ERROR',
        message: textOf(result && result.message) || '操作未完成'
      }
    }

    // ─────────────────────────────────────────────────────────────
    // HTTP：全部相对同源路径；写操作带 x-dsh-siyuan 头；绝不抛异常
    // ─────────────────────────────────────────────────────────────
    async function request(path, init) {
      let res
      try {
        res = await fetch(API + path, init || undefined)
      } catch (error) {
        const aborted = !!(error && error.name === 'AbortError')
        return {
          ok: false,
          code: aborted ? 'ABORTED' : 'NETWORK_ERROR',
          message: aborted ? '请求已取消' : '无法访问 Harness 路由（' + messageOf(error) + '）'
        }
      }
      let data = null
      try {
        data = await res.json()
      } catch (error) {
        data = null
      }
      if (data && typeof data === 'object') return data
      return {
        ok: false,
        code: 'SIYUAN_BAD_RESPONSE',
        message: '响应不是有效的 JSON（HTTP ' + res.status + '）'
      }
    }

    function getJSON(path, signal) {
      return request(path, signal ? { signal: signal } : undefined)
    }

    function postJSON(path, body, signal) {
      const init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-dsh-siyuan': '1' },
        body: JSON.stringify(body || {})
      }
      if (signal) init.signal = signal
      return request(path, init)
    }

    function newAbort() {
      return typeof AbortController === 'function' ? new AbortController() : null
    }

    // ─────────────────────────────────────────────────────────────
    // 通用 hooks：卸载后不再 setState；离开时 abort 所有在途请求
    // ─────────────────────────────────────────────────────────────
    function useAlive() {
      const ref = React.useRef(true)
      React.useEffect(function () {
        ref.current = true
        return function () {
          ref.current = false
        }
      }, [])
      return ref
    }

    function useRequests() {
      const ref = React.useRef(null)
      if (ref.current === null) ref.current = new Set()
      React.useEffect(function () {
        const bag = ref.current
        return function () {
          for (const controller of bag) {
            try {
              controller.abort()
            } catch (error) {
              /* 忽略 */
            }
          }
          bag.clear()
        }
      }, [])
      return React.useCallback(function () {
        const controller = newAbort()
        if (controller !== null) ref.current.add(controller)
        return controller
      }, [])
    }

    function signalOf(controller) {
      return controller === null ? null : controller.signal
    }

    function useHover() {
      const [hover, setHover] = React.useState(false)
      const on = React.useCallback(function () {
        setHover(true)
      }, [])
      const off = React.useCallback(function () {
        setHover(false)
      }, [])
      return [hover, on, off]
    }

    // ─────────────────────────────────────────────────────────────
    // 基础视觉组件
    // ─────────────────────────────────────────────────────────────
    function Icon({ name, size }) {
      const s = typeof size === 'number' && size > 0 ? size : 16
      const common = {
        viewBox: '0 0 24 24',
        width: s,
        height: s,
        'aria-hidden': true,
        style: { display: 'block' }
      }
      if (name === 'refresh') {
        return h(
          'svg',
          common,
          h('path', {
            d: 'M20 12a8 8 0 1 1-2.9-6.2M20 4.5V9h-4.5',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.7,
            strokeLinecap: 'round',
            strokeLinejoin: 'round'
          })
        )
      }
      if (name === 'settings') {
        return h(
          'svg',
          common,
          h('circle', { cx: 12, cy: 12, r: 3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }),
          h('path', {
            d: 'M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M18.5 5.5l-1.9 1.9M7.4 16.6l-1.9 1.9',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round'
          })
        )
      }
      if (name === 'back') {
        return h(
          'svg',
          common,
          h('path', {
            d: 'M14.5 5.5L8 12l6.5 6.5',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round'
          })
        )
      }
      if (name === 'bookmark') {
        return h(
          'svg',
          common,
          h('path', {
            d: 'M6.5 4.5h9A2.5 2.5 0 0 1 18 7v13l-6-3.8L6 20V7a2.5 2.5 0 0 1 .5-2.5z',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.5,
            strokeLinejoin: 'round'
          })
        )
      }
      // 侧栏图标：一本带书脊的笔记
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: s,
          height: s,
          'aria-hidden': true,
          style: { display: 'block' }
        },
        h('path', {
          d: 'M7 3.5h9.5A2.5 2.5 0 0 1 19 6v14H9.5A2.5 2.5 0 0 1 7 17.5z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinejoin: 'round'
        }),
        h('path', {
          d: 'M7 17.5A2.5 2.5 0 0 1 9.5 15H19',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round'
        }),
        h('path', {
          d: 'M10.5 8h5M10.5 11.2h4',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round'
        })
      )
    }

    function SiyuanIcon(props) {
      const size = props && typeof props.size === 'number' && props.size > 0 ? props.size : 20
      const active = !!(props && props.active)
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            color: 'currentColor',
            opacity: active ? 1 : 0.85
          }
        },
        h(Icon, { name: 'note', size: size })
      )
    }

    function GhostButton(props) {
      const hover = useHover()
      const primary = props.kind === 'primary'
      const danger = props.kind === 'danger'
      const disabled = !!props.disabled
      return h(
        'button',
        {
          type: 'button',
          disabled: disabled,
          title: props.title,
          onClick: disabled ? undefined : props.onClick,
          onMouseEnter: hover[1],
          onMouseLeave: hover[2],
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            boxSizing: 'border-box',
            height: props.small ? 24 : 28,
            padding: props.iconOnly ? 0 : props.small ? '0 8px' : '0 10px',
            width: props.iconOnly ? (props.small ? 24 : 28) : undefined,
            flex: 'none',
            borderRadius: 8,
            border: '1px solid ' + (primary ? T.brand : danger ? T.err : T.border2),
            background: primary ? T.brand : disabled ? 'transparent' : hover[0] ? T.hover : 'transparent',
            color: primary ? T.onBrand : danger ? T.err : T.text,
            font: 'inherit',
            fontSize: 13,
            lineHeight: '20px',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            whiteSpace: 'nowrap'
          }
        },
        props.children
      )
    }

    function FailLine(props) {
      const fail = props.fail
      if (!fail) return null
      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid ' + T.border1,
            background: T.layer2,
            color: T.err,
            fontSize: 12,
            lineHeight: '18px',
            wordBreak: 'break-word'
          }
        },
        h('span', { style: { flex: '1 1 auto', minWidth: 0 } }, textOf(props.prefix) + failText(fail)),
        props.onRetry
          ? h(
              GhostButton,
              { small: true, onClick: props.onRetry, title: '重试' },
              '重试'
            )
          : null
      )
    }

    function Notice(props) {
      const note = props.notice
      if (!note) return null
      const tone = note.tone === 'err' ? T.err : note.tone === 'ok' ? T.ok : T.sub
      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 10px',
            borderRadius: 8,
            background: T.layer2,
            color: tone,
            fontSize: 12,
            lineHeight: '18px',
            wordBreak: 'break-word'
          }
        },
        h('span', { style: { flex: '1 1 auto', minWidth: 0 } }, textOf(note.text)),
        note.link
          ? h(
              'a',
              {
                href: note.link,
                style: { color: T.brand, fontSize: 12, flex: 'none', textDecoration: 'none' },
                title: note.link
              },
              '打开'
            )
          : null,
        note.fail
          ? h('span', { style: { flex: '1 1 auto', minWidth: 0 } }, failText(note.fail))
          : null
      )
    }

    const inputStyle = {
      boxSizing: 'border-box',
      width: '100%',
      height: 30,
      padding: '0 8px',
      borderRadius: 8,
      border: '1px solid ' + T.border2,
      background: T.bg,
      color: T.text,
      font: 'inherit',
      fontSize: 13,
      lineHeight: '20px'
    }

    const areaStyle = {
      boxSizing: 'border-box',
      width: '100%',
      minHeight: 80,
      padding: '6px 8px',
      borderRadius: 8,
      border: '1px solid ' + T.border2,
      background: T.bg,
      color: T.text,
      font: 'inherit',
      fontSize: 13,
      lineHeight: '20px',
      resize: 'vertical'
    }

    const selectStyle = {
      boxSizing: 'border-box',
      height: 30,
      padding: '0 6px',
      borderRadius: 8,
      border: '1px solid ' + T.border2,
      background: T.bg,
      color: T.text,
      font: 'inherit',
      fontSize: 13
    }

    function Field(props) {
      return h(
        'label',
        { style: { display: 'grid', gap: 5, minWidth: 0 } },
        h(
          'span',
          { style: { fontSize: 12, color: T.sub } },
          textOf(props.label),
          props.optional ? h('span', { style: { color: T.dim } }, '（可选）') : null
        ),
        props.children,
        props.hint
          ? h(
              'span',
              { style: { fontSize: 12, color: T.dim, lineHeight: '18px' } },
              textOf(props.hint)
            )
          : null
      )
    }

    function Toggle(props) {
      const on = !!props.value
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': on,
          onClick: function () {
            props.onChange(!on)
          },
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: 0,
            border: 'none',
            background: 'transparent',
            color: T.text,
            font: 'inherit',
            fontSize: 13,
            cursor: 'pointer'
          }
        },
        h(
          'span',
          {
            style: {
              position: 'relative',
              display: 'inline-block',
              width: 34,
              height: 20,
              flex: 'none',
              borderRadius: 999,
              background: on ? T.brand : T.layer3,
              border: '1px solid ' + (on ? T.brand : T.border2),
              boxSizing: 'border-box',
              transition: 'background 120ms'
            }
          },
          h('span', {
            style: {
              position: 'absolute',
              top: 2,
              left: on ? 16 : 2,
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: on ? T.onBrand : T.dim,
              transition: 'left 120ms'
            }
          })
        ),
        h('span', null, textOf(props.label))
      )
    }

    function SectionTitle(props) {
      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            fontWeight: 600,
            color: T.text
          }
        },
        h('span', null, textOf(props.children)),
        props.aside
          ? h('span', { style: { fontSize: 12, fontWeight: 400, color: T.dim } }, textOf(props.aside))
          : null
      )
    }

    function Empty(props) {
      return h(
        'div',
        {
          style: {
            padding: '24px 12px',
            textAlign: 'center',
            fontSize: 12,
            color: T.dim,
            lineHeight: '20px'
          }
        },
        textOf(props.children)
      )
    }

    // ─────────────────────────────────────────────────────────────
    // 设置表单：设置页与面板内抽屉共用同一组逻辑
    // ─────────────────────────────────────────────────────────────
    function SettingsForm(props) {
      const alive = useAlive()
      const track = useRequests()
      const [loading, setLoading] = React.useState(true)
      const [loadFail, setLoadFail] = React.useState(null)
      const [endpoint, setEndpoint] = React.useState('')
      const [token, setToken] = React.useState('')
      const [tokenConfigured, setTokenConfigured] = React.useState(false)
      const [defaultNotebook, setDefaultNotebook] = React.useState('')
      const [defaultDoc, setDefaultDoc] = React.useState('')
      const [write, setWrite] = React.useState(false)
      const [showViewTab, setShowViewTab] = React.useState(true)
      const [showComposerButton, setShowComposerButton] = React.useState(true)
      const [notebooks, setNotebooks] = React.useState([])
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState(null)

      const load = React.useCallback(
        async function () {
          const controller = track()
          setLoading(true)
          setLoadFail(null)
          const res = await getJSON('/settings', signalOf(controller))
          if (!alive.current) return
          if (!res.ok) {
            setLoading(false)
            setLoadFail(pickFail(res))
            return
          }
          const settings = res.settings && typeof res.settings === 'object' ? res.settings : {}
          setEndpoint(textOf(settings.endpoint) || 'http://127.0.0.1:6806')
          setDefaultNotebook(textOf(settings.defaultNotebook))
          setDefaultDoc(textOf(settings.defaultDoc))
          setWrite(!!settings.write)
          setShowViewTab(settings.showViewTab !== false)
          setShowComposerButton(settings.showComposerButton !== false)
          setTokenConfigured(!!res.tokenConfigured)
          const list = await getJSON('/notebooks', signalOf(controller))
          if (!alive.current) return
          setLoading(false)
          if (list.ok && Array.isArray(list.notebooks)) setNotebooks(list.notebooks)
        },
        [alive, track]
      )

      React.useEffect(
        function () {
          load()
        },
        [load]
      )

      const save = React.useCallback(
        async function () {
          const controller = track()
          setBusy('save')
          setNotice(null)
          const body = {
            endpoint: endpoint.trim(),
            defaultNotebook: defaultNotebook,
            defaultDoc: defaultDoc.trim(),
            write: !!write,
            showViewTab: !!showViewTab,
            showComposerButton: !!showComposerButton
          }
          if (token.trim()) body.token = token.trim()
          const res = await postJSON('/settings', body, signalOf(controller))
          if (!alive.current) return
          setBusy('')
          if (!res.ok) {
            setNotice({ tone: 'err', fail: pickFail(res) })
            return
          }
          const settings = res.settings && typeof res.settings === 'object' ? res.settings : {}
          setEndpoint(textOf(settings.endpoint))
          setDefaultNotebook(textOf(settings.defaultNotebook))
          setDefaultDoc(textOf(settings.defaultDoc))
          setWrite(!!settings.write)
          setShowViewTab(settings.showViewTab !== false)
          setShowComposerButton(settings.showComposerButton !== false)
          setTokenConfigured(!!res.tokenConfigured)
          setToken('')
          // 两个入口开关就地生效（不用刷新）
          applySettingsFlags(settings)
          setShowViewTab(uiFlags.showViewTab)
          setShowComposerButton(uiFlags.showComposerButton)
          setNotice({
            tone: 'ok',
            text: uiFlags.showViewTab
              ? '设置已保存；对话区页签与输入框按钮已按开关更新。'
              : '设置已保存；已隐藏对话区页签，切回「对话」即可。'
          })
          if (typeof props.onSaved === 'function') props.onSaved(settings)
        },
        [alive, track, endpoint, defaultNotebook, defaultDoc, write, showViewTab, showComposerButton, token, props]
      )

      const test = React.useCallback(
        async function () {
          const controller = track()
          setBusy('test')
          setNotice(null)
          const body = { endpoint: endpoint.trim() }
          if (token.trim()) body.token = token.trim()
          const res = await postJSON('/test', body, signalOf(controller))
          if (!alive.current) return
          setBusy('')
          if (!res.ok) {
            setNotice({ tone: 'err', fail: pickFail(res) })
            return
          }
          setNotice({
            tone: 'ok',
            text:
              '连接正常 · 思源 ' + textOf(res.version || '版本未知') + ' · 笔记本 ' + textOf(res.notebooks) + ' 个'
          })
        },
        [alive, track, endpoint, token]
      )

      const notebookOptions = [
        h('option', { key: '__none', value: '' }, '跟随思源默认（不指定）')
      ].concat(
        notebooks.map(function (item) {
          const id = textOf(item && item.id)
          return h(
            'option',
            { key: 'nb-' + id, value: id },
            textOf(item && item.name) + (item && item.closed ? '（已关闭）' : '')
          )
        })
      )

      return h(
        'div',
        { style: { display: 'grid', gap: 14, minWidth: 0 } },
        loading
          ? h(Empty, null, '读取设置…')
          : h(
              React.Fragment,
              null,
              loadFail
                ? h(FailLine, { fail: loadFail, prefix: '读取设置失败：', onRetry: load })
                : null,
              h(Field, {
                label: '端点',
                hint: '思源「设置 → 关于」里的 API 地址，默认 http://127.0.0.1:6806'
              }, h('input', {
                type: 'text',
                value: endpoint,
                placeholder: 'http://127.0.0.1:6806',
                spellCheck: false,
                onChange: function (event) {
                  setEndpoint(event.target.value)
                },
                style: inputStyle
              })),
              h(Field, {
                label: 'Token',
                optional: true,
                hint: tokenConfigured
                  ? '已配置。Token 只写不读，留空表示不修改。'
                  : '未配置。思源「设置 → 关于 → API token」里复制。'
              }, h('input', {
                type: 'password',
                value: token,
                placeholder: tokenConfigured ? '已配置，留空不修改' : '粘贴 API token',
                spellCheck: false,
                autoComplete: 'off',
                onChange: function (event) {
                  setToken(event.target.value)
                },
                style: inputStyle
              })),
              h(Field, {
                label: '默认笔记本',
                hint: 'Agent 新建文档时优先写进这个笔记本。'
              }, h('select', {
                value: defaultNotebook,
                onChange: function (event) {
                  setDefaultNotebook(event.target.value)
                },
                style: selectStyle
              }, notebookOptions)),
              h(Field, {
                label: '默认打开文档',
                optional: true,
                hint: '填 22 位文档 id 或精确 /完整/路径（如 /领域知识库/AI/某篇）；留空不自动打开。'
              }, h('input', {
                type: 'text',
                value: defaultDoc,
                placeholder: '文档 id 或 /完整/路径',
                spellCheck: false,
                onChange: function (event) {
                  setDefaultDoc(event.target.value)
                },
                style: Object.assign({}, inputStyle, { fontFamily: 'ui-monospace, Consolas, monospace' })
              })),
              h('div', {
                style: {
                  display: 'grid',
                  gap: 4,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid ' + T.border1,
                  background: T.layer2
                }
              },
                h(Toggle, {
                  value: write,
                  label: '允许 Agent 写入笔记（新建、追加、存入回答）',
                  onChange: setWrite
                }),
                h('div', { style: { fontSize: 12, color: T.dim, lineHeight: '18px' } },
                  '关闭时所有写操作都会被拒绝并返回 SIYUAN_WRITE_DISABLED。'
                )
              ),
              h('div', {
                style: {
                  display: 'grid',
                  gap: 8,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid ' + T.border1,
                  background: T.layer2
                }
              },
                h('div', { style: { fontSize: 12, color: T.sub } }, '入口显示'),
                h(Toggle, {
                  value: showViewTab,
                  label: '显示对话区「思源笔记」页签',
                  onChange: setShowViewTab
                }),
                h(Toggle, {
                  value: showComposerButton,
                  label: '显示输入框「思源」按钮',
                  onChange: setShowComposerButton
                }),
                h('div', { style: { fontSize: 12, color: T.dim, lineHeight: '18px' } },
                  '只影响这两个入口；左栏「思源笔记」面板与右栏标签不受影响，保存后立即生效。'
                )
              ),
              h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
                h(GhostButton, {
                  onClick: test,
                  disabled: busy !== '',
                  title: '用当前填写值探活，不保存'
                }, busy === 'test' ? '测试中…' : '测试连接'),
                h(GhostButton, {
                  kind: 'primary',
                  onClick: save,
                  disabled: busy !== ''
                }, busy === 'save' ? '保存中…' : '保存'),
                h(GhostButton, {
                  onClick: load,
                  disabled: busy !== ''
                }, '重新读取')
              ),
              h(Notice, { notice: notice })
            )
      )
    }

    function SettingsPage() {
      return h(
        'div',
        { style: { display: 'grid', gap: 14, maxWidth: 720, paddingBottom: 24, minWidth: 0 } },
        h('p', {
          style: { margin: 0, fontSize: 13, lineHeight: '20px', color: T.sub }
        }, '把本机或局域网里的思源笔记接入 DeepSeek Harness：Agent 可以搜索与阅读笔记，写入还需要单独打开开关并逐次确认。'),
        h(
          'section',
          {
            style: {
              display: 'grid',
              gap: 14,
              padding: '14px 16px',
              border: '1px solid ' + T.border1,
              borderRadius: 10,
              background: T.layer1,
              minWidth: 0
            }
          },
          h(SectionTitle, { aside: '保存后对新会话生效' }, '连接'),
          h(SettingsForm, null)
        ),
        h('p', {
          style: { margin: 0, fontSize: 12, lineHeight: '18px', color: T.dim }
        }, 'Token 只写不读，永远不会下发到浏览器；前端所有请求都走 Harness 的同源 /siyuan 路由。')
      )
    }

    // ─────────────────────────────────────────────────────────────
    // 共享「当前笔记」：左栏 / 右栏订阅同一份模块级状态（不落盘）
    // ─────────────────────────────────────────────────────────────
    const noteState = { note: null, listeners: new Set() }

    function getCurrentNote() {
      return noteState.note
    }

    function sameNote(a, b) {
      if (a === null || b === null) return a === b
      return a.id === b.id && a.title === b.title && a.hpath === b.hpath
    }

    function setCurrentNote(note) {
      const next =
        note && note.id
          ? {
              id: textOf(note.id),
              title: textOf(note.title) || textOf(note.name),
              hpath: textOf(note.hpath)
            }
          : null
      if (sameNote(noteState.note, next)) return
      noteState.note = next
      const listeners = Array.from(noteState.listeners)
      for (const listener of listeners) {
        try {
          listener(next)
        } catch (error) {
          /* 单个订阅者异常不影响其它订阅者 */
        }
      }
    }

    function subscribeCurrentNote(listener) {
      noteState.listeners.add(listener)
      return function () {
        noteState.listeners.delete(listener)
      }
    }

    function useCurrentNote() {
      const [note, setNote] = React.useState(getCurrentNote())
      React.useEffect(function () {
        setNote(getCurrentNote())
        return subscribeCurrentNote(setNote)
      }, [])
      return note
    }

    // ─────────────────────────────────────────────────────────────
    // 同源 API 小封装：左右两栏共用
    // ─────────────────────────────────────────────────────────────
    function apiTree(notebook, depth, refresh, signal) {
      let path = '/tree?depth=' + encodeURIComponent(textOf(depth || 8))
      if (notebook) path += '&notebook=' + encodeURIComponent(notebook)
      if (refresh) path += '&refresh=1'
      return getJSON(path, signal)
    }

    /** 懒加载某篇文档的直接子文档（/tree 的 depth 到顶后逐层展开）。 */
    function apiTreeChildren(notebook, id, signal) {
      let path = '/tree/children?id=' + encodeURIComponent(textOf(id))
      if (notebook) path += '&notebook=' + encodeURIComponent(notebook)
      return getJSON(path, signal)
    }

    function apiDoc(id, signal) {
      return getJSON('/doc?id=' + encodeURIComponent(textOf(id)), signal)
    }

    /** 正文分页：offset 是「已读行数」，页大小由 Host 决定（默认 1500 行）。 */
    function apiDocPage(id, offset, signal) {
      let path = '/doc?id=' + encodeURIComponent(textOf(id))
      const from = Number(offset)
      if (Number.isFinite(from) && from > 0) path += '&offset=' + encodeURIComponent(String(Math.floor(from)))
      return getJSON(path, signal)
    }

    function apiSearch(keyword, notebook, limit, signal) {
      let path = '/search?q=' + encodeURIComponent(textOf(keyword))
      if (notebook) path += '&notebook=' + encodeURIComponent(notebook)
      path += '&limit=' + encodeURIComponent(textOf(limit || 50))
      return getJSON(path, signal)
    }

    function apiOpen(id, signal) {
      return postJSON('/open', { id: textOf(id) }, signal)
    }

    function apiAppend(id, markdown, position, signal) {
      return postJSON(
        '/append',
        { id: textOf(id), markdown: textOf(markdown), position: position || 'append' },
        signal
      )
    }

    function apiCreate(body, signal) {
      return postJSON('/create', body || {}, signal)
    }

    function copyText(value) {
      return new Promise(function (resolve) {
        try {
          if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(textOf(value)).then(
              function () {
                resolve(true)
              },
              function () {
                resolve(false)
              }
            )
            return
          }
          resolve(false)
        } catch (error) {
          resolve(false)
        }
      })
    }

    /** 可被 abort 打断的等待：卸载/取消时清掉定时器。 */
    function wait(ms, signal) {
      return new Promise(function (resolve) {
        const timer = setTimeout(resolve, ms)
        if (signal && typeof signal.addEventListener === 'function') {
          signal.addEventListener(
            'abort',
            function () {
              clearTimeout(timer)
              resolve()
            },
            { once: true }
          )
        }
      })
    }

    /** 服务端可能把 defaultNotebook 存成名称，下拉用 id 时按名称再匹配一次。 */
    function pickNotebookId(notebooks, configured) {
      const list = Array.isArray(notebooks) ? notebooks : []
      const wanted = textOf(configured)
      if (!wanted) return list.length ? textOf(list[0].id) : ''
      const byId = list.filter(function (item) {
        return textOf(item && item.id) === wanted
      })[0]
      if (byId) return textOf(byId.id)
      const byName = list.filter(function (item) {
        return textOf(item && item.name) === wanted
      })[0]
      if (byName) return textOf(byName.id)
      return list.length ? textOf(list[0].id) : wanted
    }

    // ─────────────────────────────────────────────────────────────
    // 右栏 tab：只有 sidebarRightTabs 服务存在时才注册（否则静默降级）
    // ─────────────────────────────────────────────────────────────
    const SIDEBAR_TAB_ID = 'dsh-siyuan/note'
    const SIDEBAR_TAB_KIND = 'dsh-siyuan-note'
    const TREE_DEPTH = 8

    /** 优先用 ctx.inject(['sidebarRight']) 捕获的服务，其次回落到 ctx.get。 */
    let sidebarRightRef = null

    /** 排障：把右栏打开失败的现场发回 Host（storages/siyuan/diag.log）。 */
    function reportDiag(payload) {
      try {
        fetch('/siyuan/diag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-dsh-siyuan': '1' },
          body: JSON.stringify(payload)
        }).catch(function () {})
      } catch (error) {
        /* 排障失败不影响主流程 */
      }
    }

    function openRightSidebarTab() {
      const diag = { where: 'openRightSidebarTab', hasRef: Boolean(sidebarRightRef), errors: [] }
      let expanded = false
      // 1) 先展开右栏：有的宿主版本 openTab 只开店不展开
      try {
        const layout = hostCtx && typeof hostCtx.get === 'function' ? hostCtx.get('layout') : null
        if (layout && typeof layout.openRightbar === 'function') {
          layout.openRightbar(true, false)
          expanded = true
          diag.expanded = true
        }
      } catch (error) {
        diag.errors.push('layout.openRightbar: ' + String((error && error.message) || error))
      }
      // 2) 打开/聚焦「思源笔记」标签
      const candidates = [['inject', sidebarRightRef]]
      try {
        if (hostCtx && typeof hostCtx.get === 'function') {
          candidates.push(['ctx.get', hostCtx.get('sidebarRight')])
        }
      } catch (error) {
        diag.errors.push('ctx.get(sidebarRight): ' + String((error && error.message) || error))
      }
      for (const pair of candidates) {
        const source = pair[0]
        const service = pair[1]
        try {
          if (service && typeof service.openTab === 'function') {
            service.openTab.call(service, SIDEBAR_TAB_KIND)
            return true
          }
          diag.errors.push(source + ': service missing')
        } catch (error) {
          diag.errors.push(source + ': ' + String((error && error.message) || error))
        }
      }
      if (expanded) {
        // 右栏已展开（引导页里能看到「思源笔记」卡片），不再退回内联预览
        diag.fallback = 'panel-expanded-without-tab'
        reportDiag(diag)
        return true
      }
      reportDiag(diag)
      return false
    }

    // ─────────────────────────────────────────────────────────────
    // 每个 notebook 记住展开/选中/滚动位置（模块级内存，不落盘）
    // surface = 'left' | 'right'，左右两栏互不干扰
    // ─────────────────────────────────────────────────────────────
    const treeMemory = new Map()

    function memoryKey(surface, notebook) {
      return textOf(surface) + ':' + textOf(notebook)
    }

    function readViewMemory(surface, notebook) {
      const stored = treeMemory.get(memoryKey(surface, notebook))
      if (!stored) return { expandedIds: new Set(), selectedId: '', scrollTop: 0 }
      return {
        expandedIds: stored.expandedIds instanceof Set ? new Set(stored.expandedIds) : new Set(),
        selectedId: textOf(stored.selectedId),
        scrollTop: Number(stored.scrollTop) || 0
      }
    }

    function writeViewMemory(surface, notebook, patch) {
      const key = memoryKey(surface, notebook)
      const current = treeMemory.get(key) || { expandedIds: new Set(), selectedId: '', scrollTop: 0 }
      const next = {
        expandedIds: patch && patch.expandedIds instanceof Set ? new Set(patch.expandedIds) : current.expandedIds,
        selectedId: patch && patch.selectedId !== undefined ? textOf(patch.selectedId) : current.selectedId,
        scrollTop: patch && patch.scrollTop !== undefined ? Number(patch.scrollTop) || 0 : current.scrollTop
      }
      treeMemory.set(key, next)
      return next
    }

    function clearViewMemory(surface, notebook) {
      treeMemory.delete(memoryKey(surface, notebook))
    }

    // ─────────────────────────────────────────────────────────────
    // 正文分页 & 文档树节点更新
    // ─────────────────────────────────────────────────────────────
    function docPageState(res, previous) {
      const offset = Number(res && res.offset)
      const base = Number.isFinite(offset) ? offset : Number(previous && previous.offset) || 0
      const markdown = textOf(res && res.markdown)
      const loadedLines = markdown ? markdown.split('\n').length : 0
      const total = Number(res && res.totalLines)
      return {
        nextOffset: base + loadedLines,
        totalLines: Number.isFinite(total) ? total : base + loadedLines,
        truncated: !!(res && res.truncated)
      }
    }

    function joinMarkdown(previous, next) {
      const a = textOf(previous)
      const b = textOf(next)
      if (!a) return b
      if (!b) return a
      return a + '\n' + b
    }

    function patchTreeNode(nodes, id, update) {
      if (!Array.isArray(nodes)) return nodes
      return nodes.map(function (node) {
        if (!node) return node
        if (textOf(node.id) === textOf(id)) return update(Object.assign({}, node))
        if (Array.isArray(node.children) && node.children.length) {
          const children = patchTreeNode(node.children, id, update)
          if (children !== node.children) return Object.assign({}, node, { children: children })
        }
        return node
      })
    }

    /** 收集「已展开但子节点还没加载」的节点 id（用于恢复上次展开的深层树）。 */
    function collectLazyExpanded(nodes, expandedIds, loadingIds, childFails, out) {
      const result = out || []
      if (!Array.isArray(nodes) || !(expandedIds instanceof Set)) return result
      for (const node of nodes) {
        if (!node) continue
        const id = textOf(node.id)
        const children = Array.isArray(node.children) ? node.children : []
        if (expandedIds.has(id)) {
          const loading = loadingIds instanceof Set && loadingIds.has(id)
          const failed = childFails && childFails[id]
          if (node.hasMore && children.length === 0 && !loading && !failed) {
            result.push(id)
            continue
          }
          if (children.length) collectLazyExpanded(children, expandedIds, loadingIds, childFails, result)
        }
      }
      return result
    }

    // ─────────────────────────────────────────────────────────────
    // 文档树（按 /siyuan/tree 数组顺序原样渲染）
    // ─────────────────────────────────────────────────────────────
    function TreeNodeRow(props) {
      const node = props.node || {}
      const id = textOf(node.id)
      const children = Array.isArray(node.children) ? node.children : []
      const hasChildren = children.length > 0
      const hasMore = !!node.hasMore
      const open = !!props.open
      const selected = textOf(props.selectedId) === id
      const loading = props.loadingIds instanceof Set && props.loadingIds.has(id)
      const childFail = props.childFails ? props.childFails[id] : null
      const hover = useHover()
      const count = Number(node.subFileCount)
      const canExpand = hasChildren || hasMore

      const caret = loading
        ? h(
            'span',
            {
              style: {
                width: 14,
                height: 16,
                flex: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: T.dim,
                fontSize: 12
              },
              title: '加载子文档…'
            },
            '…'
          )
        : canExpand
          ? h(
              'span',
              {
                role: 'button',
                tabIndex: 0,
                'aria-label': open ? '收起子文档' : '展开子文档',
                'aria-expanded': open ? 'true' : 'false',
                onClick: function (event) {
                  event.stopPropagation()
                  if (hasChildren) props.onToggle(id)
                  else props.onLoadChildren(id)
                },
                onKeyDown: function (event) {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                    if (hasChildren) props.onToggle(id)
                    else props.onLoadChildren(id)
                  }
                },
                style: {
                  width: 14,
                  height: 16,
                  flex: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: T.dim,
                  cursor: 'pointer'
                }
              },
              h(
                'svg',
                {
                  viewBox: '0 0 16 16',
                  width: 10,
                  height: 10,
                  'aria-hidden': true,
                  style: {
                    display: 'block',
                    flex: 'none',
                    transform: open ? 'rotate(90deg)' : 'none',
                    transition: 'transform 120ms'
                  }
                },
                h('path', {
                  d: 'M6 3.5L10.5 8 6 12.5',
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 1.6,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round'
                })
              )
            )
          : h('span', { style: { width: 14, flex: 'none' } })

      return h(
        React.Fragment,
        null,
        h(
          'div',
          {
            role: 'button',
            tabIndex: 0,
            'data-siyuan-note-id': id,
            'data-selected': selected ? 'true' : undefined,
            title: textOf(node.hpath) || textOf(node.name),
            onClick: function () {
              props.onSelect(node)
            },
            onKeyDown: function (event) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                props.onSelect(node)
              }
            },
            onMouseEnter: hover[1],
            onMouseLeave: hover[2],
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 6px',
              paddingLeft: 6 + (props.depth || 0) * 12,
              borderRadius: 8,
              background: selected || hover[0] ? T.hover : 'transparent',
              color: selected ? T.text : T.sub,
              cursor: 'pointer',
              minWidth: 0,
              fontSize: 12,
              lineHeight: '18px'
            }
          },
          caret,
          h(
            'span',
            {
              style: {
                flex: '1 1 auto',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }
            },
            textOf(node.name) || '（无标题）'
          ),
          !hasChildren && hasMore
            ? h(
                'span',
                { style: { flex: 'none', fontSize: 12, color: T.dim }, title: '还有子文档，点左侧箭头加载' },
                '…'
              )
            : null,
          Number.isFinite(count) && count > 0
            ? h('span', { style: { flex: 'none', fontSize: 12, color: T.dim }, title: '子文档数' }, String(count))
            : null
        ),
        hasChildren && open
          ? h(
              'div',
              null,
              children.map(function (child) {
                const childId = textOf(child && child.id)
                return h(TreeNodeRow, {
                  key: childId,
                  node: child,
                  depth: (props.depth || 0) + 1,
                  open: props.expandedIds.has(childId),
                  expandedIds: props.expandedIds,
                  onToggle: props.onToggle,
                  onLoadChildren: props.onLoadChildren,
                  onSelect: props.onSelect,
                  selectedId: props.selectedId,
                  loadingIds: props.loadingIds,
                  childFails: props.childFails
                })
              })
            )
          : null,
        childFail
          ? h(
              'div',
              { style: { paddingLeft: 6 + ((props.depth || 0) + 1) * 12, paddingRight: 6, paddingBottom: 2 } },
              h(FailLine, {
                fail: childFail,
                prefix: '读取子文档失败：',
                onRetry: function () {
                  props.onLoadChildren(id)
                }
              })
            )
          : null
      )
    }

    function DocTree(props) {
      const nodes = Array.isArray(props.nodes) ? props.nodes : []
      if (!nodes.length) return null
      const expandedIds = props.expandedIds instanceof Set ? props.expandedIds : new Set()
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 } },
        nodes.map(function (node) {
          const id = textOf(node && node.id)
          return h(TreeNodeRow, {
            key: id,
            node: node,
            depth: 0,
            open: expandedIds.has(id),
            expandedIds: expandedIds,
            onToggle: props.onToggle,
            onLoadChildren: props.onLoadChildren,
            onSelect: props.onSelect,
            selectedId: props.selectedId,
            loadingIds: props.loadingIds,
            childFails: props.childFails
          })
        })
      )
    }

    // ─────────────────────────────────────────────────────────────
    // 主面板
    // ─────────────────────────────────────────────────────────────
    function DocPreview(props) {
      const doc = props.doc
      return h(
        'div',
        { style: { display: 'grid', gap: 10, minWidth: 0 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h(GhostButton, {
            iconOnly: true,
            small: true,
            title: '返回列表',
            onClick: props.onBack
          }, h(Icon, { name: 'back', size: 15 })),
          h('div', { style: { fontSize: 12, color: T.dim, minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            textOf(doc.hpath) || '/')
        ),
        h(
          'div',
          { style: { display: 'grid', gap: 4, minWidth: 0 } },
          h('div', { style: { fontSize: 14, fontWeight: 600, lineHeight: '22px', wordBreak: 'break-word' } },
            textOf(doc.title) || '（无标题）'),
          doc.truncated
            ? h('div', { style: { fontSize: 12, color: T.warn } }, '内容较长，已截断显示。')
            : null
        ),
        h(
          'div',
          {
            style: {
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 13,
              lineHeight: '21px',
              color: T.text,
              fontFamily: 'ui-monospace, Consolas, monospace',
              padding: '10px 12px',
              borderRadius: 8,
              background: T.layer2,
              border: '1px solid ' + T.border1,
              maxHeight: '46vh',
              overflow: 'auto'
            }
          },
          textOf(doc.markdown) || '（空文档）'
        )
      )
    }

    function MainPanel(props) {
      // surface 决定树位置记忆的命名空间：左栏 'left'、对话区视图 'middle'
      const surface = textOf(props && props.surface) || 'left'
      const alive = useAlive()
      const track = useRequests()

      const [status, setStatus] = React.useState(null)
      const [statusLoading, setStatusLoading] = React.useState(true)
      const [statusFail, setStatusFail] = React.useState(null)

      const [settingsOpen, setSettingsOpen] = React.useState(false)

      const [notebook, setNotebook] = React.useState('')
      const [q, setQ] = React.useState('')
      const [tree, setTree] = React.useState({ loading: false, fail: null, nodes: [] })
      const [expandedIds, setExpandedIds] = React.useState(function () {
        return new Set()
      })
      const [selectedId, setSelectedId] = React.useState('')
      const [search, setSearch] = React.useState(null)
      const [loadingIds, setLoadingIds] = React.useState(function () {
        return new Set()
      })
      const [childFails, setChildFails] = React.useState({})

      const scrollRef = React.useRef(null)
      const pendingRestoreRef = React.useRef(null)
      const autoDefaultRef = React.useRef(false)

      const [view, setView] = React.useState('list')
      const [doc, setDoc] = React.useState(null)
      const [docPage, setDocPage] = React.useState({ nextOffset: 0, totalLines: 0, truncated: false })
      const [docLoading, setDocLoading] = React.useState(false)
      const [docFail, setDocFail] = React.useState(null)
      const [docMoreBusy, setDocMoreBusy] = React.useState(false)
      const [docMoreFail, setDocMoreFail] = React.useState(null)

      const [appendOpen, setAppendOpen] = React.useState(false)
      const [appendText, setAppendText] = React.useState('')
      const [appendBusy, setAppendBusy] = React.useState(false)
      const [appendFail, setAppendFail] = React.useState(null)

      const [newTitle, setNewTitle] = React.useState('')
      const [newBody, setNewBody] = React.useState('')
      const [newNotebook, setNewNotebook] = React.useState('')
      const [createBusy, setCreateBusy] = React.useState(false)
      const [createFail, setCreateFail] = React.useState(null)

      const [notice, setNotice] = React.useState(null)

      const refreshStatus = React.useCallback(
        async function () {
          const controller = track()
          setStatusLoading(true)
          setStatusFail(null)
          const res = await getJSON('/status', signalOf(controller))
          if (!alive.current) return
          setStatusLoading(false)
          if (!res.ok) {
            setStatus(null)
            setStatusFail(pickFail(res))
            return
          }
          setStatus(res)
          const settings = res.settings && typeof res.settings === 'object' ? res.settings : {}
          setNewNotebook(function (current) {
            if (current) return current
            return textOf(settings.defaultNotebook)
          })
          setNotebook(function (current) {
            if (current) return current
            return pickNotebookId(res.notebooks, settings.defaultNotebook)
          })
        },
        [alive, track]
      )

      const loadTree = React.useCallback(
        async function (refresh) {
          const controller = track()
          setTree(function (current) {
            return { loading: true, fail: null, nodes: current.nodes }
          })
          const res = await apiTree(notebook, TREE_DEPTH, refresh, signalOf(controller))
          if (!alive.current) return
          if (!res.ok) {
            setTree({ loading: false, fail: pickFail(res), nodes: [] })
            return
          }
          setTree({
            loading: false,
            fail: null,
            nodes: Array.isArray(res.nodes) ? res.nodes : []
          })
        },
        [alive, track, notebook]
      )

      const runSearch = React.useCallback(
        async function (keyword) {
          const text = textOf(keyword).trim()
          if (!text) {
            setSearch(null)
            return
          }
          const controller = track()
          setSearch({ keyword: text, loading: true, fail: null, items: [] })
          const res = await apiSearch(text, notebook, 50, signalOf(controller))
          if (!alive.current) return
          if (!res.ok) {
            setSearch({ keyword: text, loading: false, fail: pickFail(res), items: [] })
            return
          }
          setSearch({
            keyword: text,
            loading: false,
            fail: null,
            items: Array.isArray(res.items) ? res.items : []
          })
        },
        [alive, track, notebook]
      )

      React.useEffect(
        function () {
          refreshStatus()
        },
        [refreshStatus]
      )

      React.useEffect(
        function () {
          loadTree(false)
        },
        [loadTree]
      )

      // notebook 切换（含首次）→ 从内存恢复展开/选中/滚动位置
      React.useEffect(
        function () {
          const memory = readViewMemory(surface, notebook)
          setExpandedIds(memory.expandedIds)
          setSelectedId(memory.selectedId)
          setLoadingIds(new Set())
          setChildFails({})
          pendingRestoreRef.current = { scrollTop: memory.scrollTop, selectedId: memory.selectedId }
        },
        [notebook]
      )

      // 展开/选中变化写回内存
      React.useEffect(
        function () {
          if (!notebook) return
          writeViewMemory(surface, notebook, { expandedIds: expandedIds })
        },
        [expandedIds, notebook]
      )
      React.useEffect(
        function () {
          if (!notebook) return
          writeViewMemory(surface, notebook, { selectedId: selectedId })
        },
        [selectedId, notebook]
      )

      // 树渲染出来后再套用滚动位置（并让选中项进入视野）
      React.useEffect(
        function () {
          const pending = pendingRestoreRef.current
          if (!pending || view !== 'list') return
          const node = scrollRef.current
          if (!node) return
          pendingRestoreRef.current = null
          if (pending.scrollTop) node.scrollTop = pending.scrollTop
          if (pending.selectedId) {
            const selector = '[data-siyuan-note-id="' + pending.selectedId.replace(/["\\]/g, '') + '"]'
            const selectedNode = node.querySelector(selector)
            if (selectedNode && typeof selectedNode.scrollIntoView === 'function') {
              selectedNode.scrollIntoView({ block: 'nearest' })
            }
          }
        },
        [tree.nodes, view]
      )

      const toggleNode = React.useCallback(function (id) {
        const key = textOf(id)
        setExpandedIds(function (current) {
          const next = new Set(current)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }, [])

      /** hasMore 节点的逐层展开：拉 /tree/children 挂到该节点 children。 */
      const loadChildren = React.useCallback(
        async function (id) {
          const key = textOf(id)
          if (!key) return
          const controller = track()
          setLoadingIds(function (current) {
            const next = new Set(current)
            next.add(key)
            return next
          })
          setChildFails(function (current) {
            const next = Object.assign({}, current)
            delete next[key]
            return next
          })
          const res = await apiTreeChildren(notebook, key, signalOf(controller))
          if (!alive.current) return
          setLoadingIds(function (current) {
            const next = new Set(current)
            next.delete(key)
            return next
          })
          if (!res.ok) {
            setChildFails(function (current) {
              const next = Object.assign({}, current)
              next[key] = pickFail(res)
              return next
            })
            setExpandedIds(function (current) {
              const next = new Set(current)
              next.add(key)
              return next
            })
            return
          }
          const nodes = Array.isArray(res.nodes) ? res.nodes : []
          setTree(function (current) {
            return {
              loading: current.loading,
              fail: current.fail,
              nodes: patchTreeNode(current.nodes, key, function (node) {
                return Object.assign({}, node, { children: nodes, hasMore: false })
              })
            }
          })
          setExpandedIds(function (current) {
            const next = new Set(current)
            next.add(key)
            return next
          })
        },
        [alive, track, notebook]
      )

      // 恢复上次展开的深层树：已展开但还没挂子节点的 hasMore 节点自动补载
      React.useEffect(
        function () {
          const pending = collectLazyExpanded(tree.nodes, expandedIds, loadingIds, childFails)
          for (const id of pending) loadChildren(id)
        },
        [tree.nodes, expandedIds, loadingIds, childFails, loadChildren]
      )

      // 右栏（或其它入口）改了当前笔记时，左栏同步选中态
      const currentNote = useCurrentNote()
      React.useEffect(
        function () {
          if (currentNote && currentNote.id) setSelectedId(currentNote.id)
        },
        [currentNote]
      )

      const openDoc = React.useCallback(
        async function (id) {
          const controller = track()
          setView('doc')
          setDoc(null)
          setDocPage({ nextOffset: 0, totalLines: 0, truncated: false })
          setDocLoading(true)
          setDocFail(null)
          setDocMoreFail(null)
          setAppendOpen(false)
          setAppendText('')
          setAppendFail(null)
          let res = await apiDoc(id, signalOf(controller))
          if (!alive.current) return
          // 思源索引是异步的：新建后立刻读可能短暂 NOT_FOUND，稍等重试一次
          if (!res.ok && res.code === 'SIYUAN_NOT_FOUND') {
            await wait(600, signalOf(controller))
            if (!alive.current) return
            res = await apiDoc(id, signalOf(controller))
            if (!alive.current) return
          }
          setDocLoading(false)
          if (!res.ok) {
            setDocFail(pickFail(res))
            return
          }
          setDoc(res)
          setDocPage(docPageState(res))
        },
        [alive, track]
      )

      /** 正文被截断（默认 1500 行）时，按 offset 续读并追加。 */
      const loadMoreDoc = React.useCallback(
        async function () {
          if (!doc) return
          const controller = track()
          setDocMoreBusy(true)
          setDocMoreFail(null)
          const res = await apiDocPage(doc.id, docPage.nextOffset, signalOf(controller))
          if (!alive.current) return
          setDocMoreBusy(false)
          if (!res.ok) {
            setDocMoreFail(pickFail(res))
            return
          }
          setDoc(function (current) {
            if (!current) return current
            return Object.assign({}, current, {
              markdown: joinMarkdown(current.markdown, res.markdown),
              totalLines: typeof res.totalLines === 'number' ? res.totalLines : current.totalLines,
              truncated: !!res.truncated
            })
          })
          setDocPage(docPageState(res, docPage))
        },
        [alive, track, doc, docPage]
      )

      const backToList = React.useCallback(function () {
        setView('list')
        setDoc(null)
        setDocFail(null)
        setAppendOpen(false)
        setNotice(null)
      }, [])

      /** 选中一篇笔记：写共享状态 → 优先开右栏；右栏不可用时退回内联预览。 */
      const selectNote = React.useCallback(
        function (note, successText) {
          const id = textOf(note && (note.rootId || note.id))
          if (!id) return
          const title =
            textOf(note && (note.title || note.name)) || textOf(note && note.hpath) || id
          setSelectedId(id)
          setCurrentNote({ id: id, title: title, hpath: textOf(note && note.hpath) })
          const opened = openRightSidebarTab()
          if (successText) setNotice({ tone: 'ok', text: textOf(successText) })
          else if (opened) setNotice({ tone: 'ok', text: '已在右栏「思源笔记」中打开：' + title })
          else {
            setNotice({
              tone: 'err',
              text: '右栏没打开，已退到左侧内联预览。可点输入框旁的「思源」按钮或右上角的右栏开关重试。'
            })
          }
          if (!opened) openDoc(id)
        },
        [openDoc]
      )

      /** 解析并打开「默认文档」：失败显示一行带 code 的提示，不白屏。 */
      const openDefaultDoc = React.useCallback(
        async function (reference) {
          const ref = textOf(reference).trim()
          if (!ref) return
          const controller = track()
          const res = await apiDoc(ref, signalOf(controller))
          if (!alive.current) return
          if (!res.ok) {
            setNotice({ tone: 'err', text: '默认文档打开失败：', fail: pickFail(res) })
            return
          }
          selectNote(
            { id: textOf(res.id), title: res.title, hpath: res.hpath },
            '默认文档：' + (textOf(res.title) || textOf(res.hpath) || textOf(res.id))
          )
        },
        [alive, track, selectNote]
      )

      // 首次挂载且没有当前笔记时，自动打开 settings.defaultDoc
      React.useEffect(
        function () {
          if (autoDefaultRef.current) return
          if (!status) return
          const settings = status.settings && typeof status.settings === 'object' ? status.settings : {}
          const reference = textOf(settings.defaultDoc)
          if (getCurrentNote()) {
            autoDefaultRef.current = true
            return
          }
          if (!reference) return
          autoDefaultRef.current = true
          openDefaultDoc(reference)
        },
        [status, openDefaultDoc]
      )

      /** 回到默认：清掉本 notebook 的展开/选中/滚动记忆，折叠全部并滚到顶部。 */
      const resetView = React.useCallback(
        function () {
          clearViewMemory(surface, notebook)
          setExpandedIds(new Set())
          setSelectedId('')
          setChildFails({})
          setLoadingIds(new Set())
          const node = scrollRef.current
          if (node) node.scrollTop = 0
          const settings = status && status.settings && typeof status.settings === 'object' ? status.settings : {}
          const reference = textOf(settings.defaultDoc)
          if (reference) openDefaultDoc(reference)
          else loadTree(true)
        },
        [notebook, status, openDefaultDoc, loadTree]
      )

      const openInSiyuan = React.useCallback(
        async function () {
          if (!doc) return
          const controller = track()
          setNotice(null)
          const res = await postJSON('/open', { id: textOf(doc.id) }, signalOf(controller))
          if (!alive.current) return
          if (!res.ok) {
            setNotice({ tone: 'err', fail: pickFail(res) })
            return
          }
          const appLink = textOf(res.appLink)
          const webLink = textOf(res.webLink)
          if (appLink) {
            try {
              window.location.href = appLink
            } catch (error) {
              /* 交给下面的回退链接 */
            }
            setNotice({
              tone: 'ok',
              text: '已请求在思源中打开；若没有反应，可用浏览器打开。',
              link: webLink || undefined
            })
            return
          }
          setNotice({ tone: 'ok', text: '思源没有返回应用链接。', link: webLink || undefined })
        },
        [alive, track, doc]
      )

      const copyBlockLink = React.useCallback(
        async function () {
          if (!doc) return
          const controller = track()
          setNotice(null)
          const res = await postJSON('/open', { id: textOf(doc.id) }, signalOf(controller))
          if (!alive.current) return
          const fallback = 'siyuan://blocks/' + textOf(doc.id)
          if (!res.ok) {
            setNotice({ tone: 'err', fail: pickFail(res) })
            return
          }
          const link = textOf(res.appLink) || fallback
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(link)
              if (!alive.current) return
              setNotice({ tone: 'ok', text: '已复制块链接。' })
              return
            }
            throw new Error('浏览器不支持剪贴板')
          } catch (error) {
            if (!alive.current) return
            setNotice({
              tone: 'err',
              text: '复制失败（CLIPBOARD_UNAVAILABLE），请手动复制链接：' + link,
              link: link
            })
          }
        },
        [alive, track, doc]
      )

      const appendToDoc = React.useCallback(
        async function () {
          if (!doc) return
          const controller = track()
          setAppendBusy(true)
          setAppendFail(null)
          setNotice(null)
          const res = await postJSON(
            '/append',
            { id: textOf(doc.id), markdown: appendText, position: 'append' },
            signalOf(controller)
          )
          if (!alive.current) return
          setAppendBusy(false)
          if (!res.ok) {
            setAppendFail(pickFail(res))
            return
          }
          setAppendOpen(false)
          setAppendText('')
          setNotice({ tone: 'ok', text: '已追加到文档末尾。' })
          const again = await getJSON('/doc?id=' + encodeURIComponent(textOf(doc.id)), signalOf(controller))
          if (!alive.current) return
          if (again.ok) {
            setDoc(again)
            setDocPage(docPageState(again))
          }
        },
        [alive, track, doc, appendText]
      )

      const createDoc = React.useCallback(
        async function () {
          const controller = track()
          if (!newTitle.trim()) {
            setCreateFail({ code: 'SIYUAN_INVALID_ARGUMENT', message: '请填写文档标题' })
            return
          }
          setCreateBusy(true)
          setCreateFail(null)
          setNotice(null)
          const body = { title: newTitle.trim(), markdown: newBody }
          const targetNotebook = textOf(newNotebook) || textOf(notebook)
          if (targetNotebook) body.notebook = targetNotebook
          const res = await postJSON('/create', body, signalOf(controller))
          if (!alive.current) return
          setCreateBusy(false)
          if (!res.ok) {
            setCreateFail(pickFail(res))
            return
          }
          setNotice({ tone: 'ok', text: '已创建文档：' + textOf(res.title || newTitle.trim()) })
          setNewTitle('')
          setNewBody('')
          setView('list')
          await loadTree(true)
          if (!alive.current) return
          if (res.id) {
            selectNote(
              { id: textOf(res.id), title: textOf(res.title) || newTitle.trim(), hpath: textOf(res.hpath) },
              '已创建文档：' + (textOf(res.title) || newTitle.trim())
            )
          }
        },
        [alive, track, newTitle, newBody, newNotebook, notebook, loadTree, selectNote]
      )

      const notebooks = Array.isArray(status && status.notebooks) ? status.notebooks : []
      const version = textOf(status && status.version)
      const endpoint = textOf(status && status.endpoint)
      // Host /status 的写入开关在 settings.write 里，同时兼容旧的顶层 write
      const writeEnabled = !!(
        status &&
        ((status.settings && status.settings.write) || status.write)
      )
      const connected = !statusFail && !!status

      const statusDotColor = statusLoading ? T.warn : connected ? T.ok : T.err
      const statusText = statusLoading ? '连接中…' : connected ? '已连接' : '未连接'

      const notebookOptions = notebooks.length
        ? notebooks.map(function (item) {
            const id = textOf(item && item.id)
            return h(
              'option',
              { key: 'nb-' + id, value: id },
              textOf(item && item.name) + (item && item.closed ? '（已关闭）' : '')
            )
          })
        : [h('option', { key: '__none', value: '' }, '（没有可见笔记本）')]

      const header = h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderBottom: '1px solid ' + T.border1,
            flexWrap: 'wrap'
          }
        },
        h('span', {
          style: {
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: statusDotColor,
            flex: 'none'
          },
          title: statusText
        }),
        h('span', { style: { fontSize: 13, fontWeight: 600, color: T.text } }, '思源笔记'),
        h('span', { style: { fontSize: 12, color: T.dim } },
          statusLoading ? '连接中…' : connected ? 'v' + (version || '未知') : '未连接'),
        h(
          'span',
          {
            style: {
              fontSize: 12,
              color: T.dim,
              minWidth: 0,
              flex: '1 1 auto',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            },
            title: endpoint
          },
          connected ? endpoint : ''
        ),
        writeEnabled ? null : h('span', { style: { fontSize: 12, color: T.warn, flex: 'none' } }, '只读'),
        h(GhostButton, {
          small: true,
          onClick: function () {
            setNotice(null)
            refreshStatus()
            loadTree(true)
            if (search) runSearch(search.keyword)
          },
          disabled: statusLoading
        }, statusLoading ? '刷新中…' : '刷新'),
        h(GhostButton, {
          small: true,
          title: '折叠全部并回到顶部；若设置了默认文档则打开它',
          onClick: resetView
        }, '重置'),
        h(GhostButton, {
          iconOnly: true,
          small: true,
          title: '设置',
          onClick: function () {
            setSettingsOpen(true)
          }
        }, h(Icon, { name: 'settings', size: 15 }))
      )

      const toolbar = h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            flexWrap: 'wrap'
          }
        },
        h('select', {
          value: notebook,
          onChange: function (event) {
            setNotebook(event.target.value)
            setSearch(null)
            setQ('')
          },
          style: Object.assign({}, selectStyle, { maxWidth: 200 })
        }, notebookOptions),
        h('input', {
          type: 'search',
          value: q,
          placeholder: '搜索全部笔记，回车开始',
          spellCheck: false,
          onChange: function (event) {
            const next = event.target.value
            setQ(next)
            if (!next.trim()) setSearch(null)
          },
          onKeyDown: function (event) {
            if (event.key === 'Enter') {
              event.preventDefault()
              runSearch(q)
            }
          },
          style: Object.assign({}, inputStyle, { flex: '1 1 180px', minWidth: 120, width: 'auto' })
        }),
        h(GhostButton, {
          onClick: function () {
            if (q.trim()) runSearch(q)
            else {
              setSearch(null)
              loadTree(true)
            }
          },
          disabled: tree.loading || (search !== null && search.loading)
        }, search !== null && search.loading ? '搜索中…' : '搜索'),
        search !== null
          ? h(GhostButton, {
              onClick: function () {
                setQ('')
                setSearch(null)
              }
            }, '退出搜索')
          : null,
        h(GhostButton, {
          onClick: function () {
            setView('new')
            setCreateFail(null)
            setNotice(null)
            if (!newNotebook) setNewNotebook(textOf(notebook) || textOf((status && status.settings && status.settings.defaultNotebook) || ''))
          }
        }, '新建文档')
      )

      let body
      if (statusFail && view === 'list') {
        body = h(
          'div',
          { style: { display: 'grid', gap: 12, padding: 16 } },
          h(FailLine, { fail: statusFail, prefix: '连接思源失败：', onRetry: refreshStatus }),
          h('div', { style: { fontSize: 12, color: T.dim, lineHeight: '20px' } },
            '请确认思源已启动、端点与 Token 正确，然后打开设置检查。'),
          h('div', { style: { display: 'flex', gap: 8 } },
            h(GhostButton, {
              kind: 'primary',
              onClick: function () {
                setSettingsOpen(true)
              }
            }, '打开设置'),
            h(GhostButton, { onClick: refreshStatus }, '重试连接')
          )
        )
      } else if (view === 'new') {
        body = h(
          'div',
          { style: { display: 'grid', gap: 12, padding: 16, maxWidth: 720, minWidth: 0 } },
          h(SectionTitle, null, '新建文档'),
          h(Field, { label: '标题' }, h('input', {
            type: 'text',
            value: newTitle,
            placeholder: '文档标题',
            onChange: function (event) {
              setNewTitle(event.target.value)
            },
            style: inputStyle
          })),
          h(Field, { label: '目标笔记本' }, h('select', {
            value: newNotebook,
            onChange: function (event) {
              setNewNotebook(event.target.value)
            },
            style: selectStyle
          }, [h('option', { key: '__default', value: '' }, '使用思源/设置里的默认笔记本')].concat(
            notebooks.map(function (item) {
              const id = textOf(item && item.id)
              return h('option', { key: 'nb-' + id, value: id }, textOf(item && item.name))
            })
          ))),
          h(Field, { label: '正文（Markdown）' }, h('textarea', {
            value: newBody,
            placeholder: '# 标题\n\n正文…',
            onChange: function (event) {
              setNewBody(event.target.value)
            },
            style: Object.assign({}, areaStyle, { minHeight: 160 })
          })),
          createFail ? h(FailLine, { fail: createFail, prefix: '创建失败：' }) : null,
          h('div', { style: { display: 'flex', gap: 8 } },
            h(GhostButton, {
              kind: 'primary',
              onClick: createDoc,
              disabled: createBusy
            }, createBusy ? '创建中…' : '创建'),
            h(GhostButton, {
              onClick: function () {
                setView('list')
                setCreateFail(null)
              }
            }, '取消')
          )
        )
      } else if (view === 'doc') {
        body = h(
          'div',
          { style: { display: 'grid', gap: 12, padding: 16, minWidth: 0 } },
          docLoading ? h(Empty, null, '读取文档…') : null,
          docFail ? h(FailLine, { fail: docFail, prefix: '读取文档失败：' }) : null,
          doc ? h(DocPreview, { doc: doc, onBack: backToList }) : null,
          doc && (docPage.truncated || docPage.nextOffset > 0)
            ? h(
                'div',
                { style: { display: 'grid', gap: 8 } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                  docPage.truncated
                    ? h(GhostButton, {
                        small: true,
                        disabled: docMoreBusy,
                        onClick: loadMoreDoc
                      }, docMoreBusy
                        ? '加载中…'
                        : '加载更多（已显示 ' + docPage.nextOffset + '/' + docPage.totalLines + ' 行）')
                    : h('span', { style: { fontSize: 12, color: T.dim } },
                        '已显示全部 ' + docPage.totalLines + ' 行')
                ),
                docMoreFail
                  ? h(FailLine, { fail: docMoreFail, prefix: '加载更多失败：', onRetry: loadMoreDoc })
                  : null
              )
            : null,
          doc
            ? h(
                'div',
                { style: { display: 'grid', gap: 10, paddingTop: 4 } },
                h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
                  h(GhostButton, { onClick: openInSiyuan }, '在思源打开'),
                  h(GhostButton, { onClick: copyBlockLink }, '复制块链接'),
                  h(GhostButton, {
                    onClick: function () {
                      setAppendOpen(!appendOpen)
                      setAppendFail(null)
                    }
                  }, appendOpen ? '收起追加' : '追加内容')
                ),
                appendOpen
                  ? h(
                      'div',
                      { style: { display: 'grid', gap: 8 } },
                      h('textarea', {
                        value: appendText,
                        placeholder: '要追加到文档末尾的 Markdown 内容…',
                        onChange: function (event) {
                          setAppendText(event.target.value)
                        },
                        style: Object.assign({}, areaStyle, { minHeight: 110 })
                      }),
                      appendFail ? h(FailLine, { fail: appendFail, prefix: '追加失败：' }) : null,
                      h('div', { style: { display: 'flex', gap: 8 } },
                        h(GhostButton, {
                          kind: 'primary',
                          disabled: appendBusy || !appendText.trim(),
                          onClick: appendToDoc
                        }, appendBusy ? '追加中…' : '确认追加'),
                        h(GhostButton, {
                          onClick: function () {
                            setAppendOpen(false)
                            setAppendText('')
                            setAppendFail(null)
                          }
                        }, '取消')
                      )
                    )
                  : null,
                h(Notice, { notice: notice })
              )
            : null
        )
      } else if (search !== null) {
        body = h(
          'div',
          { style: { display: 'grid', gap: 8, padding: '4px 10px 16px', minWidth: 0 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px' } },
            h(
              'span',
              {
                style: {
                  flex: '1 1 auto',
                  minWidth: 0,
                  fontSize: 12,
                  color: T.dim,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }
              },
              '搜索结果：' + textOf(search.keyword)
            ),
            h(GhostButton, {
              small: true,
              onClick: function () {
                setQ('')
                setSearch(null)
              }
            }, '返回文档树')
          ),
          search.fail
            ? h(FailLine, {
                fail: search.fail,
                prefix: '搜索失败：',
                onRetry: function () {
                  runSearch(search.keyword)
                }
              })
            : null,
          search.loading ? h(Empty, null, '搜索中…') : null,
          !search.loading && !search.fail && search.items.length === 0
            ? h(Empty, null, '没有匹配的笔记。')
            : null,
          search.items.map(function (item, index) {
            const id = textOf(item && (item.rootId || item.id))
            const title = textOf(item && item.title) || '（无标题）'
            const hpath = textOf(item && item.hpath)
            const snippet = stripTags(item && item.snippet)
            return h(
              'div',
              {
                key: 'hit-' + (id || index),
                role: 'button',
                tabIndex: 0,
                title: hpath,
                onClick: function () {
                  selectNote(item)
                },
                onKeyDown: function (event) {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    selectNote(item)
                  }
                },
                onMouseEnter: function (event) {
                  event.currentTarget.style.background = T.hover
                },
                onMouseLeave: function (event) {
                  event.currentTarget.style.background = 'transparent'
                },
                style: {
                  display: 'grid',
                  gap: 3,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid transparent',
                  background: 'transparent',
                  cursor: 'pointer',
                  minWidth: 0
                }
              },
              h('div', {
                style: {
                  fontSize: 13,
                  fontWeight: 500,
                  color: T.text,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }
              }, title),
              h('div', {
                style: {
                  fontSize: 12,
                  color: T.dim,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }
              }, hpath || '/'),
              snippet
                ? h('div', {
                    style: {
                      fontSize: 12,
                      lineHeight: '18px',
                      color: T.sub,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden'
                    }
                  }, snippet)
                : null,
              h('div', { style: { fontSize: 12, color: T.dim } },
                (textOf(item && item.notebook) || '未知笔记本') +
                  ' · ' +
                  (fmtTime(item && item.updated) || '时间未知'))
            )
          })
        )
      } else {
        body = h(
          'div',
          { style: { display: 'grid', gap: 8, padding: '4px 10px 16px', minWidth: 0 } },
          tree.fail
            ? h(FailLine, {
                fail: tree.fail,
                prefix: '读取文档树失败：',
                onRetry: function () {
                  loadTree(true)
                }
              })
            : null,
          tree.loading && tree.nodes.length === 0 ? h(Empty, null, '读取文档树…') : null,
          !tree.loading && !tree.fail && tree.nodes.length === 0
            ? h(Empty, null, '这个笔记本里还没有文档。')
            : null,
          h(DocTree, {
            nodes: tree.nodes,
            expandedIds: expandedIds,
            selectedId: selectedId,
            loadingIds: loadingIds,
            childFails: childFails,
            onToggle: toggleNode,
            onLoadChildren: loadChildren,
            onSelect: selectNote
          })
        )
      }

      return h(
        'div',
        {
          style: {
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            minWidth: 0,
            background: T.bg,
            color: T.text
          }
        },
        header,
        statusFail && view !== 'list' ? h(FailLine, { fail: statusFail, prefix: '连接思源失败：', onRetry: refreshStatus }) : null,
        view === 'list' ? toolbar : null,
        notice && view === 'list' ? h(Notice, { notice: notice }) : null,
        h(
          'div',
          {
            ref: scrollRef,
            onScroll: function (event) {
              if (!notebook) return
              writeViewMemory(surface, notebook, { scrollTop: event.currentTarget.scrollTop })
            },
            style: {
              flex: '1 1 auto',
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden'
            }
          },
          body
        ),
        settingsOpen
          ? h(
              'div',
              {
                style: {
                  position: 'absolute',
                  inset: 0,
                  zIndex: 5,
                  display: 'flex',
                  flexDirection: 'column',
                  background: T.layer1,
                  borderLeft: '1px solid ' + T.border1
                }
              },
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 14px',
                    borderBottom: '1px solid ' + T.border1
                  }
                },
                h('span', { style: { fontSize: 13, fontWeight: 600, flex: '1 1 auto' } }, '思源笔记 · 连接设置'),
                h(GhostButton, {
                  small: true,
                  onClick: function () {
                    setSettingsOpen(false)
                  }
                }, '关闭')
              ),
              h(
                'div',
                { style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: 16 } },
                h(SettingsForm, {
                  onSaved: function () {
                    refreshStatus()
                    loadTree(true)
                    if (search) runSearch(search.keyword)
                  }
                })
              )
            )
          : null
      )
    }

    // ─────────────────────────────────────────────────────────────
    // 右栏笔记视图：窄栏，文档树 + 正文 + 追加 / 新建
    // ─────────────────────────────────────────────────────────────
    function NoteSidebarView() {
      const alive = useAlive()
      const track = useRequests()
      const note = useCurrentNote()

      const [notebooks, setNotebooks] = React.useState([])
      const [notebook, setNotebook] = React.useState('')
      const [defaultDoc, setDefaultDoc] = React.useState('')
      const [tree, setTree] = React.useState({ loading: false, fail: null, nodes: [] })
      const [expandedIds, setExpandedIds] = React.useState(function () {
        return new Set()
      })
      const [treeOpen, setTreeOpen] = React.useState(true)
      const [loadingIds, setLoadingIds] = React.useState(function () {
        return new Set()
      })
      const [childFails, setChildFails] = React.useState({})
      const treeScrollRef = React.useRef(null)
      const pendingRestoreRef = React.useRef(null)
      const autoDefaultRef = React.useRef(false)

      const [doc, setDoc] = React.useState(null)
      const [docPage, setDocPage] = React.useState({ nextOffset: 0, totalLines: 0, truncated: false })
      const [docLoading, setDocLoading] = React.useState(false)
      const [docFail, setDocFail] = React.useState(null)
      const [docMoreBusy, setDocMoreBusy] = React.useState(false)
      const [docMoreFail, setDocMoreFail] = React.useState(null)
      const [notice, setNotice] = React.useState(null)

      const [appendOpen, setAppendOpen] = React.useState(false)
      const [appendText, setAppendText] = React.useState('')
      const [appendBusy, setAppendBusy] = React.useState(false)
      const [appendFail, setAppendFail] = React.useState(null)

      const [createOpen, setCreateOpen] = React.useState(false)
      const [newTitle, setNewTitle] = React.useState('')
      const [newBody, setNewBody] = React.useState('')
      const [createBusy, setCreateBusy] = React.useState(false)
      const [createFail, setCreateFail] = React.useState(null)

      const refreshStatus = React.useCallback(
        async function () {
          const controller = track()
          const res = await getJSON('/status', signalOf(controller))
          if (!alive.current) return
          if (!res.ok) return
          const list = Array.isArray(res.notebooks) ? res.notebooks : []
          const settings = res.settings && typeof res.settings === 'object' ? res.settings : {}
          setNotebooks(list)
          setDefaultDoc(textOf(settings.defaultDoc))
          setNotebook(function (current) {
            return current || pickNotebookId(list, settings.defaultNotebook)
          })
        },
        [alive, track]
      )

      const loadTree = React.useCallback(
        async function (refresh) {
          const controller = track()
          setTree(function (current) {
            return { loading: true, fail: null, nodes: current.nodes }
          })
          const res = await apiTree(notebook, TREE_DEPTH, refresh, signalOf(controller))
          if (!alive.current) return
          if (!res.ok) {
            setTree({ loading: false, fail: pickFail(res), nodes: [] })
            return
          }
          setTree({ loading: false, fail: null, nodes: Array.isArray(res.nodes) ? res.nodes : [] })
        },
        [alive, track, notebook]
      )

      const loadDoc = React.useCallback(
        async function (id) {
          const controller = track()
          setDocLoading(true)
          setDocFail(null)
          let res = await apiDoc(id, signalOf(controller))
          if (!alive.current) return
          // 思源索引是异步的：刚创建的文档可能短暂读不到，稍等重试一次
          if (!res.ok && res.code === 'SIYUAN_NOT_FOUND') {
            await wait(600, signalOf(controller))
            if (!alive.current) return
            res = await apiDoc(id, signalOf(controller))
            if (!alive.current) return
          }
          setDocLoading(false)
          if (!res.ok) {
            setDocFail(pickFail(res))
            return
          }
          setDoc(res)
          setDocPage(docPageState(res))
        },
        [alive, track]
      )

      /** 右栏正文被截断时续读下一页并追加。 */
      const loadMoreDoc = React.useCallback(
        async function () {
          if (!doc) return
          const controller = track()
          setDocMoreBusy(true)
          setDocMoreFail(null)
          const res = await apiDocPage(doc.id, docPage.nextOffset, signalOf(controller))
          if (!alive.current) return
          setDocMoreBusy(false)
          if (!res.ok) {
            setDocMoreFail(pickFail(res))
            return
          }
          setDoc(function (current) {
            if (!current) return current
            return Object.assign({}, current, {
              markdown: joinMarkdown(current.markdown, res.markdown),
              totalLines: typeof res.totalLines === 'number' ? res.totalLines : current.totalLines,
              truncated: !!res.truncated
            })
          })
          setDocPage(docPageState(res, docPage))
        },
        [alive, track, doc, docPage]
      )

      React.useEffect(
        function () {
          refreshStatus()
        },
        [refreshStatus]
      )

      React.useEffect(
        function () {
          loadTree(false)
        },
        [loadTree]
      )

      // notebook 切换（含首次）→ 从内存恢复展开/选中/滚动位置
      React.useEffect(
        function () {
          const memory = readViewMemory('right', notebook)
          setExpandedIds(memory.expandedIds)
          setLoadingIds(new Set())
          setChildFails({})
          pendingRestoreRef.current = { scrollTop: memory.scrollTop }
        },
        [notebook]
      )

      React.useEffect(
        function () {
          if (!notebook) return
          writeViewMemory('right', notebook, { expandedIds: expandedIds })
        },
        [expandedIds, notebook]
      )

      // 树渲染出来后再套用滚动位置
      React.useEffect(
        function () {
          const pending = pendingRestoreRef.current
          if (!pending || !treeOpen) return
          const node = treeScrollRef.current
          if (!node) return
          pendingRestoreRef.current = null
          if (pending.scrollTop) node.scrollTop = pending.scrollTop
        },
        [tree.nodes, treeOpen]
      )

      const toggleNode = React.useCallback(function (id) {
        const key = textOf(id)
        setExpandedIds(function (current) {
          const next = new Set(current)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }, [])

      /** hasMore 节点逐层展开：拉 /tree/children 挂到该节点 children。 */
      const loadChildren = React.useCallback(
        async function (id) {
          const key = textOf(id)
          if (!key) return
          const controller = track()
          setLoadingIds(function (current) {
            const next = new Set(current)
            next.add(key)
            return next
          })
          setChildFails(function (current) {
            const next = Object.assign({}, current)
            delete next[key]
            return next
          })
          const res = await apiTreeChildren(notebook, key, signalOf(controller))
          if (!alive.current) return
          setLoadingIds(function (current) {
            const next = new Set(current)
            next.delete(key)
            return next
          })
          if (!res.ok) {
            setChildFails(function (current) {
              const next = Object.assign({}, current)
              next[key] = pickFail(res)
              return next
            })
            setExpandedIds(function (current) {
              const next = new Set(current)
              next.add(key)
              return next
            })
            return
          }
          const nodes = Array.isArray(res.nodes) ? res.nodes : []
          setTree(function (current) {
            return {
              loading: current.loading,
              fail: current.fail,
              nodes: patchTreeNode(current.nodes, key, function (node) {
                return Object.assign({}, node, { children: nodes, hasMore: false })
              })
            }
          })
          setExpandedIds(function (current) {
            const next = new Set(current)
            next.add(key)
            return next
          })
        },
        [alive, track, notebook]
      )

      // 恢复上次展开的深层树：已展开但还没挂子节点的 hasMore 节点自动补载
      React.useEffect(
        function () {
          const pending = collectLazyExpanded(tree.nodes, expandedIds, loadingIds, childFails)
          for (const id of pending) loadChildren(id)
        },
        [tree.nodes, expandedIds, loadingIds, childFails, loadChildren]
      )

      const noteId = note ? textOf(note.id) : ''
      const lastLoadedId = React.useRef('')
      React.useEffect(
        function () {
          if (!noteId) {
            lastLoadedId.current = ''
            setDoc(null)
            setDocFail(null)
            return
          }
          setTreeOpen(false)
          if (lastLoadedId.current === noteId) return
          lastLoadedId.current = noteId
          setDoc(null)
          setDocFail(null)
          loadDoc(noteId)
        },
        [noteId, loadDoc]
      )

      /** 右栏内点树节点：写共享状态（左栏会同步高亮），正文由上面的 effect 载入。 */
      const selectTreeNode = React.useCallback(function (node) {
        const id = textOf(node && node.id)
        if (!id) return
        setCurrentNote({
          id: id,
          title: textOf(node && node.name) || textOf(node && node.hpath),
          hpath: textOf(node && node.hpath)
        })
        setTreeOpen(false)
        setNotice(null)
      }, [])

      /** 右栏里解析并打开「默认文档」：失败显示一行带 code 的提示。 */
      const openDefaultRef = React.useCallback(
        async function (reference) {
          const ref = textOf(reference).trim()
          if (!ref) return
          const controller = track()
          const res = await apiDoc(ref, signalOf(controller))
          if (!alive.current) return
          if (!res.ok) {
            setNotice({ tone: 'err', text: '默认文档打开失败：', fail: pickFail(res) })
            return
          }
          setTreeOpen(false)
          setCurrentNote({ id: textOf(res.id), title: res.title, hpath: res.hpath })
        },
        [alive, track]
      )

      // 首次挂载且没有当前笔记时，自动打开 settings.defaultDoc
      React.useEffect(
        function () {
          if (autoDefaultRef.current) return
          if (!defaultDoc) return
          if (getCurrentNote()) {
            autoDefaultRef.current = true
            return
          }
          autoDefaultRef.current = true
          openDefaultRef(defaultDoc)
        },
        [defaultDoc, openDefaultRef]
      )

      /** 回到默认：清记忆 + 折叠全部 + 滚到顶部，有默认文档则打开它。 */
      const resetView = React.useCallback(
        function () {
          clearViewMemory('right', notebook)
          setExpandedIds(new Set())
          setChildFails({})
          setLoadingIds(new Set())
          const node = treeScrollRef.current
          if (node) node.scrollTop = 0
          if (defaultDoc) openDefaultRef(defaultDoc)
          else loadTree(true)
        },
        [notebook, defaultDoc, openDefaultRef, loadTree]
      )

      const openInSiyuan = React.useCallback(
        async function () {
          if (!doc) return
          const controller = track()
          setNotice(null)
          const res = await apiOpen(doc.id, signalOf(controller))
          if (!alive.current) return
          if (!res.ok) {
            setNotice({ tone: 'err', fail: pickFail(res) })
            return
          }
          const appLink = textOf(res.appLink)
          const webLink = textOf(res.webLink)
          if (appLink) {
            try {
              window.location.href = appLink
            } catch (error) {
              /* 交给回退链接 */
            }
            setNotice({ tone: 'ok', text: '已请求在思源中打开。', link: webLink || undefined })
            return
          }
          setNotice({ tone: 'ok', text: '思源没有返回应用链接。', link: webLink || undefined })
        },
        [alive, track, doc]
      )

      const copyBlockLink = React.useCallback(
        async function () {
          if (!doc) return
          const controller = track()
          setNotice(null)
          const res = await apiOpen(doc.id, signalOf(controller))
          if (!alive.current) return
          const fallback = 'siyuan://blocks/' + textOf(doc.id)
          if (!res.ok) {
            setNotice({ tone: 'err', fail: pickFail(res) })
            return
          }
          const link = textOf(res.appLink) || fallback
          const copied = await copyText(link)
          if (!alive.current) return
          if (copied) {
            setNotice({ tone: 'ok', text: '已复制块链接。' })
            return
          }
          setNotice({
            tone: 'err',
            text: '复制失败（CLIPBOARD_UNAVAILABLE），请手动复制：' + link,
            link: link
          })
        },
        [alive, track, doc]
      )

      const appendNow = React.useCallback(
        async function () {
          if (!doc || !appendText.trim()) return
          const controller = track()
          setAppendBusy(true)
          setAppendFail(null)
          setNotice(null)
          const res = await apiAppend(doc.id, appendText, 'append', signalOf(controller))
          if (!alive.current) return
          setAppendBusy(false)
          if (!res.ok) {
            setAppendFail(pickFail(res))
            return
          }
          setAppendOpen(false)
          setAppendText('')
          setNotice({ tone: 'ok', text: '已追加到文档末尾。' })
          const again = await apiDoc(doc.id, signalOf(controller))
          if (!alive.current) return
          if (again.ok) {
            setDoc(again)
            setDocPage(docPageState(again))
          }
        },
        [alive, track, doc, appendText]
      )

      const createNow = React.useCallback(
        async function () {
          const title = textOf(newTitle).trim()
          if (!title) {
            setCreateFail({ code: 'SIYUAN_INVALID_ARGUMENT', message: '请填写文档标题' })
            return
          }
          const controller = track()
          setCreateBusy(true)
          setCreateFail(null)
          setNotice(null)
          const body = { title: title, markdown: newBody }
          if (notebook) body.notebook = notebook
          const res = await apiCreate(body, signalOf(controller))
          if (!alive.current) return
          setCreateBusy(false)
          if (!res.ok) {
            setCreateFail(pickFail(res))
            return
          }
          setCreateOpen(false)
          setNewTitle('')
          setNewBody('')
          setNotice({ tone: 'ok', text: '已创建文档：' + (textOf(res.title) || title) })
          await loadTree(true)
          if (!alive.current) return
          if (res.id) {
            setCurrentNote({
              id: textOf(res.id),
              title: textOf(res.title) || title,
              hpath: textOf(res.hpath)
            })
          }
        },
        [alive, track, newTitle, newBody, notebook, loadTree]
      )

      const refresh = React.useCallback(
        function () {
          loadTree(true)
          if (doc) loadDoc(textOf(doc.id))
        },
        [loadTree, loadDoc, doc]
      )

      const notebookOptions = notebooks.length
        ? notebooks.map(function (item) {
            const id = textOf(item && item.id)
            return h('option', { key: 'nb-' + id, value: id }, textOf(item && item.name))
          })
        : [h('option', { key: '__none', value: '' }, '（没有可见笔记本）')]

      const newDocForm = createOpen
        ? h(
            'div',
            {
              style: {
                display: 'grid',
                gap: 6,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid ' + T.border1,
                background: T.layer2
              }
            },
            h('div', { style: { fontSize: 12, color: T.sub } }, '新建文档'),
            h('input', {
              type: 'text',
              value: newTitle,
              placeholder: '文档标题',
              onChange: function (event) {
                setNewTitle(event.target.value)
              },
              style: Object.assign({}, inputStyle, { height: 26, fontSize: 12 })
            }),
            h('textarea', {
              value: newBody,
              placeholder: '正文（Markdown，可留空）',
              onChange: function (event) {
                setNewBody(event.target.value)
              },
              style: Object.assign({}, areaStyle, { minHeight: 64, fontSize: 12 })
            }),
            createFail ? h(FailLine, { fail: createFail, prefix: '创建失败：' }) : null,
            h(
              'div',
              { style: { display: 'flex', gap: 6 } },
              h(GhostButton, {
                small: true,
                kind: 'primary',
                disabled: createBusy,
                onClick: createNow
              }, createBusy ? '创建中…' : '创建'),
              h(GhostButton, {
                small: true,
                onClick: function () {
                  setCreateOpen(false)
                  setCreateFail(null)
                }
              }, '取消')
            )
          )
        : null

      const appendBox = appendOpen
        ? h(
            'div',
            { style: { display: 'grid', gap: 6 } },
            h('textarea', {
              value: appendText,
              placeholder: '追加到文档末尾的 Markdown…',
              onChange: function (event) {
                setAppendText(event.target.value)
              },
              style: Object.assign({}, areaStyle, { minHeight: 80, fontSize: 12 })
            }),
            appendFail ? h(FailLine, { fail: appendFail, prefix: '追加失败：' }) : null,
            h(
              'div',
              { style: { display: 'flex', gap: 6 } },
              h(GhostButton, {
                small: true,
                kind: 'primary',
                disabled: appendBusy || !appendText.trim(),
                onClick: appendNow
              }, appendBusy ? '追加中…' : '确认追加'),
              h(GhostButton, {
                small: true,
                onClick: function () {
                  setAppendOpen(false)
                  setAppendText('')
                  setAppendFail(null)
                }
              }, '取消')
            )
          )
        : null

      const emptyHint = h(
        'div',
        { style: { display: 'grid', gap: 6, padding: '10px 2px' } },
        h('div', { style: { fontSize: 12, color: T.sub } }, '还没有选中笔记。'),
        h(
          'div',
          { style: { fontSize: 12, color: T.dim, lineHeight: '18px' } },
          '在左侧「思源笔记」面板或上面的文档树里点一篇笔记，正文会显示在这里。'
        )
      )

      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            minWidth: 0,
            background: T.bg,
            color: T.text,
            fontSize: 12
          }
        },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 10px',
              borderBottom: '1px solid ' + T.border1,
              flexWrap: 'wrap',
              flex: 'none'
            }
          },
          h(
            'select',
            {
              value: notebook,
              onChange: function (event) {
                setNotebook(event.target.value)
              },
              style: Object.assign({}, selectStyle, {
                flex: '1 1 100px',
                minWidth: 84,
                maxWidth: 170,
                height: 26,
                fontSize: 12
              })
            },
            notebookOptions
          ),
          h(GhostButton, {
            small: true,
            onClick: function () {
              setTreeOpen(!treeOpen)
            }
          }, treeOpen ? '收起树' : '文档树'),
          h(GhostButton, { small: true, onClick: refresh }, '刷新'),
          h(GhostButton, {
            small: true,
            title: '折叠全部并回到顶部；若设置了默认文档则打开它',
            onClick: resetView
          }, '重置'),
          h(GhostButton, {
            small: true,
            onClick: function () {
              setCreateOpen(!createOpen)
              setCreateFail(null)
              setNotice(null)
            }
          }, '新建')
        ),
        treeOpen
          ? h(
              'div',
              {
                ref: treeScrollRef,
                onScroll: function (event) {
                  if (!notebook) return
                  writeViewMemory('right', notebook, { scrollTop: event.currentTarget.scrollTop })
                },
                style: {
                  flex: '0 1 auto',
                  maxHeight: '38vh',
                  minHeight: 0,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  padding: '4px 8px 6px',
                  borderBottom: '1px solid ' + T.border1
                }
              },
              tree.fail
                ? h(FailLine, {
                    fail: tree.fail,
                    prefix: '读取文档树失败：',
                    onRetry: function () {
                      loadTree(true)
                    }
                  })
                : null,
              tree.loading && tree.nodes.length === 0
                ? h('div', { style: { fontSize: 12, color: T.dim, padding: '6px 2px' } }, '读取文档树…')
                : null,
              !tree.loading && !tree.fail && tree.nodes.length === 0
                ? h('div', { style: { fontSize: 12, color: T.dim, padding: '6px 2px' } }, '这个笔记本里还没有文档。')
                : null,
              h(DocTree, {
                nodes: tree.nodes,
                expandedIds: expandedIds,
                selectedId: noteId,
                loadingIds: loadingIds,
                childFails: childFails,
                onToggle: toggleNode,
                onLoadChildren: loadChildren,
                onSelect: selectTreeNode
              })
            )
          : null,
        h(
          'div',
          {
            style: {
              flex: '1 1 auto',
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              padding: '10px 12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }
          },
          newDocForm,
          docLoading && !doc ? h('div', { style: { fontSize: 12, color: T.dim } }, '读取笔记…') : null,
          docFail
            ? h(FailLine, {
                fail: docFail,
                prefix: '读取笔记失败：',
                onRetry: function () {
                  if (noteId) loadDoc(noteId)
                }
              })
            : null,
          !note && !createOpen ? emptyHint : null,
          doc
            ? h(
                React.Fragment,
                null,
                h(
                  'div',
                  { style: { display: 'grid', gap: 3, minWidth: 0 } },
                  h(
                    'div',
                    { style: { fontSize: 13, fontWeight: 600, lineHeight: '20px', wordBreak: 'break-word' } },
                    textOf(doc.title) || (note && note.title) || '（无标题）'
                  ),
                  h(
                    'div',
                    {
                      style: {
                        fontSize: 12,
                        color: T.dim,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      },
                      title: textOf(doc.hpath)
                    },
                    textOf(doc.hpath) || '/'
                  )
                ),
                h(
                  'div',
                  { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                  h(GhostButton, { small: true, onClick: openInSiyuan }, '在思源打开'),
                  h(GhostButton, { small: true, onClick: copyBlockLink }, '复制链接'),
                  h(GhostButton, {
                    small: true,
                    onClick: function () {
                      setAppendOpen(!appendOpen)
                      setAppendFail(null)
                    }
                  }, appendOpen ? '收起追加' : '追加')
                ),
                appendBox,
                docPage.truncated
                  ? h(
                      'div',
                      { style: { display: 'grid', gap: 6 } },
                      h(GhostButton, {
                        small: true,
                        disabled: docMoreBusy,
                        onClick: loadMoreDoc
                      }, docMoreBusy
                        ? '加载中…'
                        : '加载更多（已显示 ' + docPage.nextOffset + '/' + docPage.totalLines + ' 行）'),
                      docMoreFail
                        ? h(FailLine, { fail: docMoreFail, prefix: '加载更多失败：', onRetry: loadMoreDoc })
                        : null
                    )
                  : docPage.nextOffset > 0
                    ? h('div', { style: { fontSize: 12, color: T.dim } },
                        '已显示全部 ' + docPage.totalLines + ' 行')
                    : null,
                h(
                  'div',
                  {
                    style: {
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontSize: 12,
                      lineHeight: '20px',
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: T.layer2,
                      border: '1px solid ' + T.border1
                    }
                  },
                  textOf(doc.markdown) || '（空文档）'
                )
              )
            : null,
          h(Notice, { notice: notice })
        )
      )
    }

    // ─────────────────────────────────────────────────────────────
    // 回答动作：存入思源
    // ─────────────────────────────────────────────────────────────
    function SaveMessageAction(props) {
      const messageId = textOf(props && props.messageId)
      const sessionId = textOf(props && props.sessionId)
      const alive = useAlive()
      const track = useRequests()
      const wrapperRef = React.useRef(null)
      const buttonRef = React.useRef(null)
      const hover = useHover()

      const [open, setOpen] = React.useState(false)
      const [anchor, setAnchor] = React.useState(null)
      const [notebooks, setNotebooks] = React.useState([])
      const [notebook, setNotebook] = React.useState('')
      const [title, setTitle] = React.useState('')
      const [docMode, setDocMode] = React.useState(false)
      const [docQuery, setDocQuery] = React.useState('')
      const [docResults, setDocResults] = React.useState([])
      const [docSearching, setDocSearching] = React.useState(false)
      const [docTarget, setDocTarget] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [fail, setFail] = React.useState(null)
      const [saved, setSaved] = React.useState(null)

      const place = React.useCallback(function () {
        const node = buttonRef.current
        if (!node || typeof node.getBoundingClientRect !== 'function') return
        const rect = node.getBoundingClientRect()
        const width = 320
        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800
        const left = Math.max(12, Math.min(rect.right - width, viewportWidth - width - 12))
        const top = Math.max(12, Math.min(rect.bottom + 6, viewportHeight - 360))
        setAnchor({ left: left, top: top, width: width })
      }, [])

      const toggle = React.useCallback(
        function () {
          if (open) {
            setOpen(false)
            return
          }
          place()
          setOpen(true)
          setFail(null)
        },
        [open, place]
      )

      React.useEffect(
        function () {
          if (!open) return undefined
          place()
          const onDown = function (event) {
            const root = wrapperRef.current
            const target = event && event.target
            const inside = root && target && typeof root.contains === 'function' && root.contains(target)
            if (!inside) setOpen(false)
          }
          const onKey = function (event) {
            if (event.key === 'Escape') setOpen(false)
          }
          const onScroll = function (event) {
            const root = wrapperRef.current
            const target = event && event.target
            if (root && target && typeof root.contains === 'function' && root.contains(target)) return
            setOpen(false)
          }
          window.addEventListener('mousedown', onDown, true)
          window.addEventListener('keydown', onKey)
          window.addEventListener('scroll', onScroll, true)
          return function () {
            window.removeEventListener('mousedown', onDown, true)
            window.removeEventListener('keydown', onKey)
            window.removeEventListener('scroll', onScroll, true)
          }
        },
        [open, place]
      )

      const loadNotebooks = React.useCallback(
        async function () {
          const controller = track()
          const res = await getJSON('/status', signalOf(controller))
          if (!alive.current) return
          if (!res.ok) {
            setFail(pickFail(res))
            return
          }
          const list = Array.isArray(res.notebooks) ? res.notebooks : []
          setNotebooks(list)
          const settings = res.settings && typeof res.settings === 'object' ? res.settings : {}
          setNotebook(function (current) {
            if (current) return current
            return textOf(settings.defaultNotebook)
          })
        },
        [alive, track]
      )

      const openPanel = React.useCallback(
        function () {
          toggle()
          if (!open) loadNotebooks()
        },
        [toggle, open, loadNotebooks]
      )

      const searchDocs = React.useCallback(
        async function () {
          const keyword = textOf(docQuery).trim()
          if (!keyword) {
            setDocResults([])
            return
          }
          const controller = track()
          setDocSearching(true)
          setFail(null)
          const res = await getJSON('/search?q=' + encodeURIComponent(keyword) + '&limit=20', signalOf(controller))
          if (!alive.current) return
          setDocSearching(false)
          if (!res.ok) {
            setFail(pickFail(res))
            setDocResults([])
            return
          }
          setDocResults(Array.isArray(res.items) ? res.items : [])
        },
        [alive, track, docQuery]
      )

      const confirm = React.useCallback(
        async function () {
          if (!messageId || !sessionId) {
            setFail({ code: 'SIYUAN_INVALID_ARGUMENT', message: '缺少会话或消息标识，无法保存这条回答' })
            return
          }
          const controller = track()
          setBusy(true)
          setFail(null)
          const body = { sessionId: sessionId, messageId: messageId }
          if (notebook) body.notebook = notebook
          if (title.trim()) body.title = title.trim()
          if (docTarget && docTarget.id) body.docId = textOf(docTarget.id)
          const res = await postJSON('/save-message', body, signalOf(controller))
          if (!alive.current) return
          setBusy(false)
          if (!res.ok) {
            setFail(pickFail(res))
            return
          }
          setSaved({
            id: textOf(res.id),
            hpath: textOf(res.hpath),
            created: !!res.created
          })
          setOpen(false)
        },
        [alive, track, messageId, sessionId, notebook, title, docTarget]
      )

      const trigger = h(
        'button',
        {
          ref: buttonRef,
          type: 'button',
          title: '存入思源',
          'aria-label': '存入思源',
          'aria-haspopup': 'dialog',
          'aria-expanded': open ? 'true' : 'false',
          onClick: openPanel,
          onMouseEnter: hover[1],
          onMouseLeave: hover[2],
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            padding: 6,
            boxSizing: 'border-box',
            borderRadius: 8,
            border: 'none',
            background: hover[0] || open ? T.hover : 'transparent',
            color: hover[0] || open ? T.sub : T.dim,
            cursor: 'pointer'
          }
        },
        h(Icon, { name: 'bookmark', size: 15 })
      )

      const savedLink = saved
        ? h(
            'a',
            {
              href: 'siyuan://blocks/' + saved.id,
              title: saved.hpath || '已存入思源',
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                fontSize: 12,
                lineHeight: '20px',
                color: T.brand,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                paddingLeft: 2
              }
            },
            '已存入 · 查看'
          )
        : null

      const notebookOptions = [
        h('option', { key: '__default', value: '' }, '默认笔记本（跟随设置）')
      ].concat(
        notebooks.map(function (item) {
          const id = textOf(item && item.id)
          return h(
            'option',
            { key: 'nb-' + id, value: id },
            textOf(item && item.name) + (item && item.closed ? '（已关闭）' : '')
          )
        })
      )

      const panel = open
        ? h(
            'div',
            {
              role: 'dialog',
              'aria-label': '存入思源',
              style: {
                position: 'fixed',
                left: anchor ? anchor.left : 12,
                top: anchor ? anchor.top : 12,
                width: anchor ? anchor.width : 320,
                zIndex: 2147483000,
                boxSizing: 'border-box',
                display: 'grid',
                gap: 10,
                padding: '12px 12px 10px',
                borderRadius: 10,
                border: '1px solid ' + T.border2,
                background: T.layer1,
                color: T.text
              }
            },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('span', { style: { fontSize: 13, fontWeight: 600, flex: '1 1 auto' } }, '存入思源'),
              h('button', {
                type: 'button',
                title: '关闭',
                'aria-label': '关闭',
                onClick: function () {
                  setOpen(false)
                },
                style: {
                  width: 22,
                  height: 22,
                  padding: 0,
                  border: 'none',
                  borderRadius: 8,
                  background: 'transparent',
                  color: T.dim,
                  fontSize: 13,
                  cursor: 'pointer'
                }
              }, '✕')
            ),
            h(Field, { label: '笔记本' }, h('select', {
              value: notebook,
              onChange: function (event) {
                setNotebook(event.target.value)
              },
              style: selectStyle
            }, notebookOptions)),
            h(Field, {
              label: '标题',
              optional: true,
              hint: '留空则取回答的第一行。'
            }, h('input', {
              type: 'text',
              value: title,
              placeholder: '留空则取回答首行',
              onChange: function (event) {
                setTitle(event.target.value)
              },
              style: inputStyle
            })),
            h(
              'div',
              { style: { display: 'grid', gap: 8 } },
              h(Toggle, {
                value: docMode,
                label: '追加到已有文档',
                onChange: function (next) {
                  setDocMode(next)
                  if (!next) {
                    setDocResults([])
                    setDocTarget(null)
                  }
                }
              }),
              docMode
                ? h(
                    'div',
                    { style: { display: 'grid', gap: 6 } },
                    docTarget
                      ? h(
                          'div',
                          {
                            style: {
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '6px 8px',
                              borderRadius: 8,
                              background: T.layer2,
                              fontSize: 12
                            }
                          },
                          h('span', {
                            style: {
                              flex: '1 1 auto',
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            },
                            title: textOf(docTarget.hpath)
                          }, '追加到：' + (textOf(docTarget.title) || '（无标题）')),
                          h(GhostButton, {
                            small: true,
                            onClick: function () {
                              setDocTarget(null)
                            }
                          }, '更换')
                        )
                      : h(
                          React.Fragment,
                          null,
                          h('div', { style: { display: 'flex', gap: 6 } },
                            h('input', {
                              type: 'search',
                              value: docQuery,
                              placeholder: '搜索目标文档，回车',
                              onChange: function (event) {
                                setDocQuery(event.target.value)
                              },
                              onKeyDown: function (event) {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  searchDocs()
                                }
                              },
                              style: Object.assign({}, inputStyle, { flex: '1 1 auto', width: 'auto' })
                            }),
                            h(GhostButton, {
                              small: true,
                              onClick: searchDocs,
                              disabled: docSearching
                            }, docSearching ? '搜索中…' : '搜索')
                          ),
                          docResults.length
                            ? h(
                                'div',
                                {
                                  style: {
                                    display: 'grid',
                                    gap: 2,
                                    maxHeight: 132,
                                    overflowY: 'auto',
                                    border: '1px solid ' + T.border1,
                                    borderRadius: 8,
                                    padding: 4
                                  }
                                },
                                docResults.slice(0, 12).map(function (item, index) {
                                  const id = textOf(item && item.id)
                                  return h(
                                    'button',
                                    {
                                      key: 'sd-' + (id || index),
                                      type: 'button',
                                      title: textOf(item && item.hpath),
                                      onClick: function () {
                                        setDocTarget(item)
                                        setDocResults([])
                                      },
                                      style: {
                                        display: 'grid',
                                        gap: 1,
                                        textAlign: 'left',
                                        padding: '5px 7px',
                                        border: 'none',
                                        borderRadius: 8,
                                        background: 'transparent',
                                        color: T.text,
                                        font: 'inherit',
                                        fontSize: 12,
                                        lineHeight: '18px',
                                        cursor: 'pointer',
                                        minWidth: 0
                                      }
                                    },
                                    h('span', {
                                      style: {
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap'
                                      }
                                    }, textOf(item && item.title) || '（无标题）'),
                                    h('span', {
                                      style: {
                                        color: T.dim,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap'
                                      }
                                    }, textOf(item && item.hpath) || '/')
                                  )
                                })
                              )
                            : null
                        )
                  )
                : null
            ),
            fail ? h(FailLine, { fail: fail, prefix: '存入失败：' }) : null,
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' } },
              h(GhostButton, {
                small: true,
                onClick: function () {
                  setOpen(false)
                }
              }, '取消'),
              h(GhostButton, {
                small: true,
                kind: 'primary',
                disabled: busy,
                onClick: confirm
              }, busy ? '存入中…' : '确认存入')
            ),
            h('div', { style: { fontSize: 12, color: T.dim, lineHeight: '18px' } },
              '只有点「确认存入」才会写入思源。')
          )
        : null

      return h(
        'span',
        {
          ref: wrapperRef,
          style: { position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }
        },
        trigger,
        savedLink,
        panel
      )
    }

    // ─────────────────────────────────────────────────────────────
    // 会话输入栏入口：点一下打开右栏「思源笔记」
    // ─────────────────────────────────────────────────────────────
    function SiyuanInputButton() {
      const ui = useUiFlags()
      const hover = useHover()
      const [unavailable, setUnavailable] = React.useState(false)

      React.useEffect(
        function () {
          if (!unavailable) return undefined
          const timer = setTimeout(function () {
            setUnavailable(false)
          }, 2400)
          return function () {
            clearTimeout(timer)
          }
        },
        [unavailable]
      )

      const press = React.useCallback(function () {
        if (openRightSidebarTab()) return
        setUnavailable(true)
        // 右栏不可用时退到左侧思源面板
        try {
          if (hostCtx && typeof hostCtx.get === 'function') {
            const layout = hostCtx.get('layout')
            if (layout && typeof layout.selectPanel === 'function') layout.selectPanel('siyuan')
          }
        } catch (error) {
          /* 静默 */
        }
      }, [])

      // 开关关闭时整个入口不渲染（仍在 slot 里注册，只是返回 null）
      if (!ui.showComposerButton) return null

      return h(
        'span',
        { style: { position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 } },
        h(
          'button',
          {
            type: 'button',
            title: '打开思源笔记（右侧栏）',
            'aria-label': '打开思源笔记',
            onClick: press,
            onMouseEnter: hover[1],
            onMouseLeave: hover[2],
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              height: 28,
              padding: '0 8px',
              boxSizing: 'border-box',
              borderRadius: 8,
              border: 'none',
              background: hover[0] ? T.hover : 'transparent',
              color: hover[0] ? T.sub : T.dim,
              font: 'inherit',
              fontSize: 12,
              cursor: 'pointer'
            }
          },
          h(Icon, { name: 'note', size: 15 }),
          h('span', null, '思源')
        ),
        unavailable
          ? h(
              'span',
              { style: { fontSize: 12, color: T.err, whiteSpace: 'nowrap' } },
              '右栏不可用'
            )
          : null
      )
    }

    // ─────────────────────────────────────────────────────────────
    // 注册
    // ─────────────────────────────────────────────────────────────
    let hostCtx = null

    function labelFor(preset) {
      try {
        const snap = hostCtx && hostCtx.locale && hostCtx.locale.getSnapshot()
        const id = textOf(snap && (snap.id || snap.code || snap.tag || snap.locale)) || 'zh'
        return id.toLowerCase().indexOf('zh') === 0 ? preset.zh : preset.en
      } catch (error) {
        return preset.zh
      }
    }

    // ─────────────────────────────────────────────────────────────
    // UI 开关：对话区「思源笔记」页签 / 输入框「思源」按钮
    // 模块级状态 + 订阅，设置里保存后即时生效（不刷新）
    // ─────────────────────────────────────────────────────────────
    let uiFlags = { showViewTab: true, showComposerButton: true }
    const uiSubscribers = new Set()

    function normalizeUiFlags(source) {
      const value = source && typeof source === 'object' ? source : {}
      return {
        showViewTab: value.showViewTab !== false,
        showComposerButton: value.showComposerButton !== false
      }
    }

    function readUiFlags() {
      return uiFlags
    }

    function setUiFlags(patch) {
      const next = normalizeUiFlags(Object.assign({}, uiFlags, patch || {}))
      if (next.showViewTab === uiFlags.showViewTab && next.showComposerButton === uiFlags.showComposerButton) {
        uiFlags = next
        return
      }
      uiFlags = next
      const listeners = Array.from(uiSubscribers)
      for (const listener of listeners) {
        try {
          listener(next)
        } catch (error) {
          /* 单个订阅者异常不影响其它 */
        }
      }
    }

    function subscribeUiFlags(listener) {
      uiSubscribers.add(listener)
      return function () {
        uiSubscribers.delete(listener)
      }
    }

    function useUiFlags() {
      const [flags, setFlags] = React.useState(readUiFlags())
      React.useEffect(function () {
        setFlags(readUiFlags())
        return subscribeUiFlags(setFlags)
      }, [])
      return flags
    }

    // 对话区「思源笔记」页签：动态注册 / 注销
    let conversationViewDisposer = null

    function enableConversationView() {
      if (typeof conversationViewDisposer === 'function') return true
      try {
        if (!hostCtx || !hostCtx.slots || typeof hostCtx.slots.inject !== 'function') return false
        const handle = hostCtx.slots.inject('conversation.view', function () {
          return hostCtx.slots.register(
            {
              name: 'conversation.view',
              id: 'siyuan',
              order: 15,
              label: function () {
                return labelFor({ zh: '思源笔记', en: 'SiYuan' })
              }
            },
            function SiyuanConversationView() {
              return h(MainPanel, { surface: 'middle' })
            }
          )
        })
        if (typeof handle === 'function') {
          conversationViewDisposer = handle
        } else if (handle && typeof handle.dispose === 'function') {
          conversationViewDisposer = function () {
            handle.dispose()
          }
        } else {
          conversationViewDisposer = null
          return false
        }
        return true
      } catch (error) {
        conversationViewDisposer = null
        return false
      }
    }

    function disableConversationView() {
      const disposer = conversationViewDisposer
      conversationViewDisposer = null
      if (typeof disposer !== 'function') return
      try {
        disposer()
      } catch (error) {
        /* 注销失败静默 */
      }
    }

    function syncConversationView(show) {
      if (show) return enableConversationView()
      disableConversationView()
      return false
    }

    /** 从 settings 对象同步两个入口开关（缺字段一律当 true）。 */
    function applySettingsFlags(settings) {
      const value = settings && typeof settings === 'object' ? settings : {}
      setUiFlags({
        showViewTab: value.showViewTab !== false,
        showComposerButton: value.showComposerButton !== false
      })
      syncConversationView(uiFlags.showViewTab)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        hostCtx = ctx

        // 优先通过 ctx.inject(['sidebarRight']) 捕获右栏导航服务；捕不到再回落到 ctx.get
        try {
          if (typeof ctx.inject === 'function') {
            ctx.inject(['sidebarRight'], function (owner) {
              try {
                const service =
                  typeof owner.get === 'function' ? owner.get('sidebarRight') : owner.sidebarRight
                if (service && typeof service.openTab === 'function') sidebarRightRef = service
              } catch (error) {
                /* 右栏服务不可用：保持 null，等 ctx.get 兜底 */
              }
            })
          }
        } catch (error) {
          sidebarRightRef = null
        }

        try {
          ctx.slots.inject('conversation.input.left', function () {
            return ctx.slots.register(
              {
                name: 'conversation.input.left',
                id: 'siyuan',
                order: 10,
                label: function () {
                  return labelFor({ zh: '思源', en: 'SiYuan' })
                }
              },
              SiyuanInputButton
            )
          })
        } catch (error) {
          /* 输入栏 slot 不可用时忽略，不影响面板/右栏 */
        }

        ctx.slots.inject('sidebar.panellist', function () {
          return ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'siyuan',
              order: 20,
              label: function () {
                return labelFor({ zh: '思源笔记', en: 'SiYuan' })
              }
            },
            SiyuanIcon
          )
        })

        ctx.slots.inject('main', function () {
          return ctx.slots.register({ name: 'main', key: 'siyuan' }, MainPanel)
        })

        // 对话区顶部「视图」行里的思源页签：动态注册（设置里可关）
        syncConversationView(uiFlags.showViewTab)
        // 拉一次设置决定两个入口是否显示；失败保持默认（都显示）
        try {
          getJSON('/settings')
            .then(function (res) {
              if (res && res.ok && res.settings && typeof res.settings === 'object') {
                applySettingsFlags(res.settings)
              }
            })
            .catch(function () {
              /* 读取失败：保持默认 true */
            })
        } catch (error) {
          /* 静默：默认都显示 */
        }
        // 插件卸载时移除动态注册的页签
        try {
          ctx.effect(function () {
            return function () {
              disableConversationView()
            }
          }, 'dsh-siyuan: conversation view tab')
        } catch (error) {
          /* ctx.effect 不可用时忽略（父级 fiber 卸载会收尾） */
        }

        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register(
            {
              name: 'settings.section',
              id: 'siyuan',
              order: 60,
              label: function () {
                return labelFor({ zh: '思源笔记', en: 'SiYuan' })
              }
            },
            SettingsPage
          )
        })

        ctx.slots.inject('conversation.chat.assistant-actions', function () {
          return ctx.slots.register(
            {
              name: 'conversation.chat.assistant-actions',
              id: 'siyuan-save',
              order: 30,
              label: function () {
                return labelFor({ zh: '存入思源', en: 'Save to SiYuan' })
              }
            },
            SaveMessageAction
          )
        })

        // ── 右栏笔记 tab ──────────────────────────────────────────
        // sidebarRightTabs 缺失（宿主没装 ui-sidebar-right）时整块静默降级：
        // 左栏仍然可用，只是点笔记时退回内联预览，绝不因为右栏把插件搞崩。
        let rightTabHandle = null
        try {
          if (typeof ctx.inject === 'function') {
            rightTabHandle = ctx.inject(['sidebarRightTabs'], function (owner) {
              const disposers = []
              const keep = function (disposer) {
                if (typeof disposer === 'function') {
                  disposers.push(disposer)
                  return
                }
                if (disposer && typeof disposer.dispose === 'function') {
                  disposers.push(function () {
                    disposer.dispose()
                  })
                }
              }
              const disposeAll = function () {
                for (const dispose of disposers) {
                  try {
                    dispose()
                  } catch (error) {
                    /* 单个 dispose 失败不影响其它清理 */
                  }
                }
                disposers.length = 0
              }
              try {
                const tabs =
                  typeof owner.get === 'function' ? owner.get('sidebarRightTabs') : owner.sidebarRightTabs
                if (!tabs || typeof tabs.register !== 'function') return undefined
                keep(
                  tabs.register({
                    id: SIDEBAR_TAB_ID,
                    kind: SIDEBAR_TAB_KIND,
                    title: function () {
                      return labelFor({ zh: '思源笔记', en: 'SiYuan' })
                    },
                    guide: [
                      {
                        id: 'siyuan',
                        order: 30,
                        title: function () {
                          return labelFor({ zh: '思源笔记', en: 'SiYuan' })
                        },
                        description: function () {
                          return labelFor({
                            zh: '按文档树浏览笔记，边聊边读',
                            en: 'Browse SiYuan documents while you chat'
                          })
                        }
                      }
                    ],
                    keepMounted: true
                  })
                )
                if (owner.slots && typeof owner.slots.inject === 'function') {
                  keep(
                    owner.slots.inject('sidebar.right.pane.tab', function () {
                      return owner.slots.register(
                        { name: 'sidebar.right.pane.tab', key: SIDEBAR_TAB_ID },
                        NoteSidebarView
                      )
                    })
                  )
                }
              } catch (error) {
                disposeAll()
                return undefined
              }
              return disposeAll
            })
          }
        } catch (error) {
          rightTabHandle = null
        }
        try {
          ctx.effect(function () {
            return function () {
              try {
                if (rightTabHandle && typeof rightTabHandle.dispose === 'function') {
                  rightTabHandle.dispose()
                }
              } catch (error) {
                /* 卸载时静默 */
              }
            }
          }, 'dsh-siyuan: right sidebar note tab')
        } catch (error) {
          /* ctx.effect 不可用时忽略（父级 fiber 卸载会收尾） */
        }
      }
    }
  }
})
