import { expect, it, vi } from 'vitest';

const connection = vi.hoisted(() => vi.fn());
vi.mock('next/server', () => ({ connection }));

import { OrderDetailsRequestMarker } from './order-details-request-marker';

it('awaits request binding and renders no customer data', async () => {
  let release!: () => void;
  connection.mockReturnValue(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  let finished = false;
  const result = OrderDetailsRequestMarker().then((value) => {
    finished = true;
    return value;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  release();
  await expect(result).resolves.toBeNull();
  expect(connection).toHaveBeenCalledOnce();
});
