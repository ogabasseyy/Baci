import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OxygenHostedSelfie } from './OxygenHostedSelfie';

const state = vi.hoisted(() => ({ retry: () => {} }));
vi.mock('./use-oxygen-selfie-status', () => ({
  useOxygenSelfieStatus: () => ({ paused: false, retry: state.retry }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('keeps the listener stable and uses the latest retry only for trusted frame messages', () => {
  const first = vi.fn();
  const latest = vi.fn();
  state.retry = first;
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const origin = 'https://selfie.example.test';
  const props = {
    url: `${origin}/verify`,
    selfieOrigins: [origin],
    workflowId: 'same-workflow',
    onClose: vi.fn(),
  };
  const { rerender } = render(<OxygenHostedSelfie {...props} />);
  const frame = screen.getByTitle(
    'Oxygen selfie verification'
  ) as HTMLIFrameElement;
  const added = add.mock.calls.filter(([type]) => type === 'message').length;
  state.retry = latest;
  rerender(<OxygenHostedSelfie {...props} />);
  expect(add.mock.calls.filter(([type]) => type === 'message')).toHaveLength(
    added
  );
  expect(remove.mock.calls.filter(([type]) => type === 'message')).toHaveLength(
    0
  );
  fireEvent(
    window,
    new MessageEvent('message', {
      origin: 'https://evil.test',
      source: frame.contentWindow,
      data: 'FACE_RECOGNITION_SUCCESS',
    })
  );
  expect(latest).not.toHaveBeenCalled();
  fireEvent(
    window,
    new MessageEvent('message', {
      origin,
      source: window,
      data: 'FACE_RECOGNITION_SUCCESS',
    })
  );
  expect(latest).not.toHaveBeenCalled();
  fireEvent(
    window,
    new MessageEvent('message', {
      origin,
      source: frame.contentWindow,
      data: 'FACE_RECOGNITION_SUCCESS',
    })
  );
  expect(latest).toHaveBeenCalledTimes(1);
  expect(first).not.toHaveBeenCalled();
});
