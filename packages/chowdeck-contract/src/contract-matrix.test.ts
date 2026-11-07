import { readFile } from 'node:fs/promises';

describe('public contract matrix', () => {
  it('identifies the committed receipt and its category creation status', async () => {
    const receipt = JSON.parse(
      await readFile(
        new URL('../evidence/0a-core/public-contract.json', import.meta.url),
        'utf8'
      )
    ) as { digest: string; claims: { capability: string; status: string }[] };
    const matrix = await readFile(
      new URL(
        '../../../docs/integrations/chowdeck/contract-matrix.md',
        import.meta.url
      ),
      'utf8'
    );
    expect(matrix).toContain(receipt.digest);
    const category = receipt.claims.find(
      (claim) => claim.capability === 'menu.category.create'
    );
    expect(category?.status).toBe('unproven');
    expect(matrix).toContain('Category creation remains unproven');
  });
});
