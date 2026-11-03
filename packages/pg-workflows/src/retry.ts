// retryDelay is the base for pg-boss's exponential backoff:
// `retryDelay * 2^retryCount` seconds (with up to ±50% jitter), so a base
// of 1 second yields ~1s, ~2s, ~4s, ~8s, … between attempts.
export const retrySendOptions = (maxRetries: number) => ({
  retryLimit: maxRetries,
  retryBackoff: true,
  retryDelay: 1,
})
