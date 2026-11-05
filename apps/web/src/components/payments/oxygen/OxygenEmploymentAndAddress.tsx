import type { OxygenFormDraft } from '@/schemas/oxygen-form-draft';
import { OxygenEmploymentFields } from './OxygenEmploymentFields';
import { OxygenResidentialFields } from './OxygenResidentialFields';
import {
  residentialAddress,
  residentialKeys,
} from './oxygen-residential-address';
export function OxygenEmploymentAndAddress({
  defaults,
  collectAddress,
  checkoutAddress,
  file,
  onFile,
  onAddressChange,
}: {
  defaults: OxygenFormDraft['fields'];
  collectAddress: boolean;
  checkoutAddress: Record<string, string>;
  file: File | null;
  onFile: (file: File | null) => void;
  onAddressChange: () => void;
}) {
  return (
    <>
      <OxygenEmploymentFields defaults={defaults} />
      {collectAddress && (
        <OxygenResidentialFields
          initial={residentialAddress(
            Object.fromEntries(
              residentialKeys.map((key) => [
                key,
                defaults[`home_${key}`] ?? checkoutAddress[key] ?? '',
              ])
            )
          )}
          checkout={Boolean(checkoutAddress.street)}
          file={file}
          onFile={onFile}
          onChange={onAddressChange}
        />
      )}
      <label className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-600">
        <input
          name="consent"
          type="checkbox"
          required
          className="mt-1 size-4 shrink-0 accent-store-primary"
        />
        <span>
          I agree to share these details with Oxygen for this finance
          application and accept{' '}
          <a
            href="https://www.oxygenx.africa/terms-of-service"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-store-primary underline decoration-store-primary/50 underline-offset-2 hover:decoration-store-primary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-store-primary"
          >
            Oxygen’s terms
          </a>
          .
        </span>
      </label>
    </>
  );
}
