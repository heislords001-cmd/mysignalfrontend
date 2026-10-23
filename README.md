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

## Deriv API keys (Bot tab)
Members paste their Deriv API key in the Bot tab. It is encrypted on the server and never shown again. This needs four settings in Vercel (Settings > Environment Variables). Set them as **Secret** and do NOT start the names with VITE_:
- `SUPABASE_URL` (the same Project URL) and `SUPABASE_SERVICE_KEY` (the service_role key)
- `TOKEN_ENCRYPTION_KEY`: 64 random hex characters. Make one in PowerShell:
  `$b = New-Object byte[] 32; (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''`
  Keep a private copy: if you lose it, saved keys cannot be read and members must paste them again.
- `DERIV_APP_ID`: optional. `1089` is Deriv's public test id. Register your own at Deriv for real use.
After adding them, press Redeploy.
