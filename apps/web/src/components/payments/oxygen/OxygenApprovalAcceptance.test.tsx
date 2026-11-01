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

it('saves the accepted drawing on Continue, blocks duplicate saves and approves only after OTP', async () => {
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
  expect(exportImage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Saving signature…' }));
  expect(exportImage).toHaveBeenCalledTimes(1);
  expect(approve).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'Saving signature…' })
  ).toBeDisabled();
  await act(async () => finish(new Blob(['drawing'], { type: 'image/png' })));
  expect(approve).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '123456' },
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
  fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
  await screen.findByText('Add your signature before continuing.');
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
  fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
  unmount();
  await act(async () => finish(new Blob(['drawing'], { type: 'image/png' })));
  expect(approve).not.toHaveBeenCalled();
});
