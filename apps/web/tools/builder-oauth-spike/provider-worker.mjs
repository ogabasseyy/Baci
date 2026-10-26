/** Second independent provider process sharing only the disposable SQLite adapter. */
import { startFixture } from './fixture-server.mjs';

const fixture = await startFixture(JSON.parse(process.argv[2]));
process.send({ origin: fixture.origin });
process.on('message', async (message) => {
  if (message === 'stop') {
    await fixture.close();
    process.exit(0);
  }
});
