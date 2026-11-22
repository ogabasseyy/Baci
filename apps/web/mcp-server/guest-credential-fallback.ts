export function withGuestCredentialFallback<
  Input extends {
    quantity: number;
    cartCredential?: string;
    expectedVersion?: number;
    startFreshIfUnavailable?: true;
  },
  Reply extends { structuredContent: Record<string, unknown> },
>(
  enabled: boolean | undefined,
  save: (input: Input) => Promise<Reply>
) {
  return async (input: Input): Promise<Reply> => {
    if (!enabled || input.quantity === 0 || !input.startFreshIfUnavailable) {
      return save(input);
    }
    const freshCartInput = {
      ...input,
      cartCredential: undefined,
      expectedVersion: undefined,
    };
    if (!input.cartCredential) return save(freshCartInput);

    const reply = await save(input);
    // An uncertain write might already have committed. Only a definitive
    // expiry may fall back through the normal creation quota.
    return reply.structuredContent.cart_expired === true
      ? save(freshCartInput)
      : reply;
  };
}
