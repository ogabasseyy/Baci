import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RewardsLayout, { metadata } from './layout';

describe('RewardsLayout', () => {
  it('marks rewards routes noindex and nofollow', () => {
    expect(metadata.robots).toMatchObject({ follow: false, index: false });
  });

  it('renders children directly', () => {
    render(
      <RewardsLayout>
        <div>Rewards content</div>
      </RewardsLayout>
    );

    expect(screen.getByText('Rewards content')).toBeInTheDocument();
  });
});
