import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { CSSProperties, ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { ModalSafeArea } from './ModalSafeArea';

vi.mock('react-native', () => ({
  Pressable: ({
    onPress,
    style,
  }: {
    onPress: () => void;
    style: CSSProperties[];
  }) => (
    <button
      aria-label="Window backdrop"
      onClick={onPress}
      style={Object.assign({}, ...style)}
      type="button"
    />
  ),
  StyleSheet: {
    absoluteFill: { position: 'absolute', inset: 0 },
    create: (styles: Record<string, CSSProperties>) => styles,
  },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

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
  const dismiss = vi.fn();
  render(
    <ModalSafeArea
      backdropColor="rgba(0, 0, 0, 0.5)"
      onBackdropPress={dismiss}
      style={{ flex: 1, alignItems: 'center' }}
    >
      <span>Report controls</span>
    </ModalSafeArea>
  );

  const provider = screen.getByRole('region', { name: 'Presented window' });
  const safeArea = within(provider).getByRole('region', { name: 'Safe area' });
  expect(safeArea).toHaveStyle({ flex: '1', alignItems: 'center' });
  expect(within(safeArea).getByText('Report controls')).toBeVisible();

  const backdrop = screen.getByRole('button', { name: 'Window backdrop' });
  expect(provider).not.toContainElement(backdrop);
  expect(backdrop).toHaveStyle({
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    position: 'absolute',
    inset: '0',
  });
  fireEvent.click(backdrop);
  expect(dismiss).toHaveBeenCalledOnce();
});
