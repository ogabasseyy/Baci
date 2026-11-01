import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { BufferedNativeCustomizePreviewPane } from './BufferedNativeCustomizePreviewPane';

vi.mock('react-native', () => ({
  View: ({
    children,
    style,
  }: {
    children: React.ReactNode;
    style?: { opacity?: number };
  }) => <div style={style}>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    accessibilityLabel: string;
  }) => (
    <button type="button" onClick={onPress} aria-label={accessibilityLabel}>
      {children}
    </button>
  ),
  ActivityIndicator: () => <span>Loading</span>,
  StyleSheet: { create: (value: unknown) => value },
}));
const callbacks = new Map<
  number,
  { success: () => void; failure: () => void }
>();
vi.mock('./NativeCustomizePreviewPane', () => ({
  NativeCustomizePreviewPane: ({
    draftRevision,
    onSlotRendered,
    onSlotFailure,
  }: {
    draftRevision: number;
    onSlotRendered: () => void;
    onSlotFailure: () => void;
  }) => {
    callbacks.set(draftRevision, {
      success: onSlotRendered,
      failure: onSlotFailure,
    });
    return <span>draft-{draftRevision}</span>;
  },
}));
const props = {
  colors: LIGHT_COLORS,
  identityKey: 'user:store',
  draftRevision: 1,
  config: {},
  merchant: { id: 'store', slug: 'store' },
  isIdentityCurrent: () => true,
  previewUrl: 'https://usebaci.com/template-preview/builder-preview?native=2',
};
describe('buffered native preview', () => {
  it('fences a failed slot after retry starts a fresh instance', () => {
    const { rerender } = render(
      <BufferedNativeCustomizePreviewPane {...props} />
    );
    act(() => callbacks.get(1)?.success());
    rerender(
      <BufferedNativeCustomizePreviewPane {...props} draftRevision={2} />
    );
    const old = callbacks.get(2);
    act(() => old?.failure());
    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
    const retry = callbacks.get(2);
    act(() => old?.success());
    expect(screen.getByText('draft-1').parentElement).toHaveStyle({
      opacity: '1',
    });
    act(() => retry?.success());
    expect(screen.getByText('draft-2').parentElement).toHaveStyle({
      opacity: '1',
    });
  });
  it('does not promote a superseded candidate', () => {
    const { rerender } = render(
      <BufferedNativeCustomizePreviewPane {...props} />
    );
    act(() => callbacks.get(1)?.success());
    rerender(
      <BufferedNativeCustomizePreviewPane {...props} draftRevision={2} />
    );
    const old = callbacks.get(2);
    rerender(
      <BufferedNativeCustomizePreviewPane {...props} draftRevision={3} />
    );
    act(() => old?.success());
    expect(screen.getByText('draft-1').parentElement).toHaveStyle({
      opacity: '1',
    });
    expect(screen.getByText('draft-3').parentElement).toHaveStyle({
      opacity: '0',
    });
    act(() => callbacks.get(3)?.success());
    expect(screen.getByText('draft-3').parentElement).toHaveStyle({
      opacity: '1',
    });
    expect(screen.queryByText('draft-1')).not.toBeInTheDocument();
  });
  it('keeps the last successful surface visible after a timeout and a late success', () => {
    const { rerender } = render(
      <BufferedNativeCustomizePreviewPane {...props} />
    );
    act(() => callbacks.get(1)?.success());
    expect(screen.getByText('draft-1').parentElement).toHaveStyle({
      opacity: '1',
    });
    rerender(
      <BufferedNativeCustomizePreviewPane {...props} draftRevision={2} />
    );
    const late = callbacks.get(2);
    expect(screen.getByText('draft-2').parentElement).toHaveStyle({
      opacity: '0',
    });
    act(() => late?.failure());
    act(() => late?.success());
    expect(screen.getByText('draft-1').parentElement).toHaveStyle({
      opacity: '1',
    });
    expect(screen.queryByText('draft-2')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Retry preview' })
    ).toBeInTheDocument();
  });
});
