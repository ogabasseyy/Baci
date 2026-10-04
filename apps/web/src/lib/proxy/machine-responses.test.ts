import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import {
  buildPostHogRelayPassThroughResponse,
  toLlmApiPath,
} from './machine-responses';

describe('machine route responses', () => {
  it('keeps the relay path and strips credentials before origin forwarding', () => {
    const request = new NextRequest('https://shop.example/baci-relay/e', {
      headers: { authorization: 'Bearer token' },
    });
    const response = buildPostHogRelayPassThroughResponse(
      request,
      '/baci-relay/e',
      'Mozilla',
      'shop.example'
    );
    expect(
      response.headers.get('x-middleware-request-authorization')
    ).toBeNull();
  });

  it('maps a storefront markdown document to its merchant LLM API path', () => {
    expect(toLlmApiPath('/llms.txt', 'shop')).toBe('/api/llm/shop/llms.txt');
  });
});
