/**
 * FinançasPro — Charts Module
 * Manages all Chart.js instances for the dashboard.
 * Pastel Finance theme colors + Analytics charts.
 */
const ChartsManager = (() => {
  let monthlyChart = null;
  let categoryChart = null;
  let balanceChart = null;
  let compositionChart = null;
  let healthGaugeChart = null;

  const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  const CATEGORY_COLORS = [
    '#006b5c', '#86504b', '#4f6074', '#7c5800', '#0d6e43',
    '#5c5f7e', '#a3685e', '#3a7868', '#8b6d3f', '#4a7c91',
    '#b67b6a', '#6b8f7e', '#9e7249', '#5a8fa3', '#7d9a6f',
  ];

  // Shared chart defaults — light theme
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: '#3e4946',
          font: { family: 'Inter', size: 12 },
          padding: 16,
          usePointStyle: true,
          pointStyleWidth: 10,
        },
      },
      tooltip: {
        backgroundColor: '#ffffff',
        titleColor: '#191c1d',
        bodyColor: '#3e4946',
        borderColor: '#bdc9c5',
        borderWidth: 1,
        cornerRadius: 12,
        padding: 12,
        titleFont: { family: 'Inter', weight: '600' },
        bodyFont: { family: 'Inter' },
        callbacks: {
          label: function (context) {
            const value = context.parsed.y !== undefined ? context.parsed.y : context.parsed;
            return ` ${context.dataset.label || context.label}: R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
          }
        }
      },
    },
  };

  function destroyAll() {
    if (monthlyChart) { monthlyChart.destroy(); monthlyChart = null; }
    if (categoryChart) { categoryChart.destroy(); categoryChart = null; }
    if (balanceChart) { balanceChart.destroy(); balanceChart = null; }
    if (compositionChart) { compositionChart.destroy(); compositionChart = null; }
    if (healthGaugeChart) { healthGaugeChart.destroy(); healthGaugeChart = null; }
  }

  function renderMonthlyChart(data) {
    const ctx = document.getElementById('chart-monthly');
    if (!ctx) return;
    if (monthlyChart) monthlyChart.destroy();

    if (!Array.isArray(data) || data.length === 0) {
      monthlyChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: MONTH_LABELS, datasets: [] },
        options: { ...baseOptions }
      });
      return;
    }

    const incomeData = data.map(d => d.income || 0);
    const expenseData = data.map(d => d.expense || 0);

    monthlyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: MONTH_LABELS,
        datasets: [
          {
            label: 'Receitas',
            data: incomeData,
            backgroundColor: 'rgba(134, 227, 206, 0.7)',
            borderColor: '#006b5c',
            borderWidth: 2,
            borderRadius: 8,
            borderSkipped: false,
          },
          {
            label: 'Despesas',
            data: expenseData,
            backgroundColor: 'rgba(255, 184, 177, 0.7)',
            borderColor: '#86504b',
            borderWidth: 2,
            borderRadius: 8,
            borderSkipped: false,
          },
        ],
      },
      options: {
        ...baseOptions,
        scales: {
          x: {
            grid: { color: 'rgba(189, 201, 197, 0.2)' },
            ticks: { color: '#6e7a76', font: { family: 'Inter', size: 11 } },
          },
          y: {
            grid: { color: 'rgba(189, 201, 197, 0.2)' },
            ticks: {
              color: '#6e7a76',
              font: { family: 'Inter', size: 11 },
              callback: (v) => `R$ ${v.toLocaleString('pt-BR')}`,
            },
          },
        },
      },
    });
  }

  function renderCategoryChart(data, onClick) {
    const ctx = document.getElementById('chart-category');
    if (!ctx) return;
    if (categoryChart) categoryChart.destroy();

    const sorted = data.filter(d => d.type === 'expense').sort((a, b) => b.total - a.total).slice(0, 10);

    if (sorted.length === 0) {
      categoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Sem dados'],
          datasets: [{ data: [1], backgroundColor: ['rgba(189,201,197,0.15)'], borderWidth: 0 }]
        },
        options: {
          ...baseOptions,
          cutout: '65%',
          plugins: {
            ...baseOptions.plugins,
            tooltip: { enabled: false },
            legend: { display: false },
          }
        }
      });
      return;
    }

    const labels = sorted.map(d => `${d.icon} ${d.name}`);
    const values = sorted.map(d => d.total);
    const colors = sorted.map((d, i) => d.color || CATEGORY_COLORS[i % CATEGORY_COLORS.length]);

    categoryChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors.map(c => c + 'cc'),
          borderColor: '#ffffff',
          borderWidth: 3,
          hoverOffset: 8,
        }],
      },
      options: {
        ...baseOptions,
        cutout: '65%',
        plugins: {
          ...baseOptions.plugins,
          legend: {
            ...baseOptions.plugins.legend,
            position: 'right',
          },
        },
        onClick: (event, elements) => {
          if (elements.length > 0 && onClick) {
            const index = elements[0].index;
            onClick(sorted[index].category_id, sorted[index].name);
          }
        },
        onHover: (event, elements) => {
          event.native.target.style.cursor = elements[0] ? 'pointer' : 'default';
        }
      },
    });
  }

  // ── Balance chart with projected future months (dashed line) ──
  function renderBalanceChart(data, projectedMonths) {
    const ctx = document.getElementById('chart-balance');
    if (!ctx) return;
    if (balanceChart) balanceChart.destroy();

    if ((!data || data.length === 0) && (!projectedMonths || projectedMonths.length === 0)) {
      balanceChart = new Chart(ctx, {
        type: 'line',
        data: { labels: ['Sem dados'], datasets: [{ data: [0], borderColor: 'rgba(189,201,197,0.3)', borderWidth: 1 }] },
        options: { ...baseOptions, scales: { x: { display: false }, y: { display: false } } }
      });
      return;
    }

    const historicalLabels = (data || []).map(d => {
      const [y, m] = d.month.split('-');
      return `${MONTH_LABELS[parseInt(m) - 1]}/${y.slice(2)}`;
    });

    const projLabels = (projectedMonths || []).map(d => {
      const [y, m] = d.month.split('-');
      return `${MONTH_LABELS[parseInt(m) - 1]}/${y.slice(2)}`;
    });

    const allLabels = [...historicalLabels, ...projLabels];

    const historicalBalance = (data || []).map(d => d.balance);
    const historicalIncome = (data || []).map(d => d.income);
    const historicalExpense = (data || []).map(d => d.expense);

    // For projection line: extend from last historical point
    const projBalance = new Array(historicalBalance.length).fill(null);
    if (historicalBalance.length > 0) {
      projBalance[projBalance.length - 1] = historicalBalance[historicalBalance.length - 1];
    }
    for (const pm of (projectedMonths || [])) {
      projBalance.push(pm.balance);
    }

    // Extend historical arrays with nulls for projection period
    const padCount = (projectedMonths || []).length;
    const balanceData = [...historicalBalance, ...new Array(padCount).fill(null)];
    const incomeData = [...historicalIncome, ...new Array(padCount).fill(null)];
    const expenseData = [...historicalExpense, ...new Array(padCount).fill(null)];

    balanceChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: allLabels,
        datasets: [
          {
            label: 'Saldo Acumulado',
            data: balanceData,
            borderColor: '#006b5c',
            backgroundColor: 'rgba(134, 227, 206, 0.15)',
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 7,
            pointBackgroundColor: '#006b5c',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
          },
          {
            label: 'Projeção',
            data: projBalance,
            borderColor: '#006b5c',
            borderWidth: 2,
            borderDash: [8, 5],
            tension: 0.4,
            pointRadius: 5,
            pointHoverRadius: 7,
            pointBackgroundColor: '#86e3ce',
            pointBorderColor: '#006b5c',
            pointBorderWidth: 2,
            pointStyle: 'triangle',
            fill: false,
          },
          {
            label: 'Receitas',
            data: incomeData,
            borderColor: '#86e3ce',
            borderWidth: 2,
            borderDash: [6, 4],
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 5,
          },
          {
            label: 'Despesas',
            data: expenseData,
            borderColor: '#ffb8b1',
            borderWidth: 2,
            borderDash: [6, 4],
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 5,
          },
        ],
      },
      options: {
        ...baseOptions,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        scales: {
          x: {
            grid: { color: 'rgba(189, 201, 197, 0.2)' },
            ticks: { color: '#6e7a76', font: { family: 'Inter', size: 11 } },
          },
          y: {
            grid: { color: 'rgba(189, 201, 197, 0.2)' },
            ticks: {
              color: '#6e7a76',
              font: { family: 'Inter', size: 11 },
              callback: (v) => `R$ ${v.toLocaleString('pt-BR')}`,
            },
          },
        },
      },
    });
  }

  // ── Stacked Area: Expense Composition by Category over months ──
  function renderExpenseCompositionChart(compositionData) {
    const ctx = document.getElementById('chart-composition');
    if (!ctx) return;
    if (compositionChart) compositionChart.destroy();

    if (!compositionData || compositionData.length === 0) {
      compositionChart = new Chart(ctx, {
        type: 'line',
        data: { labels: ['Sem dados'], datasets: [{ data: [0], borderColor: 'rgba(189,201,197,0.3)', borderWidth: 1 }] },
        options: { ...baseOptions, scales: { x: { display: false }, y: { display: false } } }
      });
      return;
    }

    // Collect all unique categories
    const allCategories = new Set();
    for (const entry of compositionData) {
      for (const cat of entry.categories) {
        allCategories.add(cat.name);
      }
    }

    const labels = compositionData.map(d => {
      const [y, m] = d.month.split('-');
      return `${MONTH_LABELS[parseInt(m) - 1]}/${y.slice(2)}`;
    });

    // Build one dataset per category
    const datasets = [];
    let colorIdx = 0;
    for (const catName of allCategories) {
      const data = compositionData.map(entry => {
        const found = entry.categories.find(c => c.name === catName);
        return found ? found.total : 0;
      });

      // Try to get the color from the data, fallback to palette
      let color = CATEGORY_COLORS[colorIdx % CATEGORY_COLORS.length];
      for (const entry of compositionData) {
        const found = entry.categories.find(c => c.name === catName);
        if (found && found.color) { color = found.color; break; }
      }

      datasets.push({
        label: catName,
        data,
        backgroundColor: color + '66',
        borderColor: color,
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
      });
      colorIdx++;
    }

    compositionChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        ...baseOptions,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            grid: { color: 'rgba(189, 201, 197, 0.2)' },
            ticks: { color: '#6e7a76', font: { family: 'Inter', size: 11 } },
            stacked: true,
          },
          y: {
            grid: { color: 'rgba(189, 201, 197, 0.2)' },
            ticks: {
              color: '#6e7a76',
              font: { family: 'Inter', size: 11 },
              callback: (v) => `R$ ${v.toLocaleString('pt-BR')}`,
            },
            stacked: true,
          },
        },
        plugins: {
          ...baseOptions.plugins,
          legend: {
            ...baseOptions.plugins.legend,
            position: 'bottom',
            labels: {
              ...baseOptions.plugins.legend.labels,
              boxWidth: 12,
              padding: 10,
              font: { family: 'Inter', size: 10 },
            },
          },
        },
      },
    });
  }

  // ── Health Score Gauge (semi-circular doughnut) ──
  function renderHealthGauge(score) {
    const ctx = document.getElementById('chart-health-gauge');
    if (!ctx) return;
    if (healthGaugeChart) healthGaugeChart.destroy();

    const safeScore = Math.max(0, Math.min(100, score || 0));
    const remaining = 100 - safeScore;

    // Color based on score
    let gaugeColor = '#e74c3c'; // red
    if (safeScore >= 70) gaugeColor = '#006b5c'; // green
    else if (safeScore >= 40) gaugeColor = '#f0a500'; // amber

    healthGaugeChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [safeScore, remaining, 100], // third segment is hidden bottom half
          backgroundColor: [gaugeColor, 'rgba(189,201,197,0.15)', 'transparent'],
          borderWidth: 0,
          circumference: 180,
          rotation: 270,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '75%',
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      },
    });

    // Update text
    const valueEl = document.getElementById('health-score-value');
    const labelEl = document.getElementById('health-score-label');
    if (valueEl) valueEl.textContent = safeScore;
    if (labelEl) {
      if (safeScore >= 80) labelEl.textContent = 'Excelente';
      else if (safeScore >= 60) labelEl.textContent = 'Bom';
      else if (safeScore >= 40) labelEl.textContent = 'Regular';
      else labelEl.textContent = 'Atenção';

      labelEl.style.color = gaugeColor;
    }
    if (valueEl) valueEl.style.color = gaugeColor;
  }

  return {
    destroyAll,
    renderMonthlyChart,
    renderCategoryChart,
    renderBalanceChart,
    renderExpenseCompositionChart,
    renderHealthGauge,
  };
})();
