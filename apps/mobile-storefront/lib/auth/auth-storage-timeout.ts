const AUTH_STORAGE_TIMEOUT_MS = 4_000;

class AuthStorageTimeoutError extends Error {}

export const authStorageTimeout = {
  defaultMs: AUTH_STORAGE_TIMEOUT_MS,
  isTimeout(error: unknown): boolean {
    return error instanceof AuthStorageTimeoutError;
  },
  remaining(deadline: number): number {
    return Math.max(0, deadline - Date.now());
  },
  async run<T>(
    operation: Promise<T>,
    operationName: string,
    timeoutMs = AUTH_STORAGE_TIMEOUT_MS,
    deadline?: number
  ): Promise<T> {
    const boundedTimeoutMs = Math.max(
      0,
      Math.min(
        timeoutMs,
        deadline === undefined ? timeoutMs : deadline - Date.now()
      )
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new AuthStorageTimeoutError(
              `Supabase auth storage ${operationName} timed out`
            )
          ),
        boundedTimeoutMs
      );
    });

    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  },
};
