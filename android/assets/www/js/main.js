/* main.js — bootstrap. Everything above is declarative until this runs. */
(function () {
  'use strict';

  function start() {
    try {
      window.K.app.boot();
    } catch (e) {
      // Never leave the user with a blank screen: show the failure and keep the data intact.
      var view = document.getElementById('view');
      if (view) {
        view.innerHTML = '';
        var box = document.createElement('div');
        box.className = 'empty-state';
        box.style.padding = '40px 24px';
        box.innerHTML = '<h3 style="color:var(--danger)">Startup error</h3>'
          + '<p class="mono" style="font-size:12px;word-break:break-word">'
          + String(e && e.message ? e.message : e) + '</p>';
        view.appendChild(box);
      }
      if (typeof console !== 'undefined') console.error('[khitta] boot failed', e);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
