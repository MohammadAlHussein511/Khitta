# QC report — Khitta (headless Chromium 8731)

Run at 2026-09-27T08:45:56.923Z

**96/96 checks passed**

| Check | Result | Detail |
|---|---|---|
| file:// boots without a server | ✅ |  |
| stylesheets linked | ✅ | 3 |
| 4 tabs rendered | ✅ | 4 |
| 4 quadrants rendered | ✅ | 4 |
| icon sprite present | ✅ | 32 |
| icons referenced | ✅ | 24 |
| default direction is RTL | ✅ | rtl |
| default language is Arabic | ✅ | ar |
| bridge absent → local fallback | ✅ |  |
| no hard console errors on file:// | ✅ |  |
| onboarding shown on first run | ✅ |  |
| seed produced 11 tasks | ✅ | 11 |
| computed layout direction is rtl | ✅ | rtl |
| matrix renders task cards | ✅ | 9 |
| no horizontal overflow | ✅ |  |
| week shows 7 day chips | ✅ | 7 |
| week starts on Saturday | ✅ | سبت |
| week splits pending / completed | ✅ | pending=5 done=1 |
| day progress bar set | ✅ | 17% |
| week navigation works | ✅ | 3 – 9 أكتوبر 2026 |
| toggling a task records a completion | ✅ | 46 → 47 |
| completion ring shows a percentage | ✅ | 25% |
| ring dash offset animated | ✅ | 245.0 |
| 7 activity bars | ✅ | 43px,35px,50px,50px,43px,50px,28px |
| 4 stat tiles | ✅ | 3,4,20,9 |
| quadrant distribution populated | ✅ | 3,3,3,2 |
| dark theme applied | ✅ | rgb(11, 13, 18) |
| FAB opens the editor sheet | ✅ |  |
| exactly one quadrant selected | ✅ | 1 |
| task created through the sheet | ✅ | {"n":1,"imp":false,"urg":false,"q":"q4"} |
| quadrant choice honoured (q4) | ✅ | q4 |
| task count grew | ✅ |  |
| recurrence section exposes upcoming occurrences | ✅ | {"monthlyVisible":true,"occ":true} |
| calendar renders 6 weeks | ✅ | 42 |
| calendar starts on Saturday | ✅ | سبت |
| one day preselected | ✅ | 1 |
| time picker renders hours + every minute | ✅ | 84 |
| drag reorders tasks inside a quadrant | ✅ | t_cmg7cdvp2h → t_d5w3m24p2j → t_4y436pap2r  ⇒  t_d5w3m24p2j → t_cmg7cdvp2h → t_4y436pap2r |
| ranks stay strictly increasing after reorder | ✅ | 2048,2560,3072 |
| drop target highlights while crossing quadrants | ✅ | 1 |
| dragging across quadrants reclassifies the task | ✅ | q4 |
| dragging onto a day reschedules the task | ✅ | chip#2: Sun Sep 27 2026 → Mon Sep 28 2026 |
| untimed toggle disables the time field | ✅ | {"disabled":true,"txt":"—"} |
| untimed task stored with a midnight anchor | ✅ | {"u":true,"H":0} |
| weekly repeat shows a 7-day multi-select | ✅ | 7 |
| saved rule keeps the picked weekdays | ✅ | {"kind":"weekly","days":3} |
| motivational banner shows one of 20+ phrases | ✅ | 22 phrases in pool |
| home screen carries the motivational banner | ✅ | 20 chars |
| swipe right moves forward (Matrix → Week) | ✅ | week |
| swipe left moves to the previous bar index (Week → Matrix) | ✅ | matrix |
| swipe left follows the bottom-bar index after a tab jump | ✅ | stats |
| re-entering the app rotates the phrase | ✅ | "وضّح أولوياتك قبل أن تزحم يو…" |
| completed row celebrates briefly, then leaves the active view | ✅ | {"at120":true,"at1100":false} |
| completed task stays in the database (filter, not delete) | ✅ | {"exists":true,"done":true} |
| completed task remains reviewable in the week completed section | ✅ |  |
| midnight rollover jumps the Today view to the new day | ✅ | {"rolled":true,"selBefore":"27","selAfter":"28","expect":"28"} |
| bottom bar highlights the swiped-to page instantly | ✅ | week |
| a single gesture moves exactly one page (touch+pointer locked) | ✅ | {"before":"matrix","after":"week"} |
| untimed goals schedule zero notifications | ✅ | 0 entries |
| matrix is one scrollable stack of 4 full-width cards | ✅ | {"n":4,"widths":[358,358,358,358],"vw":390,"listOverflow":"visible","scroller":true} |
| titles never break a word and never clip | ✅ | {"wb":"normal","ow":"break-word","clamp":"none","fit":true} |
| swipe starting on a task card navigates forward | ✅ | week |
| the click ending a navigation swipe opens nothing | ✅ |  |
| swipe over content moves back one bar index | ✅ | matrix |
| navigated to the fixture day in last week | ✅ | chip 3 |
| past day is flagged read-only | ✅ | {"lock":true,"ro":1,"all":1,"stray":[]} |
| tapping a past task shows the motivational modal | ✅ | هذا اليوم صار تاريخًا |
| FAB on a past day motivates instead of adding | ✅ |  |
| table view renders rows + header | ✅ | {"rows":6,"head":true} |
| sort setting persists | ✅ |  |
| insets converted from physical to CSS px | ✅ | {"sat":"100px","sab":"90px","ime":"400px","dpr":3} |
| app-name / icon customisation removed from settings | ✅ | {"brand":"خِطّة","def":"خِطّة"} |
| identity preferences no longer stored | ✅ | lang,theme,weekStart,reminders,defaultRemindOffset,dayStartHour,onboardingDone,alarmHorizonDays,matrixHintSeen,palette,tagStyle,tagAlpha,weekView,weekSort,lastQuote |
| palette choice drives the CSS variables | ✅ | {"p":true,"q1":"#4f46e5","css":"#4f46e5"} |
| vivid tag skin uses the solid palette colour | ✅ | {"bg":"rgb(217, 119, 6)","mode":"vivid"} |
| export/import removed from the codebase | ✅ | {"a":"undefined","b":"undefined","c":"undefined"} |
| settings renders rows/controls | ✅ | {"rows":15,"switches":1,"segs":5,"fabHidden":true} |
| FAB hidden on settings | ✅ |  |
| language switch flips to LTR | ✅ | ltr |
| UI translated to English | ✅ | Matrix |
| quadrant label translated | ✅ | Do now |
| week still starts on Saturday | ✅ | Sat |
| Western digits in dates | ✅ | Sep 26 – Oct 2, 2026 |
| header safe-area padding is identical in RTL and LTR | ✅ | 18px / 18px |
| quote re-localises when reverting to Arabic | ✅ | وضّح أولوياتك قبل أن تزح |
| quote follows the locale both ways | ✅ | {"arabic":false,"len":45} |
| state survives a reload | ✅ | 16 → 16 |
| primary controls meet the 36px minimum height | ✅ | min=58px  |
| no console errors during the whole suite | ✅ |  |
| small-360x780: no horizontal overflow | ✅ |  |
| small-360x780: quadrants have usable height | ✅ | 221px |
| large-412x915: no horizontal overflow | ✅ |  |
| large-412x915: quadrants have usable height | ✅ | 221px |
| tablet-768x1024: no horizontal overflow | ✅ |  |
| tablet-768x1024: quadrants have usable height | ✅ | 221px |
| follows the OS dark scheme when theme=system | ✅ | dark |

## Screenshots

- qc/shots/00-file-smoke.png
- qc/shots/01-onboarding.png
- qc/shots/02-matrix-ar-light.png
- qc/shots/03-week-ar-light.png
- qc/shots/04-week-after-complete.png
- qc/shots/05-stats-ar-light.png
- qc/shots/06-matrix-ar-dark.png
- qc/shots/07-stats-ar-dark.png
- qc/shots/08-editor-ar-light.png
- qc/shots/09-editor-quadrant.png
- qc/shots/10-editor-recurrence.png
- qc/shots/11-datepicker-ar.png
- qc/shots/12-timepicker-ar.png
- qc/shots/13-drag-mid.png
- qc/shots/14-drag-cross.png
- qc/shots/15-drag-day.png
- qc/shots/16-settings-ar-light.png
- qc/shots/17-matrix-en-light.png
- qc/shots/18-week-en-light.png
- qc/shots/19-stats-en-light.png
- qc/shots/20-settings-en-light.png
- qc/shots/21-large-412x915-matrix.png
- qc/shots/21-large-412x915-week.png
- qc/shots/21-small-360x780-matrix.png
- qc/shots/21-small-360x780-week.png
- qc/shots/21-tablet-768x1024-matrix.png
- qc/shots/21-tablet-768x1024-week.png
- qc/shots/22-os-dark.png
- qc/shots/23-editor-weekly.png
- qc/shots/24-past-modal.png
- qc/shots/25-week-grid.png
- qc/shots/26-settings-identity.png
