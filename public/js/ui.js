/**
 * FinançasPro — UI Module
 * Handles DOM rendering, user interactions, toasts, and modals.
 */
const UI = (() => {
  // ─── Currency Formatter ────────────────────────────────────────
  function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  }

  function formatDate(dateStr) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }

  // ─── Toast Notifications ───────────────────────────────────────
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-text">${message}</span>
      <button class="toast-close" aria-label="Fechar">&times;</button>
    `;
    container.appendChild(toast);

    const closeBtn = toast.querySelector('.toast-close');
    const dismiss = () => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 250);
    };
    closeBtn.addEventListener('click', dismiss);
    setTimeout(dismiss, 4000);
  }

  // ─── Confirm Modal ─────────────────────────────────────────────
  function showConfirm(title, message) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirm-modal');
      const titleEl = document.getElementById('confirm-title');
      const messageEl = document.getElementById('confirm-message');
      const yesBtn = document.getElementById('confirm-yes');
      const noBtn = document.getElementById('confirm-no');

      titleEl.textContent = title;
      messageEl.textContent = message;
      modal.style.display = 'flex';

      function cleanup(result) {
        modal.style.display = 'none';
        yesBtn.removeEventListener('click', onYes);
        noBtn.removeEventListener('click', onNo);
        modal.removeEventListener('click', onOverlay);
        resolve(result);
      }

      function onYes() { cleanup(true); }
      function onNo() { cleanup(false); }
      function onOverlay(e) { if (e.target === modal) cleanup(false); }

      yesBtn.addEventListener('click', onYes);
      noBtn.addEventListener('click', onNo);
      modal.addEventListener('click', onOverlay);
    });
  }

  // ─── Dashboard ─────────────────────────────────────────────────
  function renderSummary(summary) {
    document.getElementById('total-income').textContent = formatCurrency(summary.total_income);
    document.getElementById('total-expense').textContent = formatCurrency(summary.total_expense);
    document.getElementById('total-balance').textContent = formatCurrency(summary.balance);
    
    // Legacy elements (hidden, for backward compat)
    const futureExpEl = document.getElementById('future-expense');
    if (futureExpEl) futureExpEl.textContent = formatCurrency(summary.future_expense);
    const futureBalEl = document.getElementById('future-balance');
    if (futureBalEl) futureBalEl.textContent = formatCurrency(summary.future_balance);
    const dailyAvgEl = document.getElementById('daily-average');
    if (dailyAvgEl) dailyAvgEl.textContent = formatCurrency(summary.daily_average_expense);

    const prevBalanceEl = document.getElementById('previous-balance-info');
    if (prevBalanceEl) {
      if (summary.previous_balance && summary.previous_balance !== 0) {
        prevBalanceEl.textContent = `(Anterior: ${formatCurrency(summary.previous_balance)})`;
        prevBalanceEl.style.display = 'block';
      } else {
        prevBalanceEl.style.display = 'none';
      }
    }

    // Color balance based on value
    const balanceEl = document.getElementById('total-balance');
    if (summary.balance >= 0) {
      balanceEl.style.color = 'var(--color-income)';
    } else {
      balanceEl.style.color = 'var(--color-expense)';
    }
  }

  function renderTopCategories(categoryData, onClick) {
    const container = document.getElementById('top-categories-list');
    const expenses = categoryData
      .filter(d => d.type === 'expense')
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);

    if (expenses.length === 0) {
      container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 1rem;">Nenhum gasto registrado</p>';
      return;
    }

    const maxTotal = expenses[0].total;
    const totalExpense = categoryData.filter(d => d.type === 'expense').reduce((s, c) => s + c.total, 0);

    container.innerHTML = expenses.map((cat, i) => `
      <div class="top-category-item${onClick ? ' clickable' : ''}" data-category-id="${cat.category_id}" data-category-name="${escapeHtml(cat.name)}">
        <span class="top-category-rank">${i + 1}</span>
        <span class="top-category-icon">${cat.icon}</span>
        <div class="top-category-info">
          <div class="top-category-name">${cat.name}</div>
          <div class="top-category-bar">
            <div class="top-category-bar-fill" style="width: ${(cat.total / maxTotal * 100).toFixed(1)}%; background: ${cat.color};"></div>
          </div>
        </div>
        <span class="top-category-value">${formatCurrency(cat.total)}</span>
        <span class="top-category-percent">${((cat.total / totalExpense) * 100).toFixed(0)}%</span>
      </div>
    `).join('');

    if (onClick) {
      container.querySelectorAll('.top-category-item').forEach(item => {
        item.addEventListener('click', () => {
          onClick(item.dataset.categoryId, item.dataset.categoryName);
        });
      });
    }
  }

  // ─── Year Select ───────────────────────────────────────────────
  function renderYearSelect(years) {
    const select = document.getElementById('dashboard-year');
    select.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  }

  // ─── Transactions Table ────────────────────────────────────────
  function renderTransactions(result, onEdit, onDelete) {
    const { data, total, limit, offset } = result;
    const tbody = document.getElementById('transactions-tbody');
    const countEl = document.getElementById('transactions-count');
    const emptyEl = document.getElementById('transactions-empty');
    const tableWrapper = document.querySelector('.table-wrapper');

    countEl.textContent = `(${total})`;

    if (data.length === 0) {
      tbody.innerHTML = '';
      if (tableWrapper) tableWrapper.style.display = 'none';
      emptyEl.style.display = 'block';
      renderPagination(0, 0, 0);
      return;
    }

    if (tableWrapper) tableWrapper.style.display = 'block';
    emptyEl.style.display = 'none';

    tbody.innerHTML = data.map(t => `
      <tr>
        <td>${formatDate(t.date)}</td>
        <td>${escapeHtml(t.description)} ${t.installments_total > 1 ? `<span class="text-muted" style="font-size: 0.8em;">(${t.installment_number}/${t.installments_total})</span>` : ''}</td>
        <td>
          <div class="td-category">
            <span class="category-dot" style="background: ${t.category_color}"></span>
            ${t.category_icon} ${escapeHtml(t.category_name)}
          </div>
        </td>
        <td>
          <span class="type-badge type-badge-${t.type}">
            ${t.type === 'income' ? '📈 Receita' : '📉 Despesa'}
          </span>
        </td>
        <td class="td-amount ${t.type}">
          ${t.type === 'income' ? '+' : '-'} ${formatCurrency(t.amount)}
        </td>
        <td>
          <div class="td-actions">
            <button class="btn-icon btn-icon-edit" data-id="${t.id}" title="Editar" aria-label="Editar transação">✏️</button>
            <button class="btn-icon btn-icon-danger" data-id="${t.id}" title="Excluir" aria-label="Excluir transação">🗑️</button>
          </div>
        </td>
      </tr>
    `).join('');

    // Attach event handlers
    tbody.querySelectorAll('.btn-icon-edit').forEach(btn => {
      btn.addEventListener('click', () => onEdit(parseInt(btn.dataset.id)));
    });
    tbody.querySelectorAll('.btn-icon-danger').forEach(btn => {
      btn.addEventListener('click', () => onDelete(parseInt(btn.dataset.id)));
    });

    renderPagination(total, limit, offset);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Pagination ────────────────────────────────────────────────
  let onPageChange = null;

  function setOnPageChange(fn) {
    onPageChange = fn;
  }

  function renderPagination(total, limit, offset) {
    const container = document.getElementById('pagination');
    if (total <= limit) {
      container.innerHTML = '';
      return;
    }

    const totalPages = Math.ceil(total / limit);
    const currentPage = Math.floor(offset / limit) + 1;

    let html = '';

    html += `<button class="pagination-btn" data-offset="${(currentPage - 2) * limit}" ${currentPage === 1 ? 'disabled' : ''}>&laquo; Anterior</button>`;

    // Page numbers (show max 5)
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);

    for (let p = startPage; p <= endPage; p++) {
      html += `<button class="pagination-btn ${p === currentPage ? 'active' : ''}" data-offset="${(p - 1) * limit}">${p}</button>`;
    }

    html += `<button class="pagination-btn" data-offset="${currentPage * limit}" ${currentPage === totalPages ? 'disabled' : ''}>Próximo &raquo;</button>`;
    html += `<span class="pagination-info">${total} registro${total !== 1 ? 's' : ''}</span>`;

    container.innerHTML = html;

    container.querySelectorAll('.pagination-btn:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', () => {
        if (onPageChange) onPageChange(parseInt(btn.dataset.offset));
      });
    });
  }

  // ─── Category Select Population ────────────────────────────────
  function populateCategorySelect(selectId, categories, type = null) {
    const select = document.getElementById(selectId);
    if (!select) return;

    // Keep first option if it's a placeholder
    const firstOption = select.querySelector('option');
    const placeholder = firstOption && firstOption.value === '' ? firstOption.outerHTML : '';

    let filtered = categories;
    if (type) {
      filtered = categories.filter(c => c.type === type || c.type === 'both');
    }

    select.innerHTML = placeholder + filtered.map(c =>
      `<option value="${c.id}">${c.icon} ${c.name}</option>`
    ).join('');
  }

  // ─── Categories Grid ───────────────────────────────────────────
  function renderCategories(categories, onDelete) {
    const grid = document.getElementById('categories-grid');
    const typeLabels = { income: 'Receita', expense: 'Despesa', both: 'Ambos' };

    grid.innerHTML = categories.map(c => `
      <div class="category-card">
        <div class="category-card-icon" style="background: ${c.color}20;">${c.icon}</div>
        <div class="category-card-info">
          <div class="category-card-name">${escapeHtml(c.name)}</div>
          <div class="category-card-type">${typeLabels[c.type] || c.type}</div>
        </div>
        <button class="btn-icon btn-icon-danger category-card-delete" data-id="${c.id}" title="Excluir" aria-label="Excluir categoria">🗑️</button>
      </div>
    `).join('');

    grid.querySelectorAll('.category-card-delete').forEach(btn => {
      btn.addEventListener('click', () => onDelete(parseInt(btn.dataset.id)));
    });
  }

  // ─── Form Helpers ──────────────────────────────────────────────
  function resetForm() {
    document.getElementById('transaction-form').reset();
    document.getElementById('form-id').value = '';
    document.getElementById('form-type').value = 'expense';
    document.getElementById('form-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('form-title').textContent = 'Nova Transação';
    document.getElementById('btn-form-submit').textContent = 'Salvar Transação';
    document.getElementById('form-credit-card').style.display = 'none';
    document.getElementById('group-bank').style.display = 'block';
    document.getElementById('form-bank').required = true;
    document.getElementById('form-installments').value = '1';
    document.getElementById('group-installments').style.display = 'none';

    // Reset type toggle
    document.querySelectorAll('.type-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector('.type-btn-expense').classList.add('active');

    // Enable bank select if type is income
    document.getElementById('group-credit-card').style.display = 'block';
  }

  function populateForm(transaction) {
    document.getElementById('form-id').value = transaction.id;
    document.getElementById('form-type').value = transaction.type;
    document.getElementById('form-amount').value = transaction.amount;
    document.getElementById('form-description').value = transaction.description;
    document.getElementById('form-category').value = transaction.category_id;
    document.getElementById('form-date').value = transaction.date;
    document.getElementById('form-title').textContent = 'Editar Transação';
    document.getElementById('btn-form-submit').textContent = 'Atualizar Transação';

    // Credit card logic
    const useCardCheckbox = document.getElementById('form-use-card');
    const cardSelect = document.getElementById('form-credit-card');
    const bankSelect = document.getElementById('form-bank');
    const groupBank = document.getElementById('group-bank');
    const groupCard = document.getElementById('group-credit-card');
    const groupInstallments = document.getElementById('group-installments');
    const installmentsSelect = document.getElementById('form-installments');

    if (transaction.type === 'income') {
      groupCard.style.display = 'none';
      groupBank.style.display = 'block';
      useCardCheckbox.checked = false;
      cardSelect.style.display = 'none';
      cardSelect.value = '';
      bankSelect.value = transaction.bank_id || '';
      bankSelect.required = true;
      groupInstallments.style.display = 'none';
      installmentsSelect.value = '1';
    } else {
      groupCard.style.display = 'block';
      if (transaction.credit_card_id) {
        useCardCheckbox.checked = true;
        cardSelect.style.display = 'block';
        cardSelect.value = transaction.credit_card_id;
        groupBank.style.display = 'none';
        bankSelect.value = '';
        bankSelect.required = false;
        groupInstallments.style.display = 'block';
        installmentsSelect.value = transaction.installments_total || '1';
      } else {
        useCardCheckbox.checked = false;
        cardSelect.style.display = 'none';
        cardSelect.value = '';
        groupBank.style.display = 'block';
        bankSelect.value = transaction.bank_id || '';
        bankSelect.required = true;
        groupInstallments.style.display = 'none';
        installmentsSelect.value = '1';
      }
    }

    // Set type toggle
    document.querySelectorAll('.type-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.type-btn-${transaction.type}`).classList.add('active');
  }

  // ─── Credit Cards ─────────────────────────────────────────────

  function renderCreditCards(cards, onDelete, onInvoice, onEdit, onFutureInvoices) {
    const list = document.getElementById('cards-list');

    if (cards.length === 0) {
      list.innerHTML = '<p class="text-center text-muted" style="padding: 2rem;">Nenhum cartão cadastrado</p>';
      return;
    }

    list.innerHTML = cards.map(c => `
      <div class="card credit-card-item" style="border-left: 4px solid ${c.color}">
        <div class="cc-info">
          <h3 class="cc-name">${escapeHtml(c.name)}</h3>
          <div class="cc-dates">
            <span>Fecha: dia ${c.closing_day}</span>
            <span>Vence: dia ${c.due_day}</span>
          </div>
        </div>
        <div class="cc-limits">
          <div class="limit-bar">
            <div class="limit-bar-fill" style="width: ${Math.min(100, Math.max(0, (c.used_limit / c.card_limit * 100))).toFixed(1)}%; background: ${c.color};"></div>
          </div>
          <div class="limit-texts">
            <span>Limite: <strong>${formatCurrency(c.card_limit)}</strong></span>
            <span>Usado: ${formatCurrency(c.used_limit)}</span>
            <span>Disponível: ${formatCurrency(c.available_limit)}</span>
          </div>
        </div>
        <div class="cc-actions">
          <button class="btn btn-sm btn-ghost btn-edit-cc" data-id="${c.id}">✏️ Editar</button>
          <button class="btn btn-sm btn-secondary btn-invoice" data-id="${c.id}">Fatura</button>
          <button class="btn btn-sm btn-primary btn-future-invoices" data-id="${c.id}">🔮 Faturas Futuras</button>
          <button class="btn btn-sm btn-danger btn-delete-cc" data-id="${c.id}">Excluir</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.btn-edit-cc').forEach(btn => {
      btn.addEventListener('click', () => onEdit && onEdit(parseInt(btn.dataset.id)));
    });

    list.querySelectorAll('.btn-delete-cc').forEach(btn => {
      btn.addEventListener('click', () => onDelete(parseInt(btn.dataset.id)));
    });

    list.querySelectorAll('.btn-invoice').forEach(btn => {
      btn.addEventListener('click', () => onInvoice(parseInt(btn.dataset.id)));
    });

    list.querySelectorAll('.btn-future-invoices').forEach(btn => {
      btn.addEventListener('click', () => onFutureInvoices && onFutureInvoices(parseInt(btn.dataset.id)));
    });
  }

  function renderInvoice(invoiceData, onPay, onEditTx) {
    const card = invoiceData.card;
    const transactions = invoiceData.transactions;
    const total = invoiceData.total;

    document.getElementById('invoice-card-name').textContent = card.name;
    document.getElementById('invoice-details').style.display = 'block';

    const tbody = document.getElementById('invoice-tbody');

    if (transactions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding: 2rem;">Nenhum lançamento nesta fatura</td></tr>';
    } else {
      tbody.innerHTML = transactions.map(t => `
        <tr>
          <td>${formatDate(t.date)}</td>
          <td>${escapeHtml(t.description)}</td>
          <td>
            <span class="badge badge-category" style="background: ${t.category_color}20; color: ${t.category_color}">
              ${t.category_icon || '🏷️'} ${escapeHtml(t.category_name)}
            </span>
          </td>
          <td class="text-danger">${formatCurrency(t.amount)}</td>
          <td>
            <button class="btn btn-sm btn-ghost btn-edit-cc-tx" data-id="${t.id}" title="Editar compra">✏️ Editar</button>
          </td>
        </tr>
      `).join('') + `
        <tr class="invoice-total-row">
          <td colspan="3"><strong>Total da Fatura</strong></td>
          <td class="text-danger" colspan="2"><strong>${formatCurrency(total)}</strong></td>
        </tr>
      `;

      tbody.querySelectorAll('.btn-edit-cc-tx').forEach(btn => {
        btn.addEventListener('click', () => {
          const txId = parseInt(btn.dataset.id);
          const foundTx = transactions.find(t => t.id === txId);
          if (foundTx && onEditTx) onEditTx(foundTx);
        });
      });
    }

    const payBtn = document.getElementById('btn-pay-invoice');
    payBtn.onclick = () => onPay(card.id);
  }

  function renderFutureInvoices(card, futureInvoices, onEditTx) {
    const container = document.getElementById('future-invoices-details');
    const nameEl = document.getElementById('future-card-name');
    const pillsContainer = document.getElementById('future-months-pills');
    const monthTitleEl = document.getElementById('future-invoice-month-title');
    const closingEl = document.getElementById('future-invoice-closing');
    const dueEl = document.getElementById('future-invoice-due');
    const totalEl = document.getElementById('future-invoice-total');
    const tbody = document.getElementById('future-invoice-tbody');

    if (!container) return;

    nameEl.textContent = card.name;
    container.style.display = 'block';

    if (!futureInvoices || futureInvoices.length === 0) {
      pillsContainer.innerHTML = '<p class="text-muted" style="padding: var(--space-md);">Nenhuma fatura futura prevista para este cartão.</p>';
      document.getElementById('future-invoice-content').style.display = 'none';
      return;
    }

    document.getElementById('future-invoice-content').style.display = 'block';

    let activeMonthKey = futureInvoices[0].monthKey;

    function renderActiveMonth(invoice) {
      monthTitleEl.textContent = `Fatura de ${invoice.monthName}`;
      closingEl.textContent = formatDate(invoice.cutoffDate);
      dueEl.textContent = formatDate(invoice.dueDate);
      totalEl.textContent = formatCurrency(invoice.total);

      if (invoice.transactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding: 1.5rem;">Nenhum lançamento previsto nesta fatura</td></tr>';
      } else {
        tbody.innerHTML = invoice.transactions.map(t => `
          <tr>
            <td>${formatDate(t.date)}</td>
            <td><strong>${escapeHtml(t.description)}</strong></td>
            <td>
              <span class="badge badge-category" style="background: ${t.category_color}20; color: ${t.category_color}">
                ${t.category_icon || '🏷️'} ${escapeHtml(t.category_name)}
              </span>
            </td>
            <td class="text-danger" style="font-weight: 600;">${formatCurrency(t.amount)}</td>
            <td>
              <button class="btn btn-sm btn-ghost btn-edit-cc-tx" data-id="${t.id}">✏️ Editar</button>
            </td>
          </tr>
        `).join('');

        tbody.querySelectorAll('.btn-edit-cc-tx').forEach(btn => {
          btn.addEventListener('click', () => {
            const txId = parseInt(btn.dataset.id);
            const foundTx = invoice.transactions.find(t => t.id === txId);
            if (foundTx && onEditTx) onEditTx(foundTx);
          });
        });
      }
    }

    function renderPills() {
      pillsContainer.innerHTML = futureInvoices.map(inv => {
        const isActive = inv.monthKey === activeMonthKey;
        return `
          <button type="button" class="btn btn-sm btn-month-pill ${isActive ? 'btn-primary' : 'btn-ghost'}" data-key="${inv.monthKey}" style="flex-shrink: 0; display: flex; flex-direction: column; align-items: center; padding: 6px 14px; border-radius: var(--radius-lg); cursor: pointer; border: 1px solid ${isActive ? 'var(--accent-primary)' : 'var(--border-subtle)'}; min-width: 110px;">
            <span style="font-weight: 600; font-size: 12px; white-space: nowrap;">${inv.monthName}</span>
            <span style="font-size: 11px; font-weight: 700; opacity: 0.9; margin-top: 2px;">${formatCurrency(inv.total)}</span>
          </button>
        `;
      }).join('');

      pillsContainer.querySelectorAll('.btn-month-pill').forEach(btn => {
        btn.addEventListener('click', () => {
          activeMonthKey = btn.dataset.key;
          renderPills();
          const selectedInv = futureInvoices.find(inv => inv.monthKey === activeMonthKey);
          if (selectedInv) renderActiveMonth(selectedInv);
        });
      });
    }

    renderPills();
    renderActiveMonth(futureInvoices[0]);
  }

  function openEditCardModal(card) {
    document.getElementById('edit-card-id').value = card.id;
    document.getElementById('edit-card-name').value = card.name;
    document.getElementById('edit-card-limit').value = card.card_limit;
    document.getElementById('edit-card-closing').value = card.closing_day;
    document.getElementById('edit-card-due').value = card.due_day;
    document.getElementById('edit-card-color').value = card.color || '#14b8a6';

    const modal = document.getElementById('edit-card-modal');
    if (modal) modal.style.display = 'flex';
  }

  function closeEditCardModal() {
    const modal = document.getElementById('edit-card-modal');
    if (modal) modal.style.display = 'none';
  }

  function populateCreditCardSelect(cards, selectId = 'form-credit-card') {
    const select = document.getElementById(selectId);
    if (!select) return;

    select.innerHTML = '<option value="">Selecione o cartão...</option>' +
      cards.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  }

  function renderInvoicesTotal(total) {
    const el = document.getElementById('total-invoices');
    if (el) el.textContent = formatCurrency(total);
  }

  function renderInstallmentsTotal(total) {
    const el = document.getElementById('total-installments');
    if (el) el.textContent = formatCurrency(total);
  }

  function renderRealBalance(balance) {
    const el = document.getElementById('real-balance');
    if (el) {
      el.textContent = formatCurrency(balance);
      if (balance >= 0) {
        el.style.color = '#10b981';
      } else {
        el.style.color = 'var(--color-expense)';
      }
    }
  }

  // ─── Banks ────────────────────────────────────────────────────

  function renderBanks(banks, onDelete, onEdit) {
    const list = document.getElementById('banks-list');
    if (!list) return;

    if (banks.length === 0) {
      list.innerHTML = '<p class="text-center text-muted" style="padding: 2rem;">Nenhum banco cadastrado</p>';
      return;
    }

    list.innerHTML = banks.map(b => `
      <div class="card credit-card-item" style="border-left: 4px solid ${b.color}">
        <div class="cc-info">
          <h3 class="cc-name">${escapeHtml(b.name)}</h3>
        </div>
        <div class="cc-limits">
          <div class="limit-texts">
            <span>Saldo: ${formatCurrency(b.balance)}</span>
          </div>
        </div>
        <div class="cc-actions">
          <button class="btn btn-sm btn-secondary btn-edit-bank" data-id="${b.id}">Editar</button>
          <button class="btn btn-sm btn-danger btn-delete-bank" data-id="${b.id}">Excluir</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.btn-edit-bank').forEach(btn => {
      btn.addEventListener('click', () => onEdit && onEdit(parseInt(btn.dataset.id)));
    });

    list.querySelectorAll('.btn-delete-bank').forEach(btn => {
      btn.addEventListener('click', () => onDelete(parseInt(btn.dataset.id)));
    });
  }

  function openEditBankModal(bank) {
    const modal = document.getElementById('edit-bank-modal');
    if (!modal) return;
    document.getElementById('edit-bank-id').value = bank.id;
    document.getElementById('edit-bank-name').value = bank.name;
    document.getElementById('edit-bank-initial-balance').value = bank.balance !== undefined ? bank.balance : (bank.initial_balance || 0);
    document.getElementById('edit-bank-color').value = bank.color || '#3b82f6';
    modal.style.display = 'flex';
  }

  function closeEditBankModal() {
    const modal = document.getElementById('edit-bank-modal');
    if (modal) modal.style.display = 'none';
  }

  function populateBankSelect(banks, selectIds) {
    const options = '<option value="">Selecione o banco...</option>' +
      banks.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');

    selectIds.forEach(id => {
      const select = document.getElementById(id);
      if (select) select.innerHTML = options;
    });
  }

  function renderInstallments(installments, onEditInstallment) {
    const container = document.getElementById('installments-details');
    const tbody = document.getElementById('installments-tbody');

    if (!installments || installments.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    tbody.innerHTML = installments.map(i => `
      <tr>
        <td>${escapeHtml(i.description.replace(/ \(\d+\/\d+\)$/, ''))}</td>
        <td>${i.paid_installments} de ${i.total_installments}</td>
        <td>${i.total_installments - i.paid_installments}</td>
        <td class="td-amount expense">- ${formatCurrency(i.remaining_amount)}</td>
        <td class="td-amount expense">- ${formatCurrency(i.total_amount)}</td>
        <td>
          <button class="btn btn-sm btn-ghost btn-edit-cc-inst" data-sample-id="${i.sample_transaction_id}">✏️ Editar Compra</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.btn-edit-cc-inst').forEach(btn => {
      btn.addEventListener('click', () => {
        const sampleId = parseInt(btn.dataset.sampleId);
        if (sampleId && onEditInstallment) onEditInstallment(sampleId);
      });
    });
  }

  function renderRecurring(recurrings, onToggle, onDelete) {
    const tbody = document.getElementById('recurring-tbody');
    const emptyEl = document.getElementById('recurring-empty');
    const tableWrapper = tbody?.closest('.table-wrapper');

    if (!recurrings || recurrings.length === 0) {
      if (tableWrapper) tableWrapper.style.display = 'none';
      emptyEl.style.display = 'block';
      return;
    }

    if (tableWrapper) tableWrapper.style.display = 'block';
    emptyEl.style.display = 'none';

    const freqLabels = { monthly: 'Mensal', weekly: 'Semanal', yearly: 'Anual' };

    tbody.innerHTML = recurrings.map(r => `
      <tr style="${r.is_active ? '' : 'opacity: 0.5;'}">
        <td>
          <div class="td-category">
            <span class="category-dot" style="background: ${r.category_color}"></span>
            ${r.category_icon} ${escapeHtml(r.description)}
          </div>
        </td>
        <td>
          <span class="type-badge type-badge-${r.type}">
            ${r.type === 'income' ? '📈 Receita' : '📉 Despesa'}
          </span>
        </td>
        <td class="td-amount ${r.type}">
          ${r.type === 'income' ? '+' : '-'} ${formatCurrency(r.amount)}
        </td>
        <td>${freqLabels[r.frequency] || r.frequency}</td>
        <td>${formatDate(r.next_due_date)}</td>
        <td>
          <span class="type-badge ${r.is_active ? 'type-badge-income' : 'type-badge-expense'}" style="cursor: pointer;" data-toggle-id="${r.id}">
            ${r.is_active ? '✅ Ativa' : '⏸️ Pausada'}
          </span>
        </td>
        <td>
          <div class="td-actions">
            <button class="btn-icon btn-icon-danger" data-delete-id="${r.id}" title="Excluir" aria-label="Excluir recorrência">🗑️</button>
          </div>
        </td>
      </tr>
    `).join('');

    // Attach event handlers
    tbody.querySelectorAll('[data-toggle-id]').forEach(el => {
      el.addEventListener('click', () => onToggle(parseInt(el.dataset.toggleId)));
    });
    tbody.querySelectorAll('[data-delete-id]').forEach(btn => {
      btn.addEventListener('click', () => onDelete(parseInt(btn.dataset.deleteId)));
    });
  }

  // ─── Vehicle Functions ───────────────────────────────────────

  function renderVehicles(vehicles, onSelect, onDelete) {
    const grid = document.getElementById('vehicles-grid');
    if (!grid) return;

    if (vehicles.length === 0) {
      grid.innerHTML = '<p style="padding: 2rem; color: var(--text-muted); text-align: center;">Nenhum veículo cadastrado</p>';
      return;
    }

    grid.innerHTML = `<div class="cards-list" style="margin: var(--space-xl);">${vehicles.map(v => `
      <div class="card credit-card-item vehicle-card" style="border-left: 4px solid ${v.color}; cursor: pointer;" data-id="${v.id}">
        <div class="cc-info">
          <h3 class="cc-name">${escapeHtml(v.icon)} ${escapeHtml(v.name)}</h3>
          <div class="cc-dates">
            <span>${v.brand ? escapeHtml(v.brand) : ''}${v.model ? ' ' + escapeHtml(v.model) : ''}${v.year ? ' (' + v.year + ')' : ''}</span>
            <span>${v.license_plate ? '🔖 ' + escapeHtml(v.license_plate) : ''}</span>
          </div>
        </div>
        <div class="cc-limits">
          <div class="limit-texts">
            <span style="color: var(--color-expense);">Total gasto: ${formatCurrency(v.total_spent)}</span>
            <span style="color: var(--text-muted);">${v.transaction_count} transações</span>
          </div>
        </div>
        <div class="cc-actions">
          <button class="btn btn-sm btn-secondary btn-view-vehicle" data-id="${v.id}">📊 Dashboard</button>
          <button class="btn btn-sm btn-danger btn-delete-vehicle" data-id="${v.id}">Excluir</button>
        </div>
      </div>
    `).join('')}</div>`;

    grid.querySelectorAll('.btn-view-vehicle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelect(parseInt(btn.dataset.id));
      });
    });

    grid.querySelectorAll('.btn-delete-vehicle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onDelete(parseInt(btn.dataset.id));
      });
    });

    grid.querySelectorAll('.vehicle-card').forEach(card => {
      card.addEventListener('click', () => onSelect(parseInt(card.dataset.id)));
    });
  }

  function renderVehicleDashboard(stats, transactions) {
    const dashboard = document.getElementById('vehicle-dashboard');
    const header = document.getElementById('vehicle-dashboard-header');
    const summaryCards = document.getElementById('vehicle-summary-cards');
    const tbody = document.getElementById('vehicle-transactions-tbody');

    if (!dashboard || !stats) return;
    dashboard.style.display = 'block';

    const v = stats.vehicle;
    header.innerHTML = `
      <div class="card" style="margin: var(--space-xl); border-left: 4px solid ${v.color};">
        <div style="display: flex; align-items: center; gap: var(--space-md); flex-wrap: wrap;">
          <span style="font-size: 2rem;">${v.icon}</span>
          <div>
            <h2 style="font-weight: 800; margin: 0;">${escapeHtml(v.name)}</h2>
            <p style="color: var(--text-secondary); font-size: var(--font-size-sm); margin: 0;">
              ${v.brand ? escapeHtml(v.brand) : ''}${v.model ? ' ' + escapeHtml(v.model) : ''}${v.year ? ' (' + v.year + ')' : ''}
              ${v.license_plate ? ' • ' + escapeHtml(v.license_plate) : ''}
            </p>
          </div>
          <button class="btn btn-sm btn-ghost" id="btn-close-vehicle-dashboard" style="margin-left: auto;">✕ Fechar</button>
        </div>
      </div>
    `;

    document.getElementById('btn-close-vehicle-dashboard').addEventListener('click', () => {
      dashboard.style.display = 'none';
    });

    summaryCards.innerHTML = `
      <div class="card summary-card card-expense" style="animation: card-enter 0.5s ease backwards; animation-delay: 0.05s;">
        <div class="card-icon">💸</div>
        <div class="card-info">
          <span class="card-label">Total Gasto</span>
          <span class="card-value" style="color: var(--color-expense);">${formatCurrency(stats.total_spent)}</span>
        </div>
      </div>
      <div class="card summary-card card-avg" style="animation: card-enter 0.5s ease backwards; animation-delay: 0.1s;">
        <div class="card-icon">📅</div>
        <div class="card-info">
          <span class="card-label">Média Mensal</span>
          <span class="card-value" style="color: var(--color-warning);">${formatCurrency(stats.avg_monthly)}</span>
        </div>
      </div>
      <div class="card summary-card" style="animation: card-enter 0.5s ease backwards; animation-delay: 0.15s;">
        <div class="card-icon" style="background: rgba(99, 102, 241, 0.1);">📋</div>
        <div class="card-info">
          <span class="card-label">Transações</span>
          <span class="card-value" style="color: var(--accent-primary);">${stats.transaction_count}</span>
        </div>
      </div>
    `;
    summaryCards.style.padding = 'var(--space-xl)';

    // Render transactions table
    if (transactions && transactions.data && transactions.data.length > 0) {
      tbody.innerHTML = transactions.data.map(t => `
        <tr>
          <td>${new Date(t.date + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
          <td>${escapeHtml(t.description)}</td>
          <td><span class="td-category"><span class="category-dot" style="background: ${t.category_color};"></span> ${escapeHtml(t.category_name)}</span></td>
          <td class="td-amount ${t.type}">
            ${t.type === 'expense' ? '- ' : '+ '}${formatCurrency(t.amount)}
          </td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="4" class="table-empty">Nenhuma transação encontrada</td></tr>';
    }
  }

  function populateVehicleSelect(vehicles) {
    const select = document.getElementById('form-vehicle');
    if (!select) return;
    select.innerHTML = '<option value="">Nenhum</option>' +
      vehicles.map(v => `<option value="${v.id}">${escapeHtml(v.icon)} ${escapeHtml(v.name)}</option>`).join('');
  }

  // ── Analytics: Trend indicators on KPI cards ──
  function renderTrends(trends) {
    if (!trends) return;

    const renderTrendBadge = (elementId, changePct, invert) => {
      const el = document.getElementById(elementId);
      if (!el) return;
      if (changePct === 0 || changePct === null || changePct === undefined) {
        el.innerHTML = '';
        return;
      }
      const isUp = changePct > 0;
      // For expenses, up is bad (red), down is good (green). Invert logic.
      let isPositive = isUp;
      if (invert) isPositive = !isUp;

      const arrow = isUp ? '↑' : '↓';
      const colorClass = isPositive ? 'trend-positive' : 'trend-negative';
      el.innerHTML = `<span class="trend-badge ${colorClass}">${arrow} ${Math.abs(changePct).toFixed(1)}%</span>`;
    };

    renderTrendBadge('trend-income', trends.income_change_pct, false);
    renderTrendBadge('trend-expense', trends.expense_change_pct, true);
  }

  // ── Analytics: Insights panel (projection, burn rate, savings) ──
  function renderInsights(analytics) {
    if (!analytics) return;

    const { projection, financial_health } = analytics;

    // Projection
    const projIncome = document.getElementById('proj-income');
    const projExpense = document.getElementById('proj-expense');
    const projBalance = document.getElementById('proj-balance');
    if (projIncome) projIncome.textContent = formatCurrency(projection.next_month_income);
    if (projExpense) projExpense.textContent = formatCurrency(projection.next_month_expense);
    if (projBalance) {
      projBalance.textContent = formatCurrency(projection.next_month_balance);
      projBalance.style.color = projection.next_month_balance >= 0 ? 'var(--color-income)' : 'var(--color-expense)';
    }

    // Financial health indicators
    const savingsEl = document.getElementById('savings-rate');
    if (savingsEl) {
      const sr = financial_health.savings_rate;
      savingsEl.textContent = `${sr.toFixed(1)}%`;
      savingsEl.style.color = sr >= 20 ? 'var(--color-income)' : sr >= 0 ? '#f0a500' : 'var(--color-expense)';
    }

    const burnEl = document.getElementById('burn-rate');
    if (burnEl) {
      const days = financial_health.burn_rate_days;
      if (days >= 999) {
        burnEl.textContent = '∞';
        burnEl.style.color = 'var(--color-income)';
      } else {
        burnEl.textContent = `${days} dias`;
        burnEl.style.color = days >= 90 ? 'var(--color-income)' : days >= 30 ? '#f0a500' : 'var(--color-expense)';
      }
    }

    const stabilityEl = document.getElementById('income-stability');
    if (stabilityEl) {
      stabilityEl.textContent = `${financial_health.income_stability}%`;
      stabilityEl.style.color = financial_health.income_stability >= 70 ? 'var(--color-income)' : '#f0a500';
    }

    // Real balance detail
    const realDetailEl = document.getElementById('real-balance-detail');
    if (realDetailEl && financial_health.accumulated_balance !== undefined) {
      realDetailEl.textContent = `Saldo acumulado total`;
      realDetailEl.style.display = 'block';
    }
  }

  // ── Analytics: Alerts list ──
  function renderAlerts(alerts) {
    const container = document.getElementById('alerts-list');
    if (!container) return;

    if (!alerts || alerts.length === 0) {
      container.innerHTML = '<p class="empty-alerts">✅ Tudo em ordem — nenhum alerta</p>';
      return;
    }

    container.innerHTML = alerts.map(alert => {
      let alertClass = 'alert-info';
      if (alert.type === 'spike' || alert.type === 'new_high') alertClass = 'alert-warning';
      else if (alert.type === 'warning') alertClass = 'alert-danger';
      else if (alert.type === 'positive') alertClass = 'alert-success';

      return `
        <div class="alert-item ${alertClass}">
          <span class="alert-icon">${alert.icon || '💡'}</span>
          <span class="alert-message">${escapeHtml(alert.message)}</span>
        </div>
      `;
    }).join('');
  }

  // ── Analytics: Recent Transactions mini-list ──
  function renderRecentTransactions(transactions) {
    const container = document.getElementById('recent-tx-list');
    if (!container) return;

    if (!transactions || transactions.length === 0) {
      container.innerHTML = '<p class="empty-recent">Nenhuma transação recente</p>';
      return;
    }

    container.innerHTML = transactions.map(tx => {
      const isExpense = tx.type === 'expense';
      const sign = isExpense ? '-' : '+';
      const colorClass = isExpense ? 'expense-color' : 'income-color';
      const dateStr = tx.date ? tx.date.split('-').reverse().join('/') : '';
      
      return `
        <div class="recent-tx-item">
          <div class="recent-tx-icon" style="background: ${tx.category_color}22; color: ${tx.category_color};">
            ${tx.category_icon || '📁'}
          </div>
          <div class="recent-tx-info">
            <span class="recent-tx-desc">${escapeHtml(tx.description)}</span>
            <span class="recent-tx-meta">${tx.category_name} • ${dateStr}</span>
          </div>
          <span class="recent-tx-amount ${colorClass}">${sign} ${formatCurrency(tx.amount)}</span>
        </div>
      `;
    }).join('');
  }

  function openEditCCTransactionModal(tx, categories) {
    document.getElementById('edit-cc-tx-id').value = tx.id;
    const cleanDesc = tx.description ? tx.description.replace(/ \(\d+\/\d+\)$/, '') : '';
    document.getElementById('edit-cc-tx-description').value = cleanDesc;
    document.getElementById('edit-cc-tx-amount').value = tx.amount;
    document.getElementById('edit-cc-tx-date').value = tx.date ? tx.date.split('T')[0] : '';

    const catSelect = document.getElementById('edit-cc-tx-category');
    if (catSelect && categories) {
      catSelect.innerHTML = categories.map(c =>
        `<option value="${c.id}" ${c.id === tx.category_id ? 'selected' : ''}>${c.icon} ${escapeHtml(c.name)}</option>`
      ).join('');
    }

    const hint = document.getElementById('edit-cc-tx-date-hint');
    if (tx.installment_id) {
      document.getElementById('edit-cc-tx-title').textContent = 'Editar Compra Parcelada no Cartão';
      if (hint) hint.style.display = 'block';
    } else {
      document.getElementById('edit-cc-tx-title').textContent = 'Editar Compra no Cartão';
      if (hint) hint.style.display = 'none';
    }

    const modal = document.getElementById('edit-cc-tx-modal');
    if (modal) modal.style.display = 'flex';
  }

  function closeEditCCTransactionModal() {
    const modal = document.getElementById('edit-cc-tx-modal');
    if (modal) modal.style.display = 'none';
  }

  // ─── Authentication UI ───────────────────────────────────────
  function showAuthOverlay(mode = 'login', errorMsg = null) {
    const overlay = document.getElementById('auth-overlay');
    const titleEl = document.getElementById('auth-title');
    const subtitleEl = document.getElementById('auth-subtitle');
    const submitBtn = document.getElementById('btn-auth-submit');
    const confirmGroup = document.getElementById('auth-confirm-group');
    const confirmInput = document.getElementById('auth-confirm-password');
    const passInput = document.getElementById('auth-password');
    const hintEl = document.getElementById('auth-mode-hint');
    const errorBox = document.getElementById('auth-error');

    if (!overlay) return;

    overlay.dataset.mode = mode;
    overlay.classList.remove('hidden');

    if (errorMsg) {
      errorBox.textContent = errorMsg;
      errorBox.classList.remove('hidden');
      const card = overlay.querySelector('.auth-card');
      if (card) {
        card.classList.remove('shake');
        void card.offsetWidth; // trigger reflow
        card.classList.add('shake');
      }
    } else {
      errorBox.classList.add('hidden');
      errorBox.textContent = '';
    }

    if (mode === 'setup') {
      titleEl.textContent = 'Criar Senha de Acesso';
      subtitleEl.textContent = 'Defina uma senha mestre para proteger suas finanças no Supabase e Vercel.';
      submitBtn.textContent = 'Salvar e Acessar';
      if (confirmGroup) confirmGroup.style.display = 'block';
      if (confirmInput) {
        confirmInput.required = true;
        confirmInput.value = '';
      }
      if (hintEl) hintEl.textContent = 'Guarde sua senha com segurança. Ela protege todo o sistema.';
    } else {
      titleEl.textContent = 'Acesso ao FinançasPro';
      subtitleEl.textContent = 'Digite sua senha para desbloquear o sistema.';
      submitBtn.textContent = 'Entrar no Sistema';
      if (confirmGroup) confirmGroup.style.display = 'none';
      if (confirmInput) {
        confirmInput.required = false;
        confirmInput.value = '';
      }
      if (hintEl) hintEl.textContent = 'Acesso seguro autenticado.';
    }

    if (passInput) {
      passInput.value = '';
      setTimeout(() => passInput.focus(), 150);
    }
  }

  function hideAuthOverlay() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
      const passInput = document.getElementById('auth-password');
      if (passInput) passInput.value = '';
      const confirmInput = document.getElementById('auth-confirm-password');
      if (confirmInput) confirmInput.value = '';
      const errorBox = document.getElementById('auth-error');
      if (errorBox) errorBox.classList.add('hidden');
    }
  }

  function openChangePasswordModal() {
    const modal = document.getElementById('change-password-modal');
    if (!modal) return;
    const form = document.getElementById('change-password-form');
    if (form) form.reset();
    const errorBox = document.getElementById('change-password-error');
    if (errorBox) errorBox.classList.add('hidden');
    modal.style.display = 'flex';
    const currentInput = document.getElementById('change-current-password');
    if (currentInput) setTimeout(() => currentInput.focus(), 100);
  }

  function closeChangePasswordModal() {
    const modal = document.getElementById('change-password-modal');
    if (modal) modal.style.display = 'none';
  }

  return {
    showToast,
    showConfirm,
    formatCurrency,
    formatDate,
    escapeHtml,
    renderSummary,
    renderTopCategories,
    renderYearSelect,
    renderTransactions,
    setOnPageChange,
    populateCategorySelect,
    renderCategories,
    resetForm,
    populateForm,
    renderCreditCards,
    openEditCardModal,
    closeEditCardModal,
    populateCreditCardSelect,
    renderInvoice,
    renderFutureInvoices,
    openEditCCTransactionModal,
    closeEditCCTransactionModal,
    renderInvoicesTotal,
    renderInstallmentsTotal,
    renderRealBalance,
    renderBanks,
    openEditBankModal,
    closeEditBankModal,
    populateBankSelect,
    renderInstallments,
    renderRecurring,
    renderVehicles,
    renderVehicleDashboard,
    populateVehicleSelect,
    // Analytics
    renderTrends,
    renderInsights,
    renderAlerts,
    renderRecentTransactions,
    // Auth UI
    showAuthOverlay,
    hideAuthOverlay,
    openChangePasswordModal,
    closeChangePasswordModal,
  };
})();

