import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OperationsIncidentTable } from './operations-incident-table';

describe('OperationsIncidentTable', () => {
  it('shows an empty state when no incidents are supplied', () => {
    render(
      <OperationsIncidentTable
        columns={[{ key: 'merchantName', label: 'Merchant' }]}
        empty="No incidents."
        rows={[]}
        title="Operational incidents"
      />
    );

    expect(screen.getByText('No incidents.')).toBeVisible();
  });

  it('preserves a custom cell renderer and safely labels missing text', () => {
    render(
      <OperationsIncidentTable
        columns={[
          { key: 'merchantName', label: 'Merchant' },
          {
            key: 'attempts',
            label: 'Attempts',
            render: (value) => `Attempt ${String(value)}`,
          },
        ]}
        empty="No incidents."
        rows={[{ attempts: 2, id: 'incident-1', merchantName: '' }]}
        title="Operational incidents"
      />
    );

    expect(screen.getByRole('cell', { name: '—' })).toBeVisible();
    expect(screen.getByRole('cell', { name: 'Attempt 2' })).toBeVisible();
  });
});
