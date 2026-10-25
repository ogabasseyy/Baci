import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsvText } from '@/lib/imports/csv/parse-csv';
import snapshot from './fixtures/petrock-check-catalog-20261025.json';
import {
  getPetrockCheckCatalog,
  getPetrockMappingBlockers,
  getPetrockMappingsForTier,
  PETROCK_CHECK_MAPPINGS,
} from './petrock-check-catalog';

describe('complete Petrock customer check mapping', () => {
  it('maps every reviewed live check exactly once', () => {
    expect(PETROCK_CHECK_MAPPINGS.map((x) => x.productId).sort()).toEqual(
      Object.keys(snapshot.products).sort()
    );
    expect(new Set(PETROCK_CHECK_MAPPINGS.map((x) => x.productId)).size).toBe(
      99
    );
  });
  it('keeps the exact machine input key and current supplier cost', () => {
    for (const row of PETROCK_CHECK_MAPPINGS) {
      const product =
        snapshot.products[row.productId as keyof typeof snapshot.products];
      expect(row.orderFieldName).toBe(product.fields[0].name);
      expect(row.costUsd).toBe(Number(product.price));
      expect(row.supplierName).toBe(product.name);
      expect(row.inputType).toBe(product.fields[0].type);
      expect(row.turnaround).toBe(product.time);
    }
  });
  it('consolidates Apple colour/storage suppliers without confusing their identifiers', () => {
    const entry = getPetrockCheckCatalog().find(
      (x) => x.id === 'appleConfiguration'
    );
    expect(entry?.name).toBe('Apple model, colour & storage');
    expect(entry?.variants.map((x) => x.productId)).toEqual([
      '1954',
      '674',
      '675',
    ]);
    expect(
      entry?.variants.find((x) => x.productId === '675')?.identifiers
    ).toEqual(['serial']);
  });
  it('keeps EID lookup separate from eSIM compatibility and KDDI status separate from finance', () => {
    const entryFor = (id: string) =>
      PETROCK_CHECK_MAPPINGS.find((x) => x.productId === id)?.entryId;
    expect(entryFor('1956')).toBe('eidLookup');
    expect(entryFor('1941')).toBe('esimCompatibility');
    expect(entryFor('729')).toBe('kddiDeviceStatus');
    expect(entryFor('731')).toBe('kddiDeviceStatus');
    expect(entryFor('730')).toBe('kddiFinance');
    expect(entryFor('732')).toBe('docomoFinance');
    expect(entryFor('733')).toBe('softbankFinance');
  });
  it('records working Apple evidence and rejected blacklist evidence honestly', () => {
    expect(
      PETROCK_CHECK_MAPPINGS.find((x) => x.productId === '1954')?.evidence
    ).toBe('successful_probe');
    expect(
      PETROCK_CHECK_MAPPINGS.find((x) => x.productId === '1955')?.evidence
    ).toBe('rejected_probe');
    expect(
      PETROCK_CHECK_MAPPINGS.filter((x) => x.evidence === 'successful_probe')
    ).toHaveLength(1);
  });
  it('never includes an unlock or eligibility-conversion operation as a diagnostic check', () => {
    for (const id of ['1509', '2019', '2021', '4070'])
      expect(PETROCK_CHECK_MAPPINGS.some((x) => x.productId === id)).toBe(
        false
      );
  });
});

it('retains explicit activation blockers instead of enabling unverified services', () => {
  expect(getPetrockMappingBlockers('1955')).toContain(
    'rejected_provider_probe'
  );
  expect(getPetrockMappingBlockers('1954')).toContain(
    'customer_price_required'
  );
  expect(getPetrockMappingBlockers('675')).toContain(
    'response_verification_required'
  );
  expect(getPetrockMappingBlockers('665')).toContain(
    'unsupported_identifier_form'
  );
  expect(getPetrockMappingBlockers('999999')).toEqual(['unmapped_product']);
  expect(getPetrockMappingsForTier('full')).toEqual([]);
  expect(getPetrockCheckCatalog().every((x) => x.activationRequired)).toBe(
    true
  );
});
it('returns related customer prices without setting new ones', () => {
  const blacklist = getPetrockCheckCatalog().find((x) => x.id === 'blacklist');
  expect(blacklist?.relatedCustomerPrices).toContainEqual({
    tierKey: 'blacklist',
    priceNgn: 700,
  });
  const eid = getPetrockCheckCatalog().find((x) => x.id === 'eidLookup');
  expect(eid).toMatchObject({
    newEntry: true,
    customerPriceNgn: null,
    relatedCustomerPrices: [],
  });
});
it('honours supplier-specific brand limits within a generic customer entry', () => {
  const samsung = getPetrockCheckCatalog({
    brand: 'samsung',
    device: 'smartphone',
  });
  expect(
    samsung.find((x) => x.id === 'blacklist')?.variants.map((x) => x.productId)
  ).not.toContain('684');
  expect(samsung.some((x) => x.id === 'findMy')).toBe(false);
});

it('excludes phone-only variants from Mac laptop results', () => {
  const ids = getPetrockCheckCatalog({
    brand: 'apple',
    device: 'laptop',
  }).flatMap((entry) => entry.variants.map((row) => row.productId));
  for (const id of ['1953', '674', '671', '1994', '679'])
    expect(ids).not.toContain(id);
  expect(ids).toContain('707');
});
it('preserves explicitly advertised serial input without claiming verified coverage', () => {
  for (const id of ['689', '1963']) {
    const product = snapshot.products[id as keyof typeof snapshot.products];
    expect(product.fields[0]).toMatchObject({ display_label: 'IMEI/SN' });
    expect(
      PETROCK_CHECK_MAPPINGS.find((row) => row.productId === id)
    ).toMatchObject({
      identifiers: ['imei', 'serial'],
      evidence: 'unverified',
    });
  }
});
it('includes advertised iMac locks but excludes laptop-only Dell checks from desktops', () => {
  const ids = getPetrockCheckCatalog({
    brand: 'apple',
    device: 'desktop',
  }).flatMap((entry) => entry.variants.map((row) => row.productId));
  for (const id of ['713', '714', '715']) expect(ids).toContain(id);
  expect(ids).not.toContain('697');
  expect(ids).not.toContain('698');
  expect(getPetrockCheckCatalog({ brand: 'dell', device: 'desktop' })).toEqual(
    []
  );
});

it('exports effective supplier scope and identifiers in the owner review CSV', () => {
  const { rows } = parseCsvText(
    readFileSync(
      resolve(
        process.cwd(),
        '../../docs/imei/catalog-review-20261025/customer-service-map.csv'
      ),
      'utf8'
    )
  );
  expect(rows).toHaveLength(99);
  for (const entry of getPetrockCheckCatalog()) {
    for (const variant of entry.variants) {
      const row = rows.find(
        (item) => item.petrock_product_id === variant.productId
      );
      expect(row, variant.productId).toMatchObject({
        brands: (variant.brandScope ?? entry.brands).join(','),
        devices: (variant.deviceScope ?? entry.devices).join(','),
        accepted_identifiers: variant.identifiers.join(','),
      });
    }
  }
});

it('keeps iPhone-only suppliers out of tablet variants', () => {
  const ids = getPetrockCheckCatalog({
    brand: 'apple',
    device: 'tablet',
  }).flatMap((entry) => entry.variants.map((row) => row.productId));
  for (const id of ['686', '696', '702', '703']) expect(ids).not.toContain(id);
  expect(ids).toContain('712');
});
it('retains advertised Motorola serial input as unverified', () => {
  expect(
    PETROCK_CHECK_MAPPINGS.find((row) => row.productId === '1991')
  ).toMatchObject({ identifiers: ['imei', 'serial'], evidence: 'unverified' });
});
