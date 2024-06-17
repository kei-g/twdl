window.addEventListener(
  'DOMContentLoaded',
  () => {
    const progress = document.getElementById('progress')
    ipcRenderer.on(
      'progress',
      (_, current, total) => progress.textContent = `${current}/${total}`
    )
  }
)
