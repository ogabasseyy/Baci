import { createProductSchemaAdditionalPropertyCollector } from './product-schema-additional-properties';
import { getProductSchemaSpecKeyForLabel } from './product-schema-spec-vocabulary';
import { shouldIncludeProductSchemaSpec } from './product-schema-specs';
import type { Product } from './products';
import { hasSupportedCardSlotType } from './storefront-specs/has-supported-card-slot-type';

interface SpecMapping {
  key: string;
  name: string;
  format?: (value: string | number | boolean) => string;
  check?: (value: string | number | boolean) => boolean;
}

function hasPresentSpecValue(
  value: unknown
): value is string | number | boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return typeof value === 'number' || typeof value === 'boolean';
}

function normalizeLegacySpecSectionName(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function collectProductSchemaSpecProperties(product: Product) {
  const collector = createProductSchemaAdditionalPropertyCollector();
  const keySpecs = product.product_key_specs;
  const populatedSpecKeys = new Set<string>();

  if (keySpecs && !Array.isArray(keySpecs)) {
    const mappings: SpecMapping[] = [
      { key: 'network_technology', name: 'Network Technology' },
      {
        key: 'has_5g',
        name: '5G Support',
        format: (value) => (value === true ? 'Yes' : 'No'),
      },
      {
        key: 'has_nfc',
        name: 'NFC',
        format: (value) => (value === true ? 'Yes' : 'No'),
      },
      {
        key: 'has_ois',
        name: 'OIS',
        format: (value) => (value === true ? 'Yes' : 'No'),
      },
      { key: 'dimensions_mm', name: 'Dimensions' },
      { key: 'weight_g', name: 'Weight', format: (value) => `${value}g` },
      { key: 'build_materials', name: 'Build' },
      { key: 'ip_rating', name: 'IP Rating' },
      { key: 'sim_type', name: 'SIM Type' },
      { key: 'display_type', name: 'Display Type' },
      {
        key: 'screen_size_inches',
        name: 'Screen Size',
        format: (value) => `${value} inches`,
      },
      { key: 'display_resolution', name: 'Display Resolution' },
      {
        key: 'refresh_rate_hz',
        name: 'Refresh Rate',
        format: (value) => `${value}Hz`,
      },
      {
        key: 'display_ppi',
        name: 'Pixel Density',
        format: (value) => `${value} ppi`,
      },
      {
        key: 'display_peak_brightness',
        name: 'Peak Brightness',
        format: (value) => `${value} nits`,
      },
      {
        key: 'android_version',
        name: 'Operating System',
        format: (value) => `Android ${value}`,
      },
      { key: 'chipset', name: 'Chipset' },
      { key: 'cpu_cores', name: 'CPU' },
      { key: 'gpu', name: 'GPU' },
      { key: 'ram_gb', name: 'RAM', format: (value) => `${value}GB` },
      {
        key: 'storage_gb',
        name: 'Internal Storage',
        format: (value) => `${value}GB`,
      },
      {
        key: 'card_slot_type',
        name: 'Card Slot',
        check: () => hasSupportedCardSlotType(keySpecs),
      },
      {
        key: 'front_camera_mp',
        name: 'Selfie Camera',
        format: (value) => `${value}MP`,
      },
      { key: 'rear_camera_video', name: 'Video Recording' },
      {
        key: 'has_stereo_speakers',
        name: 'Speakers',
        format: (value) => (value === true ? 'Stereo' : 'Mono'),
      },
      {
        key: 'has_headphone_jack',
        name: '3.5mm Headphone Jack',
        format: (value) => (value === true ? 'Yes' : 'No'),
      },
      { key: 'wifi_bands', name: 'WiFi' },
      { key: 'bluetooth_version', name: 'Bluetooth' },
      {
        key: 'usb_type',
        name: 'USB',
        format: (value) =>
          `${value}${keySpecs.has_usb_otg === true ? ' (OTG)' : ''}`,
      },
      {
        key: 'has_fm_radio',
        name: 'FM Radio',
        format: () => 'Yes',
        check: (value) => value === true,
      },
      { key: 'fingerprint_type', name: 'Fingerprint Sensor' },
      {
        key: 'battery_mah',
        name: 'Battery Capacity',
        format: (value) => `${value}mAh`,
      },
      {
        key: 'charging_watt',
        name: 'Fast Charging',
        format: (value) => `${value}W`,
      },
      {
        key: 'wireless_charging_watt',
        name: 'Wireless Charging',
        format: (value) => `${value}W`,
        check: () => keySpecs.has_wireless_charging === true,
      },
    ];

    if (
      hasPresentSpecValue(keySpecs.main_camera_mp) &&
      shouldIncludeProductSchemaSpec(product, {
        key: 'main_camera_mp',
        value: keySpecs.main_camera_mp,
      })
    ) {
      const cameraType =
        keySpecs.has_quad_camera === true
          ? 'Quad'
          : keySpecs.has_triple_camera === true
            ? 'Triple'
            : keySpecs.has_dual_camera === true
              ? 'Dual'
              : 'Single';
      collector.add(
        'Main Camera',
        `${cameraType} ${keySpecs.main_camera_mp}MP`
      );
      populatedSpecKeys.add('main_camera_mp');
    }

    for (const mapping of mappings) {
      const value = keySpecs[mapping.key] as unknown;
      if (!hasPresentSpecValue(value)) {
        continue;
      }
      if (mapping.check && !mapping.check(value)) {
        continue;
      }
      if (
        !shouldIncludeProductSchemaSpec(product, {
          key: mapping.key,
          value,
        })
      ) {
        continue;
      }

      collector.add(
        mapping.name,
        mapping.format ? mapping.format(value) : String(value)
      );
      populatedSpecKeys.add(mapping.key);
    }
  }

  if (Array.isArray(product.specifications)) {
    for (const category of product.specifications) {
      if (!Array.isArray(category.items)) {
        continue;
      }

      const sectionName = normalizeLegacySpecSectionName(category.category);
      if (category.category != null && sectionName === undefined) {
        continue;
      }

      for (const item of category.items) {
        const label =
          typeof item.label === 'string' ? item.label.trim() : undefined;
        if (!label) {
          continue;
        }

        const canonicalKey = getProductSchemaSpecKeyForLabel(
          label,
          sectionName
        );
        if (canonicalKey && populatedSpecKeys.has(canonicalKey)) {
          continue;
        }

        if (
          shouldIncludeProductSchemaSpec(product, {
            label,
            section: sectionName,
            value: item.value,
          })
        ) {
          collector.add(label, item.value);
        }
      }
    }
  }

  return collector;
}
