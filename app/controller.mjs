export class Controller {
  #window = new WeakMap()

  constructor() {
  }

  attachTo(window) {
    this.#window.set(this, window)
    window.addEventListener('DOMContentLoaded', this.initializeComponents.bind(this))
  }

  createElement(tagName) {
    return this.#window.get(this)?.document.createElement(tagName)
  }

  getElementById(elementId) {
    return this.#window.get(this)?.document.getElementById(elementId)
  }

  initializeComponents() {
  }
}
