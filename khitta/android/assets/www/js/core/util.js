/* core/util.js — tiny pure helpers shared by every layer. */
(function (root, factory) {
  var api = factory();
  root.K = root.K || {};
  root.K.util = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MINUTE = 60 * 1000;
  var HOUR = 60 * MINUTE;
  var DAY = 24 * HOUR;

  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }

  function uid(prefix) {
    var s = '';
    var alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
    for (var i = 0; i < 7; i++) s += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    return (prefix || 't') + '_' + s + Date.now().toString(36).slice(-3);
  }

  /** Deterministic 31-bit hash — used for stable ids in tests and for alarm codes. */
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < String(str).length; i++) {
      h ^= String(str).charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function debounce(fn, wait) {
    var t = null;
    var wrapped = function () {
      var args = arguments, self = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, wait);
    };
    wrapped.flush = function () { if (t) { clearTimeout(t); t = null; fn(); } };
    wrapped.cancel = function () { if (t) { clearTimeout(t); t = null; } };
    return wrapped;
  }

  /** Coalesce calls into one per animation frame. */
  function raf(fn) {
    var queued = false, lastArgs = null;
    return function () {
      lastArgs = arguments;
      if (queued) return;
      queued = true;
      (root.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
        queued = false;
        fn.apply(null, lastArgs);
      });
    };
  }

  function sortBy(list, fn) {
    return list.slice().sort(function (a, b) {
      var x = fn(a), y = fn(b);
      return x < y ? -1 : (x > y ? 1 : 0);
    });
  }

  function groupBy(list, fn) {
    var out = {};
    for (var i = 0; i < list.length; i++) {
      var k = fn(list[i]);
      (out[k] || (out[k] = [])).push(list[i]);
    }
    return out;
  }

  function sum(list, fn) {
    var t = 0;
    for (var i = 0; i < list.length; i++) t += fn ? fn(list[i]) : list[i];
    return t;
  }

  function moveItem(list, from, to) {
    var copy = list.slice();
    if (from === to || from < 0 || from >= copy.length) return copy;
    var it = copy.splice(from, 1)[0];
    copy.splice(clamp(to, 0, copy.length), 0, it);
    return copy;
  }

  /** Fractional rank between two neighbours — the basis of O(1) drag reordering. */
  function midpoint(prev, next, step) {
    var s = step || 1024;
    if (prev == null && next == null) return s;
    if (prev == null) return next - s;
    if (next == null) return prev + s;
    if (next - prev < 1e-3) return null; // needs normalisation
    return (prev + next) / 2;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Object]';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatBytes(n) {
    if (!n) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function pct(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
  }

  return {
    MINUTE: MINUTE, HOUR: HOUR, DAY: DAY,
    clamp: clamp, uid: uid, hash: hash, pad2: pad2,
    debounce: debounce, raf: raf, sortBy: sortBy, groupBy: groupBy, sum: sum,
    moveItem: moveItem, midpoint: midpoint, clone: clone,
    isPlainObject: isPlainObject, escapeHtml: escapeHtml,
    formatBytes: formatBytes, pct: pct
  };
});
