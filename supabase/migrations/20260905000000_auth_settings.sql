-- ═══════════════════════════════════════════════════════════════════════════
-- FinançasPro — Auth & App Settings Schema
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS idx_app_settings_key ON app_settings(key);
