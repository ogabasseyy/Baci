'use client';
import type { OxygenFormDraft } from '@/schemas/oxygen-form-draft';
import { OxygenChatQuestion, oxygenIncomeTurns } from './OxygenChatQuestion';
import { OxygenEmploymentFields } from './OxygenEmploymentFields';

export function OxygenEmploymentAndAddress({
  defaults,
  conversationTurn,
}: {
  defaults: OxygenFormDraft['fields'];
  conversationTurn?: number;
}) {
  return (
    <div className="space-y-4">
      <OxygenEmploymentFields
        defaults={defaults}
        conversationTurn={conversationTurn}
      />
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
  );
}
