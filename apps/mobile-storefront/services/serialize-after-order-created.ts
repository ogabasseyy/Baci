const ORDER_CREATED_WAIT_TIMEOUT_MS = 5000;

const orderEmissionTails = new Map<string, Promise<void>>();

function waitWithTimeout(tail: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ORDER_CREATED_WAIT_TIMEOUT_MS);
  });
  return Promise.race([tail, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

// Serializes same-order analytics emissions so the funnel keeps causal
// order: order_created is emitted fire-and-forget on the order response
// path, so later emissions for that order (invoice_generated,
// payment_started, payment_completed, payment_failed) chain behind its
// write instead of racing it. The wait is time-bounded — a stalled store
// delays followers by at most the timeout, never suppresses them.
export function serializeAfterOrderCreated<T>(
  orderId: string,
  task: () => Promise<T> | T
): Promise<T> {
  const prior = orderEmissionTails.get(orderId);
  let releaseTail!: () => void;
  const tail = new Promise<void>((resolve) => {
    releaseTail = resolve;
  });
  orderEmissionTails.set(orderId, tail);
  const run = (async (): Promise<T> => {
    try {
      if (prior) {
        await waitWithTimeout(prior);
      }
      return await task();
    } finally {
      if (orderEmissionTails.get(orderId) === tail) {
        orderEmissionTails.delete(orderId);
      }
      releaseTail();
    }
  })();
  return run;
}
