import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OxygenSignature } from './OxygenSignature';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setupDrawing() {
  class Pointer extends MouseEvent {
    pointerId: number;
    constructor(
      type: string,
      init: MouseEventInit & { pointerId?: number } = {}
    ) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  vi.stubGlobal('PointerEvent', Pointer);
  const context = {
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    drawImage: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  );
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  vi.spyOn(
    HTMLCanvasElement.prototype,
    'getBoundingClientRect'
  ).mockReturnValue({ left: 0, top: 0, width: 640, height: 180 } as DOMRect);
  return context;
}
it('requires drawing before saving and exports a PNG only after Use signature', () => {
  const context = setupDrawing();
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    (callback) => callback(new Blob(['signature'], { type: 'image/png' }))
  );
  const change = vi.fn();
  render(<OxygenSignature disabled={false} onChange={change} />);
  expect(screen.getByRole('button', { name: 'Use signature' })).toBeDisabled();
  const canvas = screen.getByRole('img', { name: 'Draw your signature' });
  fireEvent.pointerDown(canvas, {
    pointerId: 1,
    button: 0,
    clientX: 10,
    clientY: 20,
  });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 35 });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
  expect(context.stroke).toHaveBeenCalled();
  expect(change.mock.calls.every(([file]) => file === undefined)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Use signature' }));
  expect(change.mock.lastCall?.[0]).toBeInstanceOf(File);
  expect(change.mock.lastCall?.[0].type).toBe('image/png');
  expect(screen.getByRole('status')).toHaveTextContent('Signature ready');
  fireEvent.click(screen.getByRole('button', { name: 'Change signature' }));
  expect(change).toHaveBeenLastCalledWith(undefined);
});
it('discards an export completed after Clear and handles export failures', () => {
  setupDrawing();
  let finish: BlobCallback = () => {};
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    (callback) => {
      finish = callback;
    }
  );
  const change = vi.fn();
  render(<OxygenSignature disabled={false} onChange={change} />);
  const canvas = screen.getByRole('img');
  fireEvent.pointerDown(canvas, { button: 0, pointerId: 1 });
  fireEvent.pointerMove(canvas, { pointerId: 1 });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Use signature' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  finish(new Blob(['old'], { type: 'image/png' }));
  expect(change.mock.calls.every(([file]) => file === undefined)).toBe(true);
});
it('provides an upload fallback, rejects invalid files and respects disabled state', () => {
  const change = vi.fn();
  const view = render(<OxygenSignature disabled={false} onChange={change} />);
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  fireEvent.change(screen.getByLabelText('Your signature'), {
    target: {
      files: [new File(['bad'], 'bad.pdf', { type: 'application/pdf' })],
    },
  });
  expect(screen.getByRole('alert')).toHaveTextContent('PNG or JPEG');
  expect(change.mock.lastCall?.[0]).toBeUndefined();
  const file = new File(['image'], 'signature.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Your signature'), {
    target: { files: [file] },
  });
  expect(change).toHaveBeenLastCalledWith(file);
  view.rerender(<OxygenSignature disabled onChange={change} />);
  expect(
    screen.getByRole('button', { name: 'Change signature' })
  ).toBeDisabled();
});
it('keeps the form unsigned if image export fails', () => {
  setupDrawing();
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    (callback) => callback(null)
  );
  const change = vi.fn();
  render(<OxygenSignature disabled={false} onChange={change} />);
  const canvas = screen.getByRole('img');
  fireEvent.pointerDown(canvas, { button: 0, pointerId: 1 });
  fireEvent.pointerMove(canvas, { pointerId: 1 });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Use signature' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
  expect(screen.queryByText(/Signature ready/)).toBeNull();
  expect(change.mock.calls.every(([file]) => file === undefined)).toBe(true);
});

it('stops a captured stroke at the edge of the displayed canvas and does not draw on reentry', () => {
  const context = setupDrawing();
  render(<OxygenSignature disabled={false} onChange={vi.fn()} />);
  const canvas = screen.getByRole('img');
  fireEvent.pointerDown(canvas, {
    pointerId: 1,
    button: 0,
    clientX: 20,
    clientY: 20,
  });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 30, clientY: 30 });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 700, clientY: 30 });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 40 });
  expect(context.stroke).toHaveBeenCalledTimes(1);
  expect(context.lineTo).toHaveBeenCalledExactlyOnceWith(30, 60);
});
it('expands the actual canvas while preserving existing ink and can clear it again', () => {
  const context = setupDrawing();
  render(<OxygenSignature disabled={false} onChange={vi.fn()} />);
  const canvas = screen.getByRole('img');
  fireEvent.pointerDown(canvas, {
    pointerId: 1,
    button: 0,
    clientX: 20,
    clientY: 20,
  });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 30, clientY: 30 });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Expand signing area' }));
  expect(canvas).toHaveAttribute('height', '640');
  expect(context.drawImage).toHaveBeenCalledTimes(2);
  const expandedSource = canvas;
  fireEvent.click(screen.getByRole('button', { name: 'Reduce signing area' }));
  expect(canvas).toHaveAttribute('height', '360');
  expect(context.drawImage.mock.calls[3].slice(1)).toEqual([140, 0, 360, 360]);
  const preserved = context.drawImage.mock.calls[3][0];
  fireEvent.click(screen.getByRole('button', { name: 'Expand signing area' }));
  expect(canvas).toBe(expandedSource);
  expect(canvas).toHaveAttribute('height', '640');
  expect(context.drawImage.mock.calls[5][0]).toBe(preserved);
  expect(screen.getByRole('button', { name: 'Use signature' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(canvas).toHaveAttribute('height', '360');
  expect(screen.getByRole('button', { name: 'Use signature' })).toBeDisabled();
});

it('keeps an existing signature ready when the confirmation layout remounts', () => {
  const change = vi.fn();
  render(
    <OxygenSignature
      disabled={false}
      embedded
      initialSignature={
        new File(['signature'], 'signature.png', { type: 'image/png' })
      }
      onChange={change}
    />
  );
  expect(screen.getByRole('status')).toHaveTextContent('Signature ready');
  expect(
    screen.getByRole('button', { name: 'Change signature' })
  ).toBeEnabled();
  expect(screen.queryByRole('img', { name: 'Draw your signature' })).toBeNull();
  expect(change).not.toHaveBeenCalled();
});
