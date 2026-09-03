/**
 * FinançasPro — Centralized Database Layer (Supabase PostgreSQL)
 * Provides both PostgreSQL pool access (pg) and Supabase Client (@supabase/supabase-js).
 * Transparently handles query parameter conversion (? -> $1, $2...) and transactions.
 */

const { types, Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Ensure NUMERIC and BIGINT are parsed as JavaScript numbers
types.setTypeParser(1700, val => (val === null ? null : parseFloat(val)));
types.setTypeParser(20, val => (val === null ? null : parseInt(val, 10)));

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://frjalkvpciznfnhkrdpy.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_2xoO_alRbY7Op9JqfVdZNA_Fw1EPKLL';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://app_financas.frjalkvpciznfnhkrdpy:FinancasPro_App_2026_SecureDb!@aws-0-sa-east-1.pooler.supabase.com:5432/postgres';

const WebSocket = require('ws');

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  realtime: { transport: WebSocket }
});

// Initialize PostgreSQL connection pool (optimized for serverless on Vercel)
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: process.env.VERCEL ? 1 : 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('⚠️ Erro inesperado no pool do Supabase/PostgreSQL:', err.message);
});

/**
 * Converts SQLite '?' placeholders to PostgreSQL '$1, $2, ...' placeholders.
 */
function convertPlaceholders(sql) {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

/**
 * Execute a parameterized query against pool or client.
 */
async function query(sql, params = [], executor = pool) {
  const pgSql = convertPlaceholders(sql);
  return await executor.query(pgSql, params);
}

/**
 * Returns all matching rows (equivalent to db.prepare().all())
 */
async function all(sql, params = [], executor = pool) {
  const res = await query(sql, params, executor);
  return res.rows;
}

/**
 * Returns the first matching row or null (equivalent to db.prepare().get())
 */
async function get(sql, params = [], executor = pool) {
  const res = await query(sql, params, executor);
  return res.rows.length > 0 ? res.rows[0] : null;
}

/**
 * Executes an INSERT/UPDATE/DELETE statement.
 * Automatically appends RETURNING id for INSERT if absent, returning { lastInsertRowid, changes }.
 */
async function run(sql, params = [], executor = pool) {
  let finalSql = sql.trim();
  const isInsert = /^insert\s+into/i.test(finalSql);
  const hasReturning = /returning\s+/i.test(finalSql);

  if (isInsert && !hasReturning) {
    if (finalSql.endsWith(';')) finalSql = finalSql.slice(0, -1);
    finalSql += ' RETURNING id';
  }

  const res = await query(finalSql, params, executor);
  const lastInsertRowid = (res.rows && res.rows.length > 0 && res.rows[0].id !== undefined)
    ? res.rows[0].id
    : null;

  return {
    lastInsertRowid,
    changes: res.rowCount,
  };
}

/**
 * Execute a transaction block.
 * Passes a scoped db object bound to the active transaction client.
 */
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const txDb = {
      query: (sql, params) => query(sql, params, client),
      all: (sql, params) => all(sql, params, client),
      get: (sql, params) => get(sql, params, client),
      run: (sql, params) => run(sql, params, client),
    };

    const result = await fn(txDb);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      console.error('Erro no ROLLBACK:', rbErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  supabase,
  query,
  all,
  get,
  run,
  transaction,
  convertPlaceholders,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  DATABASE_URL,
};
