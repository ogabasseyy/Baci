import { describe, expect, it } from 'vitest';
import { withChatTenantHeader } from './chat-tenant';

describe('withChatTenantHeader', () => {
  it('echoes the resolving tenant slug on the response', () => {
    const response = withChatTenantHeader(new Response('ok'), 'demo-store');

    expect(response.headers.get('x-baci-santa-merchant-slug')).toBe(
      'demo-store'
    );
  });
});
