import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { V2ThemeProvider } from '../providers/v2-theme-context';
import { Logo } from './Logo';

describe('components/Logo', () => {
  it('renders safely outside of V2ThemeProvider without throwing', () => {
    render(<Logo data-testid="standalone-logo" />);

    const svg = screen.getByLabelText('Ogabassey Logo');
    expect(svg).toBeInTheDocument();
    expect(svg.tagName.toLowerCase()).toBe('svg');
  });

  it('renders seasonal elements when inside V2ThemeProvider with santa theme', () => {
    render(
      <V2ThemeProvider initialTheme="santa">
        <Logo data-testid="santa-logo" />
      </V2ThemeProvider>
    );

    const svg = screen.getByLabelText('Ogabassey Logo');
    expect(svg).toBeInTheDocument();
  });
});
