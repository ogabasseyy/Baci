import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChevronToggle } from './chevron-toggle';

describe('ChevronToggle', () => {
  it('rotates the chevron only when expanded', () => {
    const { container, rerender } = render(<ChevronToggle />);

    expect(container.querySelector('svg')).not.toHaveClass('rotate-180');

    rerender(<ChevronToggle isExpanded />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('rotate-180');
    expect(svg).toHaveClass('motion-safe:transition-transform');
  });
});
