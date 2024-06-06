class Application {
  #config = {}
  #controls = {
    beginDownload: undefined,
    cancelDownload: undefined,
    clearDateRanges: undefined,
    selectByDateRange: undefined,
    since: undefined,
    sourceFile: undefined,
    until: undefined,
    webViewAudioMuted: undefined,
    webViewHeight: undefined,
  }
  #webView = undefined
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

  #changeWebViewAudioMuted() {
    this.#webView.setAudioMuted(this.#controls.webViewAudioMuted.checked)
  }

  #changeWebViewHeight() {
    const height = `${this.#controls.webViewHeight.value}px`
    this.#webView.style.minHeight = height
    this.#webView.style.height = height
  }

  async #clearDateRanges() {
    this.#controls.since.value = undefined
    this.#controls.until.value = undefined
    delete this.#config.range
    await ipcRenderer.invoke('set-config', this.#config)
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
    const config = this.#config
    const audioMuted = config.webView?.audioMuted ?? true
    const webViewHeight = config.webView?.size?.height ?? 554
    this.#controls.sourceFile = this.#getElementById('source-file')
    this.#controls.sourceFile.addEventListener('change', this.#handleSourceChange.bind(this))
    this.#controls.beginDownload = this.#getElementById('begin-download')
    this.#controls.cancelDownload = this.#getElementById('cancel-download')
    this.#controls.beginDownload.addEventListener('click', this.#beginDownload.bind(this))
    this.#controls.cancelDownload.addEventListener('click', ipcRenderer.invoke.bind(ipcRenderer, 'message-box', 'キャンセル機能は未実装です'))
    this.#controls.selectByDateRange = this.#getElementById('select-by-date-range')
    this.#controls.selectByDateRange.addEventListener('click', this.#selectByDateRange.bind(this))
    this.#controls.clearDateRanges = this.#getElementById('clear-date-ranges')
    this.#controls.clearDateRanges.addEventListener('click', this.#clearDateRanges.bind(this))
    const webView = this.#getElementById('webview')
    this.#webView = webView
    if (config.webView?.openDevTools)
      webView.addEventListener('dom-ready', this.#openDevTools.bind(this), { once: true })
    webView.style.height = `${webViewHeight}px`
    webView.setAudioMuted(audioMuted)
    webView.addEventListener('console-message', this.#handleConsoleMessage.bind(this))
    webView.addEventListener('ipc-message', this.#handleIpcMessage.bind(this))
    this.#getElementById('destination-directory').value = config.destinationDirectory
    this.#controls.since = this.#getElementById('since')
    if (config.range?.since)
      this.#controls.since.value = config.range.since
    this.#controls.until = this.#getElementById('until')
    if (config.range?.until)
      this.#controls.until.value = config.range.until
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
      await this.#controls.sourceFile.files.item(0).text(),
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
