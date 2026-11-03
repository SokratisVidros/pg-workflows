import { describe, expect, it } from 'vitest'
import { defaultExpireInSeconds, resolveJobSendOptions, resolveMaxRetries } from './job-options'

describe('resolveMaxRetries', () => {
  it('prefers retryLimit, then retries, then fallback', () => {
    expect(resolveMaxRetries({ retryLimit: 4, retries: 9 }, 1)).toBe(4)
    expect(resolveMaxRetries({ retries: 9 }, 1)).toBe(9)
    expect(resolveMaxRetries({}, 1)).toBe(1)
    expect(resolveMaxRetries()).toBe(0)
  })
})

describe('resolveJobSendOptions', () => {
  it('applies library defaults', () => {
    expect(resolveJobSendOptions(2)).toEqual({
      expireInSeconds: defaultExpireInSeconds,
      retryLimit: 2,
      retryBackoff: true,
      retryDelay: 1,
    })
  })

  it('forwards optional retention and heartbeat overrides', () => {
    expect(
      resolveJobSendOptions(0, {
        retentionSeconds: 100,
        deleteAfterSeconds: 50,
        heartbeatSeconds: 15,
        retryDelayMax: 30,
      }),
    ).toMatchObject({
      retentionSeconds: 100,
      deleteAfterSeconds: 50,
      heartbeatSeconds: 15,
      retryDelayMax: 30,
    })
  })
})
