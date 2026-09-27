# خِطّة (Khitta) — Architecture & Design Document

**Product:** offline, single-user task manager built on the Eisenhower Matrix.
**Deliverable:** a signed, installable Android APK (no server, no accounts, no network).
**Target device:** Android 14 (API 34) primary; supports Android 8.0+ (API 26+).

---

## 1. Build-environment constraint that drove the architecture

The build sandbox available for this delivery is hard-capped at **1 GiB RAM (cgroup), no swap, 2 CPU cores**.

A conventional native build (Gradle + Kotlin + Jetpack Compose + Room/KSP) peaks at
**3–6 GiB** (Gradle daemon ≈ 512 MB, Kotlin compile daemon ≈ 1.5 GB, Compose compiler +
KSP, then D8/R8 ≈ 1 GB). It cannot complete in this environment — it would be OOM-killed
repeatedly, with no way to add swap (no host-level privileges for `swapon`).

**Decision (Tree-of-Thoughts, branch selected):** build the APK **without Gradle**, using the
raw Android SDK build-tools directly (`aapt2` → `javac` → `d8` → `zipalign` → `apksigner`).
This needs < 400 MB peak and produces a *genuine* signed APK. The UI layer is a
framework-free local web app rendered in a `WebView`; everything that must work while the
process is dead (reminders) is implemented in **native Java** with `AlarmManager` +
`BroadcastReceiver`s — exactly the mechanism a fully native app uses.

Trade-offs, stated plainly:

| Aspect | Consequence |
|---|---|
| Performance | No framework runtime, no virtual DOM, no network — a task app of this size renders in single-digit ms and the APK is ~200 KB. WebView on Android 14 is Chromium 14x, hardware accelerated. |
| Notifications when app is closed | Identical to native: exact `AlarmManager` wake-ups + `BOOT_COMPLETED` re-registration. Not affected by the UI technology. |
| Look & feel | Material-consistent design tokens, RTL, light/dark, edge-to-edge insets, haptics, motion — implemented in CSS/JS instead of Compose. |
| Future port to Compose | The **domain layer is pure and unit-tested** (recurrence, week math, stats, ranking). It ports 1:1 to Kotlin; only the view layer would be rewritten. |

---

## 2. Repository layout

```
khitta/
├── docs/ARCHITECTURE.md          this document
├── android/                      the APK payload
│   ├── AndroidManifest.xml
│   ├── src/com/khitta/tasks/     native shell (plain Java, 8 files, no AndroidX)
│   ├── res/                      ar (default) + en resources, adaptive icon, themes
│   └── assets/www/               the application (HTML/CSS/JS, offline)
├── tools/build-apk.sh            one-shot reproducible build (no Gradle)
├── tools/make-icons.py           generates launcher PNGs
├── tests/                        Node test runner + domain unit tests (no npm deps)
├── qc/                           Chromium screenshot QC harness + report
└── release/Khitta-1.0.0.apk      ← the deliverable
```

---

## 3. Layered architecture

```
┌──────────────────────────────────────────────────────────────┐
│ UI layer  (js/ui/*)                                          │
│   app shell · matrix view · week view · stats view ·         │
│   settings view · editor sheet · drag&drop engine            │
├──────────────────────────────────────────────────────────────┤
│ Domain layer  (js/domain/*)   ← pure functions, unit-tested  │
│   model · recurrence · matrix · week · stats                 │
├──────────────────────────────────────────────────────────────┤
│ Core  (js/core/*)                                            │
│   store (state + persistence) · i18n (ar/en, RTL, latin      │
│   digits) · bus (events) · dom (element helpers)             │
├──────────────────────────────────────────────────────────────┤
│ Platform  (js/platform/*)                                    │
│   bridge (native ⇄ JS) · storage · notify · fallbacks for    │
│   plain-browser execution (used by the QC harness)           │
├──────────────────────────────────────────────────────────────┤
│ Native shell  (android/src)                                  │
│   MainActivity · Bridge · Store · AlarmScheduler · Notifier ·│
│   ReminderReceiver · BootReceiver · Lang                     │
└──────────────────────────────────────────────────────────────┘
```

Rule enforced by the module system: **UI may call domain, domain may never call UI or
platform.** That keeps the domain layer portable and testable in plain Node.

---

## 4. Data model (single JSON document)

```jsonc
{
  "version": 1,
  "settings": {
    "lang": "ar",              // "ar" | "en"
    "theme": "system",         // "system" | "light" | "dark"
    "weekStart": 6,            // 6 = Saturday (ISO DayOfWeek.value)
    "reminders": true,
    "defaultRemindOffset": 0,  // minutes before due
    "dayStartHour": 9
  },
  "tasks": [
    {
      "id": "t_9f3k2",
      "title": "مراجعة تقرير الميزانية",
      "notes": "",
      "imp": true,             // important  → row
      "urg": true,             // urgent     → column  ⇒ quadrant is derived
      "dueAt": 1799500800000,  // epoch ms, also the recurrence anchor
      "remind": true,
      "remindOffset": 0,
      "rec": "NONE",           // "NONE" | "DAILY:<interval>" | "MONTHLY:<interval>:<dayOfMonth>"
      "recEnd": { "mode": "never" },   // never | count:{n} | date:{at}
      "pos": 1024,             // fractional rank, ordering inside the quadrant
      "createdAt": 1799400000000,
      "closedAt": null,        // set ⇒ recurrence stops, task shows as finished
      "done": { "1799500800000": 1799504400000 }  // occurrenceAt → completedAt
    }
  ]
}
```

Design notes:

* **Quadrant is derived**, never stored (`imp`/`urg`), so reclassification by drag is a
  two-field write and can never desynchronise.
* **`pos` is a fractional rank.** Inserting between two items uses the midpoint; a
  normalisation pass rewrites ranks to `1024·i` when the gap gets too small. O(1) moves.
* **Completions live inside the task**, keyed by occurrence timestamp. This makes
  per-occurrence completion of recurring tasks trivial and lets the *native* layer mark a
  task done from a notification action with a two-line JSON mutation (no recurrence maths
  duplicated in Java).
* **`closedAt`** cleanly models "finish this recurring series".

---

## 5. Storage & security

| Property | Implementation |
|---|---|
| Location | `Context.getFilesDir()/state.json` — the app's private, sandboxed internal storage. Not readable by other apps, not on shared storage. |
| Durability | Atomic write: `state.json.tmp` → `rename`. A `.backup.json` copy of the previous good state is kept before every overwrite, so a truncated write is recoverable. |
| Flush points | debounced 400 ms after any mutation, plus synchronous flush on `pagehide`, `visibilitychange→hidden` and native `onPause`. |
| Size guard | writes above 12 MB are rejected (protects against runaway state). |
| Network | The app declares **no `INTERNET` permission**. It is structurally incapable of exfiltrating data. |
| Backups | `android:allowBackup="false"` — no cloud copy of personal data. Manual JSON export/import to Downloads is provided instead (user-initiated). |
| WebView hardening | `allowFileAccessFromFileURLs=false`, `allowUniversalAccessFromFileURLs=false`, `allowContentAccess=false`, no geolocation, no window opening, external links handed to the system browser. |
| Encryption note | Data is protected by the Android application sandbox. Full-disk/file-level encryption (SQLCipher-class) is deliberately not added: on a personal device it would require key management with no realistic recovery path (a lost key = permanently lost tasks). This trade-off is documented rather than hidden. |

---

## 6. Reminders — OS-level, delivered with the app fully closed

```
JS domain (recurrence engine)
   └─ expands the rolling horizon (60 days, ≤ 12 occurrences/task, ≤ 400 alarms)
        └─ Bridge.scheduleAll(alarms.json)
             └─ AlarmScheduler → AlarmManager.setExactAndAllowWhileIdle(RTC_WAKEUP, …)
                  └─ ReminderReceiver (manifest-registered ⇒ cold start by the OS)
                       ├─ Notifier → high-importance channel, heads-up, lock-screen visible
                       ├─ marks the occurrence done / snoozes 10 min (state.json mutation)
                       └─ schedules the NEXT occurrence from the pre-expanded list
```

Key properties:

* **The receiver is declared in the manifest**, so Android starts the process from scratch to
  run it. No service, no foreground process, no FCM, no network.
* **The chain is self-continuing**: firing occurrence *n* schedules *n+1*, so a daily task
  keeps reminding even if the app is never opened again.
* **Reboot / time-zone / clock-change safe**: `BootReceiver` listens to `BOOT_COMPLETED`,
  `TIME_SET`, `TIMEZONE_CHANGED` and `MY_PACKAGE_REPLACED` and re-registers everything from
  `alarms.json`. The most recent missed reminder is re-fired ~3 s after boot; older misses are
  dropped to avoid a notification flood.
* **Exact-alarm permissions**: `USE_EXACT_ALARM` (auto-granted on API 33+, which covers the
  target Android 14 device) and `SCHEDULE_EXACT_ALARM` (`maxSdkVersion=32`). If exact alarms
  are unavailable the scheduler degrades to `setWindow(±60 s)` and Settings exposes a deep link
  to grant the access — never a silent failure.
* **`POST_NOTIFICATIONS`** is requested at runtime on API 33+ from the onboarding step and from
  Settings, with the system rationale shown.
* Deliberately **not** using `setAlarmClock`, which would pin a permanent alarm-clock icon in
  the status bar.

---

## 7. Screens

1. **Matrix** — 2×2 Eisenhower grid, colour-coded, each quadrant an independently scrolling
   list. Long-press to drag: reorder inside a quadrant, or drag across the axes to
   reclassify (the target quadrant highlights live). Tap = edit sheet.
2. **Week** — Saturday → Friday strip, month/year header, per-day *pending* and *completed*
   sections, overdue marking, "jump to today", week navigation, add-for-this-day.
3. **Stats** — completion ring (30-day), quadrant distribution, 7-day activity bars,
   tiles for overdue / today / next 7 days / current streak.
4. **Settings** — theme (system/light/dark), language (Arabic ⇄ English, live RTL flip),
   notification status + test reminder, default reminder offset, week start,
   export/import backup, clear completed, storage footprint, about.

---

## 8. Internationalisation & numerals

* Arabic is the **default** resource locale (`res/values` = Arabic, `res/values-en` = English);
  `Lang.wrap()` pins the process locale from the persisted setting so the shell, notifications
  and resources all follow the in-app choice, independent of the device language.
* `dir`/`lang` are applied on `<html>`; the stylesheet uses **CSS logical properties only**
  (`padding-inline-start`, `border-inline-end`, `inset-inline-*`), so RTL is a flip, not a
  second stylesheet.
* **Western digits are forced** via `Intl` locale extension `ar-u-nu-latn` plus
  `font-variant-numeric: tabular-nums`, so dates/times read `09:30`, `2026-09-12` in both
  languages.

---

## 9. Performance budget

* Zero third-party runtime; ~200 KB APK; no fonts or icons fetched (inline SVG sprite, system fonts).
* Rendering: `DocumentFragment` batch builds, single delegated listener per list, no
  `innerHTML` in hot paths.
* Drag: `transform`-only (compositor thread), `will-change` during the gesture, `touch-action`
  tuned per element, rAF-coalesced autoscroll.
* Persistence debounced; state diffs are cheap because the document is small.
* `prefers-reduced-motion` honoured: animations collapse to opacity-only.

---

## 10. Verification strategy (no device, no emulator — `/dev/kvm` absent)

| Layer | Method |
|---|---|
| Domain logic | Node test runner (`tests/run.js`): recurrence, week math, ranking, stats, i18n key parity, serialisation. |
| JS integrity | `node --check` on every script. |
| UI / RTL / responsive | Chromium 152 headless at 360×780 and 412×915, light + dark, ar + en, every screen; console-error capture; computed `direction`, tap-target and contrast assertions (`qc/`). |
| APK structure | `aapt2 dump badging` (package, sdk levels, permissions, locales, icons). |
| APK signature | `apksigner verify --verbose --print-certs` (v1+v2+v3 schemes). |
| Dex | `dexdump`/`d8` output class listing; entry classes present. |
| Not verified | Runtime behaviour on physical hardware (no device/emulator available). The install flow, permission prompts and notification delivery are therefore reasoned from the platform APIs and validated statically; the user should smoke-test on the Android 14 device (one tap: *Settings → Send a test reminder*). |

### 10.1 Delivered verification results (2026-09-10)

| Check | Result |
|---|---|
| Domain/store/alarm-payload unit tests | 62/62 passing (`tests/run.js`) |
| Headless-Chromium QC suite | 59/59 passing, 0 console errors (`qc/REPORT.md`, 30 screenshots) |
| Real bugs the suites caught & fixed | `relayout()` replaced a node already detached from the DOM (killed boot); `el()` serialised boolean ARIA state as `""` so pressed/selected styles never matched; an SVG `<circle>` built through the HTML factory rendered nothing (invisible completion ring); SVG gradient stops can't take `var()` as an attribute; `imp:false` coerced through `!== false`; English plurals reused the "two" form; `store.addTask` dropped `closedAt` |
| APK | `Khitta-1.0.0.apk`, 143 KiB, signed v2+v3 (`apksigner verify` = Verifies), minSdk 26 / targetSdk 34, no `INTERNET` permission, Arabic default label + `application-label-en` |
| Build resource envelope | peak RSS < 400 MB (no Gradle), ~10 s cold build |

### 10.2 V2 addendum (2026-09-10, after real-device screenshots)

The user installed V1 on an Android 14 phone and sent screenshots. They exposed two bugs that
headless QC structurally cannot see, both now fixed and regression-tested in the browser suite:

1. **Insets were applied in physical pixels.** Android reports window insets in physical px;
   CSS works in dp. On a 3× display the top bar gained ~3× the status-bar height (the blank
   strip in the user's screenshot) and the keyboard height tripled, collapsing the editor
   sheet (screenshot 3). `setInsets()` now divides by `devicePixelRatio` and clamps; the
   Java side also stopped subtracting the nav bar from the IME rect (the IME inset spans
   `[keyboard top, screen bottom]`, so its height is `bottom - top`).
2. **Cross-zone drag left an orphan node** inside the hovered drop zone (a day chip), because
   the live node is re-parented during the gesture. `dnd.onUp` now restores it before the
   view re-renders.

V2 also found, via the expanded unit suite: `fromParts()` treating calendar day `0` as falsy
(breaking month-boundary week maths), the weekly end-count not being enforced in the
occurrence walker, and `addTask` dropping the new `untimed` flag.

### 10.6 V2.4 — five critical fixes

1. **Swipe index skipping**: one physical gesture emits both touch and pointer streams on
   Android; each stream committed its own page step (1→3, 4→2). A 150 ms `commitNav` lock makes
   the first recogniser to commit the owner of the gesture. Mapping stays a strict pager over
   `TAB_ORDER` (+1 right, −1 left) with the bottom bar's `aria-selected` updated per page.
2. **RTL/LTR header overlap**: `applyLang()` re-invoked `setInsets()` with already-converted
   values, dividing by `devicePixelRatio` a second time and collapsing the top safe-area.
   Insets are now stored raw and converted exactly once; the top bar also carries a
   `max(var(--sat), 10px)` floor so the header can never sit under the status bar.
3. **Midnight alarm flood**: untimed goals are excluded from `notify.buildEntries()` and
   `nextTriggerFor()` entirely — no implicit 00:00/default-hour alarm; the editor disables the
   reminder controls for untimed tasks with an explanatory hint.
4. **Quote locale reactivity**: views store only the quote *index*; the painted text is derived
   from `I.quotes()` of the active locale at paint/relayout time, and `applyLang()` pushes the
   index after relayout — reverting ar→en→ar re-localises the banner.
5. **Cleanup**: in-app app-name and launcher-icon customisation fully removed (settings UI,
   `brandName`/`iconVariant` settings + normalisation, `Bridge.setIconVariant`, manifest
   activity-aliases and the variant icon resources). Name = localised product name; icon = the
   standard adaptive asset.

### 10.5 V2.3 — midnight reactivity, completion choreography, pager/bar sync

* **Date watchdog** (`app.checkDateRollover`): a self-re-arming timer fires ~0.5 s after local
  midnight, backed by the 60 s tick and a `visibilitychange → visible` check on resume. On a
  day change the week view snaps its selection back to the new today (unless the user pinned
  another day), every mounted view re-renders against the new `now`, and alarms are re-armed so
  fresh recurrence instances are scheduled immediately.
* **Completion is a filter, not a deletion**: the matrix renders only tasks with an open
  occurrence (`model.openOccurrences`); `widgets.completeWithHold` holds the store subscriber's
  re-render (`body[data-renderhold]`) for ~400 ms so the checkmark registers, then collapses the
  row (height/opacity/translate transition) and re-renders. Data is untouched — completed work
  remains queryable in the week's completed section and in read-only past days.
  Related domain fix: `allOccurrences` no longer lets `closedAt` hide an occurrence that was
  already completed (finishing a one-off task early used to erase it from the archive).
* **Swipe = bar index**: the gesture container is a plain pager over `TAB_ORDER`; right ⇒ +1,
  left ⇒ −1, and `go()` updates the bar's `aria-selected` on every page change. The navigation
  history stack was removed in favour of deterministic index paging; system back still closes
  sheets first, then returns to the matrix, then exits.
* Suite: 91 browser checks (midnight rollover with a mocked clock, auto-hide choreography
  timings, database persistence of completed rows, bar-index swipe sync) + 74 unit tests,
  the latter now fully date-independent (fixed clocks in the alarm-payload tests).

### 10.4 V2.2 — matrix rebuilt as a scrollable stack; gesture arbitration

Real-device feedback showed the 2×2 matrix forcing tiny boxes (Arabic words breaking mid-word,
hidden tasks behind per-quadrant scrolling) and horizontal swipes dying on content. Fixes:

* **Layout**: `matrix.view` now renders one `.matrix-stack` scroller with four full-width
  `.quad` section cards (tinted background, tinted border, header divider, inline count pill,
  quick-add). Titles use `word-break: normal; overflow-wrap: break-word; hyphens: none` and no
  line clamping, so rows auto-expand and words never split.
* **Gestures**: two coordinated recognisers. A touch recogniser on `window` claims the gesture
  for navigation the moment horizontal intent appears (≥14 px and 1.6:1 ratio) and then calls
  `preventDefault()` on `touchmove`, so inner scrollers cannot swallow it; a pointer recogniser
  keeps mouse/desktop parity. Drag & drop owns long-press/grip gestures and is checked live
  (`K.dnd.active`) before navigation claims. `dnd.zoneAt()` hit-tests each zone's own card rect
  and zone rects refresh every drag frame, which makes cross-section drops and edge auto-scroll
  correct in the stacked layout.
* Suite grew to 86 browser checks, including swipe-starting-on-a-task-card, post-swipe click
  suppression, stacked-layout geometry and word-integrity assertions.

### 10.3 V2.1 refinements

* **Card-based matrix**: quadrant containers lost their table borders in favour of a
  `color-mix()` tint of their own accent (7% on the surface), 22px radii, quieter shadows and a
  two-row header (name row + full-width subtitle row carrying the quick-add), with the open-count
  as an absolute corner badge so titles never truncate. Task cards are borderless tinted cards
  with a softened inline accent and a clearer type scale.
* **Quote lifecycle**: rotation moved to the app shell (`refreshQuote()`), bound to boot **and**
  `visibilitychange → visible`, so re-entering the app greets the user with a fresh phrase;
  views expose `setQuote()` and survive relayouts.
* **Gesture semantics v2**: swipe-right = forward, swipe-left = pop a real navigation-history
  stack (`navHistory`), returning to the exact previous page even after tab jumps; transitions
  slide forward pages in from the right and back pages in from the left (300ms, system easing).
  Covered by three new browser checks (81 total).

New V2 surface area, all covered by the browser suite: user-definable app name and
launcher icon (activity-alias switching), untimed goals, specific-weekday recurrence
(`WEEKLY:<interval>:<mask>`), swipe navigation, read-only past days with a motivational
modal, 22 rotating quotes per language, customizable quadrant palette + tag skins, table
view with persisted sorting, 1-minute time-picker resolution, and complete removal of the
export/import feature (UI, JS logic, Java methods and the `WRITE_EXTERNAL_STORAGE`
permission).
