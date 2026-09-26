/* domain/date.js — pure local-time calendar maths. No i18n, no DOM, no state. */
(function (root, factory) {
  var api = factory();
  root.K = root.K || {};
  root.K.date = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MINUTE = 60000, HOUR = 3600000, DAY = 86400000;

  /** { y, m:1-12, d, H, M, S, dow:0=Sun..6=Sat, iso:1=Mon..7=Sun } */
  function parts(ms) {
    var dt = new Date(ms);
    var dow = dt.getDay();
    return {
      y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(),
      H: dt.getHours(), M: dt.getMinutes(), S: dt.getSeconds(),
      dow: dow, iso: dow === 0 ? 7 : dow
    };
  }

  function fromParts(p) {
    return new Date(p.y, (p.m || 1) - 1, p.d || 1, p.H || 0, p.M || 0, p.S || 0, 0).getTime();
  }

  function startOfDay(ms) {
    var p = parts(ms);
    return fromParts({ y: p.y, m: p.m, d: p.d });
  }

  function endOfDay(ms) {
    return startOfDay(ms) + DAY - 1;
  }

  function startOfMinute(ms) {
    return Math.floor(ms / MINUTE) * MINUTE;
  }

  /** Calendar-day arithmetic (DST safe: always lands on the same local wall time). */
  function addDays(ms, n) {
    var p = parts(ms);
    return fromParts({ y: p.y, m: p.m, d: p.d + n, H: p.H, M: p.M, S: p.S });
  }

  function daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
  }

  /**
   * Add months keeping the anchor's day-of-month, clamped to shorter months
   * (31 Jan + 1 month → 28 Feb, + 2 months → 31 Mar — no drift).
   */
  function addMonths(ms, n, dayOfMonth) {
    var p = parts(ms);
    var total = p.y * 12 + (p.m - 1) + n;
    var y = Math.floor(total / 12);
    var m = (total % 12 + 12) % 12 + 1;
    var want = dayOfMonth || p.d;
    var d = Math.min(want, daysInMonth(y, m));
    return fromParts({ y: y, m: m, d: d, H: p.H, M: p.M, S: p.S });
  }

  function dayKey(ms) {
    var p = parts(ms);
    return p.y + '-' + (p.m < 10 ? '0' : '') + p.m + '-' + (p.d < 10 ? '0' : '') + p.d;
  }

  function sameDay(a, b) {
    return dayKey(a) === dayKey(b);
  }

  /** Whole days from a to b (b - a), by local calendar day. */
  function diffDays(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / DAY);
  }

  /**
   * Local midnight of the first day of the week containing `ms`.
   * @param startIso ISO day number of the week's first day (6 = Saturday, 7 = Sunday, 1 = Monday)
   */
  function weekStart(ms, startIso) {
    var s = startIso || 6;
    var p = parts(ms);
    var back = (p.iso - s + 7) % 7;
    return fromParts({ y: p.y, m: p.m, d: p.d - back });
  }

  /** 0-based index of `ms` inside the week that starts at `weekStartMs`. */
  function dayIndexInWeek(ms, weekStartMs) {
    return diffDays(weekStartMs, startOfDay(ms));
  }

  /** Saturday-first index (0=Sat … 6=Fri) for an ISO day number. */
  function satFirstIndex(iso) {
    return (iso - 6 + 7) % 7;
  }

  function isWeekend(ms) {
    var dow = parts(ms).dow;
    return dow === 5 || dow === 6; // Friday / Saturday
  }

  function nowDay() { return startOfDay(Date.now()); }

  return {
    MINUTE: MINUTE, HOUR: HOUR, DAY: DAY,
    parts: parts, fromParts: fromParts,
    startOfDay: startOfDay, endOfDay: endOfDay, startOfMinute: startOfMinute,
    addDays: addDays, addMonths: addMonths, daysInMonth: daysInMonth,
    dayKey: dayKey, sameDay: sameDay, diffDays: diffDays,
    weekStart: weekStart, dayIndexInWeek: dayIndexInWeek, satFirstIndex: satFirstIndex,
    isWeekend: isWeekend, nowDay: nowDay
  };
});
