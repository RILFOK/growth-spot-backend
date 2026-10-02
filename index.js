const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const { isFullAccessToken, canEditSettings, PUBLIC_SETTINGS_KEYS } = require('./security/access')
require('dotenv').config({ quiet: true })

const app = express()
app.set('trust proxy', 1)
app.use(cors())
app.use(express.json())

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

// ========================================
// Валидация заявок
// ========================================
const PROFANITY_PATTERNS = [
  /х(?:у|y|\*)[йиеёяю]/iu,
  /п(?:и|\*)з(?:д|\*)/iu,
  /б(?:л|\*)я/iu,
  /с(?:у|\*)к(?:а|и|о|y)/iu,
  /e?б(?:а|л|н|\*)/iu,
  /муд[ао]к/iu,
  /гандон/iu,
  /долбо[её]б/iu,
  /уеб/iu,
  /наху/iu,
  /поху/iu,
]

const GARBAGE_PATTERNS = [
  /(.)\1{4,}/u,
  /[!@#$%^&*_=+\[\]{};:\\|<>/~`]{4,}/u,
  /(https?:\/\/|www\.)/iu,
]

const BLOCKED_LEAD_NAMES = new Set([
  'тест',
  'тест тест',
  'admin',
  'админ',
  'administrator',
  'менеджер',
  'нет',
  'неважно',
  'аноним',
  'имя',
  'клиент',
  'заказчик',
  'xxx',
  'хз',
])

const normalizeSpaces = (value = '') =>
  String(value).replace(/\s+/g, ' ').trim()

const normalizeLeadName = (value = '') =>
  normalizeSpaces(value)
    .replace(/[^А-Яа-яЁё\s-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/\s{2,}/g, ' ')
    .trim()

const normalizeLeadPhone = (value = '') => {
  const digits = String(value).replace(/\D/g, '')

  if (!digits) return ''

  let normalized = digits

  if (normalized.startsWith('8') && normalized.length === 11) {
    normalized = '7' + normalized.slice(1)
  }

  if (normalized.startsWith('9') && normalized.length === 10) {
    normalized = '7' + normalized
  }

  if (normalized.startsWith('7') && normalized.length === 11) {
    return `+${normalized}`
  }

  return ''
}

const containsProfanity = (value = '') => {
  const text = normalizeSpaces(value).toLowerCase().replace(/\s+/g, '')
  return PROFANITY_PATTERNS.some((pattern) => pattern.test(text))
}

const containsGarbage = (value = '') => {
  const text = normalizeSpaces(value)
  if (!text) return false
  return GARBAGE_PATTERNS.some((pattern) => pattern.test(text))
}

const looksLikeMeaninglessText = (value = '') => {
  const text = normalizeSpaces(value).toLowerCase()
  if (!text) return false

  const lettersOnly = text.replace(/[^а-яё]/gi, '')
  if (lettersOnly.length < 5) return false

  const uniqueChars = new Set(lettersOnly).size
  if (uniqueChars <= 3 && lettersOnly.length >= 8) return true

  const vowels = (lettersOnly.match(/[аеёиоуыэюя]/g) || []).length
  const consonants = lettersOnly.length - vowels

  if (vowels === 0 || consonants === 0) return true

  return false
}

const validateLeadName = (value = '') => {
  const name = normalizeSpaces(value)
  const normalizedName = name.toLowerCase()

  if (!name) return 'Имя обязательно'
  if (name.length < 2) return 'Имя должно быть не короче 2 символов'
  if (name.length > 40) return 'Имя должно быть не длиннее 40 символов'
  if (/[A-Za-z]/.test(name)) return 'Имя должно быть только на русском'
  if (/\d/.test(name)) return 'Имя не должно содержать цифры'
  if (!/^[А-Яа-яЁё\s-]+$/.test(name)) return 'Используйте только русские буквы, пробел и дефис'
  if (!/[А-Яа-яЁё]{2,}/.test(name)) return 'Введите корректное имя'
  if (/--|\s{2,}|^-|-$/.test(name)) return 'Введите корректное имя'
  if (containsProfanity(name)) return 'Пожалуйста, укажите корректное имя'
  if (containsGarbage(name)) return 'Пожалуйста, укажите корректное имя'
  if (looksLikeMeaninglessText(name)) return 'Пожалуйста, укажите корректное имя'
  if (BLOCKED_LEAD_NAMES.has(normalizedName)) return 'Пожалуйста, укажите корректное имя'

  return null
}

const validateLeadPhone = (value = '') => {
  const normalized = normalizeLeadPhone(value)
  if (!normalized) return 'Введите корректный номер телефона'
  if (!/^\+7\d{10}$/.test(normalized)) return 'Введите корректный номер телефона'
  return null
}

const validateLeadMessage = (value = '') => {
  const text = normalizeSpaces(value)

  if (!text) return null
  if (text.length < 5) return 'Опишите задачу чуть подробнее'
  if (text.length > 1000) return 'Сообщение слишком длинное'
  if (containsProfanity(text)) return 'Пожалуйста, без нецензурных выражений'
  if (containsGarbage(text)) return 'Сообщение содержит некорректные символы или мусор'
  if (looksLikeMeaninglessText(text)) return 'Сообщение выглядит некорректно. Опишите задачу понятнее'

  return null
}

// ========================================
// Middleware авторизации
// ========================================
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // A temporary 2FA JWT must never authorize normal API requests.
    if (!isFullAccessToken(decoded)) {
      return res.status(403).json({ error: 'Требуется завершить вход' })
    }

    const result = await pool.query(
      'SELECT id, email, role, name, nickname, two_factor_enabled, token_version FROM users WHERE id = $1',
      [decoded.id]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Пользователь не найден' })
    }

    const dbUser = result.rows[0]

    if (decoded.tokenVersion !== dbUser.token_version) {
      return res.status(401).json({ error: 'Сессия устарела. Войдите снова.' })
    }

    if (decoded.role !== dbUser.role) {
      return res.status(401).json({ error: 'Роль пользователя изменилась. Войдите снова.' })
    }

    req.user = {
      id: dbUser.id,
      email: dbUser.email,
      role: dbUser.role,
      name: dbUser.name,
      nickname: dbUser.nickname,
      twoFactorEnabled: dbUser.two_factor_enabled,
      tokenVersion: dbUser.token_version,
      temp: false,
    }

    next()
  } catch (err) {
    return res.status(403).json({ error: 'Недействительный токен' })
  }
}

// ========================================
// Health check
// ========================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

// ========================================
// Авторизация — Шаг 1: email + пароль
// ========================================
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password)
    return res.status(400).json({ error: 'Email и пароль обязательны' })

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email])
    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Неверный email или пароль' })

    const user = result.rows[0]
    const isValid = await bcrypt.compare(password, user.password)
    if (!isValid)
      return res.status(401).json({ error: 'Неверный email или пароль' })

    // Если 2FA включена — возвращаем временный токен
    if (user.two_factor_enabled && user.totp_secret) {
      const tempToken = jwt.sign(
        { id: user.id, email: user.email, temp: true, tokenVersion: user.token_version },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
      )
      return res.json({
        require2FA: true,
        tempToken,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          name: user.name,
          nickname: user.nickname
        }
      })
    }

    // 2FA не нужна — выдаём полный токен
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, tokenVersion: user.token_version },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    )

    res.json({
      require2FA: false,
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        nickname: user.nickname,
        twoFactorEnabled: user.two_factor_enabled
      }
    })
  } catch (err) {
    console.error('Login error:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ========================================
// Авторизация — Шаг 2: верификация 2FA
// ========================================
app.post('/api/auth/verify-2fa', async (req, res) => {
  const { code, tempToken } = req.body
  if (!code || !tempToken)
    return res.status(400).json({ error: 'Код и токен обязательны' })

  try {
    // Проверяем временный токен
    let decoded
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET)
    } catch {
      return res.status(401).json({ error: 'Токен истёк, войдите снова' })
    }

    if (!decoded.temp || !Number.isSafeInteger(decoded.tokenVersion) || decoded.role) {
      return res.status(400).json({ error: 'Некорректный токен' })
    }

    // Получаем пользователя и его secret
    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [decoded.id]
    )
    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Пользователь не найден' })

    const user = result.rows[0]

    // A temporary login becomes invalid after a session reset or when 2FA is disabled.
    if (
      decoded.tokenVersion !== user.token_version ||
      !user.two_factor_enabled ||
      !user.totp_secret
    ) {
      return res.status(401).json({ error: 'Сессия входа устарела. Войдите снова' })
    }

    // Верифицируем TOTP код
    const { TOTP, Secret } = require('otpauth')
    const totp = new TOTP({
      issuer: 'Точка Роста',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(user.totp_secret.replace(/\s/g, '').toUpperCase()),
    })
    const delta = totp.validate({ token: code.replace(/\s/g, ''), window: 1 })

    if (delta === null)
      return res.status(401).json({ error: 'Неверный код. Попробуйте ещё раз.' })

    // Выдаём полный токен
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, tokenVersion: user.token_version },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    )

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        nickname: user.nickname,
        twoFactorEnabled: user.two_factor_enabled
      }
    })
  } catch (err) {
    console.error('Verify 2FA error:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ========================================
// Включение 2FA — сохраняем secret в БД
// ========================================
app.post('/api/auth/enable-2fa', authenticateToken, async (req, res) => {
  const { secret, code } = req.body
  if (!secret || !code)
    return res.status(400).json({ error: 'Secret и код обязательны' })

  try {
    // Верифицируем код перед сохранением
    const { TOTP, Secret } = require('otpauth')
    const totp = new TOTP({
      issuer: 'Точка Роста',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret.replace(/\s/g, '').toUpperCase()),
    })
    const delta = totp.validate({ token: code.replace(/\s/g, ''), window: 1 })

    if (delta === null)
      return res.status(401).json({ error: 'Неверный код подтверждения' })

    // Сохраняем secret и включаем 2FA
    await pool.query(
      'UPDATE users SET totp_secret = $1, two_factor_enabled = TRUE WHERE id = $2',
      [secret, req.user.id]
    )

    res.json({ success: true, message: '2FA успешно включена' })
  } catch (err) {
    console.error('Enable 2FA error:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ========================================
// Отключение 2FA
// ========================================
app.post('/api/auth/disable-2fa', authenticateToken, async (req, res) => {
  const { code } = req.body
  if (!code)
    return res.status(400).json({ error: 'Код обязателен' })

  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id])
    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Пользователь не найден' })

    const user = result.rows[0]
    if (!user.totp_secret)
      return res.status(400).json({ error: '2FA не включена' })

    // Верифицируем код
    const { TOTP, Secret } = require('otpauth')
    const totp = new TOTP({
      issuer: 'Точка Роста',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(user.totp_secret.replace(/\s/g, '').toUpperCase()),
    })
    const delta = totp.validate({ token: code.replace(/\s/g, ''), window: 1 })

    if (delta === null)
      return res.status(401).json({ error: 'Неверный код подтверждения' })

    // Отключаем 2FA
    await pool.query(
      'UPDATE users SET totp_secret = NULL, two_factor_enabled = FALSE WHERE id = $1',
      [req.user.id]
    )

    res.json({ success: true, message: '2FA отключена' })
  } catch (err) {
    console.error('Disable 2FA error:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ========================================
// GET /api/auth/me
// ========================================
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, role, name, nickname, two_factor_enabled FROM users WHERE id = $1',
      [req.user.id]
    )
    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Пользователь не найден' })

    const user = result.rows[0]
    res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      nickname: user.nickname,
      twoFactorEnabled: user.two_factor_enabled
    })
  } catch (err) {
    console.error('Auth me error:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ========================================
// Заявки (Leads)
// ========================================
app.post('/api/leads', async (req, res) => {
  const rawName = req.body?.name ?? ''
  const rawPhone = req.body?.phone ?? ''
  const rawMessage = req.body?.message ?? ''

  const name = normalizeLeadName(rawName)
  const phone = normalizeLeadPhone(rawPhone)
  const message = normalizeSpaces(rawMessage)
  const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null

  const nameError = validateLeadName(name)
  if (nameError) {
    return res.status(400).json({ message: nameError })
  }

  const phoneError = validateLeadPhone(phone)
  if (phoneError) {
    return res.status(400).json({ message: phoneError })
  }

  const messageError = validateLeadMessage(message)
  if (messageError) {
    return res.status(400).json({ message: messageError })
  }

  try {
    const whitelistedIp = await pool.query(
      `SELECT id, ip_address
       FROM ip_whitelist
       WHERE ip_address = $1 AND active = TRUE
       LIMIT 1`,
      [ipAddress]
    )

    const isWhitelisted = whitelistedIp.rows.length > 0

    const blockedIp = await pool.query(
      `SELECT id, ip_address
       FROM blocked_ips
       WHERE ip_address = $1 AND active = TRUE
       LIMIT 1`,
      [ipAddress]
    )

    if (!isWhitelisted && blockedIp.rows.length > 0) {
      return res.status(429).json({
        spam: true,
        blocked: true,
        ip: ipAddress,
        message: `Отправка заявок с IP ${ipAddress} заблокирована из-за подозрительной активности.`
      })
    }

    const duplicatePhone = await pool.query(
      `SELECT id, status
       FROM leads
       WHERE phone = $1
         AND status IN ('new', 'in_progress')
       ORDER BY created_at DESC
       LIMIT 1`,
      [phone]
    )

    if (duplicatePhone.rows.length > 0) {
      return res.status(400).json({
        message: 'Заявка с этим номером уже существует и находится в работе.'
      })
    }

    const activeByIp = await pool.query(
      `SELECT id, status
       FROM leads
       WHERE ip_address = $1
         AND status IN ('new', 'in_progress')
       ORDER BY created_at ASC`,
      [ipAddress]
    )

    if (!isWhitelisted && activeByIp.rows.length >= 3) {
      await pool.query(
        `INSERT INTO blocked_ips (ip_address, reason, active, created_at, updated_at)
         VALUES ($1, 'ip_limit_reached', TRUE, NOW(), NOW())
         ON CONFLICT (ip_address)
         DO UPDATE SET
           reason = EXCLUDED.reason,
           active = TRUE,
           updated_at = NOW()`,
        [ipAddress]
      )

      await pool.query(
        `UPDATE leads
         SET is_spam = TRUE,
             spam_reason = 'ip_limit_reached'
         WHERE ip_address = $1
           AND status = 'new'`,
        [ipAddress]
      )

      return res.status(429).json({
        spam: true,
        blocked: true,
        ip: ipAddress,
        message: `Отправка заявок с IP ${ipAddress} заблокирована из-за подозрительной активности.`
      })
    }

    const result = await pool.query(
      `INSERT INTO leads (name, phone, message, ip_address, is_spam, spam_reason)
       VALUES ($1, $2, $3, $4, FALSE, NULL)
       RETURNING *`,
      [name, phone, message || null, ipAddress]
    )

    let lead = result.rows[0]

    if (!isWhitelisted && activeByIp.rows.length + 1 >= 3) {
      await pool.query(
        `INSERT INTO blocked_ips (ip_address, reason, active, created_at, updated_at)
         VALUES ($1, 'ip_limit_reached', TRUE, NOW(), NOW())
         ON CONFLICT (ip_address)
         DO UPDATE SET
           reason = EXCLUDED.reason,
           active = TRUE,
           updated_at = NOW()`,
        [ipAddress]
      )

      await pool.query(
        `UPDATE leads
         SET is_spam = TRUE,
             spam_reason = 'ip_limit_reached'
         WHERE ip_address = $1
           AND status = 'new'`,
        [ipAddress]
      )

      const refreshed = await pool.query(
        'SELECT * FROM leads WHERE id = $1',
        [lead.id]
      )

      lead = refreshed.rows[0] || lead

      return res.status(201).json({
        ...lead,
        spam: true,
        blocked: true,
        ip: ipAddress,
        message: `Обнаружена подозрительная активность. IP ${ipAddress} заблокирован, новые заявки помечены как спам.`
      })
    }

    res.status(201).json(lead)
  } catch (err) {
    console.error('Error saving lead:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

app.get('/api/leads', authenticateToken, async (req, res) => {
  try {
    if (!['admin', 'moderator', 'manager', 'viewer'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' })
    }

    const result = await pool.query('SELECT * FROM leads ORDER BY created_at DESC')
    res.json(result.rows)
  } catch (err) {
    console.error('Error fetching leads:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

app.patch('/api/leads/:id', authenticateToken, async (req, res) => {
  const { id } = req.params
  const { status } = req.body
  const validStatuses = ['new', 'in_progress', 'completed']
  if (!status || !validStatuses.includes(status))
    return res.status(400).json({ error: 'Недопустимый статус' })

  try {
    if (!['admin', 'moderator', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' })
    }

    const result = await pool.query(
      'UPDATE leads SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    )
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Заявка не найдена' })
    res.json(result.rows[0])
  } catch (err) {
    console.error('Error updating lead:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

app.delete('/api/leads/:id', authenticateToken, async (req, res) => {
  const { id } = req.params
  try {
    if (!['admin', 'moderator'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' })
    }

    const result = await pool.query('DELETE FROM leads WHERE id = $1 RETURNING *', [id])
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Заявка не найдена' })
    res.json({ success: true })
  } catch (err) {
    console.error('Error deleting lead:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

app.get('/api/blocked-ips', authenticateToken, async (req, res) => {
  try {
    if (!['admin', 'moderator'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' })
    }

    const result = await pool.query(
      `SELECT *
       FROM blocked_ips
       WHERE active = TRUE
       ORDER BY updated_at DESC, created_at DESC`
    )

    res.json(result.rows)
  } catch (err) {
    console.error('Error fetching blocked IPs:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

app.post('/api/blocked-ips/:id/unblock', authenticateToken, async (req, res) => {
  const { id } = req.params

  try {
    if (!['admin', 'moderator'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' })
    }

    const blockedResult = await pool.query(
      `SELECT * FROM blocked_ips WHERE id = $1 LIMIT 1`,
      [id]
    )

    if (blockedResult.rows.length === 0) {
      return res.status(404).json({ error: 'IP не найден' })
    }

    const blockedIp = blockedResult.rows[0]

    await pool.query(
      `UPDATE blocked_ips
       SET active = FALSE,
           updated_at = NOW()
       WHERE id = $1`,
      [id]
    )

    const deletedSpamLeads = await pool.query(
      `DELETE FROM leads
       WHERE ip_address = $1
         AND is_spam = TRUE
         AND status = 'new'
       RETURNING id`,
      [blockedIp.ip_address]
    )

    res.json({
      success: true,
      ip: blockedIp.ip_address,
      deletedSpamLeads: deletedSpamLeads.rowCount,
      message: 'IP разблокирован, спам-заявки удалены'
    })
  } catch (err) {
    console.error('Error unblocking IP:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})


app.get('/api/ip-info', authenticateToken, async (req, res) => {
  try {
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null
    const whitelistResult = await pool.query(
      `SELECT id, ip_address, comment, active, created_at, updated_at
       FROM ip_whitelist
       WHERE ip_address = $1 AND active = TRUE
       LIMIT 1`,
      [ipAddress]
    )

    res.json({
      ip: ipAddress,
      whitelisted: whitelistResult.rows.length > 0,
      whitelistEntry: whitelistResult.rows[0] || null,
    })
  } catch (err) {
    console.error('Error fetching IP info:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

app.get('/api/ip-whitelist', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Недостаточно прав' })
    }

    const result = await pool.query(
      `SELECT *
       FROM ip_whitelist
       ORDER BY active DESC, updated_at DESC, created_at DESC`
    )

    res.json(result.rows)
  } catch (err) {
    console.error('Error fetching IP whitelist:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

app.post('/api/ip-whitelist', authenticateToken, async (req, res) => {
  const { ip_address, comment = null } = req.body

  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Недостаточно прав' })
    }

    if (!ip_address || typeof ip_address !== 'string') {
      return res.status(400).json({ error: 'IP адрес обязателен' })
    }

    const ip = ip_address.trim()

    await pool.query(
      `INSERT INTO ip_whitelist (ip_address, comment, active, created_at, updated_at)
       VALUES ($1, $2, TRUE, NOW(), NOW())
       ON CONFLICT (ip_address)
       DO UPDATE SET
         comment = EXCLUDED.comment,
         active = TRUE,
         updated_at = NOW()`,
      [ip, comment]
    )

    const result = await pool.query(
      `SELECT *
       FROM ip_whitelist
       WHERE ip_address = $1
       LIMIT 1`,
      [ip]
    )

    res.json(result.rows[0])
  } catch (err) {
    console.error('Error upserting IP whitelist:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

app.post('/api/ip-whitelist/:id/disable', authenticateToken, async (req, res) => {
  const { id } = req.params

  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Недостаточно прав' })
    }

    const result = await pool.query(
      `DELETE FROM ip_whitelist
       WHERE id = $1
       RETURNING *`,
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'IP не найден' })
    }

    res.json({
      success: true,
      entry: result.rows[0],
    })
  } catch (err) {
    console.error('Error deleting IP whitelist entry:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ========================================
// Пользователи (Users API)
// ========================================

// Проверка доступа по ролям
const hasRoleAccess = (currentRole, targetRole) => {
  const rolePriority = {
    admin: 3,
    moderator: 2,
    manager: 1,
  }

  return (rolePriority[currentRole] || 0) > (rolePriority[targetRole] || 0)
}

// Получить список пользователей
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    if (!['admin', 'moderator', 'viewer'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' })
    }

    const result = await pool.query(
      `SELECT id, email, role, name, nickname, two_factor_enabled AS "twoFactorEnabled", created_at
       FROM users
       ORDER BY created_at DESC`
    )

    res.json(result.rows)
  } catch (err) {
    console.error('Error fetching users:', err)
    res.status(500).json({ error: 'Ошибка при загрузке пользователей' })
  }
})

// Создать пользователя
app.post('/api/users', authenticateToken, async (req, res) => {
  const { email, password, role = 'manager', name = null, nickname = null } = req.body

  try {
    if (!['admin', 'moderator'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' })
    }

    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны' })
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не короче 6 символов' })
    }

    if (req.user.role === 'moderator' && !['manager', 'viewer'].includes(role)) {
      return res.status(403).json({ error: 'Модератор может создавать только менеджеров и пользователей с правом просмотра' })
    }

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    )

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const result = await pool.query(
      `INSERT INTO users (email, password, role, name, nickname)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, role, name, nickname, two_factor_enabled, created_at`,
      [email, hashedPassword, role, name, nickname]
    )

    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('Error creating user:', err)
    res.status(500).json({ error: 'Ошибка при создании пользователя' })
  }
})

// Удалить пользователя
app.delete('/api/users/:id', authenticateToken, async (req, res) => {
  const { id } = req.params

  try {
    if (!['admin', 'moderator'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' })
    }

    const userResult = await pool.query(
      'SELECT id, role, email FROM users WHERE id = $1',
      [id]
    )

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' })
    }

    const targetUser = userResult.rows[0]

    if (Number(targetUser.id) === Number(req.user.id)) {
      return res.status(400).json({ error: 'Нельзя удалить самого себя' })
    }

    if (req.user.role === 'moderator' && !hasRoleAccess(req.user.role, targetUser.role)) {
      return res.status(403).json({ error: 'Недостаточно прав для удаления этого пользователя' })
    }

    await pool.query('DELETE FROM users WHERE id = $1', [id])

    res.json({ message: 'Пользователь удалён' })
  } catch (err) {
    console.error('Error deleting user:', err)
    res.status(500).json({ error: 'Ошибка при удалении пользователя' })
  }
})


// Изменить роль пользователя
app.put('/api/users/:id/role', authenticateToken, async (req, res) => {
  const { id } = req.params
  const { role } = req.body

  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Недостаточно прав' })
    }

    const validRoles = ['admin', 'moderator', 'manager', 'viewer']
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Недопустимая роль' })
    }

    const userResult = await pool.query(
      'SELECT id, email, role FROM users WHERE id = $1',
      [id]
    )

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' })
    }

    const targetUser = userResult.rows[0]

    if (Number(targetUser.id) === Number(req.user.id)) {
      return res.status(400).json({ error: 'Нельзя менять роль самому себе' })
    }

    const result = await pool.query(
      `UPDATE users
       SET role = $1,
           token_version = token_version + 1
       WHERE id = $2
       RETURNING id, email, role, name, nickname, two_factor_enabled AS "twoFactorEnabled", created_at`,
      [role, id]
    )

    res.json(result.rows[0])
  } catch (err) {
    console.error('Error changing user role:', err)
    res.status(500).json({ error: 'Ошибка при изменении роли' })
  }
})

// Сменить свой пароль
app.put('/api/users/me/password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body

  try {
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Текущий и новый пароль обязательны' })
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Новый пароль должен быть не короче 6 символов' })
    }

    const userResult = await pool.query(
      'SELECT id, password FROM users WHERE id = $1',
      [req.user.id]
    )

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' })
    }

    const user = userResult.rows[0]
    const isMatch = await bcrypt.compare(currentPassword, user.password)

    if (!isMatch) {
      return res.status(400).json({ error: 'Текущий пароль неверный' })
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10)

    await pool.query(
      'UPDATE users SET password = $1, token_version = token_version + 1 WHERE id = $2',
      [hashedPassword, req.user.id]
    )

    res.json({ message: 'Пароль успешно изменён', reauthRequired: true })
  } catch (err) {
    console.error('Error changing own password:', err)
    res.status(500).json({ error: 'Ошибка при смене пароля' })
  }
})

// Сменить пароль другому пользователю
app.put('/api/users/:id/password', authenticateToken, async (req, res) => {
  const { id } = req.params
  const { newPassword } = req.body

  try {
    if (!['admin', 'moderator'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' })
    }

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Новый пароль должен быть не короче 6 символов' })
    }

    const userResult = await pool.query(
      'SELECT id, role, email FROM users WHERE id = $1',
      [id]
    )

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' })
    }

    const targetUser = userResult.rows[0]

    if (Number(targetUser.id) === Number(req.user.id)) {
      return res.status(400).json({ error: 'Для смены своего пароля используйте отдельную форму' })
    }

    if (req.user.role === 'moderator' && !hasRoleAccess(req.user.role, targetUser.role)) {
      return res.status(403).json({ error: 'Недостаточно прав для смены пароля этого пользователя' })
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10)

    await pool.query(
      'UPDATE users SET password = $1, token_version = token_version + 1 WHERE id = $2',
      [hashedPassword, id]
    )

    res.json({ message: 'Пароль пользователя обновлён', reauthRequired: true })
  } catch (err) {
    console.error('Error changing user password:', err)
    res.status(500).json({ error: 'Ошибка при смене пароля пользователя' })
  }
})


// ========================================
// Настройки
// ========================================
app.get('/api/settings/public', async (req, res) => {
  try {
    // Only documented, non-sensitive site settings may be returned anonymously.
    const result = await pool.query(
      'SELECT key, value FROM settings WHERE key = ANY($1::text[])',
      [PUBLIC_SETTINGS_KEYS]
    )
    const settings = result.rows.reduce((acc, row) => {
      acc[row.key] = row.value
      return acc
    }, {})
    res.json(settings)
  } catch (err) {
    console.error('Error fetching public settings:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

app.get('/api/settings', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM settings ORDER BY key')
    res.json(result.rows)
  } catch (err) {
    console.error('Error fetching settings:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

app.put('/api/settings', authenticateToken, async (req, res) => {
  if (!canEditSettings(req.user)) {
    return res.status(403).json({ error: 'Недостаточно прав' })
  }

  const settings = req.body
  if (!settings || typeof settings !== 'object')
    return res.status(400).json({ error: 'Некорректные данные' })

  try {
    const promises = Object.entries(settings).map(([key, value]) =>
      pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, value]
      )
    )
    await Promise.all(promises)
    const result = await pool.query('SELECT * FROM settings ORDER BY key')
    res.json(result.rows)
  } catch (err) {
    console.error('Error updating settings:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ========================================
// Запуск сервера
// ========================================
const PORT = process.env.PORT || 3001
const HOST = '127.0.0.1'

// Importing the app for HTTP tests must not bind the production port.
if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`)
  })
}

module.exports = { app, pool }
