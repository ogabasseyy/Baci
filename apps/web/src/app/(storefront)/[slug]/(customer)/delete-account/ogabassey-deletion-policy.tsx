import type { Route } from 'next';
import Link from 'next/link';

export function OgabasseyDeletionPolicy({
  privacyHref,
}: {
  privacyHref: Route;
}) {
  return (
    <div className="rounded-lg bg-card p-6 space-y-4 text-card-foreground">
      <p>
        After a verified request, we remove account profile details, saved
        addresses, wishlist items, and cart contents when they are no longer
        needed. The NDP Act GAID 2025 generally limits storage to six calendar
        months after a purpose ends where no other legal period applies. You can
        request deletion of other personal data through our privacy contact.
      </p>
      <p>
        Tax-relevant accounting and transaction records must be kept for at
        least six years after the relevant year of assessment under section
        31(5) of the Nigeria Tax Administration Act, 2025. We restrict access to
        records retained for legal purposes. See our{' '}
        <Link href={privacyHref} className="text-primary underline">
          Privacy Policy
        </Link>{' '}
        for details and contact us if you need a copy of your data.
      </p>
    </div>
  );
}
