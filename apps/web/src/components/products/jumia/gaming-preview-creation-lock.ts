export function acquireGamingPreviewCreationLock(
  merchantId: string
): Promise<(() => void) | null> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    return Promise.reject(
      new Error(
        'This browser cannot safely coordinate Gaming preview creation. Please use an up-to-date browser.'
      )
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    void navigator.locks
      .request(
        `jumia-gaming-preview-create:${merchantId}`,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (!lock) {
            settled = true;
            resolve(null);
            return;
          }
          let unlockLock: () => void = () => undefined;
          const held = new Promise<void>((resolveUnlock) => {
            unlockLock = resolveUnlock;
          });
          let released = false;
          const releaseLock = () => {
            if (released) return;
            released = true;
            unlockLock();
          };
          settled = true;
          resolve(releaseLock);
          await held;
        }
      )
      .catch((error: unknown) => {
        if (!settled) reject(error);
      });
  });
}
