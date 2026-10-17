"""Builds public/fx-bot.zip, the bot members download from the site, with YOUR Supabase address filled in.
Runs automatically before every build. Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from the environment or from .env."""
import os
import pathlib
import zipfile

root = pathlib.Path(__file__).parent
env = dict(os.environ)
p = root / ".env"
if p.exists():
    for line in p.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env.setdefault(k.strip(), v.strip())
url = env.get("VITE_SUPABASE_URL") or "PASTE_YOUR_SUPABASE_URL"
anon = env.get("VITE_SUPABASE_ANON_KEY") or "PASTE_YOUR_ANON_KEY"

ENV = f"""SUPABASE_URL={url}
SUPABASE_ANON_KEY={anon}
FX_EMAIL=
FX_PASSWORD=
TRADING_MODE=demo
MT5_LOGIN=
MT5_PASSWORD=
MT5_SERVER=
MT5_SUFFIX=
"""
README = """FX Desk bot (runs on YOUR Windows PC)

Before you start
- A Windows PC that stays on while the bot runs
- MetaTrader 5 installed and logged in to your broker account (start with a DEMO account, hedging type)
- Python 3.11 or newer (tick "Add to PATH" when installing)

Steps
1. Rename env.example to .env and fill in FX_EMAIL and FX_PASSWORD (your FX Desk login), then MT5_LOGIN, MT5_PASSWORD and MT5_SERVER.
   If your broker's pair names have a letter added (like EURUSDm), fill in MT5_SUFFIX.
2. Open a terminal in this folder and run: pip install -r requirements.txt
3. Run: python bot.py
4. On the site, open the Bot tab and press Turn bot on.

Your MT5 password stays on your PC. The bot only sends your trades and balance to your own page on the site.
Keep TRADING_MODE=demo until you trust it. Trading carries risk and you can lose money.
"""
out = root / "public" / "fx-bot.zip"
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in ("config.py", "strategy.py", "broker.py", "risk.py", "engine.py", "cloud.py", "bot.py"):
        z.write(root / "member-bot" / f, f"fx-bot/{f}")
    z.writestr("fx-bot/requirements.txt", "pandas>=2.0\nnumpy>=1.26\nrequests>=2.31\nMetaTrader5\n")
    z.writestr("fx-bot/env.example", ENV)
    z.writestr("fx-bot/README.txt", README)
print("wrote", out)
