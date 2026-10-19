import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SystemHealthChecks } from './system-health-checks';

describe('SystemHealthChecks', () => {
  it('renders the worker health basis without inferring a successful run', () => {
    render(
      <SystemHealthChecks
        checks={[
          {
            check_name: 'Event pipeline workers',
            details: {
              health_basis: 'recent_heartbeat_and_no_newer_error',
            },
            message:
              'All observed worker heartbeats are recent with no newer recorded error.',
            status: 'healthy',
          },
        ]}
        loading={false}
      />
    );

    expect(
      screen.getByText(
        'All observed worker heartbeats are recent with no newer recorded error.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });
});
