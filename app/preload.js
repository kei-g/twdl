const { ipcRenderer } = require('electron')

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

ipcRenderer.on(
  'lookup-images',
  (_, ...args) => {
    const failure = document.querySelector('div#ScriptLoadFailure:has(>form)')
    if (failure)
      return ipcRenderer.sendToHost('images-found', { abort: true, error: 'スクリプト読み込みエラー' }, ...args)
    const errorDetail = document.querySelector('[data-testid="error-detail"]')
    if (errorDetail) {
      const error = accumulateTextContents(errorDetail.querySelectorAll('div>span:first-child span')).join(',')
      return ipcRenderer.sendToHost('images-found', { error }, ...args)
    }
    const toast = document.querySelector('[data-testid="toast"]')
    if (toast?.innerText === 'そのポストは削除されました。')
      return ipcRenderer.sendToHost('images-found', { error: toast.innerText }, ...args)
    const main = document.querySelector('main[role="main"]')
    if (!main)
      return ipcRenderer.sendToHost('images-found', { error: '<main>タグが無い' }, ...args)
    const progressbars = main.querySelectorAll('div[aria-label][role="progressbar"]')
    if (progressbars.length)
      return ipcRenderer.sendToHost('images-found', { retryLater: true }, ...args)
    const articles = main.querySelectorAll('article')
    const images = { size: 0 }
    if (articles.length)
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
    ipcRenderer.sendToHost('images-found', images, ...args)
  }
)

const twitterImageUrlRE = /^(?<prefix>https:\/\/pbs\.twimg\.com\/media\/)(?<id>[^\?]+)\?format=(?<format>[^&]+)&?.*$/g
