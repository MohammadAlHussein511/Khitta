/* domain/stats.js — dashboard aggregation. Pure: state in, numbers out. */
(function (root, factory) {
  var K = root.K = root.K || {};
  var api = factory(K.util, K.date, K.model, K.matrix, K.recurrence);
  K.stats = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, D, M, MX, R) {
  'use strict';

  var RING_WINDOW_DAYS = 30;
  var CHART_DAYS = 7;
  var STREAK_LOOKBACK_DAYS = 400;

  function compute(state, now) {
    var n = now == null ? Date.now() : now;
    var tasks = (state && state.tasks) || [];
    var todayStart = D.startOfDay(n);
    var ringFrom = D.startOfDay(D.addDays(n, -(RING_WINDOW_DAYS - 1)));
    var ringTo = D.endOfDay(n);

    var ring = { done: 0, total: 0, pct: 0 };
    var quadrants = MX.QUADRANTS.map(function (q) {
      return { key: q.key, total: 0, open: 0, closed: 0, occ30: 0, done30: 0, overdue: 0, pct: 0, share: 0 };
    });
    var qIndex = {};
    quadrants.forEach(function (q, i) { qIndex[q.key] = i; });

    var overdueTasks = 0, dueToday = 0, next7 = 0, completedToday = 0, openTasks = 0, closedTasks = 0;
    var overdueOldest = null;
    var dayDone = {}, dayCreated = {};

    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      var qk = MX.keyOf(t);
      var qi = qIndex[qk];
      quadrants[qi].total++;
      if (t.closedAt) { quadrants[qi].closed++; closedTasks++; }
      else { quadrants[qi].open++; openTasks++; }

      // completion ring + quadrant 30-day bars
      var occ30 = M.allOccurrences(t, ringFrom, ringTo, 2000);
      for (var j = 0; j < occ30.length; j++) {
        ring.total++;
        quadrants[qi].occ30++;
        if (M.isDoneAt(t, occ30[j])) { ring.done++; quadrants[qi].done30++; }
      }

      // overdue (task level: at least one missed occurrence)
      if (!t.closedAt) {
        var since = M.overdueSince(t, n, 60);
        if (since != null) {
          overdueTasks++;
          quadrants[qi].overdue++;
          if (overdueOldest == null || since < overdueOldest) overdueOldest = since;
        }
        // today + next 7 days (open occurrences only)
        dueToday += M.openOccurrences(t, todayStart, D.endOfDay(n), 200).length;
        next7 += M.openOccurrences(t, n + 1, D.addDays(n, 7), 400).length;
      }

      // per-day activity (what the user actually completed, and when tasks were created)
      var keys = t.done ? Object.keys(t.done) : [];
      for (var k = 0; k < keys.length; k++) {
        var at = Number(keys[k]);
        var doneAt = Number(t.done[keys[k]]) || at;
        var dk = D.dayKey(doneAt);
        dayDone[dk] = (dayDone[dk] || 0) + 1;
        if (doneAt >= todayStart && doneAt <= D.endOfDay(n)) completedToday++;
      }
      var ck = D.dayKey(t.createdAt);
      dayCreated[ck] = (dayCreated[ck] || 0) + 1;
    }

    ring.pct = U.pct(ring.done, ring.total);
    var taskTotal = quadrants.reduce(function (a, q) { return a + q.total; }, 0);
    quadrants.forEach(function (q) {
      // pct = share of this quadrant's occurrences that were completed in the window
      q.pct = U.pct(q.done30, q.occ30);
      // share = this quadrant's slice of all tasks
      q.share = U.pct(q.total, taskTotal);
    });

    // 7-day chart, oldest → newest, ending today
    var chart = [];
    for (var d = CHART_DAYS - 1; d >= 0; d--) {
      var day = D.addDays(todayStart, -d);
      var key = D.dayKey(day);
      chart.push({
        dayMs: day,
        key: key,
        iso: D.parts(day).iso,
        done: dayDone[key] || 0,
        created: dayCreated[key] || 0,
        isToday: d === 0
      });
    }
    var chartMax = Math.max(1, chart.reduce(function (a, c) { return Math.max(a, c.done, c.created); }, 1));

    return {
      now: n,
      totals: {
        all: tasks.length,
        open: openTasks,
        closed: closedTasks,
        overdue: overdueTasks,
        overdueOldest: overdueOldest,
        dueToday: dueToday,
        next7: next7,
        completedToday: completedToday
      },
      ring: ring,
      quadrants: quadrants,
      chart: chart,
      chartMax: chartMax,
      streak: streak(dayDone, n),
      windowDays: RING_WINDOW_DAYS
    };
  }

  /**
   * Consecutive-day streak of recorded completions. Today only breaks the streak
   * once it is over: an empty today with a completed yesterday still counts.
   */
  function streak(dayDone, now) {
    var best = 0, run = 0, bestEnd = null;
    var start = D.addDays(D.startOfDay(now), -STREAK_LOOKBACK_DAYS);
    for (var d = start; d <= D.startOfDay(now); d = D.addDays(d, 1)) {
      var key = D.dayKey(d);
      if (dayDone[key]) { run++; if (run > best) { best = run; bestEnd = d; } }
      else run = 0;
    }
    var today = D.startOfDay(now);
    var yesterday = D.addDays(today, -1);
    var current = 0;
    if (dayDone[D.dayKey(today)]) {
      current = 1;
      for (var p = yesterday; p >= start; p = D.addDays(p, -1)) {
        if (dayDone[D.dayKey(p)]) current++; else break;
      }
    } else if (dayDone[D.dayKey(yesterday)]) {
      current = 1;
      for (var p2 = D.addDays(yesterday, -1); p2 >= start; p2 = D.addDays(p2, -1)) {
        if (dayDone[D.dayKey(p2)]) current++; else break;
      }
    }
    return { current: current, best: Math.max(best, current), bestEnd: bestEnd };
  }

  return {
    RING_WINDOW_DAYS: RING_WINDOW_DAYS,
    CHART_DAYS: CHART_DAYS,
    compute: compute,
    streak: streak
  };
});
