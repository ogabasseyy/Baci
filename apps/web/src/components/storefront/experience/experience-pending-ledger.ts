/** UI correlation only. Existing Baci provider owns all later live cart transport. */
export function createPendingLedger() {
  const pending = new Map<
    string,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  return {
    wait(id: string, timeoutMs = 10000) {
      if (pending.has(id) || pending.size >= 128)
        throw Error('INVALID_REQUEST');
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error('Request timed out; reconcile this operation.'));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
      });
    },
    settle(id: string, value: unknown) {
      const p = pending.get(id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(id);
      p.resolve(value);
    },
    destroy() {
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(Error('LAUNCH_EXPIRED'));
      }
      pending.clear();
    },
  };
}
