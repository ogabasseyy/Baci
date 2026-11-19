'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { JumiaAttributeSetResponseSchema } from '@/schemas/jumia/catalog';
import type { JumiaBrandItem } from './brand-selector';
import type { JumiaCategorySelection } from './category-selector';
import { JumiaAttributeFields } from './jumia-attribute-fields';
import {
  type JumiaDraftAttribute,
  type JumiaDraftValues,
  validateAttributeValue,
} from './jumia-attribute-values';
import type {
  JumiaMappingDestination,
  JumiaMappingDraft,
} from './jumia-mapping-draft-types';
import { useJumiaMetadata } from './use-jumia-metadata';

const generatedAttributeNames = new Set([
  'name',
  'description',
  'short_description',
]);

function isMerchantSuppliedAttribute(attribute: {
  name: string;
  variation: boolean;
}): boolean {
  return (
    !attribute.variation &&
    !generatedAttributeNames.has(attribute.name.trim().toLowerCase())
  );
}

function getMerchantAttributeValues(
  attributes: JumiaDraftAttribute[],
  values: JumiaDraftValues
): JumiaDraftValues {
  const merchantCodes = new Set(
    attributes
      .filter(isMerchantSuppliedAttribute)
      .map((attribute) => String(attribute.code))
  );
  return Object.fromEntries(
    Object.entries(values).filter(([code]) => merchantCodes.has(code))
  );
}

type Props = {
  destination: JumiaMappingDestination;
  category: JumiaCategorySelection;
  brand: JumiaBrandItem | null;
  revision: number;
  onDraftRevision: () => void;
  onDraftChange?: (draft: JumiaMappingDraft | null) => void;
};

export function JumiaAttributeDraftEditor({
  destination,
  category,
  brand,
  revision,
  onDraftRevision,
  onDraftChange,
}: Props) {
  const [values, setValues] = useState<JumiaDraftValues>({});
  const [bulletText, setBulletText] = useState('');
  const [variationAttributeName, setVariationAttributeName] = useState('');
  const [confirmation, setConfirmation] = useState<number | null>(null);
  const query = new URLSearchParams({
    merchantId: destination.merchantId,
    integrationId: destination.integrationId,
    businessClientCode: destination.businessClientCode,
  });
  const metadata = useJumiaMetadata(
    `/api/marketplace/jumia/attribute-sets/${encodeURIComponent(category.attributeSetId)}?${query}`,
    JumiaAttributeSetResponseSchema,
    true
  );
  const attributes = metadata.data?.attributes ?? [];
  const complete =
    Boolean(brand) &&
    metadata.status === 'success' &&
    attributes
      .filter(isMerchantSuppliedAttribute)
      .every(
        (attribute) =>
          validateAttributeValue(attribute, values[String(attribute.code)]) ===
          null
      );
  const confirmed = confirmation === revision && complete;
  useEffect(() => {
    if (!brand || metadata.status !== 'success' || !complete) {
      onDraftChange?.(null);
      return;
    }
    const bullets = bulletText
      .split('\n')
      .map((bullet) => bullet.trim())
      .filter(Boolean);
    const sourceAttributeName = variationAttributeName.trim();
    onDraftChange?.({
      merchantId: destination.merchantId,
      integrationId: destination.integrationId,
      businessClientCode: destination.businessClientCode,
      countryCode: destination.countryCode,
      category,
      brand,
      attributeSetId: category.attributeSetId,
      attributes: getMerchantAttributeValues(attributes, values),
      bullets,
      ...(sourceAttributeName ? { variation: { sourceAttributeName } } : {}),
      categoryConfirmed: confirmed,
    });
    return () => onDraftChange?.(null);
  }, [
    brand,
    bulletText,
    category,
    complete,
    confirmed,
    attributes,
    destination.merchantId,
    destination.integrationId,
    destination.businessClientCode,
    destination.countryCode,
    metadata.status,
    onDraftChange,
    values,
    variationAttributeName,
  ]);
  return (
    <div className="grid gap-3">
      <p className="text-sm">
        Draft category: {category.name}. Provider product categories cannot be
        changed after creation; confirm this exact category for the draft.
      </p>
      {metadata.status === 'loading' && <p>Loading category attributes…</p>}
      {metadata.error && (
        <div role="alert">
          <p>{metadata.error}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setValues({});
              setConfirmation(null);
              metadata.retry();
            }}
          >
            Retry metadata
          </Button>
        </div>
      )}
      {metadata.status === 'success' && attributes.length === 0 && (
        <p>No attributes returned for this category.</p>
      )}
      <JumiaAttributeFields
        attributes={attributes.filter(isMerchantSuppliedAttribute)}
        values={values}
        onChange={(code, value) => {
          setValues((current) => ({ ...current, [code]: value }));
          setConfirmation(null);
        }}
      />
      <div className="grid gap-1">
        <Label htmlFor="jumia-product-bullets">
          Product bullets (one per line)
        </Label>
        <textarea
          id="jumia-product-bullets"
          className="min-h-24 rounded-md border bg-background p-2 text-sm"
          value={bulletText}
          onChange={(event) => {
            setBulletText(event.target.value);
            setConfirmation(null);
            onDraftRevision();
          }}
          placeholder="Add four to seven plain-text product bullets"
        />
        <p className="text-xs text-muted-foreground">
          These are mapping intent only. Product facts still come from the
          frozen source selection.
        </p>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="jumia-variation-attribute">
          Variation source attribute (optional)
        </Label>
        <input
          id="jumia-variation-attribute"
          className="rounded-md border bg-background p-2 text-sm"
          value={variationAttributeName}
          onChange={(event) => {
            setVariationAttributeName(event.target.value);
            setConfirmation(null);
            onDraftRevision();
          }}
          placeholder="Exact source field name"
        />
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={!complete}
        onClick={() => setConfirmation(revision)}
      >
        Confirm draft category: {category.name}
      </Button>
      {confirmed && (
        <p role="status">
          Draft category confirmed: {category.name}. Draft only; not ready for
          submission.
        </p>
      )}
    </div>
  );
}
