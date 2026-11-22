import type { OxygenRuntimeSnapshot } from '@baci/shared/oxygen';
import { useState } from 'react';
import { OxygenOtp } from '../oxygen-checkout/OxygenOtp';
import { OxygenSignatureStep } from '../oxygen-checkout/OxygenSignatureStep';
import { confirmedOxygenTerms } from '../oxygen-checkout/oxygen-confirmed-terms';

export function LateApprovalPreview({
  step,
  snapshot,
  onSigned,
  onApproved,
}: {
  step: 'signature' | 'code';
  snapshot: OxygenRuntimeSnapshot;
  onSigned: () => void;
  onApproved: () => void;
}) {
  const [accepted, setAccepted] = useState(false);
  const [captured, setCaptured] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [sentAt, setSentAt] = useState(() => new Date().toISOString());
  return step === 'signature' ? (
    <OxygenSignatureStep
      termsKey="mock-signature"
      nextPaymentDate={confirmedOxygenTerms(snapshot)?.schedule[0]?.date}
      accepted={accepted}
      capturedTermsKey={captured}
      disabled={false}
      onSignature={(file, key) => setCaptured(file ? key : null)}
      onAccept={setAccepted}
      onContinue={onSigned}
    />
  ) : (
    <OxygenOtp
      scopeKey="mock-approval"
      value={code}
      onChange={setCode}
      pending={false}
      confirmed={false}
      sentAt={sentAt}
      label="Approve your payment breakdown"
      onComplete={(value) => {
        if (value === '123456') onApproved();
      }}
      onResend={async () => setSentAt(new Date().toISOString())}
    />
  );
}
