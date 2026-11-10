/**
 * Remembers whether the shopper's own command reached the network during the
 * current edit. Recovering a lost cart creation says nothing about an edit
 * that was never sent.
 */
export function trackTransmission<
  C extends { command: (...args: never[]) => unknown },
>(coordinator: C) {
  let sent = false;
  return {
    coordinator: {
      ...coordinator,
      command: (...args: Parameters<C['command']>) => {
        sent = true;
        return coordinator.command(...args);
      },
    } as C,
    reset: () => {
      sent = false;
    },
    sent: () => sent,
  };
}
