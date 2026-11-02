import { createClient } from '@supabase/supabase-js';
import { peso, todayLocal, summarizeSales, filterByDate, escapeHtml } from './lib.js';
import './style.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const $ = (id) => document.getElementById(id);
const app = $('app');
let supabase, session, products = [], sales = [], expenses = [], cart = [], page = 'dashboard', channel, busy = false;
const state = { from: todayLocal(), to: todayLocal() };

function notify(message, error = false) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => el.className = 'toast', 3000);
}

function loginView(message = '') {
  app.innerHTML = `<main class="login-shell"><section class="login-card"><div class="brand-mark">M</div><p class="eyebrow">MERCAN INTERNET CAFE</p><h1>Food Sales & Inventory</h1><p class="muted">Sign in using the shared business account.</p>${message ? `<div class="error-note">${escapeHtml(message)}</div>` : ''}<form id="loginForm"><label>Email / username<input id="loginEmail" type="text" autocomplete="username" required placeholder="Shared account email"></label><label>Password<input id="loginPassword" type="password" autocomplete="current-password" required placeholder="Password"></label><button class="primary full" type="submit">Sign in</button></form><p class="tiny muted">Registration is disabled. Ask the system administrator for the shared login.</p></section></main>`;

  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('loginEmail').value.trim();
    const password = $('loginPassword').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) loginView(error.message);
  });
}

function shell() {
  app.innerHTML = `<div class="layout"><aside class="sidebar"><div class="brand"><div class="brand-mark small-mark">M</div><div><b>Mercan Manager</b><small>Sales · Inventory · Profit</small></div></div><nav id="nav"><button data-page="dashboard">▦ Dashboard</button><button data-page="pos">＋ New sale</button><button data-page="inventory">▤ Inventory</button><button data-page="history">↺ Sales history</button><button data-page="expenses">₱ Expenses</button><button data-page="reports">▥ Reports</button></nav><div class="side-foot"><span class="live-dot"></span> Cloud connected<br><small>Real-time synchronization on</small></div></aside><main class="content"><header class="topbar"><div><p class="eyebrow">MERCAN INTERNET CAFE</p><h1 id="pageTitle">Dashboard</h1><p class="muted" id="subTitle">Shared business workspace</p></div><div class="top-actions"><span class="sync-label"><i class="live-dot"></i> Live sync</span><button id="refreshBtn" class="button secondary">Refresh</button><button id="logoutBtn" class="button ghost">Sign out</button></div></header><div id="pageContent"></div></main></div><div id="modalRoot"></div><div id="toast" class="toast"></div>`;

  $('nav').addEventListener('click', e => {
    const b = e.target.closest('[data-page]');
    if (b) go(b.dataset.page);
  });

  $('logoutBtn').onclick = async () => {
    await supabase.auth.signOut();
  };

  $('refreshBtn').onclick = () => loadData(true);
  go('dashboard');
}

function go(next) {
  page = next;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const names = {
    dashboard: 'Dashboard',
    pos: 'New Sale',
    inventory: 'Inventory',
    history: 'Sales History',
    expenses: 'Expenses',
    reports: 'Reports'
  };
  $('pageTitle').textContent = names[page];
  render();
}

async function loadData(showMessage = false) {
  if (!session || busy) return;
  busy = true;

  try {
    const [p, s, e] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('sales').select('*, sale_items(*)').order('created_at', { ascending: false }).limit(1500),
      supabase.from('expenses').select('*').order('expense_date', { ascending: false }).limit(1500)
    ]);

    for (const r of [p, s, e]) {
      if (r.error) throw r.error;
    }

    products = p.data || [];
    sales = s.data || [];
    expenses = e.data || [];

    render();
    if (showMessage) notify('Data refreshed from cloud.');
  } catch (err) {
    notify(err.message || 'Unable to load data.', true);
  } finally {
    busy = false;
  }
}

function subscribe() {
  if (channel) supabase.removeChannel(channel);

  channel = supabase.channel('mercan-shared-data')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => loadData())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => loadData())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sale_items' }, () => loadData())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => loadData())
    .subscribe(status => {
      const dot = document.querySelector('.sync-label');
      if (dot) dot.title = `Realtime status: ${status}`;
    });
}

function activeSales() {
  return sales.filter(s => s.status === 'completed');
}

function saleCost(s) {
  return Number(s.total_cost || 0);
}

function saleItems(s) {
  return s.sale_items || [];
}

function metric(label, value, hint = '') {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`;
}

function render() {
  if (!$('pageContent')) return;

  const root = $('pageContent');

  if (page === 'dashboard') root.innerHTML = dashboard();
  if (page === 'pos') root.innerHTML = posView();
  if (page === 'inventory') root.innerHTML = inventoryView();
  if (page === 'history') root.innerHTML = historyView();
  if (page === 'expenses') root.innerHTML = expensesView();
  if (page === 'reports') root.innerHTML = reportsView();

  bindPage();
}

function dashboard() {
  const today = todayLocal();
  const todays = activeSales().filter(s => String(s.created_at).slice(0, 10) === today);
  const dayExpenses = expenses.filter(e => e.expense_date === today);
  const m = summarizeSales(todays, dayExpenses);
  const low = products.filter(p => Number(p.stock) <= Number(p.low_stock_at));

  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = todayLocal(d);

    return {
      key,
      total: activeSales()
        .filter(s => String(s.created_at).slice(0, 10) === key)
        .reduce((n, s) => n + Number(s.total_amount), 0)
    };
  });

  const max = Math.max(1, ...week.map(x => x.total));
  const best = new Map();

  activeSales().forEach(s => {
    saleItems(s).forEach(i => {
      best.set(i.product_name, (best.get(i.product_name) || 0) + Number(i.quantity));
    });
  });

  const top = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return `<div class="metrics">
    ${metric("Today's sales", peso(m.revenue), `${m.transactions} transactions`)}
    ${metric('Cost of goods', peso(m.cogs), 'Based on saved item costs')}
    ${metric('Gross profit', peso(m.grossProfit), 'Sales less product cost')}
    ${metric('Net profit', peso(m.netProfit), 'After today\'s expenses')}
  </div>
  <div class="two-col">
    <section class="panel">
      <div class="panel-head"><h2>Sales overview</h2><span class="muted">Last 7 days</span></div>
      ${week.map(x => `<div class="bar-row">
        <span>${new Date(`${x.key}T12:00:00`).toLocaleDateString('en-PH', { weekday: 'short' })}</span>
        <div class="bar"><i style="width:${x.total / max * 100}%"></i></div>
        <b>${peso(x.total)}</b>
      </div>`).join('')}
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Low stock alerts</h2><span class="tag warn">${low.length} items</span></div>
      ${low.length ? low.map(p => `<div class="list-row"><span>${escapeHtml(p.name)}</span><b>${p.stock} left</b></div>`).join('') : '<p class="empty">All stock levels look good.</p>'}
    </section>
  </div>
  <div class="two-col">
    <section class="panel">
      <h2>Best-selling products</h2>
      ${top.length ? top.map(([name, qty]) => `<div class="list-row"><span>${escapeHtml(name)}</span><b>${qty} sold</b></div>`).join('') : '<p class="empty">No sales recorded yet.</p>'}
    </section>
    <section class="panel">
      <h2>Inventory snapshot</h2>
      <div class="quick-stats">
        <div><b>${products.length}</b><span>Products</span></div>
        <div><b>${products.reduce((n, p) => n + Number(p.stock), 0)}</b><span>Total stock units</span></div>
        <div><b>${activeSales().length}</b><span>Completed sales</span></div>
      </div>
    </section>
  </div>`;
}

function posView() {
  const cats = [...new Set(products.map(p => p.category).filter(Boolean))];

  return `<div class="pos-grid">
    <section class="panel">
      <div class="panel-head"><h2>Select products</h2><span class="muted">Tap to add</span></div>
      <div class="toolbar">
        <input id="productSearch" placeholder="Search products…">
        <select id="productCategory"><option value="">All categories</option>${cats.map(c => `<option>${escapeHtml(c)}</option>`).join('')}</select>
      </div>
      <div class="product-grid" id="productGrid">${productCards()}</div>
    </section>
    <section class="panel cart-panel">
      <div class="panel-head"><h2>Current sale</h2><button class="button secondary" id="clearCart">Clear</button></div>
      <div id="cartContent">${cartView()}</div>
      <button class="button primary full" id="saveSale" ${cart.length ? '' : 'disabled'}>Save sale</button>
      <p class="tiny muted">Stock deduction is processed atomically in the database.</p>
    </section>
  </div>`;
}

function productCards() {
  const q = ($('productSearch')?.value || '').toLowerCase();
  const c = $('productCategory')?.value || '';
  const rows = products.filter(p =>
    (!c || p.category === c) && p.name.toLowerCase().includes(q)
  );

  return rows.length
    ? rows.map(p => `<button class="product-card" data-add="${p.id}" ${p.stock <= 0 ? 'disabled' : ''}>
        <b>${escapeHtml(p.name)}</b>
        <span>${peso(p.selling_price)}</span>
        <small>${p.stock} in stock · ${escapeHtml(p.category || 'Uncategorized')}</small>
      </button>`).join('')
    : '<p class="empty">No matching products.</p>';
}

function cartView() {
  if (!cart.length) return '<p class="empty">No items yet. Select products to begin.</p>';

  const total = cart.reduce((n, x) => n + x.qty * x.price, 0);
  const cost = cart.reduce((n, x) => n + x.qty * x.cost, 0);

  return `<div class="cart-lines">
    ${cart.map(x => `<div class="cart-line">
      <div><b>${escapeHtml(x.name)}</b><small>${peso(x.price)} each</small></div>
      <input type="number" min="1" max="${x.stock}" value="${x.qty}" data-qty="${x.id}">
      <b>${peso(x.qty * x.price)}</b>
      <button class="icon-btn" data-remove="${x.id}" aria-label="Remove">×</button>
    </div>`).join('')}
  </div>
  <div class="cart-total"><span>Total</span><strong>${peso(total)}</strong></div>
  <p class="tiny muted">Estimated product cost: ${peso(cost)}</p>`;
}

/* The rest of your existing application functions remain unchanged. */
