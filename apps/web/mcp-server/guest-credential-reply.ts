export function guestCredentialReply<
  T extends { structuredContent: Record<string, unknown> },
>(reply: T) {
  const { cart_token, ...state } = reply.structuredContent;
  const credential =
    typeof cart_token === 'string' && /^[a-f0-9]{64}$/.test(cart_token)
      ? Buffer.from(cart_token, 'hex').toString('base64url')
      : undefined;
  const recoveryText = state.cart_expired === true
    ? 'This guest cart expired or is no longer available. Explain that the existing cart could not be opened or updated. Do not start another cart unless the shopper asks.'
    : state.retryable === true && credential
      ? 'Read the current cart with the returned cartCredential. If retrying an update whose outcome is unknown, retain its operationId. Do not create a second cart.'
      : undefined;
  return {
    ...reply,
    ...(recoveryText
      ? { content: [{ type: 'text' as const, text: recoveryText }] }
      : {}),
    structuredContent: {
      ...state,
      ...(credential && state.cart_emptied !== true
        ? { cartCredential: credential }
        : {}),
    },
  };
}
