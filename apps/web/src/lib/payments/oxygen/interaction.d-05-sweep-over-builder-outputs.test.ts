import { describe, expect, it } from 'vitest';
import {
  getOxygenInteractionCopy,
  OXYGEN_INTERACTION_ACTION_LABELS,
  OXYGEN_INTERACTION_FALLBACK_COPY,
  OXYGEN_INTERACTION_REASON_COPY,
  toChatMessageText,
} from './interaction';
import {
  ALL_STATES,
  FORBIDDEN_PHRASES,
  SIX_REASONS,
} from './interaction.test-helpers';

describe('D-05 sweep over builder outputs', () => {
  it('keeps every copy output free of credit-decision language', () => {
    const outputs: string[] = [OXYGEN_INTERACTION_FALLBACK_COPY];
    const chatOutputs: string[] = [];
    for (const state of ALL_STATES) {
      outputs.push(getOxygenInteractionCopy(state));
      const chatText = toChatMessageText({ status: state });
      outputs.push(chatText);
      chatOutputs.push(chatText);
      for (const reason of SIX_REASONS) {
        outputs.push(getOxygenInteractionCopy(state, reason));
        const reasonChatText = toChatMessageText({ status: state, reason });
        outputs.push(reasonChatText);
        chatOutputs.push(reasonChatText);
      }
    }
    // The sweep must vary by state: identical chat outputs would prove the
    // loop variable never reaches the builder (e.g. an ambient global read).
    expect(new Set(chatOutputs).size).toBeGreaterThan(1);
    outputs.push(...Object.values(OXYGEN_INTERACTION_ACTION_LABELS));
    outputs.push(...Object.values(OXYGEN_INTERACTION_REASON_COPY));
    for (const output of outputs) {
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(output.toLowerCase()).not.toContain(phrase);
      }
    }
  });
});
