import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OgabasseyImeiCheckerShell } from './imei-checker-shell';

describe('OgabasseyImeiCheckerShell', () => {
  it('wraps children in the full-page checker chrome', () => {
    const { container } = render(
      <OgabasseyImeiCheckerShell>
        <p>Checker body</p>
      </OgabasseyImeiCheckerShell>
    );

    expect(screen.getByText('Checker body')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass(
      'min-h-screen',
      'pt-4',
      'md:pt-8'
    );
  });

  it('omits the chrome when the parent already owns the page shell', () => {
    const { container } = render(
      <OgabasseyImeiCheckerShell omitShell>
        <p>Checker body</p>
      </OgabasseyImeiCheckerShell>
    );

    expect(container.firstElementChild?.tagName).toBe('P');
    expect(container.firstElementChild).not.toHaveClass('min-h-screen');
  });
});
