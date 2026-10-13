import { asyncStorage } from '@/lib/storage';
import {
  clearQuizRecoveryEnvelope,
  createQuizRecoveryEnvelope,
  loadQuizRecoveryEnvelope,
  loadQuizRecoveryEnvelopes,
  saveQuizRecoveryEnvelope,
} from './quiz-recovery-envelope';

const envelope = createQuizRecoveryEnvelope({
  attemptId: 'attempt-1',
  currentQuestionId: 'question-1',
  eventId: 'event-1',
  generation: 2,
  pendingLockedOptionId: 'option-b',
  startRequestId: '11111111-1111-4111-8111-111111111111',
  userId: 'user-1',
});

describe('quiz recovery envelope', () => {
  afterEach(async () => {
    await clearQuizRecoveryEnvelope('user-1', 'event-1');
    await clearQuizRecoveryEnvelope('user-1', 'event-active');
    await clearQuizRecoveryEnvelope('user-1', 'event-terminal');
  });

  it('persists only the minimal account and event-bound recovery fields', async () => {
    await saveQuizRecoveryEnvelope(envelope);
    await expect(
      loadQuizRecoveryEnvelope('user-1', 'event-1')
    ).resolves.toEqual(envelope);
    const serialized = JSON.stringify(
      await loadQuizRecoveryEnvelope('user-1', 'event-1')
    );
    expect(serialized).not.toMatch(
      /prompt|label|fingerprint|username|dateOfBirth|claim|token/i
    );
  });

  it('does not return an envelope for another account or event', async () => {
    await saveQuizRecoveryEnvelope(envelope);
    await expect(
      loadQuizRecoveryEnvelope('user-2', 'event-1')
    ).resolves.toBeNull();
    await expect(
      loadQuizRecoveryEnvelope('user-1', 'event-2')
    ).resolves.toBeNull();
  });

  it('discards malformed stored data', async () => {
    const key = 'baci:quiz-recovery:v1:user-1:event-1';
    await asyncStorage.setItem(
      key,
      JSON.stringify({ ...envelope, claimToken: 'secret' })
    );
    await expect(
      loadQuizRecoveryEnvelope('user-1', 'event-1')
    ).resolves.toBeNull();
  });

  it('finds retained envelopes for a signed-in user after a restart', async () => {
    const retained = createQuizRecoveryEnvelope({
      ...envelope,
      eventId: 'event/retained',
    });
    await saveQuizRecoveryEnvelope(retained);

    await expect(loadQuizRecoveryEnvelopes('user-1')).resolves.toEqual([
      retained,
    ]);

    await clearQuizRecoveryEnvelope('user-1', 'event/retained');
  });

  it('prioritizes an active attempt over an older terminal envelope across restarts', async () => {
    const terminal = createQuizRecoveryEnvelope({
      ...envelope,
      attemptId: 'attempt-terminal',
      currentQuestionId: null,
      eventId: 'event-terminal',
      generation: 5,
      pendingLockedOptionId: null,
      persistedAt: '2026-08-01T10:00:00.000Z',
    });
    const active = createQuizRecoveryEnvelope({
      ...envelope,
      attemptId: 'attempt-active',
      currentQuestionId: 'question-active',
      eventId: 'event-active',
      generation: 0,
      persistedAt: '2026-08-02T10:00:00.000Z',
    });
    await saveQuizRecoveryEnvelope(terminal);
    await saveQuizRecoveryEnvelope(active);

    await expect(loadQuizRecoveryEnvelopes('user-1')).resolves.toEqual([
      active,
      terminal,
    ]);
  });
});
