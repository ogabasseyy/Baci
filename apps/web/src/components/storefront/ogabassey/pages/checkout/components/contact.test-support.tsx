import { useState } from 'react';
import type {
  CheckoutAccountValues,
  ContactValues,
} from '../contact-validation';
import { CheckoutStepSection } from './CheckoutStepSection';
import { ContactStep } from './ContactStep';

export const validContact: ContactValues = {
  firstName: 'Ada',
  lastName: 'Okon',
  customerEmail: 'ada@example.test',
  customerPhone: '+2348031234567',
};
export const emptyContact: ContactValues = {
  firstName: '',
  lastName: '',
  customerEmail: '',
  customerPhone: '',
};
export function ContactHarness({
  initial = emptyContact,
  signedIn = false,
  initialAccount = { createAccount: false, password: '' },
}: {
  initial?: ContactValues;
  signedIn?: boolean;
  initialAccount?: CheckoutAccountValues;
}) {
  const [values, setValues] = useState(initial);
  const [account, setAccount] = useState(initialAccount);
  const [active, setActive] = useState(true);
  const [completed, setCompleted] = useState(false);
  return (
    <>
      <ContactStep
        focusOnActivate
        active={active}
        completed={completed}
        values={values}
        account={account}
        signedIn={signedIn}
        onChange={(key, value) =>
          setValues((previous) => ({ ...previous, [key]: value }))
        }
        onAccountChange={setAccount}
        onOpen={() => setActive(true)}
        onComplete={() => {
          setCompleted(true);
          setActive(false);
        }}
      />
      <CheckoutStepSection
        focusOnActivate
        id="delivery"
        title="Delivery Method"
        number={2}
        active={!active}
        completed={false}
        disabled={!completed}
        onOpen={() => setActive(false)}
      >
        <p>Delivery fields</p>
      </CheckoutStepSection>
    </>
  );
}
