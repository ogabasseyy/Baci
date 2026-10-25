'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { JumiaAttributeSetResponseSchema } from '@/schemas/jumia/catalog';
import { jumiaDestinationContextSchema } from '@/schemas/jumia/metadata-query';
import { type JumiaBrandItem, JumiaBrandSelector } from './brand-selector';
import {
  type JumiaCategorySelection,
  JumiaCategorySelector,
} from './category-selector';
import { JumiaAttributeFields } from './jumia-attribute-fields';
import {
  type JumiaDraftAttribute,
  type JumiaDraftValues,
  validateAttributeValue,
} from './jumia-attribute-values';
import { useJumiaMetadata } from './use-jumia-metadata';

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

type Destination = {
  merchantId: string;
  integrationId: string;
  businessClientCode: string;
  countryCode: string;
};
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

export type JumiaMappingDraft = Destination & {
  category: JumiaCategorySelection;
  brand: JumiaBrandItem;
  attributeSetId: string;
  attributes: JumiaDraftValues;
  bullets: string[];
  variation?: { sourceAttributeName: string };
  categoryConfirmed: boolean;
};
type Props = {
  merchantId: string;
  integrationId: string;
  onDraftChange?: (draft: JumiaMappingDraft | null) => void;
};

export function JumiaMappingDraftPanel(props: Props) {
  return (
    <DestinationPanel
      key={JSON.stringify([props.merchantId, props.integrationId])}
      {...props}
    />
  );
}

function DestinationPanel({ merchantId, integrationId, onDraftChange }: Props) {
  const id = useId();
  const [businessClientCode, setBusinessClientCode] = useState('');
  const query = new URLSearchParams({ merchantId, integrationId });
  const context = useJumiaMetadata(
    `/api/marketplace/jumia/destination-context?${query}`,
    jumiaDestinationContextSchema,
    true
  );
  useEffect(() => {
    onDraftChange?.(null);
  }, [onDraftChange]);
  const clients = context.data?.businessClients ?? [];
  // Only a fresh provider-authorized option can mount the mapping controls.
  const selectedClient = clients.find(
    (client) => client.code === businessClientCode
  );
  return (
    <section
      aria-label="Jumia mapping draft"
      className="grid gap-4 rounded-md border p-4"
    >
      <div>
        <h3 className="font-medium">Destination mapping draft</h3>
        <p className="text-sm text-muted-foreground">
          Separate from the frozen product selection and legacy publisher. This
          draft does not submit products.
        </p>
      </div>
      {context.status === 'loading' && <p>Loading authorized destinations…</p>}
      {context.error && (
        <div role="alert">
          <p>{context.error}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setBusinessClientCode('');
              context.retry();
            }}
          >
            Retry destinations
          </Button>
        </div>
      )}
      {context.status === 'success' && clients.length === 0 && (
        <p>
          No active authorized business clients for this integration. Reconnect
          or check the shop in Jumia.
        </p>
      )}
      <div className="grid gap-1">
        <Label htmlFor={id}>Draft destination business client</Label>
        <select
          id={id}
          className="rounded-md border bg-background p-2"
          value={selectedClient?.code ?? ''}
          disabled={context.status !== 'success'}
          onChange={(event) => {
            setBusinessClientCode(event.target.value);
          }}
        >
          <option value="">Choose an exact business client</option>
          {clients.map((client) => (
            <option key={client.code} value={client.code}>
              {client.name} ({client.code})
            </option>
          ))}
        </select>
      </div>
      {selectedClient && (
        <MappingControls
          key={selectedClient.code}
          merchantId={merchantId}
          integrationId={integrationId}
          businessClientCode={selectedClient.code}
          countryCode={selectedClient.countryCode}
          onDraftChange={onDraftChange}
        />
      )}
      <p className="text-xs text-muted-foreground">
        Destination, category and brand still require later provider and source
        validation before submission. Global category and brand lists do not
        prove availability for this business client. No prices or source facts
        are inferred.
      </p>
    </section>
  );
}

function MappingControls({
  onDraftChange,
  ...destination
}: Destination & {
  onDraftChange?: (draft: JumiaMappingDraft | null) => void;
}) {
  const [category, setCategory] = useState<JumiaCategorySelection | null>(null);
  const [brand, setBrand] = useState<JumiaBrandItem | null>(null);
  const [revision, setRevision] = useState(0);
  return (
    <>
      <div className="grid gap-1">
        <Label>Draft Jumia category (leaf only)</Label>
        <JumiaCategorySelector
          {...destination}
          leafOnly
          value={category?.code}
          onSelect={(next) => {
            setCategory(next);
            onDraftChange?.(null);
            setRevision((value) => value + 1);
          }}
        />
      </div>
      <div className="grid gap-1">
        <Label>Draft Jumia brand</Label>
        <p className="text-xs text-muted-foreground">
          Brand availability is unverified for {destination.businessClientCode}.
          This list is provider-wide.
        </p>
        <JumiaBrandSelector
          {...destination}
          value={brand}
          onSelect={(next) => {
            setBrand(next);
            setRevision((value) => value + 1);
          }}
        />
      </div>
      {category && (
        <AttributeDraft
          key={JSON.stringify([category.code, category.attributeSetId])}
          destination={destination}
          category={category}
          brand={brand}
          revision={revision}
          onDraftRevision={() => setRevision((value) => value + 1)}
          onDraftChange={onDraftChange}
        />
      )}
    </>
  );
}

function AttributeDraft({
  destination,
  category,
  brand,
  revision,
  onDraftRevision,
  onDraftChange,
}: {
  destination: Destination;
  category: JumiaCategorySelection;
  brand: JumiaBrandItem | null;
  revision: number;
  onDraftRevision: () => void;
  onDraftChange?: (draft: JumiaMappingDraft | null) => void;
}) {
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
