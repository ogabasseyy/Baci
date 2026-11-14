import { RootStartupError } from './RootStartupError';

type RootLayoutErrorBoundaryProps = { error: Error; retry: () => void };

export function RootLayoutErrorBoundary({
  error,
  retry,
}: RootLayoutErrorBoundaryProps) {
  return <RootStartupError error={error} retry={retry} />;
}
