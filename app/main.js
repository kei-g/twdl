class Application {
  #config = {}
  #controls = {
    beginDownload: undefined,
    cancelDownload: undefined,
    clearDateRanges: undefined,
    configure: undefined,
    selectByDateRange: undefined,
    since: undefined,
    sourceFile: undefined,
    until: undefined,
    webview: undefined,
  }
  #window = undefined

  async #beginDownload() {
    this.#controls.beginDownload.disabled = true
    this.#controls.cancelDownload.disabled = false
    this.#controls.selectByDateRange.disabled = true
    this.#controls.clearDateRanges.disabled = true
    for (const file of this.#controls.sourceFile.files) {
      const name = await file.text()
      await ipcRenderer.invoke('download', name)
    }
    this.#controls.beginDownload.disabled = false
    this.#controls.cancelDownload.disabled = true
    this.#controls.selectByDateRange.disabled = false
    this.#controls.clearDateRanges.disabled = false
  }

  async #clearDateRanges() {
    this.#controls.since.value = undefined
    this.#controls.until.value = undefined
    delete this.#config.range
    await this.#updateConfig()
  }

  async #configure() {
    await ipcRenderer.invoke('configure')
    const config = await ipcRenderer.invoke('get-config')
    const height = `${config.webview?.size?.height ?? 554}px`
    this.#controls.webview.style.minHeight = height
    this.#controls.webview.style.height = height
    this.#controls.webview.setAudioMuted(config.webview?.audioMuted ?? true)
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

  #handleSelectionCompletion() {
    this.#controls.beginDownload.disabled = false
    this.#controls.selectByDateRange.disabled = false
    this.#controls.clearDateRanges.disabled = false
  }

  #handleSourceChange() {
    const shouldDisable = !this.#controls.sourceFile.files.length
    this.#controls.beginDownload.disabled = shouldDisable
    this.#controls.selectByDateRange.disabled = shouldDisable
  }

  async #initializeComponents() {
    this.#config = await ipcRenderer.invoke('get-config')
    this.#resolveControls()
    const audioMuted = this.#config.webview?.audioMuted ?? true
    const webViewHeight = this.#config.webview?.size?.height ?? 554
    this.#controls.sourceFile.addEventListener('change', this.#handleSourceChange.bind(this))
    this.#controls.beginDownload.addEventListener('click', this.#beginDownload.bind(this))
    this.#controls.cancelDownload.addEventListener('click', ipcRenderer.invoke.bind(ipcRenderer, 'message-box', 'キャンセル機能は未実装です'))
    this.#controls.since.addEventListener('change', this.#updateRange.bind(this))
    this.#controls.until.addEventListener('change', this.#updateRange.bind(this))
    this.#controls.selectByDateRange.addEventListener('click', this.#selectByDateRange.bind(this))
    this.#controls.clearDateRanges.addEventListener('click', this.#clearDateRanges.bind(this))
    this.#controls.configure.addEventListener('click', this.#configure.bind(this))
    if (this.#config.webView?.openDevTools)
      this.#controls.webview.addEventListener('dom-ready', this.#openDevTools.bind(this), { once: true })
    this.#controls.webview.style.minHeight = `${webViewHeight}px`
    this.#controls.webview.style.height = `${webViewHeight}px`
    this.#controls.webview.setAudioMuted(audioMuted)
    this.#controls.webview.addEventListener('console-message', this.#handleConsoleMessage.bind(this))
    this.#controls.webview.addEventListener('ipc-message', this.#handleIpcMessage.bind(this))
    if (this.#config.range?.since)
      this.#controls.since.value = this.#config.range.since
    if (this.#config.range?.until)
      this.#controls.until.value = this.#config.range.until
  }

  async #load(_, url) {
    const epoch = Date.now()
    const { initialDelay, period, timeout } = this.#config.timer ?? {
      initialDelay: 100,
      period: 125,
      timeout: 5000,
    }
    const webview = this.#controls.webview
    const task = new Promise(
      resolve => webview.addEventListener('dom-ready', resolve, { once: true })
    )
    await webview.loadURL(url)
    await task
    this.#requestLookupImages(epoch, period, timeout, initialDelay)
  }

  #openDevTools() {
    this.#controls.webview.openDevTools()
  }

  #requestLookupImages(epoch, period, timeout, delay) {
    this.#window.setTimeout(
      this.#controls.webview.send.bind(
        this.#controls.webview,
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

  #resolveControls(context, key) {
    if (context)
      context[key] = this.#window.document.getElementById(hyphenate(key))
    else
      this.#controls = Object.keys(this.#controls).reduce(this.#resolveControls.bind(this), {})
    return context
  }

  async #selectByDateRange() {
    this.#controls.beginDownload.disabled = true
    this.#controls.selectByDateRange.disabled = true
    this.#controls.clearDateRanges.disabled = true
    await ipcRenderer.invoke(
      'select-by-date-range',
      await this.#controls.sourceFile.files.item(0).text(),
      this.#controls.since.value,
      this.#controls.until.value
    )
  }

  async #updateRange(ev) {
    const { id, value } = ev.source
    const obj = {}
    obj[id] = value
    console.log(obj)
    if (!this.#config.range)
      this.#config.range = {}
    this.#config.range[id] = value
    await this.#updateConfig()
  }

  async #updateConfig() {
    await ipcRenderer.invoke('set-config', this.#config)
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

const hyphenate = camelCase => camelCase.replaceAll(/(?<=[a-z])([A-Z][a-z]*)/g, value => `-${value.toLowerCase()}`)

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
