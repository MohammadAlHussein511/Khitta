/* core/store.js — the state container: load, subscribe, mutate, persist, re-arm alarms.
 *
 * This is the only module allowed to mutate the document. Views call these methods and
 * re-render from the subscription; the domain layer stays pure.
 */
(function (root, factory) {
  var K = root.K = root.K || {};
  K.store = factory(K.util, K.date, K.model, K.matrix, K.recurrence, K.storage, K.notify, K.i18n, K.bridge);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, D, M, MX, R, storage, notify, I, bridge) {
  'use strict';

  var state = null;
  var subs = [];
  var armed = 0;
  var persistDebounced = null;
  var alarmDebounced = null;
  var restoredFromBackup = false;

  function safeParse(s) {
    if (!s || !s.length) return null;
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  function init() {
    if (!persistDebounced) persistDebounced = U.debounce(persistNow, 400);
    if (!alarmDebounced) alarmDebounced = U.debounce(syncAlarms, 450);

    var parsed = safeParse(storage.read());
    if (!parsed && bridge.hasBackup && bridge.hasBackup()) {
      // The live document was unreadable — try the one-generation native backup.
      parsed = safeParse(bridge.loadBackup ? bridge.loadBackup() : '');
      restoredFromBackup = !!parsed;
    }
    state = M.normalizeState(parsed);
    I.setLang(state.settings.lang);
    if (!parsed) persistNow();          // seed the file on first run
    syncAlarms();
    return state;
  }

  function get() { return state; }
  function settings() { return state.settings; }
  function tasks() { return state.tasks; }
  function taskById(id) {
    var list = state.tasks;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function subscribe(fn) {
    subs.push(fn);
    return function () { subs = subs.filter(function (f) { return f !== fn; }); };
  }

  function emit(reason, payload) {
    state.updatedAt = Date.now();
    for (var i = 0; i < subs.length; i++) {
      try { subs[i](state, reason, payload); }
      catch (e) { if (typeof console !== 'undefined') console.error('[store] subscriber failed', e); }
    }
  }

  function persistNow() {
    state.updatedAt = Date.now();
    storage.write(JSON.stringify(state));
  }

  function syncAlarms() {
    var res = notify.sync(state);
    armed = res && res.armed ? res.armed : 0;
    emit('alarms', { armed: armed });
  }

  /** Persist + re-arm, both debounced so a drag does not hammer the disk. */
  function commit(reason, payload) {
    emit(reason, payload);
    persistDebounced();
    alarmDebounced();
  }

  /** Synchronous save, used on pause / pagehide. */
  function flush() {
    if (persistDebounced) persistDebounced.cancel();
    if (alarmDebounced) alarmDebounced.cancel();
    persistNow();
    var res = notify.sync(state);
    armed = res && res.armed ? res.armed : 0;
  }

  function armedCount() { return armed; }

  // ------------------------------------------------------------ mutations

  function quadrantList(key) {
    return MX.sortTasks(state.tasks.filter(function (t) { return MX.keyOf(t) === key; }));
  }

  /** Rank for a new task: bottom of its quadrant, so new items appear last. */
  function rankForNew(key) {
    var list = quadrantList(key);
    if (!list.length) return MX.STEP;
    var last = list[list.length - 1].pos || 0;
    return last + MX.STEP;
  }

  function addTask(input) {
    var draft = input || {};
    var key = MX.fromFlags(draft.imp !== false, !!draft.urg);
    var task = M.createTask({
      title: draft.title, notes: draft.notes,
      imp: draft.imp !== false, urg: !!draft.urg,
      dueAt: draft.dueAt, remind: draft.remind,
      remindOffset: draft.remindOffset == null ? state.settings.defaultRemindOffset : draft.remindOffset,
      rec: draft.rec, recEnd: draft.recEnd,
      pos: rankForNew(key),
      settings: state.settings
    });
    state.tasks.push(task);
    commit('add', { task: task });
    return task;
  }

  function updateTask(id, patch) {
    var t = taskById(id);
    if (!t) return null;
    var before = MX.keyOf(t);
    var merged = {};
    for (var k in t) merged[k] = t[k];
    for (var k2 in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k2)) merged[k2] = patch[k2];
    }
    var next = M.normalizeTask(merged);
    next.id = t.id;                       // never let a patch change identity
    next.createdAt = t.createdAt;
    next.done = t.done || {};
    if (patch.pos == null) next.pos = t.pos;

    var after = MX.keyOf(next);
    if (after !== before) next.pos = rankForNew(after);   // dropped into a new quadrant

    var idx = state.tasks.indexOf(t);
    state.tasks[idx] = next;
    commit('update', { task: next, moved: after !== before, quadrant: after });
    return next;
  }

  function deleteTask(id) {
    var t = taskById(id);
    if (!t) return false;
    state.tasks = state.tasks.filter(function (x) { return x.id !== id; });
    commit('delete', { id: id, task: t });
    return true;
  }

  /** Set/clear completion for one concrete occurrence. */
  function setOccurrenceDone(id, occAt, done) {
    var t = taskById(id);
    if (!t) return null;
    var at = String(occAt);
    if (done) t.done[at] = Date.now();
    else delete t.done[at];
    if (!R.isRepeating(t.rec)) t.closedAt = done ? Date.now() : null;
    commit('complete', { task: t, occAt: occAt, done: !!done });
    return t;
  }

  /**
   * Checkbox semantics for views without an occurrence context (the matrix):
   * complete the most recent missed occurrence, otherwise the next upcoming one.
   */
  function completeCurrent(id, now) {
    var t = taskById(id);
    if (!t) return null;
    var n = now == null ? Date.now() : now;
    var target = null;
    var missed = M.allOccurrences(t, n - 30 * D.DAY, n, 400);
    for (var i = missed.length - 1; i >= 0; i--) {
      if (!M.isDoneAt(t, missed[i])) { target = missed[i]; break; }
    }
    if (target == null) target = M.nextOpen(t, n);
    if (target == null) return null;
    return setOccurrenceDone(id, target, true);
  }

  function undoCurrent(id, now) {
    var t = taskById(id);
    if (!t) return null;
    var n = now == null ? Date.now() : now;
    var keys = Object.keys(t.done || {}).map(Number).sort(function (a, b) { return b - a; });
    var target = null;
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] <= n + D.DAY) { target = keys[i]; break; }
    }
    if (target == null && keys.length) target = keys[0];
    if (target == null) return null;
    return setOccurrenceDone(id, target, false);
  }

  /** Stop a repeating series (and mark the occurrence it stopped on as done). */
  function closeSeries(id, now) {
    var t = taskById(id);
    if (!t) return null;
    var n = now == null ? Date.now() : now;
    var occ = M.allOccurrences(t, n - 30 * D.DAY, n, 400);
    var last = null;
    for (var i = occ.length - 1; i >= 0; i--) { if (!M.isDoneAt(t, occ[i])) { last = occ[i]; break; } }
    if (last == null) last = t.dueAt;
    t.done[String(last)] = n;
    t.closedAt = n;
    commit('close', { task: t });
    return t;
  }

  function reopen(id) {
    var t = taskById(id);
    if (!t) return null;
    t.closedAt = null;
    commit('reopen', { task: t });
    return t;
  }

  /** Drag reordering inside one quadrant. Indices refer to the current sorted order. */
  function reorder(key, fromIndex, toIndex) {
    var list = quadrantList(key);
    if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= list.length) return false;
    MX.reorder(list, fromIndex, toIndex);   // mutates `pos` on the live task objects
    commit('reorder', { quadrant: key });
    return true;
  }

  /** Drop a task into another quadrant at `index` (defaults to the end). */
  function moveToQuadrant(id, key, index) {
    var t = taskById(id);
    if (!t) return null;
    var q = MX.byKey(key);
    var target = quadrantList(key).filter(function (x) { return x.id !== id; });
    t.imp = q.imp;
    t.urg = q.urg;
    t.pos = MX.rankForDrop(target, index == null ? target.length : index);
    commit('move', { task: t, quadrant: key });
    return t;
  }

  function setSetting(key, value) {
    state.settings[key] = value;
    if (key === 'lang') I.setLang(value);
    commit('settings', { key: key, value: value });
    if (key === 'reminders' && value === false) notify.cancelAll();
    return state.settings;
  }

  function clearCompleted() {
    var before = state.tasks.length;
    state.tasks = state.tasks.filter(function (t) { return !M.isComplete(t); });
    var removed = before - state.tasks.length;
    if (removed) {
      MX.QUADRANTS.forEach(function (q) { MX.normalizeRanks(quadrantList(q.key)); });
      commit('clear', { removed: removed });
    }
    return removed;
  }

  function exportJson(pretty) {
    return JSON.stringify(state, null, pretty ? 2 : 0);
  }

  function importJson(text) {
    var parsed = safeParse(text);
    if (!parsed || !parsed.tasks) return false;
    state = M.normalizeState(parsed);
    I.setLang(state.settings.lang);
    commit('import', {});
    persistNow();
    syncAlarms();
    return true;
  }

  /** Reload from disk (the native layer may have mutated it from a notification action). */
  function reloadFromDisk() {
    var parsed = safeParse(storage.read());
    if (!parsed) return false;
    var langBefore = state.settings.lang;
    state = M.normalizeState(parsed);
    I.setLang(state.settings.lang);
    emit('reload', { langChanged: langBefore !== state.settings.lang });
    syncAlarms();
    return true;
  }

  function stats(now) {
    return { tasks: state.tasks.length, armed: armed, bytes: storage.bytes(), backend: storage.backend, restoredFromBackup: restoredFromBackup };
  }

  return {
    init: init, get: get, settings: settings, tasks: tasks, taskById: taskById,
    subscribe: subscribe, emit: emit, flush: flush, persistNow: persistNow, syncAlarms: syncAlarms,
    armedCount: armedCount, quadrantList: quadrantList, rankForNew: rankForNew,
    addTask: addTask, updateTask: updateTask, deleteTask: deleteTask,
    setOccurrenceDone: setOccurrenceDone, completeCurrent: completeCurrent, undoCurrent: undoCurrent,
    closeSeries: closeSeries, reopen: reopen,
    reorder: reorder, moveToQuadrant: moveToQuadrant,
    setSetting: setSetting, clearCompleted: clearCompleted,
    exportJson: exportJson, importJson: importJson, reloadFromDisk: reloadFromDisk,
    stats: stats
  };
});
