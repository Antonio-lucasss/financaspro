/**
 * FinançasPro — API Client
 * Centralizes all HTTP communication with the backend.
 */
class FinanceAPI {
  constructor(baseURL = '') {
    this.baseURL = baseURL;
  }

  async _request(method, path, body = null, params = null) {
    let url = `${this.baseURL}${path}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== '' && value !== null && value !== undefined) {
          searchParams.set(key, value);
        }
      }
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }

    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('financaspro_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const options = {
      method,
      headers,
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401 && !path.startsWith('/api/auth/login')) {
        localStorage.removeItem('financaspro_token');
        window.dispatchEvent(new CustomEvent('auth:unauthorized', { detail: data }));
      }
      throw new Error(data.error || `Erro ${response.status}`);
    }

    return data;
  }

  // ─── Authentication ──────────────────────────────

  getAuthStatus() {
    return this._request('GET', '/api/auth/status');
  }

  async login(password) {
    const res = await this._request('POST', '/api/auth/login', { password });
    if (res.token) {
      localStorage.setItem('financaspro_token', res.token);
    }
    return res;
  }

  async setupPassword(password) {
    const res = await this._request('POST', '/api/auth/setup', { password });
    if (res.token) {
      localStorage.setItem('financaspro_token', res.token);
    }
    return res;
  }

  async changePassword(currentPassword, newPassword) {
    const res = await this._request('POST', '/api/auth/change-password', { currentPassword, newPassword });
    if (res.token) {
      localStorage.setItem('financaspro_token', res.token);
    }
    return res;
  }

  async logout() {
    try {
      await this._request('POST', '/api/auth/logout');
    } catch {
      // Ignore network errors on logout
    } finally {
      localStorage.removeItem('financaspro_token');
    }
  }

  // ─── Categories ──────────────────────────────────

  getCategories(type = null) {
    return this._request('GET', '/api/categories', null, type ? { type } : null);
  }

  createCategory(data) {
    return this._request('POST', '/api/categories', data);
  }

  deleteCategory(id) {
    return this._request('DELETE', `/api/categories/${id}`);
  }

  // ─── Transactions ───────────────────────────────

  getTransactions(filters = {}) {
    return this._request('GET', '/api/transactions', null, filters);
  }

  getTransaction(id) {
    return this._request('GET', `/api/transactions/${id}`);
  }

  createTransaction(data) {
    return this._request('POST', '/api/transactions', data);
  }

  autocompleteTransactions(q, type) {
    return this._request('GET', '/api/transactions/autocomplete', null, { q, type });
  }

  updateTransaction(id, data) {
    return this._request('PUT', `/api/transactions/${id}`, data);
  }

  deleteTransaction(id) {
    return this._request('DELETE', `/api/transactions/${id}`);
  }

  // ─── Credit Cards ──────────────────────────────────
  
  getCreditCards() {
    return this._request('GET', '/api/credit-cards');
  }

  createCreditCard(data) {
    return this._request('POST', '/api/credit-cards', data);
  }

  updateCreditCard(id, data) {
    return this._request('PUT', `/api/credit-cards/${id}`, data);
  }

  deleteCreditCard(id) {
    return this._request('DELETE', `/api/credit-cards/${id}`);
  }

  getInvoice(id) {
    return this._request('GET', `/api/credit-cards/${id}/invoice`);
  }

  payInvoice(id, bankId) {
    return this._request('POST', `/api/credit-cards/${id}/pay`, { bank_id: bankId });
  }

  getInstallments(id) {
    return this._request('GET', `/api/credit-cards/${id}/installments`);
  }

  getFutureInvoices(id) {
    return this._request('GET', `/api/credit-cards/${id}/future-invoices`);
  }

  // ─── Banks ───────────────────────────────────────

  getBanks() {
    return this._request('GET', '/api/banks');
  }

  createBank(data) {
    return this._request('POST', '/api/banks', data);
  }

  updateBank(id, data) {
    return this._request('PUT', `/api/banks/${id}`, data);
  }

  deleteBank(id) {
    return this._request('DELETE', `/api/banks/${id}`);
  }

  createTransfer(data) {
    return this._request('POST', '/api/transfers', data);
  }

  // ─── Statistics ──────────────────────────────────

  getSummary(filters = {}) {
    return this._request('GET', '/api/stats/summary', null, filters);
  }

  getByCategory(filters = {}) {
    return this._request('GET', '/api/stats/by-category', null, filters);
  }

  getMonthly(filters = {}) {
    return this._request('GET', '/api/stats/monthly', null, filters);
  }

  getBalanceHistory(filters = {}) {
    return this._request('GET', '/api/stats/balance-history', null, filters);
  }

  getYears() {
    return this._request('GET', '/api/stats/years');
  }

  getTotalInstallments() {
    return this._request('GET', '/api/stats/total-installments');
  }

  getAnalytics(filters = {}) {
    return this._request('GET', '/api/stats/analytics', null, filters);
  }

  // ─── Recurring Transactions ─────────────────────────

  getRecurring() {
    return this._request('GET', '/api/recurring');
  }

  createRecurring(data) {
    return this._request('POST', '/api/recurring', data);
  }

  toggleRecurring(id) {
    return this._request('PUT', `/api/recurring/${id}/toggle`);
  }

  deleteRecurring(id) {
    return this._request('DELETE', `/api/recurring/${id}`);
  }

  // ─── Vehicles ──────────────────────────────────────

  getVehicles() {
    return this._request('GET', '/api/vehicles');
  }

  createVehicle(data) {
    return this._request('POST', '/api/vehicles', data);
  }

  deleteVehicle(id) {
    return this._request('DELETE', `/api/vehicles/${id}`);
  }

  getVehicleStats(id, filters = {}) {
    return this._request('GET', `/api/vehicles/${id}/stats`, null, filters);
  }

  getVehicleTransactions(id, filters = {}) {
    return this._request('GET', `/api/vehicles/${id}/transactions`, null, filters);
  }
}

// Global instance
const api = new FinanceAPI();
