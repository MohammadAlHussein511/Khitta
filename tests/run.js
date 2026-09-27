/* tests/run.js — dependency-free test runner for the domain + state layers.
 *
 * The web modules are written UMD-style, so the exact same files that ship inside the APK
 * are exercised here: date maths, the recurrence engine, week expansion, statistics,
 * quadrant ranking, i18n parity and the store's mutation/persistence contract —
 * including the alarm payload that Android arms.
 *
 *   node tests/run.js
 */
'use strict';

const path = require('path');
const WWW = path.resolve(__dirname, '../android/assets/www/js');

// ---- minimal localStorage so the browser fallback path is testable in Node
const mem = new Map();
global.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  clear: () => mem.clear()
};
global.window = undefined;

// ---- load in dependency order (each module also registers itself on global.K)
require(path.join(WWW, 'core/util.js'));
require(path.join(WWW, 'core/dom.js'));
require(path.join(WWW, 'domain/date.js'));
require(path.join(WWW, 'domain/recurrence.js'));
require(path.join(WWW, 'domain/model.js'));
require(path.join(WWW, 'domain/matrix.js'));
require(path.join(WWW, 'domain/week.js'));
require(path.join(WWW, 'domain/stats.js'));
require(path.join(WWW, 'core/i18n.js'));
require(path.join(WWW, 'platform/bridge.js'));
require(path.join(WWW, 'platform/storage.js'));
require(path.join(WWW, 'platform/notify.js'));
require(path.join(WWW, 'core/store.js'));

const K = global.K;
const U = K.util, D = K.date, R = K.recurrence, M = K.model, MX = K.matrix, WK = K.week, S = K.stats, I = K.i18n, N = K.notify, store = K.store;

// ------------------------------------------------------------------ harness
let pass = 0; const failures = [];
let group = '';
function section(name) { group = name; console.log('\n' + name); }
function test(name, fn) {
  try { fn(); pass++; console.log('  \u2714 ' + name); }
  catch (e) { failures.push([group + ' › ' + name, e.message]); console.log('  \u2718 ' + name + '\n      ' + e.message); }
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'expected ' + b + ' but got ' + a);
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy, got ' + JSON.stringify(v)); }
function near(a, b, tol, msg) { if (Math.abs(a - b) > (tol || 1)) throw new Error((msg || '') + ': ' + a + ' !~= ' + b); }

const at = (y, m, d, H, Mi) => D.fromParts({ y: y, m: m, d: d, H: H || 0, M: Mi || 0, S: 0 });

// ================================================================== date
section('domain/date');

test('addDays keeps the wall time across a month boundary', () => {
  const t = at(2026, 1, 30, 9, 30);
  eq(D.parts(D.addDays(t, 3)).d, 2);
  eq(D.parts(D.addDays(t, 3)).m, 2);
  eq(D.parts(D.addDays(t, 3)).H, 9);
  eq(D.parts(D.addDays(t, 3)).M, 30);
});

test('addDays handles a leap year', () => {
  eq(D.dayKey(D.addDays(at(2028, 2, 28, 8), 1)), '2028-02-29');
  eq(D.dayKey(D.addDays(at(2028, 2, 28, 8), 2)), '2028-03-01');
  eq(D.dayKey(D.addDays(at(2026, 2, 28, 8), 1)), '2026-03-01');
});

test('addMonths clamps to short months without drifting', () => {
  const anchor = at(2026, 1, 31, 10, 0);
  eq(D.dayKey(D.addMonths(anchor, 1)), '2026-02-28');
  eq(D.dayKey(D.addMonths(anchor, 2)), '2026-03-31');   // back to the 31st, not the 28th
  eq(D.dayKey(D.addMonths(anchor, 4)), '2026-05-31');
  eq(D.dayKey(D.addMonths(at(2026, 1, 30, 10), 1)), '2026-02-28');
  eq(D.parts(D.addMonths(anchor, 1)).H, 10);
});

test('addMonths honours an explicit day-of-month', () => {
  eq(D.dayKey(D.addMonths(at(2026, 3, 5, 7), 1, 15)), '2026-04-15');
  eq(D.dayKey(D.addMonths(at(2026, 1, 5, 7), 1, 31)), '2026-02-28');
});

test('weekStart lands on Saturday for startIso=6', () => {
  // 2026-09-10 is a Thursday
  const thursday = at(2026, 9, 10, 15, 45);
  eq(D.parts(thursday).iso, 4, 'fixture really is a Thursday');
  const ws = D.weekStart(thursday, 6);
  eq(D.dayKey(ws), '2026-09-05');
  eq(D.parts(ws).iso, 6, 'week starts on Saturday');
  eq(D.parts(ws).H, 0, 'week starts at local midnight');
});

test('weekStart supports Sunday and Monday starts', () => {
  const thursday = at(2026, 9, 10, 12);
  eq(D.dayKey(D.weekStart(thursday, 7)), '2026-09-06');
  eq(D.dayKey(D.weekStart(thursday, 1)), '2026-09-07');
  eq(D.dayKey(D.weekStart(at(2026, 9, 12, 12), 6)), '2026-09-12', 'a Saturday is its own week start');
});

test('diffDays / dayKey / satFirstIndex', () => {
  eq(D.diffDays(at(2026, 9, 5, 23), at(2026, 9, 10, 1)), 5);
  eq(D.dayKey(at(2026, 1, 2, 3, 4)), '2026-01-02');
  eq([6, 7, 1, 2, 3, 4, 5].map(D.satFirstIndex), [0, 1, 2, 3, 4, 5, 6]);
});

// ================================================================== recurrence
section('domain/recurrence');

test('parse/format round-trip', () => {
  eq(R.format(R.parse('NONE')), 'NONE');
  eq(R.format(R.parse('DAILY:3')), 'DAILY:3');
  eq(R.format(R.parse('MONTHLY:2:15')), 'MONTHLY:2:15');
  eq(R.format(R.parse('MONTHLY:1')), 'MONTHLY:1');
  eq(R.format(R.parse('garbage')), 'NONE');
  eq(R.format(R.parse('DAILY:0')), 'DAILY:1', 'interval is clamped to >= 1');
  ok(!R.isRepeating('NONE') && R.isRepeating('DAILY:1') && R.isRepeating('MONTHLY:1'));
});

test('daily every 3 days', () => {
  const a = at(2026, 9, 1, 9);
  eq(R.occurrences('DAILY:3', a, null, a, at(2026, 9, 14, 23), 50).map(D.dayKey),
    ['2026-09-01', '2026-09-04', '2026-09-07', '2026-09-10', '2026-09-13']);
  eq(D.dayKey(R.next('DAILY:3', a, null, at(2026, 9, 5, 0))), '2026-09-07');
});

test('daily keeps the anchor wall time', () => {
  const a = at(2026, 9, 1, 6, 45);
  R.occurrences('DAILY:1', a, null, a, at(2026, 9, 5), 10).forEach(ms => {
    eq(D.parts(ms).H, 6); eq(D.parts(ms).M, 45);
  });
});

test('monthly on the 15th, every 2 months', () => {
  const a = at(2026, 1, 15, 8);
  eq(R.occurrences('MONTHLY:2:15', a, null, a, at(2026, 12, 31), 50).map(D.dayKey),
    ['2026-01-15', '2026-03-15', '2026-05-15', '2026-07-15', '2026-09-15', '2026-11-15']);
});

test('monthly anchored on the 31st clamps short months', () => {
  const a = at(2026, 1, 31, 7);
  eq(R.occurrences('MONTHLY:1', a, null, a, at(2026, 7, 31, 23), 50).map(D.dayKey),
    ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31']);
});

test('end by count limits the series', () => {
  const a = at(2026, 9, 1, 9);
  const end = { mode: 'count', n: 3 };
  eq(R.occurrences('DAILY:1', a, end, a, at(2026, 10, 30), 50).length, 3);
  eq(R.countUpTo('DAILY:1', a, end, at(2026, 12, 31)), 3);
  eq(R.next('DAILY:1', a, end, at(2026, 9, 3, 12)), null, 'exhausted after the 3rd');
  ok(R.isExhausted('DAILY:1', a, end, at(2026, 9, 3, 12)));
});

test('end by date limits the series', () => {
  const a = at(2026, 9, 1, 9);
  const end = { mode: 'date', at: at(2026, 9, 10, 23, 59) };
  eq(R.occurrences('DAILY:1', a, end, a, at(2026, 10, 1), 50).length, 10);
  eq(R.next('DAILY:1', a, end, at(2026, 9, 10, 10)), null);
});

test('normalizeEnd rejects nonsense', () => {
  eq(R.normalizeEnd(null).mode, 'never');
  eq(R.normalizeEnd({ mode: 'count', n: 0 }).mode, 'never');
  eq(R.normalizeEnd({ mode: 'date' }).mode, 'never');
  eq(R.normalizeEnd({ mode: 'count', n: 5 }), { mode: 'count', n: 5 });
});

test('occurrences respects range boundaries inclusively', () => {
  const a = at(2026, 9, 1, 9);
  eq(R.occurrences('DAILY:1', a, null, at(2026, 9, 1, 9), at(2026, 9, 1, 9), 10).length, 1, 'exact hit');
  eq(R.occurrences('DAILY:1', a, null, at(2026, 9, 1, 9, 1), at(2026, 9, 2, 8), 10).length, 0, 'misses both');
  eq(R.occurrences('NONE', a, null, a, a, 10).length, 1);
  eq(R.occurrences('NONE', a, null, at(2026, 9, 2), at(2026, 9, 3), 10).length, 0);
});

test('nextPending skips completed occurrences', () => {
  const a = at(2026, 9, 1, 9);
  const done = {}; done[String(a)] = a + 1; done[String(D.addDays(a, 1))] = a + 2;
  eq(D.dayKey(R.nextPending('DAILY:1', a, null, a, done)), '2026-09-03');
  eq(R.nextPending('DAILY:1', a, { mode: 'count', n: 2 }, a, done), null);
});

test('rawCount is O(1)-ish for far horizons', () => {
  const a = at(2020, 1, 1, 8);
  eq(R.rawCount('DAILY:1', a, at(2026, 9, 10, 8)), R.countUpTo('DAILY:1', a, null, at(2026, 9, 10, 8)));
  ok(R.rawCount('DAILY:1', a, at(2026, 9, 10, 8)) > 2400, 'long daily series counted');
  eq(R.rawCount('DAILY:7', a, at(2020, 1, 22, 8)), 4, '0,7,14,21 Jan');
});

// ================================================================== model
section('domain/model');

test('createTask fills defaults and clamps input', () => {
  const t = M.createTask({ title: 'x'.repeat(400), imp: false, urg: true, dueAt: at(2026, 9, 10, 9) });
  ok(/^t_/.test(t.id), 'id generated');
  eq(t.title.length, 300, 'title clamped');
  eq(t.rec, 'NONE');
  eq(t.recEnd, { mode: 'never' });
  eq(t.done, {});
  eq(MX.keyOf(t), 'q3');
});

test('normalizeTask repairs a legacy/partial document', () => {
  const t = M.normalizeTask({ id: 'a', title: 'old', completed: true, rec: 'weekly', dueAt: 'x' });
  eq(t.rec, 'NONE', 'unknown recurrence falls back to NONE');
  ok(t.closedAt > 0, 'legacy completed:true becomes closedAt');
  eq(typeof t.dueAt, 'number', 'bad dueAt replaced');
  eq(t.imp, true); eq(t.urg, false);
});

test('normalizeState whitelists settings', () => {
  const st = M.normalizeState({ version: 0, settings: { lang: 'fr', theme: 'neon', weekStart: 3, alarmHorizonDays: 9999 }, tasks: [{}] });
  eq(st.settings.lang, 'ar'); eq(st.settings.theme, 'system');
  eq(st.settings.weekStart, 6); eq(st.settings.alarmHorizonDays, 180);
  eq(st.tasks.length, 1);
  eq(M.normalizeState(null).tasks, []);
});

test('openOccurrences excludes completed and post-closure occurrences', () => {
  const t = M.normalizeTask({ id: 'r', dueAt: at(2026, 9, 1, 9), rec: 'DAILY:1' });
  eq(M.openOccurrences(t, at(2026, 9, 1), at(2026, 9, 5, 23)).length, 5);
  t.done[String(at(2026, 9, 3, 9))] = 1;
  eq(M.openOccurrences(t, at(2026, 9, 1), at(2026, 9, 5, 23)).length, 4);
  t.closedAt = at(2026, 9, 3, 12);
  eq(M.allOccurrences(t, at(2026, 9, 1), at(2026, 9, 10, 23)).length, 3, 'series stops at closedAt');
  eq(M.nextOpen(t, at(2026, 9, 1)), null, 'closed series has no next');
});

test('overdueSince finds the earliest missed occurrence only', () => {
  const t = M.normalizeTask({ id: 'o', dueAt: at(2026, 9, 1, 9), rec: 'DAILY:1' });
  const now = at(2026, 9, 5, 12);
  eq(D.dayKey(M.overdueSince(t, now, 60)), '2026-09-01');
  t.done[String(at(2026, 9, 1, 9))] = 1;
  eq(D.dayKey(M.overdueSince(t, now, 60)), '2026-09-02');
  for (let d = 1; d <= 5; d++) t.done[String(at(2026, 9, d, 9))] = 1;
  eq(M.overdueSince(t, now, 60), null, 'nothing missed once today is done too');
  eq(M.overdueSince(M.normalizeTask({ id: 'c', dueAt: at(2026, 9, 1, 9), closedAt: now }), now, 60), null);
});

test('triggerTime applies the reminder offset', () => {
  const t = M.normalizeTask({ id: 'n', dueAt: at(2026, 9, 10, 9), remind: true, remindOffset: 30 });
  eq(D.parts(M.triggerTime(t)).H, 8); eq(D.parts(M.triggerTime(t)).M, 30);
  t.remind = false; eq(M.triggerTime(t), null);
});

// ================================================================== matrix
section('domain/matrix');

const mk = (id, imp, urg, pos) => M.normalizeTask({ id: id, title: id, imp: imp, urg: urg, pos: pos, dueAt: at(2026, 9, 10, 9) });

test('quadrant derivation and grouping', () => {
  eq(MX.fromFlags(true, true), 'q1'); eq(MX.fromFlags(true, false), 'q2');
  eq(MX.fromFlags(false, true), 'q3'); eq(MX.fromFlags(false, false), 'q4');
  const g = MX.group([mk('a', 1, 1, 1024), mk('b', 1, 1, 512), mk('c', 0, 0, 1024)]);
  eq(g.q1.map(t => t.id), ['b', 'a'], 'sorted by rank ascending');
  eq(g.q4.map(t => t.id), ['c']);
});

test('reorder keeps ranks strictly increasing', () => {
  const list = [mk('a', 1, 1, 1024), mk('b', 1, 1, 2048), mk('c', 1, 1, 3072)];
  const out = MX.reorder(list, 0, 2);
  eq(out.map(t => t.id), ['b', 'c', 'a']);
  const ranks = out.map(t => t.pos);
  ok(ranks[0] < ranks[1] && ranks[1] < ranks[2], 'monotonic: ' + ranks.join(','));
});

test('reorder normalises when the fractional gap collapses', () => {
  const list = [mk('a', 1, 1, 1), mk('b', 1, 1, 1.0001), mk('c', 1, 1, 1.0002)];
  const out = MX.reorder(list, 0, 2);
  eq(out.map(t => t.id), ['b', 'c', 'a']);
  const ranks = out.map(t => t.pos);
  ok(ranks[0] < ranks[1] && ranks[1] < ranks[2], 'still monotonic after normalisation: ' + ranks.join(','));
  ok(ranks[2] - ranks[0] > 100, 'ranks re-spaced: ' + ranks.join(','));
});

test('rankForInsert uses the midpoint and rankForDrop appends', () => {
  const list = [mk('a', 1, 1, 1024), mk('b', 1, 1, 2048)];
  eq(MX.rankForInsert(list, 1), 1536);
  eq(MX.rankForInsert(list, 0), 0);
  eq(MX.rankForInsert(list, 2), 3072);
  eq(MX.rankForDrop(list, null), 3072, 'drop at the end');
  eq(MX.rankForDrop([], 0), MX.STEP);
});

// ================================================================== week
section('domain/week');

test('weekBounds spans Saturday to Friday', () => {
  const b = WK.weekBounds(at(2026, 9, 10, 14), 0, 6);   // Thursday
  eq(b.days.length, 7);
  eq(D.dayKey(b.days[0]), '2026-09-05');
  eq(D.parts(b.days[0]).iso, 6, 'first day is Saturday');
  eq(D.dayKey(b.days[6]), '2026-09-11');
  eq(D.parts(b.days[6]).iso, 5, 'last day is Friday');
  eq(D.dayKey(b.start), '2026-09-05');
  eq(D.parts(b.end).H, 23, 'end covers the whole Friday');
});

test('weekBounds offsets by whole weeks and honours other week starts', () => {
  const now = at(2026, 9, 10, 14);
  eq(D.dayKey(WK.weekBounds(now, -1, 6).days[0]), '2026-08-29');
  eq(D.dayKey(WK.weekBounds(now, 1, 6).days[0]), '2026-09-12');
  eq(D.parts(WK.weekBounds(now, 0, 7).days[0]).iso, 7, 'Sunday start');
  eq(D.parts(WK.weekBounds(now, 0, 1).days[0]).iso, 1, 'Monday start');
  eq(WK.weekIndexOfToday(WK.weekBounds(now, 0, 6), now), 5, 'Thursday is index 5 in a Sat-first week');
  eq(WK.weekIndexOfToday(WK.weekBounds(now, 1, 6), now), -1, 'today is not in next week');
});

test('dayPlan expands recurrences and splits pending / completed', () => {
  const st = M.normalizeState({ tasks: [] });
  st.tasks.push(M.normalizeTask({ id: 'daily', title: 'd', dueAt: at(2026, 9, 5, 7), rec: 'DAILY:1' }));
  st.tasks.push(M.normalizeTask({ id: 'once', title: 'o', dueAt: at(2026, 9, 8, 18) }));
  st.tasks[0].done[String(at(2026, 9, 8, 7))] = at(2026, 9, 8, 7, 30);
  const now = at(2026, 9, 10, 12);

  const d8 = WK.dayPlan(st, at(2026, 9, 8), now);
  eq(d8.total, 2, 'daily occurrence + the one-off task');
  eq(d8.doneCount, 1); eq(d8.pendingCount, 1);
  eq(d8.pending[0].task.id, 'once');
  eq(d8.completed[0].task.id, 'daily');
  eq(d8.overdueCount, 1, 'the pending item on the 8th is overdue relative to the 10th');

  const d9 = WK.dayPlan(st, at(2026, 9, 9), now);
  eq(d9.total, 1); eq(d9.overdueCount, 1, 'yesterday’s daily occurrence is overdue');

  const plan = WK.plan(st, WK.weekBounds(now, 0, 6), now);
  eq(plan.days.length, 7);
  eq(plan.totals.total, plan.days.reduce((a, d) => a + d.total, 0));
  ok(plan.totals.done >= 1 && plan.totals.overdue >= 1, JSON.stringify(plan.totals));
  eq(plan.totals.quadrants.q1 + plan.totals.quadrants.q2 + plan.totals.quadrants.q3 + plan.totals.quadrants.q4,
    plan.totals.pending, 'quadrant counts cover exactly the pending entries');
});

test('a closed series stops appearing in later days', () => {
  const st = M.normalizeState({ tasks: [] });
  const t = M.normalizeTask({ id: 'c', title: 'c', dueAt: at(2026, 9, 5, 7), rec: 'DAILY:1' });
  t.closedAt = at(2026, 9, 7, 9);
  t.done[String(at(2026, 9, 7, 7))] = at(2026, 9, 7, 9);
  st.tasks.push(t);
  eq(WK.dayPlan(st, at(2026, 9, 8), at(2026, 9, 10)).total, 0);
  eq(WK.dayPlan(st, at(2026, 9, 7), at(2026, 9, 10)).total, 1);
  eq(WK.dayPlan(st, at(2026, 9, 7), at(2026, 9, 10)).doneCount, 1);
});

// ================================================================== stats
section('domain/stats');

function fixture() {
  const now = at(2026, 9, 10, 12);
  const st = M.normalizeState({ tasks: [] });
  const daily = M.normalizeTask({ id: 'd1', title: 'daily', imp: true, urg: false, dueAt: at(2026, 8, 20, 7), rec: 'DAILY:1', createdAt: at(2026, 8, 20, 7) });
  for (let i = 0; i < 20; i++) daily.done[String(D.addDays(at(2026, 8, 20, 7), i))] = D.addDays(at(2026, 8, 20, 8), i);
  st.tasks.push(daily);
  st.tasks.push(M.normalizeTask({ id: 'o1', title: 'overdue', imp: true, urg: true, dueAt: at(2026, 9, 1, 9), createdAt: at(2026, 9, 1, 9) }));
  st.tasks.push(M.normalizeTask({ id: 'f1', title: 'future', imp: false, urg: true, dueAt: at(2026, 9, 13, 9), createdAt: at(2026, 9, 10, 9) }));
  st.tasks.push(M.normalizeTask({ id: 'c1', title: 'closed', imp: false, urg: false, dueAt: at(2026, 9, 2, 9), closedAt: at(2026, 9, 2, 10), createdAt: at(2026, 9, 2, 9) }));
  st.tasks[3].done[String(at(2026, 9, 2, 9))] = at(2026, 9, 2, 10);
  st.tasks.push(M.normalizeTask({ id: 't1', title: 'today', imp: true, urg: true, dueAt: at(2026, 9, 10, 18), createdAt: at(2026, 9, 10, 8) }));
  return { st: st, now: now };
}

test('ring counts completions inside the 30-day window', () => {
  const f = fixture(); const s = S.compute(f.st, f.now);
  ok(s.ring.total > 0, 'occurrences counted');
  ok(s.ring.done > 0 && s.ring.done <= s.ring.total);
  eq(s.ring.pct, Math.round(s.ring.done / s.ring.total * 100));
  eq(s.windowDays, 30);
});

test('totals: overdue, due today, next 7 days', () => {
  const f = fixture(); const s = S.compute(f.st, f.now);
  eq(s.totals.all, 5);
  eq(s.totals.closed, 1); eq(s.totals.open, 4);
  eq(s.totals.overdue, 2, 'o1 (missed on the 1st) and the daily series (missed on the 9th/10th)');
  eq(D.dayKey(s.totals.overdueOldest), '2026-09-01');
  eq(s.totals.dueToday, 2, 'daily@07:00 missed today + t1@18:00');
  // occurrences, not tasks: the daily series contributes 7 (11th–17th), f1 one, t1 one
  eq(s.totals.next7, 9, '7 daily occurrences + f1 + t1');
  const once = M.normalizeState({ tasks: [M.normalizeTask({ id: 'z', dueAt: at(2026, 9, 13, 9) })] });
  eq(S.compute(once, f.now).totals.next7, 1, 'a single non-repeating task counts once');
});

test('quadrant breakdown covers every task exactly once', () => {
  const f = fixture(); const s = S.compute(f.st, f.now);
  eq(s.quadrants.length, 4);
  eq(s.quadrants.reduce((a, q) => a + q.total, 0), 5);
  eq(s.quadrants.reduce((a, q) => a + q.share, 0) >= 95, true, 'shares sum to ~100');
  const q2 = s.quadrants.filter(q => q.key === 'q2')[0];
  eq(q2.total, 1); ok(q2.done30 > 0, 'daily task completed in q2');
});

test('chart covers the last 7 days ending today', () => {
  const f = fixture(); const s = S.compute(f.st, f.now);
  eq(s.chart.length, 7);
  eq(D.dayKey(s.chart[6].dayMs), D.dayKey(f.now), 'last bar is today');
  eq(s.chart[6].isToday, true);
  ok(s.chartMax >= 1);
});

test('streak: best run is recorded, current is 0 after a gap', () => {
  const f = fixture(); const s = S.compute(f.st, f.now);
  eq(s.streak.current, 0, 'nothing completed on the 9th or the 10th');
  ok(s.streak.best >= 20, 'the 20-day run is remembered: ' + s.streak.best);
  const empty = S.compute(M.normalizeState({ tasks: [] }), f.now);
  eq(empty.streak.current, 0); eq(empty.ring.pct, 0); eq(empty.totals.all, 0);
});

test('streak becomes current again as soon as something is completed today', () => {
  const f = fixture();
  f.st.tasks[0].done[String(D.startOfDay(f.now))] = f.now;   // daily series, completed today
  const s = S.compute(f.st, f.now);
  ok(s.streak.current >= 1, 'current streak: ' + s.streak.current);
  ok(s.streak.best >= s.streak.current);
});

test('streak survives a gap and an empty today', () => {
  const now = at(2026, 9, 10, 8);
  const done = {};
  done[D.dayKey(at(2026, 9, 9))] = 1; done[D.dayKey(at(2026, 9, 8))] = 1;
  eq(S.streak(done, now).current, 2, 'yesterday + the day before, today still open');
  done[D.dayKey(now)] = 1;
  eq(S.streak(done, now).current, 3);
  eq(S.streak({ [D.dayKey(at(2026, 9, 1))]: 1 }, now).current, 0, 'old run does not count');
});

// ================================================================== i18n
section('core/i18n');

test('catalogues are at parity', () => {
  const p = I.keyParity();
  eq(p.onlyAr, [], 'keys missing in English');
  eq(p.onlyEn, [], 'keys missing in Arabic');
  ok(p.ar > 150, 'catalogue size ' + p.ar);
  eq(p.ar, p.en);
});

test('no untranslated placeholders remain', () => {
  I.setLang('ar');
  const bad = [];
  I.keys().forEach(k => {
    const v = I.CATALOGS.ar[k];
    if (typeof v === 'string' && /\b(TODO|FIXME|Lorem)\b/.test(v)) bad.push(k);
    if (v === '' || v == null) bad.push(k + '(empty)');
  });
  eq(bad, []);
});

test('Arabic is the default and RTL', () => {
  I.setLang('ar');
  eq(I.getLang(), 'ar'); eq(I.dir(), 'rtl'); ok(I.isRtl());
  I.setLang('fr'); eq(I.getLang(), 'ar', 'unknown language falls back to Arabic');
  I.setLang('en'); eq(I.dir(), 'ltr'); ok(!I.isRtl());
});

test('Western digits only, in both languages', () => {
  const ms = at(2026, 9, 10, 9, 5);
  ['ar', 'en'].forEach(lang => {
    I.setLang(lang);
    [I.fmtTime(ms), I.fmtDate(ms), I.fmtDateShort(ms), I.fmtDateTime(ms), I.fmtMonthYear(ms),
     I.fmtWeekRange(at(2026, 9, 5), at(2026, 9, 11)), I.fmtDue(ms, at(2026, 9, 10, 8)),
     I.fmtDur(3 * 3600000), I.pluralTasks(12), I.describeCount(7)].forEach(str => {
      if (/[\u0660-\u0669\u06F0-\u06F9]/.test(str)) throw new Error('Arabic-Indic digits found in "' + str + '" (' + lang + ')');
    });
  });
  I.setLang('ar');
  eq(I.fmtTime(ms), '09:05');
  ok(/^\d/.test(I.fmtDate(ms)), I.fmtDate(ms));
});

test('week range handles month and year rollover', () => {
  I.setLang('ar');
  ok(I.fmtWeekRange(at(2026, 8, 29), at(2026, 9, 4)).indexOf('2026') > 0);
  ok(I.fmtWeekRange(at(2026, 12, 26), at(2027, 1, 1)).indexOf('2027') > 0, 'year rollover shows both years');
  I.setLang('en');
  ok(/2027/.test(I.fmtWeekRange(at(2026, 12, 26), at(2027, 1, 1))));
});

test('recurrence descriptions are pluralised per language', () => {
  I.setLang('ar');
  ok(I.describeRecurrence('DAILY:1').length > 2);
  ok(I.describeRecurrence('MONTHLY:2:15').indexOf('15') > 0, I.describeRecurrence('MONTHLY:2:15'));
  I.setLang('en');
  eq(I.describeRecurrence('DAILY:1'), 'Every day');
  eq(I.describeRecurrence('DAILY:3'), 'Every 3 days');
  eq(I.describeRecurrence('MONTHLY:1'), 'Every month');
  ok(/day 15/.test(I.describeRecurrence('MONTHLY:2:15')));
  eq(I.describeRecurrence('NONE'), '');
});

test('t() interpolates variables and never throws on unknown keys', () => {
  I.setLang('ar');
  ok(I.t('week.summary', { pending: 3, done: 2 }).indexOf('3') >= 0);
  eq(I.t('nope.not.a.key'), 'nope.not.a.key');
});

// ================================================================== store
section('core/store');

function freshStore() {
  mem.clear();
  store.init();
  const st = store.get();
  st.tasks.length = 0;
  st.settings = M.defaultSettings();
  return st;
}

test('init seeds an empty document and persists it', () => {
  freshStore();
  eq(store.tasks().length, 0);
  eq(store.settings().lang, 'ar');
  store.flush();
  ok(mem.get('khitta.state.v1').length > 10, 'state written');
});

test('addTask ranks new tasks at the end of their quadrant', () => {
  freshStore();
  const a = store.addTask({ title: 'a', imp: true, urg: true, dueAt: at(2026, 9, 10, 9) });
  const b = store.addTask({ title: 'b', imp: true, urg: true, dueAt: at(2026, 9, 10, 10) });
  eq(MX.keyOf(a), 'q1'); eq(MX.keyOf(b), 'q1');
  ok(b.pos > a.pos, `${a.pos} < ${b.pos}`);
  eq(store.quadrantList('q1').map(t => t.id), [a.id, b.id]);
});

test('updateTask keeps identity and re-ranks on a quadrant change', () => {
  freshStore();
  const t = store.addTask({ title: 'x', imp: true, urg: true, dueAt: at(2026, 9, 10, 9) });
  const before = t.pos;
  const up = store.updateTask(t.id, { title: 'renamed', imp: false, urg: false });
  eq(up.id, t.id); eq(up.title, 'renamed');
  eq(MX.keyOf(up), 'q4');
  ok(up.pos !== before || store.quadrantList('q4').length === 1);
  eq(store.quadrantList('q1').length, 0);
  eq(store.updateTask('nope', {}), null);
});

test('completion, undo and series closing', () => {
  freshStore();
  const once = store.addTask({ title: 'once', dueAt: at(2026, 9, 10, 9), rec: 'NONE' });
  store.setOccurrenceDone(once.id, once.dueAt, true);
  ok(M.isComplete(store.taskById(once.id)), 'a one-off task closes when completed');
  store.setOccurrenceDone(once.id, once.dueAt, false);
  ok(!M.isComplete(store.taskById(once.id)), 'undo reopens it');

  const daily = store.addTask({ title: 'daily', dueAt: at(2026, 9, 1, 9), rec: 'DAILY:1' });
  store.completeCurrent(daily.id, at(2026, 9, 10, 12));
  const t = store.taskById(daily.id);
  eq(Object.keys(t.done).length, 1);
  eq(D.dayKey(Number(Object.keys(t.done)[0])), '2026-09-10', 'the most recent missed occurrence is completed');
  ok(!t.closedAt, 'the series keeps running');
  store.closeSeries(daily.id, at(2026, 9, 10, 13));
  ok(store.taskById(daily.id).closedAt > 0, 'series closed');
  store.reopen(daily.id);
  eq(store.taskById(daily.id).closedAt, null);
});

test('reorder and moveToQuadrant go through the store', () => {
  freshStore();
  const ids = ['a', 'b', 'c'].map(n => store.addTask({ title: n, imp: true, urg: true, dueAt: at(2026, 9, 10, 9) }).id);
  ok(store.reorder('q1', 0, 2));
  eq(store.quadrantList('q1').map(t => t.id), [ids[1], ids[2], ids[0]]);
  const ranks = store.quadrantList('q1').map(t => t.pos);
  ok(ranks[0] < ranks[1] && ranks[1] < ranks[2], 'monotonic');
  eq(store.reorder('q1', 1, 1), false, 'a no-op move is rejected');

  store.moveToQuadrant(ids[0], 'q3', null);
  eq(MX.keyOf(store.taskById(ids[0])), 'q3');
  eq(store.quadrantList('q1').length, 2);
  eq(store.quadrantList('q3').length, 1);
});

test('reschedule shifts completion history with the task', () => {
  freshStore();
  const t = store.addTask({ title: 'r', dueAt: at(2026, 9, 1, 9), rec: 'DAILY:1' });
  store.setOccurrenceDone(t.id, at(2026, 9, 1, 9), true);
  store.setOccurrenceDone(t.id, at(2026, 9, 2, 9), true);
  store.reschedule(t.id, at(2026, 9, 4, 9));   // +3 days
  const moved = store.taskById(t.id);
  eq(D.dayKey(moved.dueAt), '2026-09-04');
  eq(Object.keys(moved.done).map(Number).sort((a, b) => a - b).map(D.dayKey), ['2026-09-04', '2026-09-05']);
});

test('deleteTask + restoreTask round-trips a deletion', () => {
  freshStore();
  const t = store.addTask({ title: 'gone', dueAt: at(2026, 9, 10, 9), rec: 'DAILY:2' });
  const snapshot = U.clone(t);
  ok(store.deleteTask(t.id));
  eq(store.taskById(t.id), null);
  store.restoreTask(snapshot);
  const back = store.taskById(t.id);
  ok(back, 'restored');
  eq(back.rec, 'DAILY:2'); eq(back.title, 'gone');
});

test('clearCompleted removes finished work only', () => {
  freshStore();
  const a = store.addTask({ title: 'a', dueAt: at(2026, 9, 10, 9) });
  const b = store.addTask({ title: 'b', dueAt: at(2026, 9, 11, 9) });
  store.setOccurrenceDone(a.id, a.dueAt, true);
  eq(store.clearCompleted(), 1);
  eq(store.tasks().map(t => t.id), [b.id]);
});

test('settings updates are whitelisted through normalizeState on reload', () => {
  freshStore();
  store.setSetting('theme', 'dark');
  store.setSetting('lang', 'en');
  store.setSetting('weekStart', 1);
  store.flush();
  eq(I.getLang(), 'en', 'i18n follows the setting');
  store.init();
  eq(store.settings().theme, 'dark');
  eq(store.settings().lang, 'en');
  eq(store.settings().weekStart, 1);
});

test('a corrupt document falls back to a clean state instead of crashing', () => {
  mem.set('khitta.state.v1', '{not json');
  store.init();
  eq(store.tasks().length, 0);
  eq(store.settings().lang, 'ar');
});

// ================================================================== notify payload
section('platform/notify (alarm payload consumed by Android)');

test('entries are future-only, sorted, coded 1..N and capped', () => {
  freshStore();
  const now = at(2026, 9, 10, 12);
  const t = store.addTask({ title: 'daily', dueAt: at(2026, 9, 1, 9), rec: 'DAILY:1', remind: true, remindOffset: 0 });
  const p = N.buildEntries(store.get(), now);
  ok(p.entries.length > 10, 'expanded across the horizon: ' + p.entries.length);
  ok(p.entries.length <= N.MAX_ENTRIES);
  eq(p.entries.map(e => e.code), p.entries.map((e, i) => i + 1), 'codes are 1..N');
  const times = p.entries.map(e => e.at);
  eq(times, times.slice().sort((a, b) => a - b), 'ascending');
  ok(times[0] > now, 'nothing armed in the past');
  eq(p.entries[0].taskId, t.id);
  ok(p.entries[0].title === 'daily');
  ok(p.entries[0].occAt > 0);
  eq(p.horizonDays, store.settings().alarmHorizonDays);
});

test('reminder offset moves the trigger earlier than the occurrence', () => {
  freshStore();
  const now = at(2026, 9, 10, 12);
  store.addTask({ title: 'x', dueAt: at(2026, 9, 11, 9), remind: true, remindOffset: 30 });
  const e = N.buildEntries(store.get(), now).entries[0];
  eq(D.parts(e.at).H, 8); eq(D.parts(e.at).M, 30);
  eq(D.parts(e.occAt).H, 9);
});

test('completed, closed, muted and reminder-off tasks are excluded', () => {
  freshStore();
  const now = at(2026, 9, 10, 12);
  const daily = store.addTask({ title: 'd', dueAt: at(2026, 9, 10, 9), rec: 'DAILY:1' });
  store.setOccurrenceDone(daily.id, at(2026, 9, 10, 9), true);
  store.addTask({ title: 'closed', dueAt: at(2026, 9, 11, 9), closedAt: now });
  store.addTask({ title: 'muted', dueAt: at(2026, 9, 11, 9), remind: false });
  const p = N.buildEntries(store.get(), now);
  ok(p.entries.every(e => e.taskId === daily.id), 'only the live series is armed');
  ok(p.entries.every(e => e.occAt > at(2026, 9, 10, 9)), 'the completed occurrence is skipped');
});

test('the global reminders switch empties the schedule', () => {
  freshStore();
  store.addTask({ title: 'd', dueAt: at(2026, 9, 11, 9), rec: 'DAILY:1' });
  ok(N.buildEntries(store.get(), Date.now()).entries.length > 0);
  store.setSetting('reminders', false);
  eq(N.buildEntries(store.get(), Date.now()).entries.length, 0);
});

test('the horizon setting bounds the schedule', () => {
  freshStore();
  const now = at(2026, 9, 10, 12);
  store.addTask({ title: 'd', dueAt: at(2026, 9, 11, 9), rec: 'DAILY:1' });
  store.setSetting('alarmHorizonDays', 7);
  const p = N.buildEntries(store.get(), now);
  eq(p.horizonDays, 7);
  ok(p.entries.length <= 7, 'entries within 7 days: ' + p.entries.length);
  ok(p.entries.every(e => e.at <= now + 8 * D.DAY));
});

test('payload serialises to the shape the Java side parses', () => {
  freshStore();
  const now = at(2026, 9, 10, 12);          // fixed clock: the suite must be date-independent
  store.addTask({ title: 'x', dueAt: at(2026, 9, 11, 9), remind: true });
  const json = JSON.stringify(N.buildEntries(store.get(), now));
  const parsed = JSON.parse(json);
  ['generatedAt', 'horizonDays', 'count', 'entries'].forEach(k => ok(k in parsed, 'missing ' + k));
  ['code', 'taskId', 'occAt', 'at', 'title', 'body', 'openLabel', 'doneLabel', 'snoozeLabel'].forEach(k => {
    ok(k in parsed.entries[0], 'entry missing ' + k);
  });
  ok(parsed.entries.every(e => Number.isInteger(e.code) && e.code > 0), 'codes are positive ints');
});

// ================================================================== V2 features
section('V2 / weekly mask recurrence');

test('WEEKLY parse/format/mask helpers', () => {
  const r = R.parse('WEEKLY:1:21');            // bits: Mon(1)+Wed(4)+Fri(16) = 21
  eq(r.kind, 'weekly'); eq(r.interval, 1); eq(r.mask, 21);
  eq(R.format(r), 'WEEKLY:1:21');
  eq(R.isosFromMask(21), [1, 3, 5]);
  eq(R.maskFromIsos([6, 7]), 96);
  eq(R.parse('WEEKLY:1:0').kind, 'none', 'empty mask is not a rule');
  eq(R.parse('WEEKLY:1').kind, 'none');
});

test('weekly occurrences honour the mask, the anchor weekday and intervals', () => {
  const mask = R.maskFromIsos([1, 3, 5]);      // Mon Wed Fri
  const anchor = at(2026, 9, 9, 8);            // a Wednesday
  const occ = R.occurrences('WEEKLY:1:' + mask, anchor, null, anchor, at(2026, 9, 23, 23), 30);
  eq(occ.map(D.dayKey), ['2026-09-09', '2026-09-11', '2026-09-14', '2026-09-16', '2026-09-18', '2026-09-21', '2026-09-23']);
  occ.forEach(ms => eq(D.parts(ms).H, 8, 'keeps the wall time'));
  const bi = R.occurrences('WEEKLY:2:' + mask, anchor, null, anchor, at(2026, 10, 2, 23), 30).map(D.dayKey);
  eq(bi.slice(0, 4), ['2026-09-09', '2026-09-11', '2026-09-21', '2026-09-23'], 'alternate weeks only');
  eq(R.rawCount('WEEKLY:1:' + mask, anchor, at(2026, 9, 11, 23)), 2);
  eq(D.dayKey(R.next('WEEKLY:1:' + mask, anchor, null, at(2026, 9, 11, 12))), '2026-09-14');
});

test('weekly respects an end count and stays consistent with countUpTo', () => {
  const mask = R.maskFromIsos([6, 7]);         // weekend
  const anchor = at(2026, 9, 5, 10);           // Saturday
  const end = { mode: 'count', n: 4 };
  eq(R.occurrences('WEEKLY:1:' + mask, anchor, end, anchor, at(2026, 12, 31), 50).length, 4);
  eq(R.countUpTo('WEEKLY:1:' + mask, anchor, end, at(2026, 12, 31)), 4);
  eq(D.dayKey(R.next('WEEKLY:1:' + mask, anchor, end, at(2026, 9, 6, 12))), '2026-09-12', '3rd of 4 still ahead');
  eq(R.next('WEEKLY:1:' + mask, anchor, end, at(2026, 9, 13, 12)), null, 'exhausted after the 4th');
});

section('V2 / untimed goals');

test('untimed tasks are not overdue until their day is over', () => {
  const day = at(2026, 9, 10);
  const t = M.normalizeTask({ id: 'u', dueAt: day, untimed: true });
  ok(!M.isOccurrenceOverdue(t, day, at(2026, 9, 10, 23, 59)), 'still fine at 23:59');
  ok(M.isOccurrenceOverdue(t, day, at(2026, 9, 11, 0, 1)), 'overdue once the day ends');
  const timed = M.normalizeTask({ id: 't2', dueAt: at(2026, 9, 10, 9) });
  ok(M.isOccurrenceOverdue(timed, at(2026, 9, 10, 9), at(2026, 9, 10, 9, 1)), 'timed tasks still nag on time');
  ok(!M.isOccurrenceOverdue(t, day, at(2026, 9, 9)), 'future days are never overdue');
});

test('untimed reminders ring at the configured day-start hour', () => {
  const t = M.normalizeTask({ id: 'u2', dueAt: at(2026, 9, 10), untimed: true, remind: true, remindOffset: 30 });
  eq(D.parts(M.baseTime(t, { dayStartHour: 9 })).H, 9);
  const trig = M.triggerTime(t, { dayStartHour: 9 });
  eq(D.parts(trig).H, 8); eq(D.parts(trig).M, 30);
  const timed = M.normalizeTask({ id: 't3', dueAt: at(2026, 9, 10, 18), remind: true, remindOffset: 60 });
  eq(M.baseTime(timed, {}), timed.dueAt, 'timed base is the due time');
  eq(D.parts(M.triggerTime(timed, {})).H, 17);
});

test('the store carries untimed + weekly through create and reload', () => {
  mem.clear(); store.init(); store.get().tasks.length = 0;
  const t = store.addTask({ title: 'goal', dueAt: at(2026, 9, 12), untimed: true, rec: 'WEEKLY:1:21' });
  ok(t.untimed); eq(t.rec, 'WEEKLY:1:21');
  store.flush();
  store.init();
  const back = store.taskById(t.id);
  ok(back.untimed, 'untimed survives a reload');
  eq(back.rec, 'WEEKLY:1:21');
});

section('V2 / sorting, read-only history, quotes, palette');

test('week sorting modes order entries as configured', () => {
  const mk2 = (id, pos, dueAt, q, created) => ({
    task: M.normalizeTask({ id: id, pos: pos, dueAt: dueAt, imp: q === 'q1' || q === 'q2', urg: q === 'q1' || q === 'q3', createdAt: created }),
    at: dueAt, quadrant: q
  });
  const unt = mk2('u', 500, at(2026, 9, 10), 'q2', 1); unt.task.untimed = true;
  const early = mk2('e', 900, at(2026, 9, 10, 8), 'q3', 2);
  const late = mk2('l', 100, at(2026, 9, 10, 20), 'q1', 3);
  const list = [late, unt, early];
  eq(WK.sortEntries(list, 'manual').map(e => e.task.id), ['l', 'u', 'e'], 'manual = pos order');
  eq(WK.sortEntries(list, 'time').map(e => e.task.id), ['u', 'e', 'l'], 'untimed goals lead their day');
  eq(WK.sortEntries(list, 'quadrant').map(e => e.task.id), ['l', 'u', 'e'], 'q1 → q2 → q3');
  eq(WK.sortEntries(list, 'created').map(e => e.task.id), ['l', 'e', 'u'], 'newest first');
});

test('past days are flagged read-only, today and future are editable', () => {
  const now = at(2026, 9, 10, 12);
  ok(WK.isReadOnlyDay(at(2026, 9, 9), now));
  ok(WK.isReadOnlyDay(at(2026, 9, 10), at(2026, 9, 11, 0, 0)), 'yesterday becomes read-only at midnight');
  ok(!WK.isReadOnlyDay(at(2026, 9, 10), now), 'today stays editable');
  ok(!WK.isReadOnlyDay(at(2026, 9, 11), now), 'and so does tomorrow');
});

test('quote pool has 20+ phrases per language and rotates', () => {
  I.setLang('ar');
  ok(I.quotes().length >= 20, 'ar quotes: ' + I.quotes().length);
  const seen = {};
  for (let i = 0; i < 60; i++) {
    const q = I.pickQuote(3);
    ok(q.index !== 3, 'never repeats the last index');
    ok(typeof q.text === 'string' && q.text.length > 10);
    seen[q.index] = 1;
  }
  ok(Object.keys(seen).length > 5, 'rotates across the pool');
  I.setLang('en');
  ok(I.quotes().length >= 20, 'en quotes: ' + I.quotes().length);
  I.setLang('ar');
});

test('palette validation accepts only a full 4-colour map', () => {
  eq(M.normalizePalette(null), null);
  eq(M.normalizePalette({ q1: '#ff0000' }), null, 'partial map rejected');
  eq(M.normalizePalette({ q1: 'red', q2: '#00ff00', q3: '#0000ff', q4: '#ffffff' }), null, 'non-hex rejected');
  const good = { q1: '#ff0000', q2: '#00ff00', q3: '#0000ff', q4: '#ffffff' };
  eq(M.normalizePalette(good), good);
});

test('V2 settings round-trip through the store', () => {
  mem.clear(); store.init();
  store.setSetting('tagStyle', 'vivid');
  store.setSetting('tagAlpha', 30);
  store.setSetting('weekView', 'grid');
  store.setSetting('weekSort', 'time');
  store.setSetting('palette', { q1: '#111111', q2: '#222222', q3: '#333333', q4: '#444444' });
  store.flush(); store.init();
  const s = store.settings();
  eq(s.tagStyle, 'vivid'); eq(s.tagAlpha, 30);
  eq(s.weekView, 'grid'); eq(s.weekSort, 'time');
  eq(s.palette.q4, '#444444');
  eq('brandName' in s, false, 'app-name preference no longer exists');
  eq('iconVariant' in s, false, 'icon-variant preference no longer exists');
  store.setSetting('tagStyle', 'nope');
  eq(store.settings().tagStyle, 'vivid', 'invalid values are ignored');
});

test('legacy identity preferences are stripped from old documents', () => {
  const st = M.normalizeState({ settings: { brandName: 'قديم', iconVariant: 4 }, tasks: [] });
  eq('brandName' in st.settings, false);
  eq('iconVariant' in st.settings, false);
});

test('untimed tasks never reach the alarm schedule', () => {
  freshStore();
  const now = at(2026, 9, 10, 12);
  store.addTask({ title: 'goal', dueAt: at(2026, 9, 11), untimed: true, remind: true });
  store.addTask({ title: 'timed', dueAt: at(2026, 9, 11, 9), remind: true });
  const p = N.buildEntries(store.get(), now);
  eq(p.entries.length, 1, 'only the timed task is armed');
  eq(p.entries[0].title, 'timed');
  eq(N.nextTriggerFor(store.get(), store.get().tasks[0].id, now), null);
});

test('export/import are gone from the V2 codebase', () => {
  eq(typeof store.exportJson, 'undefined');
  eq(typeof store.importJson, 'undefined');
  eq(typeof K.bridge.exportBackup, 'undefined');
  eq(typeof K.bridge.startImport, 'undefined');
  ok(typeof store.stateJsonLength === 'function');
});

// ================================================================== summary
console.log('\n' + '─'.repeat(60));
console.log(`${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  ✘ ' + f[0] + '\n      ' + f[1]));
  process.exit(1);
}
console.log('all domain + store + alarm-payload tests green');
