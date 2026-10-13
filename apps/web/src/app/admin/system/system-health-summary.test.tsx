import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SystemHealthSummary } from './system-health-summary';

describe('SystemHealthSummary', () => {
  it('calculates a score from successful checks rather than inferring success from absent data', () => {
    render(
      <SystemHealthSummary
        health={{
          checkedAt: '2026-03-20T10:00:00.000Z',
          health: [
            { check_name: 'Database', message: 'Ready', status: 'healthy' },
            { check_name: 'Backups', message: 'Unknown', status: 'warning' },
          ],
          indexRecommendations: [],
          missingIndexes: [],
        }}
        loading={false}
      />
    );

    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 checks passing')).toBeInTheDocument();
  });

  it('renders an explicit unknown last-check state when data is absent', () => {
    render(<SystemHealthSummary health={null} loading={false} />);

    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('0 of 0 checks passing')).toBeInTheDocument();
    expect(screen.getByLabelText('Warning overall health')).toBeInTheDocument();
  });

  it('keeps an otherwise high pass rate critical when one check is critical', () => {
    render(
      <SystemHealthSummary
        health={{
          checkedAt: '2026-03-20T10:00:00.000Z',
          health: [
            { check_name: 'One', message: 'Ready', status: 'healthy' },
            { check_name: 'Two', message: 'Ready', status: 'healthy' },
            { check_name: 'Three', message: 'Ready', status: 'healthy' },
            { check_name: 'Four', message: 'Ready', status: 'healthy' },
            {
              check_name: 'Dead letters',
              message: 'Blocked',
              status: 'critical',
            },
          ],
          indexRecommendations: [],
          missingIndexes: [],
        }}
        loading={false}
      />
    );

    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('critical overall health')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Critical overall health')
    ).toBeInTheDocument();
  });
});
