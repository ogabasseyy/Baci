import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SuccessCheck } from './success-check';

describe('SuccessCheck', () => {
  it('applies the success check delay and gated entrance', () => {
    const { container } = render(<SuccessCheck delay={0.5} />);

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('style')).toContain('animation-delay: 0.5s');
    expect(svg?.className.baseVal ?? svg?.className).toContain(
      'motion-safe:zoom-in-95'
    );
  });
});
