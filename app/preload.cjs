const { ipcRenderer } = require('electron')

class Preload {
  #caught = []
  #window = undefined

  #catchRejection(event) {
    this.#caught.push(event)
    event.preventDefault()
    console.error(`[preload] unhandled rejection: ${event.message}`)
  }

  #handleArticles(images, main) {
    const articles = main.querySelectorAll('article')
    images.size = 0
    if (articles.length) {
      const article = articles.item(0)
      const notices = article.querySelectorAll('span:has(>span)+a[href="https://help.twitter.com/rules-and-policies/notices-on-twitter"][role="link"][target="_blank"]')
      if (notices.length) {
        images.error = accumulateTextContents(notices.item(0).parentElement.children.item(0).querySelectorAll('span')).join(',')
        images.errorAt = 'notice'
        delete images.retryLater
        delete images.size
      }
      else {
        article.querySelectorAll('[src^="https://pbs.twimg.com/media/"]').forEach(this.#handleImageElement.bind(this, images))
        article.querySelectorAll('div[data-testid="tweetPhoto"] div[data-testid="videoComponent"] video').forEach(this.#handleVideoElement.bind(this, images))
      }
    }
  }

  async #handleDownloadRequest(_, { channel, url }) {
    const res = await this.#window.fetch(url)
    const { status, statusText } = res
    const result = { status, statusText, url }
    if (status === 200) {
      const blob = await res.blob()
      result.data = new Uint8Array(await blob.arrayBuffer())
    }
    ipcRenderer.sendToHost(channel, result)
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
      ctx.errorAt = 'rejection'
    }
    else {
      const reactRoot = this.#window.document.querySelector('#react-root')
      if (reactRoot)
        this.#handleReactRoot(ctx, reactRoot)
      else {
        ctx.error = 'react-rootが無い'
        ctx.retryLater = true
      }
    }
    ipcRenderer.sendToHost('images-found', ctx, ...args)
  }

  #handleMainRole(ctx, mainRole, reactRoot) {
    const primaries = mainRole.querySelectorAll('div[data-testid="primaryColumn"]')
    if (primaries.length) {
      primaries.forEach(this.#handlePrimaryColumn.bind(this, ctx))
      if (!ctx.error) {
        const errorDetail = reactRoot.querySelector('[data-testid="error-detail"]')
        if (errorDetail) {
          ctx.error = accumulateTextContents(errorDetail.querySelectorAll('div>span:first-child span')).join(',')
          ctx.errorAt = 'error-detail'
          delete ctx.retryLater
        }
        else {
          const toast = reactRoot.querySelector('[data-testid="toast"]')
          if (toast) {
            ctx.error = toast.innerText
            ctx.errorAt = 'toast'
          }
          else {
            const progressbars = mainRole.querySelectorAll('div[aria-label][role="progressbar"]')
            this.#handleProgressbars(ctx, progressbars)
          }
        }
      }
    }
    else {
      ctx.error = 'primaryColumnが無い'
      ctx.retryLater = true
    }
  }

  #handlePrimaryColumn(ctx, primaryColumn) {
    if (!ctx.error) {
      const cells = primaryColumn.querySelectorAll('div[data-testid="cellInnerDiv"]')
      if (!cells.length) {
        const progressbars = primaryColumn.querySelectorAll('div[role="progressbar"]:has(>div>svg>circle)')
        if (progressbars.length) {
          const progressbar = progressbars.item(0)
          ctx.error = progressbar.ariaLabel
          ctx.errorAt = 'progressbar'
          ctx.retryLater = true
        }
      }
    }
  }

  #handleProgressbars(ctx, progressbars) {
    if (progressbars.length) {
      const bar = progressbars.item(0)
      ctx.error = accumulateTextContents(bar.querySelectorAll('span')).join(',')
      ctx.errorAt = 'progressbar@2'
      ctx.retryLater = true
    }
    else
      this.#handleArticles(ctx, mainRole)
  }

  #handleReactRoot(ctx, reactRoot) {
    const failure = reactRoot.querySelector('div#ScriptLoadFailure:has(>form)')
    if (failure) {
      for (const line of failure.innerHTML.replaceAll(/([^\n])</g, '$1\n<').split('\n'))
        console.log(`  ${line}`)
      ctx.abort = true
      ctx.error = `たぶんアクセス制限;「${failure.innerText}」って書いてある`
      ctx.errorAt = 'ScriptLoadFailure'
    }
    else {
      const mainRoles = reactRoot.querySelectorAll('main[role="main"]')
      if (mainRoles.length === 1) {
        const mainRole = mainRoles.item(0)
        this.#handleMainRole(ctx, mainRole, reactRoot)
      }
      else {
        ctx.error = `${mainRoles.length}個の<main>タグ`
        ctx.retryLater = true
      }
    }
  }

  #handleVideoElement(images, video) {
    const [label, poster, src, type] = ['aria-label', 'poster', 'src', 'type'].map(video.getAttribute.bind(video))
    const m = src?.match(/^(?<prefix>https:\/\/video\.twimg\.com\/tweet_video\/)(?<id>[^.]+)\.(?<format>.+)$/)
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

  constructor() {
    ipcRenderer.on('download', this.#handleDownloadRequest.bind(this))
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

const twitterImageUrlRE = /^(?<prefix>https:\/\/pbs\.twimg\.com\/media\/)(?<id>[^\?]+)\?format=(?<format>[^&]+)&?.*$/g

const preload = new Preload()
preload.attachTo(window)
