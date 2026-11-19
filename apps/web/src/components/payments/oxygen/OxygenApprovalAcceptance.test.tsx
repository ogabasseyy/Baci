import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OxygenApprovalCode } from './OxygenApprovalCode';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
afterEach(() => {
  if (vi.isFakeTimers()) {
    // input-otp schedules selection synchronization at 0, 10 and 50 ms.
    act(() => vi.advanceTimersByTime(50));
    vi.useRealTimers();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  class Pointer extends MouseEvent {
    pointerId = 1;
  }
  vi.stubGlobal('PointerEvent', Pointer);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
  } as unknown as CanvasRenderingContext2D);
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  vi.spyOn(
    HTMLCanvasElement.prototype,
    'getBoundingClientRect'
  ).mockReturnValue({ left: 0, top: 0, width: 640, height: 360 } as DOMRect);
  const ref = '70000000-0000-4000-8000-000000000025';
  mocks.fetch.mockClear();
  mocks.fetch.mockImplementation(async () =>
    Response.json({
      window: {
        bookingReference: ref,
        sentAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      },
    })
  );
  const approve = vi.fn().mockResolvedValue(false);
  const view = render(
    <OxygenApprovalCode
      workflowId="60000000-0000-4000-8000-000000000001"
      reference={ref}
      state={{
        bookingReference: ref,
        schedule: [
          {
            period: 1,
            dueDate: [2026, 11, 27],
            amount: 100,
            principal: 90,
            interest: 10,
          },
        ],
      }}
      requestCode={vi.fn().mockResolvedValue(true)}
      approvePlan={approve}
      busy={false}
    />
  );
  const canvas = screen.getByRole('img', { name: 'Draw your signature' });
  fireEvent.pointerDown(canvas, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(canvas, { clientX: 30, clientY: 30 });
  fireEvent.pointerUp(canvas);
  return { ...view, approve, ref };
}

it('saves the drawing on acceptance, blocks duplicate saves and approves only after OTP', async () => {
  let finish: BlobCallback = () => {};
  const exportImage = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((callback) => {
      finish = callback;
    });
  const { approve, ref } = await setup();
  expect(exportImage).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Use signature' })).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  const accept = screen.getByRole('checkbox');
  fireEvent.click(accept);
  expect(exportImage).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Saving signature…' }));
  expect(exportImage).toHaveBeenCalledTimes(1);
  expect(approve).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'Saving signature…' })
  ).toBeDisabled();
  await act(async () => finish(new Blob(['drawing'], { type: 'image/png' })));
  expect(approve).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Continue$/ })).toBeEnabled()
  );
  let finishReload: (response: Response) => void = () => {};
  mocks.fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finishReload = resolve;
      })
  );
  vi.useFakeTimers();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
  });
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('textbox')).toBeDisabled();
  expect(approve).not.toHaveBeenCalled();
  await act(async () =>
    finishReload(
      Response.json({
        window: {
          bookingReference: ref,
          sentAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        },
      })
    )
  );
  expect(screen.getByRole('textbox')).toBeEnabled();
  expect(screen.getByRole('textbox')).not.toHaveAttribute('readonly');
  await act(async () => {
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '123456' },
    });
  });
  expect(approve).toHaveBeenCalledExactlyOnceWith(
    ref,
    '123456',
    expect.any(File),
    expect.any(Function)
  );
  expect(screen.queryByText('Code verified.')).toBeNull();
});
it('does not approve when signature export fails and lets the customer correct the signature', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    (callback) => callback(null)
  );
  const { approve } = await setup();
  fireEvent.click(screen.getByRole('checkbox'));
  await screen.findByText('Add your signature before accepting this plan.');
  expect(approve).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox')).toBeNull();
});
it('discards an asynchronous signature save after leaving the approval screen', async () => {
  let finish: BlobCallback = () => {};
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    (callback) => {
      finish = callback;
    }
  );
  const { approve, unmount } = await setup();
  fireEvent.click(screen.getByRole('checkbox'));
  unmount();
  await act(async () => finish(new Blob(['drawing'], { type: 'image/png' })));
  expect(approve).not.toHaveBeenCalled();
});
