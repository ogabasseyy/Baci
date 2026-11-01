import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { oxygenButtonClass } from './oxygen-checkout-styles';

export function OxygenLoadingButton({
  loading = false,
  pendingLabel = 'Continuing…',
  disabled,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  pendingLabel?: string;
}) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading}
      className={cn(oxygenButtonClass, className)}
    >
      {loading && (
        <Loader2
          aria-hidden="true"
          className="size-4 shrink-0 motion-safe:animate-spin"
        />
      )}
      {loading ? pendingLabel : children}
    </button>
  );
}
