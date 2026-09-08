import { RepairBookingLcpIntro } from './repair-booking-lcp-intro';

export function RepairBookingFallback() {
  return (
    <div
      role="status"
      aria-label="Loading repair booking"
      aria-live="polite"
      className="container mx-auto py-12 px-4"
    >
      <div className="max-w-3xl mx-auto">
        <RepairBookingLcpIntro />
      </div>
    </div>
  );
}
