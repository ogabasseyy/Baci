import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { isOxygenSelfieUrl, OxygenHostedSelfie } from './OxygenHostedSelfie';

afterEach(cleanup);
const url = 'https://staging.d1l1k5yxed9cvn.amplifyapp.com/?token=synthetic';
it('loads the saved selfie link with camera only and never treats loading as verification', () => {
  const close = vi.fn();
  render(<OxygenHostedSelfie url={url} onClose={close} />);
  const frame = screen.getByTitle('Oxygen selfie verification');
  expect(frame).toHaveAttribute('src', url);
  expect(frame).toHaveAttribute('allow', 'camera');
  expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
  fireEvent.load(frame);
  expect(screen.queryByRole('status')).toBeNull();
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Back to application' }));
  expect(close).toHaveBeenCalledTimes(1);
});
it.each([
  'https://evil.test/',
  'https://staging.d1l1k5yxed9cvn.amplifyapp.com.evil.test/',
  'http://staging.d1l1k5yxed9cvn.amplifyapp.com/',
  'https://user@staging.d1l1k5yxed9cvn.amplifyapp.com/',
])('rejects an untrusted handoff %s', (bad) => {
  expect(isOxygenSelfieUrl(bad)).toBe(false);
  render(<OxygenHostedSelfie url={bad} onClose={vi.fn()} />);
  expect(screen.queryByTitle('Oxygen selfie verification')).toBeNull();
  expect(screen.getByRole('alert')).toBeVisible();
});
