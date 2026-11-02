'use client';
import { useEffect, useState } from 'react';
import { OxygenOtpField } from './OxygenOtpField';
import { oxygenButtonClass } from './oxygen-checkout-styles';

type Phase = 'entry' | 'checking' | 'verified';
/** Local demonstration only; no provider callbacks or real OTP state. */
export function OxygenOtpAnimationPreview() {
  const [code, setCode] = useState('');
  const [sentAt, setSentAt] = useState(() => Date.now());
  const [phase, setPhase] = useState<Phase>('entry');
  useEffect(() => {
    if (phase !== 'checking') return;
    // Simulate a server response. Only then may the confirmed animation start.
    const timer = window.setTimeout(() => setPhase('verified'), 1300);
    return () => window.clearTimeout(timer);
  }, [phase]);
  return (
    <div className="grid gap-3" data-animation-preview="true">
      <OxygenOtpField
        value={code}
        sentAt={sentAt}
        onChange={setCode}
        onComplete={(value) => {
          setCode(value);
          setPhase('checking');
        }}
        disabled={phase !== 'entry'}
        pending={phase === 'checking'}
        verified={phase === 'verified'}
        hint="Local demo. Type any 6 digits; nothing will be sent."
      />
      <p role="status" className="min-h-10 text-center text-sm text-gray-500">
        {phase === 'entry'
          ? 'Type any 6 digits to simulate verification automatically.'
          : phase === 'checking'
            ? 'Simulating verification…'
            : 'Simulation complete. No code checked or approval submitted.'}
      </p>
      <button
        type="button"
        disabled={
          phase === 'checking' || (phase === 'entry' && !/^\d{6}$/.test(code))
        }
        className={oxygenButtonClass}
        onClick={() => {
          if (phase === 'verified') {
            setCode('');
            setSentAt(Date.now());
            setPhase('entry');
          } else if (/^\d{6}$/.test(code)) setPhase('checking');
        }}
      >
        {phase === 'verified'
          ? 'Try another test code'
          : phase === 'checking'
            ? 'Simulating…'
            : 'Simulate verification'}
      </button>
    </div>
  );
}
