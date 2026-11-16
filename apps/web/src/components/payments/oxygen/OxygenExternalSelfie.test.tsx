import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const retry = vi.hoisted(() => vi.fn());
vi.mock('./use-oxygen-selfie-status', () => ({
  useOxygenSelfieStatus: () => ({ paused: false, retry }),
}));

import { OxygenHostedSelfie } from './OxygenHostedSelfie';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('offers a trusted standalone camera link and checks status without claiming success', () => {
  const confirmed = vi.fn();
  const url = 'https://selfie.example/verify?token=fixture';
  render(
    <OxygenHostedSelfie
      url={url}
      selfieOrigins={['https://selfie.example']}
      workflowId="same-workflow"
      onClose={vi.fn()}
      onConfirmed={confirmed}
    />
  );
  const link = screen.getByRole('link', { name: 'Open camera in a new tab' });
  expect(link).toHaveAttribute('href', url);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  fireEvent.click(link);
  expect(confirmed).not.toHaveBeenCalled();
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/return to this tab/i)).toBeVisible();
  expect(
    screen.queryByRole('link', { name: 'Open camera in a new tab' })
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check selfie status' }));
  expect(retry).toHaveBeenCalledTimes(2);
  expect(confirmed).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Return to camera options' })
  );
  expect(
    screen.getByRole('link', { name: 'Open camera in a new tab' })
  ).toBeVisible();
});

it('does not offer a standalone link for an untrusted or expired provider URL', () => {
  const view = render(
    <OxygenHostedSelfie
      url="https://untrusted.example/verify"
      selfieOrigins={['https://selfie.example']}
      workflowId="same-workflow"
      onClose={vi.fn()}
    />
  );
  expect(
    screen.queryByRole('link', { name: 'Open camera in a new tab' })
  ).toBeNull();
  const expired = `https://selfie.example/?securityToken=a.${btoa(JSON.stringify({ exp: 1 }))}.c`;
  view.rerender(
    <OxygenHostedSelfie
      url={expired}
      selfieOrigins={['https://selfie.example']}
      workflowId="same-workflow"
      onClose={vi.fn()}
    />
  );
  expect(
    screen.queryByRole('link', { name: 'Open camera in a new tab' })
  ).toBeNull();
});

it('checks status again on return to checkout after opening the standalone camera', () => {
  const visible = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible');
  try {
    render(
      <OxygenHostedSelfie
        url="https://selfie.example/verify?token=fixture"
        selfieOrigins={['https://selfie.example']}
        workflowId="same-workflow"
        onClose={vi.fn()}
      />
    );
    fireEvent.click(
      screen.getByRole('link', { name: 'Open camera in a new tab' })
    );
    visible.mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    expect(retry).toHaveBeenCalledTimes(1);
    visible.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    expect(retry).toHaveBeenCalledTimes(2);
  } finally {
    visible.mockRestore();
  }
});

it('does not open a link that expires before a delayed click', () => {
  const clock = vi.spyOn(Date, 'now');
  try {
    const start = 2_000_000_000_000;
    clock.mockReturnValue(start);
    const token = btoa(JSON.stringify({ exp: Math.floor(start / 1000) + 1 }));
    render(
      <OxygenHostedSelfie
        url={`https://selfie.example/?securityToken=a.${token}.c`}
        selfieOrigins={['https://selfie.example']}
        workflowId="same-workflow"
        onClose={vi.fn()}
      />
    );
    const link = screen.getByRole('link', { name: 'Open camera in a new tab' });
    clock.mockReturnValue(start + 2000);
    expect(fireEvent.click(link)).toBe(false);
    expect(retry).not.toHaveBeenCalled();
    expect(screen.getByText('Your verification session expired')).toBeVisible();
    expect(
      screen.queryByRole('link', { name: 'Open camera in a new tab' })
    ).toBeNull();
  } finally {
    clock.mockRestore();
  }
});

it('does not renew the link while the customer may be using it in another tab', async () => {
  vi.useFakeTimers();
  try {
    const onRenew = vi.fn().mockResolvedValue('renewed');
    const token = btoa(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 2 })
    );
    render(
      <OxygenHostedSelfie
        url={`https://selfie.example/?securityToken=a.${token}.c`}
        selfieOrigins={['https://selfie.example']}
        workflowId="same-workflow"
        onClose={vi.fn()}
        onRenew={onRenew}
      />
    );
    fireEvent.click(
      screen.getByRole('link', { name: 'Open camera in a new tab' })
    );
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(onRenew).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Check selfie status' })
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Return to camera options' })
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(onRenew).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
