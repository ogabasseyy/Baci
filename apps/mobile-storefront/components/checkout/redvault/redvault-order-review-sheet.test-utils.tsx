import type { ReactNode } from 'react';

export function RedvaultReviewTestSheet({
  children,
  visible,
}: {
  children: ReactNode;
  visible: boolean;
}) {
  return visible ? children : null;
}
