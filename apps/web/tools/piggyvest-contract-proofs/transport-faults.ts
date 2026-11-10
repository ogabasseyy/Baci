/**
 * A transport fault for the S8 timeout step: the request really leaves (so
 * the provider may book it) but its response is lost, which is exactly what a
 * timeout on submit looks like. It sits UNDER the guarded fetch, so the guard,
 * the gate and the journal see a normal send followed by a network error, and
 * nothing is captured for the lost response. A live sandbox run cannot force
 * a real timeout, so this stands in for one; it applies to one POST at a time
 * and only after being armed.
 */
export class TransportFaults {
  private armed: string[] = [];

  /** The next POST whose path contains `pathNeedle` loses its response. */
  loseNextResponse(pathNeedle: string): void {
    this.armed.push(pathNeedle);
  }

  pending(): number {
    return this.armed.length;
  }

  clear(): void {
    this.armed = [];
  }

  wrap(base: typeof fetch): typeof fetch {
    return async (input, init) => {
      // fetch(Request) carries its method on the Request, not in init.
      const method = (
        init?.method ?? (input instanceof Request ? input.method : 'GET')
      ).toUpperCase();
      const target =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      // Claim the fault synchronously, before any await: concurrent POSTs
      // would otherwise share a stale index, so one fault could hit two
      // requests or remove the wrong entry.
      const index =
        method === 'POST'
          ? this.armed.findIndex((needle) => target.includes(needle))
          : -1;
      const claimed = index >= 0;
      if (claimed) this.armed.splice(index, 1);
      const response = await base(input, init);
      if (!claimed) return response;
      // The response is lost: release its unread body instead of leaking it.
      await response.body?.cancel().catch(() => undefined);
      throw new TypeError('fetch failed');
    };
  }
}
