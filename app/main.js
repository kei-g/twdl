class Application {
  #controls = {
    webViewAudioMuted: undefined,
    webViewHeight: undefined,
  }
  #webView = undefined
  #window = undefined

  #changeWebViewAudioMuted() {
    this.#webView.setAudioMuted(this.#controls.webViewAudioMuted.checked)
  }

  #changeWebViewHeight() {
    const height = `${this.#controls.webViewHeight.value}px`
    this.#webView.style.minHeight = height
    this.#webView.style.height = height
  }

  #getElementById(id) {
    return this.#window.document.getElementById(id)
  }

  #handleConsoleMessage(event) {
    ([2, 3].includes(event.level) ? [console.warn, console.error][event.level - 2] : console.log)(event.message)
  }

  #handleFoundImages(event) {
    const [images, { epoch, period, timeout }] = event.args
    const now = Date.now()
    if (epoch + timeout <= now)
      ipcRenderer.send('images-found', { abort: false, error: 'タイムアウト' })
    else {
      if (images.error)
        console.log(images)
      images.retryLater || images.size === 0
        ? this.#requestLookupImages(epoch, period, timeout, period)
        : ipcRenderer.send('images-found', images)
    }
  }

  #handleIpcMessage(event) {
    event.channel === 'images-found'
      ? this.#handleFoundImages(event)
      : ipcRenderer.send(event.channel, ...event.args)
  }

  async #initializeComponents() {
    const config = await ipcRenderer.invoke('get-config')
    const audioMuted = config.webView?.audioMuted ?? true
    const webViewHeight = config.webView?.size?.height ?? 554
    const source = this.#getElementById('source-file')
    source.addEventListener(
      'change',
      () => {
        const shouldDisable = !source.files.length
        beginDownload.disabled = shouldDisable
        selectByDateRange.disabled = shouldDisable
      }
    )
    const beginDownload = this.#getElementById('begin-download')
    const cancelDownload = this.#getElementById('cancel-download')
    beginDownload.addEventListener(
      'click',
      async () => {
        beginDownload.disabled = true
        cancelDownload.disabled = false
        selectByDateRange.disabled = true
        clearDateRanges.disabled = true
        for (const file of source.files) {
          const name = await file.text()
          await ipcRenderer.invoke('download', name)
        }
        beginDownload.disabled = false
        cancelDownload.disabled = true
        selectByDateRange.disabled = false
        clearDateRanges.disabled = false
      }
    )
    cancelDownload.addEventListener('click', ipcRenderer.invoke.bind(ipcRenderer, 'message-box', 'キャンセル機能は未実装です'))
    const selectByDateRange = this.#getElementById('select-by-date-range')
    selectByDateRange.addEventListener(
      'click',
      async () => {
        beginDownload.disabled = true
        selectByDateRange.disabled = true
        clearDateRanges.disabled = true
        await ipcRenderer.invoke(
          'select-by-date-range',
          await source.files.item(0).text(),
          since.value,
          until.value
        )
      }
    )
    ipcRenderer.on(
      'complete-selection',
      () => {
        beginDownload.disabled = false
        selectByDateRange.disabled = false
        clearDateRanges.disabled = false
      }
    )
    const clearDateRanges = this.#getElementById('clear-date-ranges')
    clearDateRanges.addEventListener(
      'click',
      async () => {
        since.value = undefined
        until.value = undefined
        delete config.range
        await ipcRenderer.invoke('set-config', config)
      }
    )
    const webView = this.#getElementById('webview')
    this.#webView = webView
    if (config.webView?.openDevTools)
      webView.addEventListener('dom-ready', this.#openDevTools.bind(this), { once: true })
    webView.style.height = `${webViewHeight}px`
    webView.setAudioMuted(audioMuted)
    webView.addEventListener('console-message', this.#handleConsoleMessage.bind(this))
    webView.addEventListener('ipc-message', this.#handleIpcMessage.bind(this))
    this.#getElementById('destination-directory').value = config.destinationDirectory
    const since = this.#getElementById('since')
    if (config.range?.since)
      since.value = config.range.since
    const until = this.#getElementById('until')
    if (config.range?.until)
      until.value = config.range.until
    this.#getElementById('initial-delay').value = config.timer?.initialDelay ?? 100
    this.#getElementById('timeout').value = config.timer?.timeout ?? 5000
    this.#getElementById('period').value = config.timer?.period ?? 125
    const wh = this.#getElementById('webview-height')
    this.#controls.webViewHeight = wh
    wh.addEventListener('change', this.#changeWebViewHeight.bind(this))
    wh.value = webViewHeight
    const wam = this.#getElementById('webview-audio-muted')
    this.#controls.webViewAudioMuted = wam
    wam.addEventListener('change', this.#changeWebViewAudioMuted.bind(this))
    wam.checked = audioMuted
    observeConfigurationChanges()
    prepareModalControllers()
    prepareOpenDirectory()
    ipcRenderer.on('load', this.#load.bind(this))
  }

  async #load(_, url) {
    const epoch = Date.now()
    const [initialDelay, period, timeout] = ['initial-delay', 'period', 'timeout'].map(
      id => parseInt(this.#window.document.getElementById(id).value)
    )
    const webView = this.#webView
    const task = new Promise(
      resolve => webView.addEventListener('dom-ready', resolve, { once: true })
    )
    await webView.loadURL(url)
    await task
    this.#requestLookupImages(epoch, period, timeout, initialDelay)
  }

  #openDevTools() {
    this.#webView.openDevTools()
  }

  #requestLookupImages(epoch, period, timeout, delay) {
    this.#window.setTimeout(
      this.#webView.send.bind(
        this.#webView,
        'lookup-images',
        {
          epoch,
          period,
          timeout
        }
      ),
      delay
    )
  }

  async #selectByDateRange() {
    this.#controls.beginDownload.disabled = true
    this.#controls.selectByDateRange.disabled = true
    this.#controls.clearDateRanges.disabled = true
    await ipcRenderer.invoke(
      'select-by-date-range',
      await this.#controls.source.files.item(0).text(),
      this.#controls.since.value,
      this.#controls.until.value
    )
  }

  constructor() {
    ipcRenderer.on('complete-selection', this.#handleSelectionCompletion.bind(this))
    ipcRenderer.on('load', this.#load.bind(this))
  }

  attachTo(window) {
    this.#window = window
    window.addEventListener('DOMContentLoaded', this.#initializeComponents.bind(this))
  }
}

const actionTemplate = {
  checkbox: element => element.checked,
  number: element => parseInt(element.value),
}

const observeConfigurationChanges = () => {
  for (const element of document.querySelectorAll('[data-config-at]'))
    element.addEventListener(
      'change',
      async _ => {
        const keys = element.dataset.configAt.split('.')
        const config = await ipcRenderer.invoke('get-config')
        let target = config
        for (const key of keys.slice(0, -1))
          target = (target[key] ??= {})
        const key = keys.at(-1)
        target[key] = actionTemplate[element.type]?.(element) ?? element.value
        await ipcRenderer.invoke('set-config', config)
      }
    )
}

const prepareModalControllers = () => {
  for (const button of document.querySelectorAll('button[data-modal-for]')) {
    const dialog = document.getElementById(button.dataset.modalFor)
    const container = dialog.parentElement
    button.addEventListener(
      'click',
      () => {
        container.style.display = 'block'
        dialog.show()
        const inner = dialog.getBoundingClientRect()
        const outer = container.getBoundingClientRect()
        dialog.style.left = `${(outer.width - inner.width) / 2}px`
        dialog.style.top = `${(outer.height - inner.height) / 2}px`
      }
    )
    for (const close of dialog.querySelectorAll('.close'))
      close.addEventListener(
        'click',
        () => {
          dialog.close()
          container.style.display = 'none'
        }
      )
  }
}

const prepareOpenDirectory = () => {
  for (const button of document.querySelectorAll('[data-opendir-for]'))
    button.addEventListener(
      'click',
      async () => {
        const result = await ipcRenderer.invoke('open-directory')
        if (!result.canceled && result.filePaths.length) {
          const target = document.getElementById(button.dataset.opendirFor)
          target.value = result.filePaths[0]
          target.dispatchEvent(new Event('change'))
        }
      }
    )
}

ipcRenderer.on(
  'count',
  (_, count) => {
    const rightPane = document.getElementById('right-pane')
    const progress = document.getElementById('progress')
    progress.max = count
    progress.value = 0
    const textNode = document.createTextNode('0')
    document.getElementById('percent').append(textNode)
    rightPane.classList.remove('hidden')
  }
)

ipcRenderer.on(
  'download',
  (_, ...args) => document.getElementById('webview').send('download', ...args)
)

ipcRenderer.on(
  'index',
  (_, index) => {
    const progress = document.getElementById('progress')
    const percent = Math.round((index + 1) * 1e7 / progress.max) / 1e5
    progress.value = index
    document.getElementById('percent').innerText = `${percent}`
    for (const tooltip of progress.parentElement.querySelectorAll('.tooltip-text'))
      tooltip.innerText = `${index}/${progress.max}`
  }
)

ipcRenderer.on(
  'status',
  (_, message) => {
    const status = document.getElementById('status')
    status.value = `${status.value}${message}\r\n`
    status.scrollTop = status.scrollHeight
  }
)

const application = new Application()
application.attachTo(window)
