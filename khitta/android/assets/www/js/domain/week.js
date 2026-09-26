/* domain/week.js — Saturday→Friday week model and per-day occurrence expansion. */
(function (root, factory) {
  var K = root.K = root.K || {};
  var api = factory(K.util, K.date, K.model, K.matrix);
  K.week = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, D, M, MX) {
  'use strict';

  var DAYS = 7;

  /** The week (7 local midnights) containing `refMs`, shifted by `offset` weeks. */
  function weekBounds(refMs, offset, startIso) {
    var start = D.weekStart(refMs == null ? Date.now() : refMs, startIso || 6);
    if (offset) start = D.addDays(start, DAYS * offset);
    var days = [];
    for (var i = 0; i < DAYS; i++) days.push(D.addDays(start, i));
    return {
      start: start,
      end: D.endOfDay(days[DAYS - 1]),
      days: days,
      offset: offset || 0,
      startIso: startIso || 6
    };
  }

  function weekIndexOfToday(bounds, now) {
    var t = D.startOfDay(now == null ? Date.now() : now);
    for (var i = 0; i < bounds.days.length; i++) if (bounds.days[i] === t) return i;
    return -1;
  }

  /**
   * One day, expanded into occurrences. Recurring tasks appear on every day they occur;
   * completion is per occurrence; anything not done and already past is flagged overdue.
   */
  function dayPlan(state, dayMs, now) {
    var dayStart = D.startOfDay(dayMs);
    var dayEnd = D.endOfDay(dayStart);
    var tasks = (state && state.tasks) || [];
    var entries = [];

    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      var occ = M.allOccurrences(t, dayStart, dayEnd, 500);
      for (var j = 0; j < occ.length; j++) {
        var at = occ[j];
        var done = M.isDoneAt(t, at);
        entries.push({
          task: t,
          at: at,
          done: done,
          doneAt: M.completedAtFor(t, at),
          overdue: !done && at < now && !t.closedAt,
          quadrant: MX.keyOf(t)
        });
      }
    }

    var pending = U.sortBy(entries.filter(function (e) { return !e.done; }), function (e) { return e.at; });
    var completed = U.sortBy(entries.filter(function (e) { return e.done; }), function (e) { return -(e.doneAt || e.at); });

    return {
      dayMs: dayStart,
      entries: entries,
      pending: pending,
      completed: completed,
      total: entries.length,
      doneCount: completed.length,
      pendingCount: pending.length,
      overdueCount: pending.filter(function (e) { return e.overdue; }).length
    };
  }

  /** The whole week, plus rolling totals used by the header. */
  function plan(state, bounds, now) {
    var n = now == null ? Date.now() : now;
    var days = bounds.days.map(function (d) { return dayPlan(state, d, n); });
    var totals = {
      total: 0, done: 0, pending: 0, overdue: 0,
      quadrants: { q1: 0, q2: 0, q3: 0, q4: 0 }
    };
    days.forEach(function (d) {
      totals.total += d.total;
      totals.done += d.doneCount;
      totals.pending += d.pendingCount;
      totals.overdue += d.overdueCount;
      d.entries.forEach(function (e) { if (!e.done) totals.quadrants[e.quadrant]++; });
    });
    totals.pct = U.pct(totals.done, totals.total);
    return { days: days, totals: totals, bounds: bounds };
  }

  return {
    DAYS: DAYS,
    weekBounds: weekBounds, weekIndexOfToday: weekIndexOfToday,
    dayPlan: dayPlan, plan: plan
  };
});
