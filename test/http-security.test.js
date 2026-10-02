'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const { TOTP, Secret } = require('otpauth')

// This test uses the actual Express routes over HTTP with a mock pg.Pool.query.
// No production database, credentials, or production port are required.
process.env.JWT_SECRET = 'local-test-only-secret-not-for-deployment'
const { app, pool } = require('../index')
const { PUBLIC_SETTINGS_KEYS } = require('../security/access')

const EMAIL = 'test-user@example.invalid'
const JWT_SECRET = process.env.JWT_SECRET
const makeToken = (claims) => jwt.sign(claims, JWT_SECRET, { expiresIn: '5m' })
const authUser = (role = 'admin', version = 2) => ({
  id: 7, email: EMAIL, role, token_version: version,
  two_factor_enabled: true, name: 'Test', nickname: 'Test',
})

test('HTTP authorization and settings integration (mock database)', async (t) => {
  const originalQuery = pool.query
  let handler = async () => { throw new Error('Unexpected database access') }
  pool.query = (...args) => handler(...args)

  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve, reject) => {
      if (server.listening) return resolve()
      server.once('listening', resolve)
      server.once('error', reject)
    })
    const base = `http://127.0.0.1:${server.address().port}`
    const request = async (path, options = {}) => {
      const response = await fetch(base + path, {
        method: options.method || 'GET',
        headers: {
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      })
      return { status: response.status, data: await response.json() }
    }

    await t.test('temporary 2FA JWT cannot call a protected HTTP route', async () => {
      handler = async () => { throw new Error('No DB query expected for temporary JWT') }
      const temp = makeToken({ id: 7, email: EMAIL, temp: true, tokenVersion: 2 })
      const response = await request('/api/auth/me', { token: temp })
      assert.equal(response.status, 403)
    })

    await t.test('old token version is rejected before route execution', async () => {
      handler = async (sql) => {
        assert.match(sql, /FROM users WHERE id/)
        return { rows: [authUser('admin', 3)] }
      }
      const full = makeToken({ id: 7, email: EMAIL, role: 'admin', tokenVersion: 2 })
      const response = await request('/api/auth/me', { token: full })
      assert.equal(response.status, 401)
    })

    await t.test('viewer cannot change site settings', async () => {
      let queries = 0
      handler = async (sql) => {
        queries++
        assert.match(sql, /FROM users WHERE id/)
        return { rows: [authUser('viewer')] }
      }
      const full = makeToken({ id: 7, email: EMAIL, role: 'viewer', tokenVersion: 2 })
      const response = await request('/api/settings', {
        method: 'PUT', token: full, body: { site_name: 'Unauthorized change' },
      })
      assert.equal(response.status, 403)
      assert.equal(queries, 1, 'no settings write query should be reached')
    })

    await t.test('admin can update site settings', async () => {
      const writes = []
      handler = async (sql, params) => {
        if (/FROM users WHERE id/.test(sql)) return { rows: [authUser('admin')] }
        if (/INSERT INTO settings/.test(sql)) {
          writes.push(params)
          return { rows: [] }
        }
        if (/SELECT \* FROM settings ORDER BY key/.test(sql)) {
          return { rows: [{ key: 'site_name', value: 'Updated' }] }
        }
        throw new Error('Unexpected SQL query')
      }
      const full = makeToken({ id: 7, email: EMAIL, role: 'admin', tokenVersion: 2 })
      const response = await request('/api/settings', {
        method: 'PUT', token: full, body: { site_name: 'Updated' },
      })
      assert.equal(response.status, 200)
      assert.deepEqual(writes, [['site_name', 'Updated']])
    })

    await t.test('anonymous public settings SQL uses an allowlist', async () => {
      handler = async (sql, params) => {
        assert.match(sql, /WHERE key = ANY\(\$1::text\[\]\)/)
        assert.deepEqual(params[0], PUBLIC_SETTINGS_KEYS)
        assert.equal(params[0].includes('jwt_secret'), false)
        return { rows: [{ key: 'site_name', value: 'Growth Spot' }] }
      }
      const response = await request('/api/settings/public')
      assert.equal(response.status, 200)
      assert.deepEqual(response.data, { site_name: 'Growth Spot' })
    })

    await t.test('enabling 2FA cannot replace an existing TOTP secret', async () => {
      const secret = 'JBSWY3DPEHPK3PXP'
      const code = new TOTP({
        issuer: 'Точка Роста', algorithm: 'SHA1', digits: 6, period: 30,
        secret: Secret.fromBase32(secret),
      }).generate()
      let attemptedUpdate = false
      handler = async (sql, params) => {
        if (/FROM users WHERE id/.test(sql)) return { rows: [authUser('admin')] }
        if (/UPDATE users SET totp_secret/.test(sql)) {
          attemptedUpdate = true
          assert.match(sql, /two_factor_enabled = FALSE RETURNING id/)
          assert.equal(params[0], secret)
          return { rows: [] } // Existing 2FA was already enabled.
        }
        throw new Error('Unexpected SQL query')
      }
      const full = makeToken({ id: 7, email: EMAIL, role: 'admin', tokenVersion: 2 })
      const response = await request('/api/auth/enable-2fa', {
        method: 'POST', token: full, body: { secret, code },
      })
      assert.equal(response.status, 409)
      assert.equal(attemptedUpdate, true)
    })

    await t.test('inconsistent 2FA state never issues a full login token', async () => {
      const password = 'local-test-password'
      const user = {
        ...authUser('admin'),
        password: await bcrypt.hash(password, 4),
        totp_secret: null,
      }
      handler = async (sql) => {
        assert.match(sql, /FROM users WHERE email/)
        return { rows: [user] }
      }
      const response = await request('/api/auth/login', {
        method: 'POST', body: { email: EMAIL, password },
      })
      assert.equal(response.status, 403)
      assert.equal(response.data.token, undefined)
    })

    await t.test('password login -> temporary JWT -> TOTP -> full JWT', async () => {
      const password = 'local-test-password'
      const totpSecret = 'JBSWY3DPEHPK3PXP'
      const user = {
        ...authUser('admin'),
        password: await bcrypt.hash(password, 4),
        totp_secret: totpSecret,
      }
      handler = async (sql) => {
        if (/FROM users WHERE email/.test(sql)) return { rows: [user] }
        if (/FROM users WHERE id/.test(sql)) return { rows: [user] }
        throw new Error('Unexpected SQL query in login')
      }

      const login = await request('/api/auth/login', {
        method: 'POST', body: { email: EMAIL, password },
      })
      assert.equal(login.status, 200)
      assert.equal(login.data.require2FA, true)
      assert.equal(jwt.verify(login.data.tempToken, JWT_SECRET).temp, true)

      const forbidden = await request('/api/auth/me', { token: login.data.tempToken })
      assert.equal(forbidden.status, 403)

      const totp = new TOTP({
        issuer: 'Точка Роста', algorithm: 'SHA1', digits: 6, period: 30,
        secret: Secret.fromBase32(totpSecret),
      })
      const verified = await request('/api/auth/verify-2fa', {
        method: 'POST', body: { code: totp.generate(), tempToken: login.data.tempToken },
      })
      assert.equal(verified.status, 200)
      assert.equal(jwt.verify(verified.data.token, JWT_SECRET).role, 'admin')
      const me = await request('/api/auth/me', { token: verified.data.token })
      assert.equal(me.status, 200)

      const staleTemp = makeToken({
        id: user.id, email: EMAIL, temp: true, tokenVersion: 1,
      })
      const stale = await request('/api/auth/verify-2fa', {
        method: 'POST', body: { code: totp.generate(), tempToken: staleTemp },
      })
      assert.equal(stale.status, 401)
    })
  } finally {
    pool.query = originalQuery
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
    await pool.end()
  }
})
