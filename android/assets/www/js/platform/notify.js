/* platform/notify.js — turns the domain state into a concrete, pre-expanded alarm schedule
 * and hands it to Android. All recurrence maths stays in JS; the native side only arms times.
 */
(function (root, factory) {
  var K = root.K = root.K || {};
  K.notify = factory(K.util, K.date, K.model, K.matrix, K.bridge, K.i18n);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, D, M, MX, bridge, I) {
  'use strict';

  /** The platform allows ~500 alarms per package; stay comfortably below it. */
  var MAX_ENTRIES = 400;
  /** Per-task cap so one daily task cannot eat the whole budget. */
  var PER_TASK_LIMIT = 60;

  function settingsOf(state) {
    return (state && state.settings) ? state.settings : M.defaultSettings();
  }

  /**
   * @returns {{generatedAt:number, horizonDays:number, count:number, entries:Array}}
   *          entries are ascending by trigger time and carry codes 1..N.
   */
  function buildEntries(state, now) {
    var n = now == null ? Date.now() : now;
    var s = settingsOf(state);
    var horizonDays = U.clamp(s.alarmHorizonDays || 60, 7, 180);
    var horizonEnd = n + horizonDays * D.DAY;
    var raw = [];

    if (s.reminders !== false) {
      var tasks = (state && state.tasks) || [];
      var openLabel = I.t('notif.open');
      var doneLabel = I.t('notif.done');
      var snoozeLabel = I.t('notif.snooze');

      for (var i = 0; i < tasks.length; i++) {
        var t = tasks[i];
        if (!t || !t.dueAt || t.closedAt || t.remind === false) continue;
        var offsetMs = (t.remindOffset || 0) * 60000;
        var base = M.baseTime(t, s);                  // untimed goals happen at day-start hour
        if (base == null) continue;
        var shift = base - t.dueAt;                   // 0 for timed tasks
        var occFrom = n + offsetMs + 1 - shift;       // trigger must still be in the future
        if (occFrom > horizonEnd) continue;
        var occ = M.openOccurrences(t, occFrom, horizonEnd, PER_TASK_LIMIT);
        var quad = I.quadrantName(MX.keyOf(t));
        for (var j = 0; j < occ.length; j++) {
          var at = occ[j];
          var trigger = at + shift - offsetMs;
          if (trigger <= n) continue;
          raw.push({
            taskId: t.id,
            occAt: at,
            at: trigger,
            title: t.title || I.t('notif.test.title'),
            body: I.t('notif.body', { when: I.fmtDue(at, n), quad: quad }),
            openLabel: openLabel,
            doneLabel: doneLabel,
            snoozeLabel: snoozeLabel,
            snooze: false
          });
        }
      }
    }

    raw.sort(function (a, b) { return a.at - b.at; });
    var entries = raw.slice(0, MAX_ENTRIES);
    for (var k = 0; k < entries.length; k++) entries[k].code = k + 1;

    return { generatedAt: n, horizonDays: horizonDays, count: entries.length, entries: entries };
  }

  /** Pushes the schedule to the platform. No-op (reported) without the bridge. */
  function sync(state, now) {
    var payload = buildEntries(state, now);
    if (!bridge.available) {
      return { ok: false, armed: 0, count: payload.count, native: false };
    }
    var ok = false;
    if (payload.count === 0) {
      bridge.cancelAllAlarms();
      ok = true;
    } else {
      ok = bridge.scheduleAll(JSON.stringify(payload));
    }
    return { ok: ok, armed: ok ? payload.count : 0, count: payload.count, native: true };
  }

  function cancelAll() {
    if (bridge.available) bridge.cancelAllAlarms();
  }

  function status(state) {
    var s = bridge.alarmState();
    s.available = bridge.available;
    s.remindersOn = settingsOf(state).reminders !== false;
    return s;
  }

  function requestPermission() { bridge.requestNotificationPermission(); }
  function openSettings(kind) { bridge.openSystemSettings(kind); }

  function test() {
    return bridge.testReminder(JSON.stringify({
      title: I.t('notif.test.title'),
      body: I.t('notif.test.body')
    }));
  }

  /** Next armed trigger for one task (used by the editor to preview the reminder). */
  function nextTriggerFor(state, taskId, now) {
    var n = now == null ? Date.now() : now;
    var tasks = (state && state.tasks) || [];
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id !== taskId) continue;
      var t = tasks[i];
      var next = M.nextOpen(t, n);
      if (next == null || t.remind === false) return null;
      var shift = (M.baseTime(t, state.settings) || next) - t.dueAt;
      var trigger = next + shift - (t.remindOffset || 0) * 60000;
      return { occAt: next, at: trigger, past: trigger <= n };
    }
    return null;
  }

  return {
    MAX_ENTRIES: MAX_ENTRIES, PER_TASK_LIMIT: PER_TASK_LIMIT,
    buildEntries: buildEntries, sync: sync, cancelAll: cancelAll,
    status: status, requestPermission: requestPermission, openSettings: openSettings,
    test: test, nextTriggerFor: nextTriggerFor
  };
});
