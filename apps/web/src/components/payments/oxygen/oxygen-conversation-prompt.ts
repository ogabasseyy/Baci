import {
  getOxygenChatStep,
  oxygenChatJourney,
} from '@/lib/payments/oxygen/chat-journey';
import type { OxygenJourneyStage } from '@/lib/payments/oxygen/journey-events';

export function oxygenConversationPrompt(stage: OxygenJourneyStage): string {
  switch (stage) {
    case 'loading':
      return 'I’m getting your application ready. Give me a moment.';
    case 'phone':
      return oxygenChatJourney.phoneCode.prompt;
    case 'address':
      return oxygenChatJourney.proofOfAddress.prompt;
    case 'address_review':
      return oxygenChatJourney.addressReview.prompt;
    case 'offer':
      return 'Let’s review the next step for your plan. Use the secure card below when you’re ready.';
    case 'upfront_payment':
      return oxygenChatJourney.upfrontPayment.prompt;
    case 'repayment_setup':
      return oxygenChatJourney.repaymentSetup.prompt;
    case 'verification':
      return oxygenChatJourney.eligibility.prompt;
    case 'identity':
    case 'bank':
    case 'income':
    case 'selfie':
    case 'eligibility':
      return oxygenChatJourney[stage].prompt;
    default:
      return getOxygenChatStep(stage).prompt;
  }
}
