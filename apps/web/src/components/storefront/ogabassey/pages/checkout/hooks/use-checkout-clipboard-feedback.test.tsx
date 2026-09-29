import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useCheckoutClipboardFeedback } from './use-checkout-clipboard-feedback';

function ClipboardButton() {
  const { copiedText, copyToClipboard } = useCheckoutClipboardFeedback();
  return (
    <>
      <button type="button" onClick={() => void copyToClipboard('account-1')}>
        Copy first
      </button>
      <button type="button" onClick={() => void copyToClipboard('account-2')}>
        Copy second
      </button>
      <output>{copiedText}</output>
    </>
  );
}

function deferredWrite() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('replaces the previous value and clears copied feedback after two seconds', async () => {
  vi.useFakeTimers();
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  render(<ClipboardButton />);

  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Copy first' }))
  );
  expect(screen.getByText('account-1')).toBeInTheDocument();

  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Copy second' }))
  );
  expect(screen.queryByText('account-1')).not.toBeInTheDocument();
  expect(screen.getByText('account-2')).toBeInTheDocument();

  act(() => vi.advanceTimersByTime(2000));
  expect(screen.queryByText('account-2')).not.toBeInTheDocument();
  expect(writeText).toHaveBeenNthCalledWith(1, 'account-1');
  expect(writeText).toHaveBeenNthCalledWith(2, 'account-2');
});

it('clears the pending feedback timer when its owner unmounts', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  const { unmount } = render(<ClipboardButton />);

  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Copy first' }))
  );
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('ignores late clipboard completions after unmount', async () => {
  vi.useFakeTimers();
  const write = deferredWrite();
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn(() => write.promise) },
  });
  const { unmount } = render(<ClipboardButton />);

  fireEvent.click(screen.getByRole('button', { name: 'Copy first' }));
  unmount();
  await act(async () => write.resolve());

  expect(vi.getTimerCount()).toBe(0);
});

it('lets the most recently requested copy own feedback when promises settle out of order', async () => {
  const first = deferredWrite();
  const second = deferredWrite();
  const writeText = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  render(<ClipboardButton />);

  fireEvent.click(screen.getByRole('button', { name: 'Copy first' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy second' }));
  await act(async () => second.resolve());
  expect(screen.getByText('account-2')).toBeInTheDocument();

  await act(async () => first.resolve());
  expect(screen.getByText('account-2')).toBeInTheDocument();
  expect(screen.queryByText('account-1')).not.toBeInTheDocument();
});

it('keeps the prior success expiry when a later clipboard write fails', async () => {
  vi.useFakeTimers();
  const writeText = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('clipboard unavailable'));
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<ClipboardButton />);

  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Copy first' }))
  );
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Copy second' }))
  );
  expect(screen.getByText('account-1')).toBeInTheDocument();

  act(() => vi.advanceTimersByTime(2000));
  expect(screen.queryByText('account-1')).not.toBeInTheDocument();
  expect(consoleError).toHaveBeenCalledOnce();
});
