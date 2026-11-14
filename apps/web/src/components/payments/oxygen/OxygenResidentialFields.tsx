'use client';
// Interactive address search and editable form values; no map SDK is loaded.
import { FileCheck2, House, Upload } from 'lucide-react';
import { useId, useState } from 'react';
import {
  AddressAutocomplete,
  type PlaceDetails,
} from '@/components/address-autocomplete';
import { oxygenFieldClass as field } from './oxygen-checkout-styles';
import {
  type ResidentialAddress,
  residentialAddress,
  residentialFileError,
  residentialKeys,
} from './oxygen-residential-address';

const labels = {
  state: 'State',
  lga: 'Local government area (LGA)',
  city: 'City / town',
  street: 'Street address',
  landmark: 'Nearby landmark',
  house_number: 'House / flat number',
};
export function OxygenResidentialFields({
  initial = {},
  checkout = false,
  onChange,
  onFile,
  file,
  disabled = false,
}: {
  initial?: Record<string, string>;
  checkout?: boolean;
  disabled?: boolean;
  onChange?: (address: ResidentialAddress) => void;
  onFile: (file: File | null) => void;
  file: File | null;
}) {
  const id = useId();
  const [address, setAddress] = useState(() => residentialAddress(initial));
  const [editing, setEditing] = useState<'search' | 'manual' | false>(
    initial.street ? false : 'search'
  );
  const manual = editing === 'manual';
  // Fix visibility for this address selection; typing must not hide a field.
  const [missingFields, setMissingFields] = useState(() =>
    residentialKeys.filter((key) => key === 'landmark' || !initial[key])
  );
  const [search, setSearch] = useState('');
  const [searchFailed, setSearchFailed] = useState(false);
  const [error, setError] = useState('');
  function update(next: ResidentialAddress) {
    setAddress(next);
    onChange?.(next);
  }
  function select(place: PlaceDetails) {
    // Use the supplied Nigerian administrative area; ask only when it is missing.
    const next = {
      ...residentialAddress(),
      street: place.route || place.formattedAddress,
      city: place.city,
      lga: place.lga ?? '',
      state: place.state,
      house_number: place.streetNumber,
    };
    update(next);
    setMissingFields(
      residentialKeys.filter((key) => key === 'landmark' || !next[key])
    );
    setSearch(place.formattedAddress);
    setEditing('search');
  }
  return (
    <section
      aria-labelledby={`${id}-title`}
      onInvalidCapture={(event) => {
        if (
          !manual &&
          event.target instanceof HTMLInputElement &&
          event.target.name.startsWith('home_') &&
          !event.target.value
        ) {
          event.preventDefault();
          setEditing('manual');
          const input = event.target;
          requestAnimationFrame(() => input.focus());
        }
      }}
      className="rounded-2xl border border-store-primary/15 bg-store-primary/2 p-4 sm:p-5"
    >
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-store-primary/10 text-store-primary">
          <House className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h3 id={`${id}-title`} className="font-bold text-gray-900">
            Your home address
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-gray-500">
            Oxygen needs your home address and a matching utility bill to verify
            where you live.
          </p>
        </div>
      </div>
      {!editing && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl bg-white p-3">
          <div>
            <p className="text-xs font-medium text-gray-500">
              {checkout ? 'From your checkout' : 'Your address'}
            </p>
            <p className="mt-1 text-sm text-gray-900">
              {[
                address.house_number,
                address.street,
                address.city,
                address.state,
              ]
                .filter(Boolean)
                .join(', ')}
            </p>
          </div>
          <button
            type="button"
            disabled={disabled}
            className="min-h-11 shrink-0 px-2 text-sm font-semibold text-store-primary"
            onClick={() => {
              setEditing('search');
              setSearch(
                [
                  address.house_number,
                  address.street,
                  address.city,
                  address.state,
                ]
                  .filter(Boolean)
                  .join(', ')
              );
            }}
          >
            Change address
          </button>
        </div>
      )}
      {/* Editable details stay available even when search has no results or fails. */}
      {editing && (
        <div className="mb-4 space-y-3">
          <label
            htmlFor={`${id}-search`}
            className="text-xs font-semibold text-gray-700"
          >
            Find your home address
          </label>
          <AddressAutocomplete
            id={`${id}-search`}
            country="ng"
            value={search}
            disabled={disabled}
            placeholder="Search street or area"
            onChange={(value) => {
              setSearch(typeof value === 'string' ? value : value.target.value);
              update(residentialAddress());
            }}
            onSelect={select}
            onError={setSearchFailed}
            className={field}
          />
          <p
            role={searchFailed ? 'status' : undefined}
            className="text-xs text-gray-500"
          >
            {searchFailed
              ? 'Address search is unavailable. You can enter your address manually.'
              : ''}
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setEditing(manual ? 'search' : 'manual')}
            className="min-h-11 text-xs font-semibold text-store-primary"
          >
            {manual ? 'Use address search' : 'Enter address manually'}
          </button>
        </div>
      )}
      <div className="grid gap-3 min-[400px]:grid-cols-2">
        {(
          [
            'street',
            'city',
            'state',
            'house_number',
            'lga',
            'landmark',
          ] as const
        ).map((key) => (
          <label
            key={key}
            hidden={
              !manual && (!address.street || !missingFields.includes(key))
            }
            className={`grid gap-1.5 text-xs font-semibold text-gray-700 ${!manual && (!address.street || !missingFields.includes(key)) ? 'hidden' : manual && (key === 'street' || key === 'landmark') ? 'min-[400px]:col-span-2' : ''}`}
          >
            {labels[key]}
            <input
              className={field}
              name={`home_${key}`}
              required
              maxLength={200}
              value={address[key]}
              disabled={disabled}
              autoComplete="off"
              onChange={(event) =>
                update({ ...address, [key]: event.target.value })
              }
            />
          </label>
        ))}
      </div>
      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-dashed border-store-primary/30 bg-white p-4">
        {file ? (
          <FileCheck2
            className="mt-0.5 size-5 shrink-0 text-store-primary"
            aria-hidden="true"
          />
        ) : (
          <Upload
            className="mt-0.5 size-5 shrink-0 text-store-primary"
            aria-hidden="true"
          />
        )}
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="text-sm font-semibold text-gray-900">
            Utility bill / proof of address
          </span>
          <span className="text-xs font-normal text-gray-500">
            PDF, JPG or PNG · up to 1.5 MB · must match this address
          </span>
          {file && (
            <span className="truncate text-xs font-medium text-store-primary">
              {file.name}
            </span>
          )}
          <input
            aria-label="Proof of address"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            disabled={disabled}
            className="mt-2 block w-full text-xs font-normal file:mr-3 file:rounded-lg file:border-0 file:bg-store-primary/10 file:px-3 file:py-2 file:font-semibold file:text-store-primary"
            onChange={(event) => {
              const next = event.target.files?.[0] ?? null;
              const problem = next ? residentialFileError(next) : '';
              setError(problem);
              onFile(problem ? null : next);
              if (problem) event.target.value = '';
            }}
          />
        </span>
      </label>
      {error && (
        <p role="alert" className="mt-2 text-sm text-store-primary">
          {error}
        </p>
      )}
      <label className="mt-4 flex items-start gap-2 text-sm text-gray-600">
        <input
          type="checkbox"
          name="home_confirmed"
          required
          disabled={disabled}
          className="mt-1 size-4 shrink-0 accent-store-primary"
        />
        This is my home address and matches my proof of address.
      </label>
    </section>
  );
}
