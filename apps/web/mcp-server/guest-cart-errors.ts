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
