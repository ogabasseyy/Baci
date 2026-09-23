import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepairStatusLookup } from './repair-status-lookup';

const mocks = vi.hoisted(() => ({
  fetchWithCsrf: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: mocks.fetchWithCsrf,
}));

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

function submitLookup() {
  fireEvent.change(screen.getByLabelText('Ticket number'), {
    target: { value: '1042' },
  });
  fireEvent.change(screen.getByLabelText('Email used to book'), {
    target: { value: 'ada@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Check status/i }));
}

describe('RepairStatusLookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the current status on a successful lookup', async () => {
    mocks.fetchWithCsrf.mockResolvedValueOnce(
      jsonResponse(200, {
        found: true,
        repair: {
          ticketNumber: 1042,
          status: 'in_progress',
          deviceLabel: 'Smartphone iPhone 15',
          repairTypeLabel: 'Screen Replacement',
          serviceType: 'pickup',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-05T00:00:00.000Z',
          trackingNumber: null,
        },
      })
    );

    render(<RepairStatusLookup slug="acme" />);
    submitLookup();

    expect(await screen.findByText('Ticket #1042')).toBeInTheDocument();
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0);
    expect(mocks.fetchWithCsrf).toHaveBeenCalledWith(
      '/api/storefront/acme/repair/status',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('prefills the ticket returned by the payment callback', () => {
    render(<RepairStatusLookup initialTicket="1042" slug="acme" />);

    expect(screen.getByLabelText('Ticket number')).toHaveValue('1042');
  });

  it('shows a not-found message for a mismatch', async () => {
    mocks.fetchWithCsrf.mockResolvedValueOnce(
      jsonResponse(200, { found: false })
    );

    render(<RepairStatusLookup slug="acme" />);
    submitLookup();

    expect(
      await screen.findByText(/couldn't find a repair matching/i)
    ).toBeInTheDocument();
  });

  it('surfaces a friendly error when rate limited', async () => {
    mocks.fetchWithCsrf.mockResolvedValueOnce(jsonResponse(429, {}));

    render(<RepairStatusLookup slug="acme" />);
    submitLookup();

    expect(await screen.findByText(/Too many lookups/i)).toBeInTheDocument();
  });

  it('surfaces a generic error on failure', async () => {
    mocks.fetchWithCsrf.mockRejectedValueOnce(new Error('network'));

    render(<RepairStatusLookup slug="acme" />);
    submitLookup();

    await waitFor(() =>
      expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument()
    );
  });
});
