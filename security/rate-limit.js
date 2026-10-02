'use strict'

// In-memory fixed-window limiter for a single-process deployment.
// All attempts count (successful and unsuccessful), without recording tokens or email.
const createRateLimiter = ({
  limit,
  windowMs,
  maxClients = 10000,
  clock = Date.now,
}) => {
  if (!Number.isSafeInteger(limit) || limit < 1 ||
      !Number.isSafeInteger(windowMs) || windowMs < 1000) {
    throw new TypeError('Invalid rate limiter configuration')
  }

  const clients = new Map()
  let requests = 0

  const clearExpired = (time) => {
    for (const [key, entry] of clients) {
      if (entry.resetAt <= time) clients.delete(key)
    }
  }

  return (req, res, next) => {
    const time = clock()
    if (++requests % 128 === 0) clearExpired(time)

    // req.ip follows Express trust proxy configuration; do not trust raw XFF.
    const key = String(req.ip || req.socket?.remoteAddress || 'unknown')
    let entry = clients.get(key)
    if (entry && entry.resetAt <= time) {
      clients.delete(key)
      entry = undefined
    }

    if (!entry) {
      if (clients.size >= maxClients) {
        clearExpired(time)
        if (clients.size >= maxClients) {
          res.set('Retry-After', String(Math.ceil(windowMs / 1000)))
          return res.status(429).json({ error: 'Слишком много попыток. Повторите позже' })
        }
      }
      entry = { attempts: 0, resetAt: time + windowMs }
      clients.set(key, entry)
    }

    if (entry.attempts >= limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - time) / 1000))))
      return res.status(429).json({ error: 'Слишком много попыток. Повторите позже' })
    }

    entry.attempts += 1
    next()
  }
}

module.exports = { createRateLimiter }
