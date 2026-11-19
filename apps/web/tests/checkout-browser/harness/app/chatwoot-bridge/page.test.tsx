import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ChatwootBridgeFixturePage from './page';

afterEach(() => {
  delete document.documentElement.dataset.chatwootBridgeReady;
  delete document.documentElement.dataset.untrustedMessageSeen;
  vi.unstubAllGlobals();
});

it('ignores a trusted-origin message from the wrong widget source', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<ChatwootBridgeFixturePage />);
  const untrustedFrame = screen.getByTitle('Untrusted synthetic widget');
  const trustedFrame = screen.getByTitle('Synthetic Chatwoot widget');
  if (
    !(untrustedFrame instanceof HTMLIFrameElement) ||
    !(trustedFrame instanceof HTMLIFrameElement)
  )
    throw new Error('Expected the synthetic widgets to render as iframes');
  expect(untrustedFrame.contentWindow).not.toBe(trustedFrame.contentWindow);

  await waitFor(() => {
    expect(document.documentElement.dataset.chatwootBridgeReady).toBe('true');
  });

  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://support.example.test',
        source: untrustedFrame.contentWindow,
        data: `baci-commerce-context-request:${JSON.stringify({
          requestId: 'untrusted_request_1',
          conversationId: 905,
          websiteToken: 'synthetic-widget-token-123456',
          visitorTokenSha256: 'b'.repeat(64),
        })}`,
      })
    );
  });

  expect(fetchMock).not.toHaveBeenCalled();
});

it('requests a challenge for a trusted widget message after provisioning the fixture cart session', async () => {
  const fetchMock = vi.fn(async () => {
    throw new Error('offline fixture');
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<ChatwootBridgeFixturePage />);
  const trustedFrame = screen.getByTitle('Synthetic Chatwoot widget');
  if (!(trustedFrame instanceof HTMLIFrameElement))
    throw new Error('Expected the synthetic widget to render as an iframe');

  await waitFor(() => {
    expect(document.documentElement.dataset.chatwootBridgeReady).toBe('true');
  });

  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://support.example.test',
        source: trustedFrame.contentWindow,
        data: `baci-commerce-context-request:${JSON.stringify({
          requestId: 'context_123456',
          conversationId: 905,
          websiteToken: 'synthetic-widget-token-123456',
          visitorTokenSha256: 'b'.repeat(64),
        })}`,
      })
    );
  });

  // Without ensureSharedCartSession on the fixture cart context the handshake
  // denies the request before any server call; this guards the harness wiring.
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/chatwoot/context/challenge'),
      expect.anything()
    );
  });
});

it('renders both synthetic widgets and signals readiness after mounting the bridge', async () => {
  render(<ChatwootBridgeFixturePage />);

  expect(
    screen.getByRole('heading', { name: 'Chatwoot bridge transport fixture' })
  ).toBeVisible();
  expect(screen.getByTitle('Synthetic Chatwoot widget')).toHaveAttribute(
    'src',
    'https://support.example.test/widget'
  );
  expect(screen.getByTitle('Untrusted synthetic widget')).toHaveAttribute(
    'src',
    'https://untrusted.example.test/widget'
  );

  await waitFor(() => {
    expect(document.documentElement.dataset.chatwootBridgeReady).toBe('true');
  });
});
