import type { OxygenCustomerPrefill } from '@/schemas/oxygen-customer-prefill';
import type { OxygenFormDraft } from '@/schemas/oxygen-form-draft';
import { OxygenBirthDateField } from './OxygenBirthDateField';
import { OxygenChatQuestion, oxygenIdentityTurns } from './OxygenChatQuestion';
import { OxygenContactFields } from './OxygenContactFields';
import { OxygenIdentityField } from './OxygenIdentityField';

export function OxygenIdentityFields({
  conversational,
  chatTurn,
  prefill,
  defaults,
  onCapture,
}: {
  conversational: boolean;
  chatTurn: number;
  prefill: OxygenCustomerPrefill;
  defaults: OxygenFormDraft['fields'];
  onCapture: () => void;
}) {
  return (
    <>
      <OxygenContactFields
        prefill={prefill}
        defaults={defaults}
        fromConversation={conversational}
      />
      <div
        className={conversational ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-2'}
      >
        <OxygenChatQuestion
          current={conversational ? chatTurn : undefined}
          turn={oxygenIdentityTurns.bvn}
          prompt="Please enter your 11-digit BVN privately below. It goes straight to Oxygen X and is never saved in chat."
        >
          <OxygenIdentityField
            name="bvn"
            label="BVN"
            defaultValue={defaults.bvn}
          />
        </OxygenChatQuestion>
        <OxygenChatQuestion
          current={conversational ? chatTurn : undefined}
          turn={oxygenIdentityTurns.nin}
          prompt="Thanks for providing your BVN! Next, please enter your 11-digit NIN privately below."
        >
          <OxygenIdentityField
            name="nin"
            label="NIN"
            defaultValue={defaults.nin}
          />
        </OxygenChatQuestion>
        <OxygenChatQuestion
          current={conversational ? chatTurn : undefined}
          turn={oxygenIdentityTurns.dob}
          prompt="Got your NIN — thank you! Lastly, what is your date of birth?"
        >
          <OxygenBirthDateField
            defaultValue={defaults.date_of_birth ?? prefill.date_of_birth}
            defaultEntry={defaults.birth_date_entry}
            onValueChange={onCapture}
          />
        </OxygenChatQuestion>
      </div>
    </>
  );
}
