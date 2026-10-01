import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuditEventsTable } from './audit-events-table';

describe('AuditEventsTable', () => {
  it('shows a safe event projection without raw audit payloads', () => {
    render(
      <AuditEventsTable
        cursor={null}
        events={[
          {
            action: 'audit.exported',
            actorKind: 'Platform admin',
            changedFields: ['is_published'],
            eventId: 'd8543bf1-5f03-4fd1-8a2a-2f7f1658c3f1',
            eventSource: 'platform',
            occurredAt: '2026-08-05T10:00:00.000Z',
            resourceType: 'audit_timeline',
          },
        ]}
        isLoading={false}
        isLoadingMore={false}
        loadError={null}
        onLoadMore={() => undefined}
      />
    );

    expect(screen.getByText('audit.exported')).toBeInTheDocument();
    expect(screen.getByText('is_published')).toBeInTheDocument();
    expect(
      screen.queryByText('d8543bf1-5f03-4fd1-8a2a-2f7f1658c3f1')
    ).not.toBeInTheDocument();
  });

  it('renders an accessible empty state', () => {
    render(
      <AuditEventsTable
        cursor={null}
        events={[]}
        isLoading={false}
        isLoadingMore={false}
        loadError={null}
        onLoadMore={() => undefined}
      />
    );

    expect(screen.getByText(/no events match/i)).toBeInTheDocument();
  });

  it('announces loading and reports errors with live-region semantics', () => {
    const { rerender } = render(
      <AuditEventsTable
        cursor={null}
        events={[]}
        isLoading
        isLoadingMore={false}
        loadError={null}
        onLoadMore={() => undefined}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading audit events'
    );

    rerender(
      <AuditEventsTable
        cursor={null}
        events={[]}
        isLoading={false}
        isLoadingMore={false}
        loadError="The audit timeline could not be loaded."
        onLoadMore={() => undefined}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The audit timeline could not be loaded.'
    );
  });
});
