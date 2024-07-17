#!/usr/bin/env node

const { argv, env, stderr } = await import('node:process')
const { readFile } = await import('node:fs/promises')
const { promisify } = await import('node:util')
const { spawn } = await import('node:child_process')

String.prototype.separate = function* () {
  const ctx = {
    escape: false,
    last: 0,
    level: 0,
    quotes: [],
  }
  for (const [index, c] of Object.entries(this)) {
    const i = parseInt(index, 10)
    if (ctx.escape)
      ctx.escape = false
    else if (c === '\\')
      ctx.escape = true
    else if (['\'', '"'].includes(c)) {
      if (ctx.quotes.at(-1) === c) {
        ctx.quotes.pop()
        ctx.level--
      }
      else {
        ctx.quotes.push(c)
        ctx.level++
      }
    }
    else if (c === ' ' && ctx.level === 0) {
      yield this.substring(ctx.last, i)
      const matched = this.substring(i + 1).match(/[^ ]/)
      if (matched)
        ctx.last = i + 1 + matched.index
    }
  }
  yield this.substring(ctx.last)
}

const execute = async args => {
  if (args.length) {
    const cp = spawn(
      args[0],
      args.slice(1),
      {
        env,
        stdio: 'inherit',
      }
    )
    await promisify(cp.on.bind(cp))('exit')
  }
}

const run = async args => {
  for (const name of args)
    if (name in scripts) {
      const command = scripts[name]
      const separated = Array.from(command.separate())
      const index = separated.indexOf('&&')
      const rhs = index < 0 ? [] : separated.splice(index)
      await (separated[0] === 'tools/run.mjs' ? run(separated.slice(1)) : execute(separated))
      rhs.shift()
      await execute(rhs)
    }
    else {
      const separated = Array.from(
        name.replace(
          /^(?:'([^']+)'|"([^"]+)")$/,
          (_, singleQuote, doubleQuote) => singleQuote ?? doubleQuote
        ).separate()
      )
      await execute(separated)
    }
}

const { scripts } = await readFile('package.json').then(data => JSON.parse(data.toString()))
await run(argv.slice(2))
