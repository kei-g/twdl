const { ipcRenderer } = require('electron')

class Preload {
  #caught = []
  #window = undefined

  #catchRejection(event) {
    this.#caught.push(event)
    event.preventDefault()
    console.error(`[preload] unhandled rejection: ${event.message}`)
  }

  #handleImageElement(images, element) {
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

  #handleLookupImagesRequest(_, ...args) {
    const ctx = {}
    if (this.#caught.length) {
      ctx.abort = true
      ctx.error = this.#caught.splice(0).map(c => c.message).join(',')
    }
    else {
      const failure = this.#querySelector('div#ScriptLoadFailure:has(>form)')
      if (failure) {
        ctx.abort = true
        ctx.error = 'スクリプト読み込みエラー'
      }
      else {
        const mainRoles = this.#querySelectorAll('main[role="main"]')
        if (mainRoles.length === 1) {
          const main = mainRoles.item(0)
          const primaries = main.querySelectorAll('div[data-testid="primaryColumn"]')
          if (primaries.length) {
            primaries.forEach(this.#handlePrimaryColumn.bind(this, ctx))
            if (!ctx.error) {
              const errorDetail = this.#querySelector('[data-testid="error-detail"]')
              if (errorDetail)
                ctx.error = accumulateTextContents(errorDetail.querySelectorAll('div>span:first-child span')).join(',')
              else {
                const toast = this.#querySelector('[data-testid="toast"]')
                if (toast?.innerText === 'そのポストは削除されました。')
                  ctx.error = toast.innerText
                else {
                  const progressbars = main.querySelectorAll('div[aria-label][role="progressbar"]')
                  if (progressbars.length) {
                    ctx.error = accumulateTextContents(progressbars.item(0).querySelectorAll('span')).join(',')
                    ctx.retryLater = true
                  }
                  else {
                    const articles = main.querySelectorAll('article')
                    ctx.size = 0
                    if (articles.length) {
                      const notices = articles.item(0).querySelectorAll('span:has(>span)+a[href="https://help.twitter.com/rules-and-policies/notices-on-twitter"][role="link"][target="_blank"]')
                      notices.length
                        ? ctx.error = accumulateTextContents(notices.item(0).parentElement.children.item(0).querySelectorAll('span')).join(',')
                        : (
                          articles.item(0).querySelectorAll('[src^="https://pbs.twimg.com/media/"]').forEach(this.#handleImageElement.bind(this, ctx)),
                          articles.item(0).querySelectorAll('div[data-testid="tweetPhoto"] div[data-testid="videoComponent"] video').forEach(this.#handleVideoElement.bind(this, ctx))
                        )
                    }
                  }
                }
              }
            }
          }
          else {
            ctx.error = 'primaryColumnが無い'
            ctx.retryLater = true
          }
        }
        else {
          ctx.error = `${mainRoles.length}個の<main>タグ`
          ctx.retryLater = true
        }
      }
    }
    ipcRenderer.sendToHost('images-found', ctx, ...args)
  }

  #handlePrimaryColumn(ctx, primaryColumn) {
    if (!ctx.error) {
      const cells = primaryColumn.querySelectorAll('div[data-testid="cellInnerDiv"]')
      if (!cells.length) {
        const progressbars = primaryColumn.querySelectorAll('div[role="progressbar"]:has(>div>svg>circle)')
        if (progressbars.length) {
          ctx.error = progressbars.item(0).ariaLabel
          ctx.retryLater = true
        }
      }
    }
  }

  #handleVideoElement(images, video) {
    const [label, poster, src, type] = ['aria-label', 'poster', 'src', 'type'].map(video.getAttribute.bind(video))
    const m = src.match(/^(?<prefix>https:\/\/video\.twimg\.com\/tweet_video\/)(?<id>[^.]+)\.(?<format>.+)$/)
    if (m) {
      const { format, id, prefix } = m.groups
      const matched = m[0]
      const name = `${id}.${format}`
      const url = matched
      if (!(name in images)) {
        images[name] = { label, matched, poster, prefix, type, url }
        images.size++
      }
    }
    const t = poster?.match(/^(?<prefix>https:\/\/pbs\.twimg\.com\/[^/]+)\/(?<id>[^.]+)\.(?<format>.+)$/)
    if (t) {
      const { format, id, prefix } = t.groups
      const matched = t[0]
      const name = `${id}.${format}`
      const url = matched
      if (!(name in images)) {
        images[name] = { label, matched, poster, prefix, url }
        images.size++
      }
    }
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
