const { ipcRenderer } = require('electron')

const handleConsoleMessage = e => ([2, 3].includes(e.level) ? [console.warn, console.error][e.level - 2] : console.log)(e.message)

const handleIpcMessage = e => {
  if (e.channel === 'images-found') {
    const [images, { epoch, period, timeout }] = e.args
    const now = Date.now()
    if (epoch + timeout <= now)
      ipcRenderer.send('images-found', { abort: false, error: 'タイムアウト' })
    else if (images.error)
      ipcRenderer.send('images-found', images)
    else if (images.retryLater || images.size === 0)
      setTimeout(
        () => document.getElementById('webview').send(
          'lookup-images',
          {
            epoch,
            period,
            timeout
          }
        ),
        period
      )
    else
      ipcRenderer.send('images-found', images)
  }
  else
    ipcRenderer.send(e.channel, ...e.args)
}

const initializeComponents = async () => {
  const config = await ipcRenderer.invoke('get-config')
  const audioMuted = config.webView?.audioMuted ?? true
  const webViewHeight = config.webView?.size?.height ?? 554
  const source = document.getElementById('source-file')
  source.addEventListener('change', invokeDownload.bind(this, source))
  const webView = document.getElementById('webview')
  if (config.webView?.openDevTools)
    webView.addEventListener('dom-ready', () => webView.openDevTools(), { once: true })
  webView.style.height = `${webViewHeight}px`
  webView.setAudioMuted(audioMuted)
  webView.addEventListener('console-message', handleConsoleMessage)
  webView.addEventListener('ipc-message', handleIpcMessage)
  document.getElementById('destination-directory').value = config.destinationDirectory
  if (config.range?.since)
    document.getElementById('since').value = config.range.since
  if (config.range?.until)
    document.getElementById('until').value = config.range.until
  document.getElementById('initial-delay').value = config.timer?.initialDelay ?? 100
  document.getElementById('timeout').value = config.timer?.timeout ?? 5000
  document.getElementById('period').value = config.timer?.period ?? 125
  const wh = document.getElementById('webview-height')
  wh.addEventListener(
    'change',
    () => webView.style.height = `${wh.value}px`
  )
  wh.value = webViewHeight
  const wam = document.getElementById('webview-audio-muted')
  wam.addEventListener(
    'change',
    () => webView.setAudioMuted(wam.checked)
  )
  wam.checked = audioMuted
  observeConfigurationChanges()
  prepareModalControllers()
  prepareOpenDirectory()
}

const invokeDownload = async (source, _) => await Promise.all(
  [...source.files].map(
    file => file.text().then(
      ipcRenderer.invoke.bind(ipcRenderer, 'download')
    ).catch(() => undefined)
  )
)

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

window.addEventListener('DOMContentLoaded', initializeComponents)

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
  'load',
  async (_, url) => {
    const epoch = Date.now()
    const [initialDelay, period, timeout] = ['initial-delay', 'period', 'timeout'].map(
      id => parseInt(document.getElementById(id).value)
    )
    const webView = document.getElementById('webview')
    const task = new Promise(
      resolve => webView.addEventListener('dom-ready', resolve, { once: true })
    )
    await webView.loadURL(url)
    await task
    setTimeout(
      () => webView.send('lookup-images', { epoch, period, timeout }),
      initialDelay
    )
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
