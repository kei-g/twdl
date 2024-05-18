#!/usr/bin/env node

const { argv, stdout } = await import('node:process')
const { existsSync } = await import('node:fs')
const { join: joinPath, sep } = await import('node:path')
const { mkdir } = await import('node:fs/promises')

for (const path of argv.slice(2)) {
  const separated = path.split(sep)
  const queue = []
  while (separated.length) {
    const directory = separated.shift()
    const current = joinPath(...queue, directory)
    queue.push(directory)
    if (!existsSync(current)) {
      await mkdir(current)
      stdout.write(`mkdir: ディレクトリ '${current}' を作成しました\n`)
    }
  }
}
