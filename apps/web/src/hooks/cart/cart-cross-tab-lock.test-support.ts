/** Deterministic shared/exclusive lock scheduler shared by isolated module realms. */
type LockTask = {
  mode: LockMode;
  signal?: AbortSignal;
  start(): void;
  abort(): void;
};

/** Deterministic shared/exclusive lock scheduler shared by isolated module realms. */
export class CookieLockHarness {
  private lanes = new Map<
    string,
    { holders: number; exclusive: boolean; queue: LockTask[] }
  >();

  private lane(name: string) {
    let lane = this.lanes.get(name);
    if (!lane) {
      lane = { holders: 0, exclusive: false, queue: [] };
      this.lanes.set(name, lane);
    }
    return lane;
  }

  request<T>(
    name: string,
    options: LockOptions,
    callback: () => T | Promise<T>
  ): Promise<T> {
    const lane = this.lane(name);
    return new Promise<T>((resolve, reject) => {
      const task: LockTask = {
        mode: options.mode ?? 'exclusive',
        signal: options.signal,
        abort: () => {
          const index = lane.queue.indexOf(task);
          if (index < 0) return;
          lane.queue.splice(index, 1);
          reject(new DOMException('Lock request aborted', 'AbortError'));
          this.pump(lane);
        },
        start: () => {
          options.signal?.removeEventListener('abort', task.abort);
          lane.holders += 1;
          lane.exclusive = task.mode === 'exclusive';
          void Promise.resolve()
            .then(callback)
            .then(resolve, reject)
            .finally(() => {
              lane.holders -= 1;
              if (!lane.holders) lane.exclusive = false;
              this.pump(lane);
            });
        },
      };
      lane.queue.push(task);
      options.signal?.addEventListener('abort', task.abort, { once: true });
      if (options.signal?.aborted) task.abort();
      else this.pump(lane);
    });
  }
  private pump(lane: {
    holders: number;
    exclusive: boolean;
    queue: LockTask[];
  }) {
    if (lane.exclusive) return;
    while (lane.queue.length) {
      const task = lane.queue[0];
      if (task.mode === 'exclusive' && lane.holders) return;
      lane.queue.shift();
      task.start();
      if (task.mode === 'exclusive') return;
    }
  }
}
