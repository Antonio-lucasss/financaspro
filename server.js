const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Expose public Supabase config if needed by frontend
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: db.SUPABASE_URL,
    supabaseAnonKey: db.SUPABASE_ANON_KEY,
  });
});

// ─── Process Recurring Transactions ──────────────────────────────────────────
async function processRecurringTransactions() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const dueRecurrings = await db.all(`
      SELECT * FROM recurring_transactions WHERE is_active = 1 AND next_due_date <= ?
    `, [today]);

    if (!dueRecurrings || dueRecurrings.length === 0) return;

    await db.transaction(async (txDb) => {
      for (const rec of dueRecurrings) {
        let nextDate = new Date(rec.next_due_date + 'T12:00:00');
        const todayDate = new Date(today + 'T12:00:00');

        while (nextDate <= todayDate) {
          const dateStr = nextDate.toISOString().split('T')[0];
          const isPaid = rec.credit_card_id ? 0 : 1;
          await txDb.run(`
            INSERT INTO transactions (type, amount, description, category_id, date, credit_card_id, bank_id, is_paid)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [rec.type, rec.amount, rec.description, rec.category_id, dateStr, rec.credit_card_id || null, rec.bank_id || null, isPaid]);

          if (rec.frequency === 'monthly') {
            nextDate = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, nextDate.getDate());
          } else if (rec.frequency === 'weekly') {
            nextDate = new Date(nextDate.getTime() + 7 * 24 * 60 * 60 * 1000);
          } else if (rec.frequency === 'yearly') {
            nextDate = new Date(nextDate.getFullYear() + 1, nextDate.getMonth(), nextDate.getDate());
          }
        }

        await txDb.run(`UPDATE recurring_transactions SET next_due_date = ? WHERE id = ?`, [nextDate.toISOString().split('T')[0], rec.id]);
      }
    });

    console.log(`✅ ${dueRecurrings.length} transação(ões) recorrente(s) processada(s)`);
  } catch (err) {
    console.error('Erro ao processar transações recorrentes:', err.message);
  }
}

// ─── API Routes ──────────────────────────────────────────────────────────────

// --- Banks ---

app.get('/api/banks', async (req, res) => {
  try {
    const banks = await db.all('SELECT * FROM banks ORDER BY id ASC');
    const result = await Promise.all(banks.map(async bank => {
      const incomeRow = await db.get(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE bank_id = ? AND type = 'income' AND is_paid = 1`, [bank.id]);
      const expenseRow = await db.get(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE bank_id = ? AND type = 'expense' AND is_paid = 1`, [bank.id]);
      const income = incomeRow ? incomeRow.total : 0;
      const expense = expenseRow ? expenseRow.total : 0;
      return { ...bank, balance: (bank.initial_balance || 0) + income - expense };
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/banks', async (req, res) => {
  const { name, color, initial_balance } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'O nome do banco é obrigatório' });
  }
  try {
    const result = await db.run(`INSERT INTO banks (name, color, initial_balance) VALUES (?, ?, ?)`, [name, color || '#3b82f6', initial_balance || 0]);
    const bank = await db.get('SELECT * FROM banks WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(bank);
  } catch (err) {
    if (err.message.includes('unique') || err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Banco já existe' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/banks/:id', async (req, res) => {
  const { id } = req.params;
  const existing = await db.get('SELECT * FROM banks WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: 'Banco não encontrado' });

  const { name, color, target_balance, initial_balance } = req.body;
  const updatedName = name !== undefined && name !== null ? name.trim() : existing.name;
  if (!updatedName) {
    return res.status(400).json({ error: 'O nome do banco é obrigatório' });
  }

  const updatedColor = color || existing.color;
  
  const desiredBalance = (target_balance !== undefined && target_balance !== null && !isNaN(parseFloat(target_balance)))
    ? parseFloat(target_balance)
    : ((initial_balance !== undefined && initial_balance !== null && !isNaN(parseFloat(initial_balance)))
      ? parseFloat(initial_balance)
      : null);

  try {
    await db.transaction(async (txDb) => {
      await txDb.run('UPDATE banks SET name = ?, color = ? WHERE id = ?', [updatedName, updatedColor, id]);

      if (desiredBalance !== null) {
        const incomeRow = await txDb.get(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE bank_id = ? AND type = 'income' AND is_paid = 1`, [id]);
        const expenseRow = await txDb.get(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE bank_id = ? AND type = 'expense' AND is_paid = 1`, [id]);
        const income = incomeRow ? incomeRow.total : 0;
        const expense = expenseRow ? expenseRow.total : 0;
        const currentBalance = (existing.initial_balance || 0) + income - expense;

        const diff = desiredBalance - currentBalance;

        if (Math.abs(diff) >= 0.01) {
          let adjustmentCategory = await txDb.get("SELECT * FROM categories WHERE name = 'Ajuste de Saldo'");
          if (!adjustmentCategory) {
            const catResult = await txDb.run("INSERT INTO categories (name, type, icon, color, is_default) VALUES ('Ajuste de Saldo', 'both', '⚖️', '#6b7280', 1)");
            adjustmentCategory = await txDb.get('SELECT * FROM categories WHERE id = ?', [catResult.lastInsertRowid]);
          }

          const today = new Date().toISOString().split('T')[0];
          const txType = diff > 0 ? 'income' : 'expense';
          const amount = Math.abs(diff);
          const description = `Ajuste de Saldo - ${updatedName}`;

          await txDb.run(`
            INSERT INTO transactions (type, amount, description, category_id, date, bank_id, is_paid)
            VALUES (?, ?, ?, ?, ?, ?, 1)
          `, [txType, amount, description, adjustmentCategory.id, today, id]);
        }
      }
    });

    const incomeRow = await db.get(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE bank_id = ? AND type = 'income' AND is_paid = 1`, [id]);
    const expenseRow = await db.get(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE bank_id = ? AND type = 'expense' AND is_paid = 1`, [id]);
    const income = incomeRow ? incomeRow.total : 0;
    const expense = expenseRow ? expenseRow.total : 0;

    const updatedBank = await db.get('SELECT * FROM banks WHERE id = ?', [id]);
    res.json({ ...updatedBank, balance: (updatedBank.initial_balance || 0) + income - expense });
  } catch (err) {
    if (err.message.includes('unique') || err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Já existe um banco com este nome' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/banks/:id', async (req, res) => {
  const { id } = req.params;
  const hasTransactions = await db.get('SELECT COUNT(*) as count FROM transactions WHERE bank_id = ?', [id]);
  if (hasTransactions && hasTransactions.count > 0) {
    return res.status(409).json({ error: 'Banco possui transações vinculadas' });
  }
  await db.run('DELETE FROM banks WHERE id = ?', [id]);
  res.json({ message: 'Banco excluído' });
});

// --- Bank Transfers ---

app.post('/api/transfers', async (req, res) => {
  const { from_bank_id, to_bank_id, amount, description, date } = req.body;

  if (!from_bank_id || !to_bank_id || !amount || !date) {
    return res.status(400).json({ error: 'Campos obrigatórios: from_bank_id, to_bank_id, amount, date' });
  }
  if (from_bank_id === to_bank_id) {
    return res.status(400).json({ error: 'Banco de origem e destino não podem ser iguais' });
  }
  if (amount <= 0) {
    return res.status(400).json({ error: 'Valor deve ser maior que zero' });
  }

  const fromBank = await db.get('SELECT * FROM banks WHERE id = ?', [from_bank_id]);
  const toBank = await db.get('SELECT * FROM banks WHERE id = ?', [to_bank_id]);
  if (!fromBank) return res.status(404).json({ error: 'Banco de origem não encontrado' });
  if (!toBank) return res.status(404).json({ error: 'Banco de destino não encontrado' });

  let transferCategory = await db.get("SELECT * FROM categories WHERE name = 'Transferência'");
  if (!transferCategory) {
    const result = await db.run("INSERT INTO categories (name, type, icon, color, is_default) VALUES ('Transferência', 'both', '🔄', '#818cf8', 1)");
    transferCategory = await db.get('SELECT * FROM categories WHERE id = ?', [result.lastInsertRowid]);
  }

  const desc = description || `Transferência: ${fromBank.name} → ${toBank.name}`;

  await db.transaction(async (txDb) => {
    await txDb.run(`
      INSERT INTO transactions (type, amount, description, category_id, date, bank_id, is_paid)
      VALUES ('expense', ?, ?, ?, ?, ?, 1)
    `, [amount, desc, transferCategory.id, date, from_bank_id]);

    await txDb.run(`
      INSERT INTO transactions (type, amount, description, category_id, date, bank_id, is_paid)
      VALUES ('income', ?, ?, ?, ?, ?, 1)
    `, [amount, desc, transferCategory.id, date, to_bank_id]);
  });

  res.status(201).json({ message: `Transferência de R$ ${Number(amount).toFixed(2)} de ${fromBank.name} para ${toBank.name} realizada` });
});

// --- Categories ---

app.get('/api/categories', async (req, res) => {
  const { type } = req.query;
  if (type && (type === 'income' || type === 'expense')) {
    const cats = await db.all(`SELECT * FROM categories WHERE type = ? OR type = 'both' ORDER BY is_default DESC, name`, [type]);
    return res.json(cats);
  }
  const cats = await db.all(`SELECT * FROM categories ORDER BY type, is_default DESC, name`);
  res.json(cats);
});

app.post('/api/categories', async (req, res) => {
  const { name, type, icon, color } = req.body;
  if (!name || !type) {
    return res.status(400).json({ error: 'Nome e tipo são obrigatórios' });
  }
  if (!['income', 'expense', 'both'].includes(type)) {
    return res.status(400).json({ error: 'Tipo deve ser income, expense ou both' });
  }
  try {
    const result = await db.run(`INSERT INTO categories (name, type, icon, color) VALUES (?, ?, ?, ?)`, [name, type, icon || '📁', color || '#6366f1']);
    const category = await db.get('SELECT * FROM categories WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(category);
  } catch (err) {
    if (err.message.includes('unique') || err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Categoria já existe' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/categories/:id', async (req, res) => {
  const { id } = req.params;
  const category = await db.get('SELECT * FROM categories WHERE id = ?', [id]);
  if (!category) {
    return res.status(404).json({ error: 'Categoria não encontrada' });
  }
  const hasTransactions = await db.get('SELECT COUNT(*) as count FROM transactions WHERE category_id = ?', [id]);
  if (hasTransactions && hasTransactions.count > 0) {
    return res.status(409).json({ error: 'Categoria possui transações vinculadas' });
  }
  await db.run('DELETE FROM categories WHERE id = ?', [id]);
  res.json({ message: 'Categoria excluída' });
});

// --- Credit Cards ---

app.get('/api/credit-cards', async (req, res) => {
  try {
    const cards = await db.all('SELECT * FROM credit_cards ORDER BY id ASC');
    const result = await Promise.all(cards.map(async card => {
      const usedRow = await db.get(`
        SELECT COALESCE(SUM(amount), 0) as total 
        FROM transactions 
        WHERE credit_card_id = ? AND is_paid = 0
      `, [card.id]);
      const used = usedRow ? usedRow.total : 0;
      return { ...card, used_limit: used, available_limit: card.card_limit - used };
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/credit-cards', async (req, res) => {
  const { name, card_limit, closing_day, due_day, color } = req.body;
  if (!name || !card_limit || !closing_day || !due_day) {
    return res.status(400).json({ error: 'Campos obrigatórios: name, card_limit, closing_day, due_day' });
  }
  try {
    const result = await db.run(`INSERT INTO credit_cards (name, card_limit, closing_day, due_day, color) VALUES (?, ?, ?, ?, ?)`, [name, card_limit, closing_day, due_day, color || '#14b8a6']);
    const card = await db.get('SELECT * FROM credit_cards WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(card);
  } catch (err) {
    if (err.message.includes('unique') || err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Cartão já existe' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/credit-cards/:id', async (req, res) => {
  const { id } = req.params;
  const existing = await db.get('SELECT * FROM credit_cards WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: 'Cartão não encontrado' });

  const { name, card_limit, closing_day, due_day, color } = req.body;

  const updatedLimit = card_limit !== undefined && card_limit !== null ? parseFloat(card_limit) : existing.card_limit;
  if (isNaN(updatedLimit) || updatedLimit <= 0) {
    return res.status(400).json({ error: 'Limite do cartão deve ser maior que zero' });
  }

  const updatedName = name ? name.trim() : existing.name;
  const updatedClosing = closing_day !== undefined ? parseInt(closing_day) : existing.closing_day;
  const updatedDue = due_day !== undefined ? parseInt(due_day) : existing.due_day;
  const updatedColor = color || existing.color;

  try {
    await db.run(`
      UPDATE credit_cards
      SET name = ?, card_limit = ?, closing_day = ?, due_day = ?, color = ?
      WHERE id = ?
    `, [updatedName, updatedLimit, updatedClosing, updatedDue, updatedColor, id]);

    const updated = await db.get('SELECT * FROM credit_cards WHERE id = ?', [id]);
    const usedRow = await db.get(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM transactions 
      WHERE credit_card_id = ? AND is_paid = 0
    `, [id]);
    const used = usedRow ? usedRow.total : 0;

    res.json({ ...updated, used_limit: used, available_limit: updated.card_limit - used });
  } catch (err) {
    if (err.message.includes('unique') || err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Já existe um cartão com este nome' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/credit-cards/:id', async (req, res) => {
  const { id } = req.params;
  const hasTransactions = await db.get('SELECT COUNT(*) as count FROM transactions WHERE credit_card_id = ?', [id]);
  if (hasTransactions && hasTransactions.count > 0) {
    return res.status(409).json({ error: 'Cartão possui transações vinculadas' });
  }
  await db.run('DELETE FROM credit_cards WHERE id = ?', [id]);
  res.json({ message: 'Cartão excluído' });
});

// ─── Helper Functions for Invoice & Installments ───────────────────────────

function getInvoiceCutoffDate(year, month, closingDay) {
  const dateObj = new Date(year, month, 1);
  const y = dateObj.getFullYear();
  const m = dateObj.getMonth();
  const maxDays = new Date(y, m + 1, 0).getDate();
  const day = Math.min(closingDay, maxDays);
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function calculateInstallmentDates(purchaseDateStr, count, closingDay) {
  const [pYear, pMonth, pDay] = purchaseDateStr.split('-').map(Number);
  const dates = [];

  const startInvoiceIndex = (pYear * 12 + (pMonth - 1)) + 1;
  const baseDayOfMonth = closingDay || pDay;

  for (let i = 0; i < count; i++) {
    const invIndex = startInvoiceIndex + i;
    const invYear = Math.floor(invIndex / 12);
    const invMonth = (invIndex % 12) + 1;

    const maxDays = new Date(invYear, invMonth, 0).getDate();
    const dayInMonth = Math.min(baseDayOfMonth, maxDays);

    const dateStr = `${invYear}-${String(invMonth).padStart(2, '0')}-${String(dayInMonth).padStart(2, '0')}`;
    dates.push(dateStr);
  }
  return dates;
}

app.get('/api/credit-cards/:id/invoice', async (req, res) => {
  try {
    const { id } = req.params;
    const card = await db.get('SELECT * FROM credit_cards WHERE id = ?', [id]);
    if (!card) return res.status(404).json({ error: 'Cartão não encontrado' });

    const today = new Date();
    let year = today.getFullYear();
    let month = today.getMonth();
    if (req.query.month) {
      const [qY, qM] = req.query.month.split('-').map(Number);
      year = qY;
      month = qM - 1;
    } else if (today.getDate() > card.closing_day) {
      month++;
    }
    const cutoffDate = getInvoiceCutoffDate(year, month, card.closing_day);
    const previousCutoffDate = getInvoiceCutoffDate(year, month - 1, card.closing_day);

    const transactions = await db.all(`
      SELECT t.*, c.name as category_name, c.icon as category_icon, c.color as category_color 
      FROM transactions t 
      JOIN categories c ON t.category_id = c.id 
      WHERE t.credit_card_id = ? AND t.is_paid = 0 AND t.date <= ?
        AND (t.installment_id IS NULL OR (t.date > ? AND t.date <= ?))
      ORDER BY t.date DESC
    `, [id, cutoffDate, previousCutoffDate, cutoffDate]);

    const total = transactions.reduce((acc, t) => acc + (t.amount || 0), 0);
    res.json({ card, transactions, total, cutoffDate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/credit-cards/:id/installments', async (req, res) => {
  try {
    const { id } = req.params;
    const card = await db.get('SELECT * FROM credit_cards WHERE id = ?', [id]);
    if (!card) return res.status(404).json({ error: 'Cartão não encontrado' });

    const installmentsQuery = await db.all(`
      SELECT 
        installment_id,
        description,
        MIN(id) as sample_transaction_id,
        MAX(category_id) as category_id,
        MAX(installments_total) as total_installments,
        SUM(CASE WHEN is_paid = 1 THEN 1 ELSE 0 END) as paid_installments,
        SUM(amount) as total_amount,
        SUM(CASE WHEN is_paid = 0 THEN amount ELSE 0 END) as remaining_amount,
        MAX(date) as last_date
      FROM transactions
      WHERE credit_card_id = ? AND installment_id IS NOT NULL
      GROUP BY installment_id, description
      HAVING SUM(CASE WHEN is_paid = 0 THEN amount ELSE 0 END) > 0
      ORDER BY last_date DESC
    `, [id]);

    res.json(installmentsQuery);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/credit-cards/:id/future-invoices', async (req, res) => {
  try {
    const { id } = req.params;
    const card = await db.get('SELECT * FROM credit_cards WHERE id = ?', [id]);
    if (!card) return res.status(404).json({ error: 'Cartão não encontrado' });

    const transactions = await db.all(`
      SELECT t.*, c.name as category_name, c.icon as category_icon, c.color as category_color 
      FROM transactions t 
      JOIN categories c ON t.category_id = c.id 
      WHERE t.credit_card_id = ? AND t.is_paid = 0
      ORDER BY t.date ASC
    `, [id]);

    const invoicesMap = {};

    transactions.forEach(t => {
      const [yStr, mStr] = t.date.split('-');
      const key = `${yStr}-${mStr}`;

      if (!invoicesMap[key]) {
        const year = parseInt(yStr);
        const month = parseInt(mStr);

        const dateObj = new Date(year, month - 1, 1);
        const monthRaw = dateObj.toLocaleDateString('pt-BR', { month: 'long' });
        const capitalizedMonth = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1) + ' / ' + year;

        const cutoffDate = getInvoiceCutoffDate(year, month - 1, card.closing_day);

        let dueYear = year;
        let dueMonth = month;
        if (card.due_day <= card.closing_day) {
          dueMonth++;
          if (dueMonth > 12) { dueMonth = 1; dueYear++; }
        }
        const maxDays = new Date(dueYear, dueMonth, 0).getDate();
        const dueDayActual = Math.min(card.due_day, maxDays);
        const dueDate = `${dueYear}-${String(dueMonth).padStart(2, '0')}-${String(dueDayActual).padStart(2, '0')}`;

        invoicesMap[key] = {
          monthKey: key,
          monthName: capitalizedMonth,
          cutoffDate,
          dueDate,
          closingDay: card.closing_day,
          dueDay: card.due_day,
          total: 0,
          transactions: []
        };
      }

      invoicesMap[key].total += t.amount;
      invoicesMap[key].transactions.push(t);
    });

    const futureInvoices = Object.values(invoicesMap).sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    res.json({ card, future_invoices: futureInvoices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/credit-cards/:id/pay', async (req, res) => {
  try {
    const { id } = req.params;
    const { date, bank_id } = req.body;
    const card = await db.get('SELECT * FROM credit_cards WHERE id = ?', [id]);
    if (!card) return res.status(404).json({ error: 'Cartão não encontrado' });

    if (!bank_id) return res.status(400).json({ error: 'Obrigatório selecionar um banco para pagamento' });
    const bank = await db.get('SELECT id FROM banks WHERE id = ?', [bank_id]);
    if (!bank) return res.status(400).json({ error: 'Banco não encontrado' });

    const today = new Date();
    let year = today.getFullYear();
    let month = today.getMonth();
    if (today.getDate() > card.closing_day) {
      month++;
    }
    const cutoffDate = getInvoiceCutoffDate(year, month, card.closing_day);

    const unpaidRow = await db.get('SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE credit_card_id = ? AND is_paid = 0 AND date <= ?', [id, cutoffDate]);
    const unpaid = unpaidRow ? unpaidRow.total : 0;
    if (unpaid <= 0) return res.status(400).json({ error: 'Não há fatura em aberto' });

    const payDate = date || new Date().toISOString().split('T')[0];
    const cat = await db.get("SELECT id FROM categories WHERE type='expense' OR type='both' LIMIT 1");
    const catId = cat ? cat.id : 1;

    await db.transaction(async (txDb) => {
      await txDb.run(`
        INSERT INTO transactions (type, amount, description, category_id, date, bank_id, is_paid)
        VALUES ('expense', ?, ?, ?, ?, ?, 1)
      `, [unpaid, `Pagamento Fatura ${card.name}`, catId, payDate, bank_id]);

      await txDb.run(`UPDATE transactions SET is_paid = 1 WHERE credit_card_id = ? AND is_paid = 0 AND date <= ?`, [id, cutoffDate]);
    });

    res.json({ message: 'Fatura paga com sucesso', total_paid: unpaid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Transactions ---

app.get('/api/transactions/autocomplete', async (req, res) => {
  try {
    const { q, type } = req.query;
    if (!q || q.length < 2) return res.json([]);

    let sql = `
      SELECT t.description, t.amount, t.category_id, t.bank_id, t.credit_card_id, t.vehicle_id, t.type,
             c.name as category_name, c.icon as category_icon
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      WHERE t.description ILIKE ?
    `;
    const params = [`%${q}%`];

    if (type && (type === 'income' || type === 'expense')) {
      sql += ' AND t.type = ?';
      params.push(type);
    }

    sql += ' GROUP BY t.description, t.amount, t.category_id, t.bank_id, t.credit_card_id, t.vehicle_id, t.type, c.name, c.icon ORDER BY MAX(t.date) DESC LIMIT 8';

    const suggestions = await db.all(sql, params);
    res.json(suggestions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/transactions', async (req, res) => {
  try {
    const { type, category_id, start_date, end_date, search, limit, offset, sort, order } = req.query;

    let sql = `
      SELECT t.*, c.name as category_name, c.icon as category_icon, c.color as category_color
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (type && (type === 'income' || type === 'expense')) {
      sql += ' AND t.type = ?';
      params.push(type);
    }
    if (category_id) {
      sql += ' AND t.category_id = ?';
      params.push(Number(category_id));
    }
    if (start_date) {
      sql += ' AND t.date >= ?';
      params.push(start_date);
    }
    if (end_date) {
      sql += ' AND t.date <= ?';
      params.push(end_date);
    }
    if (search) {
      sql += ' AND t.description ILIKE ?';
      params.push(`%${search}%`);
    }

    const countSql = sql.replace(/SELECT t\.\*, c\.name as category_name, c\.icon as category_icon, c\.color as category_color/, 'SELECT COUNT(*) as total');
    const countRes = await db.get(countSql, params);
    const total = countRes ? countRes.total : 0;

    const validSorts = ['date', 'amount', 'description', 'created_at'];
    const sortCol = validSorts.includes(sort) ? `t.${sort}` : 't.date';
    const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sortCol} ${sortOrder}`;

    const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const offsetNum = Math.max(parseInt(offset) || 0, 0);
    sql += ' LIMIT ? OFFSET ?';
    const dataParams = [...params, limitNum, offsetNum];

    const transactions = await db.all(sql, dataParams);
    res.json({ data: transactions, total, limit: limitNum, offset: offsetNum });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/transactions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const transaction = await db.get(`
      SELECT t.*, c.name as category_name, c.icon as category_icon, c.color as category_color
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      WHERE t.id = ?
    `, [id]);

    if (!transaction) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }

    res.json(transaction);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/transactions', async (req, res) => {
  try {
    const { type, amount, description, category_id, date, credit_card_id, bank_id, vehicle_id, installments = 1 } = req.body;

    if (!type || !amount || !description || !category_id || !date) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios: type, amount, description, category_id, date' });
    }
    if (!['income', 'expense'].includes(type)) {
      return res.status(400).json({ error: 'Tipo deve ser income ou expense' });
    }
    if (amount <= 0) {
      return res.status(400).json({ error: 'Valor deve ser maior que zero' });
    }
    if (type === 'income' && credit_card_id) {
      return res.status(400).json({ error: 'Receitas não podem ser vinculadas a cartão de crédito' });
    }
    if (!credit_card_id && !bank_id) {
      return res.status(400).json({ error: 'É obrigatório informar o banco ou o cartão de crédito' });
    }
    const parsedInstallments = parseInt(installments);
    if (parsedInstallments > 1 && !credit_card_id) {
      return res.status(400).json({ error: 'Parcelamento só é permitido para compras no cartão de crédito' });
    }

    const category = await db.get('SELECT * FROM categories WHERE id = ?', [category_id]);
    if (!category) {
      return res.status(400).json({ error: 'Categoria não encontrada' });
    }

    const isPaid = credit_card_id ? 0 : 1;

    if (parsedInstallments > 1 && credit_card_id) {
      const card = await db.get('SELECT closing_day FROM credit_cards WHERE id = ?', [credit_card_id]);
      const closingDay = card ? card.closing_day : null;

      const installmentId = crypto.randomUUID();
      const installmentAmount = amount / parsedInstallments;
      const installmentDates = calculateInstallmentDates(date, parsedInstallments, closingDay);

      let firstId = null;
      await db.transaction(async (txDb) => {
        for (let i = 1; i <= parsedInstallments; i++) {
          const instDateStr = installmentDates[i - 1];
          const instDesc = `${description} (${i}/${parsedInstallments})`;
          const result = await txDb.run(`
            INSERT INTO transactions (type, amount, description, category_id, date, credit_card_id, bank_id, is_paid, installment_id, installment_number, installments_total, vehicle_id) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [type, installmentAmount, instDesc, category_id, instDateStr, credit_card_id, bank_id || null, isPaid, installmentId, i, parsedInstallments, vehicle_id || null]);

          if (i === 1) firstId = result.lastInsertRowid;
        }
      });

      const transaction = await db.get(`
        SELECT t.*, c.name as category_name, c.icon as category_icon, c.color as category_color
        FROM transactions t JOIN categories c ON t.category_id = c.id
        WHERE t.id = ?
      `, [firstId]);

      return res.status(201).json(transaction);
    } else {
      let adjustedDate = date;
      if (credit_card_id) {
        const card = await db.get('SELECT closing_day FROM credit_cards WHERE id = ?', [credit_card_id]);
        const closingDay = card ? card.closing_day : null;
        const dates = calculateInstallmentDates(date, 1, closingDay);
        adjustedDate = dates[0];
      }

      const result = await db.run(`
        INSERT INTO transactions (type, amount, description, category_id, date, credit_card_id, bank_id, is_paid, vehicle_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [type, amount, description, category_id, adjustedDate, credit_card_id || null, bank_id || null, isPaid, vehicle_id || null]);

      const transaction = await db.get(`
        SELECT t.*, c.name as category_name, c.icon as category_icon, c.color as category_color
        FROM transactions t JOIN categories c ON t.category_id = c.id
        WHERE t.id = ?
      `, [result.lastInsertRowid]);

      return res.status(201).json(transaction);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/transactions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { type, amount, description, category_id, date, credit_card_id, bank_id, vehicle_id } = req.body;

    const existing = await db.get('SELECT * FROM transactions WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }

    if (existing.installment_id) {
      const installments = await db.all(`
        SELECT * FROM transactions WHERE installment_id = ? ORDER BY installment_number ASC
      `, [existing.installment_id]);

      const count = installments.length;
      const cardId = credit_card_id !== undefined ? (credit_card_id || null) : existing.credit_card_id;
      const card = cardId ? await db.get('SELECT closing_day FROM credit_cards WHERE id = ?', [cardId]) : null;
      const closingDay = card ? card.closing_day : null;

      const updatedAmount = (amount !== undefined && amount !== null && !isNaN(parseFloat(amount))) ? parseFloat(amount) : existing.amount;
      const updatedCategoryId = category_id || existing.category_id;
      const updatedVehicleId = vehicle_id !== undefined ? (vehicle_id || null) : existing.vehicle_id;

      let baseDescription = (description || existing.description).replace(/ \(\d+\/\d+\)$/, '').trim();

      let newDates = [];
      if (date) {
        newDates = calculateInstallmentDates(date, count, closingDay);
      }

      await db.transaction(async (txDb) => {
        for (let index = 0; index < installments.length; index++) {
          const inst = installments[index];
          const instDate = newDates[index] || inst.date;
          const instDesc = `${baseDescription} (${inst.installment_number}/${count})`;
          
          await txDb.run(`
            UPDATE transactions
            SET amount = ?, description = ?, category_id = ?, date = ?, credit_card_id = ?, vehicle_id = ?, updated_at = NOW()
            WHERE id = ?
          `, [updatedAmount, instDesc, updatedCategoryId, instDate, cardId, updatedVehicleId, inst.id]);
        }
      });

      const updated = await db.get(`
        SELECT t.*, c.name as category_name, c.icon as category_icon, c.color as category_color
        FROM transactions t JOIN categories c ON t.category_id = c.id
        WHERE t.id = ?
      `, [id]);

      return res.json(updated);
    }

    const updatedType = type || existing.type;
    const updatedAmount = (amount !== undefined && amount !== null && !isNaN(parseFloat(amount))) ? parseFloat(amount) : existing.amount;
    const updatedDescription = description || existing.description;
    const updatedCategoryId = category_id || existing.category_id;
    const updatedCardId = credit_card_id !== undefined ? (credit_card_id || null) : existing.credit_card_id;
    const updatedBankId = bank_id !== undefined ? (bank_id || null) : existing.bank_id;
    const updatedVehicleId = vehicle_id !== undefined ? (vehicle_id || null) : existing.vehicle_id;

    let updatedDate = date || existing.date;
    if (updatedCardId && date) {
      const card = await db.get('SELECT closing_day FROM credit_cards WHERE id = ?', [updatedCardId]);
      const closingDay = card ? card.closing_day : null;
      const dates = calculateInstallmentDates(date, 1, closingDay);
      updatedDate = dates[0];
    }

    if (!['income', 'expense'].includes(updatedType)) {
      return res.status(400).json({ error: 'Tipo deve ser income ou expense' });
    }
    if (updatedAmount <= 0) {
      return res.status(400).json({ error: 'Valor deve ser maior que zero' });
    }
    if (!updatedCardId && !updatedBankId) {
      return res.status(400).json({ error: 'É obrigatório informar o banco ou o cartão de crédito' });
    }

    const isPaid = updatedCardId ? 0 : 1;

    await db.run(`
      UPDATE transactions SET type = ?, amount = ?, description = ?, category_id = ?, date = ?, credit_card_id = ?, bank_id = ?, is_paid = ?, vehicle_id = ?, updated_at = NOW()
      WHERE id = ?
    `, [updatedType, updatedAmount, updatedDescription, updatedCategoryId, updatedDate, updatedCardId, updatedBankId, isPaid, updatedVehicleId, id]);

    const transaction = await db.get(`
      SELECT t.*, c.name as category_name, c.icon as category_icon, c.color as category_color
      FROM transactions t JOIN categories c ON t.category_id = c.id
      WHERE t.id = ?
    `, [id]);

    res.json(transaction);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.get('SELECT * FROM transactions WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }
    await db.run('DELETE FROM transactions WHERE id = ?', [id]);
    res.json({ message: 'Transação excluída' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Statistics ---

app.get('/api/stats/summary', async (req, res) => {
  try {
    const { start_date, end_date, month, category_id } = req.query;
    let dateFilter = '';
    const params = [];
    
    let recurringDateFilter = '';
    const recurringParams = [];

    let previousFilter = '';
    const previousParams = [];

    if (category_id) {
      dateFilter += ' AND category_id = ?';
      params.push(category_id);
      
      recurringDateFilter += ' AND category_id = ?';
      recurringParams.push(category_id);

      previousFilter += ' AND category_id = ?';
      previousParams.push(category_id);
    }

    let periodStartDate = null;
    if (start_date) {
      dateFilter += ' AND date >= ?';
      params.push(start_date);
      
      recurringDateFilter += ' AND next_due_date >= ?';
      recurringParams.push(start_date);

      periodStartDate = start_date;
    }
    if (end_date) {
      dateFilter += ' AND date <= ?';
      params.push(end_date);
      
      recurringDateFilter += ' AND next_due_date <= ?';
      recurringParams.push(end_date);
    }
    if (month) {
      dateFilter += " AND strftime('%Y-%m', date) = ?";
      params.push(month);
      
      recurringDateFilter += " AND strftime('%Y-%m', next_due_date) = ?";
      recurringParams.push(month);

      periodStartDate = `${month}-01`;
    }

    let previousBalance = 0;
    if (periodStartDate) {
      const prevPaidIncome = await db.get(`
        SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'income' AND is_paid = 1 AND date < ?${previousFilter}
      `, [periodStartDate, ...previousParams]);

      const prevPaidExpense = await db.get(`
        SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'expense' AND is_paid = 1 AND date < ?${previousFilter}
      `, [periodStartDate, ...previousParams]);

      previousBalance = (prevPaidIncome ? prevPaidIncome.total : 0) - (prevPaidExpense ? prevPaidExpense.total : 0);
    }

    const income = await db.get(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'income'${dateFilter}`, params);
    const expense = await db.get(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'expense'${dateFilter}`, params);
    const paidIncome = await db.get(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'income' AND is_paid = 1${dateFilter}`, params);
    const paidExpense = await db.get(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'expense' AND is_paid = 1${dateFilter}`, params);
    const count = await db.get(`SELECT COUNT(*) as total FROM transactions WHERE 1=1${dateFilter}`, params);
    
    const unpaidExpense = await db.get(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'expense' AND is_paid = 0${dateFilter}`, params);
    const unpaidIncome = await db.get(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'income' AND is_paid = 0${dateFilter}`, params);

    const futureRecurringExpense = await db.get(`SELECT COALESCE(SUM(amount), 0) as total FROM recurring_transactions WHERE type = 'expense' AND is_active = 1${recurringDateFilter}`, recurringParams);
    const futureRecurringIncome = await db.get(`SELECT COALESCE(SUM(amount), 0) as total FROM recurring_transactions WHERE type = 'income' AND is_active = 1${recurringDateFilter}`, recurringParams);

    const futureExpenseTotal = (unpaidExpense ? unpaidExpense.total : 0) + (futureRecurringExpense ? futureRecurringExpense.total : 0);
    const futureIncomeTotal = (unpaidIncome ? unpaidIncome.total : 0) + (futureRecurringIncome ? futureRecurringIncome.total : 0);
    
    const periodBalance = (paidIncome ? paidIncome.total : 0) - (paidExpense ? paidExpense.total : 0);
    const currentBalance = previousBalance + periodBalance;
    const futureBalance = currentBalance + futureIncomeTotal - futureExpenseTotal;

    let days = 30;
    if (start_date && end_date) {
      const start = new Date(start_date);
      const end = new Date(end_date);
      days = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
    } else if (month) {
      const [y, m] = month.split('-');
      days = new Date(y, m, 0).getDate();
    }

    const totalExp = expense ? expense.total : 0;
    const totalInc = income ? income.total : 0;

    res.json({
      total_income: totalInc,
      total_expense: totalExp,
      balance: currentBalance,
      previous_balance: previousBalance,
      period_balance: periodBalance,
      future_expense: futureExpenseTotal,
      future_balance: futureBalance,
      transaction_count: count ? count.total : 0,
      daily_average_expense: totalExp / days,
      daily_average_income: totalInc / days,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Total Installments (all cards) ---
app.get('/api/stats/total-installments', async (req, res) => {
  try {
    const result = await db.get(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM transactions
      WHERE installment_id IS NOT NULL AND is_paid = 0
    `);
    res.json({ total: result ? result.total : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats/by-category', async (req, res) => {
  try {
    const { type, start_date, end_date } = req.query;
    let dateFilter = '';
    const params = [];

    if (type && (type === 'income' || type === 'expense')) {
      dateFilter += ' AND t.type = ?';
      params.push(type);
    }
    if (start_date) {
      dateFilter += ' AND t.date >= ?';
      params.push(start_date);
    }
    if (end_date) {
      dateFilter += ' AND t.date <= ?';
      params.push(end_date);
    }
    if (req.query.month) {
      dateFilter += " AND strftime('%Y-%m', t.date) = ?";
      params.push(req.query.month);
    }

    const data = await db.all(`
      SELECT c.id, c.name, c.icon, c.color, t.type,
             SUM(t.amount) as total,
             COUNT(t.id) as count,
             AVG(t.amount) as average
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      WHERE 1=1${dateFilter}
      GROUP BY c.id, c.name, c.icon, c.color, t.type
      ORDER BY total DESC
    `, params);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats/monthly', async (req, res) => {
  try {
    const { year, category_id, start_date, month } = req.query;
    let targetYear = year;
    if (!targetYear && start_date) targetYear = start_date.split('-')[0];
    if (!targetYear && month) targetYear = month.split('-')[0];
    if (!targetYear) targetYear = new Date().getFullYear();
    targetYear = String(targetYear);

    let filter = '';
    const params = [targetYear];

    if (category_id) {
      filter += ' AND category_id = ?';
      params.push(category_id);
    }

    const data = await db.all(`
      SELECT
        strftime('%Y-%m', date) as month,
        type,
        SUM(amount) as total,
        COUNT(*) as count
      FROM transactions
      WHERE strftime('%Y', date) = ?${filter}
      GROUP BY strftime('%Y-%m', date), type
      ORDER BY month
    `, params);

    const months = {};
    for (let m = 1; m <= 12; m++) {
      const key = `${targetYear}-${String(m).padStart(2, '0')}`;
      months[key] = { month: key, income: 0, expense: 0, income_count: 0, expense_count: 0 };
    }

    for (const row of data) {
      if (months[row.month]) {
        months[row.month][row.type] = row.total;
        months[row.month][`${row.type}_count`] = row.count;
      }
    }

    res.json(Object.values(months));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats/balance-history', async (req, res) => {
  try {
    const { months, category_id } = req.query;
    const numMonths = parseInt(months) || 12;
    
    let filter = '';
    const params = [];
    
    if (category_id) {
      filter = 'WHERE category_id = ?';
      params.push(category_id);
    }
    
    params.push(numMonths);

    const data = await db.all(`
      SELECT
        strftime('%Y-%m', date) as month,
        SUM(CASE WHEN type = 'income' AND is_paid = 1 THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN type = 'expense' AND is_paid = 1 THEN amount ELSE 0 END) as expense
      FROM transactions
      ${filter}
      GROUP BY strftime('%Y-%m', date)
      ORDER BY month DESC
      LIMIT ?
    `, params);

    const reversed = data.reverse();
    let runningBalance = 0;

    if (reversed.length > 0) {
      const firstMonth = reversed[0].month;
      const firstMonthStart = `${firstMonth}-01`;
      let initialFilter = '';
      const initialParams = [firstMonthStart];
      if (category_id) {
        initialFilter = ' AND category_id = ?';
        initialParams.push(category_id);
      }
      const initialPaidIncome = await db.get(`
        SELECT COALESCE(SUM(amount), 0) as total FROM transactions
        WHERE type = 'income' AND is_paid = 1 AND date < ?${initialFilter}
      `, initialParams);
      const initialPaidExpense = await db.get(`
        SELECT COALESCE(SUM(amount), 0) as total FROM transactions
        WHERE type = 'expense' AND is_paid = 1 AND date < ?${initialFilter}
      `, initialParams);
      runningBalance = (initialPaidIncome ? initialPaidIncome.total : 0) - (initialPaidExpense ? initialPaidExpense.total : 0);
    }

    const result = reversed.map(row => {
      runningBalance += row.income - row.expense;
      return { ...row, balance: runningBalance };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Analytics (comprehensive dashboard data) ---
app.get('/api/stats/analytics', async (req, res) => {
  try {
    const { start_date, end_date, month, category_id } = req.query;

    let periodStart, periodEnd;
    if (month) {
      const [y, m] = month.split('-');
      periodStart = `${y}-${m}-01`;
      periodEnd = `${y}-${m}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    } else if (start_date && end_date) {
      periodStart = start_date;
      periodEnd = end_date;
    } else {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      periodStart = `${y}-${m}-01`;
      periodEnd = `${y}-${m}-${String(new Date(y, now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
    }

    const periodDays = Math.max(1, Math.ceil((new Date(periodEnd) - new Date(periodStart)) / (1000 * 60 * 60 * 24)) + 1);
    const prevEnd = new Date(new Date(periodStart).getTime() - 86400000);
    const prevStart = new Date(prevEnd.getTime() - (periodDays - 1) * 86400000);
    const prevStartStr = prevStart.toISOString().split('T')[0];
    const prevEndStr = prevEnd.toISOString().split('T')[0];

    let catFilter = '';
    const catParams = [];
    if (category_id) { catFilter = ' AND category_id = ?'; catParams.push(category_id); }

    // ── 1. TRENDS ──
    const curIncomeRow = await db.get(`SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE type='income' AND date>=? AND date<=?${catFilter}`, [periodStart, periodEnd, ...catParams]);
    const curExpenseRow = await db.get(`SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE type='expense' AND date>=? AND date<=?${catFilter}`, [periodStart, periodEnd, ...catParams]);
    const prevIncomeRow = await db.get(`SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE type='income' AND date>=? AND date<=?${catFilter}`, [prevStartStr, prevEndStr, ...catParams]);
    const prevExpenseRow = await db.get(`SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE type='expense' AND date>=? AND date<=?${catFilter}`, [prevStartStr, prevEndStr, ...catParams]);

    const curIncome = curIncomeRow ? curIncomeRow.t : 0;
    const curExpense = curExpenseRow ? curExpenseRow.t : 0;
    const prevIncome = prevIncomeRow ? prevIncomeRow.t : 0;
    const prevExpense = prevExpenseRow ? prevExpenseRow.t : 0;

    const incomeChangePct = prevIncome > 0 ? ((curIncome - prevIncome) / prevIncome * 100) : (curIncome > 0 ? 100 : 0);
    const expenseChangePct = prevExpense > 0 ? ((curExpense - prevExpense) / prevExpense * 100) : (curExpense > 0 ? 100 : 0);

    const curBalance = curIncome - curExpense;
    const prevBalance = prevIncome - prevExpense;
    let balanceTrend = 'stable';
    if (curBalance > prevBalance * 1.05) balanceTrend = 'improving';
    else if (curBalance < prevBalance * 0.95) balanceTrend = 'declining';

    // ── 2. FINANCIAL HEALTH SCORE ──
    const sixMonthsAgo = new Date(new Date(periodEnd).setMonth(new Date(periodEnd).getMonth() - 6)).toISOString().split('T')[0];
    const last6Months = await db.all(`
      SELECT strftime('%Y-%m', date) as m,
        SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expense
      FROM transactions WHERE date >= ?${catFilter}
      GROUP BY strftime('%Y-%m', date) ORDER BY m
    `, [sixMonthsAgo, ...catParams]);

    const savingsRate = curIncome > 0 ? (curIncome - curExpense) / curIncome : 0;

    const accRow = await db.get(`
      SELECT COALESCE(SUM(CASE WHEN type='income' AND is_paid=1 THEN amount ELSE 0 END),0) -
             COALESCE(SUM(CASE WHEN type='expense' AND is_paid=1 THEN amount ELSE 0 END),0) as bal
      FROM transactions WHERE 1=1${catFilter}
    `, catParams);
    const accumulatedBalance = accRow ? accRow.bal : 0;

    const dailyExpenseRate = curExpense / periodDays;
    const burnRateDays = dailyExpenseRate > 0 ? Math.round(accumulatedBalance / dailyExpenseRate) : 999;

    let incomeStability = 1;
    if (last6Months.length >= 2) {
      const incomes = last6Months.map(m => m.income).filter(i => i > 0);
      if (incomes.length >= 2) {
        const mean = incomes.reduce((a, b) => a + b, 0) / incomes.length;
        const variance = incomes.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / incomes.length;
        const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
        incomeStability = Math.max(0, Math.min(1, 1 - cv));
      }
    }

    const savingsScore = Math.max(0, Math.min(1, savingsRate)) * 100;
    const burnScore = Math.min(100, burnRateDays / 3.6);
    const stabilityScore = incomeStability * 100;
    const trendScore = balanceTrend === 'improving' ? 100 : (balanceTrend === 'stable' ? 60 : 20);

    const financialScore = Math.round(
      savingsScore * 0.35 + burnScore * 0.25 + stabilityScore * 0.20 + trendScore * 0.20
    );

    // ── 3. PROJECTION ──
    const last3Months = last6Months.slice(-3);
    let projectedIncome = 0, projectedExpense = 0;
    if (last3Months.length > 0) {
      const weights = [1, 2, 3];
      let totalWeight = 0;
      for (let i = 0; i < last3Months.length; i++) {
        const w = weights[weights.length - last3Months.length + i];
        projectedIncome += last3Months[i].income * w;
        projectedExpense += last3Months[i].expense * w;
        totalWeight += w;
      }
      projectedIncome = Math.round(projectedIncome / totalWeight * 100) / 100;
      projectedExpense = Math.round(projectedExpense / totalWeight * 100) / 100;
    } else {
      projectedIncome = curIncome;
      projectedExpense = curExpense;
    }

    const projectedMonths = [];
    let projRunning = accumulatedBalance;
    const baseDate = new Date(periodEnd);
    for (let i = 1; i <= 3; i++) {
      const futureDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, 1);
      const mStr = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}`;
      projRunning += projectedIncome - projectedExpense;
      projectedMonths.push({
        month: mStr,
        income: projectedIncome,
        expense: projectedExpense,
        balance: Math.round(projRunning * 100) / 100
      });
    }

    // ── 4. EXPENSE COMPOSITION ──
    const compositionRaw = await db.all(`
      SELECT strftime('%Y-%m', t.date) as month, c.name, c.color, c.icon, SUM(t.amount) as total
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      WHERE t.type = 'expense' AND t.date >= ?${catFilter}
      GROUP BY strftime('%Y-%m', t.date), c.id, c.name, c.color, c.icon
      ORDER BY month, total DESC
    `, [sixMonthsAgo, ...catParams]);

    const compositionMap = {};
    for (const row of compositionRaw) {
      if (!compositionMap[row.month]) compositionMap[row.month] = [];
      compositionMap[row.month].push({ name: row.name, total: row.total, color: row.color, icon: row.icon });
    }
    const expenseComposition = Object.entries(compositionMap).map(([month, categories]) => ({ month, categories }));

    // ── 5. ALERTS ──
    const alerts = [];
    const curCategories = await db.all(`
      SELECT c.name, c.icon, SUM(t.amount) as total
      FROM transactions t JOIN categories c ON t.category_id = c.id
      WHERE t.type='expense' AND t.date>=? AND t.date<=?${catFilter}
      GROUP BY c.id, c.name, c.icon
    `, [periodStart, periodEnd, ...catParams]);

    const prevCategories = await db.all(`
      SELECT c.name, c.icon, SUM(t.amount) as total
      FROM transactions t JOIN categories c ON t.category_id = c.id
      WHERE t.type='expense' AND t.date>=? AND t.date<=?${catFilter}
      GROUP BY c.id, c.name, c.icon
    `, [prevStartStr, prevEndStr, ...catParams]);

    const prevCatMap = {};
    for (const c of prevCategories) prevCatMap[c.name] = c.total;

    for (const cat of curCategories) {
      const prev = prevCatMap[cat.name] || 0;
      if (prev > 0) {
        const changePct = ((cat.total - prev) / prev) * 100;
        if (changePct > 30) {
          alerts.push({
            type: 'spike',
            icon: cat.icon,
            category: cat.name,
            change_pct: Math.round(changePct),
            message: `${cat.icon} ${cat.name} subiu ${Math.round(changePct)}% em relação ao período anterior`
          });
        }
      } else if (cat.total > curExpense * 0.25 && cat.total > 0) {
        alerts.push({
          type: 'new_high',
          icon: cat.icon,
          category: cat.name,
          change_pct: 100,
          message: `${cat.icon} ${cat.name} é uma nova despesa significativa`
        });
      }
    }

    if (savingsRate >= 0.2) {
      alerts.push({ type: 'positive', icon: '💚', message: `Taxa de poupança de ${Math.round(savingsRate * 100)}% — excelente!` });
    }
    if (balanceTrend === 'improving') {
      alerts.push({ type: 'positive', icon: '📈', message: 'Seu saldo está em tendência de melhora' });
    }
    if (expenseChangePct < -10 && prevExpense > 0) {
      alerts.push({ type: 'positive', icon: '🎯', message: `Despesas reduziram ${Math.round(Math.abs(expenseChangePct))}% vs período anterior` });
    }

    if (savingsRate < 0 && curIncome > 0) {
      alerts.push({ type: 'warning', icon: '⚠️', message: 'Você está gastando mais do que recebe neste período' });
    }
    if (burnRateDays < 30 && burnRateDays > 0) {
      alerts.push({ type: 'warning', icon: '🔥', message: `Seu saldo duraria apenas ${burnRateDays} dias no ritmo atual` });
    }

    // ── 6. RECENT TRANSACTIONS ──
    let recentFilter = catFilter ? `WHERE 1=1${catFilter}` : '';
    const recentTx = await db.all(`
      SELECT t.*, c.name as category_name, c.icon as category_icon, c.color as category_color
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      ${recentFilter}
      ORDER BY t.date DESC, t.created_at DESC
      LIMIT 5
    `, catParams);

    res.json({
      trends: {
        income_change_pct: Math.round(incomeChangePct * 10) / 10,
        expense_change_pct: Math.round(expenseChangePct * 10) / 10,
        balance_trend: balanceTrend,
        prev_income: prevIncome,
        prev_expense: prevExpense,
      },
      financial_health: {
        score: Math.max(0, Math.min(100, financialScore)),
        savings_rate: Math.round(savingsRate * 1000) / 10,
        burn_rate_days: Math.max(0, burnRateDays),
        income_stability: Math.round(incomeStability * 100),
        accumulated_balance: accumulatedBalance,
      },
      projection: {
        next_month_income: projectedIncome,
        next_month_expense: projectedExpense,
        next_month_balance: Math.round((projectedIncome - projectedExpense) * 100) / 100,
        projected_months: projectedMonths,
      },
      expense_composition: expenseComposition,
      alerts,
      recent_transactions: recentTx,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Available years ---
app.get('/api/stats/years', async (req, res) => {
  try {
    const years = await db.all(`
      SELECT DISTINCT strftime('%Y', date) as year FROM transactions ORDER BY year DESC
    `);
    const currentYear = String(new Date().getFullYear());
    const yearList = years.map(y => y.year);
    if (!yearList.includes(currentYear)) {
      yearList.unshift(currentYear);
    }
    res.json(yearList);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Recurring Transactions ──────────────────────────────────────────────────

app.get('/api/recurring', async (req, res) => {
  try {
    const recurrings = await db.all(`
      SELECT r.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
             b.name as bank_name, cc.name as card_name
      FROM recurring_transactions r
      JOIN categories c ON r.category_id = c.id
      LEFT JOIN banks b ON r.bank_id = b.id
      LEFT JOIN credit_cards cc ON r.credit_card_id = cc.id
      ORDER BY r.is_active DESC, r.next_due_date ASC
    `);
    res.json(recurrings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/recurring', async (req, res) => {
  const { type, amount, description, category_id, bank_id, credit_card_id, frequency, start_date } = req.body;

  if (!type || !amount || !description || !category_id || !frequency || !start_date) {
    return res.status(400).json({ error: 'Campos obrigatórios: type, amount, description, category_id, frequency, start_date' });
  }
  if (!['income', 'expense'].includes(type)) {
    return res.status(400).json({ error: 'Tipo deve ser income ou expense' });
  }
  if (!['monthly', 'weekly', 'yearly'].includes(frequency)) {
    return res.status(400).json({ error: 'Frequência deve ser monthly, weekly ou yearly' });
  }
  if (amount <= 0) {
    return res.status(400).json({ error: 'Valor deve ser maior que zero' });
  }
  if (!credit_card_id && !bank_id) {
    return res.status(400).json({ error: 'É obrigatório informar o banco ou o cartão de crédito' });
  }

  try {
    const result = await db.run(`
      INSERT INTO recurring_transactions (type, amount, description, category_id, bank_id, credit_card_id, frequency, start_date, next_due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [type, amount, description, category_id, bank_id || null, credit_card_id || null, frequency, start_date, start_date]);

    const recurring = await db.get(`
      SELECT r.*, c.name as category_name, c.icon as category_icon, c.color as category_color
      FROM recurring_transactions r
      JOIN categories c ON r.category_id = c.id
      WHERE r.id = ?
    `, [result.lastInsertRowid]);

    processRecurringTransactions();

    res.status(201).json(recurring);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/recurring/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const rec = await db.get('SELECT * FROM recurring_transactions WHERE id = ?', [id]);
    if (!rec) return res.status(404).json({ error: 'Transação recorrente não encontrada' });

    const newStatus = rec.is_active ? 0 : 1;
    await db.run('UPDATE recurring_transactions SET is_active = ? WHERE id = ?', [newStatus, id]);
    res.json({ ...rec, is_active: newStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/recurring/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const rec = await db.get('SELECT * FROM recurring_transactions WHERE id = ?', [id]);
    if (!rec) return res.status(404).json({ error: 'Transação recorrente não encontrada' });

    await db.run('DELETE FROM recurring_transactions WHERE id = ?', [id]);
    res.json({ message: 'Transação recorrente excluída' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/recurring/process', async (req, res) => {
  await processRecurringTransactions();
  res.json({ message: 'Transações recorrentes processadas' });
});

// --- Vehicles ---

app.get('/api/vehicles', async (req, res) => {
  try {
    const vehicles = await db.all('SELECT * FROM vehicles ORDER BY created_at DESC');
    const result = await Promise.all(vehicles.map(async v => {
      const totalSpentRow = await db.get(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE vehicle_id = ? AND type = 'expense'`, [v.id]);
      const txCountRow = await db.get(`SELECT COUNT(*) as count FROM transactions WHERE vehicle_id = ?`, [v.id]);
      return {
        ...v,
        total_spent: totalSpentRow ? totalSpentRow.total : 0,
        transaction_count: txCountRow ? txCountRow.count : 0
      };
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vehicles', async (req, res) => {
  const { name, brand, model, year, license_plate, color, icon } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Nome do veículo é obrigatório' });
  }
  try {
    const result = await db.run(`
      INSERT INTO vehicles (name, brand, model, year, license_plate, color, icon)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [name, brand || '', model || '', year || null, license_plate || '', color || '#6366f1', icon || '🚗']);
    const vehicle = await db.get('SELECT * FROM vehicles WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(vehicle);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar veículo: ' + err.message });
  }
});

app.put('/api/vehicles/:id', async (req, res) => {
  const { id } = req.params;
  const existing = await db.get('SELECT * FROM vehicles WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: 'Veículo não encontrado' });

  const { name, brand, model, year, license_plate, color, icon, is_active } = req.body;
  try {
    await db.run(`
      UPDATE vehicles SET name = ?, brand = ?, model = ?, year = ?, license_plate = ?, color = ?, icon = ?, is_active = ?
      WHERE id = ?
    `, [
      name || existing.name,
      brand !== undefined ? brand : existing.brand,
      model !== undefined ? model : existing.model,
      year !== undefined ? year : existing.year,
      license_plate !== undefined ? license_plate : existing.license_plate,
      color || existing.color,
      icon || existing.icon,
      is_active !== undefined ? is_active : existing.is_active,
      id
    ]);
    const vehicle = await db.get('SELECT * FROM vehicles WHERE id = ?', [id]);
    res.json(vehicle);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/vehicles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const hasTx = await db.get('SELECT COUNT(*) as count FROM transactions WHERE vehicle_id = ?', [id]);
    if (hasTx && hasTx.count > 0) {
      return res.status(409).json({ error: 'Veículo possui transações vinculadas. Remova as transações primeiro.' });
    }
    await db.run('DELETE FROM vehicles WHERE id = ?', [id]);
    res.json({ message: 'Veículo excluído' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vehicles/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const vehicle = await db.get('SELECT * FROM vehicles WHERE id = ?', [id]);
    if (!vehicle) return res.status(404).json({ error: 'Veículo não encontrado' });

    const { start_date, end_date, month } = req.query;
    let dateFilter = '';
    const params = [id];
    if (start_date) { dateFilter += ' AND t.date >= ?'; params.push(start_date); }
    if (end_date) { dateFilter += ' AND t.date <= ?'; params.push(end_date); }
    if (month) { dateFilter += " AND strftime('%Y-%m', t.date) = ?"; params.push(month); }

    const totalSpentRow = await db.get(`SELECT COALESCE(SUM(t.amount), 0) as total FROM transactions t WHERE t.vehicle_id = ? AND t.type = 'expense'${dateFilter}`, params);
    const totalSpent = totalSpentRow ? totalSpentRow.total : 0;

    const byCategory = await db.all(`
      SELECT c.name, c.icon, c.color, SUM(t.amount) as total, COUNT(*) as count
      FROM transactions t JOIN categories c ON t.category_id = c.id
      WHERE t.vehicle_id = ? AND t.type = 'expense'${dateFilter}
      GROUP BY c.name, c.icon, c.color, t.category_id ORDER BY total DESC
    `, params);

    const monthly = await db.all(`
      SELECT strftime('%Y-%m', t.date) as month, SUM(t.amount) as total
      FROM transactions t
      WHERE t.vehicle_id = ? AND t.type = 'expense'
      GROUP BY strftime('%Y-%m', t.date) ORDER BY month DESC LIMIT 12
    `, [id]);

    const txCountRow = await db.get(`SELECT COUNT(*) as count FROM transactions t WHERE t.vehicle_id = ?${dateFilter}`, params);
    const txCount = txCountRow ? txCountRow.count : 0;

    const avgMonthly = monthly.length > 0 ? monthly.reduce((s, m) => s + m.total, 0) / monthly.length : 0;

    res.json({
      vehicle,
      total_spent: totalSpent,
      transaction_count: txCount,
      avg_monthly: avgMonthly,
      by_category: byCategory,
      monthly: monthly.reverse(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vehicles/:id/transactions', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50, offset = 0, start_date, end_date, month } = req.query;
    let dateFilter = '';
    const params = [id];

    if (start_date) { dateFilter += ' AND t.date >= ?'; params.push(start_date); }
    if (end_date) { dateFilter += ' AND t.date <= ?'; params.push(end_date); }
    if (month) { dateFilter += " AND strftime('%Y-%m', t.date) = ?"; params.push(month); }

    const totalParams = [...params];
    params.push(parseInt(limit), parseInt(offset));

    const transactions = await db.all(`
      SELECT t.*, c.name as category_name, c.icon as category_icon, c.color as category_color
      FROM transactions t JOIN categories c ON t.category_id = c.id
      WHERE t.vehicle_id = ?${dateFilter}
      ORDER BY t.date DESC LIMIT ? OFFSET ?
    `, params);

    const totalRow = await db.get(`SELECT COUNT(*) as count FROM transactions t WHERE t.vehicle_id = ?${dateFilter}`, totalParams);
    const total = totalRow ? totalRow.count : 0;
    res.json({ data: transactions, total, limit: parseInt(limit), offset: parseInt(offset) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start Server ────────────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Servidor de Finanças rodando em http://localhost:${PORT}`);
    console.log(`☁️ Conectado ao Supabase: ${db.SUPABASE_URL}`);
    await processRecurringTransactions();
  });
}

module.exports = app;
