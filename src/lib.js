export const peso = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0));
export const todayLocal = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
export function summarizeSales(sales = [], expenses = []) {
  const revenue = sales.reduce((n, s) => n + Number(s.total_amount || 0), 0);
  const cogs = sales.reduce((n, s) => n + Number(s.total_cost || 0), 0);
  const expenseTotal = expenses.reduce((n, e) => n + Number(e.amount || 0), 0);
  return { revenue, cogs, grossProfit: revenue - cogs, expenses: expenseTotal, netProfit: revenue - cogs - expenseTotal, transactions: sales.length };
}
export function filterByDate(rows, from, to, field = 'created_at') {
  return rows.filter(row => {
    const day = String(row[field] || '').slice(0, 10);
    return (!from || day >= from) && (!to || day <= to);
  });
}
export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
