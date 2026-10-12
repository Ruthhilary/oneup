# OneUp

A subscription ride service for Lagos (and, next, other African cities). Members pay one monthly bill and ride on distance credits — no surge, flat fares, inspected cars from 2018 or newer, and drivers who earn more and steadier.

This repo is a **clickable prototype**: a single static web page with a marketing landing page, a sign‑in / create‑account flow, and two working app demos — one for **riders**, one for **drivers** — plus the pricing research behind the model (see the "Business case" link in the footer).

> It's a front‑end prototype only. No real accounts, payments, or backend — all data is for demonstration.

## Run it on localhost

You only need a static file server. Pick whichever you have.

**Option A — Python (already on macOS):**
```bash
cd oneup
python3 -m http.server 8000
```
Then open <http://localhost:8000>.

**Option B — Node:**
```bash
cd oneup
npx serve .
```
(or `npm start`, which runs the Python server above)

**Option C — just open the file:**
Double‑click `index.html`, or open it in your browser. It works from the file system too, though a local server is closer to real conditions.

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

Plain HTML, CSS and vanilla JavaScript — no build step, no dependencies, no framework. Edit and refresh.

```
index.html   markup: landing, auth, phone app shell + all dashboard views
styles.css   all styling (clean, minimal, theme-aware light/dark)
app.js       routing, auth, tabs, rider flows, driver qualification + job flows
```

## Structure of a real build (next step)

This prototype is the front end. A production version would add:
- A backend/API (accounts, plans, credits, trips, payments)
- Driver matching and live location
- Payment rails (cards, bank transfer, mobile money)
- Separate rider and driver native apps (e.g. React Native)
