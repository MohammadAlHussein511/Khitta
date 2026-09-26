/* ui/settings.view.js — identity (name + launcher icon), appearance (theme, language,
 * user palette, tag style/opacity), notification health, week start, data, about.
 * V2: file export/import were removed from the product entirely. */
(function (root, factory) {
  var K = root.K = root.K || {};
  K.views = K.views || {};
  K.views.settings = factory(K.util, K.dom, K.date, K.i18n, K.model, K.store, K.notify, K.ui, K.bridge, K.views);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, DOM, D, I, M, store, notify, W, bridge, views) {
  'use strict';

  var el = DOM.el, icon = DOM.svgIcon;
  var els = {};
  var mounted = false;
  var OFFSETS = [0, 5, 10, 30, 60, 1440];
  var OFFSET_KEYS = { 0: 'offset.at', 5: 'offset.5', 10: 'offset.10', 30: 'offset.30', 60: 'offset.60', 1440: 'offset.1440' };

  var SWATCHES = ['#e5484d', '#f97316', '#d97706', '#16a34a', '#059669', '#2f6fdb', '#4f46e5', '#7c3aed', '#db2777', '#64748b'];
  var ICON_VARIANTS = [
    { v: 1, color: '#4f46e5' },
    { v: 2, color: '#059669' },
    { v: 3, color: '#f97316' },
    { v: 4, color: '#1e293b' }
  ];

  function row(cfg) {
    var value = cfg.value ? el('span', { class: 'set-value' }, cfg.value) : null;
    var node = el('div', {
      class: 'set-row' + (cfg.onClick ? ' is-clickable' : ''),
      role: cfg.onClick ? 'button' : null
    }, [
      cfg.icon ? el('span', { class: 'set-ico', style: cfg.iconStyle || null }, [icon(cfg.icon)]) : null,
      el('span', { class: 'set-text' }, [
        el('b', { text: cfg.title }),
        cfg.desc ? el('span', { text: cfg.desc }) : null
      ]),
      cfg.control || value || null
    ]);
    if (cfg.onClick) node.addEventListener('click', cfg.onClick);
    return node;
  }

  function group(title, rows) {
    return el('div', { class: 'set-group' }, [
      el('div', { class: 'section-head' }, [el('span', { class: 'h-section', text: title })]),
      el('div', { class: 'card' }, rows)
    ]);
  }

  function currentPalette() {
    var st = store.settings();
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return st.palette || U.DEFAULT_PALETTE[dark ? 'dark' : 'light'];
  }

  function build() {
    var s = store.settings();

    // ---- identity -------------------------------------------------------
    els.nameInput = el('input', {
      class: 'input', type: 'text', maxlength: '40',
      placeholder: I.t('settings.appNamePh'),
      value: s.brandName || '', 'aria-label': I.t('settings.appName'), autocomplete: 'off'
    });
    els.nameInput.addEventListener('input', function () {
      store.setSetting('brandName', els.nameInput.value.slice(0, 40));
    });

    els.iconChips = el('div', { class: 'swatch-row' });
    els.iconNodes = {};
    ICON_VARIANTS.forEach(function (iv) {
      var b = el('button', {
        class: 'swatch', type: 'button',
        style: { background: 'linear-gradient(150deg,' + iv.color + ',' + U.mixHex(iv.color, '#000000', 0.72) + ')' },
        'aria-pressed': String(s.iconVariant === iv.v),
        'aria-label': I.t('settings.icon.v' + iv.v),
        title: I.t('settings.icon.v' + iv.v)
      });
      b.addEventListener('click', function () {
        store.setSetting('iconVariant', iv.v);
        if (bridge.setIconVariant) bridge.setIconVariant(iv.v);
        W.toast(I.t('settings.icon.v' + iv.v), { icon: 'check' });
        paintIconChips();
      });
      els.iconNodes[iv.v] = b;
      els.iconChips.appendChild(b);
    });

    els.identity = group(I.t('settings.identity'), [
      row({ icon: 'pencil', title: I.t('settings.appName'), desc: I.t('settings.appNameDesc') }),
      el('div', { style: { padding: '0 16px 12px', background: 'var(--surface)' } }, [els.nameInput]),
      row({ icon: 'target', title: I.t('settings.icon'), desc: I.t('settings.iconDesc') }),
      el('div', { style: { padding: '0 16px 14px', background: 'var(--surface)' } }, [els.iconChips])
    ]);

    // ---- appearance -----------------------------------------------------
    els.themeSeg = W.segmented([
      { value: 'system', label: I.t('settings.theme.system') },
      { value: 'light', label: I.t('settings.theme.light') },
      { value: 'dark', label: I.t('settings.theme.dark') }
    ], s.theme, function (v) { store.setSetting('theme', v); });

    els.langSeg = W.segmented([
      { value: 'ar', label: 'العربية' },
      { value: 'en', label: 'English' }
    ], s.lang, function (v) {
      if (v === store.settings().lang) return;
      store.setSetting('lang', v);
      W.toast(I.t('toast.langChanged'), { icon: 'globe' });
    });

    // palette: one swatch row per quadrant
    els.paletteHost = el('div', { style: { padding: '4px 16px 12px', background: 'var(--surface)' } });
    els.paletteNodes = {};
    function buildPalette() {
      DOM.clear(els.paletteHost);
      var pal = currentPalette();
      var st = store.settings();
      [1, 2, 3, 4].forEach(function (qi) {
        var key = 'q' + qi;
        var line = el('div', { class: 'swatch-line' });
        line.appendChild(el('span', { class: 'sl-name', text: I.quadrantName(key) }));
        var wrap = el('div', { class: 'swatch-row', style: { 'padding-block': '0' } });
        SWATCHES.forEach(function (hex) {
          var on = (st.palette || {})[key] === hex || (!st.palette && pal[key] === hex);
          var b = el('button', {
            class: 'swatch', type: 'button', style: { background: hex },
            'aria-pressed': String(!!on && !!st.palette), 'aria-label': hex
          });
          b.addEventListener('click', function () {
            var next = U.clone(st.palette || currentPalette());
            next[key] = hex;
            store.setSetting('palette', next);
            if (views.app && views.app.applyPalette) views.app.applyPalette();
            buildPalette();
            bridge.vibrate(6);
          });
          wrap.appendChild(b);
        });
        line.appendChild(wrap);
        els.paletteHost.appendChild(line);
      });
      if (!store.settings().palette) {
        els.paletteHost.appendChild(el('div', { class: 'hint', text: I.t('settings.paletteDesc') }));
      }
    }
    buildPalette();
    els.buildPalette = buildPalette;

    els.tagSeg = W.segmented([
      { value: 'soft', label: I.t('tagStyle.soft') },
      { value: 'vivid', label: I.t('tagStyle.vivid') },
      { value: 'outline', label: I.t('tagStyle.outline') }
    ], s.tagStyle, function (v) {
      store.setSetting('tagStyle', v);
      if (views.app && views.app.applyPalette) views.app.applyPalette();
    });

    els.alphaStepper = W.stepper(s.tagAlpha == null ? 16 : s.tagAlpha, 4, 60, function (v) {
      store.setSetting('tagAlpha', v);
      if (views.app && views.app.applyPalette) views.app.applyPalette();
    });

    els.appearance = group(I.t('settings.appearance'), [
      row({ icon: 'sun', title: I.t('settings.theme'), control: els.themeSeg }),
      row({ icon: 'globe', title: I.t('settings.language'), desc: I.t('settings.language.desc'), control: els.langSeg }),
      row({ icon: 'grid', title: I.t('settings.palette'), desc: I.t('settings.paletteDesc') }),
      els.paletteHost,
      row({ icon: 'flag', title: I.t('settings.tagStyle'), control: els.tagSeg }),
      row({ icon: 'sliders', title: I.t('settings.tagAlpha'), control: els.alphaStepper })
    ]);

    // ---- notifications ---------------------------------------------------
    els.remindSwitch = W.switchEl(s.reminders !== false, function (on) {
      store.setSetting('reminders', on);
      if (!on) W.toast(I.t('toast.remindersOff'), { icon: 'bell' });
      render(store.get(), Date.now());
    }, I.t('settings.remindersOn'));

    els.permRow = row({ icon: 'bell', title: I.t('settings.notifPermission'), desc: '' });
    els.exactRow = row({ icon: 'clock', title: I.t('settings.exactAlarms'), desc: '' });
    els.armedRow = row({ icon: 'repeat', title: I.t('settings.armed'), desc: '' });
    els.offsetWrap = el('div', { class: 'col', style: { gap: '6px', padding: '12px 16px', background: 'var(--surface)', 'border-block-end': '1px solid var(--line)' } });
    els.offsetChips = W.chips(OFFSETS.map(function (m) {
      return { value: m, label: I.t(OFFSET_KEYS[m] || 'offset.at') };
    }), s.defaultRemindOffset || 0, function (v) { store.setSetting('defaultRemindOffset', Number(v)); });
    els.offsetWrap.appendChild(el('div', { class: 'label', text: I.t('settings.defaultOffset') }));
    els.offsetWrap.appendChild(els.offsetChips);

    els.horizonStepper = W.stepper(s.alarmHorizonDays || 60, 7, 180, function (v) {
      store.setSetting('alarmHorizonDays', v);
      render(store.get(), Date.now());
    });
    els.testRow = row({
      icon: 'bell', title: I.t('settings.test'), desc: I.t('settings.test.desc'),
      onClick: function () {
        if (!bridge.available) { W.toast('—', { icon: 'info' }); return; }
        notify.test();
        W.toast(I.t('toast.testSent'), { icon: 'check' });
      }
    });

    els.notifications = group(I.t('settings.notifications'), [
      row({ icon: 'bell', title: I.t('settings.remindersOn'), desc: I.t('settings.remindersOn.desc'), control: els.remindSwitch }),
      els.permRow, els.exactRow, els.armedRow, els.offsetWrap,
      row({ icon: 'calendar', title: I.t('settings.horizon'), desc: I.t('settings.horizon.desc'), control: els.horizonStepper }),
      els.testRow
    ]);

    // ---- week ------------------------------------------------------------
    els.weekSeg = W.segmented([
      { value: 6, label: I.t('settings.weekStart.6') },
      { value: 7, label: I.t('settings.weekStart.7') },
      { value: 1, label: I.t('settings.weekStart.1') }
    ], s.weekStart, function (v) { store.setSetting('weekStart', Number(v)); });
    els.week = group(I.t('settings.week'), [
      row({ icon: 'calendar', title: I.t('settings.weekStart'), control: els.weekSeg })
    ]);

    // ---- data (V2: no export / import) ------------------------------------
    els.countRow = row({ icon: 'grid', title: I.t('settings.tasksCount', { n: 0 }), desc: '' });
    els.storageRow = row({ icon: 'info', title: I.t('settings.storage'), desc: '' });
    els.clearRow = row({
      icon: 'trash', title: I.t('settings.clearDone'), desc: '',
      onClick: function () {
        var st = store.get();
        var n = st.tasks.filter(function (t) { return M.isComplete(t); }).length;
        if (!n) { W.toast('0', { icon: 'info' }); return; }
        W.confirmDialog({
          title: I.t('confirm.clearDone.title'),
          body: I.t('confirm.clearDone.body', { n: n }),
          okLabel: I.t('confirm.delete'), danger: true
        }).then(function (ok) {
          if (!ok) return;
          var removed = store.clearCompleted();
          W.toast(I.t('toast.cleared', { n: removed }), { icon: 'check' });
        });
      }
    });
    els.data = group(I.t('settings.data'), [els.countRow, els.storageRow, els.clearRow]);

    // ---- about ------------------------------------------------------------
    var info = bridge.appInfo();
    els.about = el('div', { class: 'set-group' }, [
      el('div', { class: 'card card-pad', style: { 'text-align': 'center' } }, [
        el('div', { class: 'about-logo' }, [icon('target', 'ic-xl')]),
        el('div', { class: 'h-title', text: I.t('app.name') + ' · V2' }),
        el('div', { class: 'tiny faint', text: I.t('app.tagline') }),
        el('div', { class: 'divider' }),
        el('div', { class: 'tiny muted', style: { 'line-height': '1.7' }, text: I.t('settings.privacy') }),
        el('div', { class: 'divider' }),
        el('div', { class: 'row', style: { 'justify-content': 'center', gap: 'var(--s4)' } }, [
          el('span', { class: 'tiny faint num', text: I.t('settings.version') + ' ' + (info.versionName || '2.0.0') }),
          el('span', { class: 'tiny faint num', text: 'API ' + (info.sdkInt || '—') })
        ]),
        el('div', { class: 'tiny faint', text: (info.manufacturer || '') + ' ' + (info.model || '') })
      ])
    ]);

    els.scroller = el('div', { class: 'scroller' }, [
      els.identity, els.appearance, els.notifications, els.week, els.data, els.about
    ]);
    els.root = el('div', { class: 'settings-screen' }, [els.scroller]);
    return els.root;
  }

  function paintIconChips() {
    var v = store.settings().iconVariant || 1;
    ICON_VARIANTS.forEach(function (iv) {
      els.iconNodes[iv.v].setAttribute('aria-pressed', String(iv.v === v));
    });
  }

  function setStatusRow(node, title, desc, state, actionLabel, onAction) {
    DOM.clear(node);
    node.appendChild(el('span', { class: 'set-ico' }, [icon(state === 'ok' ? 'check' : (state === 'warn' ? 'alert' : 'bell'))]));
    node.appendChild(el('span', { class: 'set-text' }, [el('b', { text: title }), el('span', { text: desc })]));
    node.appendChild(el('span', { class: 'set-value' }, [
      el('span', { class: 'status-dot' + (state === 'ok' ? '' : (state === 'warn' ? ' is-warn' : ' is-off')) }),
      actionLabel ? el('button', { class: 'btn btn-sm btn-outline', type: 'button', text: actionLabel, onClick: function (e) { e.stopPropagation(); onAction(); } }) : null
    ]));
  }

  function mount(host) {
    if (mounted) return;
    mounted = true;
    host.appendChild(build());
  }

  function render(state, now) {
    if (!mounted) return;
    var s = state.settings;
    var st = notify.status(state);

    if (!st.available) {
      setStatusRow(els.permRow, I.t('settings.notifPermission'), '—', 'warn', null, null);
      setStatusRow(els.exactRow, I.t('settings.exactAlarms'), '—', 'warn', null, null);
    } else if (st.notificationsEnabled) {
      setStatusRow(els.permRow, I.t('settings.notifPermission'), I.t('settings.notifPermission.granted'), 'ok', null, null);
    } else {
      setStatusRow(els.permRow, I.t('settings.notifPermission'), I.t('settings.notifPermission.denied'), 'off',
        I.t('settings.notifPermission.grant'), function () {
          if (st.notificationsDenied) notify.openSettings('notifications');
          else notify.requestPermission();
        });
    }
    if (st.available) {
      if (st.canExact) setStatusRow(els.exactRow, I.t('settings.exactAlarms'), I.t('settings.exactAlarms.ok'), 'ok', null, null);
      else setStatusRow(els.exactRow, I.t('settings.exactAlarms'), I.t('settings.exactAlarms.no'), 'warn',
        I.t('settings.exactAlarms.fix'), function () { notify.openSettings('exactAlarms'); });
    }

    var armedSub = els.armedRow.querySelector('.set-text span');
    if (armedSub) armedSub.textContent = I.t('settings.armed.desc', { n: st.armed || 0 });

    els.remindSwitch.setAttribute('aria-checked', s.reminders !== false ? 'true' : 'false');
    els.offsetWrap.hidden = s.reminders === false;
    els.armedRow.hidden = s.reminders === false;
    els.testRow.hidden = s.reminders === false;

    var countSub = els.countRow.querySelector('.set-text b');
    if (countSub) countSub.textContent = I.t('settings.tasksCount', { n: state.tasks.length });
    var open = state.tasks.filter(function (t) { return !M.isComplete(t); }).length;
    var countDesc = els.countRow.querySelector('.set-text span');
    if (countDesc) countDesc.textContent = I.t('matrix.openCount', { n: open });

    var stSub = els.storageRow.querySelector('.set-text span');
    if (stSub) {
      var bytes = bridge.available ? bridge.storageBytes() : store.stateJsonLength();
      stSub.textContent = U.formatBytes(bytes) + ' · ' + (bridge.available ? 'state.json' : 'localStorage');
    }
    var clearDesc = els.clearRow.querySelector('.set-text span');
    if (clearDesc) {
      var n = state.tasks.filter(function (t) { return M.isComplete(t); }).length;
      clearDesc.textContent = I.t('settings.clearDone.desc', { n: n });
    }

    paintIconChips();
    if (document.activeElement !== els.nameInput) els.nameInput.value = s.brandName || '';
  }

  function relayout() {
    if (!mounted || !els.root || !els.root.parentNode) return;
    var host = els.root.parentNode;
    var stale = els.root;
    var fresh = build();
    host.replaceChild(fresh, stale);
    els.root = fresh;
    render(store.get(), Date.now());
  }

  return { id: 'settings', mount: mount, render: render, relayout: relayout };
});
