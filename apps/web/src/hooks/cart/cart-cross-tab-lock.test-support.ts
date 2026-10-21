/** Deterministic shared/exclusive lock scheduler shared by isolated module realms. */
export class CookieLockHarness {
  private holders = 0;
  private exclusive = false;
  private queue: {
    mode: LockMode;
    signal?: AbortSignal;
    start(): void;
    abort(): void;
  }[] = [];

  request<T>(
    _name: string,
    options: LockOptions,
    callback: () => T | Promise<T>
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task = {
        mode: options.mode ?? 'exclusive',
        signal: options.signal,
        abort: () => {
          const index = this.queue.indexOf(task);
          if (index < 0) return;
          this.queue.splice(index, 1);
          reject(new DOMException('Lock request aborted', 'AbortError'));
          this.pump();
        },
        start: () => {
          options.signal?.removeEventListener('abort', task.abort);
          this.holders += 1;
          this.exclusive = task.mode === 'exclusive';
          void Promise.resolve()
            .then(callback)
            .then(resolve, reject)
            .finally(() => {
              this.holders -= 1;
              if (!this.holders) this.exclusive = false;
              this.pump();
            });
        },
      };
      this.queue.push(task);
      options.signal?.addEventListener('abort', task.abort, { once: true });
      if (options.signal?.aborted) task.abort();
      else this.pump();
    });
  }
  private pump() {
    if (this.exclusive) return;
    while (this.queue.length) {
      const task = this.queue[0];
      if (task.mode === 'exclusive' && this.holders) return;
      this.queue.shift();
      task.start();
      if (task.mode === 'exclusive') return;
    }
  }
}
