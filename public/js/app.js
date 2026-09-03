/**
 * FinançasPro — Main Application Module
 * Initializes the app, manages navigation, and orchestrates data loading.
 */
(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────
  let allCategories = [];
  let allCreditCards = [];
  let allBanks = [];
  let currentPage = 'dashboard';
  let transactionFilters = { limit: 20, offset: 0 };
  let dashboardPeriod = 'month'; // 'month' | 'year' | 'custom'
  let dashboardDate = new Date(); // Reference date for month/year navigation
  let dashboardCustomStart = '';
  let dashboardCustomEnd = '';
  let dashboardSelectedCategory = null;
  let dashboardSelectedCategoryName = null;
  let allTransactionsCache = null;
  let currentInvoiceCardId = null;

  // ─── Navigation ───────────────────────────────────────────────
  let allVehicles = [];

  const pageTitles = {
    dashboard: 'Dashboard',
    transactions: 'Transações',
    cards: 'Cartões de Crédito',
    banks: 'Bancos',
    add: 'Nova Transação',
    categories: 'Categorias',
    recurring: 'Transações Recorrentes',
    vehicles: 'Veículos',
  };

  function navigateTo(page) {
    currentPage = page;

    // Update nav links
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.page === page);
    });

    // Update pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('page-active'));
    const pageEl = document.getElementById(`page-${page}`);
    if (pageEl) pageEl.classList.add('page-active');

    // Update topbar
    document.getElementById('topbar-title').textContent = pageTitles[page] || 'FinançasPro';

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('active');

    // Load page data
    if (page === 'dashboard') loadDashboard();
    if (page === 'transactions') loadTransactions();
    if (page === 'cards') loadCards();
    if (page === 'banks') loadBanks();
    if (page === 'add') prepareAddForm();
    if (page === 'categories') loadCategories();
    if (page === 'recurring') loadRecurring();
    if (page === 'vehicles') loadVehicles();

    // Update hash
    window.location.hash = page;
  }

  // ─── Dashboard ────────────────────────────────────────────────

  function getDashboardFilters() {
    const filters = {};
    const y = dashboardDate.getFullYear();
    const m = String(dashboardDate.getMonth() + 1).padStart(2, '0');

    if (dashboardPeriod === 'month') {
      filters.month = `${y}-${m}`;
      filters.start_date = `${y}-${m}-01`;
      const lastDay = new Date(y, dashboardDate.getMonth() + 1, 0).getDate();
      filters.end_date = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
    } else if (dashboardPeriod === 'year') {
      filters.start_date = `${y}-01-01`;
      filters.end_date = `${y}-12-31`;
    } else if (dashboardPeriod === 'custom') {
      if (dashboardCustomStart) filters.start_date = dashboardCustomStart;
      if (dashboardCustomEnd) filters.end_date = dashboardCustomEnd;
    }
    
    if (dashboardSelectedCategory) {
      filters.category_id = dashboardSelectedCategory;
    }

    return { filters, year: y };
  }

  function syncDashboardUI() {
    const monthNav = document.getElementById('dashboard-month-nav');
    const dateInputs = document.getElementById('dashboard-date-inputs');
    const picker = document.getElementById('dashboard-month-picker');
    const categoryFilter = document.getElementById('dashboard-category-filter');
    const categoryName = document.getElementById('dashboard-category-name');

    if (dashboardSelectedCategory) {
      categoryFilter.style.display = 'block';
      categoryName.textContent = dashboardSelectedCategoryName || 'Categoria selecionada';
    } else {
      categoryFilter.style.display = 'none';
    }

    document.querySelectorAll('.btn-period').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.period === dashboardPeriod);
    });

    if (dashboardPeriod === 'custom') {
      monthNav.style.display = 'none';
      dateInputs.style.display = 'flex';
      document.getElementById('dashboard-start').value = dashboardCustomStart;
      document.getElementById('dashboard-end').value = dashboardCustomEnd;
    } else {
      dateInputs.style.display = 'none';
      monthNav.style.display = 'flex';
      const y = dashboardDate.getFullYear();
      const m = String(dashboardDate.getMonth() + 1).padStart(2, '0');
      picker.value = `${y}-${m}`;
    }
  }


  function handleDashboardCategoryClick(categoryId, categoryName) {
    if (dashboardSelectedCategory === categoryId) {
      // Toggle off if clicking the same category
      dashboardSelectedCategory = null;
      dashboardSelectedCategoryName = null;
    } else {
      dashboardSelectedCategory = categoryId;
      dashboardSelectedCategoryName = categoryName;
    }
    loadDashboard();
  }

  async function loadDashboard() {
    try {
      const { filters, year } = getDashboardFilters();

      syncDashboardUI();

      const [summary, byCategory, monthly, balanceHistory, cards, installmentsData, analytics] = await Promise.all([
        api.getSummary(filters),
        api.getByCategory({ type: 'expense', ...filters }),
        api.getMonthly({ year, ...filters }),
        api.getBalanceHistory(filters),
        api.getCreditCards(),
        api.getTotalInstallments(),
        api.getAnalytics(filters),
      ]);

      UI.renderSummary(summary);
      UI.renderTopCategories(byCategory, handleDashboardCategoryClick);

      const totalInvoices = cards.reduce((sum, c) => sum + c.used_limit, 0);
      UI.renderInvoicesTotal(totalInvoices);

      // Installments total and real balance (balance - pending installments)
      const totalInstallments = installmentsData.total || 0;
      UI.renderInstallmentsTotal(totalInstallments);
      UI.renderRealBalance(summary.balance - totalInvoices);

      // Analytics: trends, insights, alerts, recent transactions
      if (analytics) {
        UI.renderTrends(analytics.trends);
        UI.renderInsights(analytics);
        UI.renderAlerts(analytics.alerts);
        UI.renderRecentTransactions(analytics.recent_transactions);
        
        // Health score gauge
        ChartsManager.renderHealthGauge(analytics.financial_health.score);
        
        // Balance chart with projected months
        ChartsManager.renderBalanceChart(balanceHistory, analytics.projection.projected_months);
        
        // Expense composition chart
        ChartsManager.renderExpenseCompositionChart(analytics.expense_composition);
      } else {
        ChartsManager.renderBalanceChart(balanceHistory);
      }

      ChartsManager.renderMonthlyChart(monthly);
      ChartsManager.renderCategoryChart(byCategory, handleDashboardCategoryClick);
    } catch (err) {
      UI.showToast('Erro ao carregar dashboard: ' + err.message, 'error');
    }
  }

  // ─── Transactions ─────────────────────────────────────────────
  async function loadTransactions() {
    try {
      const result = await api.getTransactions(transactionFilters);
      allTransactionsCache = result;

      UI.renderTransactions(result, handleEditTransaction, handleDeleteTransaction);
    } catch (err) {
      UI.showToast('Erro ao carregar transações: ' + err.message, 'error');
    }
  }

  async function handleEditTransaction(id) {
    if (!allTransactionsCache) return;
    const transaction = allTransactionsCache.data.find(t => t.id === id);
    if (!transaction) return;

    // Load categories for the type
    UI.populateCategorySelect('form-category', allCategories, transaction.type);
    UI.populateForm(transaction);
    navigateTo('add');
  }

  async function handleDeleteTransaction(id) {
    const confirmed = await UI.showConfirm(
      'Excluir Transação',
      'Tem certeza que deseja excluir esta transação? Esta ação não pode ser desfeita.'
    );
    if (!confirmed) return;

    try {
      await api.deleteTransaction(id);
      UI.showToast('Transação excluída com sucesso!', 'success');
      loadTransactions();
    } catch (err) {
      UI.showToast('Erro ao excluir: ' + err.message, 'error');
    }
  }

  // ─── Add/Edit Form ────────────────────────────────────────────
  function prepareAddForm() {
    const formId = document.getElementById('form-id').value;
    if (!formId) {
      UI.resetForm();
      const type = document.getElementById('form-type').value || 'expense';
      UI.populateCategorySelect('form-category', allCategories, type);
    }
    UI.populateVehicleSelect(allVehicles);
  }

  async function handleFormSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('form-id').value;
    const type = document.getElementById('form-type').value;
    const amount = parseFloat(document.getElementById('form-amount').value);
    const description = document.getElementById('form-description').value.trim();
    const category_id = parseInt(document.getElementById('form-category').value);
    const date = document.getElementById('form-date').value;
    const useCard = document.getElementById('form-use-card').checked;
    const credit_card_id = useCard ? parseInt(document.getElementById('form-credit-card').value) : null;
    const bank_id = (!useCard && type === 'expense') || type === 'income' ? parseInt(document.getElementById('form-bank').value) : null;
    const installments = useCard ? parseInt(document.getElementById('form-installments').value) : 1;
    const vehicleSelect = document.getElementById('form-vehicle');
    const vehicle_id = vehicleSelect && vehicleSelect.value ? parseInt(vehicleSelect.value) : null;

    if (!type || !amount || !description || !category_id || !date) {
      UI.showToast('Preencha todos os campos obrigatórios', 'error');
      return;
    }

    if (useCard && !credit_card_id) {
      UI.showToast('Selecione o cartão de crédito', 'error');
      return;
    }

    if (!useCard && !bank_id) {
      UI.showToast('Selecione o banco', 'error');
      return;
    }

    if (amount <= 0) {
      UI.showToast('O valor deve ser maior que zero', 'error');
      return;
    }

    try {
      const data = { type, amount, description, category_id, date, vehicle_id };
      if (type === 'expense' && credit_card_id) {
        data.credit_card_id = credit_card_id;
        data.installments = installments;
      } else {
        data.bank_id = bank_id;
      }

      if (id) {
        await api.updateTransaction(id, data);
        UI.showToast('Transação atualizada com sucesso!', 'success');
      } else {
        await api.createTransaction(data);
        UI.showToast('Transação criada com sucesso!', 'success');
      }
      UI.resetForm();
      navigateTo('transactions');
    } catch (err) {
      UI.showToast('Erro: ' + err.message, 'error');
    }
  }

  // ─── Categories ───────────────────────────────────────────────
  async function loadCategories() {
    try {
      allCategories = await api.getCategories();
      UI.renderCategories(allCategories, handleDeleteCategory);
    } catch (err) {
      UI.showToast('Erro ao carregar categorias: ' + err.message, 'error');
    }
  }

  async function handleDeleteCategory(id) {
    const confirmed = await UI.showConfirm(
      'Excluir Categoria',
      'Tem certeza que deseja excluir esta categoria? Categorias com transações vinculadas não podem ser excluídas.'
    );
    if (!confirmed) return;

    try {
      await api.deleteCategory(id);
      UI.showToast('Categoria excluída!', 'success');
      allCategories = await api.getCategories();
      UI.renderCategories(allCategories, handleDeleteCategory);
    } catch (err) {
      UI.showToast('Erro: ' + err.message, 'error');
    }
  }

  async function handleCategorySubmit(e) {
    e.preventDefault();

    const name = document.getElementById('cat-name').value.trim();
    const type = document.getElementById('cat-type').value;
    const icon = document.getElementById('cat-icon').value || '📁';
    const color = document.getElementById('cat-color').value;

    if (!name || !type) {
      UI.showToast('Nome e tipo são obrigatórios', 'error');
      return;
    }

    try {
      await api.createCategory({ name, type, icon, color });
      UI.showToast('Categoria criada!', 'success');
      document.getElementById('category-form').reset();
      document.getElementById('cat-color').value = '#6366f1';
      allCategories = await api.getCategories();
      UI.renderCategories(allCategories, handleDeleteCategory);
    } catch (err) {
      UI.showToast('Erro: ' + err.message, 'error');
    }
  }

  // ─── Credit Cards ─────────────────────────────────────────────
  async function loadCards() {
    try {
      allCreditCards = await api.getCreditCards();
      UI.renderCreditCards(allCreditCards, handleDeleteCard, handleViewInvoice, handleEditCard, handleViewFutureInvoices);
      UI.populateCreditCardSelect(allCreditCards);
      document.getElementById('invoice-details').style.display = 'none';
      document.getElementById('installments-details').style.display = 'none';
      const futureEl = document.getElementById('future-invoices-details');
      if (futureEl) futureEl.style.display = 'none';
      currentInvoiceCardId = null;
    } catch (err) {
      UI.showToast('Erro ao carregar cartões: ' + err.message, 'error');
    }
  }

  function handleEditCard(id) {
    const card = allCreditCards.find(c => c.id === id);
    if (!card) return;
    UI.openEditCardModal(card);
  }

  async function handleEditCardSubmit(e) {
    e.preventDefault();
    const id = parseInt(document.getElementById('edit-card-id').value);
    const name = document.getElementById('edit-card-name').value.trim();
    const card_limit = parseFloat(document.getElementById('edit-card-limit').value);
    const closing_day = parseInt(document.getElementById('edit-card-closing').value);
    const due_day = parseInt(document.getElementById('edit-card-due').value);
    const color = document.getElementById('edit-card-color').value;

    try {
      await api.updateCreditCard(id, { name, card_limit, closing_day, due_day, color });
      UI.showToast('Cartão atualizado com sucesso!', 'success');
      UI.closeEditCardModal();
      loadCards();
    } catch (err) {
      UI.showToast('Erro ao atualizar cartão: ' + err.message, 'error');
    }
  }

  async function handleCardSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('card-name').value.trim();
    const card_limit = parseFloat(document.getElementById('card-limit').value);
    const closing_day = parseInt(document.getElementById('card-closing').value);
    const due_day = parseInt(document.getElementById('card-due').value);
    const color = document.getElementById('card-color').value;

    try {
      await api.createCreditCard({ name, card_limit, closing_day, due_day, color });
      UI.showToast('Cartão criado!', 'success');
      document.getElementById('card-form').reset();
      loadCards();
    } catch (err) {
      UI.showToast('Erro: ' + err.message, 'error');
    }
  }

  async function handleDeleteCard(id) {
    const confirmed = await UI.showConfirm('Excluir Cartão', 'Tem certeza que deseja excluir este cartão? (Só é possível se não houver transações)');
    if (!confirmed) return;
    try {
      await api.deleteCreditCard(id);
      UI.showToast('Cartão excluído', 'success');
      loadCards();
    } catch (err) {
      UI.showToast('Erro: ' + err.message, 'error');
    }
  }

  let activeCardIdForFuture = null;

  async function handleEditCCTransaction(tx) {
    if (!allCategories || allCategories.length === 0) {
      allCategories = await api.getCategories();
    }
    UI.openEditCCTransactionModal(tx, allCategories);
  }

  async function handleEditCCInstallment(sampleId) {
    try {
      if (!allCategories || allCategories.length === 0) {
        allCategories = await api.getCategories();
      }
      const tx = await api.getTransaction(sampleId);
      UI.openEditCCTransactionModal(tx, allCategories);
    } catch (err) {
      UI.showToast('Erro ao carregar compra: ' + err.message, 'error');
    }
  }

  async function handleEditCCTransactionSubmit(e) {
    e.preventDefault();
    const id = parseInt(document.getElementById('edit-cc-tx-id').value);
    const description = document.getElementById('edit-cc-tx-description').value.trim();
    const amount = parseFloat(document.getElementById('edit-cc-tx-amount').value);
    const date = document.getElementById('edit-cc-tx-date').value;
    const category_id = parseInt(document.getElementById('edit-cc-tx-category').value);

    if (!description || !amount || !date || !category_id) {
      UI.showToast('Preencha todos os campos obrigatórios', 'error');
      return;
    }

    try {
      await api.updateTransaction(id, { description, amount, date, category_id });
      UI.showToast('Compra atualizada com sucesso!', 'success');
      UI.closeEditCCTransactionModal();

      if (currentInvoiceCardId) {
        handleViewInvoice(currentInvoiceCardId);
      }
      if (activeCardIdForFuture) {
        handleViewFutureInvoices(activeCardIdForFuture);
      }
    } catch (err) {
      UI.showToast('Erro ao atualizar compra: ' + err.message, 'error');
    }
  }

  async function handleViewInvoice(id) {
    try {
      currentInvoiceCardId = id;
      const [invoiceData, installmentsData] = await Promise.all([
        api.getInvoice(id),
        api.getInstallments(id)
      ]);
      UI.renderInvoice(invoiceData, handlePayInvoice, handleEditCCTransaction);
      UI.renderInstallments(installmentsData, handleEditCCInstallment);
      document.getElementById('invoice-details').style.display = 'block';
      document.getElementById('invoice-details').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      UI.showToast('Erro ao carregar fatura: ' + err.message, 'error');
    }
  }

  async function handleViewFutureInvoices(id) {
    try {
      activeCardIdForFuture = id;
      const data = await api.getFutureInvoices(id);
      UI.renderFutureInvoices(data.card, data.future_invoices, handleEditCCTransaction);
      const detailsEl = document.getElementById('future-invoices-details');
      if (detailsEl) {
        detailsEl.style.display = 'block';
        detailsEl.scrollIntoView({ behavior: 'smooth' });
      }
    } catch (err) {
      UI.showToast('Erro ao carregar faturas futuras: ' + err.message, 'error');
    }
  }

  async function handlePayInvoice() {
    if (!currentInvoiceCardId) return;
    const bank_id = document.getElementById('invoice-pay-bank').value;
    if (!bank_id) {
      UI.showToast('Selecione o banco de onde sairá o pagamento', 'error');
      return;
    }

    const confirmed = await UI.showConfirm('Pagar Fatura', 'Isso descontará o valor total da fatura no seu saldo e marcará todos os gastos do cartão como pagos. Continuar?');
    if (!confirmed) return;

    try {
      await api.payInvoice(currentInvoiceCardId, bank_id);
      UI.showToast('Fatura paga com sucesso!', 'success');
      loadCards(); // reload to reset limits and hide invoice
    } catch (err) {
      UI.showToast('Erro ao pagar: ' + err.message, 'error');
    }
  }

  // ─── Banks ────────────────────────────────────────────────────
  async function loadBanks() {
    try {
      allBanks = await api.getBanks();
      UI.renderBanks(allBanks, handleDeleteBank, handleEditBank);
      UI.populateBankSelect(allBanks, ['transfer-from', 'transfer-to']);
      document.getElementById('transfer-date').value = new Date().toISOString().split('T')[0];
    } catch (err) {
      UI.showToast('Erro ao carregar bancos: ' + err.message, 'error');
    }
  }

  function handleEditBank(id) {
    const bank = allBanks.find(b => b.id === id);
    if (!bank) return;
    UI.openEditBankModal(bank);
  }

  async function handleEditBankSubmit(e) {
    e.preventDefault();
    const id = parseInt(document.getElementById('edit-bank-id').value);
    const name = document.getElementById('edit-bank-name').value.trim();
    const target_balance = parseFloat(document.getElementById('edit-bank-initial-balance').value);
    const color = document.getElementById('edit-bank-color').value;

    if (!name) {
      UI.showToast('Nome é obrigatório', 'error');
      return;
    }

    if (isNaN(target_balance)) {
      UI.showToast('Saldo informado é inválido', 'error');
      return;
    }

    try {
      await api.updateBank(id, { name, target_balance, color });
      UI.showToast('Saldo e banco atualizados com sucesso!', 'success');
      UI.closeEditBankModal();
      allCategories = await api.getCategories();
      UI.populateCategorySelect('filter-category', allCategories);
      loadBanks();
      if (currentPage === 'dashboard') loadDashboard();
      if (currentPage === 'transactions') loadTransactions();
    } catch (err) {
      UI.showToast('Erro ao atualizar banco: ' + err.message, 'error');
    }
  }

  async function handleDeleteBank(id) {
    const confirmed = await UI.showConfirm(
      'Excluir Banco',
      'Tem certeza que deseja excluir este banco? Bancos com transações vinculadas não podem ser excluídos.'
    );
    if (!confirmed) return;

    try {
      await api.deleteBank(id);
      UI.showToast('Banco excluído!', 'success');
      allBanks = await api.getBanks();
      UI.renderBanks(allBanks, handleDeleteBank, handleEditBank);
      UI.populateBankSelect(allBanks, ['form-bank', 'invoice-pay-bank']);
    } catch (err) {
      UI.showToast('Erro: ' + err.message, 'error');
    }
  }

  async function handleBankSubmit(e) {
    e.preventDefault();

    const name = document.getElementById('bank-name').value.trim();
    const initial_balance = parseFloat(document.getElementById('bank-initial-balance').value) || 0;
    const color = document.getElementById('bank-color').value;

    if (!name) {
      UI.showToast('Nome é obrigatório', 'error');
      return;
    }

    try {
      await api.createBank({ name, initial_balance, color });
      UI.showToast('Banco criado!', 'success');
      document.getElementById('bank-form').reset();
      document.getElementById('bank-color').value = '#3b82f6';
      allBanks = await api.getBanks();
      UI.renderBanks(allBanks, handleDeleteBank, handleEditBank);
      UI.populateBankSelect(allBanks, ['form-bank', 'invoice-pay-bank']);
    } catch (err) {
      UI.showToast('Erro: ' + err.message, 'error');
    }
  }

  async function handleTransferSubmit(e) {
    e.preventDefault();

    const from_bank_id = parseInt(document.getElementById('transfer-from').value);
    const to_bank_id = parseInt(document.getElementById('transfer-to').value);
    const amount = parseFloat(document.getElementById('transfer-amount').value);
    const description = document.getElementById('transfer-description').value.trim();
    const date = document.getElementById('transfer-date').value;

    if (!from_bank_id || !to_bank_id) {
      UI.showToast('Selecione os bancos de origem e destino', 'error');
      return;
    }
    if (from_bank_id === to_bank_id) {
      UI.showToast('Banco de origem e destino devem ser diferentes', 'error');
      return;
    }
    if (!amount || amount <= 0) {
      UI.showToast('Informe um valor válido', 'error');
      return;
    }
    if (!date) {
      UI.showToast('Informe a data', 'error');
      return;
    }

    try {
      const result = await api.createTransfer({ from_bank_id, to_bank_id, amount, description, date });
      UI.showToast(result.message || 'Transferência realizada!', 'success');
      document.getElementById('transfer-form').reset();
      document.getElementById('transfer-date').value = new Date().toISOString().split('T')[0];
      loadBanks();
    } catch (err) {
      UI.showToast('Erro: ' + err.message, 'error');
    }
  }

  // ─── Vehicles ─────────────────────────────────────────────────────
  let vehicleMonthlyChart = null;
  let vehicleCategoryChart = null;

  async function loadVehicles() {
    try {
      allVehicles = await api.getVehicles();
      UI.renderVehicles(allVehicles, loadVehicleDashboard, handleDeleteVehicle);
      document.getElementById('vehicle-dashboard').style.display = 'none';
    } catch (err) {
      UI.showToast('Erro ao carregar veículos: ' + err.message, 'error');
    }
  }

  async function handleVehicleSubmit(e) {
    e.preventDefault();

    const name = document.getElementById('vehicle-name').value.trim();
    const brand = document.getElementById('vehicle-brand').value.trim();
    const model = document.getElementById('vehicle-model').value.trim();
    const year = document.getElementById('vehicle-year').value ? parseInt(document.getElementById('vehicle-year').value) : null;
    const license_plate = document.getElementById('vehicle-plate').value.trim();
    const icon = document.getElementById('vehicle-icon').value;
    const color = document.getElementById('vehicle-color').value;

    if (!name) {
      UI.showToast('Nome é obrigatório', 'error');
      return;
    }

    try {
      await api.createVehicle({ name, brand, model, year, license_plate, icon, color });
      UI.showToast('Veículo cadastrado!', 'success');
      document.getElementById('vehicle-form').reset();
      document.getElementById('vehicle-color').value = '#6366f1';
      allVehicles = await api.getVehicles();
      UI.renderVehicles(allVehicles, loadVehicleDashboard, handleDeleteVehicle);
    } catch (err) {
      UI.showToast('Erro: ' + err.message, 'error');
    }
  }

  async function handleDeleteVehicle(id) {
    const confirmed = await UI.showConfirm(
      'Excluir Veículo',
      'Tem certeza que deseja excluir este veículo? Veículos com transações vinculadas não podem ser excluídos.'
    );
    if (!confirmed) return;

    try {
      await api.deleteVehicle(id);
      UI.showToast('Veículo excluído!', 'success');
      allVehicles = await api.getVehicles();
      UI.renderVehicles(allVehicles, loadVehicleDashboard, handleDeleteVehicle);
    } catch (err) {
      UI.showToast('Erro: ' + err.message, 'error');
    }
  }

  async function loadVehicleDashboard(id) {
    try {
      const [stats, transactions] = await Promise.all([
        api.getVehicleStats(id),
        api.getVehicleTransactions(id)
      ]);
      UI.renderVehicleDashboard(stats, transactions);

      // Destroy old charts
      if (vehicleMonthlyChart) { vehicleMonthlyChart.destroy(); vehicleMonthlyChart = null; }
      if (vehicleCategoryChart) { vehicleCategoryChart.destroy(); vehicleCategoryChart = null; }

      // Monthly bar chart
      if (stats.monthly && stats.monthly.length > 0) {
        const monthlyCtx = document.getElementById('vehicle-monthly-chart');
        if (monthlyCtx) {
          vehicleMonthlyChart = new Chart(monthlyCtx, {
            type: 'bar',
            data: {
              labels: stats.monthly.map(m => {
                const [y, mo] = m.month.split('-');
                return new Date(y, mo - 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
              }),
              datasets: [{
                label: 'Gastos',
                data: stats.monthly.map(m => m.total),
                backgroundColor: 'rgba(239, 68, 68, 0.6)',
                borderColor: 'rgba(239, 68, 68, 1)',
                borderWidth: 1,
                borderRadius: 6,
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                y: { beginAtZero: true, ticks: { color: '#a1a1aa' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { ticks: { color: '#a1a1aa' }, grid: { display: false } }
              }
            }
          });
        }
      }

      // Category doughnut chart
      if (stats.by_category && stats.by_category.length > 0) {
        const catCtx = document.getElementById('vehicle-category-chart');
        if (catCtx) {
          vehicleCategoryChart = new Chart(catCtx, {
            type: 'doughnut',
            data: {
              labels: stats.by_category.map(c => c.icon + ' ' + c.name),
              datasets: [{
                data: stats.by_category.map(c => c.total),
                backgroundColor: stats.by_category.map(c => c.color),
                borderWidth: 0,
                hoverOffset: 8,
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              cutout: '65%',
              plugins: {
                legend: {
                  position: 'bottom',
                  labels: { color: '#e4e4e7', padding: 12, usePointStyle: true, font: { size: 11 } }
                }
              }
            }
          });
        }
      }

      // Scroll to dashboard
      document.getElementById('vehicle-dashboard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      UI.showToast('Erro ao carregar dashboard do veículo: ' + err.message, 'error');
    }
  }

  // ─── Recurring Transactions ───────────────────────────────────────
  async function loadRecurring() {
    try {
      const recurrings = await api.getRecurring();
      UI.renderRecurring(recurrings, handleToggleRecurring, handleDeleteRecurring);
      // Populate form selects
      UI.populateCategorySelect('recurring-category', allCategories, 'expense');
      UI.populateBankSelect(allBanks, ['recurring-bank']);
      UI.populateCreditCardSelect(allCreditCards, 'recurring-credit-card');
      document.getElementById('recurring-start-date').value = new Date().toISOString().split('T')[0];
    } catch (err) {
      UI.showToast('Erro ao carregar recorrências: ' + err.message, 'error');
    }
  }

  async function handleRecurringSubmit(e) {
    e.preventDefault();
    const type = document.getElementById('recurring-type').value;
    const amount = parseFloat(document.getElementById('recurring-amount').value);
    const description = document.getElementById('recurring-description').value.trim();
    const category_id = parseInt(document.getElementById('recurring-category').value);
    const frequency = document.getElementById('recurring-frequency').value;
    const start_date = document.getElementById('recurring-start-date').value;
    const useCard = document.getElementById('recurring-use-card').checked;
    const credit_card_id = useCard ? parseInt(document.getElementById('recurring-credit-card').value) : null;
    const bank_id = !useCard ? parseInt(document.getElementById('recurring-bank').value) : null;

    if (!type || !amount || !description || !category_id || !frequency || !start_date) {
      UI.showToast('Preencha todos os campos obrigatórios', 'error');
      return;
    }
    if (useCard && !credit_card_id) {
      UI.showToast('Selecione o cartão de crédito', 'error');
      return;
    }
    if (!useCard && !bank_id) {
      UI.showToast('Selecione o banco', 'error');
      return;
    }

    try {
      const data = { type, amount, description, category_id, frequency, start_date };
      if (useCard) {
        data.credit_card_id = credit_card_id;
      } else {
        data.bank_id = bank_id;
      }
      await api.createRecurring(data);
      UI.showToast('Transação recorrente criada!', 'success');
      document.getElementById('recurring-form').reset();
      document.getElementById('recurring-type').value = 'expense';
      document.getElementById('recurring-start-date').value = new Date().toISOString().split('T')[0];
      loadRecurring();
    } catch (err) {
      UI.showToast('Erro: ' + err.message, 'error');
    }
  }

  async function handleToggleRecurring(id) {
    try {
      await api.toggleRecurring(id);
      loadRecurring();
    } catch (err) {
      UI.showToast('Erro: ' + err.message, 'error');
    }
  }

  async function handleDeleteRecurring(id) {
    const confirmed = await UI.showConfirm('Excluir Recorrência', 'Tem certeza que deseja excluir esta transação recorrente? As transações já geradas serão mantidas.');
    if (!confirmed) return;
    try {
      await api.deleteRecurring(id);
      UI.showToast('Recorrência excluída', 'success');
      loadRecurring();
    } catch (err) {
      UI.showToast('Erro: ' + err.message, 'error');
    }
  }

  // ─── Event Bindings ───────────────────────────────────────────
  // ─── Autocomplete ──────────────────────────────────────────────────
  let autocompleteTimer = null;
  let autocompleteActive = -1;

  function setupAutocomplete() {
    const input = document.getElementById('form-description');
    const dropdown = document.getElementById('autocomplete-dropdown');
    if (!input || !dropdown) return;

    input.addEventListener('input', () => {
      clearTimeout(autocompleteTimer);
      const q = input.value.trim();
      if (q.length < 2) {
        dropdown.classList.remove('active');
        dropdown.innerHTML = '';
        return;
      }
      autocompleteTimer = setTimeout(async () => {
        try {
          const type = document.getElementById('form-type').value;
          const suggestions = await api.autocompleteTransactions(q, type);
          renderAutocomplete(suggestions, dropdown, input);
        } catch (_) {
          dropdown.classList.remove('active');
        }
      }, 250);
    });

    input.addEventListener('keydown', (e) => {
      const items = dropdown.querySelectorAll('.autocomplete-item');
      if (!items.length || !dropdown.classList.contains('active')) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        autocompleteActive = Math.min(autocompleteActive + 1, items.length - 1);
        highlightItem(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        autocompleteActive = Math.max(autocompleteActive - 1, 0);
        highlightItem(items);
      } else if (e.key === 'Enter' && autocompleteActive >= 0) {
        e.preventDefault();
        items[autocompleteActive].click();
      } else if (e.key === 'Escape') {
        dropdown.classList.remove('active');
        autocompleteActive = -1;
      }
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.autocomplete-wrapper')) {
        dropdown.classList.remove('active');
        autocompleteActive = -1;
      }
    });
  }

  function highlightItem(items) {
    items.forEach((item, i) => {
      item.classList.toggle('active', i === autocompleteActive);
    });
    if (autocompleteActive >= 0 && items[autocompleteActive]) {
      items[autocompleteActive].scrollIntoView({ block: 'nearest' });
    }
  }

  function renderAutocomplete(suggestions, dropdown, input) {
    if (!suggestions || suggestions.length === 0) {
      dropdown.classList.remove('active');
      dropdown.innerHTML = '';
      return;
    }

    dropdown.innerHTML = suggestions.map((s, i) => `
      <div class="autocomplete-item" data-index="${i}">
        <span class="autocomplete-item-icon">${s.category_icon || '📁'}</span>
        <div class="autocomplete-item-text">
          <div class="autocomplete-item-desc">${escapeHtml(s.description)}</div>
          <div class="autocomplete-item-meta">${s.category_name || ''}</div>
        </div>
        <span class="autocomplete-item-amount ${s.type}">
          R$ ${s.amount.toFixed(2)}
        </span>
      </div>
    `).join('');

    dropdown.classList.add('active');
    autocompleteActive = -1;

    dropdown.querySelectorAll('.autocomplete-item').forEach((item, i) => {
      item.addEventListener('click', () => {
        const s = suggestions[i];
        input.value = s.description;
        document.getElementById('form-amount').value = s.amount;

        // Set category
        const catSelect = document.getElementById('form-category');
        if (catSelect && s.category_id) {
          catSelect.value = s.category_id;
        }

        // Set bank
        const bankSelect = document.getElementById('form-bank');
        if (bankSelect && s.bank_id) {
          bankSelect.value = s.bank_id;
        }

        // Set vehicle
        const vehicleSelect = document.getElementById('form-vehicle');
        if (vehicleSelect && s.vehicle_id) {
          vehicleSelect.value = s.vehicle_id;
        }

        // Set credit card
        if (s.credit_card_id) {
          const useCard = document.getElementById('form-use-card');
          const cardSelect = document.getElementById('form-credit-card');
          if (useCard && cardSelect) {
            useCard.checked = true;
            useCard.dispatchEvent(new Event('change'));
            setTimeout(() => { cardSelect.value = s.credit_card_id; }, 50);
          }
        }

        dropdown.classList.remove('active');
        autocompleteActive = -1;
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function bindEvents() {
    // Navigation
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(link.dataset.page);
      });
    });

    // Mobile sidebar
    document.getElementById('menu-toggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.add('open');
      document.getElementById('sidebar-overlay').classList.add('active');
    });
    document.getElementById('sidebar-close').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-overlay').classList.remove('active');
    });
    document.getElementById('sidebar-overlay').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-overlay').classList.remove('active');
    });

    // Quick add button
    document.getElementById('btn-quick-add').addEventListener('click', () => {
      UI.resetForm();
      navigateTo('add');
    });

    // Type toggle buttons
    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const type = btn.dataset.type;
        document.getElementById('form-type').value = type;
        UI.populateCategorySelect('form-category', allCategories, type);

        // Hide credit card option for income
        const cardGroup = document.getElementById('group-credit-card');
        const bankGroup = document.getElementById('group-bank');
        if (type === 'income') {
          cardGroup.style.display = 'none';
          bankGroup.style.display = 'block';
          document.getElementById('form-use-card').checked = false;
          document.getElementById('form-credit-card').style.display = 'none';
        } else {
          cardGroup.style.display = 'block';
          bankGroup.style.display = document.getElementById('form-use-card').checked ? 'none' : 'block';
        }
      });
    });

    // Credit card toggle
    document.getElementById('form-use-card').addEventListener('change', (e) => {
      const checked = e.target.checked;
      document.getElementById('form-credit-card').style.display = checked ? 'block' : 'none';
      document.getElementById('group-bank').style.display = checked ? 'none' : 'block';
      document.getElementById('group-installments').style.display = checked ? 'block' : 'none';
      // Toggle required so hidden bank field doesn't block form submission
      document.getElementById('form-bank').required = !checked;
      if (checked) {
        // Re-populate cards select in case new cards were added
        UI.populateCreditCardSelect(allCreditCards);
      } else {
        document.getElementById('form-installments').value = '1';
      }
    });

    // Transaction form
    document.getElementById('transaction-form').addEventListener('submit', handleFormSubmit);
    document.getElementById('btn-form-cancel').addEventListener('click', () => {
      UI.resetForm();
      navigateTo('transactions');
    });

    // Category form
    document.getElementById('category-form').addEventListener('submit', handleCategorySubmit);

    // Recurring form
    document.getElementById('recurring-form').addEventListener('submit', handleRecurringSubmit);

    // Recurring type toggle
    document.querySelectorAll('#recurring-type-toggle .type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#recurring-type-toggle .type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const type = btn.dataset.type;
        document.getElementById('recurring-type').value = type;
        UI.populateCategorySelect('recurring-category', allCategories, type);
        const cardGroup = document.getElementById('recurring-group-credit-card');
        if (type === 'income') {
          cardGroup.style.display = 'none';
          document.getElementById('recurring-group-bank').style.display = 'block';
          document.getElementById('recurring-use-card').checked = false;
          document.getElementById('recurring-credit-card').style.display = 'none';
          document.getElementById('recurring-bank').required = true;
        } else {
          cardGroup.style.display = 'block';
        }
      });
    });

    // Recurring credit card toggle
    document.getElementById('recurring-use-card').addEventListener('change', (e) => {
      const checked = e.target.checked;
      document.getElementById('recurring-credit-card').style.display = checked ? 'block' : 'none';
      document.getElementById('recurring-group-bank').style.display = checked ? 'none' : 'block';
      document.getElementById('recurring-bank').required = !checked;
      if (checked) {
        UI.populateCreditCardSelect(allCreditCards, 'recurring-credit-card');
      }
    });

    // Cards
    document.getElementById('card-form').addEventListener('submit', handleCardSubmit);
    document.getElementById('edit-card-form').addEventListener('submit', handleEditCardSubmit);
    document.getElementById('btn-edit-card-cancel').addEventListener('click', () => UI.closeEditCardModal());
    document.getElementById('edit-card-modal').addEventListener('click', (e) => {
      if (e.target.id === 'edit-card-modal') UI.closeEditCardModal();
    });
    document.getElementById('btn-pay-invoice').addEventListener('click', handlePayInvoice);

    // Banks
    document.getElementById('bank-form').addEventListener('submit', handleBankSubmit);
    document.getElementById('edit-bank-form').addEventListener('submit', handleEditBankSubmit);
    document.getElementById('btn-edit-bank-cancel').addEventListener('click', () => UI.closeEditBankModal());
    document.getElementById('edit-bank-modal').addEventListener('click', (e) => {
      if (e.target.id === 'edit-bank-modal') UI.closeEditBankModal();
    });
    document.getElementById('transfer-form').addEventListener('submit', handleTransferSubmit);

    // Vehicles
    document.getElementById('vehicle-form').addEventListener('submit', handleVehicleSubmit);

    // Filters
    document.getElementById('btn-filter-apply').addEventListener('click', () => {
      transactionFilters = {
        type: document.getElementById('filter-type').value,
        category_id: document.getElementById('filter-category').value,
        start_date: document.getElementById('filter-start').value,
        end_date: document.getElementById('filter-end').value,
        search: document.getElementById('filter-search').value,
        limit: 20,
        offset: 0,
      };
      loadTransactions();
    });

    document.getElementById('btn-filter-clear').addEventListener('click', () => {
      document.getElementById('filter-type').value = '';
      document.getElementById('filter-category').value = '';
      document.getElementById('filter-start').value = '';
      document.getElementById('filter-end').value = '';
      document.getElementById('filter-search').value = '';
      transactionFilters = { limit: 20, offset: 0 };
      loadTransactions();
    });

    // Allow search on Enter
    document.getElementById('filter-search').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('btn-filter-apply').click();
      }
    });

    // Pagination
    UI.setOnPageChange((offset) => {
      transactionFilters.offset = offset;
      loadTransactions();
    });

    // Dashboard period buttons
    document.querySelectorAll('.btn-period').forEach(btn => {
      btn.addEventListener('click', () => {
        dashboardPeriod = btn.dataset.period;
        if (dashboardPeriod === 'month' || dashboardPeriod === 'year') {
          dashboardDate = new Date();
        }
        loadDashboard();
      });
    });

    // Month picker
    document.getElementById('dashboard-month-picker').addEventListener('change', (e) => {
      const [y, m] = e.target.value.split('-');
      dashboardDate = new Date(parseInt(y), parseInt(m) - 1, 1);
      loadDashboard();
    });

    // Prev/Next buttons
    document.getElementById('btn-period-prev').addEventListener('click', () => {
      if (dashboardPeriod === 'month') {
        dashboardDate.setMonth(dashboardDate.getMonth() - 1);
      } else {
        dashboardDate.setFullYear(dashboardDate.getFullYear() - 1);
      }
      loadDashboard();
    });

    document.getElementById('btn-period-next').addEventListener('click', () => {
      if (dashboardPeriod === 'month') {
        dashboardDate.setMonth(dashboardDate.getMonth() + 1);
      } else {
        dashboardDate.setFullYear(dashboardDate.getFullYear() + 1);
      }
      loadDashboard();
    });

    // Custom date range apply
    document.getElementById('btn-dashboard-apply').addEventListener('click', () => {
      dashboardCustomStart = document.getElementById('dashboard-start').value;
      dashboardCustomEnd = document.getElementById('dashboard-end').value;
      if (!dashboardCustomStart || !dashboardCustomEnd) {
        UI.showToast('Selecione as datas de início e fim', 'error');
        return;
      }
      loadDashboard();
    });

    // Clear dashboard category filter
    document.getElementById('dashboard-category-badge').addEventListener('click', () => {
      dashboardSelectedCategory = null;
      dashboardSelectedCategoryName = null;
      loadDashboard();
    });

    // Close future invoices view
    const btnCloseFuture = document.getElementById('btn-close-future-invoices');
    if (btnCloseFuture) {
      btnCloseFuture.addEventListener('click', () => {
        const futureEl = document.getElementById('future-invoices-details');
        if (futureEl) futureEl.style.display = 'none';
      });
    }

    // Edit CC transaction modal events
    const editCCTxForm = document.getElementById('edit-cc-tx-form');
    if (editCCTxForm) editCCTxForm.addEventListener('submit', handleEditCCTransactionSubmit);

    const btnCancelEditCCTx = document.getElementById('btn-edit-cc-tx-cancel');
    if (btnCancelEditCCTx) btnCancelEditCCTx.addEventListener('click', UI.closeEditCCTransactionModal);

    // Hash routing
    window.addEventListener('hashchange', () => {
      const page = window.location.hash.slice(1) || 'dashboard';
      if (page !== currentPage) navigateTo(page);
    });
  }

  // ─── Initialize ───────────────────────────────────────────────
  async function init() {
    try {
      // Load initial data
      allCategories = await api.getCategories();
      allCreditCards = await api.getCreditCards();
      allBanks = await api.getBanks();
      allVehicles = await api.getVehicles();

      // Populate filter and forms
      UI.populateCategorySelect('filter-category', allCategories);
      UI.populateCreditCardSelect(allCreditCards);
      UI.populateBankSelect(allBanks, ['form-bank', 'invoice-pay-bank']);
      UI.populateVehicleSelect(allVehicles);

      // Set default date
      document.getElementById('form-date').value = new Date().toISOString().split('T')[0];

      // Bind all events
      bindEvents();
      setupAutocomplete();

      // Navigate to initial page
      const initialPage = window.location.hash.slice(1) || 'dashboard';
      navigateTo(initialPage);
    } catch (err) {
      UI.showToast('Erro ao inicializar: ' + err.message, 'error');
      console.error('Init error:', err);
    }
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
