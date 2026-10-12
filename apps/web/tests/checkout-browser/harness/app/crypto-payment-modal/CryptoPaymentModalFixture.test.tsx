import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CryptoPaymentModalFixture } from './CryptoPaymentModalFixture';

let clipboardDescriptor: PropertyDescriptor | undefined;
let clipboardWasOverridden = false;

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

it('opens the real modal in each deterministic verification state', () => {
  render(<CryptoPaymentModalFixture />);

  for (const state of ['idle', 'checking', 'pending', 'confirmed', 'failed']) {
    fireEvent.click(screen.getByRole('radio', { name: state }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Open crypto payment modal' })
    );
    expect(
      screen.getByRole('heading', { name: 'Pay with Crypto' })
    ).toBeVisible();
    expect(screen.getByRole('img', { name: 'Scan' })).toHaveAttribute(
      'src',
      expect.stringMatching(/^data:image\/svg\+xml,/)
    );

    if (state === 'checking')
      expect(screen.getByText('Checking payment status...')).toBeVisible();
    if (state === 'pending')
      expect(
        screen.getByText('Waiting for blockchain confirmation...')
      ).toBeVisible();
    if (state === 'confirmed')
      expect(screen.getByText(/Payment confirmed!/)).toBeVisible();
    if (state === 'failed')
      expect(screen.getByText(/Payment verification failed/)).toBeVisible();

    fireEvent.click(
      screen.getByRole('button', { name: 'Close crypto payment modal' })
    );
  }
});

it('closes from the header without invoking confirmation', () => {
  const confirm = vi.fn();
  vi.stubGlobal('confirm', confirm);
  render(<CryptoPaymentModalFixture />);

  fireEvent.click(
    screen.getByRole('button', { name: 'Open crypto payment modal' })
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Close crypto payment modal' })
  );

  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Crypto payment modal closed.'
  );
});

it('keeps the modal open when footer confirmation is canceled and closes when accepted', () => {
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.stubGlobal('confirm', confirm);
  render(<CryptoPaymentModalFixture />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Open crypto payment modal' })
  );
  const closeLater = screen.getByRole('button', {
    name: 'Close and check order status later',
  });

  fireEvent.click(closeLater);
  expect(
    screen.getByRole('heading', { name: 'Pay with Crypto' })
  ).toBeVisible();
  fireEvent.click(closeLater);

  expect(confirm).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('heading', { name: 'Pay with Crypto' })).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Crypto payment modal closed.'
  );
});

it('copies the synthetic recipient address through the browser clipboard API', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  clipboardWasOverridden = true;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<CryptoPaymentModalFixture />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Open crypto payment modal' })
  );
  fireEvent.click(screen.getByTitle('Copy Address'));

  expect(writeText).toHaveBeenCalledWith('T7WHdR7vj4i3L4575w8V5hV8tKf9w2Q3xY');
  expect(await screen.findByTitle('Copied!')).toBeVisible();
});

it('keeps the fixture usable when the browser clipboard rejects a copy', async () => {
  let rejectWrite: (reason?: unknown) => void = () => undefined;
  const writeText = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectWrite = reject;
      })
  );
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  clipboardWasOverridden = true;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  render(<CryptoPaymentModalFixture />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Open crypto payment modal' })
  );
  fireEvent.click(screen.getByTitle('Copy Address'));

  expect(writeText).toHaveBeenCalledWith('T7WHdR7vj4i3L4575w8V5hV8tKf9w2Q3xY');
  await act(async () => {
    rejectWrite(new Error('Clipboard permission denied'));
  });
  expect(screen.queryByTitle('Copied!')).not.toBeInTheDocument();

  fireEvent.click(
    screen.getByRole('button', { name: 'Close crypto payment modal' })
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Crypto payment modal closed.'
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Open crypto payment modal' })
  );
  expect(
    screen.getByRole('heading', { name: 'Pay with Crypto' })
  ).toBeVisible();
});
