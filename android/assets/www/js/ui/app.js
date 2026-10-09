/* ui/app.js — application shell: navigation, theming, language/RTL, window insets,
 * native callbacks and the store subscription that drives rendering. */
(function (root, factory) {
  var K = root.K = root.K || {};
  K.views = K.views || {};
  var api = factory(K.util, K.dom, K.date, K.i18n, K.model, K.matrix, K.week, K.stats, K.store, K.notify, K.ui, K.bridge, K.views);
  K.app = api;
  K.views.app = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, DOM, D, I, M, MX, WK, S, store, notify, W, bridge, views) {
  'use strict';

  var el = DOM.el, icon = DOM.svgIcon;

  var TABS = [
    { id: 'matrix', icon: 'grid' },
    { id: 'week', icon: 'calendar' },
    { id: 'stats', icon: 'chart' },
    { id: 'settings', icon: 'sliders' }
  ];

  var active = 'matrix';
  var booted = false;
  var mountedViews = {};
  var els = {};
  var insets = { t: 0, r: 0, b: 0, l: 0, ime: 0 };
  var ticker = null;
  var alarmTicker = null;

  // ------------------------------------------------------------------ chrome

  /**
   * Android hands window insets over the bridge in PHYSICAL pixels, while CSS works in
   * device-independent pixels. On a 3x display the old code padded the top bar with three
   * times the status-bar height (the blank strip seen on real devices) and tripled the
   * keyboard height (the collapsed editor sheet). Divide by devicePixelRatio, then clamp
   * to sane bounds so a misreport can never wreck the layout again.
   */
  var rawInsets = { t: 0, r: 0, b: 0, l: 0, ime: 0 };   // physical px, as Android reports them

  function setInsets(t, r, b, l, ime) {
    rawInsets = { t: t | 0, r: r | 0, b: b | 0, l: l | 0, ime: ime | 0 };
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    if (!(dpr > 0)) dpr = 1;
    var px = function (v, cap) { return U.clamp(Math.round(v / dpr), 0, cap); };
    insets = { t: px(rawInsets.t, 120), r: px(rawInsets.r, 120), b: px(rawInsets.b, 120), l: px(rawInsets.l, 120), ime: px(rawInsets.ime, 1400) };
    var rs = document.documentElement.style;
    var rtl = I.isRtl();
    rs.setProperty('--sat', insets.t + 'px');
    rs.setProperty('--sab', insets.b + 'px');
    rs.setProperty('--sal', insets.l + 'px');
    rs.setProperty('--sar', insets.r + 'px');
    rs.setProperty('--ime', insets.ime + 'px');
    rs.setProperty('--sa-start', (rtl ? insets.r : insets.l) + 'px');
    rs.setProperty('--sa-end', (rtl ? insets.l : insets.r) + 'px');
  }

  function resolvedDark() {
    var pref = store.settings().theme;
    if (pref === 'dark') return true;
    if (pref === 'light') return false;
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
  }

  /** User-customisable Eisenhower palette + tag skins, applied as root custom properties. */
  function applyPalette() {
    var st = store.settings();
    var dark = resolvedDark();
    var pal = st.palette || U.DEFAULT_PALETTE[dark ? 'dark' : 'light'];
    var surface = dark ? '#14171f' : '#ffffff';
    var text = dark ? '#eef0f6' : '#12141a';
    var rs = document.documentElement.style;
    for (var i = 1; i <= 4; i++) {
      var c = pal['q' + i] || U.DEFAULT_PALETTE.light['q' + i];
      rs.setProperty('--q' + i, c);
      rs.setProperty('--q' + i + '-soft', U.mixHex(c, surface, dark ? 0.24 : 0.13));
      rs.setProperty('--q' + i + '-ink', U.mixHex(c, text, dark ? 0.62 : 0.74));
    }
    document.documentElement.setAttribute('data-tagstyle', st.tagStyle || 'soft');
    rs.setProperty('--tag-alpha', String(((st.tagAlpha == null ? 16 : st.tagAlpha) / 100)));
  }

  /** V2.4: the app name is fixed to the localised product name (no user override). */
  function applyBrand() {
    var name = I.t('app.name');
    if (els.brandTitle) els.brandTitle.textContent = name;
    document.title = name;
  }

  function applyTheme() {
    var dark = resolvedDark();
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0b0d12' : '#f5f6fa');
    if (bridge.applyChrome) {
      bridge.applyChrome(JSON.stringify({ theme: dark ? 'dark' : 'light', lang: I.getLang() }));
    }
    applyPalette();
    var btn = els.btnTheme;
    if (btn) {
      DOM.clear(btn);
      btn.appendChild(icon(dark ? 'sun' : 'moon'));
      btn.setAttribute('aria-label', I.t(dark ? 'settings.theme.light' : 'settings.theme.dark'));
    }
  }

  function applyLang() {
    var lang = store.settings().lang;
    I.setLang(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = I.dir();
    document.title = I.t('app.name');
    // re-map logical safe areas from the RAW values (re-dividing the converted ones
    // would shrink the top padding and push the header under the status bar)
    setInsets(rawInsets.t, rawInsets.r, rawInsets.b, rawInsets.l, rawInsets.ime);

    if (els.brandTitle) els.brandTitle.textContent = I.t('app.name');
    if (els.brandSub) els.brandSub.textContent = I.t('topbar.today', { date: I.fmtDate(Date.now()) });
    if (els.btnLang) {
      DOM.clear(els.btnLang);
      els.btnLang.appendChild(el('span', { class: 'lang-tag', text: lang === 'ar' ? 'EN' : 'ع' }));
      els.btnLang.setAttribute('aria-label', I.t('settings.language'));
    }
    TABS.forEach(function (t) {
      if (els.tabLabels[t.id]) els.tabLabels[t.id].textContent = I.t('nav.' + t.id);
      if (els.tabButtons[t.id]) els.tabButtons[t.id].setAttribute('aria-label', I.t('nav.' + t.id));
    });
    Object.keys(mountedViews).forEach(function (id) {
      if (mountedViews[id] && mountedViews[id].relayout) mountedViews[id].relayout();
    });
    pushQuote();          // banner text is locale-derived: repaint after relayout
    applyTheme();
    applyBrand();
    render('lang');
  }

  // ------------------------------------------------------------------ tabs

  function buildTabbar() {
    var bar = document.getElementById('tabbar');
    DOM.clear(bar);
    els.tabButtons = {};
    els.tabLabels = {};
    els.tabBadges = {};
    TABS.forEach(function (t) {
      var label = el('span', { class: 'tab-label', text: I.t('nav.' + t.id) });
      var badge = el('span', { class: 'tab-badge num', text: '0', hidden: true });
      var btn = el('button', {
        class: 'tab', type: 'button', role: 'tab',
        'data-tab': t.id, 'aria-selected': String(t.id === active), 'aria-label': I.t('nav.' + t.id)
      }, [icon(t.icon), label, badge]);
      btn.addEventListener('click', function () {
        go(t.id, TAB_ORDER.indexOf(t.id) > TAB_ORDER.indexOf(active) ? 'next' : 'prev');
      });
      els.tabButtons[t.id] = btn;
      els.tabLabels[t.id] = label;
      els.tabBadges[t.id] = badge;
      bar.appendChild(btn);
    });
  }

  var TAB_ORDER = ['matrix', 'week', 'stats', 'settings'];

  var lastQuoteIndex = -1;

  /**
   * One physical gesture produces BOTH touch and pointer event streams on Android; without a
   * lock each stream committed its own page step (the reported "skips a page" behaviour).
   * The first recogniser to commit wins; the other is ignored for 150 ms.
   */
  var navLockAt = 0;
  function commitNav(fn) {
    var now = Date.now();
    if (now - navLockAt < 150) return false;
    navLockAt = now;
    fn();
    return true;
  }

  /**
   * The swipe container is indexed 1:1 by the bottom navigation bar:
   *   swipe RIGHT ⇒ index + 1 (the next tab), swipe LEFT ⇒ index − 1 (the previous tab),
   * and the bar's active state updates on every page change.
   */

  /**
   * Global horizontal swipe navigation with explicit gesture arbitration.
   *
   * V2.2 fix: swipes now START on content (task rows, cards, chips of the day strip…) —
   * previously those elements were excluded, so on a real device every natural swipe
   * began on a task and was ignored. Arbitration rules:
   *   • a horizontal movement detected early (|dx| ≥ 14px, |dx| ≥ 2·|dy|, < 280 ms,
   *     or a decisively horizontal |dx| ≥ 50px) CLAIMS the gesture for navigation;
   *   • the drag & drop engine only starts after a 300 ms long-press (or from the grip,
   *     which stays excluded here), and once a drag session is active navigation never
   *     claims — so the two gestures cannot fight;
   *   • interactive controls (buttons, inputs, switches, grips) still swallow the swipe.
   */
  function attachSwipe() {
    var viewEl = document.getElementById('view');
    if (!viewEl) return;
    var tr = null;
    viewEl.addEventListener('pointerdown', function (e) {
      if (W.sheetCount() || K.dnd.active) return;
      if (e.target.closest('button, input, textarea, select, a, .task-grip, .switch, .segmented, .fab, .tab, .nav-btn, .dt-btn, .step-btn')) return;
      tr = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0, t: Date.now(), claimed: false };
    }, { passive: true });
    viewEl.addEventListener('pointermove', function (e) {
      if (!tr || e.pointerId !== tr.id) return;
      tr.dx = e.clientX - tr.x;
      tr.dy = e.clientY - tr.y;
      if (tr.claimed) return;
      var adx = Math.abs(tr.dx), ady = Math.abs(tr.dy);
      var early = (Date.now() - tr.t) < 280;
      if (!K.dnd.active && adx >= 14 && adx >= 2 * ady && (early || adx >= 50)) {
        tr.claimed = true;
        // views ignore the click that ends a navigation swipe
        document.body.dataset.navswipe = String(Date.now());
      }
    }, { passive: true });
    function end(e, cancelled) {
      if (!tr || e.pointerId !== tr.id) { tr = null; return; }
      var dx = tr.dx, dy = tr.dy;
      var claimed = tr.claimed;
      tr = null;
      if (cancelled || !claimed) return;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      var i = TAB_ORDER.indexOf(active);
      commitNav(function () {
        if (dx > 0) {
          if (i < TAB_ORDER.length - 1) go(TAB_ORDER[i + 1], 'next');
        } else if (i > 0) {
          go(TAB_ORDER[i - 1], 'prev');
        }
      });
    }
    viewEl.addEventListener('pointerup', function (e) { end(e, false); }, { passive: true });
    viewEl.addEventListener('pointercancel', function (e) { end(e, true); }, { passive: true });

    /*
     * Touch path (the one real phones use): horizontal swipes are given EXPLICIT priority
     * over inner vertical scrollers — once a horizontal intent is detected we preventDefault
     * the touchmove so no list can swallow or steal the gesture, then navigate on touchend.
     * Drag & drop keeps owning its own gestures (long-press / grip), checked live below.
     */
    var ttr = null;
    window.addEventListener('touchstart', function (e) {
      ttr = null;
      if (W.sheetCount() || K.dnd.active || e.touches.length !== 1) return;
      var t = e.target;
      if (t && t.closest && t.closest('button, input, textarea, select, a, .task-grip, .switch, .segmented, .fab, .tab, .nav-btn, .dt-btn, .step-btn')) return;
      var touch = e.touches[0];
      ttr = { id: touch.identifier, x: touch.clientX, y: touch.clientY, dx: 0, claimed: false };
    }, { passive: true });
    window.addEventListener('touchmove', function (e) {
      if (!ttr) return;
      var touch = null;
      for (var i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === ttr.id) touch = e.touches[i];
      }
      if (!touch) { ttr = null; return; }
      var dx = touch.clientX - ttr.x;
      var dy = touch.clientY - ttr.y;
      var adx = Math.abs(dx), ady = Math.abs(dy);
      if (!ttr.claimed) {
        if (K.dnd.active) { ttr = null; return; }        // a drag session owns this gesture
        if (adx >= 14 && adx >= 1.6 * ady) {
          ttr.claimed = true;
          document.body.dataset.navswipe = String(Date.now());
        }
      }
      if (ttr.claimed) {
        ttr.dx = dx;
        e.preventDefault();                              // horizontal navigation wins over scroll
      }
    }, { passive: false });
    window.addEventListener('touchend', function () {
      if (!ttr) return;
      var claimed = ttr.claimed, dx = ttr.dx;
      ttr = null;
      if (!claimed || Math.abs(dx) < 50) return;
      document.body.dataset.navswipe = String(Date.now());
      var i = TAB_ORDER.indexOf(active);
      commitNav(function () {
        if (dx > 0) {
          if (i < TAB_ORDER.length - 1) go(TAB_ORDER[i + 1], 'next');
        } else if (i > 0) {
          go(TAB_ORDER[i - 1], 'prev');
        }
      });
    }, { passive: true });
  }

  function go(id, slideMode) {
    if (!id) return;
    var prev = active;
    active = id;
    TABS.forEach(function (t) {
      var screen = document.getElementById('screen-' + t.id);
      if (screen) screen.hidden = t.id !== id;
      if (els.tabButtons[t.id]) els.tabButtons[t.id].setAttribute('aria-selected', String(t.id === id));
    });
    var view = views[id];
    if (view) {
      var host = document.getElementById('screen-' + id);
      if (!mountedViews[id] && host) {
        view.mount(host);
        mountedViews[id] = view;
        if (view.setQuoteIndex && lastQuoteIndex >= 0) view.setQuoteIndex(lastQuoteIndex);
      }
      view.render(store.get(), Date.now());
    }
    els.fab.hidden = (id === 'settings');
    updateBackIntercept();
    render('nav');
    if (prev !== id) {
      var dir = slideMode || (TAB_ORDER.indexOf(id) > TAB_ORDER.indexOf(prev) ? 'next' : 'prev');
      var inEl = document.getElementById('screen-' + id);
      if (inEl && DOM.animate) {
        // the incoming page follows the finger: swipe right ⇒ enters from the left edge
        var sgn = dir === 'next' ? -1 : 1;
        DOM.animate(inEl, [
          { transform: 'translateX(' + (sgn * 18) + '%)', opacity: 0.2 },
          { transform: 'none', opacity: 1 }
        ], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    }
  }

  // -------------------------------------------------------------- date rollover
  var dayKey = D.dayKey(Date.now());

  /**
   * Strict date-based reactivity: when the system date changes (midnight rollover,
   * timezone/clock edits) the UI drops the previous day and loads the new current day —
   * including fresh instances of daily recurrences — and the alarm schedule is re-armed.
   */
  function checkDateRollover() {
    var k = D.dayKey(Date.now());
    if (k === dayKey) return false;
    dayKey = k;
    if (views.week && views.week.onDateChanged) views.week.onDateChanged();
    store.syncAlarms();
    render('dayroll');
    if (mountedViews.stats) mountedViews.stats.render(store.get(), Date.now());
    if (mountedViews.settings) mountedViews.settings.render(store.get(), Date.now());
    // V2.4.6: visible confirmation that the new day was loaded — at midnight in the
    // foreground, or the moment the app resumes after a night in the background.
    W.toast(I.t('toast.newDay'), { icon: 'calendar', duration: 3000 });
    return true;
  }

  /** Fires ~0.5 s after local midnight, then re-arms itself for the next night. */
  function scheduleMidnight() {
    var now = Date.now();
    var next = D.startOfDay(now) + D.DAY;
    setTimeout(function () {
      checkDateRollover();
      scheduleMidnight();
    }, Math.max(1000, next - now + 500));
  }

  /**
   * A new motivational phrase per launch AND per re-entry, never repeating the last.
   * Only the INDEX is stored; the text is always derived from the ACTIVE locale's array,
   * so reverting the language re-renders the banner in the correct language.
   */
  function refreshQuote() {
    var q = I.pickQuote(store.settings().lastQuote);
    store.setSetting('lastQuote', q.index);
    lastQuoteIndex = q.index;
    pushQuote();
  }

  function pushQuote() {
    if (lastQuoteIndex < 0) return;
    if (mountedViews.matrix && mountedViews.matrix.setQuoteIndex) mountedViews.matrix.setQuoteIndex(lastQuoteIndex);
    if (mountedViews.week && mountedViews.week.setQuoteIndex) mountedViews.week.setQuoteIndex(lastQuoteIndex);
  }

  function updateBackIntercept() {
    if (!bridge.setBackIntercept) return;
    bridge.setBackIntercept(W.sheetCount() > 0 || active !== 'matrix');
  }

  // ------------------------------------------------------------------ render

  function updateBadges(state, now) {
    var n = now || Date.now();
    var bounds = WK.weekBounds(n, 0, state.settings.weekStart);
    var idx = WK.weekIndexOfToday(bounds, n);
    var todayPlan = WK.dayPlan(state, bounds.days[idx >= 0 ? idx : 0], n);
    setBadge('week', todayPlan.pendingCount);

    var overdue = 0;
    for (var i = 0; i < state.tasks.length; i++) {
      if (!state.tasks[i].closedAt && M.overdueSince(state.tasks[i], n, 60) != null) overdue++;
    }
    setBadge('matrix', overdue);
  }

  function setBadge(tab, count) {
    var b = els.tabBadges && els.tabBadges[tab];
    if (!b) return;
    b.hidden = !count;
    b.textContent = count > 99 ? '99+' : String(count);
  }

  function render(reason) {
    var state = store.get();
    var now = Date.now();
    if (els.brandSub) els.brandSub.textContent = I.t('topbar.today', { date: I.fmtDate(now) });
    updateBadges(state, now);
    var view = views[active];
    if (view && mountedViews[active]) view.render(state, now);
    if (reason === 'alarms' && mountedViews.settings && active === 'settings') {
      mountedViews.settings.render(state, now);
    }
  }

  // ------------------------------------------------------------------ actions

  function addTask() {
    var quadrant = 'q1';
    var due;
    if (active === 'week') {
      if (views.week.isReadonlyNow && views.week.isReadonlyNow(Date.now())) views.week.showPastModal();
      else views.week.addOnSelectedDay();
      return;
    }
    due = M.defaultDue(Date.now(), store.settings());
    views.editor.open({ quadrant: quadrant, dueAt: due });
  }

  function toggleLang() {
    var next = store.settings().lang === 'ar' ? 'en' : 'ar';
    store.setSetting('lang', next);
    bridge.vibrate(8);
    W.toast(I.t('toast.langChanged'), { icon: 'globe' });
  }

  function cycleTheme() {
    var order = ['system', 'light', 'dark'];
    var cur = store.settings().theme;
    var next = order[(order.indexOf(cur) + 1) % order.length];
    store.setSetting('theme', next);
    bridge.vibrate(8);
  }

  // ------------------------------------------------------------------ onboarding

  function onboarding() {
    var sheet = W.openSheet({
      title: I.t('onb.title'),
      sub: I.t('app.tagline'),
      body: [
        el('div', { class: 'onb' }, [
          el('div', { class: 'onb-hero' }, [
            el('h2', { text: I.t('onb.title') }),
            el('p', { text: I.t('onb.body') })
          ]),
          el('div', { class: 'onb-list' }, [
            ['item1', 'grid'], ['item2', 'calendar'], ['item3', 'bell']
          ].map(function (pair) {
            return el('div', { class: 'onb-item' }, [
              icon(pair[1]),
              el('div', {}, [
                el('b', { text: I.t('onb.' + pair[0] + '.t') }),
                el('span', { text: I.t('onb.' + pair[0] + '.d') })
              ])
            ]);
          })),
          bridge.available ? el('div', { class: 'onb-item', style: { background: 'var(--brand-soft)' } }, [
            icon('bell'),
            el('div', { class: 'grow' }, [
              el('b', { text: I.t('onb.notifTitle') }),
              el('span', { text: I.t('onb.notifBody') })
            ]),
            el('button', {
              class: 'btn btn-primary btn-sm', type: 'button', text: I.t('onb.allow'),
              onClick: function () { notify.requestPermission(); }
            })
          ]) : null
        ])
      ],
      footer: [
        el('button', {
          class: 'btn btn-primary btn-block', type: 'button', text: I.t('onb.start'),
          onClick: function () { sheet.close(); }
        })
      ]
    });
    store.setSetting('onboardingDone', true);
  }

  // ------------------------------------------------------------------ boot

  function boot() {
    if (booted) return;
    booted = true;

    store.init();
    I.setLang(store.settings().lang);
    document.documentElement.lang = I.getLang();
    document.documentElement.dir = I.dir();

    els.brandTitle = document.getElementById('brandTitle');
    els.brandSub = document.getElementById('brandSub');
    els.btnLang = document.getElementById('btnLang');
    els.btnTheme = document.getElementById('btnTheme');
    els.fab = document.getElementById('fab');

    buildTabbar();
    applyTheme();
    applyPalette();
    applyBrand();
    attachSwipe();

    els.btnLang.addEventListener('click', toggleLang);
    els.btnTheme.addEventListener('click', cycleTheme);
    els.fab.addEventListener('click', addTask);

    store.subscribe(function (state, reason) {
      if (reason === 'settings') { applyTheme(); applyBrand(); }
      updateBackIntercept();
      // a completion animation may be holding the render so the row can celebrate first
      var hold = Number(document.body.dataset.renderhold || 0) - Date.now();
      if (hold > 0) setTimeout(function () { render(reason); }, hold + 40);
      else render(reason);
      if (reason === 'alarms' && mountedViews.settings) mountedViews.settings.render(state, Date.now());
    });

    // language switch is applied from setSetting('lang') → I.setLang happens in the store,
    // so mirror the chrome here as well
    var lastLang = store.settings().lang;
    store.subscribe(function (state) {
      if (state.settings.lang !== lastLang) {
        lastLang = state.settings.lang;
        applyLang();
      }
    });

    applyLang();     // labels + RTL first, so the initial mount is already correct
    go('matrix');
    refreshQuote();  // home-screen banner gets this launch's phrase

    // keep relative labels and overdue state fresh, and catch the date flip
    ticker = setInterval(function () { checkDateRollover(); render('tick'); }, 60000);
    scheduleMidnight();
    alarmTicker = setInterval(function () { store.syncAlarms(); }, 30 * 60000);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) store.flush();
      else {
        syncFromDisk();
        checkDateRollover();   // resumed after midnight? reload the new day at once
        refreshQuote();        // re-entering the app greets the user with a fresh phrase
      }
    });
    window.addEventListener('pagehide', function () { store.flush(); });

    // V2.4.4 (Bug 1): additional resume signals. Not every WebView fires visibilitychange
    // when the activity resumes, and a bfcache restore skips it entirely — the date
    // watchdog must not depend on a single event. Both listeners run the SAME idempotent
    // check (current date vs last rendered date); within one day they cost one string
    // comparison and return.
    window.addEventListener('pageshow', function () { checkDateRollover(); });
    window.addEventListener('focus', function () { checkDateRollover(); });

    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
        if (store.settings().theme === 'system') applyTheme();
      });
    } catch (e) { /* older engines */ }

    var payload = bridge.consumeLaunchPayload ? bridge.consumeLaunchPayload() : null;
    if (payload && payload.taskId) handleLaunchPayload(payload);

    if (!store.settings().onboardingDone) {
      setTimeout(onboarding, 420);
    } else if (bridge.available) {
      var st = notify.status(store.get());
      if (!st.notificationsEnabled && !st.notificationsDenied) {
        setTimeout(function () { notify.requestPermission(); }, 900);
      }
    }

    var info = store.stats();
    if (info.restoredFromBackup) {
      W.toast(I.t('toast.imported'), { icon: 'info', duration: 4000 });
    }
  }

  // ------------------------------------------------------------------ native callbacks

  function handleLaunchPayload(payload) {
    if (!payload || !payload.taskId) return;
    var task = store.taskById(payload.taskId);
    if (!task) { go('week'); return; }
    go('week');
    var at = payload.occAt || task.dueAt;
    if (views.week.focusDay) views.week.focusDay(at);
  }

  function onLaunchPayload(json) {
    var payload = null;
    try { payload = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { payload = null; }
    handleLaunchPayload(payload);
  }

  function syncFromDisk() {
    if (!bridge.available) return;
    var langBefore = store.settings().lang;
    var ok = store.reloadFromDisk();
    if (!ok) return;
    if (store.settings().lang !== langBefore) applyLang();
    // V2.4.4 (Bug 1): this is the native onResume path — the ONLY lifecycle signal that
    // is guaranteed on Android (JS timers are frozen while web.onPause() is in effect and
    // visibilitychange is unreliable across WebViews). Compare the current system date
    // with the last rendered date here too, so resuming after midnight rebuilds the new
    // day's screen (fresh recurrence instances included) instead of waiting for a
    // manual tab switch. checkDateRollover is idempotent — a no-op within the same day.
    checkDateRollover();
    applyTheme();
    render('sync');
    if (mountedViews.settings) mountedViews.settings.render(store.get(), Date.now());
  }

  function reloadFromDisk() { syncFromDisk(); }

  function flush() { store.flush(); }

  function onBack() {
    if (W.handleBack()) { updateBackIntercept(); return; }
    if (active !== 'matrix') { go('matrix'); return; }
    if (bridge.closeApp) bridge.closeApp();
  }

  function onPermissionResult(kind, granted) {
    if (kind !== 'notifications') return;
    if (granted) {
      store.syncAlarms();
      W.toast(I.t('settings.notifPermission.granted'), { icon: 'check' });
    }
    if (mountedViews.settings) mountedViews.settings.render(store.get(), Date.now());
  }

  return {
    boot: boot, go: go, render: render,
    setInsets: setInsets, applyTheme: applyTheme, applyLang: applyLang,
    updateBackIntercept: updateBackIntercept,
    onLaunchPayload: onLaunchPayload, syncFromDisk: syncFromDisk, reloadFromDisk: reloadFromDisk,
    flush: flush, onBack: onBack, refreshQuote: refreshQuote, pushQuote: pushQuote,
    checkDateRollover: checkDateRollover, todayKey: function () { return dayKey; },
    quoteIndex: function () { return lastQuoteIndex; },
    onPermissionResult: onPermissionResult, applyPalette: applyPalette, applyBrand: applyBrand,
    get active() { return active; },
    get insets() { return insets; }
  };
});
