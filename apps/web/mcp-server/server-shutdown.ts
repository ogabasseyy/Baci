// Graceful shutdown sequencing, extracted for testing: stop accepting
// requests, drain in-flight work, then exit. Guest carts need no lock
// release here: the Postgres version gate serializes writers, so a
// replacement starting mid-drain retries on conflict instead of racing us.
export const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;

export function createGracefulShutdown(options: {
  closeServer: (done: () => void) => void;
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
      options.exit(0);
    };
    // A hung keep-alive must not pin the process forever: force the exit
    // so the replacement can start.
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
