export class GuestCartExpiredError extends Error {
  override readonly name = 'GuestCartExpiredError';
  constructor() {
    super('Guest cart expired or was removed');
  }
}

export class GuestCartFullError extends Error {
  override readonly name = 'GuestCartFullError';
  constructor() {
    super('Guest cart is full');
  }
}

export class GuestCartMigratedError extends Error {
  override readonly name = 'GuestCartMigratedError';
  readonly cartId: string | null;
  constructor(cartId?: string | null) {
    super('Guest cart moved to the shared cart; refresh to continue');
    this.cartId = cartId ?? null;
  }
}

export class GuestCartStorageUnavailableError extends Error {
  override readonly name = 'GuestCartStorageUnavailableError';
  // Token-free failure code for health/logs: only the code is safe to
  // surface, never the message.
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/**
 * The legacy creation already persisted before a definitive bridge
 * failure: the failure surfaces unchanged (via the cause), but the
 * creation quota must stay charged because the row now exists.
 */
export class GuestCartPersistedError extends Error {
  override readonly name = 'GuestCartPersistedError';
  constructor(
    readonly cartToken: string,
    readonly cause: unknown
  ) {
    super('Guest cart was persisted before the bridge failure');
  }
}

/** Creation committed before broker delivery; retain this handle on retries. */
export class GuestCartBridgePendingError extends Error {
  constructor(readonly cartToken: string) {
    super('Canonical cart preparation is pending');
  }
}

/** Broker failures are typed without retaining provider messages. */
export class GuestCartCanonicalError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly code:
      | 'version_conflict'
      | 'refresh_required'
      | 'unauthorized'
      | 'temporarily_unavailable'
      | 'invalid_request'
      | 'invalid_item'
      | 'merchant_unavailable'
      | 'merchant_unresolved'
      | 'quota_exceeded'
      | 'rate_limited'
      | 'cart_locked'
      | 'idempotency_conflict'
      | 'merge_conflict'
      | 'handoff_consumed',
    readonly cartToken: string,
    readonly cartId: string | null = null,
    readonly version: number | null = null
  ) {
    super('Canonical cart request could not complete');
    this.retryable =
      code === 'version_conflict' ||
      code === 'refresh_required' ||
      code === 'temporarily_unavailable' ||
      code === 'quota_exceeded' ||
      code === 'rate_limited';
  }
}
