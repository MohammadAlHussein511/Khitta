/* platform/bridge.js — the single doorway to Android.
 *
 * Every call is defensive: if the WebView bridge is absent (plain browser, e.g. the QC
 * harness) the module reports `available:false` and callers fall back to web APIs.
 */
(function (root, factory) {
  var K = root.K = root.K || {};
  K.bridge = factory(K.util);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U) {
  'use strict';

  var native = null;
  try {
    if (typeof window !== 'undefined' && window.NativeBridge && typeof window.NativeBridge.hello === 'function') {
      native = window.NativeBridge;
      native.hello(); // smoke-test the interface before trusting it
    }
  } catch (e) {
    native = null;
  }

  var available = !!native;

  function call(method, args, fallback) {
    if (!native || typeof native[method] !== 'function') return fallback;
    try {
      return native[method].apply(native, args || []);
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[bridge] ' + method + ' failed:', e);
      return fallback;
    }
  }

  function json(str, fallback) {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch (e) { return fallback; }
  }

  var WEB_INFO = {
    versionName: 'web', versionCode: 0, sdkInt: 0,
    model: 'browser', manufacturer: 'web', lang: 'ar', bridge: 0
  };

  return {
    available: available,

    appInfo: function () {
      return available ? json(call('appInfo', [], null), WEB_INFO) : WEB_INFO;
    },

    loadState: function () {
      return available ? String(call('loadState', [], '') || '') : '';
    },

    saveState: function (str) {
      return available ? !!call('saveState', [str], false) : false;
    },

    storageBytes: function () {
      return available ? Number(call('storageBytes', [], 0) || 0) : 0;
    },

    hasBackup: function () {
      return available ? !!call('hasBackup', [], false) : false;
    },

    scheduleAll: function (payloadJson) {
      return available ? !!call('scheduleAll', [payloadJson], false) : false;
    },

    cancelAllAlarms: function () {
      return available ? !!call('cancelAllAlarms', [], false) : false;
    },

    alarmState: function () {
      var fallback = { canExact: false, notificationsEnabled: false, notificationsDenied: false, armed: 0 };
      if (!available) return fallback;
      var o = json(call('alarmState', [], null), fallback);
      return {
        canExact: !!o.canExact,
        notificationsEnabled: !!o.notificationsEnabled,
        notificationsDenied: !!o.notificationsDenied,
        armed: Number(o.armed || 0)
      };
    },

    testReminder: function (payloadJson) {
      return available ? !!call('testReminder', [payloadJson], false) : false;
    },

    applyChrome: function (payloadJson) {
      call('applyChrome', [payloadJson], undefined);
    },

    setBackIntercept: function (on) {
      call('setBackIntercept', [!!on], undefined);
    },

    vibrate: function (ms) {
      if (available) { call('vibrate', [ms | 0], undefined); return; }
      try { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* noop */ }
    },

    requestNotificationPermission: function () {
      call('requestNotificationPermission', [], undefined);
    },

    openSystemSettings: function (kind) {
      call('openSystemSettings', [String(kind || 'notifications')], undefined);
    },

    startImport: function () {
      call('startImport', [], undefined);
    },

    exportBackup: function (jsonStr, fileName) {
      return available ? String(call('exportBackup', [jsonStr, fileName], '') || '') : '';
    },

    consumeLaunchPayload: function () {
      return available ? json(call('consumeLaunchPayload', [], ''), null) : null;
    },

    closeApp: function () {
      call('closeApp', [], undefined);
    }
  };
});
