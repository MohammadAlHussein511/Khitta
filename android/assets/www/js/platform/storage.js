/* platform/storage.js — persistence backend selection.
 *
 * On Android the document lives in the app-private internal storage (written atomically by
 * the native layer, with a one-generation backup). In a plain browser it falls back to
 * localStorage so the very same code can be exercised by the QC harness.
 */
(function (root, factory) {
  var K = root.K = root.K || {};
  K.storage = factory(K.bridge, K.util);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (bridge, U) {
  'use strict';

  var LS_KEY = 'khitta.state.v1';
  var backend = bridge.available ? 'native' : 'local';
  var lastError = null;

  function ls() {
    try { return (typeof localStorage !== 'undefined') ? localStorage : null; } catch (e) { return null; }
  }

  function read() {
    lastError = null;
    if (backend === 'native') {
      var s = bridge.loadState();
      if (s && s.length) return s;
      // First run, or an unreadable document: fall through to an empty state.
      return '';
    }
    var store = ls();
    try { return store ? (store.getItem(LS_KEY) || '') : ''; }
    catch (e) { lastError = 'read:' + e.message; return ''; }
  }

  function write(json) {
    lastError = null;
    if (backend === 'native') {
      var ok = bridge.saveState(json);
      if (!ok) lastError = 'native-write-rejected';
      // Mirror into localStorage as a second copy: costs nothing and gives a recovery
      // path if the private file is ever cleared by the platform.
      var store = ls();
      if (store) { try { store.setItem(LS_KEY, json); } catch (e) { /* quota — ignore */ } }
      return ok;
    }
    var s = ls();
    if (!s) { lastError = 'no-storage'; return false; }
    try { s.setItem(LS_KEY, json); return true; }
    catch (e) { lastError = 'write:' + e.message; return false; }
  }

  function bytes() {
    if (backend === 'native') return bridge.storageBytes();
    var store = ls();
    try { return store ? (store.getItem(LS_KEY) || '').length : 0; } catch (e) { return 0; }
  }

  function clear() {
    var store = ls();
    if (store) { try { store.removeItem(LS_KEY); } catch (e) { /* ignore */ } }
    if (backend === 'native') bridge.saveState('');
  }

  return {
    get backend() { return backend; },
    get lastError() { return lastError; },
    setBackend: function (b) { backend = b; },
    KEY: LS_KEY,
    read: read, write: write, bytes: bytes, clear: clear
  };
});
