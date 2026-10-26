import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { expect, it, vi } from 'vitest';
import type { Position } from './chat-launcher-geometry';
import { useChatLauncherOfferCollision } from './use-chat-launcher-offer-collision';

function Harness({ position }: { position?: Position }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  useChatLauncherOfferCollision(anchorRef, position);
  return <div ref={anchorRef} data-testid="launcher-anchor" />;
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
