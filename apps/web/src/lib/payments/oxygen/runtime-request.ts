import {
  type OxygenTransientFile,
  oxygenRuntimeSubmissionSchema,
  validateOxygenFile,
} from '@/schemas/oxygen-runtime';

export async function readOxygenRuntimeRequest(request: Request) {
  try {
    const type = request.headers.get('content-type') ?? '';
    const multipart = type.startsWith('multipart/form-data;');
    if (!multipart && !type.startsWith('application/json'))
      throw new Error('Unsupported content');
    const limit = multipart ? 2_097_152 : 65_536;
    const reader = request.body?.getReader();
    if (!reader) throw new Error('Empty request');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('Too large');
      }
      chunks.push(chunk.value);
    }
    const bytes = Buffer.concat(chunks);
    let input: unknown;
    let file: OxygenTransientFile | undefined;
    if (multipart) {
      const form = await new Response(bytes, {
        headers: { 'content-type': type },
      }).formData();
      if (
        [...form.keys()].some((key) => !['payload', 'file'].includes(key)) ||
        form.getAll('payload').length !== 1 ||
        form.getAll('file').length !== 1
      )
        throw new Error('Invalid form');
      const payload = form.get('payload');
      const upload = form.get('file');
      if (
        typeof payload !== 'string' ||
        payload.length > 65_536 ||
        !upload ||
        typeof upload === 'string'
      )
        throw new Error('Invalid form');
      input = JSON.parse(payload) as unknown;
      file = {
        bytes: new Uint8Array(await upload.arrayBuffer()),
        name: upload.name,
        type: upload.type,
      };
      if (!validateOxygenFile(file.bytes, file.type, file.name))
        throw new Error('Invalid file');
    } else input = JSON.parse(bytes.toString('utf8')) as unknown;
    const submission = oxygenRuntimeSubmissionSchema.parse(input);
    if (
      submission.command.action === 'approve_booking' &&
      file &&
      !['image/jpeg', 'image/png'].includes(file.type)
    )
      throw new Error('Signature image required');
    const needsFile = ['submit_address', 'approve_booking'].includes(
      submission.command.action
    );
    if (needsFile !== Boolean(file)) throw new Error('File mismatch');
    return { submission, file };
  } catch {
    throw new Error('Invalid workflow request');
  }
}
