#!/usr/bin/env node

const { EOL } = await import('node:os')
const { argv, stdout } = await import('node:process')
const { join: joinPath } = await import('node:path')
const { readFile } = await import('node:fs/promises')

const flags = {}
for (const arg of argv.slice(2))
  if (arg.startsWith('--'))
    flags[arg.substring(2)] = arg.split('=').slice(1).join('=')

const name = 'package.json'
const path = [name, joinPath('app', name)][+!!flags.file]
const data = await readFile(path).catch(() => Buffer.from('{}'))

const { version } = JSON.parse(data.toString())
stdout.write(`${version}${EOL}`)
