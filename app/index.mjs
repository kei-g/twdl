const { BrowserWindow, app, dialog, ipcMain, nativeImage } = await import('electron')
const { EOL } = await import('node:os')
const { appendFile, copyFile, mkdir, readFile, readdir, stat, writeFile } = await import('node:fs/promises')
const { cwd } = await import('node:process')
const { existsSync } = await import('node:fs')
const { join: joinPath, resolve: resolvePath, sep } = await import('node:path')

class MainWindow extends BrowserWindow {
  #config = {}
  #configPath = ''

  #analyzeHistogram(context, histogram) {
    context['減色前の色数'] = context.rgb.size
    context['減色後の色数'] = histogram.size
    const average = context.total / 65536
    delete context.total
    context['相加平均'] = average
    const counts = Array.from(histogram.values()).sort(ascending)
    const minimum = counts[0]
    context['ジニ係数'] = 1 - counts.reduce((p, c) => p + c - minimum, 0) * 2 / ((counts.at(-1) - minimum) * histogram.size)
    context.variance = 0
    for (const key of histogram.keys())
      context.variance += Math.pow(key - average, 2)
    context['標準偏差'] = Math.sqrt(context.variance / 65536)
    delete context.variance
  }

  async #categorizeByColor() {
    const { destinationDirectory } = this.#config
    const dialog = new BrowserWindow(
      {
        autoHideMenuBar: true,
        fullscreenable: false,
        hasShadow: true,
        height: 480,
        maximizable: false,
        parent: this,
        resizable: false,
        thickFrame: false,
        titleBarOverlay: true,
        transparent: false,
        webPreferences: {
          allowRunningInsecureContent: false,
          contextIsolation: true,
          defaultEncoding: 'UTF-8',
          disableHtmlFullscreenWindowResize: true,
          experimentalFeatures: false,
          nodeIntegration: false,
          preload: joinPath(app.getAppPath(), 'bridge.cjs'),
          sandbox: true,
          textAreasAreResizable: false,
          webSecurity: true,
          webviewTag: true,
        },
        width: 720,
      }
    )
    await dialog.loadFile('categorizing.html')
    const { webContents } = dialog
    const entries = await readdir(destinationDirectory, { withFileTypes: true })
    const files = entries.filter(e => e.isFile())
    const counters = new Map()
    const forwardMap = new Map()
    webContents.send('status', '画像の最も特徴的な色を検出しています')
    for (let i = 0; i < files.length; i++) {
      webContents.send('progress', i, files.length)
      const file = files[i]
      const colorIndex = await this.#categorizeByColorForFile(destinationDirectory, file)
      if (typeof colorIndex === 'number') {
        const count = (counters.get(colorIndex) ?? 0) + 1
        webContents.send('color-indices', colorIndex, count)
        counters.set(colorIndex, count)
        forwardMap.set(file.name, colorIndex)
      }
    }
    webContents.send('status', 'ファイルをコピーしています')
    for (let i = 0; i < files.length; i++) {
      webContents.send('progress', i, files.length)
      const { name } = files[i]
      const colorIndex = forwardMap.get(name)
      const count = counters.get(colorIndex)
      await this.#copy(
        destinationDirectory,
        name,
        [colorIndex, 9999][+(count < 2)]
      )
    }
    dialog.close()
  }

  async #categorizeByColorForFile(destinationDirectory, file) {
    const path = joinPath(destinationDirectory, file.name)
    const data = await readFile(path)
    const image = nativeImage.createFromBuffer(data)
    if (!image.isEmpty()) {
      const context = {}
      const histogram = new Map()
      this.#createHistogram(context, histogram, image)
      const colorIndex = Array.from(histogram.entries()).sort(ascendByValue).at(-1)[0]
      if (this.#config.developmentMode) {
        this.#analyzeHistogram(context, histogram)
        await writeFile(
          joinPath(dir, file.name.replace(/(?<=\.)[^.]+$/, 'json')),
          JSON.stringify(context, undefined, 2).replaceAll(/\r?\n/g, EOL)
        )
      }
      return colorIndex
    }
  }

  async #copy(baseDirectory, fileName, colorIndex) {
    if (typeof colorIndex === 'number') {
      const name = colorIndex.toString(10).padStart(4, '0')
      const outputDirectory = joinPath(baseDirectory, name)
      if (!existsSync(outputDirectory))
        await mkdir(outputDirectory, { recursive: true })
      const from = joinPath(baseDirectory, fileName)
      const to = joinPath(outputDirectory, fileName)
      await copyFile(from, to)
    }
  }

  #createHistogram(context, histogram, image) {
    const { height, width } = image.getSize()
    const size = Math.min(height, width)
    const cx = width / 2
    const cy = height / 2
    const cropped = image.crop(
      {
        height: size,
        width: size,
        x: cx - size / 2,
        y: cy - size / 2,
      }
    )
    const resized = cropped.resize(
      {
        height: 256,
        width: 256,
      }
    )
    const data = resized.getBitmap()
    context.total = 0
    context.rgb = [new Set()][+!this.#config.developmentMode]
    for (let i = 0, y = 0; y < 256; y++)
      for (let x = 0; x < 256; i++, x++) {
        const red = data.readUint8(i++)
        const green = data.readUint8(i++)
        const blue = data.readUint8(i++)
        context.rgb?.add(red * 65536 + green * 256 + blue)
        const c = {
          x: red * 0.412391 + green * 0.357584 + blue * 0.180481, // 0~242.366280…02
          y: red * 0.212639 + green * 0.715169 + blue * 0.072192, // 0~255.0…03
          z: red * 0.019331 + green * 0.119195 + blue * 0.950532, // 0~277.70979
        }
        const key = Math.floor(c.x * 255 / 3877.86048) * 256 + Math.floor(c.y / 16) * 16 + Math.floor(c.z * 255 / 4443.35664)
        context.total += key
        const count = histogram.get(key) ?? 0
        histogram.set(key, count + 1)
      }
  }

  #getConfig() {
    return Promise.resolve(this.#config)
  }

  #messageBox(_, message) {
    dialog.showMessageBox(
      this,
      {
        message,
        title: app.getName(),
        type: 'warning',
      }
    )
  }

  #openDirectory() {
    return dialog.showOpenDialog(
      this,
      {
        properties: [
          'openDirectory',
        ],
      }
    )
  }

  async #selectByDateRange(_, text, sinceText, untilText) {
    const [since, until] = [
      new Date(sinceText ?? new Date('1970-01-01T00:00:00.000Z').toISOString()).getTime(),
      new Date(untilText).getTime(),
    ].map(purifyNaN(Date.now()))
    const filter = createFilterBetween('at', since, until)
    const index = text.indexOf('[')
    const source = tryParseJSON(text.substring(index), [])
    const ctx = { count: 0, total: 0 }
    const dm = source.map(
      conversation => {
        const { dmConversation: d } = conversation
        const { messages } = d
        d.messages = messages.map(composeMessageWithTimestamp).filter(filter).map(decomposeMessage)
        ctx.count += d.messages.length
        ctx.total += messages.length
        return conversation
      }
    ).filter(containsAnyMessages)
    const { canceled, filePath } = await dialog.showSaveDialog(
      this,
      {
        filters: [
          {
            extensions: [
              'js',
            ],
            name: 'JSファイル',
          }
        ],
        properties: [
          'createDirectory',
          'showOverwriteConfirmation',
        ],
        title: '保存先のJSファイルを指定してください',
      }
    )
    if (canceled)
      this.webContents.send('complete-selection', { canceled })
    else {
      const path = resolvePath(filePath)
      const fileName = path.split(sep).at(-1)
      const json = JSON.stringify(dm, 0, 2).replaceAll(/\r?\n/g, EOL)
      await writeFile(path, Buffer.from(`window.YTD.direct_messages.part0 = ${json}${EOL}`))
      await dialog.showMessageBox(
        this,
        {
          message: `${fileName}は${source.length}件中${dm.length}件の会話と${ctx.total}件中${ctx.count}件のメッセージを含みます${EOL}⚠️このファイルを使用するには再度JSファイルを指定してください`,
          title: `${fileName}にファイルを保存しました`,
          type: 'info',
        }
      )
      this.webContents.send('complete-selection', { fileName })
    }
  }

  async #setConfig(_, config) {
    this.#config = config
    await this.#writeConfig()
  }

  async #writeConfig() {
    await storeConfiguration(this.#configPath, undefined, this.#config)
  }

  constructor(config, configPath) {
    super(
      {
        autoHideMenuBar: true,
        frame: !config.window?.noFrame,
        fullscreenable: false,
        hasShadow: true,
        height: 720,
        maximizable: false,
        resizable: false,
        thickFrame: false,
        titleBarOverlay: true,
        transparent: false,
        webPreferences: {
          allowRunningInsecureContent: false,
          contextIsolation: true,
          defaultEncoding: 'UTF-8',
          devTools: config.developmentMode,
          disableHtmlFullscreenWindowResize: true,
          experimentalFeatures: false,
          nodeIntegration: false,
          preload: joinPath(app.getAppPath(), 'bridge.cjs'),
          sandbox: true,
          textAreasAreResizable: false,
          webSecurity: true,
          webviewTag: true,
        },
        width: 1440,
      }
    )
    this.#config = config
    this.#configPath = configPath
    ipcMain.handle('categorize-by-color', this.#categorizeByColor.bind(this))
    ipcMain.handle('get-config', this.#getConfig.bind(this))
    ipcMain.handle('message-box', this.#messageBox.bind(this))
    ipcMain.handle('open-directory', this.#openDirectory.bind(this))
    ipcMain.handle('select-by-date-range', this.#selectByDateRange.bind(this))
    ipcMain.handle('set-config', this.#setConfig.bind(this))
  }

  async [Symbol.asyncDispose]() {
    await this.#writeConfig()
  }
}

const accumulate = dm => {
  const messages = []
  const count = dm.reduce(
    (t, c) => t + accumulateMessages(c, messages),
    0
  )
  return { count, index: 0, messages }
}

const accumulateMessages = (conversation, messages) => {
  const { dmConversation } = conversation
  return dmConversation.messages.reduce(
    (t, m) => {
      const { conversationId } = dmConversation
      const { createdAt, id, recipientId, senderId, urls } = m.messageCreate
      const timestamp = new Date(createdAt)
      const u = urls.map(interpretUrl).filter(isMatched)
      if (u.length)
        messages.push({ conversationId, id, recipientId, senderId, timestamp, urls: u })
      return t + u.length
    },
    0
  )
}

const ascendByValue = (lhs, rhs) => lhs[1] - rhs[1]

const ascending = (lhs, rhs) => lhs - rhs

const composeMessageWithTimestamp = message => {
  return {
    at: new Date(message.messageCreate.createdAt).getTime(),
    message,
  }
}

const containsAnyMessages = conversation => !!conversation.dmConversation.messages.length

const createFilterBetween = (key, since, until) => m => since <= m[key] && m[key] <= until

const decomposeMessage = composed => composed.message

const fakeUserDataPath = () => {
  const paths = [joinPath(app.getPath('appData'), 'twdl'), app.getPath('userData')]
  const index = +app.isPackaged
  const path = paths[index]
  const setPath = [app.setPath.bind(app)]
  setPath[index]?.('userData', path)
  return path
}

const initializeApplication = async () => {
  const path = joinPath(fakeUserDataPath(), 'twdl.json')
  const config = await loadConfigurationFileFrom(path)
  const mainWindow = new MainWindow(config, path)
  const { webContents } = mainWindow
  ipcMain.handle(
    'download',
    async (_, text) => await lookup(config, text, webContents)
  )
  await mainWindow.loadFile('main.html')
  if (config.developmentMode)
    webContents.openDevTools({ mode: 'detach' })
}

const interpretUrl = url => {
  const matched = url.expanded.match(tweetUrlRE)
  if (matched) {
    const { id, prefix, user } = matched.groups
    url.id = id
    url.matched = matched[0]
    url.prefix = prefix
    url.user = user
  }
  return url
}

const isMatched = value => !!value.matched

const describeMessage = (ctx, message, webContents) => {
  const { conversationId } = message
  if (ctx.conversationId !== conversationId) {
    webContents.send('status', `会話ID=${conversationId}`)
    ctx.conversationId = conversationId
  }
  const timestamp = message.timestamp.toLocaleString('ja')
  webContents.send('status', `${message.id} ${timestamp} ${message.urls.length}個のURL`)
}

const download = async (config, name, matched, url, webContents) => {
  webContents.send('status', url)
  const channel = `download:${Date.now()}:${Math.random()}`
  const task = waitForEvent(channel)
  webContents.send('download', { channel, url })
  const [res] = await task
  const { data, status, statusText } = res
  if (status === 200)
    await writeFile(joinPath(config.destinationDirectory, name.replaceAll(/[/\\]+/g, '-')), data)
  else
    webContents.send('status', `エラーが発生しました, ${statusText}`)
  await appendFile(
    joinPath(config.destinationDirectory, 'error.csv'),
    `"${url}","${matched}",${status},"${statusText}"\r\n`
  )
}

const loadConfigurationFileFrom = async path => {
  const data = await readFile(path).catch(() => Buffer.from('{}'))
  const config = tryParseJSON(data.toString(), {})
  config.destinationDirectory ??= cwd()
  const s = await stat(config.destinationDirectory).catch(returnPseudoStat)
  if (!s.isDirectory())
    config.destinationDirectory = cwd()
  return config
}

const lookup = async (config, text, webContents) => {
  const index = text.indexOf('[')
  const dm = JSON.parse(text.substring(index))
  const ctx = accumulate(dm)
  webContents.send('count', ctx.count)
  webContents.send('status', `ツイートへのリンクが${ctx.count}件あります`)
  for (const message of ctx.messages) {
    describeMessage(ctx, message, webContents)
    for (const { id, matched: url, url: origin, user } of message.urls) {
      webContents.send('index', ctx.index++)
      webContents.send('status', `${ctx.index}/${ctx.count} @${user} ${id} ツイート解析中`)
      const task = waitForEvent('images-found')
      webContents.send('load', url)
      const [images] = await task
      const { abort, error } = images
      if (error) {
        webContents.send('status', error)
        await appendFile(
          joinPath(config.destinationDirectory, 'error.csv'),
          `"${origin}","${url}",-,"${error}"\r\n`
        )
        if (abort)
          return
      }
      else {
        await appendFile(
          joinPath(config.destinationDirectory, 'error.csv'),
          `"${origin}","${url}",+,"${images.size}個の画像が見つかりました"\r\n`
        )
        for (const name in images) {
          if (name === 'size')
            continue
          const { matched, url } = images[name]
          await download(config, name, matched, url, webContents)
        }
      }
    }
  }
}

const purifyNaN = alternateValue => value => [value, alternateValue][+Number.isNaN(value)]

const returnPseudoStat = () => {
  return {
    isDirectory: () => false,
  }
}

const storeConfiguration = async (path, ...args) => {
  const [_, config] = args
  const json = JSON.stringify(config, ' ', 2)
  await writeFile(path, `${json}${EOL}`)
}

const tryParseJSON = (text, alternateValue) => {
  try {
    return JSON.parse(text)
  }
  catch (_) {
    return alternateValue
  }
}

const tweetUrlRE = /^(?<prefix>https:\/\/(twitter|x)\.com\/)(?<user>[^/]+)\/status\/(?<id>\d+)$/

const waitForEvent = eventName => new Promise(
  resolve => ipcMain.once(
    eventName,
    (_, ...args) => resolve(args)
  )
)

if (!app.isPackaged) {
  const data = await readFile('package.json').catch(() => Buffer.from('{}'))
  const { name } = tryParseJSON(data.toString(), {})
  app.setName(name)
}

app.enableSandbox()

app.once('ready', initializeApplication)

app.once('window-all-closed', app.quit.bind(app))
