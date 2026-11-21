// @vitest-environment-options {"url":"https://shop.example.com"}
import { describe, expect, it, vi } from 'vitest';
import { installChatwootMessageGuard } from './chatwoot-inbound-message-guard';

function post(data: unknown, origin: string) {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

describe('bugfix: Chatwoot SDK accepted widget messages from any origin', () => {
  it('drops chatwoot-widget messages from other origins before the SDK handler', () => {
    installChatwootMessageGuard('https://support.example.com');
    installChatwootMessageGuard('https://support.example.com');
    const sdkHandler = vi.fn();
    window.addEventListener('message', sdkHandler);
    const forged =
      'chatwoot-widget:{"event":"set-auth-cookie","data":{"x":"y"}}';

    post(forged, 'https://evil.example.net');
    expect(sdkHandler).not.toHaveBeenCalled();

    post(forged, 'https://support.example.com');
    expect(sdkHandler).toHaveBeenCalledTimes(1);

    post('unrelated-message', 'https://evil.example.net');
    expect(sdkHandler).toHaveBeenCalledTimes(2);
    window.removeEventListener('message', sdkHandler);
  });
});
