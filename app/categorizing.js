import { Controller } from './controller.mjs'

class CategorizingController extends Controller {
  #handleColorIndex(_, colorIndex, count) {
    const colorIndices = this.getElementById('color-indices')
    const id = `color-${colorIndex}`
    const text = `${colorIndex.toString(10).padStart(4, '0')} - (${count})`
    const item = document.getElementById(id)
    if (item instanceof HTMLLIElement) {
      item.dataset.count = count
      item.textContent = text
      Array.from(colorIndices.querySelectorAll('li')).sort(
        (lhs, rhs) => parseInt(rhs.dataset.count) - parseInt(lhs.dataset.count)
      ).forEach(
        item => colorIndices.appendChild(item)
      )
    }
    else {
      const item = this.createElement('li')
      item.id = id
      item.dataset.count = count
      item.textContent = text
      colorIndices.appendChild(item)
    }
  }

  #handleProgress(_, current, total) {
    const progress = this.getElementById('progress')
    progress.textContent = `${current}/${total}`
  }

  #handleStatus(_, message) {
    const progress = this.getElementById('progress')
    const status = this.getElementById('status')
    progress.textContent = ''
    status.textContent = message
  }

  constructor() {
    super()
  }

  initializeComponents() {
    super.initializeComponents()
    ipcRenderer.on('color-indices', this.#handleColorIndex.bind(this))
    ipcRenderer.on('progress', this.#handleProgress.bind(this))
    ipcRenderer.on('status', this.#handleStatus.bind(this))
  }
}

const controller = new CategorizingController()
controller.attachTo(window)
