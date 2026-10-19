import { showAppAlert } from '@/components/ui/show-app-alert';

export function handleSavingsActionError(
  error: unknown,
  title: string,
  message: string
) {
  console.error(title, error);
  showAppAlert({ title, message, variant: 'error' });
}
