# OneUp

A subscription ride service for Lagos (and, next, other African cities). Members pay one monthly bill and ride on distance credits — no surge, flat fares, inspected cars from 2018 or newer, and drivers who earn more and steadier.

This is a working prototype: a marketing landing page, a sign‑in / create‑account flow, and two app dashboards — one for **riders**, one for **drivers** — backed by a small **Node server** that persists accounts, driver qualification status, and trips to a local SQLite database. Pricing research is behind the "Business case" link in the footer.

> Prototype, not production: passwords are hashed but there's no email verification, HTTPS, or payment processing. For demo convenience, signing in with a new email creates that account.

## Run it on localhost

You need **Node 22 or newer** (for the built‑in SQLite module). No `npm install` — the server uses only Node built‑ins.

```bash
cd oneup
node server.js       # or: npm start
```
Then open <http://localhost:3000>. The server serves the site **and** the API, and creates `oneup.db` on first run. Set a different port with `PORT=4000 node server.js`.

To reset all data, stop the server and delete `oneup.db`.

## What's inside

| Flow | What it shows |
|------|---------------|
| **Landing page** | Hero, why OneUp, how it works, the apps, plans & pricing, drive-with-OneUp, footer |
| **Sign in / Create account** | Choose Rider or Driver, then the platform |
| **Rider dashboard** | Bottom-tab app: Home (live credits, bill, usage) · Book (book → match → ride → rate) · Trips · Plan (switch) · Account |
| **Driver dashboard** | Bottom-tab app: Home (earnings, floor, tier) · Jobs (go online → accept → trip → payout) · Trips · Vehicle · Account |
| **Driver qualification** | A 4-step gate every new driver must clear before any job: **vehicle 2018+** (older is rejected), **documents**, **inspection**, **background check**. Jobs stay locked until all four pass. |
| **Business case** | Pricing research: rider savings, driver earnings, unit economics (footer link) |

### Driver qualification gate

Drivers use **their own cars**, so before they can accept a single job they must pass:

1. **Vehicle 2018+** — enter make, model and year. A 2017-or-older car is refused and can't continue.
2. **Documents** — driver's licence, vehicle registration, insurance, roadworthiness certificate, proof the car is theirs.
3. **Inspection** — book and pass a safety & condition check.
4. **Background check** — identity and driving-history verification.

Only when all four are verified do the **Jobs** and **Trips** tabs unlock, and the driver sees a clear "you're cleared to drive" confirmation before taking work. (Sign in as a driver to see an already-qualified account; create a new driver account to walk the funnel.)

## Pricing model (Lagos, ₦)

| Plan | Price / mo | Credits | Effective | vs Bolt sticker |
|------|-----------|---------|-----------|-----------------|
| Lite | ₦40,000 | 280 km | ₦143/km | ~11% cheaper |
| Commuter | ₦80,000 | 620 km | ₦129/km | ~19% cheaper |
| Pro | ₦150,000 | 1,300 km | ₦115/km | ~28% cheaper |

Drivers are paid **₦120/km at 0% commission**, with a guaranteed weekly floor and tier bonuses. OneUp's margin comes from subscription breakage, plan mix, and overflow kilometres. Figures are 2025–26 estimates — validate with a pilot.

## Tech

Vanilla HTML/CSS/JS front end + a zero‑dependency Node backend. No build step, no frameworks, no `node_modules`.

```
index.html   markup: landing, auth, phone app shell + all dashboard views
styles.css   all styling (clean, minimal, theme-aware light/dark)
app.js       front end: routing, auth, dashboards, flows — calls the API
server.js    Node backend (http + node:sqlite + node:crypto): serves site + JSON API
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
| `POST /api/qualification` | Driver: `{action:'vehicle'|'doc'|'inspection'|'background'|'submit', ...}` (2018+ enforced server‑side) |
| `GET /api/trips` | List the user's trips |
| `POST /api/trips` | Record a trip `{from,to,km}` — updates rider credits or driver earnings |

Data persists across refreshes and restarts. Qualification can't be faked: the server rejects a pre‑2018 vehicle and won't mark a driver qualified until all four checks are stored.

## Structure of a real build (next step)

This prototype is the front end. A production version would add:
- A backend/API (accounts, plans, credits, trips, payments)
- Driver matching and live location
- Payment rails (cards, bank transfer, mobile money)
- Separate rider and driver native apps (e.g. React Native)
