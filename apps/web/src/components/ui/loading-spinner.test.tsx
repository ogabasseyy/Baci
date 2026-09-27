import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoadingSpinner } from './loading-spinner';

describe('LoadingSpinner', () => {
  it('spins the loading spinner with a sized hidden svg', () => {
    const { container } = render(<LoadingSpinner size={32} />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('width', '32');
    expect(container.firstElementChild?.className).toContain(
      'motion-safe:animate-spin'
    );
  });
});
