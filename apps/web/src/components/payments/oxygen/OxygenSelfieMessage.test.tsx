import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
it('accepts only the exact hosted-frame success hint and still waits for KYC', () => {
  const done = vi.fn();
  render(
    <OxygenHostedSelfie
      url="https://staging.d1l1k5yxed9cvn.amplifyapp.com/"
      selfieOrigins={['https://staging.d1l1k5yxed9cvn.amplifyapp.com']}
      workflowId="same-workflow"
      onClose={vi.fn()}
      onConfirmed={done}
    />
  );
  const frame = screen.getByTitle(
    'Oxygen selfie verification'
  ) as HTMLIFrameElement;
  const origin = 'https://staging.d1l1k5yxed9cvn.amplifyapp.com';
  fireEvent(
    window,
    new MessageEvent('message', {
      origin: 'https://evil.test',
      source: frame.contentWindow,
      data: 'FACE_RECOGNITION_SUCCESS',
    })
  );
  fireEvent(
    window,
    new MessageEvent('message', {
      origin,
      source: window,
      data: 'FACE_RECOGNITION_SUCCESS',
    })
  );
  fireEvent(
    window,
    new MessageEvent('message', {
      origin,
      source: frame.contentWindow,
      data: 'ERROR',
    })
  );
  expect(retry).not.toHaveBeenCalled();
  fireEvent(
    window,
    new MessageEvent('message', {
      origin,
      source: frame.contentWindow,
      data: 'FACE_RECOGNITION_SUCCESS',
    })
  );
  expect(retry).toHaveBeenCalledOnce();
  expect(done).not.toHaveBeenCalled();
  expect(
    screen.getByRole('status', { name: 'Confirming your selfie' })
  ).toBeVisible();
  expect(frame).toHaveClass('invisible');
  fireEvent(
    window,
    new MessageEvent('message', {
      origin,
      source: frame.contentWindow,
      data: 'FACE_RECOGNITION_SUCCESS',
    })
  );
  expect(retry).toHaveBeenCalledOnce();
});
it('accepts only the currently embedded configured origin, not another allowed origin', () => {
  render(
    <OxygenHostedSelfie
      url="https://identity.example.test/start"
      selfieOrigins={[
        'https://identity.example.test',
        'https://other.example.test',
      ]}
      workflowId="workflow"
      onClose={vi.fn()}
    />
  );
  const frame = screen.getByTitle(
    'Oxygen selfie verification'
  ) as HTMLIFrameElement;
  fireEvent(
    window,
    new MessageEvent('message', {
      origin: 'https://other.example.test',
      source: frame.contentWindow,
      data: 'FACE_RECOGNITION_SUCCESS',
    })
  );
  expect(retry).not.toHaveBeenCalled();
  fireEvent(
    window,
    new MessageEvent('message', {
      origin: 'https://identity.example.test',
      source: frame.contentWindow,
      data: 'FACE_RECOGNITION_SUCCESS',
    })
  );
  expect(retry).toHaveBeenCalledOnce();
});
