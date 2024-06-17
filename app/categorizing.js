class CategorizingController {
  #window = undefined

  #handleColorIndex(_, colorIndex, count) {
    const { document } = this.#window
    const colorIndices = document.getElementById('color-indices')
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
      const item = document.createElement('li')
      item.id = id
      item.dataset.count = count
      item.textContent = text
      colorIndices.appendChild(item)
    }
  }

  #handleProgress(_, current, total) {
    const { document } = this.#window
    const progress = document.getElementById('progress')
    progress.textContent = `${current}/${total}`
  }

  #handleStatus(_, message) {
    const { document } = this.#window
    const progress = document.getElementById('progress')
    const status = document.getElementById('status')
    progress.textContent = ''
    status.textContent = message
  }

  #initializeComponents() {
    ipcRenderer.on('color-indices', this.#handleColorIndex.bind(this))
    ipcRenderer.on('progress', this.#handleProgress.bind(this))
    ipcRenderer.on('status', this.#handleStatus.bind(this))
  }

  attachTo(window) {
    this.#window = window
    window.addEventListener('DOMContentLoaded', this.#initializeComponents.bind(this))
  }
}

const controller = new CategorizingController()
controller.attachTo(window)
