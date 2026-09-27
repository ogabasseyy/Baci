import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DvaModalFixture } from './DvaModalFixture';

let clipboardDescriptor: PropertyDescriptor | undefined;
let clipboardWasOverridden = false;

function stubClipboard(writeText: (text: string) => Promise<void>) {
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  clipboardWasOverridden = true;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (clipboardWasOverridden) {
    if (clipboardDescriptor)
      Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
    clipboardDescriptor = undefined;
    clipboardWasOverridden = false;
  }
});

it('retains active verification and copied feedback across footer close and reopen', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  stubClipboard(writeText);
  render(<DvaModalFixture />);

  fireEvent.click(screen.getByRole('button', { name: 'Open DVA modal' }));
  expect(screen.getByText('₦750')).toBeVisible();
  expect(screen.getByText('Fixture Bank')).toBeVisible();
  expect(screen.getByText('1234567890')).toBeVisible();

  const copyButton = screen.getByRole('button', {
    name: 'Copy account number',
  });
  fireEvent.click(copyButton);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('1234567890'));
  await waitFor(() => expect(copyButton).toHaveClass('border-green-300'));

  fireEvent.click(
    screen.getByRole('button', { name: 'Confirm Transfer Sent' })
  );
  expect(
    screen.getByRole('button', { name: 'Verifying transfer…' })
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Close and check later' })
  );
  expect(screen.queryByRole('heading', { name: 'Bank Transfer' })).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('DVA modal closed.');

  fireEvent.click(screen.getByRole('button', { name: 'Open DVA modal' }));
  expect(
    screen.getByRole('button', { name: 'Verifying transfer…' })
  ).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Copy account number' })
  ).toHaveClass('border-green-300');
});

it('keeps the modal open without copied feedback when clipboard access rejects', async () => {
  let rejectWrite: (reason?: unknown) => void = () => undefined;
  const writeText = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectWrite = reject;
      })
  );
  stubClipboard(writeText);
  render(<DvaModalFixture />);
  fireEvent.click(screen.getByRole('button', { name: 'Open DVA modal' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy account number' }));

  expect(writeText).toHaveBeenCalledWith('1234567890');
  await act(async () => {
    rejectWrite(new Error('Clipboard permission denied'));
  });
  expect(
    screen.getByRole('button', { name: 'Copy account number' })
  ).not.toHaveClass('border-green-300');
  expect(screen.getByRole('heading', { name: 'Bank Transfer' })).toBeVisible();

  fireEvent.click(
    screen.getByRole('button', { name: 'Close bank transfer modal' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open DVA modal' }));
  expect(screen.getByRole('heading', { name: 'Bank Transfer' })).toBeVisible();
});

it('ignores a clipboard result from a modal session that has closed', async () => {
  let resolveWrite: (() => void) | undefined;
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveWrite = resolve;
      })
  );
  stubClipboard(writeText);
  render(<DvaModalFixture />);

  fireEvent.click(screen.getByRole('button', { name: 'Open DVA modal' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy account number' }));
  expect(writeText).toHaveBeenCalledWith('1234567890');

  fireEvent.click(
    screen.getByRole('button', { name: 'Close and check later' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open DVA modal' }));
  await act(async () => {
    resolveWrite?.();
  });

  expect(
    screen.getByRole('button', { name: 'Copy account number' })
  ).not.toHaveClass('border-green-300');
});
