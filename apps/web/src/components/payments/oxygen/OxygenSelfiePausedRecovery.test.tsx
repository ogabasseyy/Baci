import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fetcher = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: fetcher }));

import { OxygenHostedSelfie } from './OxygenHostedSelfie';

beforeEach(() => {
  vi.useFakeTimers();
  fetcher
    .mockReset()
    .mockResolvedValue(
      Response.json({ confirmed: false, checkedAt: '2026-10-25T21:00:00Z' })
    );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('shows the frame after a valid hint exhausts status checks and keeps it visible during manual recheck', async () => {
  const origin = 'https://identity.example.test';
  const done = vi.fn();
  render(
    <OxygenHostedSelfie
      url={`${origin}/verify`}
      selfieOrigins={[origin]}
      workflowId="60000000-0000-4000-8000-000000000001"
      onClose={vi.fn()}
      onConfirmed={done}
    />
  );
  const frame = screen.getByTitle(
    'Oxygen selfie verification'
  ) as HTMLIFrameElement;
  fireEvent.load(frame);
  expect(frame).toBeVisible();
  fireEvent(
    window,
    new MessageEvent('message', {
      origin,
      source: frame.contentWindow,
      data: 'FACE_RECOGNITION_SUCCESS',
    })
  );
  expect(frame).toHaveClass('invisible');
  expect(
    screen.getByRole('status', { name: 'Confirming your selfie' })
  ).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(15_000 * 15));
  expect(fetcher).toHaveBeenCalledTimes(15);
  expect(done).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Check again' })).toBeVisible();
  expect(frame).not.toHaveClass('invisible');
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(fetcher).toHaveBeenCalledTimes(16);
  expect(frame).not.toHaveClass('invisible');
  expect(done).not.toHaveBeenCalled();
  fetcher.mockResolvedValueOnce(
    Response.json({ confirmed: true, checkedAt: '2026-10-25T21:00:00Z' })
  );
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(done).toHaveBeenCalledOnce();
});

it('does not start an unconfirmable overlay when no workflow is available', () => {
  const origin = 'https://identity.example.test';
  render(
    <OxygenHostedSelfie
      url={`${origin}/verify`}
      selfieOrigins={[origin]}
      onClose={vi.fn()}
    />
  );
  const frame = screen.getByTitle(
    'Oxygen selfie verification'
  ) as HTMLIFrameElement;
  fireEvent.load(frame);
  fireEvent(
    window,
    new MessageEvent('message', {
      origin,
      source: frame.contentWindow,
      data: 'FACE_RECOGNITION_SUCCESS',
    })
  );
  expect(frame).not.toHaveClass('invisible');
  expect(fetcher).not.toHaveBeenCalled();
});
