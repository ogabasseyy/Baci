import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ChatwootBridgeFixturePage from './page';

afterEach(() => {
  delete document.documentElement.dataset.chatwootBridgeReady;
  delete document.documentElement.dataset.untrustedMessageSeen;
  vi.unstubAllGlobals();
});

it('ignores a valid context request from the untrusted widget source', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<ChatwootBridgeFixturePage />);
  const untrustedFrame = screen.getByTitle(
    'Untrusted synthetic widget'
  ) as HTMLIFrameElement;

  await waitFor(() => {
    expect(document.documentElement.dataset.chatwootBridgeReady).toBe('true');
  });

  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://untrusted.example.test',
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

  await waitFor(() => {
    expect(document.documentElement.dataset.untrustedMessageSeen).toBe('true');
  });
  expect(fetchMock).not.toHaveBeenCalled();
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
