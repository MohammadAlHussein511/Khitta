/* domain/model.js — the task document: defaults, normalisation, derived predicates. */
(function (root, factory) {
  var K = root.K = root.K || {};
  var api = factory(K.util, K.date, K.recurrence);
  K.model = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, D, R) {
  'use strict';

  var STATE_VERSION = 1;

  function defaultSettings() {
    return {
      lang: 'ar',
      theme: 'system',            // system | light | dark
      weekStart: 6,               // ISO day: 6 = Saturday
      reminders: true,
      defaultRemindOffset: 0,     // minutes before due
      dayStartHour: 9,
      onboardingDone: false,
      alarmHorizonDays: 60,
      matrixHintSeen: 0,
      // ---- V2 identity & presentation
      brandName: '',                    // '' ⇒ use the localised default
      iconVariant: 1,                   // 1..4 launcher icon
      palette: null,                    // null ⇒ built-in; else {q1:'#..',..}
      tagStyle: 'soft',                 // soft | vivid | outline
      tagAlpha: 16,                     // % opacity of the soft tag background
      weekView: 'list',                 // list | grid
      weekSort: 'manual',               // manual | time | quadrant | created
      lastQuote: -1
    };
  }

  var PALETTE_RE = /^#[0-9a-fA-F]{6}$/;

  /** Keeps only a full, valid 4-colour mapping; anything else falls back to the built-in. */
  function normalizePalette(p) {
    if (!p || typeof p !== 'object') return null;
    var out = {};
    for (var i = 1; i <= 4; i++) {
      var v = p['q' + i];
      if (typeof v !== 'string' || !PALETTE_RE.test(v)) return null;
      out['q' + i] = v.toLowerCase();
    }
    return out;
  }

  function emptyState() {
    return { version: STATE_VERSION, settings: defaultSettings(), tasks: [], createdAt: Date.now(), updatedAt: Date.now() };
  }

  /** A brand new task. `input` may carry partial fields from the editor or a drop target. */
  function createTask(input) {
    var i = input || {};
    var now = Date.now();
    var due = typeof i.dueAt === 'number' && i.dueAt > 0 ? i.dueAt : defaultDue(now, i.settings);
    return {
      id: i.id || U.uid('t'),
      title: String(i.title == null ? '' : i.title).slice(0, 300),
      notes: String(i.notes == null ? '' : i.notes).slice(0, 4000),
      imp: i.imp !== false,
      urg: !!i.urg,
      dueAt: due,
      remind: i.remind !== false,
      remindOffset: typeof i.remindOffset === 'number' ? i.remindOffset : 0,
      untimed: !!i.untimed,
      rec: R.format(i.rec || 'NONE'),
      recEnd: R.normalizeEnd(i.recEnd),
      pos: typeof i.pos === 'number' ? i.pos : 0,
      createdAt: now,
      closedAt: i.closedAt || null,
      done: i.done && typeof i.done === 'object' ? i.done : {}
    };
  }

  /** Sensible default due: today at the configured hour if it is still ahead, else tomorrow. */
  function defaultDue(now, settings) {
    var s = settings || defaultSettings();
    var hour = U.clamp(s.dayStartHour == null ? 9 : s.dayStartHour, 0, 23);
    var p = D.parts(now);
    var today = D.fromParts({ y: p.y, m: p.m, d: p.d, H: hour, M: 0, S: 0 });
    return today > now + 30 * 60000 ? today : D.addDays(today, 1);
  }

  /** Defensive normalisation: guarantees every field exists with the right shape. */
  function normalizeTask(t) {
    var o = t && typeof t === 'object' ? t : {};
    var out = {
      id: typeof o.id === 'string' && o.id ? o.id : U.uid('t'),
      title: typeof o.title === 'string' ? o.title.slice(0, 300) : '',
      notes: typeof o.notes === 'string' ? o.notes.slice(0, 4000) : '',
      imp: (o.imp === undefined || o.imp === null) ? true : !!o.imp,
      urg: !!o.urg,
      dueAt: typeof o.dueAt === 'number' && o.dueAt > 0 ? o.dueAt : Date.now(),
      remind: o.remind !== false,
      remindOffset: typeof o.remindOffset === 'number' && o.remindOffset >= 0 ? Math.min(o.remindOffset, 10080) : 0,
      untimed: !!o.untimed,
      rec: R.format(o.rec),
      recEnd: R.normalizeEnd(o.recEnd),
      pos: typeof o.pos === 'number' && isFinite(o.pos) ? o.pos : 0,
      createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
      closedAt: typeof o.closedAt === 'number' && o.closedAt > 0 ? o.closedAt : null,
      done: (o.done && typeof o.done === 'object' && !Array.isArray(o.done)) ? o.done : {}
    };
    // Legacy shapes: a boolean/string `completed` becomes an occurrence completion.
    if (o.completed === true && !out.closedAt) out.closedAt = out.createdAt;
    return out;
  }

  function normalizeState(raw) {
    var st = emptyState();
    if (!raw || typeof raw !== 'object') return st;
    var s = raw.settings || {};
    var d = st.settings;
    st.settings = {
      lang: s.lang === 'en' ? 'en' : 'ar',
      theme: (s.theme === 'light' || s.theme === 'dark') ? s.theme : 'system',
      weekStart: [1, 6, 7].indexOf(s.weekStart) >= 0 ? s.weekStart : d.weekStart,
      reminders: s.reminders !== false,
      defaultRemindOffset: typeof s.defaultRemindOffset === 'number' ? U.clamp(s.defaultRemindOffset, 0, 10080) : 0,
      dayStartHour: typeof s.dayStartHour === 'number' ? U.clamp(s.dayStartHour, 0, 23) : d.dayStartHour,
      onboardingDone: !!s.onboardingDone,
      alarmHorizonDays: typeof s.alarmHorizonDays === 'number' ? U.clamp(s.alarmHorizonDays, 7, 180) : d.alarmHorizonDays,
      matrixHintSeen: typeof s.matrixHintSeen === 'number' ? U.clamp(s.matrixHintSeen, 0, 99) : 0,
      brandName: typeof s.brandName === 'string' ? s.brandName.slice(0, 40) : '',
      iconVariant: [1, 2, 3, 4].indexOf(s.iconVariant) >= 0 ? s.iconVariant : 1,
      palette: normalizePalette(s.palette),
      tagStyle: ['soft', 'vivid', 'outline'].indexOf(s.tagStyle) >= 0 ? s.tagStyle : 'soft',
      tagAlpha: typeof s.tagAlpha === 'number' ? U.clamp(Math.round(s.tagAlpha), 4, 60) : 16,
      weekView: ['list', 'grid'].indexOf(s.weekView) >= 0 ? s.weekView : 'list',
      weekSort: ['manual', 'time', 'quadrant', 'created'].indexOf(s.weekSort) >= 0 ? s.weekSort : 'manual',
      lastQuote: typeof s.lastQuote === 'number' ? s.lastQuote : -1
    };
    var tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
    st.tasks = tasks.map(normalizeTask);
    st.version = STATE_VERSION;
    st.createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now();
    st.updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now();
    return st;
  }

  // ------------------------------------------------------------ predicates

  function isClosed(task) { return !!(task && task.closedAt); }

  function isDoneAt(task, at) {
    return !!(task && task.done && task.done[String(at)]);
  }

  function completedAtFor(task, at) {
    return (task && task.done && task.done[String(at)]) || null;
  }

  function doneCount(task) {
    if (!task || !task.done) return 0;
    return Object.keys(task.done).length;
  }

  /** Simple "is this task finished?" for non-repeating work. */
  function isComplete(task) {
    if (!task) return false;
    if (task.closedAt) return true;
    return isDoneAt(task, task.dueAt);
  }

  /**
   * Occurrences inside [from, to]. A closed series stops producing NEW occurrences at
   * closedAt — but an occurrence that was already completed stays visible (a one-off task
   * finished early must keep showing in the completed archive, not vanish).
   */
  function allOccurrences(task, from, to, limit) {
    if (!task || !task.dueAt) return [];
    if (to < from) return [];
    var all = R.occurrences(task.rec, task.dueAt, task.recEnd, from, to, limit || 400);
    if (!task.closedAt) return all;
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i] <= task.closedAt || isDoneAt(task, all[i])) out.push(all[i]);
    }
    return out;
  }

  /** Occurrences still to do inside [from, to]. */
  function openOccurrences(task, from, to, limit) {
    var all = allOccurrences(task, from, to, limit);
    var out = [];
    for (var i = 0; i < all.length; i++) if (!isDoneAt(task, all[i])) out.push(all[i]);
    return out;
  }

  /** Next occurrence that still needs doing, at or after `from` (null when finished). */
  function nextOpen(task, from) {
    if (!task || task.closedAt || !task.dueAt) return null;
    var to = from + 400 * D.DAY;
    if (task.recEnd && task.recEnd.mode === 'date') to = Math.min(to, task.recEnd.at + D.DAY);
    return R.nextPending(task.rec, task.dueAt, task.recEnd, from, task.done);
  }

  /** The earliest missed occurrence (for "overdue since"), or null. */
  function overdueSince(task, now, lookbackDays) {
    if (!task || task.closedAt || !task.dueAt) return null;
    var from = now - (lookbackDays || 60) * D.DAY;
    var list = R.occurrences(task.rec, task.dueAt, task.recEnd, from, now - 1, 500);
    for (var i = 0; i < list.length; i++) {
      if (isOccurrenceOverdue(task, list[i], now)) return list[i];
    }
    return null;
  }

  /**
   * The single source of truth for "is this occurrence late?".
   * Timed tasks go overdue the moment their time passes; untimed goals only once
   * their whole calendar day is over — a goal without a deadline must not nag at 00:01.
   */
  function isOccurrenceOverdue(task, at, now) {
    if (!task || task.closedAt || isDoneAt(task, at)) return false;
    var n = now == null ? Date.now() : now;
    if (task.untimed) return D.endOfDay(at) < n;
    return at < n;
  }

  /**
   * The moment an occurrence "happens" before any reminder lead-time:
   * its due time, or the configured day-start hour for untimed goals.
   */
  function baseTime(task, settings) {
    if (!task || !task.dueAt) return null;
    if (!task.untimed) return task.dueAt;
    var hour = U.clamp((settings && settings.dayStartHour) || 9, 0, 23);
    var p = D.parts(task.dueAt);
    return D.fromParts({ y: p.y, m: p.m, d: p.d, H: hour, M: 0, S: 0 });
  }

  /** Reminder trigger = base time minus the configured lead-time. */
  function triggerTime(task, settings) {
    if (!task || !task.remind || !task.dueAt) return null;
    return baseTime(task, settings) - (task.remindOffset || 0) * 60000;
  }

  return {
    STATE_VERSION: STATE_VERSION,
    defaultSettings: defaultSettings, emptyState: emptyState,
    createTask: createTask, normalizeTask: normalizeTask, normalizeState: normalizeState,
    defaultDue: defaultDue,
    isClosed: isClosed, isDoneAt: isDoneAt, completedAtFor: completedAtFor,
    doneCount: doneCount, isComplete: isComplete,
    openOccurrences: openOccurrences, allOccurrences: allOccurrences,
    nextOpen: nextOpen, overdueSince: overdueSince, triggerTime: triggerTime,
    isOccurrenceOverdue: isOccurrenceOverdue, normalizePalette: normalizePalette,
    baseTime: baseTime
  };
});
