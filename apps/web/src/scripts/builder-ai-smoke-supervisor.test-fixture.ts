import { writeFile } from 'node:fs/promises';

process.on('message', () => {
  process.send?.({ kind: 'started' });
  const markerPath = process.argv[2];
  if (markerPath) {
    setTimeout(() => {
      void writeFile(markerPath, 'worker survived');
    }, 100);
  }
  setInterval(() => undefined, 1_000);
});
