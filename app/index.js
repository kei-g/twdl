const { BrowserWindow, app, dialog, ipcMain } = require('electron')
const { EOL } = require('node:os')
const { appendFile, writeFile, readFile, stat } = require('node:fs/promises')
const { cwd } = require('node:process')
const { join: joinPath } = require('node:path')

class MainWindow extends BrowserWindow {
  #config = {}
  #configPath = ''

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
          contextIsolation: false,
          defaultEncoding: 'UTF-8',
          devTools: config.developmentMode,
          disableHtmlFullscreenWindowResize: true,
          experimentalFeatures: false,
          nodeIntegration: true,
          textAreasAreResizable: false,
          webSecurity: true,
          webviewTag: true,
        },
        width: 1440,
      }
    )
    this.#config = config
    this.#configPath = configPath
    ipcMain.handle('get-config', this.#getConfig.bind(this))
    ipcMain.handle('message-box', this.#messageBox.bind(this))
    ipcMain.handle('open-directory', this.#openDirectory.bind(this))
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
    async (_, text) => await lookup(text, webContents)
  )
  await mainWindow.loadFile('main.html')
  if (config.developmentMode)
    webContents.openDevTools({ mode: 'detach' })
}

const interpretUrl = url => {
  const matched = url.expanded.match(tweetUrlRE)
  if (matched) {
    const { id, user } = matched.groups
    url.id = id
    url.matched = matched[0]
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

const download = async (name, matched, url, webContents) => {
  webContents.send('status', url)
  const channel = `download:${Date.now()}:${Math.random()}`
  const task = waitForEvent(channel)
  webContents.send('download', { channel, url })
  const [res] = await task
  const { data, status, statusText } = res
  if (status === 200)
    await writeFile(joinPath(cwd(), name), data)
  else
    webContents.send('status', `エラーが発生しました, ${statusText}`)
  await appendFile(
    joinPath(cwd(), 'error.csv'),
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

const lookup = async (text, webContents) => {
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
          joinPath(cwd(), 'error.csv'),
          `"${origin}","${url}",-,"${error}"\r\n`
        )
        if (abort)
          return
      }
      else {
        await appendFile(
          joinPath(cwd(), 'error.csv'),
          `"${origin}","${url}",+,"${images.size}個の画像が見つかりました"\r\n`
        )
        for (const name in images) {
          if (name === 'size')
            continue
          const { matched, url } = images[name]
          await download(name, matched, url, webContents)
        }
      }
    }
  }
}

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

const tweetUrlRE = /^https:\/\/(twitter|x)\.com\/(?<user>[^/]+)\/status\/(?<id>\d+)$/

const waitForEvent = eventName => new Promise(
  resolve => ipcMain.once(
    eventName,
    (_, ...args) => resolve(args)
  )
)

app.once('ready', initializeApplication)

app.once('window-all-closed', app.quit.bind(app))
