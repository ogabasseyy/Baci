/** Static messages only: provider responses and submitted identity never escape. */
export class OxygenClientError extends Error {
  constructor(
    public readonly code:
      | 'auth'
      | 'transport'
      | 'invalid'
      | 'http'
      | 'scope'
      | 'busy'
      | 'statement_link_sent'
      | 'recovery',
    public readonly status?: number,
    public readonly dispatchState: 'not_dispatched' | 'unknown' = 'unknown'
  ) {
    super(
      code === 'auth'
        ? 'Please sign in to your account.'
        : 'Oxygen progress could not be confirmed. Check for an update.'
    );
    this.name = 'OxygenClientError';
  }
}
