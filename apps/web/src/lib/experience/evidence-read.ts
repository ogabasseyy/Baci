import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BuilderIdentity } from '@/lib/builder-connector/types';
import { createBuilderThrottle } from '@/lib/builder-gateway/throttle';
import {
  experienceEvidenceId,
  experienceEvidenceImageRow,
} from '@/schemas/experience-evidence-row';

export interface EvidenceReadDependencies {
  authenticate(request: Request): Promise<BuilderIdentity>;
  resolveUserClient(identity: BuilderIdentity): Promise<SupabaseClient>;
}
/** Fixed evidence IDs only. Normal owner RLS is rechecked with the live outer grant. */
export function createExperienceEvidenceReader(deps: EvidenceReadDependencies) {
  const admitted = createBuilderThrottle({ perUser: 30, perConnection: 20 });
  return async (request: Request, evidenceId: string) => {
    const headers = {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    };
    const denied = (status: number) =>
      Response.json({ error: 'Evidence unavailable.' }, { status, headers });
    if (request.method !== 'GET') return denied(405);
    if (
      !experienceEvidenceId.safeParse(evidenceId).success ||
      new URL(request.url).search
    )
      return denied(400);
    try {
      const identity = await deps.authenticate(request);
      if (!identity.scopes.has('storefront.read')) return denied(403);
      if (!admitted(identity)) return denied(429);
      const client = await deps.resolveUserClient(identity);
      const auth = await client.auth.getUser();
      if (auth.error || auth.data.user?.id !== identity.actorUserId)
        return denied(401);
      const result = await client
        .from('experience_snapshots')
        .select('merchant_id,evidence_digest,evidence_bytes')
        .eq('id', evidenceId)
        .maybeSingle();
      const parsed = result.error
        ? null
        : experienceEvidenceImageRow.safeParse(result.data);
      if (
        !parsed?.success ||
        !identity.allowedMerchantIds.includes(parsed.data.merchant_id)
      )
        return denied(404);
      const row = parsed.data;
      // Staff metadata permission does not imply private evidence permission.
      const owner = await client
        .from('merchants')
        .select('id')
        .eq('id', row.merchant_id)
        .eq('user_id', identity.actorUserId)
        .maybeSingle();
      if (owner.error || !owner.data) return denied(404);
      const bytes = Buffer.from(row.evidence_bytes.slice(2), 'hex');
      if (
        !bytes.length ||
        bytes.length > 2097152 ||
        createHash('sha256').update(bytes).digest('hex') !== row.evidence_digest
      )
        return denied(404);
      const png = [137, 80, 78, 71, 13, 10, 26, 10].every(
        (n, i) => bytes[i] === n
      );
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (!png && !jpeg) return denied(404);
      const live = await deps.authenticate(request);
      if (
        live.actorUserId !== identity.actorUserId ||
        live.connectionId !== identity.connectionId ||
        live.grantVersion !== identity.grantVersion ||
        !live.scopes.has('storefront.read') ||
        !live.allowedMerchantIds.includes(row.merchant_id)
      )
        return denied(403);
      return new Response(Uint8Array.from(bytes).buffer, {
        headers: {
          ...headers,
          'Content-Type': png ? 'image/png' : 'image/jpeg',
          'Content-Length': String(bytes.length),
        },
      });
    } catch {
      return denied(403);
    }
  };
}
