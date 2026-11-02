# Mercan Food Sales & Inventory — deployment guide

This project is a Vercel-hosted web app with Supabase Auth, PostgreSQL and Realtime. All signed-in devices use the same cloud data. It does not use browser localStorage as its database.

## 1. Prepare Supabase

1. Open your existing Supabase project.
2. Go to **SQL Editor → New query**.
3. Open `supabase/schema.sql` from this folder, copy all of it, paste it into SQL Editor, and click **Run**.
4. In **Authentication → Providers → Email**, keep Email enabled.
5. In **Authentication → Settings** (or **Sign In / Providers**, depending on dashboard version), turn **off new user sign-ups**. Existing users can still sign in.
6. Go to **Authentication → Users → Add user → Create new user**. Create exactly one shared login. Use an email address and password that your staff can use. Confirm the user if Supabase asks.
7. Keep the email/password private and share it only with authorized staff.

The SQL policies allow authenticated sessions only. With sign-ups disabled and only one user manually created, that is the shared account. Do not create additional Auth users unless you intentionally want to expand access.

## 2. Configure the app

The app needs two public frontend settings:

- `VITE_SUPABASE_URL`: Supabase **Project URL**
- `VITE_SUPABASE_ANON_KEY`: Supabase **anon/public** key or newer **publishable** key

Find them in **Project Settings → API** or **API Keys**. Never use the `service_role` / secret key in this app. Never put your database password in the frontend.

For local testing, copy `.env.example` to `.env.local` and replace the example values. Do not commit `.env.local` to GitHub.

## 3. Deploy to Vercel

1. Upload/push the contents of this folder to your GitHub repository.
2. In Vercel, choose **Add New → Project** and import that repository.
3. Framework preset: **Vite**. Build command: `npm run build`. Output directory: `dist`.
4. In Vercel → Project → Settings → Environment Variables, add:
   - `VITE_SUPABASE_URL` = your Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon/public or publishable key
5. Apply variables to Production (and Preview if desired), then deploy or redeploy.
6. Open the deployed URL and sign in using the shared account created in step 1.

## 4. Verify real-time sync

1. Open the deployed URL in two different browsers/devices and sign in on both using the same account.
2. Add a test product on device A. It should appear on device B automatically.
3. Record a test sale on device A. Device B should show the sale and the reduced stock without manually refreshing.
4. Add a test expense and confirm it appears on device B.
5. Void the test sale and confirm the stock is restored on both devices.
6. Remove test records when finished.

A small status label in the app shows **Live sync**. Realtime updates are event-driven; the app also has a Refresh button as a fallback.

## 5. Important notes

- Everyone using the shared login has the same permissions. There is no per-employee attribution/audit trail in this version.
- The database function locks product rows while saving a sale, so two devices cannot both sell the same last unit.
- Sales and their item snapshots are preserved if a product is later deleted.
- The Reports page currently supports a custom date range. CSV exports are available for sales history and report data.
- Back up your Supabase project regularly. CSV exports are not a complete database backup.

## Troubleshooting

- **Configuration needed**: check that both Vercel environment variables are present, spelled exactly, and then redeploy.
- **Invalid login**: confirm the one Auth user exists, the email/password are correct, and the user is confirmed.
- **Permission denied**: rerun `supabase/schema.sql` in SQL Editor and check that the user is signed in.
- **Realtime not updating**: check that the four tables are in the `supabase_realtime` publication; rerun the SQL file. Confirm Realtime is enabled for the project.

## Test status before handoff

The included Node test suite covers core calculations, inclusive date filtering, HTML escaping, local date formatting and PHP currency formatting. JavaScript syntax checks should pass before deployment. A production Vite build and live Supabase multi-device test still need to be run after dependencies and your project credentials are available.
