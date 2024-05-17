import { Closeable } from '../index.js'

/**
 * 非同期closeメソッドの呼び出しを良い感じに処理してくれるやつ
 */
export class GracefulCloser<T extends Closeable> implements AsyncDisposable {
  constructor(private readonly target: T) {
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.target.close()
  }
}
