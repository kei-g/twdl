const { ipcRenderer } = require('electron')

class Preload {
  #caught = []
  #window = undefined

  #catchRejection(event) {
    this.#caught.push(event)
    event.preventDefault()
    console.error(`[preload] unhandled rejection: ${event.message}`)
  }

  #handleLookupImagesRequest(_, ...args) {
    if (this.#caught.length)
      return ipcRenderer.sendToHost('images-found', { abort: true, error: this.#caught.splice(0).map(c => c.message).join(',') }, ...args)
    const failure = this.#querySelector('div#ScriptLoadFailure:has(>form)')
    if (failure)
      return ipcRenderer.sendToHost('images-found', { abort: true, error: 'スクリプト読み込みエラー' }, ...args)
    const errorDetail = this.#querySelector('[data-testid="error-detail"]')
    if (errorDetail) {
      const error = accumulateTextContents(errorDetail.querySelectorAll('div>span:first-child span')).join(',')
      return ipcRenderer.sendToHost('images-found', { error }, ...args)
    }
    const toast = this.#querySelector('[data-testid="toast"]')
    if (toast?.innerText === 'そのポストは削除されました。')
      return ipcRenderer.sendToHost('images-found', { error: toast.innerText }, ...args)
    const main = this.#querySelector('main[role="main"]')
    if (!main)
      return ipcRenderer.sendToHost('images-found', { error: '<main>タグが無い' }, ...args)
    const progressbars = main.querySelectorAll('div[aria-label][role="progressbar"]')
    if (progressbars.length)
      return ipcRenderer.sendToHost('images-found', { retryLater: true }, ...args)
    const articles = main.querySelectorAll('article')
    const images = { size: 0 }
    if (articles.length) {
      const notices = articles.item(0).querySelectorAll('span:has(>span)+a[href="https://help.twitter.com/rules-and-policies/notices-on-twitter"][role="link"][target="_blank"]')
      if (notices.length) {
        const error = accumulateTextContents(notices.item(0).parentElement.children.item(0).querySelectorAll('span')).join(',')
        return ipcRenderer.sendToHost('images-found', { error }, ...args)
      }
      articles.item(0).querySelectorAll('[src^="https://pbs.twimg.com/media/"]').forEach(
        element => {
          const src = element.getAttribute('src')
          for (const m of src.matchAll(twitterImageUrlRE)) {
            const { format, id, prefix } = m.groups
            const matched = m[0]
            const name = `${id}.${format}`
            const url = `${prefix}${name}:large`
            if (name in images)
              continue
            images[name] = { matched, url }
            images.size++
          }
        }
      )
    }
    ipcRenderer.sendToHost('images-found', images, ...args)
  }

  #querySelector(selectors) {
    return this.#window.document.querySelector(selectors)
  }

  #querySelectorAll(selectors) {
    return this.#window.document.querySelectorAll(selectors)
  }

  constructor() {
    ipcRenderer.on('lookup-images', this.#handleLookupImagesRequest.bind(this))
  }

  attachTo(window) {
    this.#window = window
    window.addEventListener('unhandledrejection', this.#catchRejection.bind(this))
  }
}

const accumulateTextContents = nodes => {
  const list = []
  nodes.forEach(
    element => element.childElementCount === 0 && element.childNodes.forEach(
      node => list.push(node.textContent)
    )
  )
  return list
}

ipcRenderer.on(
  'download',
  async (_, { channel, url }) => {
    const res = await window.fetch(url)
    const { status, statusText } = res
    const result = { status, statusText, url }
    if (status === 200) {
      const blob = await res.blob()
      result.data = new Uint8Array(await blob.arrayBuffer())
    }
    ipcRenderer.sendToHost(channel, result)
  }
)

const twitterImageUrlRE = /^(?<prefix>https:\/\/pbs\.twimg\.com\/media\/)(?<id>[^\?]+)\?format=(?<format>[^&]+)&?.*$/g

const preload = new Preload()
preload.attachTo(window)
