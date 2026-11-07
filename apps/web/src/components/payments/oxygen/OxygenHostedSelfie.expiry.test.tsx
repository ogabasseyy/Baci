import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OxygenHostedSelfie } from './OxygenHostedSelfie';

vi.mock('./OxygenPhoneHandoff', () => ({
  OxygenPhoneHandoff: () => <p>Phone handoff</p>,
}));
vi.mock('./use-oxygen-selfie-status', () => ({
  useOxygenSelfieStatus: () => ({ paused: false, retry: vi.fn() }),
}));
const url = (exp: number) =>
  `https://selfie.example/?securityToken=a.${btoa(JSON.stringify({ exp }))}.c`;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('removes an expired iframe and automatically renews without another dialog', async () => {
  const onRenew = vi.fn().mockResolvedValue('renewed');
  render(
    <OxygenHostedSelfie
      url={url(1)}
      selfieOrigins={['https://selfie.example']}
      workflowId="same"
      onClose={vi.fn()}
      onRenew={onRenew}
    />
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.queryByTitle('Oxygen selfie verification')).toBeNull();
  expect(onRenew).toHaveBeenCalledTimes(1);
  expect(onRenew.mock.calls[0][0]).toBe(true);
  expect(
    screen.getByText('Refreshing your verification session…')
  ).toBeVisible();
});
it('does not show or refresh a successful selfie again', async () => {
  const onRenew = vi.fn().mockResolvedValue('confirmed');
  const done = vi.fn();
  render(
    <OxygenHostedSelfie
      url={url(1)}
      selfieOrigins={['https://selfie.example']}
      workflowId="same"
      onClose={vi.fn()}
      onRenew={onRenew}
      onConfirmed={done}
    />
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(done).toHaveBeenCalledOnce();
});
it('offers a bounded retry when automatic renewal fails', async () => {
  const onRenew = vi.fn().mockRejectedValue(new Error('private token'));
  render(
    <OxygenHostedSelfie
      url={url(1)}
      selfieOrigins={['https://selfie.example']}
      workflowId="same"
      onClose={vi.fn()}
      onRenew={onRenew}
    />
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByRole('alert')).not.toHaveTextContent('private token');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(onRenew).toHaveBeenCalledTimes(2);
});

it('renews once under StrictMode effect replay', async () => {
  const onRenew = vi.fn().mockResolvedValue('confirmed');
  const done = vi.fn();
  render(
    <StrictMode>
      <OxygenHostedSelfie
        url={url(1)}
        selfieOrigins={['https://selfie.example']}
        workflowId="same"
        onClose={vi.fn()}
        onRenew={onRenew}
        onConfirmed={done}
      />
    </StrictMode>
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(onRenew).toHaveBeenCalledOnce();
  expect(done).toHaveBeenCalledOnce();
});

it('automatically replaces a session that expires while its iframe is open', async () => {
  const onRenew = vi.fn().mockResolvedValue('renewed');
  render(
    <OxygenHostedSelfie
      url={url(Math.floor(Date.now() / 1000) + 2)}
      selfieOrigins={['https://selfie.example']}
      workflowId="same"
      onClose={vi.fn()}
      onRenew={onRenew}
    />
  );
  expect(screen.getByTitle('Oxygen selfie verification')).toBeTruthy();
  expect(onRenew).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(2100));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(onRenew).toHaveBeenCalledOnce();
  expect(screen.queryByTitle('Oxygen selfie verification')).toBeNull();
});
it('defers automatic renewal until the browser becomes visible', async () => {
  const visible = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('hidden');
  try {
    const onRenew = vi.fn().mockResolvedValue('confirmed');
    render(
      <OxygenHostedSelfie
        url={url(1)}
        selfieOrigins={['https://selfie.example']}
        workflowId="same"
        onClose={vi.fn()}
        onRenew={onRenew}
      />
    );
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(onRenew).not.toHaveBeenCalled();
    visible.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(onRenew).toHaveBeenCalledOnce();
  } finally {
    visible.mockRestore();
  }
});

it.each([
  false,
  true,
])('keeps phone handoff available after expiry when renewal configured=%s', async (configured) => {
  render(
    <OxygenHostedSelfie
      url={url(1)}
      selfieOrigins={['https://selfie.example']}
      workflowId="same"
      onClose={vi.fn()}
      onRenew={
        configured
          ? vi.fn().mockRejectedValue(new Error('unavailable'))
          : undefined
      }
    />
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue on your phone' })
  );
  expect(screen.getByText('Phone handoff')).toBeVisible();
});

it('cancels an in-flight renewal when switching to phone handoff', async () => {
  let signal: AbortSignal | undefined;
  const onRenew = vi.fn((_automatic: boolean, requestSignal: AbortSignal) => {
    signal = requestSignal;
    return new Promise<'renewed'>(() => {});
  });
  render(
    <OxygenHostedSelfie
      url={url(1)}
      selfieOrigins={['https://selfie.example']}
      workflowId="same"
      onClose={vi.fn()}
      onRenew={onRenew}
    />
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(signal?.aborted).toBe(false);
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue on your phone' })
  );
  expect(signal?.aborted).toBe(true);
  expect(screen.getByText('Phone handoff')).toBeVisible();
});
