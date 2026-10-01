import { describe, expect, it } from 'vitest';
import {
  getProductSchemaSpecKeyForLabel,
  getProductSchemaSpecKeyForPropertyId,
} from './product-schema-spec-vocabulary';

describe('getProductSchemaSpecKeyForLabel', () => {
  it('scopes bare Technology and Resolution labels to their semantic sections', () => {
    expect(getProductSchemaSpecKeyForLabel('Technology')).toBeUndefined();
    expect(getProductSchemaSpecKeyForLabel('Technology', 'Network')).toBe(
      'network_technology'
    );
    expect(getProductSchemaSpecKeyForLabel('Resolution', 'Display')).toBe(
      'display_resolution'
    );
    expect(getProductSchemaSpecKeyForLabel('Resolution', 'Imaging')).toBe(
      'main_camera_mp'
    );
    expect(
      getProductSchemaSpecKeyForLabel('Resolution', 'Imaging and recording')
    ).toBe('main_camera_mp');
  });

  it('maps formatted schema labels to their canonical keys', () => {
    expect(getProductSchemaSpecKeyForLabel(' Network Technology ')).toBe(
      'network_technology'
    );
    expect(getProductSchemaSpecKeyForLabel('Technology')).toBeUndefined();
    expect(getProductSchemaSpecKeyForLabel('Technology', 'Network')).toBe(
      'network_technology'
    );
    expect(getProductSchemaSpecKeyForLabel('Selfie Camera')).toBe(
      'front_camera_mp'
    );
    expect(getProductSchemaSpecKeyForLabel('Android')).toBeUndefined();
    expect(getProductSchemaSpecKeyForLabel('Android', 'Platform')).toBe(
      'android_version'
    );
  });

  it('maps legacy card-slot label variants to the card-slot field', () => {
    for (const label of [
      'Card-Slot',
      'Card Slot Type',
      'Memory Card Slot',
      'SD Card Slot',
    ]) {
      expect(getProductSchemaSpecKeyForLabel(label)).toBe('card_slot_type');
    }
  });

  it('maps the native Fingerprint taxonomy label to fingerprint_type', () => {
    expect(getProductSchemaSpecKeyForLabel('Fingerprint')).toBe(
      'fingerprint_type'
    );
  });

  it('maps dynamic main-camera labels to main_camera_mp', () => {
    for (const label of [
      'Quad Camera',
      'Triple Camera',
      'Dual Camera',
      'Single Camera',
    ]) {
      expect(getProductSchemaSpecKeyForLabel(label)).toBe('main_camera_mp');
    }
  });

  it('maps the public OIS label to has_ois', () => {
    expect(getProductSchemaSpecKeyForLabel('OIS')).toBe('has_ois');
  });

  it('maps the native Radio taxonomy label to has_fm_radio', () => {
    expect(getProductSchemaSpecKeyForLabel('Radio')).toBe('has_fm_radio');
  });

  it('leaves product-specific labels available to the legacy label path', () => {
    expect(getProductSchemaSpecKeyForLabel('Sensor')).toBeUndefined();
    expect(getProductSchemaSpecKeyForLabel('Focal Length')).toBeUndefined();
  });
  it('does not infer wireless charging from a generic Wireless label', () => {
    expect(getProductSchemaSpecKeyForLabel('Wireless')).toBeUndefined();
  });
});

describe('getProductSchemaSpecKeyForPropertyId', () => {
  it('maps recognized property ids to canonical schema spec keys', () => {
    expect(getProductSchemaSpecKeyForPropertyId('ram_gb')).toBe('ram_gb');
    expect(getProductSchemaSpecKeyForPropertyId('storage_gb')).toBe(
      'storage_gb'
    );
  });

  it('maps canonical capability property ids before label parsing', () => {
    for (const propertyId of ['has_5g', 'has_nfc', 'has_stereo_speakers']) {
      expect(getProductSchemaSpecKeyForPropertyId(propertyId)).toBe(propertyId);
    }

    expect(getProductSchemaSpecKeyForPropertyId('has_5g')).not.toBeUndefined();
    expect(getProductSchemaSpecKeyForLabel('has 5g')).toBeUndefined();
  });
});
