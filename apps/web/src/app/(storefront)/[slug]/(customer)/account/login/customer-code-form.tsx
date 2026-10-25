'use client';
import { Loader2 } from 'lucide-react';
import type { ClipboardEvent, KeyboardEvent, RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  code: string[];
  error: string;
  isVerifying: boolean;
  isSending: boolean;
  codeInputRefs: RefObject<(HTMLInputElement | null)[]>;
  handlePaste: (event: ClipboardEvent) => void;
  handleCodeChange: (index: number, value: string) => void;
  handleKeyDown: (
    index: number,
    event: KeyboardEvent<HTMLInputElement>
  ) => void;
  handleResendCode: () => Promise<void>;
  onDifferentEmail: () => void;
};
export function CustomerCodeForm({
  code,
  error,
  isVerifying,
  isSending,
  codeInputRefs,
  handlePaste,
  handleCodeChange,
  handleKeyDown,
  handleResendCode,
  onDifferentEmail,
}: Props) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>Verification code</Label>
        <div className="flex gap-2 justify-center" onPaste={handlePaste}>
          {(['d1', 'd2', 'd3', 'd4', 'd5', 'd6'] as const).map(
            (slot, index) => (
              <Input
                key={slot}
                ref={(el) => {
                  codeInputRefs.current[index] = el;
                }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={code[index]}
                onChange={(e) => handleCodeChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                className="w-12 h-14 text-center text-2xl font-mono"
                disabled={isVerifying}
                autoFocus={index === 0}
                aria-label={`Digit ${index + 1} of 6`}
              />
            )
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive text-center">{error}</p>}

      {isVerifying && (
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>Verifying…</span>
        </div>
      )}

      <div className="text-center space-y-2">
        <p className="text-sm text-muted-foreground">
          Didn't receive the code?
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleResendCode}
          disabled={isSending}
        >
          {isSending ? 'Sending...' : 'Resend code'}
        </Button>
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={onDifferentEmail}
      >
        Use a different email
      </Button>
    </div>
  );
}
