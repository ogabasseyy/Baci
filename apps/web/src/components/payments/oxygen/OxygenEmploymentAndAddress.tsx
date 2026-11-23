'use client';
import { useState } from 'react';
import type { OxygenFormDraft } from '@/schemas/oxygen-form-draft';
import { OxygenChatQuestion, oxygenIncomeTurns } from './OxygenChatQuestion';
import { OxygenEmploymentFields } from './OxygenEmploymentFields';
import { OxygenResidentialFields } from './OxygenResidentialFields';
import { isOxygenEmploymentReady } from './oxygen-employment-ready';
import {
  residentialAddress,
  residentialKeys,
} from './oxygen-residential-address';
export function OxygenEmploymentAndAddress({
  defaults,
  conversationTurn,
  collectAddress,
  checkoutAddress,
  file,
  onFile,
  onAddressChange,
}: {
  defaults: OxygenFormDraft['fields'];
  conversationTurn?: number;
  collectAddress: boolean;
  checkoutAddress: Record<string, string>;
  file: File | null;
  onFile: (file: File | null) => void;
  onAddressChange: () => void;
}) {
  const [revealed, setRevealed] = useState(
    isOxygenEmploymentReady(
      defaults.salary_amount ?? '',
      defaults.salary_date ?? ''
    )
  );
  return (
    <>
      <OxygenEmploymentFields
        defaults={defaults}
        conversationTurn={conversationTurn}
        onReady={() => setRevealed(true)}
      />
      <div
        hidden={conversationTurn === undefined && !revealed}
        className="space-y-4"
      >
        {collectAddress && (
          <OxygenChatQuestion
            current={conversationTurn}
            turn={oxygenIncomeTurns.address}
            prompt="Can you confirm your home address and attach a matching proof of address securely?"
          >
            <OxygenResidentialFields
              initial={residentialAddress(
                Object.fromEntries(
                  residentialKeys.map((key) => [
                    key,
                    defaults[`home_${key}`] ?? checkoutAddress[key] ?? '',
                  ])
                )
              )}
              checkout={Boolean(checkoutAddress.street)}
              file={file}
              onFile={onFile}
              onChange={onAddressChange}
            />
          </OxygenChatQuestion>
        )}
        <OxygenChatQuestion
          current={conversationTurn}
          turn={oxygenIncomeTurns.consent}
          prompt="May I share these details with our finance partner to check your application?"
        >
          <label className="flex items-start gap-3 rounded-xl border border-store-border bg-store-background p-4 text-sm text-store-background-text">
            <input
              name="consent"
              type="checkbox"
              required
              className="mt-1 size-4 shrink-0 accent-store-primary"
            />
            <span>
              I agree to share these details with Oxygen for this finance
              application and accept{' '}
              <a
                href="https://www.oxygenx.africa/terms-of-service"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-store-primary underline decoration-store-primary/50 underline-offset-2 hover:decoration-store-primary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-store-primary"
              >
                Oxygen’s terms
              </a>
              .
            </span>
          </label>
        </OxygenChatQuestion>
      </div>
    </>
  );
}
