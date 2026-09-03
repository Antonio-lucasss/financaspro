/**
 * FinançasPro — SQLite to Supabase Data Migration Script
 * Reads strictly in READ-ONLY mode from local backup copy.
 * Transfers all records to Supabase PostgreSQL preserving IDs, relations, and syncing sequences.
 */

const Database = require('better-sqlite3');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const sqlitePath = process.env.MIGRATE_SOURCE_DB || path.join(__dirname, '..', 'data_backup_readonly', 'finances.db');

// Database connection string for Supabase
const databaseUrl = process.env.DATABASE_URL || 'postgresql://app_financas.frjalkvpciznfnhkrdpy:FinancasPro_App_2026_SecureDb!@aws-0-sa-east-1.pooler.supabase.com:5432/postgres';

async function migrate() {
  console.log('🚀 Iniciando processo de migração para o Supabase...');
  console.log(`📂 Lendo banco de origem (SOMENTE LEITURA): ${sqlitePath}`);

  // Open SQLite strictly in read-only mode
  const sqlite = new Database(sqlitePath, { readonly: true });

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();

  try {
    console.log('🔗 Conectado com sucesso ao Supabase PostgreSQL.');

    // 1. Categories
    const categories = sqlite.prepare('SELECT * FROM categories ORDER BY id ASC').all();
    console.log(`\n📦 Migrando ${categories.length} Categorias...`);
    for (const cat of categories) {
      await client.query(`
        INSERT INTO categories (id, name, type, icon, color, is_default, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          type = EXCLUDED.type,
          icon = EXCLUDED.icon,
          color = EXCLUDED.color,
          is_default = EXCLUDED.is_default,
          created_at = EXCLUDED.created_at
      `, [cat.id, cat.name, cat.type, cat.icon, cat.color, cat.is_default, cat.created_at]);
    }
    await client.query("SELECT setval(pg_get_serial_sequence('categories', 'id'), COALESCE((SELECT MAX(id) FROM categories), 1));");
    console.log('✅ Categorias migradas e sequence sincronizada.');

    // 2. Credit Cards
    const cards = sqlite.prepare('SELECT * FROM credit_cards ORDER BY id ASC').all();
    console.log(`\n📦 Migrando ${cards.length} Cartões de Crédito...`);
    for (const card of cards) {
      await client.query(`
        INSERT INTO credit_cards (id, name, card_limit, closing_day, due_day, color, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          card_limit = EXCLUDED.card_limit,
          closing_day = EXCLUDED.closing_day,
          due_day = EXCLUDED.due_day,
          color = EXCLUDED.color,
          created_at = EXCLUDED.created_at
      `, [card.id, card.name, card.card_limit, card.closing_day, card.due_day, card.color, card.created_at]);
    }
    await client.query("SELECT setval(pg_get_serial_sequence('credit_cards', 'id'), COALESCE((SELECT MAX(id) FROM credit_cards), 1));");
    console.log('✅ Cartões de crédito migrados e sequence sincronizada.');

    // 3. Banks
    const banks = sqlite.prepare('SELECT * FROM banks ORDER BY id ASC').all();
    console.log(`\n📦 Migrando ${banks.length} Bancos...`);
    for (const bank of banks) {
      await client.query(`
        INSERT INTO banks (id, name, color, initial_balance, created_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          color = EXCLUDED.color,
          initial_balance = EXCLUDED.initial_balance,
          created_at = EXCLUDED.created_at
      `, [bank.id, bank.name, bank.color, bank.initial_balance, bank.created_at]);
    }
    await client.query("SELECT setval(pg_get_serial_sequence('banks', 'id'), COALESCE((SELECT MAX(id) FROM banks), 1));");
    console.log('✅ Bancos migrados e sequence sincronizada.');

    // 4. Vehicles
    const vehicles = sqlite.prepare('SELECT * FROM vehicles ORDER BY id ASC').all();
    console.log(`\n📦 Migrando ${vehicles.length} Veículos...`);
    for (const v of vehicles) {
      await client.query(`
        INSERT INTO vehicles (id, name, brand, model, year, license_plate, color, icon, is_active, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          brand = EXCLUDED.brand,
          model = EXCLUDED.model,
          year = EXCLUDED.year,
          license_plate = EXCLUDED.license_plate,
          color = EXCLUDED.color,
          icon = EXCLUDED.icon,
          is_active = EXCLUDED.is_active,
          created_at = EXCLUDED.created_at
      `, [v.id, v.name, v.brand, v.model, v.year, v.license_plate, v.color, v.icon, v.is_active, v.created_at]);
    }
    await client.query("SELECT setval(pg_get_serial_sequence('vehicles', 'id'), COALESCE((SELECT MAX(id) FROM vehicles), 1));");
    console.log('✅ Veículos migrados e sequence sincronizada.');

    // 5. Recurring Transactions
    const recurring = sqlite.prepare('SELECT * FROM recurring_transactions ORDER BY id ASC').all();
    console.log(`\n📦 Migrando ${recurring.length} Transações Recorrentes...`);
    for (const r of recurring) {
      await client.query(`
        INSERT INTO recurring_transactions (id, type, amount, description, category_id, bank_id, credit_card_id, frequency, start_date, next_due_date, is_active, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE SET
          type = EXCLUDED.type,
          amount = EXCLUDED.amount,
          description = EXCLUDED.description,
          category_id = EXCLUDED.category_id,
          bank_id = EXCLUDED.bank_id,
          credit_card_id = EXCLUDED.credit_card_id,
          frequency = EXCLUDED.frequency,
          start_date = EXCLUDED.start_date,
          next_due_date = EXCLUDED.next_due_date,
          is_active = EXCLUDED.is_active,
          created_at = EXCLUDED.created_at
      `, [r.id, r.type, r.amount, r.description, r.category_id, r.bank_id, r.credit_card_id, r.frequency, r.start_date, r.next_due_date, r.is_active, r.created_at]);
    }
    await client.query("SELECT setval(pg_get_serial_sequence('recurring_transactions', 'id'), COALESCE((SELECT MAX(id) FROM recurring_transactions), 1));");
    console.log('✅ Transações recorrentes migradas e sequence sincronizada.');

    // 6. Transactions
    const transactions = sqlite.prepare('SELECT * FROM transactions ORDER BY id ASC').all();
    console.log(`\n📦 Migrando ${transactions.length} Transações...`);
    for (const t of transactions) {
      await client.query(`
        INSERT INTO transactions (
          id, type, amount, description, category_id, date,
          credit_card_id, is_paid, bank_id, installment_id,
          installment_number, installments_total, vehicle_id,
          created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO UPDATE SET
          type = EXCLUDED.type,
          amount = EXCLUDED.amount,
          description = EXCLUDED.description,
          category_id = EXCLUDED.category_id,
          date = EXCLUDED.date,
          credit_card_id = EXCLUDED.credit_card_id,
          is_paid = EXCLUDED.is_paid,
          bank_id = EXCLUDED.bank_id,
          installment_id = EXCLUDED.installment_id,
          installment_number = EXCLUDED.installment_number,
          installments_total = EXCLUDED.installments_total,
          vehicle_id = EXCLUDED.vehicle_id,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
      `, [
        t.id, t.type, t.amount, t.description, t.category_id, t.date,
        t.credit_card_id, t.is_paid, t.bank_id, t.installment_id,
        t.installment_number, t.installments_total, t.vehicle_id,
        t.created_at, t.updated_at
      ]);
    }
    await client.query("SELECT setval(pg_get_serial_sequence('transactions', 'id'), COALESCE((SELECT MAX(id) FROM transactions), 1));");
    console.log('✅ Transações migradas e sequence sincronizada.');

    // Verification
    console.log('\n🔍 Realizando auditoria e validação de integridade...');
    const tables = ['categories', 'credit_cards', 'banks', 'vehicles', 'recurring_transactions', 'transactions'];
    let allValid = true;

    for (const t of tables) {
      const sqliteCount = sqlite.prepare(`SELECT count(*) as count FROM ${t}`).get().count;
      const pgRes = await client.query(`SELECT count(*) as count FROM ${t}`);
      const pgCount = parseInt(pgRes.rows[0].count, 10);

      const status = sqliteCount === pgCount ? 'MATCH ✅' : 'MISMATCH ❌';
      console.log(`- ${t.padEnd(25)}: SQLite = ${sqliteCount} | Supabase = ${pgCount} [${status}]`);
      if (sqliteCount !== pgCount) allValid = false;
    }

    if (allValid) {
      console.log('\n🎉 SUCESSO TOTAL! Todos os dados foram migrados com 100% de paridade para o Supabase!');
    } else {
      console.error('\n⚠️ Atenção: foram detectadas discrepâncias na contagem de registros.');
    }

  } catch (error) {
    console.error('❌ Erro durante a migração:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

migrate()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
