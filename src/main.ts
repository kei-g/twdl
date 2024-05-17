#!/usr/bin/env node

import { DirectMessageEntry, GracefulCloser, TweetURL, delay, tryParseJSON } from './index.js'
import { Page, launch } from 'puppeteer'
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

const composeURLs = (entry: TweetURL) => `${entry.url}=${entry.expanded}`

const createDirectoryIfNecessary = async (name: string) => {
  if (!existsSync(name))
    await mkdir(name)
}

/**
 * 指定したテキストに含まれる画像URLを検出してダウンロードする
 * 
 * @param {Page} page PuppeteerのPageオブジェクト
 * 
 * @param {string} text ツイート本文
 */
const downloadImages = async (page: Page, text: string) => {
  const baseName = 'twitter'
  const path = join(baseName, 'notfound.txt')
  const { stdout } = process
  for (const matched of text.matchAll(tweetUrlRE)) {
    const url = matched[0]
    stdout.write(`Looking \x1b[32m${url}\x1b[m `)
    await page.goto(url)
    const files = await extractImageURLs(page)
    if (files.size === 0) {
      stdout.write('\x1b[31mNot found\x1b[m\n')
      await createDirectoryIfNecessary(baseName)
      await appendFile(path, url + '\r\n')
    }
    else {
      stdout.write('\x1b[36mFound\x1b[m\n')
      for (const [name, url] of files.entries()) {
        stdout.write(`Downloading \x1b[32m${url}\x1b[m`)
        const res = await fetch(url)
        if (res.status === 200) {
          stdout.write(` => ${name}`)
          const blob = await res.blob()
          const data = Buffer.from(await blob.arrayBuffer())
          await createDirectoryIfNecessary(baseName)
          await writeFile(join(baseName, name), data)
          stdout.write(' [\x1b[32mOK\x1b[m]\n')
        }
        else
          stdout.write(` [\x1b[31mNG\x1b[m] \x1b[33m${res.status}\x1b[m "${res.statusText}"\n`)
      }
    }
  }
}

/**
 * 指定したページに含まれる画像のURLを抽出する
 * 
 * @param {Page} page PuppeteerのPageオブジェクト
 * 
 * @returns {Promise<Map<string, string>>} 画像の名前をキーとして対応するURLを格納した連想配列
 */
const extractImageURLs = async (page: Page): Promise<Map<string, string>> => {
  const files = new Map<string, string>()
  for (let i = 0; !files.size && i < 64; i++) {
    await delay(250)
    const content = await page.content()
    for (const matched of content.matchAll(twitterImageUrlRE)) {
      const { id, format } = matched.groups
      const name = `${id}.${format}`
      const index = matched[0].indexOf('?')
      const url = `${matched[0].substring(0, index)}.${format}:large`
      files.set(name, url)
    }
  }
  return files
}

/**
 * メイン処理
 */
const main = async () => {
  const browser = await launch({ headless: true })
  await using _ = new GracefulCloser(browser)
  const page = await browser.newPage()
  for (const path of process.argv.slice(2).filter(existsSync)) {
    const data = await readFile(path)
    const text = data.toString()
    const index = text.indexOf('[')
    const json = tryParseJSON(text.substring(index), [] as DirectMessageEntry[])
    for (const { dmConversation } of json) {
      const { messages } = dmConversation
      for (const { messageCreate } of messages) {
        const { recipientId, senderId, urls } = messageCreate
        const map = urls.map(composeURLs).join(', ')
        process.stdout.write(`\x1b[33m${senderId}\x1b[m => \x1b[33m${recipientId}\x1b[m: ${map}\n`)
        for (const { expanded } of urls)
          await downloadImages(page, expanded)
      }
    }
  }
}

/**
 * ツイートURLに一致する正規表現
 */
const tweetUrlRE = /https:\/\/((x|twitter)\.com\/[^/]+\/status\/\d+|t\.co\/[\d\w]+)/g

/**
 * Twitterの画像URLに一致する正規表現
 */
const twitterImageUrlRE = /(?<=src=")https:\/\/pbs\.twimg\.com\/media\/(?<id>[^?]+)\?format=(?<format>[^&"]+)[^"]*(?=")/g

main()
