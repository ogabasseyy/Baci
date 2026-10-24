'use client';

import { useId, useState } from 'react';
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
  type JumiaDraftValues,
  validateAttributeValue,
} from './jumia-attribute-values';
import { useJumiaMetadata } from './use-jumia-metadata';

type Destination = {
  merchantId: string;
  integrationId: string;
  businessClientCode: string;
};
export type JumiaMappingDraft = Destination & {
  category: JumiaCategorySelection;
  brand: JumiaBrandItem;
  attributeSetId: string;
  attributes: JumiaDraftValues;
  categoryConfirmed: boolean;
};
type Props = { merchantId: string; integrationId: string };

export function JumiaMappingDraftPanel(props: Props) {
  return (
    <DestinationPanel
      key={JSON.stringify([props.merchantId, props.integrationId])}
      {...props}
    />
  );
}

function DestinationPanel({ merchantId, integrationId }: Props) {
  const id = useId();
  const [businessClientCode, setBusinessClientCode] = useState('');
  const query = new URLSearchParams({ merchantId, integrationId });
  const context = useJumiaMetadata(
    `/api/marketplace/jumia/destination-context?${query}`,
    jumiaDestinationContextSchema,
    true
  );
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
          onChange={(event) => setBusinessClientCode(event.target.value)}
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

function MappingControls(destination: Destination) {
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
}: {
  destination: Destination;
  category: JumiaCategorySelection;
  brand: JumiaBrandItem | null;
  revision: number;
}) {
  const [values, setValues] = useState<JumiaDraftValues>({});
  const [confirmation, setConfirmation] = useState<number | null>(null);
  const query = new URLSearchParams(destination);
  const metadata = useJumiaMetadata(
    `/api/marketplace/jumia/attribute-sets/${encodeURIComponent(category.attributeSetId)}?${query}`,
    JumiaAttributeSetResponseSchema,
    true
  );
  const attributes = metadata.data?.attributes ?? [];
  const complete =
    Boolean(brand) &&
    metadata.status === 'success' &&
    attributes.every(
      (attribute) =>
        validateAttributeValue(attribute, values[String(attribute.code)]) ===
        null
    );
  const confirmed = confirmation === revision && complete;
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
        attributes={attributes}
        values={values}
        onChange={(code, value) => {
          setValues((current) => ({ ...current, [code]: value }));
          setConfirmation(null);
        }}
      />
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
