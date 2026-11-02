import { notFound } from 'next/navigation';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import {
  hasPublishableReturnsPolicy,
  hasPublishableWarrantyPolicy,
} from '@/lib/storefront-trust/build-merchant-trust-profile';
import { getTrustRouteContext } from '../trust-route-context';

export async function DeviceAssuranceContent({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const context = await getTrustRouteContext(slug, { requestScopedUrl: true });
  if (!context || context.merchant.id !== OGABASSEY_MERCHANT_ID) notFound();
  const { baseUrl, merchant, trustProfile } = context;
  const hasContactInfo = [
    merchant.pages?.contact,
    merchant.email,
    merchant.phone,
    trustProfile.supportEmail,
    trustProfile.supportPhone,
  ].some((value) => typeof value === 'string' && value.trim().length > 0);
  const returnsSummary = hasPublishableReturnsPolicy(trustProfile)
    ? trustProfile.returnPolicy?.summary
    : undefined;
  const warrantySummary = hasPublishableWarrantyPolicy(trustProfile)
    ? trustProfile.warrantyPolicy?.summary
    : undefined;
  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 py-12 text-store-background-text">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold">Device inspection guide</h1>
        <p>
          Use this checklist to inspect a phone or laptop and review the
          available policies before you buy.
        </p>
      </header>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Phones</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>Inspect the screen, body, cameras, charging port and buttons.</li>
          <li>
            Check the battery, network connection and fingerprint or face unlock
            where available.
          </li>
          <li>
            Compare the device identity shown in settings with its packaging and
            ask for proof of ownership.
          </li>
        </ul>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Laptops</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            Inspect the screen, keyboard, trackpad, hinges, ports and charger.
          </li>
          <li>Check the battery, camera, speakers and wireless connection.</li>
          <li>
            Compare the model and serial number with the documentation and ask
            for proof of ownership.
          </li>
        </ul>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Policies and support</h2>
        {returnsSummary ? <p>{returnsSummary}</p> : null}
        {warrantySummary ? <p>{warrantySummary}</p> : null}
        <p>Read the current policies for details.</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <a className="underline" href={`${baseUrl}/returns`}>
              Returns policy
            </a>
          </li>
          {warrantySummary ? (
            <li>
              <a className="underline" href={`${baseUrl}/warranty`}>
                Warranty policy
              </a>
            </li>
          ) : (
            <li>Warranty policy is not available.</li>
          )}
          {hasContactInfo ? (
            <li>
              <a className="underline" href={`${baseUrl}/contact`}>
                Contact the store
              </a>
            </li>
          ) : (
            <li>Contact details are not available.</li>
          )}
        </ul>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">IMEI check</h2>
        <p>
          An IMEI check is one part of an inspection. It does not establish
          ownership or guarantee a device's condition.
        </p>
        <a className="underline" href={`${baseUrl}/imei-check`}>
          Open the IMEI check
        </a>
      </section>
    </div>
  );
}
