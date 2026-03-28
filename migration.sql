-- Создание таблицы настроек
CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) UNIQUE NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Начальные настройки
INSERT INTO settings (key, value) VALUES
  ('site_phone', '+7 (999) 123-45-67'),
  ('site_email', 'hello@tochkarosta.ru'),
  ('site_telegram', 'https://t.me/tochkarosta'),
  ('site_whatsapp', 'https://wa.me/79991234567'),
  ('site_vk', 'https://vk.com/tochkarosta'),
  ('site_work_hours', 'Каждый день, 9:00–21:00'),
  ('hero_title', 'Сайт под ключ'),
  ('hero_subtitle', '— с запуском и поддержкой'),
  ('hero_description', 'Разрабатываем, запускаем и сопровождаем сайты для бизнеса. Вы получаете готовый проект и техническую поддержку после старта.')
ON CONFLICT (key) DO NOTHING;
