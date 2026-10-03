'use strict'

// Site content consumed by the public frontend. Never publish arbitrary DB settings.
const PUBLIC_SETTINGS_KEYS = Object.freeze([
  'site_name', 'site_description', 'site_phone', 'site_email',
  'site_telegram', 'site_whatsapp', 'site_vk', 'site_work_hours',
  'phone_raw', 'telegram_url', 'telegram_label', 'whatsapp_url',
  'whatsapp_number', 'vk_url', 'vk_label', 'work_hours',
  'response_time', 'hero_title', 'hero_subtitle', 'hero_description',
  'yandex_metrika_id', 'google_analytics_id',
  'yandex_verification', 'google_verification',
])

// A password-only temporary JWT intentionally has no role.
// Normal API access requires a full post-authentication JWT and token version.
const isFullAccessToken = (claims) => Boolean(
  claims &&
  typeof claims === 'object' &&
  !claims.temp &&
  typeof claims.role === 'string' &&
  claims.role.length > 0 &&
  Number.isSafeInteger(claims.tokenVersion)
)

const canEditSettings = (user) => user?.role === 'admin'

module.exports = { PUBLIC_SETTINGS_KEYS, isFullAccessToken, canEditSettings }
