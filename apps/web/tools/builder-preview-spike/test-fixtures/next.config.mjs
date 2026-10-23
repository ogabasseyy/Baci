export default {
  cacheComponents: true,
  agentRules: false,
  cacheLife: { merchant: { stale: 30, revalidate: 60, expire: 3600 } },
};
