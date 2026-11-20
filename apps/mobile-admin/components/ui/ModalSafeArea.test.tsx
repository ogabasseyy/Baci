import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import type { CSSProperties, ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { ModalSafeArea } from './ModalSafeArea';

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children?: ReactNode }) => (
    <section aria-label="Presented window">{children}</section>
  ),
  SafeAreaView: ({
    children,
    style,
  }: {
    children?: ReactNode;
    style?: CSSProperties;
  }) => (
    <section aria-label="Safe area" style={style}>
      {children}
    </section>
  ),
}));

it('renders the content and its layout style inside the modal inset provider', () => {
  render(
    <ModalSafeArea style={{ flex: 1, alignItems: 'center' }}>
      <span>Report controls</span>
    </ModalSafeArea>
  );

  const provider = screen.getByRole('region', { name: 'Presented window' });
  const safeArea = within(provider).getByRole('region', { name: 'Safe area' });
  expect(safeArea).toHaveStyle({ flex: '1', alignItems: 'center' });
  expect(within(safeArea).getByText('Report controls')).toBeVisible();
});
