import { expect, it } from 'vitest';
import { guestCredentialReply } from './guest-credential-reply';

it('exposes the credential only to the model and uses it in retry instructions', () => {
  const reply = guestCredentialReply({
    content: [{ type: 'text', text: 'Retry with cart_token.' }],
    structuredContent: { success: false, retryable: true, cart_token: '0'.repeat(64) },
  });
  expect(reply.structuredContent).toMatchObject({ cartCredential: 'A'.repeat(43) });
  expect(reply.structuredContent).not.toHaveProperty('cart_token');
  expect(JSON.stringify(reply.content)).toContain('cartCredential');
  expect(JSON.stringify(reply.content)).not.toContain('A'.repeat(43));
});

it('does not stage a replacement when a cart expired', () => {
  const reply = guestCredentialReply({
    content: [{ type: 'text', text: 'Retry without the token.' }],
    structuredContent: { success: false, cart_expired: true },
  });
  expect(JSON.stringify(reply.content)).toContain('Do not start another cart');
});
