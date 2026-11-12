# Running SafeHer — one phone + one laptop

You have three surfaces to show and two devices. This is how they map.

| Device | Runs | Why there |
|---|---|---|
| **Phone** | SafeHer (citizen) | Needs real GPS, microphone, camera and accelerometer. Must be a real device. |
| **Laptop — browser tab 1** | SafeHer Command | `http://localhost:5173` |
| **Laptop — browser tab 2** | SafeHer Med | `http://localhost:5173/med` |
| **Laptop — browser tab 3** | SafeHer Circle (guardian) | Runs as a web app. This is your second "phone". |

The backend is a hosted Supabase project, so the phone does **not** need to be on your Wi-Fi to
reach the database. It *does* need to be on the same Wi-Fi as your laptop to reach the Expo
bundler — that is the only network requirement.

---

## First time only

```bash
npm install --ignore-scripts
```

Then install the phone app's dependencies:

```bash
npm install --prefix apps/citizen --ignore-scripts
npm install --prefix apps/guardian --ignore-scripts
```

---

## Opening it in VS Code

```bash
code "C:\Users\SONAKSHI\OneDrive\Desktop\safeher"
```

Open the folder itself, not a parent — the workspace scripts resolve from the repo root.
Use **Terminal → Split Terminal** so you can keep three running at once.

Worth installing: **ESLint**, **Tailwind CSS IntelliSense**, **Prettier**.

---

## Terminal 1 — the control rooms

```bash
npm run command
```

Open two browser tabs:
- `http://localhost:5173` → sign in as `dispatcher@safeher.demo` (Sector 17)
- `http://localhost:5173/med` → sign in as `medic16@safeher.demo` (Sector 16)

Use **`medic16@safeher.demo`**, not `medic@safeher.demo`. A medical SOS fired from the Sector 17
area routes to Govt Multi Specialty Sector 16, and each medic only sees their own hospital.

All passwords: `SafeHer@123`

---

## Terminal 2 — the phone

```bash
npm run citizen
```

Install **Expo Go** from the Play Store / App Store, then scan the QR code.

Sign in with `priya@safeher.demo` / `SafeHer@123` on the **Email** tab.

> The app opens as a **calculator** — that is shadow mode, not a bug. Type `1234` and press `=`
> to enter SafeHer. Type `9000` and press `=` and it opens identically while silently raising a
> duress alert, which you will see appear on the laptop.

Grant location, microphone and camera when asked. Without them the SOS still fires, but there is
no trail, no audio and no snapshots.

---

## Terminal 3 — the guardian, on your laptop

```bash
npm run guardian:web
```

Opens at `http://localhost:8082`. Sign in with `meera@safeher.demo` on the **Email** tab.

This is React Native running in the browser via react-native-web. What works: the live alert
takeover, the location trail, the routing panel, the medical record, **Add context**, and history.
What does not: vibration (silently ignored on web) and push-to-talk recording, which needs
microphone APIs that differ on web. Text context still reaches the officer, which is the part
that matters for the demo.

If you would rather have it on a real second phone later, `npm run guardian` gives you the same
QR-code flow as the citizen app.

---

## No phone handy? Drive it from the laptop

```bash
npm run sim -- --at sector-17                     # safety SOS, walks for 40s
npm run sim -- --type medical --at sector-17 --reason chest_pain
npm run sim -- --at sector-17 --silent            # duress-style, phone shows nothing
npm run sim -- --list                             # all the named spots
```

The dashboards cannot tell the difference — it signs in as Priya and calls `raise_sos()` exactly
as the phone does. Keep this ready as your backup if the Wi-Fi misbehaves at the table.

---

## Checking it is all healthy

```bash
npm run sim -- --verify     # 13 acceptance checks
npm run test:rls            # 23 security checks
npm run typecheck
```

---

## Resetting between rehearsals

Incidents pile up as you practise. To clear them, open the Supabase SQL editor for the `safeher`
project and run:

```sql
alter table incident_events disable trigger incident_events_no_delete;
delete from incidents;
alter table incident_events enable trigger incident_events_no_delete;
update units set status = 'available';
```

The counters go back to zero and every unit is available again. Stations, hospitals, accounts and
guardian links are untouched.

---

## When something breaks

**Phone shows "Network request failed"** — the phone cannot reach the Expo bundler. Put both
devices on the same Wi-Fi, or run `npx expo start --tunnel` from `apps/citizen`.

**Phone is stuck on the calculator** — that is shadow mode. `1234` then `=`.

**Dashboard says OFFLINE in red** — the realtime socket dropped. It polls every 3 seconds and
recovers on its own; the banner is deliberate, so you never think it is live when it is not.

**Medical SOS does not appear in /med** — you are probably signed in as the wrong medic. Use
`medic16@safeher.demo` for anything fired near Sector 17.

**Map is blank** — check the browser can reach `tile.openstreetmap.org`. The pins and all the
panel data work regardless; only the street tiles come from outside.

**Anything at all after a code change** — stop the server, `npm install --ignore-scripts`,
start again. Metro caches aggressively; `npx expo start --clear` clears it.
