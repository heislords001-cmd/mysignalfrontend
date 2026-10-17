# FX Desk website (frontend)

This is the website: landing page, sign in, signals, bot page, profile and payments.

## Before you start
Run `supabase-setup.sql` once in a NEW Supabase project (SQL Editor). It is a separate file.

## Put it online (Vercel)
1. Put this folder on GitHub as its own repository.
2. In Vercel: Add New > Project > choose that repository.
3. Add these Environment Variables (names are also in `.env.example`):
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Supabase > Project Settings > API)
   - Later, for payments: `VITE_PAYSTACK_PUBLIC_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `PAYSTACK_SECRET_KEY`
4. Press Deploy.

## First login
Sign up on your own site. Then in Supabase > SQL Editor run this with YOUR email, to make yourself admin:
`update profiles set role = 'admin' where email = 'you@example.com';`

## Good to know
- Prices: change them in `src/plans.ts` (what people see) and `api/verify.ts` (what the server checks).
- `public/fx-bot.zip` is the bot members download. It is rebuilt on every deploy from the `member-bot` folder, with your Supabase address filled in.
- Only the PUBLIC keys go in the website. The service key and Paystack secret key only go in Vercel's server settings, never in code.
