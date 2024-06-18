import { Controller } from './controller.mjs'

class SettingsController extends Controller {
  async #categorizeByColor(event) {
    const { target } = event
    target.disabled = true
    await ipcRenderer.invoke('categorize-by-color')
    target.disabled = false
  }

  async #handleConfigDataChange(actionTemplate, element) {
    const keys = element.dataset.configAt.split('.')
    const config = await ipcRenderer.invoke('get-config')
    let target = config
    for (const key of keys.slice(0, -1))
      target = (target[key] ??= {})
    const key = keys.at(-1)
    target[key] = actionTemplate[element.type]?.(element) ?? element.value
    await ipcRenderer.invoke('set-config', config)
  }

  #observeControlChanges() {
    const actionTemplate = {
      checkbox: element => element.checked,
      number: element => parseInt(element.value),
    }
    for (const element of this.querySelectorAll('[data-config-at]')) {
      element.addEventListener('change', this.#handleConfigDataChange.bind(this, actionTemplate, element))
      element.addEventListener('input', this.#handleConfigDataChange.bind(this, actionTemplate, element))
    }
  }

  #prepareOpenDirectory() {
    for (const button of this.querySelectorAll('[data-opendir-for]'))
      button.addEventListener(
        'click',
        async () => {
          const result = await ipcRenderer.invoke('open-directory')
          if (!result.canceled && result.filePaths.length) {
            const target = this.getElementById(button.dataset.opendirFor)
            target.value = result.filePaths[0]
            target.dispatchEvent(new Event('change'))
          }
        }
      )
  }

  constructor() {
    super()
  }

  async initializeComponents() {
    await super.initializeComponents()
    this.#observeControlChanges()
    this.#prepareOpenDirectory()
    const categorizeByColor = this.getElementById('categorize-by-color')
    categorizeByColor.addEventListener('click', this.#categorizeByColor.bind(this))
    const config = await ipcRenderer.invoke('get-config')
    this.getElementById('destination-directory').value = config.destinationDirectory
    this.getElementById('initial-delay').value = config.timer?.initialDelay ?? 100
    this.getElementById('period').value = config.timer?.period ?? 125
    this.getElementById('timeout').value = config.timer?.timeout ?? 5000
    this.getElementById('webview-audio-muted').checked = config.webview?.audioMuted ?? true
    this.getElementById('webview-height').value = config.webview?.size?.height ?? 554
  }
}

const controller = new SettingsController()
controller.attachTo(window)
