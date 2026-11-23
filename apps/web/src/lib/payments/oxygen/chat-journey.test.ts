import { describe, expect, it } from 'vitest';
import {
  getOxygenChatStep,
  OXYGEN_CHAT_PROCESS_OVERVIEW,
  oxygenChatJourney,
} from './chat-journey';

describe('oxygen chat journey', () => {
  it('maps workflow stages to their canonical chat steps and excludes recovery from overview', () => {
    expect(getOxygenChatStep('application_required').mode).toBe('secure_card');
    expect(getOxygenChatStep('plan_required')).toBe(oxygenChatJourney.plan);
    expect(getOxygenChatStep('activated')).toBe(oxygenChatJourney.complete);
    expect(getOxygenChatStep('reconciliation_required')).toBe(
      oxygenChatJourney.recovery
    );
    expect(OXYGEN_CHAT_PROCESS_OVERVIEW).toContain(
      oxygenChatJourney.identity.label
    );
    expect(OXYGEN_CHAT_PROCESS_OVERVIEW).not.toContain(
      oxygenChatJourney.recovery.label
    );
  });
});
