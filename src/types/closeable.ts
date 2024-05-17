/**
 * 非同期のcloseメソッドを持つインターフェイス
 */
export interface Closeable {
  close(): Promise<unknown>
}
