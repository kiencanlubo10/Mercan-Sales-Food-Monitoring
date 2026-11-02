import test from 'node:test';
import assert from 'node:assert/strict';
import { peso, todayLocal, summarizeSales, filterByDate, escapeHtml } from '../src/lib.js';

test('summarizes revenue, COGS, gross profit, expenses and net profit', () => {
  const result = summarizeSales([{total_amount:100,total_cost:60},{total_amount:50,total_cost:20}], [{amount:15}]);
  assert.deepEqual(result, {revenue:150,cogs:80,grossProfit:70,expenses:15,netProfit:55,transactions:2});
});
test('filters rows inclusively by date', () => {
  const rows = [{created_at:'2026-11-01T10:00:00Z'},{created_at:'2026-11-02T10:00:00Z'},{created_at:'2026-11-03T10:00:00Z'}];
  assert.equal(filterByDate(rows,'2026-11-02','2026-11-03').length,2);
});
test('escapes HTML special characters', () => {
  assert.equal(escapeHtml(`<b>"Mercan" & 'Cafe'</b>`), '&lt;b&gt;&quot;Mercan&quot; &amp; &#39;Cafe&#39;&lt;/b&gt;');
});
test('local date uses YYYY-MM-DD', () => {
  assert.match(todayLocal(new Date(2026,10,2)), /^2026-11-02$/);
});
test('currency formatter returns PHP currency', () => {
  assert.match(peso(100), /100/);
});
