# Deploying Connection Pilot on Railway

Status: the app is **prepared** for Railway. Nothing has been deployed, no Railway
project exists yet, and DNS has not been changed. Railway's screens change
occasionally, so button names below may differ slightly.

## What Railway will run

| Item | Value |
|---|---|
| Build command | `npm run build` (set in `railway.json`) |
| Start command | `npm start` → `node dist/server.bundle.mjs` (set in `railway.json`) |
| Health check | `GET /api/health` (set in `railway.json`) |
| Node version | 22 (`.node-version`; `package.json` requires 22.22 or newer) |
| Port | Railway supplies `PORT`; the server listens on it automatically |
| Database | MySQL service in the same Railway project |

## Settings (environment variables) for the app service

Check what is set at any time with `npm run check:env` (prints names only, never values).

**Required to start**

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MYSQLHOST` / `MYSQLPORT` / `MYSQLUSER` / `MYSQLPASSWORD` / `MYSQLDATABASE` | Reference the MySQL service's variables (in Railway: add each as `${{ <MySQL service name>.MYSQLHOST }}`, etc.) |
| `BETTER_AUTH_SECRET` | A NEW random value (not the local one). Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `BETTER_AUTH_URL` | The exact address people use. While testing: the Railway test address. At launch: `https://connectionpilot.net` |
| `TZ` | `America/Toronto` (use the business's own time zone). **Set this.** The server groups shifts into schedule weeks using its own clock, and Railway's servers run on UTC, so without it a Sunday-evening shift can land in the wrong week and week lookups ("last week") can be an hour or a day out. Setting `TZ` makes the server match the business |

**Needed for features** (add when you have the accounts)

| Name | Used for |
|---|---|
| `RESEND_API_KEY` | All email (schedules, quotes, invoices, password resets, contact form). In production, email fails with a clear message if the key is missing; it does not print to a terminal and nothing is reported as "sent" |
| `EMAIL_FROM` | The sender address, on a domain verified in Resend. **Use the bare address only**, for example `noreply@connectionpilot.net`. Do **not** write `Name <noreply@connectionpilot.net>`: the app adds the business name itself (it sends as `"Somerset Pool" <noreply@connectionpilot.net>`), and a name inside this setting produces an invalid sender that Resend rejects. If it is missing, `noreply@connectionpilot.net` is used |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Payments and subscriptions |
| `OPENAI_API_KEY` | Pilot assistant, AI receptionist, document review |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Phone and text |
| `FIRECRAWL_API_KEY` | Learning about a business from its website |

**Optional**

| Name | Used for |
|---|---|
| `DB_SSL=false` | Only if the app reports that the database "does not support secure connection" |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Extra exact addresses allowed to sign in, comma separated (e.g. a staging address) |

Never put these values in the code, in this file, or in chat. Enter them only in Railway's Variables screen.

## Steps, in order

1. **Put the code somewhere Railway can read it.** The project is not a git repository yet. Either create a *private* GitHub repository (`git init`, commit, push), or use the Railway CLI. `.env` and `node_modules` are already excluded by `.gitignore`, so your local passwords are not uploaded.
2. **Create the Railway project** and add a **MySQL** database service. Set a **monthly spending limit** (Settings → Usage) before anything else; memory is the main cost driver.
3. **Add the app service** from the repository. Railway reads `railway.json`. Add the "Required to start" variables. Do **not** click "Generate Domain" until you want to test in a browser.
4. **Create the tables** in the empty Railway database. From your computer, run `npm run db:setup` with the database settings pointed at the MySQL service's *public* connection details (shown in the MySQL service's Connect tab: public host, port, user, password, database name). Put them in the terminal for that one command, not in a file you keep. It refuses to touch a database that already has tables. Turn the public connection off again afterwards.
5. **First test deploy.** Set `BETTER_AUTH_URL` to the test address, deploy, and walk through the test checklist below. A Railway test address has a long random name and is marked "noindex" for search engines, but anyone with the link could open it, so do not share it.
6. **Add the provider accounts** (Resend, Stripe test mode, Twilio, OpenAI) one at a time, testing each.
7. **Go live last:** add `connectionpilot.net` as a custom domain in Railway, add the DNS records it shows you at your domain provider, change `BETTER_AUTH_URL` to `https://connectionpilot.net`, and redeploy. Enable database backups before real customers arrive.

## Test checklist (before going live)

- [ ] `/api/health` returns OK
- [ ] Home, pricing, features, contact pages load with logo and hero image
- [ ] Sign up, log out, log in
- [ ] Password reset email arrives (needs Resend)
- [ ] Contact form email arrives at support@connectionpilot.net
- [ ] Workspace pages load (dashboard, customers, calendar, jobs, finance)
- [ ] Stripe checkout in **test mode**; webhook delivered
- [ ] Twilio test text/call (after the Twilio webhook check is updated, see below)
- [ ] Pilot assistant answers (needs OpenAI)
- [ ] `robots.txt` on the test address says `Disallow: /`; on connectionpilot.net it must allow crawling

## Known items still open before launch

1. **Twilio signature check** (`src/server/api/webhooks/twilio/shared.ts`) still lists old `airoapp.ai` addresses. It must be updated for the real address or real Twilio webhooks may be rejected.
2. **Cookie banner wording** still mentions advertising and analytics although no analytics tool is installed.
3. **Stripe webhook** endpoint in the Stripe dashboard must point to `<site address>/api/stripe/webhook` with the matching signing secret.
4. `package.json` name is still `v8-app-template`.
