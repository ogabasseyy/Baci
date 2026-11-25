import { describe, expect, it } from 'vitest';
import { oxygenChatJourney } from '@/lib/payments/oxygen/chat-journey';
import { oxygenConversationPrompt } from './oxygen-conversation-prompt';

describe('oxygenConversationPrompt', () => {
  it('maps dedicated conversational stages to their expected prompts', () => {
    expect(oxygenConversationPrompt('loading')).toContain('application ready');
    expect(oxygenConversationPrompt('phone')).toBe(
      oxygenChatJourney.phoneCode.prompt
    );
    expect(oxygenConversationPrompt('address')).toBe(
      oxygenChatJourney.proofOfAddress.prompt
    );
    expect(oxygenConversationPrompt('address_review')).toBe(
      oxygenChatJourney.addressReview.prompt
    );
    expect(oxygenConversationPrompt('upfront_payment')).toBe(
      oxygenChatJourney.upfrontPayment.prompt
    );
    expect(oxygenConversationPrompt('repayment_setup')).toBe(
      oxygenChatJourney.repaymentSetup.prompt
    );
    expect(oxygenConversationPrompt('identity')).toBe(
      oxygenChatJourney.identity.prompt
    );
    expect(oxygenConversationPrompt('activated')).toBe(
      oxygenChatJourney.complete.prompt
    );
  });
});
