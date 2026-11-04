const maximum = 2097152;
const png = [137, 80, 78, 71, 13, 10, 26, 10];
/** Distinct bounded binary transport. Ordinary JSON caps/timeouts are untouched. */
export function createExperienceEvidenceClient(
  deps: { fetchImpl?: typeof fetch; backendOrigin?: string } = {}
) {
  // Trusted composition only. Neither tools nor evidence IDs can select an origin.
  const origin = new URL(deps.backendOrigin ?? 'https://usebaci.com');
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw Error('INVALID_BACKEND_ORIGIN');
  return async (token: string, evidenceId: string, signal?: AbortSignal) => {
    if (
      !/^[A-Za-z0-9_.-]{1,8192}$/.test(token) ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(evidenceId)
    )
      throw Error('INVALID_REQUEST');
    const response = await (deps.fetchImpl ?? fetch)(
      `${origin.origin}/api/integrations/chatgpt/experience-evidence/${evidenceId}`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'image/png, image/jpeg',
        },
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.any([
          AbortSignal.timeout(25000),
          ...(signal ? [signal] : []),
        ]),
      }
    );
    const mime = response.headers.get('content-type');
    const length = response.headers.get('content-length') ?? '';
    if (
      response.status !== 200 ||
      (mime !== 'image/png' && mime !== 'image/jpeg') ||
      !/^[1-9]\d{0,6}$/.test(length) ||
      Number(length) > maximum
    ) {
      await response.body?.cancel();
      throw Error('EVIDENCE_UNAVAILABLE');
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error('EVIDENCE_UNAVAILABLE');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.byteLength;
        if (size > maximum || size > Number(length))
          throw Error('EVIDENCE_UNAVAILABLE');
        chunks.push(item.value);
      }
      if (size !== Number(length)) throw Error('EVIDENCE_UNAVAILABLE');
      const bytes = Buffer.concat(chunks);
      if (
        mime === 'image/png'
          ? !png.every((n, i) => bytes[i] === n)
          : !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
      )
        throw Error('EVIDENCE_UNAVAILABLE');
      return {
        type: 'image' as const,
        mimeType: mime,
        data: bytes.toString('base64'),
      };
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  };
}
