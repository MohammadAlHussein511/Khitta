/* domain/recurrence.js — the recurrence engine (daily / monthly, bounded depth).
 *
 * Wire format kept on the task document:
 *   "NONE" | "DAILY:<intervalDays>" | "MONTHLY:<intervalMonths>[:<dayOfMonth>]"
 * End rule (task.recEnd):
 *   { mode:"never" } | { mode:"count", n:<int> } | { mode:"date", at:<ms> }
 *
 * Everything here is pure so it can be unit-tested in Node and ported 1:1 to Kotlin.
 */
(function (root, factory) {
  var D = (root.K && root.K.date) || require('./date.js');
  var api = factory(D);
  root.K = root.K || {};
  root.K.recurrence = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D) {
  'use strict';

  var MAX_GUARD = 20000;

  function parse(str) {
    var out = { kind: 'none', interval: 1, dom: null };
    if (!str || str === 'NONE') return out;
    var bits = String(str).split(':');
    var kind = (bits[0] || '').toUpperCase();
    if (kind === 'DAILY') {
      out.kind = 'daily';
      out.interval = Math.max(1, parseInt(bits[1], 10) || 1);
    } else if (kind === 'MONTHLY') {
      out.kind = 'monthly';
      out.interval = Math.max(1, parseInt(bits[1], 10) || 1);
      var dom = parseInt(bits[2], 10);
      out.dom = (dom >= 1 && dom <= 31) ? dom : null;
    }
    return out;
  }

  function format(rule) {
    var r = typeof rule === 'string' ? parse(rule) : (rule || { kind: 'none' });
    if (r.kind === 'daily') return 'DAILY:' + (r.interval || 1);
    if (r.kind === 'monthly') return 'MONTHLY:' + (r.interval || 1) + (r.dom ? ':' + r.dom : '');
    return 'NONE';
  }

  function isRepeating(rule) {
    var r = typeof rule === 'string' ? parse(rule) : rule;
    return !!r && r.kind !== 'none';
  }

  function normalizeEnd(end) {
    if (!end || !end.mode || end.mode === 'never') return { mode: 'never' };
    if (end.mode === 'count') {
      var n = Math.max(0, Math.floor(end.n || 0));
      return n > 0 ? { mode: 'count', n: n } : { mode: 'never' };
    }
    if (end.mode === 'date') {
      return end.at ? { mode: 'date', at: end.at } : { mode: 'never' };
    }
    return { mode: 'never' };
  }

  /** The n-th occurrence (n = 0 is the anchor). */
  function nth(rule, anchor, n) {
    var r = typeof rule === 'string' ? parse(rule) : rule;
    if (!n || n <= 0) return anchor;
    if (r.kind === 'daily') return D.addDays(anchor, r.interval * n);
    if (r.kind === 'monthly') return D.addMonths(anchor, r.interval * n, r.dom || null);
    return anchor;
  }

  /** How many occurrences fall in [anchor, t]. Ignores the end rule. */
  function rawCount(rule, anchor, t) {
    var r = typeof rule === 'string' ? parse(rule) : rule;
    if (t < anchor) return 0;
    if (r.kind === 'none') return 1;

    if (r.kind === 'daily') {
      // Closed-form candidate, then refined against exact timestamps so that
      // wall-clock time (not just the calendar day) decides inclusion.
      var n = Math.floor(D.diffDays(anchor, t) / r.interval);
      if (n > MAX_GUARD) n = MAX_GUARD;
      while (n > 0 && nth(r, anchor, n) > t) n--;
      while (n < MAX_GUARD && nth(r, anchor, n + 1) <= t) n++;
      return n + 1;
    }

    // Monthly: month lengths differ, so walk it (bounded).
    var k = 0;
    while (k < MAX_GUARD && nth(r, anchor, k + 1) <= t) k++;
    return k + 1;
  }

  /** Occurrences in [anchor, t], honouring the end rule. */
  function countUpTo(rule, anchor, end, t) {
    var e = normalizeEnd(end);
    var raw = rawCount(rule, anchor, t);
    if (e.mode === 'count') return Math.min(raw, e.n);
    if (e.mode === 'date') return Math.min(raw, rawCount(rule, anchor, e.at));
    return raw;
  }

  /**
   * All occurrences within [from, to] (inclusive), honouring the end rule.
   * `limit` bounds the work; results are ascending.
   */
  function occurrences(rule, anchor, end, from, to, limit) {
    var r = typeof rule === 'string' ? parse(rule) : rule;
    var e = normalizeEnd(end);
    var max = Math.max(1, limit || 400);
    var out = [];
    if (!anchor || to < anchor) return out;

    var cap = to;
    if (e.mode === 'date') cap = Math.min(cap, e.at);
    if (cap < anchor || cap < from) return out;

    if (r.kind === 'none') {
      if (anchor >= from && anchor <= cap) out.push(anchor);
      return out;
    }

    var startIdx = 0;
    if (from > anchor) startIdx = Math.max(0, rawCount(r, anchor, from - 1));
    if (e.mode === 'count' && startIdx >= e.n) return out;

    var i = startIdx;
    var guard = 0;
    while (guard++ <= max + 8) {
      var at = nth(r, anchor, i);
      if (at > cap) break;
      if (e.mode === 'count' && i >= e.n) break;
      if (at >= from) {
        out.push(at);
        if (out.length >= max) break;
      }
      i++;
    }
    return out;
  }

  /** First occurrence strictly after `from`, or null when the series is exhausted. */
  function next(rule, anchor, end, from) {
    var e = normalizeEnd(end);
    var horizon = from + 400 * D.DAY;
    if (e.mode === 'date') horizon = Math.min(horizon, e.at + D.DAY);
    var list = occurrences(rule, anchor, e, from + 1, horizon, 1);
    return list.length ? list[0] : null;
  }

  /**
   * Which occurrence should a "next reminder" use, given the ones already completed?
   * Returns the first occurrence >= from whose timestamp is not in `doneMap`.
   */
  function nextPending(rule, anchor, end, from, doneMap) {
    var e = normalizeEnd(end);
    var horizon = from + 400 * D.DAY;
    if (e.mode === 'date') horizon = Math.min(horizon, e.at + D.DAY);
    var list = occurrences(rule, anchor, e, from, horizon, 60);
    for (var i = 0; i < list.length; i++) {
      if (!doneMap || !doneMap[String(list[i])]) return list[i];
    }
    return null;
  }

  /** True when nothing more will ever occur after `from`. */
  function isExhausted(rule, anchor, end, from) {
    return next(rule, anchor, end, from) === null;
  }

  return {
    parse: parse, format: format, isRepeating: isRepeating, normalizeEnd: normalizeEnd,
    nth: nth, rawCount: rawCount, countUpTo: countUpTo,
    occurrences: occurrences, next: next, nextPending: nextPending, isExhausted: isExhausted
  };
});
