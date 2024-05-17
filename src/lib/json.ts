/**
 * 指定した文字列をJSONオブジェクトに変換することを試みる
 * 
 * @param {string} text 任意の文字列
 * 
 * @param {T} alternateValue 変換に失敗した場合の代替となる値
 * 
 * @returns 変換結果
 */
export const tryParseJSON = <T>(text: string, alternateValue: T) => {
  try {
    return JSON.parse(text) as T
  }
  catch (_) {
    return alternateValue
  }
}
