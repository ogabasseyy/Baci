// Graceful shutdown sequencing, extracted for testing: stop accepting
// requests, drain in-flight work, and only then release the guest-cart
// lock. Releasing before the drain would let a replacement write the same
// carts concurrently while old updates are still awaiting validation or
// filesystem I/O, discarding one side's lines. While we drain, the
// heartbeat keeps our claim fresh so a replacement refuses instead of
// racing us.
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
    options.closeServer(() => {
      options.releaseLocks();
      options.exit(0);
    });
  };
}
