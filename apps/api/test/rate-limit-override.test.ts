import { describe, expect, it } from 'vitest'
import { parseRateRuleOverride } from '../src/lib/rate-limit-rules'

const fallback = { bucket: 'auth-strict', limit: 10, windowMs: 600_000 }

describe('parseRateRuleOverride', () => {
  it('keeps the fallback when the override is absent or blank', () => {
    expect(parseRateRuleOverride(undefined, fallback)).toEqual(fallback)
    expect(parseRateRuleOverride('', fallback)).toEqual(fallback)
    expect(parseRateRuleOverride('   ', fallback)).toEqual(fallback)
  })

  it('parses "limit/windowSeconds"', () => {
    expect(parseRateRuleOverride('50/600', fallback)).toEqual({
      bucket: 'auth-strict',
      limit: 50,
      windowMs: 600_000,
    })
    expect(parseRateRuleOverride('5/60', fallback).windowMs).toBe(60_000)
  })

  it('throws on malformed overrides instead of quietly disabling the limit', () => {
    for (const bad of ['abc', '10', '/', '0/60', '-3/60', '10/0', '10/60/3']) {
      expect(() => parseRateRuleOverride(bad, fallback)).toThrow(/Invalid rate limit override/)
    }
  })
})
