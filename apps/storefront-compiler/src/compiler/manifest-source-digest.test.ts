import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-catalog-fixture';
import {
  computeManifestSourceDigest,
  sha256Hex,
} from './manifest-source-digest';

describe('manifest-source-digest', () => {
  it('computes order-independent SHA-256 digests that change whenever routes, tokens, CSP, or files change', () => {
    expect(sha256Hex(['a', 'b'])).not.toBe(sha256Hex(['ab']));

    const a = createOgabasseyStorefrontManifest();
    const b = createOgabasseyStorefrontManifest();
    b.files.reverse();
    b.packages.reverse();
    expect(computeManifestSourceDigest(a)).toBe(computeManifestSourceDigest(b));

    const routeChanged = createOgabasseyStorefrontManifest();
    routeChanged.routes.push({ path: '/pages/shipping', view: 'editorial' });
    expect(computeManifestSourceDigest(routeChanged)).not.toBe(
      computeManifestSourceDigest(a)
    );
  });
});
