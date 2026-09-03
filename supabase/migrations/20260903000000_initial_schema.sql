-- ═══════════════════════════════════════════════════════════════════════════
-- FinançasPro — Initial Supabase PostgreSQL Schema
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Categories
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'both')),
  icon TEXT DEFAULT '📁',
  color TEXT DEFAULT '#6366f1',
  is_default INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Credit Cards
CREATE TABLE IF NOT EXISTS credit_cards (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  card_limit NUMERIC NOT NULL,
  closing_day INTEGER NOT NULL,
  due_day INTEGER NOT NULL,
  color TEXT DEFAULT '#14b8a6',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Banks
CREATE TABLE IF NOT EXISTS banks (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#3b82f6',
  initial_balance NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Vehicles
CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT DEFAULT '',
  model TEXT DEFAULT '',
  year INTEGER,
  license_plate TEXT DEFAULT '',
  color TEXT DEFAULT '#6366f1',
  icon TEXT DEFAULT '🚗',
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Recurring Transactions
CREATE TABLE IF NOT EXISTS recurring_transactions (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
  amount NUMERIC NOT NULL CHECK(amount > 0),
  description TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  bank_id INTEGER REFERENCES banks(id),
  credit_card_id INTEGER REFERENCES credit_cards(id),
  frequency TEXT NOT NULL CHECK(frequency IN ('monthly', 'weekly', 'yearly')),
  start_date TEXT NOT NULL,
  next_due_date TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
  amount NUMERIC NOT NULL CHECK(amount > 0),
  description TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  date TEXT NOT NULL,
  credit_card_id INTEGER REFERENCES credit_cards(id),
  bank_id INTEGER REFERENCES banks(id),
  is_paid INTEGER DEFAULT 1,
  installment_id TEXT,
  installment_number INTEGER,
  installments_total INTEGER,
  vehicle_id INTEGER REFERENCES vehicles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_bank ON transactions(bank_id);
CREATE INDEX IF NOT EXISTS idx_transactions_credit_card ON transactions(credit_card_id);
CREATE INDEX IF NOT EXISTS idx_transactions_vehicle ON transactions(vehicle_id);

-- Compatibility functions for SQLite expressions in queries
CREATE OR REPLACE FUNCTION strftime(format text, d text) 
RETURNS text AS $$
BEGIN
  IF format = '%Y-%m' THEN
    RETURN substring(d, 1, 7);
  ELSIF format = '%Y' THEN
    RETURN substring(d, 1, 4);
  ELSIF format = '%m' THEN
    RETURN substring(d, 6, 2);
  ELSE
    RETURN to_char(d::date, replace(replace(format, '%Y', 'YYYY'), '%m', 'MM'));
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION strftime(format text, d timestamptz) 
RETURNS text AS $$
BEGIN
  RETURN strftime(format, to_char(d, 'YYYY-MM-DD'));
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION datetime(arg text DEFAULT 'now') 
RETURNS text AS $$
BEGIN
  RETURN to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS');
END;
$$ LANGUAGE plpgsql STABLE;

-- Ensure app_financas, authenticated, anon and service_role have appropriate access
GRANT ALL ON ALL TABLES IN SCHEMA public TO app_financas;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_financas;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO app_financas;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role, anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role, anon;
