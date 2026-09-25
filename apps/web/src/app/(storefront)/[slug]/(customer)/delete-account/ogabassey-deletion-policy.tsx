import type { Route } from 'next';
import Link from 'next/link';

export function OgabasseyDeletionPolicy({
  privacyHref,
}: {
  privacyHref: Route;
}) {
  return (
    <div className="bg-gray-50 rounded-lg p-6 space-y-4 text-gray-600">
      <p>
        After a verified request, we remove account profile details, saved
        addresses, wishlist items, and cart contents when they are no longer
        needed. Personal data without a longer legal basis is deleted or
        de-identified no later than six calendar months after its purpose ends.
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
