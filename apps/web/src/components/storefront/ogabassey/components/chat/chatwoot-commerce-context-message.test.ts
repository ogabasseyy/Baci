import { describe, expect, it } from 'vitest';
import { readChatwootCommerceContextMessage } from './chatwoot-commerce-context-message';

const frame = {} as Window;
const event = (origin: string, source: Window, message: { event: string; data: unknown }) =>
  ({
    origin,
    source,
    data: `${message.event}:${JSON.stringify(message.data)}`,
  }) as MessageEvent;

describe('Chatwoot commerce context messages', () => {
  it('accepts only bounded context signals from the exact widget frame and origin', () => {
    const request = {
      event: 'baci-commerce-context-request',
      data: {
        requestId: 'context_123456',
        conversationId: 905,
        websiteToken: 'synthetic-widget-token-123456',
        visitorTokenSha256: 'b'.repeat(64),
      },
    };
    expect(
      readChatwootCommerceContextMessage(
        event('https://widget.test', frame, request),
        'https://widget.test',
        frame
      )
    ).toEqual(request);
    expect(
      readChatwootCommerceContextMessage(
        event('https://evil.test', frame, request),
        'https://widget.test',
        frame
      )
    ).toBeNull();
    expect(
      readChatwootCommerceContextMessage(
        event('https://widget.test', {} as Window, request),
        'https://widget.test',
        frame
      )
    ).toBeNull();
  });
});
