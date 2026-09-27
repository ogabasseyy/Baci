const CHECKOUT_STORAGE_TIMEOUT_MS = 5_000;

export async function withCheckoutStorageTimeout<T>(
  operation: Promise<T>,
  timeoutMs = CHECKOUT_STORAGE_TIMEOUT_MS,
  timeoutMessage = 'Checkout storage write timed out'
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
