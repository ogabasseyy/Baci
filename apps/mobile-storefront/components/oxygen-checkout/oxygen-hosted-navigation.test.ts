import {
  canOpenOxygenHostedUrl,
  createOxygenStatusRefresher,
} from './oxygen-hosted-navigation';

const caps = {
  hostedOrigins: ['https://pay.example', 'https://selfie.example'],
  selfieOrigins: ['https://selfie.example'],
};
describe('Oxygen hosted navigation', () => {
  it('pins exact secure origins and rejects credential/port/lookalike URLs', () => {
    expect(
      canOpenOxygenHostedUrl('https://pay.example/pay', 'payment', caps)
    ).toBe(true);
    for (const url of [
      'https://pay.example.evil/pay',
      'https://pay.example:444/pay',
      'https://user@pay.example/pay',
      'javascript:alert(1)',
      'http://pay.example/pay',
      'https://pay.example./pay',
    ])
      expect(canOpenOxygenHostedUrl(url, 'payment', caps)).toBe(false);
    expect(
      canOpenOxygenHostedUrl('https://pay.example/pay', 'selfie', caps)
    ).toBe(false);
  });
  it.each([
    undefined,
    null,
    [],
  ])('blocks a hosted link without a configured origin list', (hostedOrigins) => {
    const incomplete = { ...caps, hostedOrigins } as typeof caps;
    expect(
      canOpenOxygenHostedUrl('https://pay.example/pay', 'payment', incomplete)
    ).toBe(false);
  });
  it('coalesces refresh and bounds attempts without trusting event contents', async () => {
    let resolve!: () => void;
    const refresh = jest.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    const guard = createOxygenStatusRefresher(refresh, 2);
    const first = guard.refresh();
    await guard.refresh();
    expect(refresh).toHaveBeenCalledTimes(1);
    resolve();
    await first;
    const second = guard.refresh();
    resolve();
    await second;
    await guard.refresh();
    expect(refresh).toHaveBeenCalledTimes(2);
    guard.stop();
    await guard.refresh();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it('stops automatic reads after a server rejection including rate limiting', async () => {
    const refresh = jest.fn(async () => {
      throw new Error('rate limited');
    });
    const guard = createOxygenStatusRefresher(refresh);
    await expect(guard.refresh()).rejects.toThrow('rate limited');
    await guard.refresh();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
