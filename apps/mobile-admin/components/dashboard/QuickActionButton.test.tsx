import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: LIGHT_COLORS,
    shadows: { sm: {} },
  }),
}));

import { QuickActionButton } from './QuickActionButton';

describe('QuickActionButton badge', () => {
  it('shows the count and announces it', () => {
    render(
      <QuickActionButton
        badgeCount={4}
        icon="chatbox-ellipses-outline"
        label="Messages"
        onPress={() => {}}
      />
    );
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Messages, 4 waiting' })
    ).toBeInTheDocument();
  });

  it('caps large counts at 99+', () => {
    render(
      <QuickActionButton
        badgeCount={250}
        icon="chatbox-ellipses-outline"
        label="Messages"
        onPress={() => {}}
      />
    );
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('shows no badge at zero', () => {
    render(
      <QuickActionButton
        badgeCount={0}
        icon="chatbox-ellipses-outline"
        label="Messages"
        onPress={() => {}}
      />
    );
    expect(screen.queryByText('0')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Messages' })
    ).toBeInTheDocument();
  });
});
