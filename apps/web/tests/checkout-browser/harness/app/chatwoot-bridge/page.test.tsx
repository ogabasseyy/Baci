import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import ChatwootBridgeFixturePage from './page';

afterEach(() => {
  delete document.documentElement.dataset.chatwootBridgeReady;
  delete document.documentElement.dataset.untrustedMessageSeen;
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
