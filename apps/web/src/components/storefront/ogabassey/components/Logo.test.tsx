import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { V2ThemeProvider } from '../providers/v2-theme-context';
import { Logo } from './Logo';

describe('components/Logo', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders safely outside of V2ThemeProvider without throwing', () => {
    render(<Logo data-testid="standalone-logo" />);

    const svg = screen.getByLabelText('Ogabassey Logo');
    expect(svg).toBeInTheDocument();
    expect(svg.tagName.toLowerCase()).toBe('svg');
  });

  it('renders seasonal elements when inside V2ThemeProvider with santa theme', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 11, 15));

    const { container } = render(
      <V2ThemeProvider initialTheme="santa">
        <Logo data-testid="santa-logo" />
      </V2ThemeProvider>
    );

    const svg = screen.getByLabelText('Ogabassey Logo');
    expect(svg).toBeInTheDocument();
    expect(container.querySelector('circle[r="10"]')).not.toBeNull();
  });
});
