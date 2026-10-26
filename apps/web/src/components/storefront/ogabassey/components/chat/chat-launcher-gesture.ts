import type { Overflow, Position } from './chat-launcher-geometry';

export type Gesture = {
  pointerId: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  left: number;
  top: number;
  width: number;
  height: number;
  bottomSafeArea: number;
  mobileOffset: number;
  overflow: Overflow;
  base: Position;
  next: Position;
};
