# SafeHer

**An emergency response ecosystem.** Four connected surfaces — a citizen app, a guardian app, a
police control room and a medical control room — where pressing SOS on a phone makes a pin flash
on a police dashboard within two seconds, automatically routed to the nearest station, carrying
the victim's identity, medical record, live location trail, live audio and snapshots, with voice
and text handled **inside our own ecosystem** rather than by handing an officer a phone number
to dial.

---

## Demo credentials

All passwords are `SafeHer@123`.

| Surface | Email | Role | Sees |
|---|---|---|---|
| **Command** | `dispatcher@safeher.demo` | dispatcher | Police Station Sector 17 |
| **Command** | `officer@safeher.demo` | officer | Police Station Sector 14 |
| **Command** | `supervisor@safeher.demo` | supervisor | Whole city + reassignment |
| **Med** | `medic16@safeher.demo` | medic | Govt Multi Specialty Sector 16 — **use this one for the demo** |
| **Med** | `medic@safeher.demo` | medic | PGIMER Sector 12 |
| **Med** | `paramedic@safeher.demo` | paramedic | GMCH Sector 32 |
| **SafeHer** | `priya@safeher.demo` | citizen | Full medical record, 2 guardians |
| **SafeHer** | `ananya@safeher.demo` | citizen | Full medical record |
| **Circle** | `meera@safeher.demo` | guardian | Priya's mother, linked and active |

Invite codes in the seed: `SAFE-4821` (claimed), `SAFE-7390` (Priya's father, unclaimed),
`SAFE-2255` (Ananya's sister, unclaimed).

Shadow-mode PINs in the citizen app: **`1234`** opens SafeHer. **`9000`** opens it identically
*and* silently raises a duress SOS. Both are entered on the calculator and confirmed with `=`.

---

## The four surfaces

| Product | Stack | Who | Core job |
|---|---|---|---|
| **SafeHer** | React Native · Expo | Citizen | Raise a Safety or Medical SOS; stream evidence; talk to responders in-app |
| **SafeHer Circle** | React Native · Expo | Guardian | Watch a ward's journey; receive the alert; add context; escalate |
| **SafeHer Command** | Vite · React · TS | Police | Live incident wall, auto-routing, full live feed, dispatch, comms |
| **SafeHer Med** | same app, `/med` | Medical | Medical SOS only; hospital + ambulance assignment; handover card |

Command and Med are **one codebase with two role-scoped routes**, not two apps.

---

## Status — what is actually verified

This is not "it should work". These numbers were measured against the live database.

| Check | Result |
|---|---|
| `raise_sos()` press → row written | **395–1056 ms** (target < 2000) |
| Nearest-station routing | Sector 17 Plaza → **CHD-17 at 131 m**, runners-up recorded |
| Medical SOS assigns hospital **and** station | yes |
| `medical_snapshot` frozen against later profile edits | yes |
| Moving 3 km re-routes to a different station | yes |
| Pre-trigger audio sealed and uploaded | 3 clips, 60s / 40s / 20s before the press |
| Security boundary suite | **23/23 pass** (`npm run test:rls`) |
| Acceptance suite | **13/13 pass** (`npm run sim -- --verify`) |
| Dashboard driven live in a browser | signed in, incident arrived untouched, map + panels correct |
| Safety SOS appears in Command, **not** in Med | confirmed |
| Medical SOS appears in Med, **not** in Command | confirmed |
| Medic sees only their own hospital's incidents | confirmed |
| Command dashboard production build | 99 modules |
| Citizen app Metro bundle | 832 modules, 2.57 MB |
| Guardian app Metro bundle | 789 modules, 2.44 MB |

Still unverified: the three-device choreography itself (needs two phones and a laptop in one
room) and the realtime fan-out timing under that load.

---

## Setup

### 1. Backend — already provisioned

A hosted Supabase project (`safeher`, region `ap-south-1` / Mumbai) is live, migrated and
seeded, and `.env` at the repo root is already filled in. Nothing to do:

```bash
npm install --ignore-scripts
```

> **Why `--ignore-scripts`?** esbuild's postinstall validator crashes on some Windows setups and
> aborts the install before npm places the platform binaries. Skipping postinstall scripts
> installs everything correctly; esbuild resolves its binary at runtime and works fine.

A hosted backend also removes the usual demo hazard: the phones reach
`https://<ref>.supabase.co` from any network, so there is no LAN address to get wrong and no
dependency on everyone being on the same Wi-Fi.

**Rebuilding it from scratch** (local stack, needs Docker Desktop):

```bash
npx supabase start
npx supabase db reset
```

`db reset` runs the five migrations then `seed.sql`. Migration `0003_rls.sql` ends with a policy
test that creates two throwaway citizens and asserts neither can read the other's profile — if a
policy is broken, **the reset fails loudly** rather than shipping quietly.

### 2. Verify before touching any UI

```bash
npm run sim -- --verify     # 13 acceptance checks
npm run test:rls            # 23 security-boundary checks
```

The first raises a real medical SOS as a real seeded citizen and asserts every acceptance
criterion, then cleans up after itself.

The second is the answer to §12's *"test it with SQL, not by clicking"* — except it is stronger
than SQL, because it runs through the real API with real sessions, which is the same surface an
attacker would use. It checks citizen isolation, that `raise_sos()` is the only way to create an
incident, that the audit log cannot be rewritten, that privileged RPCs reject non-responders,
station and hospital scoping, the guardian's identity-only path, and that an anonymous client
gets nothing at all.

### 3. Control rooms

```bash
npm run command
```

Open `http://localhost:5173` for Command and `http://localhost:5173/med` for Med. Sign in as a
medic and you are redirected to `/med` automatically; sign in as an officer on `/med` and you
are sent back. The role decides the view, and RLS enforces the same split server-side.

### 4. Phones

```bash
npm run citizen     # SafeHer
npm run guardian    # SafeHer Circle
```

Install Expo Go, scan the QR code. Both apps point at the hosted project, so the phones do not
need to be on the same network as the laptop.

> If you ever switch back to a **local** Supabase stack, `EXPO_PUBLIC_SUPABASE_URL` must become
> your machine's **LAN address** (e.g. `http://192.168.1.10:54321`), never `127.0.0.1` — a phone
> cannot reach your laptop's loopback. That is the single most common reason a local demo fails.

---

## The simulator

This is how all four apps get tested without anyone running around outside, and it is the backup
plan if a phone loses Wi-Fi at the demo table.

```bash
npm run sim -- --list                                  # named spots
npm run sim -- --at sector-17                          # safety SOS, walks for you
npm run sim -- --type medical --at sector-34 --reason chest_pain
npm run sim -- --at sukhna-lake --walk 1.4 --duration 180
npm run sim -- --at manimajra --silent                 # duress-style silent incident
npm run sim -- --verify                                # assert the acceptance criteria
```

It signs in as a real citizen and calls `raise_sos()` exactly as the phone does, so it exercises
RLS, routing, the frozen snapshot and the realtime fan-out — not a shortcut around them. The
synthetic audio and snapshots are **real WAV and PNG files**, so the dashboard's live feed
actually plays and renders, including clips sealed from before the press.

| Flag | Default | Meaning |
|---|---|---|
| `--type` | `safety` | `safety` or `medical` |
| `--at` | `sector-17` | named spot, or `lat,lng` |
| `--as` | `priya@safeher.demo` | which citizen to sign in as |
| `--reason` | `manual` | trigger reason / symptom |
| `--walk` | `1.3` | metres per second |
| `--interval` | `3` | seconds between breadcrumbs |
| `--duration` | `0` | seconds to stream; 0 = until Ctrl-C |
| `--silent` | off | silent incident — no media, no phone reaction |
| `--no-media` | off | skip audio and snapshot uploads |
| `--resolve-on-exit` | off | close the incident when you stop |

---

## The six decisions that matter

1. **No third-party dialer. Ever.** There is no phone number anywhere in the officer's comms
   panel, deliberately. Identity, medical record, location, audio and snapshots are already in
   the system from the moment the account was created. The officer holds a button and talks.

2. **The SOS carries everything, immediately.** The first realtime payload already includes
   name, photo, blood group, allergies, conditions, medications, emergency note, coordinates and
   accuracy. Nobody asks "who am I speaking to?"

3. **Routing is server-side and visible.** `raise_sos()` resolves the nearest station via PostGIS
   and writes it onto the incident before the dashboard ever sees it. The runner-up candidates
   travel with the decision in the `routing.resolved` payload, so the routing panel can answer
   *why this station* and a supervisor can reassign with a recorded reason.

4. **Everything is append-only and timestamped.** Every trigger, assignment, acknowledgement,
   upload, message and status change writes an `incident_events` row. Status changes write theirs
   from a **database trigger**, so a mutation that forgot to log itself is not expressible. The
   table rejects UPDATE and DELETE outright.

5. **Two SOS types, one pipeline.** `type = 'safety' | 'medical'` on one `incidents` table. The
   type only changes which control room subscribes and which routing function runs.

6. **The guardian is a participant, not a spectator.** Circle sees the same live incident as the
   control room and can acknowledge, add context or talk. `guardian.context` lands in the
   officer's panel highlighted as *family context*, visually distinct from the victim speaking.

---

## Security model

RLS is the boundary, not the UI. The matrix is implemented in `0003_rls.sql`:

| Role | Reads | Writes |
|---|---|---|
| citizen | own profile, own guardians, own incidents + children | own profile, own journeys, `raise_sos()`, own media/messages |
| guardian | ward identity via `ward_profiles`; ward incidents **only while live** | `guardian.acknowledged`, `guardian.context`, PTT |
| officer / dispatcher | incidents where `assigned_station_id` = their station | status, assignment, messages, unit dispatch |
| supervisor | all incidents | reassignment across stations |
| medic / paramedic | incidents where `assigned_hospital_id` = theirs **and** `type='medical'` | status, ambulance dispatch, messages |

**How "medical data only during an active incident" is actually enforced.** RLS is row-level, so
a policy letting guardians read `profiles` would hand them every medical column permanently —
a surveillance tool, not a safety one. So guardians get **no policy on `profiles` at all**. They
read identity through `ward_profiles`, a view whose column list simply does not contain the
medical fields, and they read medical data only from `incidents.medical_snapshot` on rows whose
status is not `resolved`/`false_alarm`. Once an incident closes the whole row becomes invisible
to them, and history comes from `guardian_incident_history`, which has no snapshot column
either. There is no path from a guardian to a resolved ward's medical record.

Citizens never `INSERT` into `incidents` — there is no insert policy. `raise_sos()` is
`SECURITY DEFINER` and is the only way an incident comes into existence.

**Append-only is defended twice, and the two layers fail differently.** There is no UPDATE or
DELETE policy on `incident_events`, so a citizen's statement matches zero rows and quietly
changes nothing. Behind that, `forbid_mutation()` raises an exception for any role that *does*
match rows — including a superuser at a psql prompt. Verified both ways.

**One real vulnerability was found and fixed after the first deploy.** The Supabase linter
flagged `request_cross_dispatch()` as reachable by every signed-in role. It is `SECURITY
DEFINER`, so RLS does not apply inside it, and it had no authorisation check of its own — any
citizen or guardian who knew an incident UUID could have re-routed that incident to a different
station or hospital. `0005_harden.sql` fixes it (responder role **and** `can_see_incident()`),
pins `search_path` on every function, and revokes `anon` EXECUTE across the board. There is now
a regression test for it in the security suite.

The RLS helper functions (`is_police()`, `my_station_id()`, `guards_user()` …) remain callable by
signed-in users, and must: policy expressions are evaluated with the caller's own privileges, so
revoking EXECUTE from `authenticated` would break every policy that calls them. They are safe
because each one only ever reports on the caller — a citizen asking `my_station_id()` gets null,
never somebody else's station. The security suite asserts exactly that.

Three linter findings are accepted rather than fixed, and `0005_harden.sql` says why in writing:
`spatial_ref_sys` is a PostGIS system table that cannot take RLS; `postgis` lives in `public`
because the generated `geom` columns resolve its types from there; and the two guardian views are
`SECURITY DEFINER` **on purpose** — that is the entire mechanism giving a guardian identity-only
access without a `profiles` policy that would expose medical columns permanently.

---

## Architecture diagrams

`docs/architecture.html` — four diagrams, one self-contained file, no CDN, no build step. Opens
from a double-click and prints to A3 landscape in a light theme. Every box names a real table,
function or channel. **Diagram 2 is the one to read first**: the full sequence from press to
flash with elapsed-time markers down the side.

---

## Project layout

```
safeher/
  packages/shared/        types, CHANNELS, EVENTS, TABLES, client factory, palette, geo
  apps/citizen/           Expo — SafeHer
  apps/guardian/          Expo — SafeHer Circle
  apps/command/           Vite React — Command + Med (role-scoped routes)
  supabase/
    migrations/           0001 schema · 0002 functions · 0003 RLS + test
                          0004 storage · 0005 hardening
    seed.sql              Chandigarh: 8 stations, 5 hospitals, 8 accounts, 6 units
  scripts/
    simulate-sos.ts       drive all four surfaces without leaving the room
    test-rls.ts           23 security-boundary checks against the real API
  docs/architecture.html
```

`packages/shared` is not optional. Table names, channel names and event names live there as
exported constants and are imported by all three apps. If the citizen app published `sos.created`
and the dashboard listened for `sos_created`, nothing would sync and the entire demo would be
dead — this package is what makes that a compile error instead of a silent failure.

### Changing city

Chandigarh was chosen because the demo script in the brief names *Sector 14 Police Station*.
To move it, change only the `lat`/`lng` values in the `police_stations`, `hospitals` and `units`
blocks of `supabase/seed.sql`, plus `DEMO_CENTER` and `DEMO_SPOTS` in
`packages/shared/src/geo.ts`. Nothing else hardcodes a coordinate.

---

## Table-demo choreography

Two phones and one laptop, same Wi-Fi, same Supabase project. About four minutes.

| Device | Runs | As |
|---|---|---|
| Phone A | SafeHer | Priya |
| Phone B | SafeHer Circle | Meera, her mother |
| Laptop | Command and Med, two windows side by side | Officer + medic |

1. **Set the stage (20s).** Empty control room, clock ticking, counters at zero. Phone B shows
   "Priya — Safe".
2. **Start a journey (20s).** Phone A, 30-second check-in. Point at Phone B: the countdown is
   already ticking. *Nobody has pressed an emergency button, and the system is already watching.*
3. **Safety SOS (45s).** Hold on Phone A. Then stop talking and let all three screens react. Say
   only: *"Nobody touched the laptop."*
4. **What arrived (45s).** Her name, photo, blood group, allergies — already there. The routing
   panel: *"Sector 14, 800 m — chosen automatically, and here are the two runners-up."* Then click
   a clip labelled **"captured 40s BEFORE the alert."**
5. **Comms (30s).** Officer holds Space and speaks; it plays on Phone A. Priya answers. Meera
   types *"she was walking from the east metro gate"* — point at it landing in the officer's
   panel, highlighted as family. **Say the line: *"At no point did anyone dial a phone number."***
6. **Dispatch (20s).** Assign a unit, mark dispatched. Watch the pill change on both phones.
7. **Medical SOS (45s).** Phone A, press MEDICAL, pick "chest pain". It **does not appear** in the
   police window. Switch to Med: blood group huge, trauma hospital already assigned. Dispatch the
   ambulance, show the handover card, then **Request police support** and show it appear in
   Command too.
8. **Close (15s).** Open the timeline. Everything, timestamped to the second, with who did it.

Rehearse twice. Keep `npm run sim` ready as a backup — the dashboards cannot tell the difference.

---

## Honest limits

Stating these plainly earns more credit than pretending they are solved. Someone will ask.

1. **No real integration with 112 / ERSS.** Real dispatch integration needs state government
   authorisation. Stations, hospitals, officers and units are seeded demo data with real
   coordinates. The routing layer is written as an adapter, so a real CAD feed replaces the seed
   without touching the alert pipeline. **This is a proposal for how the control-room side should
   work, backed by a working implementation of it.**

2. **Full-duplex voice is tier 3, and not built.** Push-to-talk and text are fully implemented
   and are what gets demoed. WebRTC needs an Expo dev build and a TURN server for real networks.
   The signalling event names (`comm.call.offer/answer/ice`) are reserved in the shared contract;
   nothing depends on them.

3. **Background execution on mobile is limited.** iOS and Android throttle a backgrounded JS app.
   Continuous location and audio need a native background task and a foreground service
   notification. The permissions and background modes are declared in `app.json`, but battery and
   OS policy are real constraints and the rolling buffer will not survive an aggressive
   app-killer indefinitely.

   **This matters for the demo:** SafeHer Circle takes over its screen only while the app is
   open. There is no push-notification channel — waking a closed app needs `expo-notifications`,
   a dev build and a push credential, none of which work in Expo Go. **Leave Phone B open on the
   Watch screen** during the demo. The takeover, the sound and the vibration all work from there;
   what does not work is a parent whose phone is in their pocket with the app closed, which is
   precisely the case a shipped version would have to handle.

4. **Offline is a fallback, not a guarantee.** With no data, the SMS path reaches guardians but
   **not** the control room, and `expo-sms` opens the composer rather than sending silently —
   the OS does not permit a background send without a native module and a carrier agreement. The
   app says which path actually went out rather than showing a tick that means nothing. The
   queued incident syncs on reconnect and is timestamped as delayed.

5. **The guardian app plots the trail without a street map.** A native map on React Native means
   an API key and a billing account, or a native module that breaks Expo Go. The trail is plotted
   directly from coordinates — it shows movement and direction in real time, which is what a
   frightened parent needs, but it is not a street map. The street map is in the control room,
   where there is a desktop browser to run MapLibre properly.

6. **This is a prototype handling extremely sensitive data.** Real deployment needs a security
   audit, encryption at rest for medical fields, DPDP Act compliance, a data-retention policy and
   a consent framework for guardian access. RLS is implemented, guardian access is genuinely
   scoped, and 23 boundary checks pass — that is a floor, not a ceiling. The linter found a real
   privilege bug on the first deploy (see Security model), which is the honest argument for why
   an external audit is not optional.

7. **The demo backend is a free-tier project on the public internet**, holding fictional medical
   records for two fictional people. The committed anon key is a public key by design — RLS is
   what guards the data — but the project is internet-reachable, so treat it as a demo, not as
   somewhere to put a real person's blood group. Rotate the key or delete the project when the
   demo is over.

8. **Shadow-mode PINs are hardcoded in `Shadow.js`** for the demo and displayed on the Profile
   screen so you can find them. A real build stores them in the device keychain and never
   displays the duress PIN anywhere.

---

## Deviations from the original brief

Small, deliberate, and each one flagged rather than hidden:

- **`expo-av` instead of `expo-audio`.** `expo-audio` ships in Expo SDK 52; this project targets
  SDK 51, where the equivalent is `Audio.Recording`. Behaviour is identical; only the import
  changes.
- **Email + password seeding.** The brief specifies phone + OTP, which the citizen app implements
  and offers first. But OTP needs a configured SMS provider, and the demo has to work on a table
  with no carrier in the loop — so the seed uses email/password and the app offers both.
- **Chandigarh coordinates.** The brief's demo script names "Sector 14 Police Station", which is
  Chandigarh sector naming. One file to change if that was not the intent.
