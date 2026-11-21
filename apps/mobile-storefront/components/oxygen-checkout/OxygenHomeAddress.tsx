import { useState } from 'react';
import { Text, View } from 'react-native';
import { AddressAutocomplete } from '@/components/ui/AddressAutocomplete';
import {
  OxygenButton,
  OxygenField,
  useOxygenColors,
} from './OxygenFormPrimitives';
import { OxygenSelectedAddress } from './OxygenSelectedAddress';
import { type OxygenFields, reusableHomeAddress } from './oxygen-form-utils';
import {
  missingOxygenHomeFields,
  oxygenHomeLabels,
  oxygenHomeSummary,
} from './oxygen-home-address';
export interface OxygenHomeAddressProps {
  fields: OxygenFields;
  onChange: (patch: OxygenFields) => void;
  checkoutAddress?: {
    kind: 'pickup' | 'delivery';
    fields: OxygenFields;
  } | null;
  busy?: boolean;
  hideTitle?: boolean;
  errors?: Partial<Record<keyof OxygenFields, string>>;
}
export function OxygenHomeAddress({
  fields,
  onChange,
  checkoutAddress,
  busy,
  errors,
  hideTitle,
}: OxygenHomeAddressProps) {
  const colors = useOxygenColors();
  const suggested = reusableHomeAddress(checkoutAddress);
  const [mode, setMode] = useState<'summary' | 'search' | 'manual'>(
    fields.home_street?.trim() && fields.home_state?.trim()
      ? 'summary'
      : 'search'
  );
  const [search, setSearch] = useState(oxygenHomeSummary(fields));
  // Capture once per address selection. Typing a missing detail must not hide it.
  const [missing, setMissing] = useState(() => missingOxygenHomeFields(fields));
  function selectAddress(next: OxygenFields) {
    const home: OxygenFields = {};
    for (const [key] of oxygenHomeLabels) home[key] = next[key] ?? '';
    setMissing(missingOxygenHomeFields(home));
    setSearch(oxygenHomeSummary(home));
    onChange(home);
    setMode('summary');
  }
  return (
    <View style={{ gap: 12 }}>
      {!hideTitle ? (
        <Text style={{ color: colors.text }}>Your home address</Text>
      ) : null}
      {mode === 'summary' ? (
        <OxygenSelectedAddress
          address={oxygenHomeSummary(fields)}
          fromCheckout={Boolean(
            suggested && suggested.home_street === fields.home_street
          )}
          disabled={busy}
          onEdit={() => {
            setSearch(oxygenHomeSummary(fields));
            setMode('search');
          }}
        />
      ) : null}
      {mode === 'search' ? (
        <>
          {suggested ? (
            <OxygenButton
              title="Use delivery address as my home address"
              secondary
              disabled={busy}
              onPress={() => selectAddress(suggested)}
            />
          ) : null}
          {!busy ? (
            <AddressAutocomplete
              label="Find your home address"
              value={search}
              onChangeText={setSearch}
              onSelect={(place) =>
                selectAddress({
                  home_street: place.route || place.formattedAddress,
                  home_house_number: place.streetNumber,
                  home_city: place.city,
                  home_lga: place.lga,
                  home_state: place.state,
                })
              }
            />
          ) : null}
          <OxygenButton
            title="Enter address manually"
            secondary
            disabled={busy}
            onPress={() => setMode('manual')}
          />
        </>
      ) : null}
      {mode === 'manual' ? (
        <OxygenButton
          title="Use address search"
          secondary
          disabled={busy}
          onPress={() => setMode('search')}
        />
      ) : null}
      {mode !== 'search'
        ? oxygenHomeLabels
            .filter(([key]) => mode === 'manual' || missing.includes(key))
            .map(([key, label]) => (
              <OxygenField
                key={key}
                label={label}
                value={fields[key]}
                onChange={(value) => onChange({ [key]: value })}
                editable={!busy}
                error={errors?.[key]}
              />
            ))
        : null}
      {mode === 'manual' ? (
        <OxygenButton
          title="Use this address"
          disabled={
            busy || !fields.home_street?.trim() || !fields.home_state?.trim()
          }
          onPress={() => {
            setMissing(missingOxygenHomeFields(fields));
            setMode('summary');
          }}
        />
      ) : null}
      {mode === 'summary' &&
      Object.entries(errors ?? {}).some(
        ([key, error]) => key.startsWith('home_') && !!error
      ) ? (
        <OxygenButton
          title="Review address details"
          secondary
          disabled={busy}
          onPress={() => setMode('manual')}
        />
      ) : null}
    </View>
  );
}
