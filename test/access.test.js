'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { PUBLIC_SETTINGS_KEYS, isFullAccessToken, canEditSettings } = require('../security/access')

test('temporary 2FA JWT cannot access protected endpoints', () => {
  assert.equal(isFullAccessToken({ id: 1, temp: true, tokenVersion: 1 }), false)
  assert.equal(isFullAccessToken({ id: 1, temp: true, role: 'admin', tokenVersion: 1 }), false)
})

test('complete access token requires role and numeric token version', () => {
  assert.equal(isFullAccessToken({ id: 1, role: 'admin', tokenVersion: 1 }), true)
  assert.equal(isFullAccessToken({ id: 1, role: 'viewer', tokenVersion: 0 }), true)
  assert.equal(isFullAccessToken({ id: 1, role: 'admin' }), false)
  assert.equal(isFullAccessToken({ id: 1, tokenVersion: 1 }), false)
  assert.equal(isFullAccessToken(null), false)
  assert.equal(isFullAccessToken('malformed'), false)
})

test('only admins can update site settings', () => {
  assert.equal(canEditSettings({ role: 'admin' }), true)
  for (const role of ['moderator', 'manager', 'viewer', null]) {
    assert.equal(canEditSettings({ role }), false)
  }
  assert.equal(canEditSettings(null), false)
})

test('anonymous settings use an explicit allowlist', () => {
  assert.equal(new Set(PUBLIC_SETTINGS_KEYS).size, PUBLIC_SETTINGS_KEYS.length)
  for (const key of ['hero_title', 'site_email', 'response_time']) {
    assert.equal(PUBLIC_SETTINGS_KEYS.includes(key), true)
  }
  for (const key of ['jwt_secret', 'db_password', 'smtp_password', 'admin_token']) {
    assert.equal(PUBLIC_SETTINGS_KEYS.includes(key), false)
  }
})
