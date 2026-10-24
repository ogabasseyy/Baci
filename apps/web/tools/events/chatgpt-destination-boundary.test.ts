import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectProductionImportClosure } from '../../src/lib/events/event-pipeline-import-closure';
import { analyzeRpcSource } from './verify-event-pipeline-boundaries';

const adapterPath = 'apps/web/src/lib/events/chatgpt-destination-adapter.ts';
const urlPath = 'apps/web/src/lib/store-url.ts';
const read = (path: string) => readFileSync(resolve('../..', path), 'utf8');

describe('ChatGPT worker database boundary', () => {
  it('permits only the declared worker reads in the real adapter', () => {
    expect(analyzeRpcSource(adapterPath, read(adapterPath))).toEqual([]);
  });
  it('rejects unrelated credentials and mutation from the worker', () => {
    expect(
      analyzeRpcSource(
        adapterPath,
        "client.from('merchants').select('facebook_capi_token')"
      )
    ).toContain(
      `${adapterPath}: unauthorized merchants column facebook_capi_token`
    );
    expect(
      analyzeRpcSource(
        adapterPath,
        "client.from('merchant_chatgpt_ads_credentials').update({ capi_key: 'x' })"
      )
    ).toContain(
      `${adapterPath}: unauthorized update on merchant_chatgpt_ads_credentials`
    );
  });
  it('does not grant another source permission to read the CAPI key', () => {
    const path = 'apps/web/src/lib/events/unrelated-worker.ts';
    expect(
      analyzeRpcSource(
        path,
        "client.from('merchant_chatgpt_ads_credentials').select('capi_key')"
      )
    ).toContain(
      `${path}: unauthorized merchant_chatgpt_ads_credentials column capi_key`
    );
  });
  it('keeps pure URL formatting independent of the storefront data loader', () => {
    const sources = new Map([
      [urlPath, read(urlPath)],
      ['apps/web/src/lib/cached-data.ts', 'export const dataLoader = true;'],
    ]);
    expect(collectProductionImportClosure([urlPath], sources)).toEqual(
      new Set([urlPath])
    );
  });
});
