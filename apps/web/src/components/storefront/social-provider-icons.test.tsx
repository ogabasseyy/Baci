import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppleMark, GoogleMark } from './social-provider-icons';

describe('social provider marks', () => {
  it.each([
    ['Google', GoogleMark],
    ['Apple', AppleMark],
  ] as const)('%s is decorative', (_name, Mark) => {
    const { container } = render(<Mark />);
    expect(container.querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
  });
});
