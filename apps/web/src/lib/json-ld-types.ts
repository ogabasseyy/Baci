import type { Graph, Thing, WithContext } from 'schema-dts';

export type JsonLdData<T extends Thing = Thing> = WithContext<T>;

export interface JsonLdStructuredData extends Record<string, unknown> {
  '@context': string;
  '@type': string | string[];
}

export type JsonLdGraphNode =
  | (Record<string, unknown> & { '@type': string | string[] })
  | (Record<string, unknown> & { '@id': string });

export interface JsonLdGraphData extends Record<string, unknown> {
  '@context': string;
  '@graph': readonly JsonLdGraphNode[];
}

export type JsonLdScriptData =
  | JsonLdData
  | Graph
  | JsonLdStructuredData
  | JsonLdGraphData;
