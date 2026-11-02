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
  const el = $('toast'); if (!el) return;
  el.textContent = message; el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(notify.timer); notify.timer = setTimeout(() => el.className = 'toast', 3000);
}
function loginView(message = '') {
  app.innerHTML = `<main class="login-shell"><section class="login-card"><div class="brand-mark">M</div><p class="eyebrow">MERCAN INTERNET CAFE</p><h1>Food Sales & Inventory</h1><p class="muted">Sign in using the shared business account.</p>${message ? `<div class="error-note">${escapeHtml(message)}</div>` : ''}<form id="loginForm"><label>Email / username<input id="loginEmail" type="text" autocomplete="username" required placeholder="Shared account email"></label><label>Password<input id="loginPassword" type="password" autocomplete="current-password" required placeholder="Password"></label><button class="primary full" type="submit">Sign in</button></form><p class="tiny muted">Registration is disabled. Ask the system administrator for the shared login.</p></section></main>`;
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault(); const email = $('loginEmail').value.trim(); const password = $('loginPassword').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) loginView(error.message);
  });
}
function shell() {
  app.innerHTML = `<div class="layout"><aside class="sidebar"><div class="brand"><div class="brand-mark small-mark">M</div><div><b>Mercan Manager</b><small>Sales · Inventory · Profit</small></div></div><nav id="nav"><button data-page="dashboard">▦ Dashboard</button><button data-page="pos">＋ New sale</button><button data-page="inventory">▤ Inventory</button><button data-page="history">↺ Sales history</button><button data-page="expenses">₱ Expenses</button><button data-page="reports">▥ Reports</button></nav><div class="side-foot"><span class="live-dot"></span> Cloud connected<br><small>Real-time synchronization on</small></div></aside><main class="content"><header class="topbar"><div><p class="eyebrow">MERCAN INTERNET CAFE</p><h1 id="pageTitle">Dashboard</h1><p class="muted" id="subTitle">Shared business workspace</p></div><div class="top-actions"><span class="sync-label"><i class="live-dot"></i> Live sync</span><button id="refreshBtn" class="button secondary">Refresh</button><button id="logoutBtn" class="button ghost">Sign out</button></div></header><div id="pageContent"></div></main></div><div id="modalRoot"></div><div id="toast" class="toast"></div>`;
  $('nav').addEventListener('click', e => { const b = e.target.closest('[data-page]'); if (b) go(b.dataset.page); });
  $('logoutBtn').onclick = async () => { await supabase.auth.signOut(); };
  $('refreshBtn').onclick = () => loadData(true);
  go('dashboard');
}
function go(next) { page = next; document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page)); const names = {dashboard:'Dashboard',pos:'New Sale',inventory:'Inventory',history:'Sales History',expenses:'Expenses',reports:'Reports'}; $('pageTitle').textContent = names[page]; render(); }
async function loadData(showMessage = false) {
  if (!session || busy) return; busy = true;
  try {
    const [p, s, e] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('sales').select('*, sale_items(*)').order('created_at', { ascending: false }).limit(1500),
      supabase.from('expenses').select('*').order('expense_date', { ascending: false }).limit(1500)
    ]);
    for (const r of [p,s,e]) if (r.error) throw r.error;
    products = p.data || []; sales = s.data || []; expenses = e.data || [];
    render(); if (showMessage) notify('Data refreshed from cloud.');
  } catch (err) { notify(err.message || 'Unable to load data.', true); }
  finally { busy = false; }
}
function subscribe() {
  if (channel) supabase.removeChannel(channel);
  channel = supabase.channel('mercan-shared-data')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => loadData())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => loadData())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sale_items' }, () => loadData())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => loadData())
    .subscribe(status => { const dot = document.querySelector('.sync-label'); if (dot) dot.title = `Realtime status: ${status}`; });
}
function activeSales() { return sales.filter(s => s.status === 'completed'); }
function saleCost(s) { return Number(s.total_cost || 0); }
function saleItems(s) { return s.sale_items || []; }
function metric(label, value, hint = '') { return `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`; }
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
  const today = todayLocal(); const todays = activeSales().filter(s => String(s.created_at).slice(0,10) === today);
  const dayExpenses = expenses.filter(e => e.expense_date === today);
  const m = summarizeSales(todays, dayExpenses); const low = products.filter(p => Number(p.stock) <= Number(p.low_stock_at));
  const week = Array.from({length:7}, (_,i) => { const d = new Date(); d.setDate(d.getDate() - (6-i)); const key = todayLocal(d); return { key, total: activeSales().filter(s => String(s.created_at).slice(0,10) === key).reduce((n,s)=>n+Number(s.total_amount),0) }; });
  const max = Math.max(1, ...week.map(x=>x.total));
  const best = new Map(); activeSales().forEach(s => saleItems(s).forEach(i => best.set(i.product_name, (best.get(i.product_name)||0)+Number(i.quantity))));
  const top = [...best.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
  return `<div class="metrics">${metric("Today's sales",peso(m.revenue),`${m.transactions} transactions`)}${metric('Cost of goods',peso(m.cogs),'Based on saved item costs')}${metric('Gross profit',peso(m.grossProfit),'Sales less product cost')}${metric('Net profit',peso(m.netProfit),'After today\'s expenses')}</div><div class="two-col"><section class="panel"><div class="panel-head"><h2>Sales overview</h2><span class="muted">Last 7 days</span></div>${week.map(x=>`<div class="bar-row"><span>${new Date(`${x.key}T12:00:00`).toLocaleDateString('en-PH',{weekday:'short'})}</span><div class="bar"><i style="width:${x.total/max*100}%"></i></div><b>${peso(x.total)}</b></div>`).join('')}</section><section class="panel"><div class="panel-head"><h2>Low stock alerts</h2><span class="tag warn">${low.length} items</span></div>${low.length?low.map(p=>`<div class="list-row"><span>${escapeHtml(p.name)}</span><b>${p.stock} left</b></div>`).join(''):'<p class="empty">All stock levels look good.</p>'}</section></div><div class="two-col"><section class="panel"><h2>Best-selling products</h2>${top.length?top.map(([name,qty])=>`<div class="list-row"><span>${escapeHtml(name)}</span><b>${qty} sold</b></div>`).join(''):'<p class="empty">No sales recorded yet.</p>'}</section><section class="panel"><h2>Inventory snapshot</h2><div class="quick-stats"><div><b>${products.length}</b><span>Products</span></div><div><b>${products.reduce((n,p)=>n+Number(p.stock),0)}</b><span>Total stock units</span></div><div><b>${activeSales().length}</b><span>Completed sales</span></div></div></section></div>`;
}
function posView() {
  const cats = [...new Set(products.map(p=>p.category).filter(Boolean))];
  return `<div class="pos-grid"><section class="panel"><div class="panel-head"><h2>Select products</h2><span class="muted">Tap to add</span></div><div class="toolbar"><input id="productSearch" placeholder="Search products…"><select id="productCategory"><option value="">All categories</option>${cats.map(c=>`<option>${escapeHtml(c)}</option>`).join('')}</select></div><div class="product-grid" id="productGrid">${productCards()}</div></section><section class="panel cart-panel"><div class="panel-head"><h2>Current sale</h2><button class="button secondary" id="clearCart">Clear</button></div><div id="cartContent">${cartView()}</div><button class="button primary full" id="saveSale" ${cart.length?'':'disabled'}>Save sale</button><p class="tiny muted">Stock deduction is processed atomically in the database.</p></section></div>`;
}
function productCards() { const q = ($('productSearch')?.value||'').toLowerCase(), c = $('productCategory')?.value||''; const rows=products.filter(p=>(!c||p.category===c)&&p.name.toLowerCase().includes(q)); return rows.length?rows.map(p=>`<button class="product-card" data-add="${p.id}" ${p.stock<=0?'disabled':''}><b>${escapeHtml(p.name)}</b><span>${peso(p.selling_price)}</span><small>${p.stock} in stock · ${escapeHtml(p.category||'Uncategorized')}</small></button>`).join(''):'<p class="empty">No matching products.</p>'; }
function cartView() { if(!cart.length)return '<p class="empty">No items yet. Select products to begin.</p>'; const total=cart.reduce((n,x)=>n+x.qty*x.price,0), cost=cart.reduce((n,x)=>n+x.qty*x.cost,0); return `${cart.map(x=>`<div class="cart-row"><div><b>${escapeHtml(x.name)}</b><small>${peso(x.price)} each</small></div><input type="number" min="1" max="${x.stock}" value="${x.qty}" data-qty="${x.id}"><b>${peso(x.qty*x.price)}</b><button class="icon-btn" data-remove="${x.id}">×</button></div>`).join('')}<div class="totals"><div><span>Estimated cost</span><b>${peso(cost)}</b></div><div><span>Estimated profit</span><b class="positive">${peso(total-cost)}</b></div><div class="grand"><span>Total due</span><b>${peso(total)}</b></div></div>`; }
function inventoryView() { return `<section class="panel"><div class="panel-head"><div><h2>Product inventory</h2><p class="muted">Manage costs, prices, and stock.</p></div><button class="button primary" id="addProduct">＋ Add product</button></div><div class="toolbar"><input id="inventorySearch" placeholder="Search products…"><span class="muted">${products.length} products</span></div><div class="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Cost</th><th>Selling price</th><th>Profit / unit</th><th>Stock</th><th>Low alert</th><th></th></tr></thead><tbody id="inventoryRows">${inventoryRows()}</tbody></table></div></section>`; }
function inventoryRows() { const q=($('inventorySearch')?.value||'').toLowerCase(); const rows=products.filter(p=>(p.name+' '+(p.category||'')).toLowerCase().includes(q)); return rows.length?rows.map(p=>`<tr><td><b>${escapeHtml(p.name)}</b></td><td>${escapeHtml(p.category||'—')}</td><td>${peso(p.cost_price)}</td><td>${peso(p.selling_price)}</td><td class="positive">${peso(p.selling_price-p.cost_price)}</td><td><span class="tag ${p.stock<=p.low_stock_at?'warn':'good'}">${p.stock}</span></td><td>${p.low_stock_at}</td><td><button class="button small secondary" data-edit-product="${p.id}">Edit</button> <button class="button small danger" data-delete-product="${p.id}">Delete</button></td></tr>`).join(''):'<tr><td colspan="8" class="empty">No products yet.</td></tr>'; }
function historyView() { return `<section class="panel"><div class="panel-head"><div><h2>Sales history</h2><p class="muted">Completed and voided transactions.</p></div><button class="button secondary" id="exportSales">Export CSV</button></div><div class="toolbar"><input type="date" id="historyDate"><select id="historyStatus"><option value="">All statuses</option><option value="completed">Completed</option><option value="void">Void</option></select></div><div class="table-wrap"><table><thead><tr><th>Date / time</th><th>Items</th><th>Sales</th><th>Cost</th><th>Profit</th><th>Status</th><th></th></tr></thead><tbody id="historyRows">${historyRows()}</tbody></table></div></section>`; }
function historyRows() { const date=$('historyDate')?.value||'',status=$('historyStatus')?.value||''; const rows=sales.filter(s=>(!date||String(s.created_at).slice(0,10)===date)&&(!status||s.status===status)); return rows.length?rows.map(s=>`<tr><td>${new Date(s.created_at).toLocaleString('en-PH')}</td><td>${saleItems(s).map(i=>`${escapeHtml(i.product_name)} × ${i.quantity}`).join('<br>')}</td><td>${peso(s.total_amount)}</td><td>${peso(s.total_cost)}</td><td class="positive">${peso(s.total_amount-s.total_cost)}</td><td><span class="tag ${s.status==='void'?'warn':'good'}">${s.status}</span></td><td>${s.status==='completed'?`<button class="button small danger" data-void-sale="${s.id}">Void</button>`:'—'}</td></tr>`).join(''):'<tr><td colspan="7" class="empty">No transactions found.</td></tr>'; }
function expensesView() { return `<section class="panel"><div class="panel-head"><div><h2>Expenses</h2><p class="muted">Track daily operating costs.</p></div><button class="button primary" id="addExpense">＋ Add expense</button></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th></th></tr></thead><tbody>${expenses.length?expenses.map(e=>`<tr><td>${e.expense_date}</td><td>${escapeHtml(e.category)}</td><td>${escapeHtml(e.description||'—')}</td><td>${peso(e.amount)}</td><td><button class="button small danger" data-delete-expense="${e.id}">Delete</button></td></tr>`).join(''):'<tr><td colspan="5" class="empty">No expenses recorded.</td></tr>'}</tbody></table></div></section>`; }
function reportsView() { const from=$('reportFrom')?.value||state.from, to=$('reportTo')?.value||state.to; const filtered=activeSales().filter(s=>{const d=String(s.created_at).slice(0,10);return d>=from&&d<=to;}); const ex=expenses.filter(e=>e.expense_date>=from&&e.expense_date<=to); const m=summarizeSales(filtered,ex); return `<section class="panel"><div class="panel-head"><div><h2>Profit & sales report</h2><p class="muted">Choose a date range. Values update from cloud records.</p></div></div><div class="toolbar"><label>From <input type="date" id="reportFrom" value="${from}"></label><label>To <input type="date" id="reportTo" value="${to}"></label><button class="button secondary" id="applyReport">Apply</button><button class="button secondary" id="exportReport">Export CSV</button></div><div class="metrics compact">${metric('Revenue',peso(m.revenue))}${metric('Cost of goods',peso(m.cogs))}${metric('Gross profit',peso(m.grossProfit))}${metric('Expenses',peso(m.expenses))}${metric('Net profit',peso(m.netProfit))}</div><p class="muted">${m.transactions} completed transactions in this period.</p></section>`; }
function modal(title, body) { $('modalRoot').innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="modal"><div class="panel-head"><h2>${title}</h2><button class="icon-btn" id="closeModal">×</button></div>${body}</section></div>`; $('closeModal').onclick=closeModal; $('modalBackdrop').onclick=e=>{if(e.target.id==='modalBackdrop')closeModal();}; }
function closeModal(){ $('modalRoot').innerHTML=''; }
function productForm(p={}) { modal(p.id?'Edit product':'Add product',`<form id="productForm" class="form-grid"><label>Product name<input name="name" required value="${escapeHtml(p.name||'')}"></label><label>Category<input name="category" value="${escapeHtml(p.category||'Food')}"></label><label>Cost price (₱)<input name="cost_price" type="number" min="0" step="0.01" required value="${p.cost_price??''}"></label><label>Selling price (₱)<input name="selling_price" type="number" min="0" step="0.01" required value="${p.selling_price??''}"></label><label>Current stock<input name="stock" type="number" min="0" step="1" required value="${p.stock??0}"></label><label>Low stock alert at<input name="low_stock_at" type="number" min="0" step="1" required value="${p.low_stock_at??5}"></label><button class="button primary full span-2" type="submit">Save product</button></form>`); $('productForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const data=Object.fromEntries(f);for(const k of ['cost_price','selling_price','stock','low_stock_at'])data[k]=Number(data[k]);const result=p.id?await supabase.from('products').update(data).eq('id',p.id):await supabase.from('products').insert(data);if(result.error)return notify(result.error.message,true);closeModal();notify('Product saved.');await loadData();}; }
function expenseForm(){modal('Add expense',`<form id="expenseForm" class="form-grid"><label>Date<input name="expense_date" type="date" required value="${todayLocal()}"></label><label>Category<input name="category" required value="Supplies"></label><label class="span-2">Description<input name="description" placeholder="e.g. cups, electricity, ingredients"></label><label>Amount (₱)<input name="amount" type="number" min="0.01" step="0.01" required></label><button class="button primary full span-2" type="submit">Save expense</button></form>`);$('expenseForm').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));d.amount=Number(d.amount);const {error}=await supabase.from('expenses').insert(d);if(error)return notify(error.message,true);closeModal();notify('Expense saved.');await loadData();};}
function bindPage(){
  $('productSearch')?.addEventListener('input',()=> $('productGrid').innerHTML=productCards()); $('productCategory')?.addEventListener('change',()=> $('productGrid').innerHTML=productCards());
  $('productGrid')?.addEventListener('click',e=>{const b=e.target.closest('[data-add]');if(!b)return;const p=products.find(x=>x.id===b.dataset.add);if(!p)return;const line=cart.find(x=>x.id===p.id);if(line){if(line.qty>=p.stock)return notify('Not enough stock.',true);line.qty++;}else cart.push({id:p.id,name:p.name,qty:1,price:Number(p.selling_price),cost:Number(p.cost_price),stock:Number(p.stock)});$('cartContent').innerHTML=cartView();$('saveSale').disabled=!cart.length;bindCart();});
  $('clearCart')?.addEventListener('click',()=>{cart=[];$('cartContent').innerHTML=cartView();$('saveSale').disabled=true;}); bindCart(); $('saveSale')?.addEventListener('click',saveSale);
  $('addProduct')?.addEventListener('click',()=>productForm()); $('inventorySearch')?.addEventListener('input',()=> $('inventoryRows').innerHTML=inventoryRows());
  $('inventoryRows')?.addEventListener('click',async e=>{const edit=e.target.closest('[data-edit-product]'),del=e.target.closest('[data-delete-product]');if(edit)productForm(products.find(p=>p.id===edit.dataset.editProduct));if(del&&confirm('Delete this product? Existing sale history is preserved.')){const {error}=await supabase.from('products').delete().eq('id',del.dataset.deleteProduct);if(error)notify(error.message,true);else{notify('Product deleted.');loadData();}}});
  $('historyDate')?.addEventListener('change',()=> $('historyRows').innerHTML=historyRows()); $('historyStatus')?.addEventListener('change',()=> $('historyRows').innerHTML=historyRows());
  $('historyRows')?.addEventListener('click',async e=>{const b=e.target.closest('[data-void-sale]');if(!b||!confirm('Void this sale? Stock will be returned.'))return;const {error}=await supabase.rpc('void_sale',{p_sale_id:b.dataset.voidSale});if(error)notify(error.message,true);else{notify('Sale voided and stock restored.');loadData();}});
  $('addExpense')?.addEventListener('click',expenseForm); $('pageContent')?.addEventListener('click',async e=>{const b=e.target.closest('[data-delete-expense]');if(b&&confirm('Delete this expense?')){const {error}=await supabase.from('expenses').delete().eq('id',b.dataset.deleteExpense);if(error)notify(error.message,true);else{notify('Expense deleted.');loadData();}}});
  $('applyReport')?.addEventListener('click',()=>{state.from=$('reportFrom').value;state.to=$('reportTo').value;render();}); $('exportReport')?.addEventListener('click',()=>exportCsv('report')); $('exportSales')?.addEventListener('click',()=>exportCsv('sales'));
}
function bindCart(){ $('cartContent')?.addEventListener('change',e=>{const id=e.target.dataset.qty;if(!id)return;const line=cart.find(x=>x.id===id);const qty=Math.floor(Number(e.target.value));if(!line)return;if(!Number.isInteger(qty)||qty<1||qty>line.stock){notify('Enter a valid quantity within stock.',true);return;}line.qty=qty;$('cartContent').innerHTML=cartView();bindCart();});$('cartContent')?.addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(!b)return;cart=cart.filter(x=>x.id!==b.dataset.remove);$('cartContent').innerHTML=cartView();$('saveSale').disabled=!cart.length;bindCart();}); }
async function saveSale(){if(!cart.length)return;const payload=cart.map(x=>({product_id:x.id,quantity:x.qty}));$('saveSale').disabled=true;const {error}=await supabase.rpc('create_sale',{items:payload});if(error){notify(error.message,true);$('saveSale').disabled=false;return;}cart=[];notify('Sale saved. Inventory updated on all connected devices.');await loadData();}
function exportCsv(kind){let rows;if(kind==='sales')rows=[['Date','Status','Products','Revenue','Cost','Profit'],...sales.map(s=>[s.created_at,s.status,saleItems(s).map(i=>`${i.product_name} x${i.quantity}`).join('; '),s.total_amount,s.total_cost,s.total_amount-s.total_cost])];else{const from=$('reportFrom').value,to=$('reportTo').value;rows=[['Date','Type','Description','Amount'],...activeSales().filter(s=>{const d=String(s.created_at).slice(0,10);return d>=from&&d<=to;}).map(s=>[s.created_at,'Sale','Completed sale',s.total_amount]),...expenses.filter(e=>e.expense_date>=from&&e.expense_date<=to).map(e=>[e.expense_date,'Expense',e.description,e.amount])];}const csv=rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`mercan-${kind}-${todayLocal()}.csv`;a.click();URL.revokeObjectURL(a.href);}

if (!SUPABASE_URL || !SUPABASE_KEY) { app.innerHTML='<main class="login-shell"><section class="login-card"><div class="brand-mark">M</div><h1>Configuration needed</h1><p>Add your Supabase Project URL and public anon/publishable key as Vercel environment variables:</p><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_ANON_KEY</code><p class="tiny muted">See SETUP.md in the project files. Never use a service_role key in the browser.</p></section></main>'; }
else {
  supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});

  // Keep asynchronous startup inside a function: Vite's default browser targets
  // do not support top-level await.
  async function initializeApp() {
    const { data: { session: current }, error } = await supabase.auth.getSession();
    if (error) {
      loginView(error.message);
      return;
    }
    session = current;
    if (session) {
      shell();
      subscribe();
      await loadData();
    } else {
      loginView();
    }

    supabase.auth.onAuthStateChange((_event, newSession) => {
      session = newSession;
      if (session) {
        shell();
        subscribe();
        loadData();
      } else {
        if (channel) supabase.removeChannel(channel);
        loginView();
      }
    });
  }

  initializeApp().catch(error => {
    console.error('Application startup failed:', error);
    loginView('Unable to start the application. Please refresh and try again.');
  });
}
