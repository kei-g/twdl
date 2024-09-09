#!/usr/bin/env node

const { argv, env } = await import('node:process')
const { readFile } = await import('node:fs/promises')
const { promisify } = await import('node:util')
const { spawn } = await import('node:child_process')

class StringSeparator {
  #clearEscape(_c) {
    this.escape = false
  }

  #handleEscape(_c) {
    this.escape = true
  }

  #handleQuote(c) {
    if (this.quotes.at(-1) === c) {
      this.quotes.pop()
      this.level--
    }
    else {
      this.quotes.push(c)
      this.level++
    }
  }

  #handleSpace(_c) {
    if (this.level === 0)
      return this.#updateLast.bind(this)
  }

  #handlers = {
    ' ': this.#handleSpace,
    '"': this.#handleQuote,
    '\'': this.#handleQuote,
    '\\': this.#handleEscape,
  }

  #updateLast(index, target) {
    const matched = target.substring(index).match(/[^ ]/)
    if (matched)
      this.last = index + matched.index
  }

  constructor() {
    this.escape = false
    this.last = 0
    this.level = 0
    this.quotes = []
  }

  accept(c) {
    const handler = [this.#handlers[c], this.#clearEscape][+this.escape]
    return handler?.apply(this, [c])
  }
}

String.prototype.entries = function () {
  return Array.from(new Array(this.length).keys()).map(i => [i, this[i]])
}

String.prototype.separate = function* () {
  const separator = new StringSeparator()
  for (const [i, c] of this.entries()) {
    const update = separator.accept(c)
    if (update) {
      yield this.substring(separator.last, i)
      update(i + 1, this)
    }
  }
  yield this.substring(separator.last)
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

const run = async (args, scripts) => {
  for (const name of args)
    if (name in scripts) {
      const command = scripts[name]
      const separated = Array.from(command.separate())
      const index = separated.indexOf('&&')
      const rhs = index < 0 ? [] : separated.splice(index)
      const procedure = [
        execute.bind(this, separated),
        run.bind(this, separated.slice(1), scripts),
      ][+(separated[0] === 'tools/run.mjs')]
      await procedure()
      rhs.shift()
      await execute(rhs)
    }
    else {
      const command = name.replace(
        /^(?:'([^']+)'|"([^"]+)")$/,
        (_, singleQuote, doubleQuote) => singleQuote ?? doubleQuote
      )
      const separated = Array.from(command.separate())
      await execute(separated)
    }
}

const { scripts } = await readFile('package.json').then(data => JSON.parse(data.toString()))
await run(argv.slice(2), scripts)
