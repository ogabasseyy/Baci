import { act, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { expect, it, vi } from 'vitest';
import type { Position } from './chat-launcher-geometry';
import { useChatLauncherOfferCollision } from './use-chat-launcher-offer-collision';

const resizeObservers: Array<TestResizeObserver> = [];

class TestResizeObserver implements ResizeObserver {
  private callback: ResizeObserverCallback;
  readonly observed = new Set<Element>();
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeObservers.push(this);
  }
  observe(target: Element) {
    this.observed.add(target);
  }
  unobserve(target: Element) {
    this.observed.delete(target);
  }
  disconnect() {
    this.observed.clear();
  }
  trigger() {
    this.callback([], this);
  }
}

function Harness({
  position,
  withOverflow = false,
}: {
  position?: Position;
  withOverflow?: boolean;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  useChatLauncherOfferCollision(anchorRef, position);
  return (
    <div ref={anchorRef} data-testid="launcher-anchor">
      {withOverflow && <div data-chat-launcher-overflow data-testid="overflow" />}
    </div>
  );
}

it('marks and clears actual offer overlap after a moved launcher changes position', () => {
  const { rerender, getByTestId } = render(<Harness position={{ x: 10, y: 10 }} />);
  const anchor = getByTestId('launcher-anchor');
  const offer = document.createElement('div');
  offer.className = 'ogabassey-offer-popup';
  document.body.append(offer);
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
    left: 20,
    top: 20,
    right: 76,
    bottom: 76,
    width: 56,
    height: 56,
    x: 20,
    y: 20,
    toJSON: () => ({}),
  });
  vi.spyOn(offer, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 320,
    bottom: 240,
    width: 320,
    height: 240,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  act(() => rerender(<Harness position={{ x: 20, y: 20 }} />));
  expect(anchor).toHaveAttribute('data-chat-launcher-offer-collision');

  vi.mocked(anchor.getBoundingClientRect).mockReturnValue({
    left: 1200,
    top: 700,
    right: 1256,
    bottom: 756,
    width: 56,
    height: 56,
    x: 1200,
    y: 700,
    toJSON: () => ({}),
  });
  act(() => rerender(<Harness position={{ x: 1200, y: 700 }} />));
  expect(anchor).not.toHaveAttribute('data-chat-launcher-offer-collision');
  offer.remove();
});

it('rechecks collision after the offer entry animation settles', async () => {
  const { getByTestId } = render(<Harness position={{ x: 10, y: 10 }} />);
  const anchor = getByTestId('launcher-anchor');
  const offer = document.createElement('div');
  offer.className = 'ogabassey-offer-popup';
  document.body.append(offer);
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
    left: 20, top: 20, right: 76, bottom: 76, width: 56, height: 56,
    x: 20, y: 20, toJSON: () => ({}),
  });
  const offerRect = vi.spyOn(offer, 'getBoundingClientRect').mockReturnValue({
    left: 500, top: 500, right: 820, bottom: 740, width: 320, height: 240,
    x: 500, y: 500, toJSON: () => ({}),
  });
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  expect(anchor).not.toHaveAttribute('data-chat-launcher-offer-collision');

  offerRect.mockReturnValue({
    left: 0, top: 0, right: 320, bottom: 240, width: 320, height: 240,
    x: 0, y: 0, toJSON: () => ({}),
  });
  fireEvent.animationEnd(offer);
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });

  expect(anchor).toHaveAttribute('data-chat-launcher-offer-collision');
  offer.remove();
});

it('ignores unrelated mutations and defers offer layout reads to one frame', async () => {
  const offer = document.createElement('div');
  offer.className = 'ogabassey-offer-popup';
  const { getByTestId } = render(<Harness position={{ x: 10, y: 10 }} />);
  const anchor = getByTestId('launcher-anchor');
  const measure = vi.spyOn(anchor, 'getBoundingClientRect');
  const measureOffer = vi.spyOn(offer, 'getBoundingClientRect');
  const frameCallbacks: FrameRequestCallback[] = [];
  const requestFrame = vi
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });

  document.body.append(
    document.createElement('div'),
    document.createElement('div'),
    document.createElement('div'),
  );
  await act(async () => {
    await Promise.resolve();
  });

  expect(requestFrame).not.toHaveBeenCalled();
  expect(measure).not.toHaveBeenCalled();

  document.body.append(offer);
  await act(async () => {
    await Promise.resolve();
  });
  expect(requestFrame).toHaveBeenCalledOnce();
  expect(measure).not.toHaveBeenCalled();
  act(() => frameCallbacks.shift()?.(0));
  expect(measure).toHaveBeenCalledOnce();
  expect(measureOffer).toHaveBeenCalledOnce();
  requestFrame.mockRestore();
  offer.remove();
});

it('rechecks overlap when the launcher anchor becomes visible again', async () => {
  resizeObservers.length = 0;
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  const { getByTestId } = render(<Harness position={{ x: 10, y: 10 }} />);
  const anchor = getByTestId('launcher-anchor');
  const offer = document.createElement('div');
  offer.className = 'ogabassey-offer-popup';
  document.body.append(offer);
  const rect = (left: number, top: number) => ({
    left, top, right: left + 56, bottom: top + 56, width: 56, height: 56,
    x: left, y: top, toJSON: () => ({}),
  });
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(20, 20));
  vi.spyOn(offer, 'getBoundingClientRect').mockReturnValue({
    ...rect(0, 0), right: 320, bottom: 240, width: 320, height: 240,
  });
  await act(async () => {
    await Promise.resolve();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  expect(anchor).toHaveAttribute('data-chat-launcher-offer-collision');
  expect(resizeObservers.at(-1)?.observed.has(anchor)).toBe(true);
  expect(resizeObservers.at(-1)?.observed.has(offer)).toBe(true);

  vi.mocked(anchor.getBoundingClientRect).mockReturnValue(rect(500, 500));
  act(() => resizeObservers.at(-1)?.trigger());
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  expect(anchor).not.toHaveAttribute('data-chat-launcher-offer-collision');

  vi.mocked(anchor.getBoundingClientRect).mockReturnValue(rect(20, 20));
  act(() => resizeObservers.at(-1)?.trigger());
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  expect(anchor).toHaveAttribute('data-chat-launcher-offer-collision');
  offer.remove();
  vi.unstubAllGlobals();
});

it('detects an offer overlapping only the launcher overflow bubble', async () => {
  const { getByTestId } = render(
    <Harness position={{ x: 10, y: 10 }} withOverflow />,
  );
  const anchor = getByTestId('launcher-anchor');
  const bubble = getByTestId('overflow');
  const offer = document.createElement('div');
  offer.className = 'ogabassey-offer-popup';
  document.body.append(offer);
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
    left: 500,
    top: 500,
    right: 556,
    bottom: 556,
    width: 56,
    height: 56,
    x: 500,
    y: 500,
    toJSON: () => ({}),
  });
  vi.spyOn(bubble, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    top: 100,
    right: 220,
    bottom: 160,
    width: 120,
    height: 60,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  });
  vi.spyOn(offer, 'getBoundingClientRect').mockReturnValue({
    left: 180,
    top: 120,
    right: 300,
    bottom: 220,
    width: 120,
    height: 100,
    x: 180,
    y: 120,
    toJSON: () => ({}),
  });

  await act(async () => {
    await Promise.resolve();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });

  expect(anchor).toHaveAttribute('data-chat-launcher-offer-collision');
  offer.remove();
});
