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

## Auto-trading bot (Deriv)
When the scanner saves a signal, Supabase calls `/api/execute` on this site, and the bot places a trade on every member's Deriv account that has the bot ON.
Safety rules built in: only approved signals; DEMO Deriv accounts only for now (real accounts are refused); the stake is capped at $10; the stop loss can lose at most half of the stake; limits on open trades and trades per day; one trade per signal per member.
This has NOT been tested against the real Deriv yet. Start on a Deriv demo account and watch the "Trades sent" list in the Bot tab.

Setup, after the Deriv key steps above:
1. In Vercel add `WEBHOOK_SECRET` (any long random text, as a Secret) and press Redeploy.
2. In Supabase: Database, then Webhooks, then Create a new hook:
   - Table `signals`, event `Insert`
   - Type HTTP Request, method POST, URL `https://YOUR-SITE.vercel.app/api/execute`
   - Add an HTTP header named `Authorization` with the value `Bearer ` followed by your WEBHOOK_SECRET
3. Run `migration-2.sql` and `migration-3.sql` in the SQL Editor (once each).
4. In the Bot tab: paste your Deriv demo API key, press Turn bot on.
As admin you can also tick "Also trade untested signals" to forward-test on your own demo account.

## When something does not work: the System check
Sign in as admin, open Profile, then Bot access, then press **Run check**. It lists every Vercel setting and database step that is missing, and how fixed the scanner is (last check, strategies passed, last error). It never shows a secret. If the check itself says it is not on your site yet, the latest website files were not uploaded or Vercel has not redeployed.

## Scalp mode (the bot trades small and quick on its own)
Besides following signals, the bot can read the market itself. The scanner saves what it sees on each pair (the bigger trend, the price, the 5-minute average, the typical candle size) in a table called `market_state`. When it changes, Supabase calls `/api/scalp`. For every member who switched scalp mode on, the bot opens a small trade with a tiny take profit and a stop loss. Deriv closes each trade by itself when it hits its target, and the next pass opens another while the trend holds.
Limits built in: demo accounts only; a stop loss on every trade that can lose at most half the stake; stake capped at $10; at most 2 scalps per pair, 6 open, and 20 a day by default (the member can lower these).
It checks about every 5 minutes, because that is how often the free scanner runs. Deriv also charges fees on multiplier trades, which can eat a tiny profit. This mode has not been tested against the real Deriv: watch the results on a demo account.

Setup, in addition to the signal webhook:
1. Run `migration-4.sql` in the Supabase SQL Editor (once).
2. Upload the new backend files too (the scanner has to save `market_state`).
3. In Supabase, Database, Webhooks, create a SECOND hook: table `market_state`, events `Insert` and `Update`, method POST, URL `https://YOUR-SITE.vercel.app/api/scalp`, and the same `Authorization` header as the first hook.
4. In the Bot tab, switch Scalp mode on and press Save.
