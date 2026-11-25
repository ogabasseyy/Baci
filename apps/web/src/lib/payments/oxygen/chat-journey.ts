import type { OxygenWorkflowStage } from '@/schemas/oxygen-workflow';

type ChatStep = {
  mode: 'secure_card' | 'provider_action' | 'wait' | 'complete';
  label: string;
  prompt: string;
};

/** Fixed copy and UI intent only. Customer inputs and provider payloads stay out of this map. */
export const oxygenChatJourney = {
  identity: {
    mode: 'secure_card',
    label: 'identity details',
    prompt:
      'Could you enter your BVN, NIN and date of birth in the secure card below?',
  },
  bank: {
    mode: 'secure_card',
    label: 'bank account verification',
    prompt:
      'Which bank account would you like to verify? Enter the details in the secure form.',
  },
  income: {
    mode: 'secure_card',
    label: 'employment, income and consent',
    prompt:
      'Next, I’ll need a little about your employment and income. You can enter that securely.',
  },
  phoneCode: {
    mode: 'secure_card',
    label: 'phone verification code',
    prompt:
      'The next step is to verify your phone. Enter the code in the secure form when it arrives.',
  },
  selfie: {
    mode: 'provider_action',
    label: 'selfie verification if requested',
    prompt:
      'The next check is a selfie. Open the secure camera when you’re ready.',
  },
  statement: {
    mode: 'provider_action',
    label: 'bank statement linking if requested',
    prompt:
      'Your bank statement may need to be linked. Use the secure instructions provided for this check.',
  },
  eligibility: {
    mode: 'wait',
    label: 'eligibility and verification checks',
    prompt:
      'Your application is at the verification stage. Check for an update to see what’s needed next.',
  },
  plan: {
    mode: 'secure_card',
    label: 'review the available down payment and monthly plans',
    prompt:
      'Let’s review the available options. You’ll see the upfront amount and monthly payments before you choose.',
  },
  proofOfAddress: {
    mode: 'secure_card',
    label: 'address and proof of address if requested',
    prompt:
      'If proof of address is requested, add it through the secure form and confirm it matches your address.',
  },
  addressReview: {
    mode: 'wait',
    label: 'address review when pending',
    prompt:
      'Your proof of address is under review. You can check for an update here.',
  },
  signature: {
    mode: 'secure_card',
    label: 'review and sign the chosen plan',
    prompt:
      'Review the payment breakdown and sign securely when you’re ready to accept it.',
  },
  approvalCode: {
    mode: 'secure_card',
    label: 'enter the approval code after it is requested',
    prompt: 'Enter the approval code in the secure form when it arrives.',
  },
  upfrontPayment: {
    mode: 'provider_action',
    label: 'make the upfront payment through the secure payment action',
    prompt:
      'Check your confirmed upfront amount and use the secure payment option when you’re ready.',
  },
  repaymentSetup: {
    mode: 'provider_action',
    label: 'set up repayments',
    prompt:
      'The next step is to set up your monthly repayments. Use the secure setup option to continue.',
  },
  confirmation: {
    mode: 'wait',
    label: 'confirm completion from the application status',
    prompt:
      'Check your application status for confirmation before taking another action.',
  },
  complete: {
    mode: 'complete',
    label: 'application complete',
    prompt:
      'Your application is complete. You can find your order details in your account.',
  },
  recovery: {
    mode: 'wait',
    label: 'reconcile an unconfirmed action before retrying',
    prompt:
      'Let’s check the last result before you try again. If you already paid, please hold off on paying again.',
  },
} as const satisfies Record<string, ChatStep>;

export type OxygenChatStep = keyof typeof oxygenChatJourney;

const applicationDetails: ChatStep = {
  mode: 'secure_card',
  label: 'application details',
  prompt:
    'Let’s continue your application. Use the secure form for the details it asks for.',
};

/** The continuation API knows only the coarse stage. It must not guess substeps. */
const stepByWorkflowStage = {
  application_required: null,
  eligibility_required: 'eligibility',
  kyc_required: 'eligibility',
  plan_required: 'plan',
  booked: 'confirmation',
  approval_required: 'confirmation',
  payment_required: 'confirmation',
  ready_for_activation: 'confirmation',
  activated: 'complete',
  reconciliation_required: 'recovery',
} as const satisfies Record<OxygenWorkflowStage, OxygenChatStep | null>;

export function getOxygenChatStep(stage: OxygenWorkflowStage): ChatStep {
  const step = stepByWorkflowStage[stage];
  return step ? oxygenChatJourney[step] : applicationDetails;
}

export const OXYGEN_CHAT_PROCESS_OVERVIEW = Object.values(oxygenChatJourney)
  .filter((step) => step !== oxygenChatJourney.recovery)
  .map((step) => step.label)
  .join(' → ');
