# OneUp

A subscription ride service for Lagos (and, next, other African cities). Members pay one monthly bill and ride on distance credits — no surge, flat fares, inspected cars from 2018 or newer, and drivers who earn more and steadier.

This is a working prototype: a marketing landing page, a sign‑in / create‑account flow, and two app dashboards — one for **riders**, one for **drivers** — backed by a small **Node server** that persists accounts, driver qualification status, and trips to a local SQLite database. Pricing research is behind the "Business case" link in the footer.

Accounts are **real**: you sign up with a name, email and password (hashed with scrypt). Sign‑in only logs into an existing account — it never auto‑creates one. New drivers start unqualified and must pass the four checks **and** be approved by an admin before they can take a job.

> Not yet wired (next steps): online **payments** (subscriptions + driver payouts), **live GPS / maps** (distances are entered, not measured yet), email/SMS **verification** and password reset. These need third‑party accounts (Paystack, Google Maps, an email/SMS provider) and are the next build phase.

## Run it on localhost

You need **Node 24 or newer** (for the stable built‑in SQLite module; 22 works with `node --experimental-sqlite server.js`). No `npm install` — the server uses only Node built‑ins.

```bash
cd oneup
node server.js       # or: npm start
```
Then open <http://localhost:3000>. The server serves the site **and** the API, and creates the database on first run. Set a different port with `PORT=4000 node server.js`.

Make your first approved driver: sign up as a driver → finish the 4 qualification steps → open **Admin** (footer, key `oneup-admin`) → **Approve**. To reset all data, stop the server and delete `oneup.db`.

## Deploy it live (so real people can use it)

The repo is ready to deploy to **[Render](https://render.com)** straight from GitHub:

1. Push this repo to GitHub (it already is).
2. On Render: **New + → Blueprint →** pick this repo. It reads `render.yaml` and sets everything up.
3. Render generates a strong `ADMIN_KEY` for you (see it under the service's **Environment**). The included **1 GB disk** keeps accounts and trips across restarts (needs the paid *starter* instance; the free one works to try it but resets data on each deploy).
4. You get a public `https://oneup.onrender.com`‑style URL. Share it — riders and drivers can sign up and use it.

Configuration is all via environment variables: `PORT`, `ADMIN_KEY` (required in production — the server refuses to start with the default), and `DB_PATH` (set to `/data/oneup.db` for the persistent disk). Security headers and a production guard are built in.

> Before a true public launch you still need: Paystack/Maps/verification wired (next phase), plus the real‑world requirements — a **Lagos e‑hailing operator licence**, **insurance**, business registration and a background‑check provider.

## What's inside

| Flow | What it shows |
|------|---------------|
| **Landing page** | Hero, why OneUp, how it works, the apps, plans & pricing, drive-with-OneUp, footer |
| **Sign in / Create account** | Choose Rider or Driver, then the platform |
| **Rider dashboard** | Bottom-tab app: Home (live credits, bill, usage) · Book (book → match → ride → rate) · Trips · Plan (switch) · Account |
| **Driver dashboard** | Bottom-tab app: Home (earnings, floor, tier) · Jobs (go online → accept → trip → payout) · Trips · Vehicle · Account |
| **Driver qualification** | A 4-step gate every new driver must clear: **vehicle 2018+** (older is rejected), **documents**, **inspection**, **background check** — then the application is **submitted for admin review**. Jobs stay locked until an admin approves. |
| **Admin** | Sign in with the admin key to see every driver application and **approve or reject** each one (with a reason). Approval is what unlocks a driver's jobs. |
| **Business case** | Pricing research: rider savings, driver earnings, unit economics (footer link) |

### Admin approval

Submitting qualification no longer auto-approves a driver — it sends the application to a human admin.

1. On the landing page, click **Admin** in the footer (or go to the site and open the admin link).
2. Enter the admin key. Default is **`oneup-admin`** — change it with the `ADMIN_KEY` env var: `ADMIN_KEY=secret node server.js`.
3. You'll see each driver's vehicle (with a 2018+ check), document count, inspection and background status, and when they applied. Click **Approve** or **Reject** (with a reason).

The driver's app shows **"under review"** while pending (and polls for the decision), unlocks jobs on approval, or shows the rejection reason so they can fix and resubmit. The server enforces this: a driver stays unqualified — and `POST /api/trips` returns 403 — until an admin approves.

### Driver qualification gate

Drivers use **their own cars**, so before they can accept a single job they must pass:

1. **Vehicle 2018+** — enter make, model and year. A 2017-or-older car is refused and can't continue.
2. **Documents** — driver's licence, vehicle registration, insurance, roadworthiness certificate, proof the car is theirs.
3. **Inspection** — book and pass a safety & condition check.
4. **Background check** — identity and driving-history verification.

Only when all four are verified do the **Jobs** and **Trips** tabs unlock, and the driver sees a clear "you're cleared to drive" confirmation before taking work. (Sign in as a driver to see an already-qualified account; create a new driver account to walk the funnel.)

## Pricing model (Lagos, ₦)

Positioning: **one flat rate that never surges** — priced around Bolt's ₦160/km sticker, so riders pay ~30% less than the ₦230/km peak fares that hit exactly when they travel.

| Plan | Price / mo | Credits | Effective | vs ₦230 peak |
|------|-----------|---------|-----------|--------------|
| Starter | ₦20,000 | 120 km | ₦167/km | ~27% under |
| Lite | ₦57,000 | 350 km | ₦163/km | ~29% under |
| Commuter | ₦112,000 | 700 km | ₦160/km | ~30% under |
| Pro | ₦224,000 | 1,400 km | ₦160/km | ~30% under |
| Max | ₦310,000 | 2,000 km | ₦155/km | ~33% under |

Km buckets are sized to **real Lagos commutes** — Pro covers ~54 km/day, Max ~70 km/day — so a monthly plan no longer runs out mid-month. Every plan is profitable **even if the member uses all their kilometres** (Max ≈ 8%, Pro ≈ 11% gross at 100% use), so breakage is upside rather than survival. There is **no overflow cliff**: a member who uses up their plan is **auto-upgraded** to the tier that covers them for that cycle (never a penalty), and past Max, extra km bill at Max's own ₦155/km.

Drivers are paid at **0% commission** (Bolt takes 25%, so at the same fare the OneUp driver keeps more) with a **₦700 per-trip floor**, a guaranteed weekly floor and tier bonuses. Pay is **fuel-aware**, and **efficient vehicles get priority**, because Lagos petrol (~₦1,380/l ≈ ₦153/km) would otherwise sink a driver:

| Fuel | OneUp pays | Fuel/km | Maint. | Driver take-home |
|------|-----------|---------|--------|------------------|
| Hybrid (priority) | ₦143/km | ₦70 | ₦18 | **+₦55/km** |
| CNG (where refuelling exists) | ₦120/km | ₦45 | ₦18 | +₦57/km |
| Thirsty petrol | ₦170/km | ₦153 | ₦18 | −₦1/km |

The fleet is **efficient/hybrid-first**. A hybrid runs on ordinary petrol (no special refuelling) but roughly halves fuel, so a hybrid driver clears a real wage on a fare that only matches Bolt's sticker. Thirsty-petrol drivers get a higher interim rate (never underwater) and are steered to an efficient car. Each driver sees their real take-home per km in the app's Vehicle tab.

OneUp's margin comes from subscription breakage, plan mix, and profitable overflow. The app also **nudges riders onto the right-size plan** — up if they use 90%+, down if they use ≤35%. **Launch is concentrated** in one dense zone and expands only when the numbers work — density means less empty driving, which lifts driver take-home on the same fuel. Figures are 2026 estimates — validate with a pilot.

## Tech

Vanilla HTML/CSS/JS front end + a zero‑dependency Node backend. No build step, no frameworks, no `node_modules`.

```
index.html   markup: landing, auth, phone app shell + all dashboard views
styles.css   all styling (clean, minimal, theme-aware light/dark)
app.js       front end: routing, auth, dashboards, flows — calls the API
server.js    Node backend (http + node:sqlite + node:crypto): serves site + JSON API + admin
oneup.db     SQLite database, created at runtime (gitignored)
```

### API

All JSON. Auth via `Authorization: Bearer <token>` (token stored client‑side after signup/login).

| Method & path | Purpose |
|---|---|
| `POST /api/signup` | Create account `{role,name,email,password,plan?}` → `{token,user}` |
| `POST /api/login` | Sign in `{role,email,password}` → `{token,user}` |
| `GET /api/me` | Current user |
| `POST /api/plan` | Rider: change plan `{plan}` |
| `POST /api/qualification` | Driver: `{action:'vehicle'|'doc'|'inspection'|'background'|'submit', ...}` (2018+ enforced server‑side; `submit` → pending review) |
| `GET /api/trips` | List the user's trips |
| `POST /api/trips` | Record a trip `{from,to,km}` — updates rider credits or driver earnings (driver must be approved) |
| `POST /api/admin/login` | `{key}` → admin token |
| `GET /api/admin/drivers` | Admin: list all driver applications |
| `POST /api/admin/decision` | Admin: `{id, decision:'approve'|'reject', reason?}` |

Data persists across refreshes and restarts. Qualification can't be faked: the server rejects a pre‑2018 vehicle and won't mark a driver qualified until all four checks are stored.

## Structure of a real build (next step)

This prototype is the front end. A production version would add:
- A backend/API (accounts, plans, credits, trips, payments)
- Driver matching and live location
- Payment rails (cards, bank transfer, mobile money)
- Separate rider and driver native apps (e.g. React Native)
