# Mercan Food Sales & Inventory

A Vercel + Supabase shared-account application for food sales, inventory, expenses and reporting.

- Shared login with registration disabled (configure this in Supabase Auth).
- Supabase PostgreSQL is the source of truth.
- Supabase Realtime subscriptions synchronize products, sales, sale items and expenses.
- Atomic sale creation locks stock rows and prevents overselling during simultaneous checkout.
- Atomic void operation restores stock.

See [SETUP.md](./SETUP.md) for complete Supabase and Vercel deployment steps.

## Local development

```bash
cp .env.example .env.local
# Edit .env.local with your Supabase URL and public anon/publishable key
npm install
npm run dev
```

## Test and build

```bash
npm test
npm run build
```
