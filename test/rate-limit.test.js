'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createRateLimiter } = require('../security/rate-limit')

const invoke = (limiter, ip) => {
  let status = 200
  let headers = {}
  let allowed = false
  const res = {
    set(key, value) { headers[key] = value; return this },
    status(value) { status = value; return this },
    json(body) { return body },
  }
  limiter({ ip }, res, () => { allowed = true })
  return { status, headers, allowed }
}

test('rate limiter rejects request after limit and includes Retry-After', () => {
  let now = 0
  const limiter = createRateLimiter({ limit: 2, windowMs: 60000, clock: () => now })
  assert.equal(invoke(limiter, '192.0.2.1').allowed, true)
  assert.equal(invoke(limiter, '192.0.2.1').allowed, true)
  const blocked = invoke(limiter, '192.0.2.1')
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.status, 429)
  assert.equal(blocked.headers['Retry-After'], '60')
  now = 60001
  assert.equal(invoke(limiter, '192.0.2.1').allowed, true)
})

test('rate limit counters are isolated by client address', () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60000 })
  assert.equal(invoke(limiter, '192.0.2.1').allowed, true)
  assert.equal(invoke(limiter, '192.0.2.1').status, 429)
  assert.equal(invoke(limiter, '192.0.2.2').allowed, true)
})

test('limiter bounds memory and fails closed when client capacity is reached', () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60000, maxClients: 1 })
  assert.equal(invoke(limiter, '192.0.2.1').allowed, true)
  assert.equal(invoke(limiter, '192.0.2.2').status, 429)
})
