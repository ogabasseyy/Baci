interface ProductSchemaAdditionalProperty {
  '@type': 'PropertyValue';
  name?: string;
  propertyID?: string;
  value?: unknown;
  [key: string]: unknown;
}

const PROPERTY_NAME_ALIASES: Record<string, string> = {
  '3.5mm headphone jack': '3.5mm jack',
  '3.5mm jack': '3.5mm jack',
  loudspeaker: 'speakers',
  speakers: 'speakers',
  video: 'video recording',
  'video recording': 'video recording',
  'wi-fi': 'wifi',
  wifi: 'wifi',
  wlan: 'wifi',
};

const PROPERTY_ID_ALIASES: Record<string, string> = {
  android_version: 'Operating System',
  battery_mah: 'Battery Capacity',
  bluetooth_version: 'Bluetooth',
  build_materials: 'Build',
  card_slot_type: 'Card Slot',
  charging_watt: 'Fast Charging',
  chipset: 'Chipset',
  cpu_cores: 'CPU',
  dimensions_mm: 'Dimensions',
  display_peak_brightness: 'Peak Brightness',
  display_ppi: 'Pixel Density',
  display_resolution: 'Display Resolution',
  display_type: 'Display Type',
  fingerprint_type: 'Fingerprint Sensor',
  front_camera_mp: 'Selfie Camera',
  gpu: 'GPU',
  has_5g: '5G Support',
  has_fm_radio: 'FM Radio',
  has_headphone_jack: '3.5mm Headphone Jack',
  has_nfc: 'NFC',
  has_ois: 'OIS',
  has_stereo_speakers: 'Speakers',
  ip_rating: 'IP Rating',
  main_camera_mp: 'Main Camera',
  network_technology: 'Network Technology',
  ram_gb: 'RAM',
  rear_camera_video: 'Video Recording',
  refresh_rate_hz: 'Refresh Rate',
  screen_size_inches: 'Screen Size',
  sim_type: 'SIM Type',
  storage_gb: 'Internal Storage',
  usb_type: 'USB',
  weight_g: 'Weight',
  wifi_bands: 'WiFi',
  wireless_charging_watt: 'Wireless Charging',
};

function normalizePropertyText(value: unknown) {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  return null;
}

function normalizePropertyName(value: unknown) {
  const normalized = normalizePropertyText(value);
  return normalized?.replace(/\s+/g, ' ') || null;
}

function canonicalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ');
}

function getCanonicalPropertyName(name: string) {
  const normalizedName = canonicalizeText(name);
  return PROPERTY_NAME_ALIASES[normalizedName] || normalizedName;
}

function getCanonicalPropertyId(propertyId: string) {
  const normalizedPropertyId = canonicalizeText(propertyId).replace(
    /\s+/g,
    '_'
  );
  const aliasedName =
    PROPERTY_ID_ALIASES[normalizedPropertyId] ??
    PROPERTY_ID_ALIASES[propertyId];
  return getCanonicalPropertyName(aliasedName ?? propertyId);
}

function serializePropertyValue(value: unknown): string | null {
  const normalized = normalizePropertyText(value);
  if (normalized) {
    return canonicalizeText(normalized);
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }

  return null;
}

function isValidCustomPropertyValue(value: unknown) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  return true;
}

function hasValidCustomPropertyRange(candidate: Record<string, unknown>) {
  const minValue = candidate.minValue;
  const maxValue = candidate.maxValue;
  const hasMin = typeof minValue === 'number' && Number.isFinite(minValue);
  const hasMax = typeof maxValue === 'number' && Number.isFinite(maxValue);

  if (!hasMin && !hasMax) {
    return false;
  }

  if (hasMin && hasMax) {
    return minValue <= maxValue;
  }

  return true;
}

function serializeCustomPropertyRange(candidate: Record<string, unknown>) {
  const minValue = candidate.minValue;
  const maxValue = candidate.maxValue;
  const hasMin = typeof minValue === 'number' && Number.isFinite(minValue);
  const hasMax = typeof maxValue === 'number' && Number.isFinite(maxValue);

  if (hasMin && hasMax) {
    return `${minValue}|${maxValue}`;
  }

  if (hasMin) {
    return `min:${minValue}`;
  }

  return `max:${maxValue}`;
}

export function createProductSchemaAdditionalPropertyCollector() {
  const properties: ProductSchemaAdditionalProperty[] = [];
  const propertyKeys = new Set<string>();
  const livePropertyNames = new Set<string>();

  return {
    add(name: unknown, value: unknown) {
      const normalizedName = normalizePropertyText(name);
      const normalizedValue = normalizePropertyText(value);
      if (!normalizedName || !normalizedValue) {
        return;
      }

      const propertyKey = `${getCanonicalPropertyName(normalizedName)}|${canonicalizeText(normalizedValue)}`;
      livePropertyNames.add(getCanonicalPropertyName(normalizedName));
      if (propertyKeys.has(propertyKey)) {
        return;
      }

      propertyKeys.add(propertyKey);
      properties.push({
        '@type': 'PropertyValue',
        name: normalizedName,
        value: normalizedValue,
      });
    },
    addCustomProperty(property: unknown) {
      if (
        !property ||
        typeof property !== 'object' ||
        Array.isArray(property)
      ) {
        return;
      }

      const candidate = property as Record<string, unknown>;
      const normalizedName = normalizePropertyName(candidate.name);
      const normalizedPropertyId = normalizePropertyName(candidate.propertyID);
      if (
        (!normalizedName && !normalizedPropertyId) ||
        (!isValidCustomPropertyValue(candidate.value) &&
          !hasValidCustomPropertyRange(candidate))
      ) {
        return;
      }

      if (
        candidate['@type'] !== undefined &&
        candidate['@type'] !== 'PropertyValue'
      ) {
        return;
      }

      const serializedValue = isValidCustomPropertyValue(candidate.value)
        ? serializePropertyValue(candidate.value)
        : serializeCustomPropertyRange(candidate);
      if (!serializedValue) {
        return;
      }

      const propertyIdentifier = normalizedName
        ? getCanonicalPropertyName(normalizedName)
        : `propertyid:${canonicalizeText(normalizedPropertyId || '')}`;
      const normalizedCustomPropertyId = normalizedPropertyId
        ? getCanonicalPropertyId(canonicalizeText(normalizedPropertyId))
        : null;
      if (
        (normalizedName && livePropertyNames.has(propertyIdentifier)) ||
        (normalizedCustomPropertyId &&
          livePropertyNames.has(normalizedCustomPropertyId))
      ) {
        return;
      }
      const propertyKey = `${propertyIdentifier}|${serializedValue}`;
      if (propertyKeys.has(propertyKey)) {
        return;
      }

      propertyKeys.add(propertyKey);
      properties.push({
        ...candidate,
        '@type': 'PropertyValue',
        ...(normalizedName ? { name: normalizedName } : {}),
        ...(normalizedPropertyId ? { propertyID: normalizedPropertyId } : {}),
        ...(isValidCustomPropertyValue(candidate.value)
          ? { value: candidate.value }
          : {}),
      });
    },
    getProperties() {
      return properties;
    },
  };
}
