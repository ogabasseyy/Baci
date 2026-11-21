import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InsightsStat } from './insights-stat';

describe('InsightsStat', () => {
  it('shows the label with its value', () => {
    render(
      <dl>
        <InsightsStat label="Resolved" value="6" />
      </dl>
    );
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
  });
});
