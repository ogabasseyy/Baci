import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SparklesIcon } from './swap-sparkles-icon';

describe('SparklesIcon', () => {
  it('renders a 20px icon by default', () => {
    const { container } = render(<SparklesIcon />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
    expect(svg?.querySelector('path')).toBeInTheDocument();
  });

  it('applies the supplied size and class name', () => {
    const { container } = render(
      <SparklesIcon size={32} className="text-red-600" />
    );
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('height', '32');
    expect(svg).toHaveClass('text-red-600');
  });
});
