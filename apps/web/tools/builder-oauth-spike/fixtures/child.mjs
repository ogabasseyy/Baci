if (process.argv[2] === 'ready') {
  process.send({ ready: true });
  setInterval(() => {
    /* Keep the owned child alive until shutdown. */
  }, 1000);
} else process.exit(0);
