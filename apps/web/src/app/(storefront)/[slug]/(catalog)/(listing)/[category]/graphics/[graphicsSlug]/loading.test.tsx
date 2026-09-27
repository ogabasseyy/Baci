import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import GamingGraphicsHubLoading from './loading';

describe('GamingGraphicsHubLoading', () => {
  it('renders the shared catalog listing shell', () => {
    render(<GamingGraphicsHubLoading />);

    expect(
      screen.getByRole('status', { name: 'Loading product listing' })
    ).toBeInTheDocument();
  });
});
