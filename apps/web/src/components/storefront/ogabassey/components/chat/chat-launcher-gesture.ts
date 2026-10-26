import type { Overflow, Position, SafeAreaEdges } from './chat-launcher-geometry';

export type Gesture = {
  pointerId: number;
  pointerType: string;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  left: number;
  top: number;
  width: number;
  height: number;
  bottomSafeArea: number;
  safeArea: SafeAreaEdges;
  mobileOffset: number;
  overflow: Overflow;
  base: Position;
  next: Position;
};
