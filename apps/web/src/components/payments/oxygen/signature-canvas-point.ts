import type { PointerEvent } from 'react';

export function signatureCanvasPoint(event: PointerEvent<HTMLCanvasElement>) {
  const element = event.currentTarget;
  const rect = element.getBoundingClientRect();
  return [
    ((event.clientX - rect.left) * element.width) / rect.width,
    ((event.clientY - rect.top) * element.height) / rect.height,
  ] as const;
}
