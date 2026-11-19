import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { oxygenProbeCheckpointSchema } from '../../src/schemas/oxygen-probe';

export type ProbeCheckpoint = z.infer<typeof oxygenProbeCheckpointSchema>;
const envelopeSchema = z
  .object({
    version: z.literal(1),
    environment: z.enum(['dev', 'staging', 'production']),
    partnerBinding: z.string(),
    state: oxygenProbeCheckpointSchema,
  })
  .strict();

export class CheckpointStore {
  private path: string;
  private partnerBinding: string;
  constructor(
    private directory: string,
    private environment: 'dev' | 'staging' | 'production',
    partner: string
  ) {
    this.path = join(directory, `${environment}.json`);
    this.partnerBinding = createHash('sha256').update(partner).digest('hex');
  }
  async load(): Promise<ProbeCheckpoint | undefined> {
    try {
      const file = await open(
        this.path,
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      try {
        const info = await file.stat();
        if (
          !info.isFile() ||
          info.size > 65536 ||
          (info.mode & 0o077) !== 0 ||
          (process.getuid && info.uid !== process.getuid())
        )
          throw new Error('Private checkpoint required');
        const saved = envelopeSchema.parse(
          JSON.parse(await file.readFile('utf8'))
        );
        if (
          saved.environment !== this.environment ||
          saved.partnerBinding !== this.partnerBinding
        )
          throw new Error('Checkpoint binding mismatch');
        return saved.state;
      } finally {
        await file.close();
      }
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return undefined;
      throw new Error('Checkpoint unavailable; reconcile before restarting.');
    }
  }
  async save(state: ProbeCheckpoint): Promise<void> {
    const data = JSON.stringify(
      envelopeSchema.parse({
        version: 1,
        environment: this.environment,
        partnerBinding: this.partnerBinding,
        state,
      })
    );
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw new Error('Private checkpoint directory required');
    await chmod(this.directory, 0o700);
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(data);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.path);
      const directory = await open(this.directory, constants.O_RDONLY);
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await unlink(temporary).catch(() => {
        // Renamed temporary files are already absent; preserve the write error.
      });
    }
  }
}
