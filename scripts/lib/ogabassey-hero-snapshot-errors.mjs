// Error type for the hero snapshot pipeline. Thrown for every controlled
// failure (bad args, fetch/encode problems, manifest issues); the CLI
// wrapper prints the message and exits nonzero.

export class HeroSnapshotError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HeroSnapshotError';
  }
}
