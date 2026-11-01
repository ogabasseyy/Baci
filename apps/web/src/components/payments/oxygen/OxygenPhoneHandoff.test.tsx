import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: fetchMock }));

import { OxygenPhoneHandoff } from './OxygenPhoneHandoff';

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});
it('prepares a QR automatically without another click and does not expose the provider link', async () => {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        qr: 'data:image/png;base64,synthetic',
        expiresAt: Date.now() + 300000,
      })
    )
  );
  const prepared = vi.fn();
  render(
    <OxygenPhoneHandoff
      workflowId="same-workflow"
      onBack={vi.fn()}
      onPrepared={prepared}
    />
  );
  expect(screen.queryByRole('button', { name: 'Show secure QR' })).toBeNull();
  expect(await screen.findByRole('img')).toHaveAttribute(
    'src',
    'data:image/png;base64,synthetic'
  );
  expect(prepared).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0][1].body).toBe(
    JSON.stringify({ workflowId: 'same-workflow' })
  );
});
it('keeps preparation failure recoverable without claiming a camera error', async () => {
  fetchMock.mockRejectedValue(new Error('offline'));
  render(<OxygenPhoneHandoff workflowId="same-workflow" onBack={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'application is saved'
  );
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

it('hides an expired QR and offers a fresh code instead of showing a stale image', async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        qr: 'data:image/png;base64,synthetic',
        expiresAt: Date.now() + 1000,
      })
    )
  );
  render(<OxygenPhoneHandoff workflowId="same-workflow" onBack={vi.fn()} />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole('img')).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByRole('button', { name: 'Get a fresh QR' })).toBeEnabled();
});
