import { showAppAlert } from '@/components/ui/show-app-alert';
import { createLogger } from '@/lib/logger';

const log = createLogger('StartSavingsModals');

export function handleSavingsModalActionError({
  error,
  message,
  operation,
  title,
}: {
  error: unknown;
  message: string;
  operation: string;
  title: string;
}) {
  log.error('Savings modal action failed', { error, operation });
  showAppAlert({ title, message, variant: 'error' });
}
