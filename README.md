# Khata

Local-first credit ledger. Install it from Chrome and it behaves like an app: its own window, home-screen icon, and full offline use.

Live: [https://hrsproject.github.io/khata-web/](https://hrsproject.github.io/khata-web/)

## Install as an app

1. Open the live site in Chrome (desktop or Android).
2. Use **Install Khata** in the banner, or Chrome’s install icon in the address bar.
3. Launch it from the dock / app drawer. It opens standalone — no browser chrome.

On iPhone / iPad: Safari → Share → **Add to Home Screen**.

The production build is a PWA: Web App Manifest, service worker, maskable icons, app shortcuts (Add customer, Reports), share-target, `display: standalone`, and an in-app update prompt. Installed from Chrome it runs in its own window, reuses that window on relaunch, and works fully offline.

## Features

- Parties with Indian mobile numbers, address, notes, and per-customer **credit limits** with over-limit warnings
- You gave / You got entries, bill photos, optional due dates, per-ledger search + type filters
- **Dues intelligence**: due-today strip, due-this-week, overdue collections with per-row WhatsApp reminders + copy-all reminders
- **UPI collection**: save your UPI ID in Settings, customers get a one-tap `upi://pay` button for exact dues
- Search across names, phones, and notes; filter by to-take, to-give, overdue, settled
- WhatsApp reminders, call, share statement, print / PDF, per-customer CSV
- Monthly reports, 6-month gave/got chart, overdue collections, recent activity
- Dark / light / system theme
- Optional 4-digit PIN lock for this browser profile
- JSON backup and CSV export with on-device storage meter — data never leaves the device unless you export it
- **Device sync**: move the ledger between mobile and laptop with a 6-digit code — AES-GCM encrypted, single-use, with preview + Smart-merge or Replace (a safety snapshot is saved automatically)

## Sync between mobile and laptop

1. On the device with the latest ledger: **Sync → Send to another device → Generate code**.
2. On the other device: **Sync → Receive from another device**, enter the 6-digit code.
3. Preview what will arrive, then **Smart-merge** (union by entry — recommended when both devices have new entries) or **Replace**.

No account and no cloud storage: the encrypted ledger passes through a public relay under your code and is wiped after delivery. Anyone holding the code while it is live could fetch it, so use it immediately. Settings (shop name, UPI ID, PIN, theme) never sync — only customers and transactions.

## Run locally

```bash
npm install
npm run dev
```

The app is configured with `base: /khata-web/` so the production PWA matches GitHub Pages. Local preview:

```bash
npm run build
npm run preview
```

Then open `http://localhost:4173/khata-web/`.

## Data

Contacts, transactions, notes, and bill photos are stored in this browser with `localStorage`. There is no server and no demo data. Use **Export JSON** before clearing site data or switching browsers.
