import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import StorefrontFullCssLayout from './layout';

describe('StorefrontFullCssLayout', () => {
  it('returns children directly', () => {
    const result = StorefrontFullCssLayout({
      children: <div>Home child</div>,
    });

    render(result);
    expect(screen.getByText('Home child')).toBeInTheDocument();
  });
});
