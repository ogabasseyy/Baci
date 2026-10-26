import { afterEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import dragTestSupport from './use-chat-launcher-drag.test-support';

const { setup } = dragTestSupport;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('writes the release transform when a drag returns to its saved position', () => {
  const { pointer, flush } = setup({ initialPosition: { x: 100, y: 200 } });
  pointer('pointerdown', 220, 320);
  pointer('pointermove', 320, 420);
  flush();
  expect(screen.getByTestId('anchor').style.transform).toBe(
    'translate3d(200px, 300px, 0)',
  );

  pointer('pointerup', 120, 220);
  expect(screen.getByTestId('anchor').style.transform).toBe(
    'translate3d(100px, 200px, 0)',
  );
});
