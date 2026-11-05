import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { isOxygenSelfieUrl, OxygenHostedSelfie } from './OxygenHostedSelfie';

afterEach(cleanup);
const origin = 'https://staging.d1l1k5yxed9cvn.amplifyapp.com';
const url = `${origin}/?token=synthetic`;
const selfieOrigins = [origin];
it('loads the saved selfie link with camera only and never treats loading as verification', () => {
  const close = vi.fn();
  render(
    <OxygenHostedSelfie
      url={url}
      selfieOrigins={selfieOrigins}
      onClose={close}
    />
  );
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
  expect(isOxygenSelfieUrl(bad, selfieOrigins)).toBe(false);
  render(
    <OxygenHostedSelfie
      url={bad}
      selfieOrigins={selfieOrigins}
      onClose={vi.fn()}
    />
  );
  expect(screen.queryByTitle('Oxygen selfie verification')).toBeNull();
  expect(screen.getByRole('alert')).toBeVisible();
});

it('offers a prominent phone handoff below the camera, outside the compact header', () => {
  render(
    <OxygenHostedSelfie
      url={url}
      selfieOrigins={selfieOrigins}
      workflowId="same-workflow"
      onClose={vi.fn()}
    />
  );
  const button = screen.getByRole('button', { name: /Continue on your phone/ });
  expect(button.closest('header')).toBeNull();
  expect(button).toHaveClass('w-full', 'min-h-14');
  expect(
    screen.getByRole('status', { name: 'Opening face verification' })
  ).toBeVisible();
});
it('uses configured nonlocal origins and fails closed when none are supplied', () => {
  const configured = 'https://identity.example.test';
  expect(isOxygenSelfieUrl(`${configured}/verify?token=fixture`)).toBe(false);
  expect(
    isOxygenSelfieUrl(`${configured}/verify?token=fixture`, [configured])
  ).toBe(true);
  expect(
    isOxygenSelfieUrl('https://identity.example.test.evil.test/', [configured])
  ).toBe(false);
  render(
    <OxygenHostedSelfie
      url={`${configured}/verify?token=fixture`}
      selfieOrigins={[configured]}
      onClose={vi.fn()}
    />
  );
  expect(screen.getByTitle('Oxygen selfie verification')).toHaveAttribute(
    'src',
    `${configured}/verify?token=fixture`
  );
});
