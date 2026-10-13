import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StaticUtilityWords } from './static-utility-words';

describe('StaticUtilityWords', () => {
  it('shows the first word and hides the rest from assistive tech', () => {
    render(<StaticUtilityWords minWidthClass="min-w-[60px]" />);

    expect(screen.getByText('Airtime!')).toBeVisible();
    for (const word of ['Data!', 'TV!', 'Power!', 'Gaming!']) {
      expect(screen.getByText(word)).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('applies the minimum width class', () => {
    const { container } = render(
      <StaticUtilityWords minWidthClass="min-w-[80px]" />
    );

    expect(container.firstChild).toHaveClass('min-w-[80px]');
  });
});
