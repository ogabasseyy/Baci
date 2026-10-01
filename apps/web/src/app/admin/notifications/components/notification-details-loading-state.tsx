import { Loader2 } from 'lucide-react';

export function NotificationDetailsLoadingState() {
  return (
    <div
      className="flex items-center justify-center min-h-[400px]"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
      <span className="sr-only">Loading notification details</span>
    </div>
  );
}
