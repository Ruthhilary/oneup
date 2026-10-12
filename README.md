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
| **Rider app** | Pick a plan → home with live credit balance → book → match → ride → rate |
| **Driver app** | Add vehicle → earnings, weekly floor, tier → go online → accept → trip → payout |
| **Business case** | Pricing research: rider savings, driver earnings, unit economics (footer link) |

## Pricing model (Lagos, ₦)

| Plan | Price / mo | Credits | Effective | vs Bolt sticker |
|------|-----------|---------|-----------|-----------------|
| Lite | ₦40,000 | 280 km | ₦143/km | ~11% cheaper |
| Commuter | ₦80,000 | 620 km | ₦129/km | ~19% cheaper |
| Pro | ₦150,000 | 1,300 km | ₦115/km | ~28% cheaper |

Drivers are paid **₦120/km at 0% commission**, with a guaranteed weekly floor and tier bonuses. OneUp's margin comes from subscription breakage, plan mix, and overflow kilometres. Figures are 2025–26 estimates — validate with a pilot.

## Tech

Plain HTML, CSS and vanilla JavaScript in one file (`index.html`). No build step, no dependencies, no framework. Edit the file and refresh.

## Structure of a real build (next step)

This prototype is the front end. A production version would add:
- A backend/API (accounts, plans, credits, trips, payments)
- Driver matching and live location
- Payment rails (cards, bank transfer, mobile money)
- Separate rider and driver native apps (e.g. React Native)
