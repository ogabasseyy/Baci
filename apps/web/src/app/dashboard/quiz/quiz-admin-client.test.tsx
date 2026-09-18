import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuizAdminClient } from './quiz-admin-client';

const mockApiPost = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(),
  apiPost: (...args: unknown[]) => mockApiPost(...args),
}));

const prize = {
  available: true,
  condition: 'new',
  defaultVariantId: null,
  effectiveStock: 2,
  hasVariants: false,
  id: '55555555-5555-4555-8555-555555555555',
  imageUrl: 'https://cdn.example.com/iphone.png',
  manageStock: true,
  name: 'iPhone XR',
  price: 300000,
  requiresVariantSelection: false,
  selectionId: '55555555-5555-4555-8555-555555555555:product',
  variantId: null,
  variantLabel: null,
};

const generated = {
  event: {
    id: 'event-1',
    slug: 'daily-phone-quiz',
    status: 'draft',
    title: 'Daily Phone Quiz',
  },
  questions: [
    {
      correctOptionId: 'b',
      difficulty: 'standard',
      explanation: 'USB-C arrived on iPhone 15.',
      options: [
        { id: 'a', label: 'iPhone 13' },
        { id: 'b', label: 'iPhone 15' },
      ],
      prompt: 'Which iPhone model introduced USB-C?',
      topic: 'iPhone buying advice',
    },
  ],
};

describe('QuizAdminClient', () => {
  beforeEach(() => mockApiPost.mockReset());

  it('submits exact prize identity, topics, mode, and per-question time', async () => {
    mockApiPost.mockResolvedValue(generated);
    const user = userEvent.setup();
    render(<QuizAdminClient initialPrizeProducts={[prize]} />);

    await user.click(screen.getByRole('button', { name: /generate draft/i }));
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledOnce());
    expect(mockApiPost).toHaveBeenCalledWith(
      '/api/merchant/quiz/generate',
      expect.objectContaining({
        mode: 'test',
        prizeCondition: 'new',
        prizeEffectiveStock: 2,
        prizeImageUrl: prize.imageUrl,
        prizeProductId: prize.id,
        questionCountPerTopic: 1,
        timeLimitSeconds: 10,
        topics: ['iPhone buying advice', 'Android buying advice'],
      })
    );
    expect(
      await screen.findByText(/Questions to review: 1/)
    ).toBeInTheDocument();
  });

  it('uses topic chips with a discoverable keyboard input', async () => {
    const user = userEvent.setup();
    render(<QuizAdminClient initialPrizeProducts={[prize]} />);
    const input = screen.getByPlaceholderText(/type a topic/i);
    await user.type(input, 'Samsung Fold{Enter}');
    expect(screen.getByText('Samsung Fold')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /remove samsung fold/i })
    );
    expect(screen.queryByText('Samsung Fold')).not.toBeInTheDocument();
  });

  it('reviews in a bounded region and confirms launch details in a dialog', async () => {
    mockApiPost.mockResolvedValueOnce(generated).mockResolvedValueOnce({
      event: { ...generated.event, status: 'active' },
    });
    const user = userEvent.setup();
    render(<QuizAdminClient initialPrizeProducts={[prize]} />);
    // Scheduled timing is the form default; this flow covers the immediate
    // activation payload.
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Launch timing' }),
      'immediate'
    );
    await user.click(screen.getByRole('button', { name: /generate draft/i }));
    await user.click(
      await screen.findByRole('checkbox', {
        name: /reviewed every correct answer/i,
      })
    );
    await user.click(screen.getByRole('button', { name: /launch quiz/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('iPhone XR')).toBeInTheDocument();
    expect(
      within(dialog).getByText(/10 seconds per question/i)
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: /launch quiz/i })
    );
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(2));
    expect(mockApiPost).toHaveBeenLastCalledWith(
      '/api/merchant/quiz/activate',
      expect.objectContaining({
        mode: 'test',
        rulesVersion: 'test-v1',
        timing: { kind: 'immediate', liveWindowSeconds: 300 },
      })
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(screen.getByText('Quiz launched')).toBeInTheDocument();
  });

  it('uses the launch policy for a live selection instead of test rules', async () => {
    mockApiPost.mockResolvedValueOnce(generated).mockResolvedValueOnce({
      event: { ...generated.event, status: 'active' },
    });
    const user = userEvent.setup();
    render(<QuizAdminClient initialPrizeProducts={[prize]} />);
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Mode' }),
      'live'
    );
    await user.click(screen.getByRole('button', { name: /generate draft/i }));
    await user.click(
      await screen.findByRole('checkbox', {
        name: /reviewed every correct answer/i,
      })
    );
    await user.click(screen.getByRole('button', { name: /launch quiz/i }));
    await user.type(
      within(screen.getByRole('dialog')).getByLabelText('Evidence reference'),
      'Free-entry rules and counsel note 2026-08'
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: /launch quiz/i,
      })
    );

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(2));
    expect(mockApiPost).toHaveBeenLastCalledWith(
      '/api/merchant/quiz/activate',
      expect.objectContaining({
        maxAttempts: 1,
        mode: 'live',
        regulatoryCompliance: {
          basis: 'free_skill_competition',
          evidenceReference: 'Free-entry rules and counsel note 2026-08',
          jurisdiction: 'NG-LA',
        },
        rulesVersion: 'live-v1',
        timeZone: 'Africa/Lagos',
        variantsPerQuestion: 3,
      })
    );
  });

  it('keeps a failed activation visible inside the launch dialog', async () => {
    mockApiPost
      .mockResolvedValueOnce(generated)
      .mockRejectedValueOnce(new Error('Launch service unavailable'));
    const user = userEvent.setup();
    render(<QuizAdminClient initialPrizeProducts={[prize]} />);

    await user.click(screen.getByRole('button', { name: /generate draft/i }));
    await user.click(
      await screen.findByRole('checkbox', {
        name: /reviewed every correct answer/i,
      })
    );
    await user.click(screen.getByRole('button', { name: /launch quiz/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: /launch quiz/i })
    );

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Launch service unavailable'
    );
  });

  it('rejects stale scheduled dates before posting an activation request', async () => {
    mockApiPost.mockResolvedValueOnce(generated);
    const user = userEvent.setup();
    render(<QuizAdminClient initialPrizeProducts={[prize]} />);

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Launch timing' }),
      'scheduled'
    );
    await user.clear(screen.getByLabelText('Scheduled start'));
    await user.type(
      screen.getByLabelText('Scheduled start'),
      '2020-01-01T09:00'
    );
    await user.clear(screen.getByLabelText('Universal end'));
    await user.type(screen.getByLabelText('Universal end'), '2020-01-01T09:05');
    await user.click(screen.getByRole('button', { name: /generate draft/i }));
    await user.click(
      await screen.findByRole('checkbox', {
        name: /reviewed every correct answer/i,
      })
    );
    await user.click(screen.getByRole('button', { name: /launch quiz/i }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: /launch quiz/i,
      })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /choose a valid future start/i
    );
    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });

  it('preserves Lagos wall-clock schedule times in the activation payload', async () => {
    mockApiPost.mockResolvedValueOnce(generated).mockResolvedValueOnce({
      event: { ...generated.event, status: 'scheduled' },
    });
    const user = userEvent.setup();
    render(<QuizAdminClient initialPrizeProducts={[prize]} />);
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Launch timing' }),
      'scheduled'
    );
    await user.clear(screen.getByLabelText('Scheduled start'));
    await user.type(
      screen.getByLabelText('Scheduled start'),
      '2027-08-06T09:00'
    );
    await user.clear(screen.getByLabelText('Universal end'));
    await user.type(screen.getByLabelText('Universal end'), '2027-08-06T09:05');
    await user.click(screen.getByRole('button', { name: /generate draft/i }));
    await user.click(
      await screen.findByRole('checkbox', {
        name: /reviewed every correct answer/i,
      })
    );
    await user.click(screen.getByRole('button', { name: /launch quiz/i }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: /launch quiz/i,
      })
    );

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(2));
    expect(mockApiPost).toHaveBeenLastCalledWith(
      '/api/merchant/quiz/activate',
      expect.objectContaining({
        timeZone: 'Africa/Lagos',
        timing: {
          endsAt: '2027-08-06T08:05:00.000Z',
          kind: 'scheduled',
          startsAt: '2027-08-06T08:00:00.000Z',
        },
      })
    );
  });

  it('shows a generation error once when draft generation fails', async () => {
    mockApiPost.mockRejectedValueOnce(new Error('Gemma is unavailable'));
    const user = userEvent.setup();
    render(<QuizAdminClient initialPrizeProducts={[prize]} />);
    await user.click(screen.getByRole('button', { name: /generate draft/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Gemma is unavailable'
    );
  });

  it('shows an initial prize inventory error only in the product picker', async () => {
    const user = userEvent.setup();
    render(
      <QuizAdminClient
        initialPrizeProducts={[prize]}
        initialPrizeProductsError="Could not load more prize products"
      />
    );

    await user.click(
      screen.getByRole('combobox', { name: 'Search prize product inventory' })
    );
    expect(
      screen.getAllByText('Could not load more prize products')
    ).toHaveLength(1);
  });

  it('explains that live prizes remain fail closed', async () => {
    const user = userEvent.setup();
    render(<QuizAdminClient initialPrizeProducts={[prize]} />);
    await user.selectOptions(screen.getByLabelText('Mode'), 'live');
    expect(
      screen.getByText(
        /live mode stays locked until production prize approval/i
      )
    ).toBeInTheDocument();
  });
});
