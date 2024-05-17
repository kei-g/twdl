/**
 * 指定した時間が経過するまで待つ
 * 
 * @param {number} timeout 待機する時間の長さをミリ秒単位で指定する
 */
export const delay = (timeout: number) => new Promise<void>(
  resolve => setTimeout(resolve, timeout)
)
