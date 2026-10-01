import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadOperationsData = vi.fn();
const mockToast = vi.fn();

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));
vi.mock('./operations-data', () => ({
  loadOperationsData: (...args: unknown[]) => mockLoadOperationsData(...args),
}));
vi.mock('./event-pipeline-operations', () => ({
  EventPipelineOperations: ({ canReplay }: { canReplay: boolean }) => (
    <div>Pipeline panel ({canReplay ? 'manager' : 'reader'})</div>
  ),
}));

import OperationsPage from './page';

const data = {
  eventPipeline: {
    data: {
      counts: { deliveries: 0, ingress: 0, unknown: 0 },
      deliveries: [],
      ingress: [],
      operations: { deliveries: [], heartbeats: [], queue: null },
      unknown: [],
    },
    error: null,
  },
  operations: {
    data: {
      capabilities: { canReadFinancials: false, canReplay: false },
      financial: {
        paymentSideEffects: [],
        payouts: [],
        reconciliationReview: [],
        settlements: [],
      },
      generatedAt: '2026-08-05T15:02:00.000Z',
      notifications: {
        email: [],
        orderOutbox: [],
        push: [],
        trackingOutbox: [],
      },
      shipping: { shipments: [], webhooks: [] },
      summary: {
        notifications: 0,
        paymentSideEffects: 0,
        payouts: 0,
        reconciliationReview: 0,
        settlements: 0,
        shipping: 0,
        workers: 0,
      },
      workers: [],
    },
    error: null,
  },
};

describe('OperationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads operational triage and lets admins refresh without mutating incidents', async () => {
    const user = userEvent.setup();
    mockLoadOperationsData.mockResolvedValue(data);
    render(<OperationsPage />);

    expect(
      await screen.findByRole('heading', { name: 'Operations' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(mockLoadOperationsData).toHaveBeenCalledTimes(2)
    );
    expect(
      screen.getByText(/never triggers a universal retry/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Pipeline panel (reader)')).toBeInTheDocument();
    expect(
      screen.getByText(/each incident table shows up to 25 rows/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Older incidents' })
    ).toBeDisabled();
  });

  it('enables older pages when an event-pipeline count exceeds this page', async () => {
    const user = userEvent.setup();
    mockLoadOperationsData.mockResolvedValue({
      ...data,
      eventPipeline: {
        ...data.eventPipeline,
        data: {
          ...data.eventPipeline.data,
          counts: { deliveries: 26, ingress: 0, unknown: 0 },
        },
      },
    });
    render(<OperationsPage />);

    await screen.findByRole('heading', { name: 'Operations' });
    await user.click(screen.getByRole('button', { name: 'Older incidents' }));

    expect(mockLoadOperationsData).toHaveBeenLastCalledWith(25);
  });

  it('navigates to older bounded incident pages', async () => {
    const user = userEvent.setup();
    mockLoadOperationsData.mockResolvedValue({
      ...data,
      operations: {
        ...data.operations,
        data: {
          ...data.operations.data,
          workers: Array.from({ length: 25 }, (_, index) => ({
            lastErrorAt: null,
            lastErrorCode: null,
            lastSucceededAt: null,
            processedCount: 0,
            state: 'healthy',
            updatedAt: '2026-08-05T15:02:00.000Z',
            workerName: `Worker ${index}`,
          })),
        },
      },
    });
    render(<OperationsPage />);

    await screen.findByRole('heading', { name: 'Operations' });
    await user.click(screen.getByRole('button', { name: 'Older incidents' }));

    expect(mockLoadOperationsData).toHaveBeenLastCalledWith(25);
    expect(screen.getByText(/starting at item 26/i)).toBeInTheDocument();
  });

  it('shows an event-pipeline error without hiding the payments section', async () => {
    const user = userEvent.setup();
    mockLoadOperationsData.mockResolvedValue({
      ...data,
      eventPipeline: {
        data: null,
        error: 'Event pipeline incidents could not be loaded.',
      },
    });
    render(<OperationsPage />);

    expect(
      await screen.findByText('Event pipeline unavailable')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Payments' }));
    expect(
      await screen.findByText('Unresolved reconciliation review')
    ).toBeInTheDocument();
  });
});
