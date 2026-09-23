import { RepairBookingLcpIntro } from './repair-booking-lcp-intro';

interface RepairBookingFallbackProps {
  hideIntro?: boolean;
}

export function RepairBookingFallback({
  hideIntro = false,
}: RepairBookingFallbackProps) {
  return (
    <div role="status" aria-label="Loading repair booking" aria-live="polite">
      {hideIntro ? null : <RepairBookingLcpIntro />}
    </div>
  );
}
