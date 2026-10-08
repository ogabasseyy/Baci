// Graceful shutdown sequencing, extracted for testing: stop accepting
// requests, drain in-flight work, and only then release the guest-cart
// lock. Releasing before the drain would let a replacement write the same
// carts concurrently while old updates are still awaiting validation or
// filesystem I/O, discarding one side's lines. While we drain, the
// heartbeat keeps our claim fresh so a replacement refuses instead of
// racing us.
export const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;

export function createGracefulShutdown(options: {
  closeServer: (done: () => void) => void;
  releaseLocks: () => void;
  exit: (code: number) => void;
}): () => void {
  return () => {
    console.log(
      JSON.stringify({
        type: 'lifecycle',
        event: 'shutdown',
        timestamp: new Date().toISOString(),
      })
    );
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.releaseLocks();
      options.exit(0);
    };
    // A hung keep-alive must not pin the lock forever while the
    // heartbeat keeps the claim fresh: force the release and exit so a
    // replacement can start.
    const timer = setTimeout(() => {
      console.error(
        JSON.stringify({
          type: 'lifecycle',
          event: 'shutdown-timeout',
          timeoutMs: SHUTDOWN_DRAIN_TIMEOUT_MS,
          timestamp: new Date().toISOString(),
        })
      );
      finish();
    }, SHUTDOWN_DRAIN_TIMEOUT_MS);
    options.closeServer(finish);
  };
}
