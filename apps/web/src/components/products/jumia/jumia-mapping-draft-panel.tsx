'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { jumiaDestinationContextSchema } from '@/schemas/jumia/metadata-query';
import { type JumiaBrandItem, JumiaBrandSelector } from './brand-selector';
import {
  type JumiaCategorySelection,
  JumiaCategorySelector,
} from './category-selector';
import { JumiaAttributeDraftEditor } from './jumia-attribute-draft-editor';
import type {
  JumiaMappingDestination as Destination,
  JumiaMappingDraft,
} from './jumia-mapping-draft-types';
import { useJumiaMetadata } from './use-jumia-metadata';

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
        <JumiaAttributeDraftEditor
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
