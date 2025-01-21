#!/usr/bin/env node

const { chmod, readFile, stat, writeFile } = await import('node:fs/promises')
const { env, stderr } = await import('node:process')
const { join: joinPath } = await import('node:path')
const { promisify } = await import('node:util')
const { spawn } = await import('node:child_process')

const delay = timeout => new Promise(resolve => setTimeout(resolve, timeout))

const download = async () => {
  const path = joinPath('tools', 'rcedit-x64.exe')
  const statistics = await stat(path).catch(reason => reason)
  if (statistics instanceof Error) {
    const url = 'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe'
    const response = await fetch(url).catch(handleRequestError(url))
    const data = await response.arrayBuffer().catch(handleRequestError(url))
    await writeFile(path, Buffer.from(data))
    await chmod(path, 0o755)
  }
  return path
}

const handleRequestError = url => reason => stderr.write(`Request to ${url} has failed, \x1b[31m${reason}\x1b[m\n`)

const readPackageJson = async dir => {
  const data = await readFile(joinPath(dir, 'package.json')).catch(() => Buffer.from('{}'))
  return JSON.parse(data.toString())
}

const downloading = download()

const xvfb = spawn('Xvfb', [':1', '-screen', '0', '1920x1080x24'], { env })
console.log({ xvfb: xvfb.pid })
await delay(125)

env.DISPLAY = ':1'
const winecfg = spawn('winecfg', { env })
winecfg.stderr.pipe(stderr)
winecfg.stdout.pipe(stderr)
console.log({ winecfg: winecfg.pid })

for (const key of ['Tab', 'Tab', 'Tab', 'Return']) {
  await delay(125)
  const xdotool = spawn('xdotool', ['key', key], { env })
  console.log({ key, xdotool: xdotool.pid })
  await promisify(xdotool.on.bind(xdotool))('exit')
}

await delay(125)
winecfg.kill('SIGINT')

await Promise.all(
  ['linux', 'win'].map(
    async platform => {
      const npm = spawn(
        'npm',
        [
          'exec',
          '--workspace',
          'app',
          '--',
          'electron-builder',
          'build',
          '--dir',
          `--${platform}`,
          '--x64',
        ],
        {
          env,
        }
      )
      console.log({ npm: npm.pid, platform })
      npm.stderr.pipe(stderr)
      npm.stdout.pipe(stderr)
      await promisify(npm.on.bind(npm))('exit').catch(() => 0)
    }
  )
)

const applicationConfig = await readPackageJson('app')
const productConfig = await readPackageJson('.')
const path = await downloading
env.PATH = `/usr/lib/wine:${env.PATH}`
const rcedit = spawn(
  'wine64',
  [
    path,
    joinPath('app', 'dist', 'win-unpacked', 'twdl.exe'),
    '--set-file-version',
    applicationConfig.version,
    '--set-icon',
    'app/dist/.icon-ico/icon.ico',
    '--set-product-version',
    productConfig.version,
    ...Object.entries(
      {
        CompanyName: 'kei-g',
        FileDescription: 'Twitterの画像を一括ダウンロードします',
        InternalName: productConfig.name,
        LegalCopyright: 'Copyright © 2024 kei-g',
        OriginalFileName: `${productConfig.name}.exe`,
        ProductName: productConfig.description,
      }
    ).flatMap(
      ([key, value]) => [
        '--set-version-string',
        key,
        value
      ]
    ),
  ],
  {
    env,
  }
)
rcedit.stderr.pipe(stderr)
rcedit.stdout.pipe(stderr)
await promisify(rcedit.on.bind(rcedit))('exit')

await delay(125)
xvfb.kill('SIGINT')
