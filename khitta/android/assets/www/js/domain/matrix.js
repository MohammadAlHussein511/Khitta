/* domain/matrix.js — Eisenhower quadrants + fractional-rank ordering. */
(function (root, factory) {
  var K = root.K = root.K || {};
  var api = factory(K.util);
  K.matrix = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U) {
  'use strict';

  var STEP = 1024;

  /**
   * Grid order matches the visual 2x2 (top row first). In RTL the first column is
   * rendered on the right automatically by the layout engine, so no swapping here.
   */
  var QUADRANTS = [
    { key: 'q1', imp: true,  urg: true,  icon: 'bolt',   varName: '--q1' },
    { key: 'q2', imp: true,  urg: false, icon: 'target', varName: '--q2' },
    { key: 'q3', imp: false, urg: true,  icon: 'users',  varName: '--q3' },
    { key: 'q4', imp: false, urg: false, icon: 'inbox',  varName: '--q4' }
  ];

  var BY_KEY = {};
  QUADRANTS.forEach(function (q) { BY_KEY[q.key] = q; });

  function keyOf(task) {
    if (!task) return 'q4';
    if (task.imp && task.urg) return 'q1';
    if (task.imp && !task.urg) return 'q2';
    if (!task.imp && task.urg) return 'q3';
    return 'q4';
  }

  function fromFlags(imp, urg) { return keyOf({ imp: !!imp, urg: !!urg }); }
  function byKey(key) { return BY_KEY[key] || BY_KEY.q4; }

  /** Group tasks per quadrant, each bucket sorted by rank (ascending `pos`). */
  function group(tasks) {
    var out = { q1: [], q2: [], q3: [], q4: [] };
    for (var i = 0; i < (tasks || []).length; i++) {
      var t = tasks[i];
      out[keyOf(t)].push(t);
    }
    Object.keys(out).forEach(function (k) { out[k] = sortTasks(out[k]); });
    return out;
  }

  function sortTasks(list) {
    return U.sortBy(list || [], function (t) {
      // Unranked items (pos === 0) keep insertion order at the top of the list.
      return t.pos || 0;
    });
  }

  function ranks(list) {
    return (list || []).map(function (t) { return t.pos || 0; });
  }

  /** Rank needed to insert at `index` within an already sorted list. */
  function rankForInsert(sortedList, index) {
    var list = sortedList || [];
    var i = U.clamp(index, 0, list.length);
    var prev = i > 0 ? (list[i - 1].pos || 0) : null;
    var next = i < list.length ? (list[i].pos || 0) : null;
    var mid = U.midpoint(prev, next, STEP);
    if (mid != null) return mid;
    return null; // caller must normalise first
  }

  /** Rewrite ranks to clean multiples of STEP, preserving the current order. */
  function normalizeRanks(sortedList) {
    (sortedList || []).forEach(function (t, i) { t.pos = (i + 1) * STEP; });
    return sortedList;
  }

  /**
   * Move an item inside one bucket. Returns the mutated (same) array, re-ranked only
   * when the fractional gap collapsed.
   */
  function reorder(sortedList, fromIndex, toIndex) {
    var list = (sortedList || []).slice();
    if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= list.length) return list;
    var item = list.splice(fromIndex, 1)[0];
    var target = U.clamp(toIndex, 0, list.length);
    var prev = target > 0 ? (list[target - 1].pos || 0) : null;
    var next = target < list.length ? (list[target].pos || 0) : null;
    var mid = U.midpoint(prev, next, STEP);
    if (mid == null) {
      list.splice(target, 0, item);
      normalizeRanks(list);
      return list;
    }
    item.pos = mid;
    list.splice(target, 0, item);
    return list;
  }

  /** Rank for a task dropped into another quadrant at `index` (top by default). */
  function rankForDrop(targetBucketSorted, index) {
    var list = targetBucketSorted || [];
    if (!list.length) return STEP;
    var i = U.clamp(index == null ? list.length : index, 0, list.length);
    var r = rankForInsert(list, i);
    if (r != null) return r;
    return (list[list.length - 1].pos || 0) + STEP;
  }

  return {
    STEP: STEP,
    QUADRANTS: QUADRANTS,
    keyOf: keyOf, fromFlags: fromFlags, byKey: byKey,
    group: group, sortTasks: sortTasks, ranks: ranks,
    rankForInsert: rankForInsert, normalizeRanks: normalizeRanks,
    reorder: reorder, rankForDrop: rankForDrop
  };
});
