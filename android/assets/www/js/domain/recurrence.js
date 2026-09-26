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
    if (kind === 'WEEKLY') {
      var mask = parseInt(bits[2], 10);
      if (mask >= 1 && mask <= 127) {          // an empty mask would never occur ⇒ not a rule
        out.kind = 'weekly';
        out.interval = Math.max(1, parseInt(bits[1], 10) || 1);
        out.mask = mask;
      }
    } else if (kind === 'DAILY') {
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
    if (r.kind === 'weekly') return 'WEEKLY:' + (r.interval || 1) + ':' + (r.mask || 0);
    if (r.kind === 'daily') return 'DAILY:' + (r.interval || 1);
    if (r.kind === 'monthly') return 'MONTHLY:' + (r.interval || 1) + (r.dom ? ':' + r.dom : '');
    return 'NONE';
  }

  function isRepeating(rule) {
    var r = typeof rule === 'string' ? parse(rule) : rule;
    return !!r && r.kind !== 'none';
  }

  /** ISO weekday (1=Mon..7=Sun) ⇄ 7-bit mask helpers (bit iso-1). */
  function maskFromIsos(isos) {
    var m = 0;
    (isos || []).forEach(function (iso) {
      if (iso >= 1 && iso <= 7) m |= (1 << (iso - 1));
    });
    return m;
  }
  function isosFromMask(mask) {
    var out = [];
    for (var iso = 1; iso <= 7; iso++) if ((mask || 0) & (1 << (iso - 1))) out.push(iso);
    return out;
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

  /** The n-th occurrence (n = 0 is the anchor for daily/monthly, first weekly hit otherwise). */
  function nth(rule, anchor, n) {
    var r = typeof rule === 'string' ? parse(rule) : rule;
    if (r.kind === 'weekly') {
      if (!n || n <= 0) return weeklyNth(r, anchor, 0);
      return weeklyNth(r, anchor, n);
    }
    if (!n || n <= 0) return anchor;
    if (r.kind === 'daily') return D.addDays(anchor, r.interval * n);
    if (r.kind === 'monthly') return D.addMonths(anchor, r.interval * n, r.dom || null);
    return anchor;
  }

  function mondayOf(ms) {
    var p = D.parts(ms);
    return D.startOfDay(D.addDays(ms, -((p.iso - 1) % 7)));
  }

  /** True when `ms` lies on an active week of a weekly rule (anchor week + k*interval). */
  function onActiveWeek(r, anchor, ms) {
    var kw = D.diffDays(mondayOf(anchor), mondayOf(ms)) / 7;
    if (kw < 0 || kw % 1 !== 0) return false;
    return kw % (r.interval || 1) === 0;
  }

  function isWeeklyHit(r, anchor, ms) {
    if (!((r.mask || 0) & (1 << (D.parts(ms).iso - 1)))) return false;
    if (D.startOfDay(ms) < D.startOfDay(anchor)) return false;
    return onActiveWeek(r, anchor, ms);
  }

  /** n-th weekly occurrence (n = 0 is the first hit at/after the anchor). */
  function weeklyNth(r, anchor, n) {
    var cur = D.startOfDay(anchor);
    var seen = -1;
    var guard = 0;
    while (guard++ < 4000) {
      if (isWeeklyHit(r, anchor, cur)) {
        seen++;
        if (seen === n) return cur + (anchor - D.startOfDay(anchor));
      }
      cur = D.addDays(cur, 1);
    }
    return null;
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

    if (r.kind === 'weekly') {
      var w = 0;
      var day = D.startOfDay(anchor);
      var endDay = D.startOfDay(t);
      var timeOfDay = anchor - D.startOfDay(anchor);
      var guardW = 0;
      while (day <= endDay && guardW++ < 4000) {
        if (isWeeklyHit(r, anchor, day)) {
          if (day + timeOfDay <= t) w++;
        }
        day = D.addDays(day, 1);
      }
      return w;
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

    if (r.kind === 'weekly') {
      var dayW = D.startOfDay(Math.max(from, anchor));
      var capDay = D.startOfDay(cap);
      var todW = anchor - D.startOfDay(anchor);
      var guardWW = 0;
      // occurrences already spent before `from` count against an end-by-count rule
      var consumedW = (e.mode === 'count' && from > anchor) ? rawCount(r, anchor, from - 1) : 0;
      while (dayW <= capDay && guardWW++ < 4000) {
        if (isWeeklyHit(r, anchor, dayW)) {
          var atW = dayW + todW;
          if (atW >= from && atW <= cap) {
            if (e.mode === 'count' && consumedW + out.length >= e.n) break;
            out.push(atW);
            if (out.length >= max) break;
          }
        }
        dayW = D.addDays(dayW, 1);
      }
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
    maskFromIsos: maskFromIsos, isosFromMask: isosFromMask, mondayOf: mondayOf,
    nth: nth, rawCount: rawCount, countUpTo: countUpTo,
    occurrences: occurrences, next: next, nextPending: nextPending, isExhausted: isExhausted
  };
});
