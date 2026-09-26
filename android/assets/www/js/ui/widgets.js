/* ui/widgets.js — shared UI kit: sheets, dialogs, toasts, switches, segmented controls,
 * a hand-built calendar and time picker, and the task card used by every list.
 *
 * The pickers are deliberately custom: WebView support for programmatic
 * `<input type=date>.showPicker()` is inconsistent, and a custom picker renders identically
 * on every device and in the QC harness.
 */
(function (root, factory) {
  var K = root.K = root.K || {};
  K.ui = K.ui || {};
  var api = factory(K.util, K.dom, K.date, K.i18n, K.model, K.matrix, K.bridge, K.store);
  for (var k in api) K.ui[k] = api[k];
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, DOM, D, I, M, MX, bridge, store) {
  'use strict';

  var el = DOM.el, icon = DOM.svgIcon;

  /**
   * Tag (badge) skin for a quadrant, honouring the user's palette, tag style and
   * background-opacity preference. Returns an inline style object.
   */
  function tagStyleFor(qKey) {
    var st = (store && store.settings) ? store.settings() : null;
    var dark = (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark');
    var pal = (st && st.palette) || U.DEFAULT_PALETTE[dark ? 'dark' : 'light'];
    var color = pal[qKey] || U.DEFAULT_PALETTE.light[qKey];
    var style = (st && st.tagStyle) || 'soft';
    var alpha = ((st && st.tagAlpha) || 16) / 100;
    var ink = U.mixHex(color, dark ? '#0b0d12' : '#ffffff', 0.78);
    if (style === 'vivid') return { background: color, color: dark ? '#0b0d12' : '#fff' };
    if (style === 'outline') return { background: 'transparent', 'box-shadow': 'inset 0 0 0 1.5px ' + color, color: ink };
    return { background: U.rgbaHex(color, alpha), color: ink };
  }

  // ------------------------------------------------------------------ scrim stack

  var sheetStack = [];

  function syncBackIntercept() {
    var app = (typeof K !== 'undefined' && K.views && K.views.app);
    if (app && app.updateBackIntercept) { app.updateBackIntercept(); return; }
    if (bridge && bridge.setBackIntercept) bridge.setBackIntercept(sheetStack.length > 0);
  }

  function scrimEl() { return document.getElementById('scrim'); }

  function showScrim(onClick) {
    var s = scrimEl();
    if (!s) return;
    s.hidden = false;
    s.onclick = onClick;
    requestAnimationFrame(function () { s.classList.add('is-open'); });
  }

  function hideScrim() {
    var s = scrimEl();
    if (!s) return;
    s.classList.remove('is-open');
    setTimeout(function () { if (!sheetStack.length) s.hidden = true; }, 220);
  }

  // ------------------------------------------------------------------ toast

  function toast(message, opts) {
    var o = opts || {};
    var root = document.getElementById('toastRoot');
    if (!root) return;
    var node = el('div', { class: 'toast' }, [
      o.icon ? icon(o.icon) : null,
      el('span', { text: message }),
      o.actionLabel ? el('button', {
        class: 't-action', type: 'button', text: o.actionLabel,
        onClick: function () { if (o.onAction) o.onAction(); dismiss(); }
      }) : null
    ]);
    root.appendChild(node);
    var life = o.duration || (o.actionLabel ? 4600 : 2400);
    var t = setTimeout(dismiss, life);
    function dismiss() {
      clearTimeout(t);
      if (!node.parentNode) return;
      node.classList.add('is-out');
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 220);
    }
    while (root.children.length > 3) root.removeChild(root.firstChild);
    return dismiss;
  }

  // ------------------------------------------------------------------ sheet

  /**
   * openSheet({title, sub, body, footer, onClose, wide}) → { close(), root, bodyEl }
   */
  function openSheet(cfg) {
    var root = document.getElementById('sheetRoot');
    var bodyEl = el('div', { class: 'sheet-body' }, cfg.body);
    var sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': cfg.title || '' }, [
      el('div', { class: 'sheet-grip' }),
      el('div', { class: 'sheet-head' }, [
        el('div', { class: 'col', style: { gap: '1px' } }, [
          el('div', { class: 'sheet-title', text: cfg.title || '' }),
          cfg.sub ? el('div', { class: 'sheet-sub', text: cfg.sub }) : null
        ]),
        el('div', { class: 'sheet-actions' }, cfg.headActions || [
          el('button', {
            class: 'icon-btn', type: 'button', 'aria-label': I.t('a11y.close'),
            onClick: function () { api.close(); }
          }, [icon('x')])
        ])
      ]),
      bodyEl,
      cfg.footer ? el('div', { class: 'sheet-foot' }, cfg.footer) : null
    ]);

    var api = {
      root: sheet,
      bodyEl: bodyEl,
      close: close,
      setTitle: function (t) { var n = sheet.querySelector('.sheet-title'); if (n) n.textContent = t; },
      setFooter: function (nodes) {
        var f = sheet.querySelector('.sheet-foot');
        if (!f) { f = el('div', { class: 'sheet-foot' }); sheet.appendChild(f); }
        DOM.clear(f);
        DOM.append(f, nodes);
      }
    };

    root.appendChild(sheet);
    sheetStack.push(api);
    syncBackIntercept();
    showScrim(function () { close(); });
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { sheet.classList.add('is-open'); });
    });

    function close(result) {
      var i = sheetStack.indexOf(api);
      if (i < 0) return;
      sheetStack.splice(i, 1);
      syncBackIntercept();
      sheet.classList.remove('is-open');
      hideScrim();
      setTimeout(function () {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        if (cfg.onClose) cfg.onClose(result);
      }, 240);
    }

    return api;
  }

  function topSheet() { return sheetStack[sheetStack.length - 1] || null; }

  /** Hardware/system back: close the topmost sheet, returns true when it handled it. */
  function handleBack() {
    var top = topSheet();
    if (top) { top.close(); return true; }
    var modal = document.querySelector('.modal-root .modal');
    if (modal) { closeModal(); return true; }
    return false;
  }

  // ------------------------------------------------------------------ modal / confirm

  function openModal(cfg) {
    var root = document.getElementById('modalRoot');
    var node = el('div', { class: 'modal', role: 'alertdialog', 'aria-modal': 'true' }, [
      cfg.title ? el('h3', { text: cfg.title }) : null,
      cfg.body ? el('p', { text: cfg.body }) : null,
      cfg.content || null,
      el('div', { class: 'modal-actions' }, cfg.actions || [])
    ]);
    DOM.clear(root);
    root.appendChild(node);
    var entry = { close: closeModal, isModal: true, root: node };
    sheetStack.push(entry);
    syncBackIntercept();
    showScrim(function () { closeModal(); });
    return entry;
  }

  function closeModal() {
    var root = document.getElementById('modalRoot');
    DOM.clear(root);
    hideScrim();
    sheetStack = sheetStack.filter(function (s) { return !s.isModal; });
    syncBackIntercept();
  }

  function confirmDialog(cfg) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (done) return; done = true; closeModal(); resolve(v); }
      var m = openModal({
        title: cfg.title, body: cfg.body, content: cfg.content,
        actions: [
          el('button', { class: 'btn btn-ghost', type: 'button', text: cfg.cancelLabel || I.t('confirm.cancel'), onClick: function () { finish(false); } }),
          el('button', {
            class: 'btn ' + (cfg.danger ? 'btn-danger' : 'btn-primary'), type: 'button',
            text: cfg.okLabel || I.t('confirm.ok'),
            onClick: function () { finish(true); }
          })
        ]
      });
      m.close = function () { finish(false); };
    });
  }

  // ------------------------------------------------------------------ controls

  function switchEl(checked, onChange, label) {
    var node = el('button', {
      class: 'switch', type: 'button', role: 'switch',
      'aria-checked': checked ? 'true' : 'false',
      'aria-label': label || ''
    });
    node.addEventListener('click', function () {
      var next = node.getAttribute('aria-checked') !== 'true';
      node.setAttribute('aria-checked', next ? 'true' : 'false');
      if (bridge && bridge.vibrate) bridge.vibrate(8);
      if (onChange) onChange(next);
    });
    return node;
  }

  function segmented(options, value, onChange) {
    var wrap = el('div', { class: 'segmented', role: 'group' });
    var buttons = options.map(function (opt) {
      var b = el('button', {
        type: 'button', text: opt.label,
        'aria-pressed': String(opt.value) === String(value)
      });
      b.addEventListener('click', function () {
        buttons.forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        if (bridge && bridge.vibrate) bridge.vibrate(6);
        if (onChange) onChange(opt.value);
      });
      wrap.appendChild(b);
      return b;
    });
    return wrap;
  }

  function stepper(value, min, max, onChange, label) {
    var input = el('input', {
      class: 'input num', type: 'text', inputmode: 'numeric',
      value: String(value), 'aria-label': label || ''
    });
    function set(v, notify) {
      v = U.clamp(Math.round(v || 0), min, max);
      input.value = String(v);
      if (notify !== false && onChange) onChange(v);
    }
    input.addEventListener('change', function () { set(parseInt(input.value, 10)); });
    input.addEventListener('blur', function () { set(parseInt(input.value, 10)); });
    return el('div', { class: 'stepper' }, [
      el('button', { class: 'step-btn', type: 'button', text: '−', 'aria-label': '-', onClick: function () { set((parseInt(input.value, 10) || min) - 1); } }),
      input,
      el('button', { class: 'step-btn', type: 'button', text: '+', 'aria-label': '+', onClick: function () { set((parseInt(input.value, 10) || min) + 1); } })
    ]);
  }

  function chips(options, value, onChange) {
    var wrap = el('div', { class: 'chips' });
    var nodes = options.map(function (opt) {
      var c = el('button', {
        class: 'chip', type: 'button',
        'aria-pressed': String(opt.value) === String(value),
        'data-value': String(opt.value)
      }, [opt.icon ? icon(opt.icon, 'ic-sm') : null, el('span', { text: opt.label })]);
      c.addEventListener('click', function () {
        nodes.forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        c.setAttribute('aria-pressed', 'true');
        if (bridge && bridge.vibrate) bridge.vibrate(6);
        if (onChange) onChange(opt.value);
      });
      wrap.appendChild(c);
      return c;
    });
    return wrap;
  }

  // ------------------------------------------------------------------ date picker

  function isoDate(ms) {
    var p = D.parts(ms);
    return p.y + '-' + U.pad2(p.m) + '-' + U.pad2(p.d);
  }

  /** Calendar sheet. Resolves with epoch ms (keeping the original time of day) or null. */
  function pickDate(initialMs, opts) {
    var o = opts || {};
    var startIso = o.weekStart || 6;
    var initial = typeof initialMs === 'number' ? initialMs : Date.now();
    var selected = D.startOfDay(initial);
    var cursor = D.startOfDay(initial);
    var gridHost = el('div', { class: 'col', style: { gap: '10px' } });
    var titleNode = el('div', { class: 'h-title', style: { 'text-align': 'center' } });
    var sheetApi = null;

    function monthGrid() {
      var p = D.parts(cursor);
      var first = D.fromParts({ y: p.y, m: p.m, d: 1 });
      var firstIso = D.parts(first).iso;
      var lead = (firstIso - startIso + 7) % 7;
      var gridStart = D.addDays(first, -lead);
      var todayKey = D.dayKey(Date.now());
      var selKey = D.dayKey(selected);
      var cells = [];

      for (var i = 0; i < 7; i++) {
        cells.push(el('div', {
          class: 'cal-dow',
          text: I.dowShortByIso(((startIso - 1 + i) % 7) + 1)
        }));
      }
      for (var d = 0; d < 42; d++) {
        var day = D.addDays(gridStart, d);
        var dp = D.parts(day);
        var key = D.dayKey(day);
        var inMonth = dp.m === p.m;
        cells.push(el('button', {
          type: 'button',
          class: 'cal-cell' + (inMonth ? '' : ' is-out') + (key === todayKey ? ' is-today' : '') + (key === selKey ? ' is-sel' : ''),
          'data-ms': String(day),
          text: String(dp.d),
          onClick: function (ev) {
            var ms = Number(ev.currentTarget.getAttribute('data-ms'));
            selected = D.startOfDay(ms);
            cursor = selected;
            titleNode.textContent = I.fmtMonthYear(cursor);
            var all = gridHost.querySelectorAll('.cal-cell');
            for (var j = 0; j < all.length; j++) all[j].classList.remove('is-sel');
            ev.currentTarget.classList.add('is-sel');
            if (bridge && bridge.vibrate) bridge.vibrate(6);
          }
        }));
      }
      return el('div', { class: 'cal-grid' }, cells);
    }

    function shiftMonth(delta) {
      var p = D.parts(cursor);
      cursor = D.fromParts({ y: p.y, m: p.m + delta, d: 1 });
      var dim = D.daysInMonth(D.parts(cursor).y, D.parts(cursor).m);
      if (p.d > dim) cursor = D.fromParts({ y: D.parts(cursor).y, m: D.parts(cursor).m, d: dim });
      titleNode.textContent = I.fmtMonthYear(cursor);
      var old = gridHost.querySelector('.cal-grid');
      var fresh = monthGrid();
      fresh.style.opacity = '0';
      fresh.style.transform = 'translateX(' + (delta > 0 ? -1 : 1) * (I.isRtl() ? -14 : 14) + 'px)';
      gridHost.replaceChild(fresh, old);
      requestAnimationFrame(function () {
        fresh.style.transition = 'opacity .18s var(--ease), transform .18s var(--ease)';
        fresh.style.opacity = '1';
        fresh.style.transform = '';
      });
    }

    titleNode.textContent = I.fmtMonthYear(cursor);
    gridHost.appendChild(el('div', { class: 'cal-head' }, [
      el('button', { class: 'nav-btn', type: 'button', 'aria-label': I.t('week.prev'), onClick: function () { shiftMonth(-1); } }, [icon('chevron-start')]),
      titleNode,
      el('button', { class: 'nav-btn', type: 'button', 'aria-label': I.t('week.next'), onClick: function () { shiftMonth(1); } }, [icon('chevron-end')])
    ]));
    gridHost.appendChild(monthGrid());
    gridHost.appendChild(el('div', { class: 'chips', style: { 'justify-content': 'center' } }, [
      quickChip(I.t('editor.quick.today'), 0),
      quickChip(I.t('editor.quick.tomorrow'), 1),
      quickChip(I.t('editor.quick.nextWeek'), 7)
    ]));

    function quickChip(label, days) {
      return el('button', {
        class: 'chip', type: 'button', text: label,
        onClick: function () {
          selected = D.startOfDay(D.addDays(Date.now(), days));
          cursor = selected;
          titleNode.textContent = I.fmtMonthYear(cursor);
          var fresh = monthGrid();
          var old = gridHost.querySelector('.cal-grid');
          gridHost.replaceChild(fresh, old);
        }
      });
    }

    sheetApi = openSheet({
      title: o.title || I.t('editor.date'),
      body: [gridHost],
      footer: [
        el('button', { class: 'btn btn-ghost grow', type: 'button', text: I.t('editor.cancel'), onClick: function () { sheetApi.close(null); } }),
        el('button', {
          class: 'btn btn-primary grow', type: 'button', text: I.t('confirm.ok'),
          onClick: function () {
            var tp = D.parts(initial);
            sheetApi.close(D.fromParts({
              y: D.parts(selected).y, m: D.parts(selected).m, d: D.parts(selected).d,
              H: tp.H, M: tp.M, S: 0
            }));
          }
        })
      ]
    });
    return new Promise(function (resolve) {
      var origClose = sheetApi.close;
      sheetApi.close = function (v) { origClose(v); resolve(typeof v === 'number' ? v : null); };
    });
  }

  // ------------------------------------------------------------------ time picker

  /** Two scrolling columns (hours / minutes in 5-step) + quick presets. */
  function pickTime(initialMs, opts) {
    var o = opts || {};
    var initial = typeof initialMs === 'number' ? initialMs : Date.now();
    var p = D.parts(initial);
    var hour = p.H, minute = p.M;      // V2: any minute, no stepping limit
    var hourLabel = el('div', { class: 'tp-value' });
    var minLabel = el('div', { class: 'tp-value' });
    var sheetApi = null;

    function col(items, current, onPick, labelNode) {
      var list = el('div', { class: 'tp-col' });
      var nodes = items.map(function (v) {
        var b = el('button', {
          type: 'button', class: 'tp-item' + (v === current ? ' is-sel' : ''),
          text: U.pad2(v), 'data-v': String(v)
        });
        b.addEventListener('click', function () {
          nodes.forEach(function (x) { x.classList.remove('is-sel'); });
          b.classList.add('is-sel');
          labelNode.textContent = U.pad2(v);
          onPick(v);
          if (bridge && bridge.vibrate) bridge.vibrate(5);
          b.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
        list.appendChild(b);
        return b;
      });
      requestAnimationFrame(function () {
        var sel = list.querySelector('.is-sel');
        if (sel) list.scrollTop = Math.max(0, sel.offsetTop - list.clientHeight / 2 + sel.clientHeight / 2);
      });
      return list;
    }

    var hours = []; for (var h = 0; h < 24; h++) hours.push(h);
    var minutes = []; for (var m = 0; m < 60; m += 1) minutes.push(m);
    hourLabel.textContent = U.pad2(hour);
    minLabel.textContent = U.pad2(minute);

    var body = el('div', { class: 'tp' }, [
      el('div', { class: 'tp-colwrap' }, [el('div', { class: 'tp-cap', text: I.t('editor.time') }), hourLabel, col(hours, hour, function (v) { hour = v; }, hourLabel)]),
      el('div', { class: 'tp-sep', text: ':' }),
      el('div', { class: 'tp-colwrap' }, [el('div', { class: 'tp-cap', text: 'min' }), minLabel, col(minutes, minute, function (v) { minute = v; }, minLabel)])
    ]);

    sheetApi = openSheet({
      title: o.title || I.t('editor.time'),
      body: [body],
      footer: [
        el('button', { class: 'btn btn-ghost grow', type: 'button', text: I.t('editor.cancel'), onClick: function () { sheetApi.close(null); } }),
        el('button', {
          class: 'btn btn-primary grow', type: 'button', text: I.t('confirm.ok'),
          onClick: function () {
            sheetApi.close(D.fromParts({ y: p.y, m: p.m, d: p.d, H: hour, M: minute, S: 0 }));
          }
        })
      ]
    });
    return new Promise(function (resolve) {
      var origClose = sheetApi.close;
      sheetApi.close = function (v) { origClose(v); resolve(typeof v === 'number' ? v : null); };
    });
  }

  // ------------------------------------------------------------------ task card

  /**
   * One task row. `entry` = {task, at, done, overdue, doneAt} (week view) or a bare task
   * (matrix view, where the next open occurrence is derived here).
   */
  function taskCard(entry, opts) {
    var o = opts || {};
    var task = entry.task || entry;
    var now = o.now || Date.now();
    var at = entry.at != null ? entry.at : (task.dueAt || now);
    var done = entry.done != null ? !!entry.done : M.isDoneAt(task, at);
    var overdue = entry.overdue != null ? !!entry.overdue : (!done && at < now && !task.closedAt);
    var qk = MX.keyOf(task);
    var q = MX.byKey(qk);
    var repeating = task.rec && task.rec !== 'NONE';

    var meta = [];
    if (task.dueAt) {
      if (task.untimed) {
        meta.push(el('span', {
          class: 'm num' + (overdue ? ' is-overdue' : (D.sameDay(at, now) ? ' is-today' : ''))
        }, [icon(overdue ? 'alert' : 'flag'), el('span', {
          text: o.showDate === false ? I.fmtDayLabel(at) : I.fmtDate(at)
        })]));
        meta.push(el('span', { class: 'badge', text: I.t('task.untimed') }));
      } else {
        meta.push(el('span', {
          class: 'm num' + (overdue ? ' is-overdue' : (D.sameDay(at, now) ? ' is-today' : ''))
        }, [icon(overdue ? 'alert' : 'clock'), el('span', { text: o.showDate === false ? I.fmtTime(at) : I.fmtDue(at, now) })]));
      }
    }
    if (repeating && !task.closedAt) {
      meta.push(el('span', { class: 'm' }, [icon('repeat'), el('span', { text: I.describeRecurrence(task.rec, D.parts(task.dueAt).d) })]));
    }
    if (task.remind && !task.closedAt) {
      meta.push(el('span', { class: 'm' }, [icon('bell')]));
    }
    if (o.showQuadrant) {
      meta.push(el('span', { class: 'badge is-q', style: tagStyleFor(qk), text: I.quadrantName(qk) }));
    }

    var node = el('div', {
      class: 'task' + (done ? ' is-done' : '') + (overdue ? ' is-overdue' : '') + (o.readonly ? ' is-readonly' : ''),
      'data-id': task.id,
      'data-occ': String(at),
      'data-readonly': o.readonly ? '1': null,
      role: 'listitem',
      style: {
        '--qc': 'var(' + q.varName + ')',
        '--qc-soft': 'var(' + q.varName + '-soft)',
        '--qc-ink': 'var(' + q.varName + '-ink)'
      }
    }, [
      el('button', {
        class: 'task-check', type: 'button', 'data-act': 'toggle',
        'aria-pressed': done ? 'true' : 'false',
        'aria-label': I.t('a11y.toggleDone')
      }, [icon('check')]),
      el('div', { class: 'task-body' }, [
        el('div', { class: 'task-title', text: task.title || '' }),
        meta.length ? el('div', { class: 'task-meta' }, meta) : null,
        task.notes && o.showNotes ? el('div', { class: 'tiny faint clamp-2', text: task.notes }) : null
      ]),
      o.grip === false ? null : el('div', { class: 'task-grip', 'data-act': 'grip', 'aria-label': I.t('a11y.dragHandle') }, [icon('drag')])
    ]);
    return node;
  }

  /**
   * Collapse-and-fade a row out of its list (the row stays in the database —
   * this is a view filter, not a deletion). Calls `cb` once the node is gone.
   */
  function animateOut(node, cb) {
    if (!node || !node.parentNode) { if (cb) cb(); return; }
    node.style.height = node.offsetHeight + 'px';
    node.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      node.classList.add('is-removing');
      node.style.height = '0px';
      node.style.paddingBlock = '0px';
      node.style.marginBlock = '0px';
      node.style.borderWidth = '0px';
    });
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
      if (cb) cb();
    }, 260);
  }

  /**
   * Completion choreography: keep the checkmark on screen long enough to register
   * (~400 ms), then animate the row away, then let the app re-render. A render-hold
   * flag defers the store subscriber's re-render so the row is not replaced mid-celebration.
   */
  function completeWithHold(node, mutator) {
    document.body.dataset.renderhold = String(Date.now() + 720);
    try { mutator(); } catch (e) { delete document.body.dataset.renderhold; throw e; }
    setTimeout(function () {
      animateOut(node, function () {
        delete document.body.dataset.renderhold;
        var app = (typeof K !== 'undefined' && K.views) ? K.views.app : null;
        if (app && app.render) app.render('complete');
      });
    }, 400);
  }

  /** Minimalist motivational banner (one phrase per launch). */
  function quoteBanner(text) {
    return el('div', { class: 'quote-banner', role: 'note' }, [
      el('span', { class: 'qb-mark', 'aria-hidden': 'true' }, '”'),
      el('p', { class: 'qb-text', text: text })
    ]);
  }

  function emptyState(cfg) {
    return el('div', { class: 'empty-state' }, [
      icon(cfg.icon || 'inbox'),
      el('h3', { text: cfg.title }),
      cfg.body ? el('p', { text: cfg.body }) : null,
      cfg.actionLabel ? el('button', { class: 'btn btn-primary', type: 'button', text: cfg.actionLabel, onClick: cfg.onAction }) : null
    ]);
  }

  return {
    toast: toast,
    openSheet: openSheet, openModal: openModal, closeModal: closeModal,
    confirmDialog: confirmDialog, handleBack: handleBack, topSheet: topSheet,
    switchEl: switchEl, segmented: segmented, stepper: stepper, chips: chips,
    pickDate: pickDate, pickTime: pickTime, isoDate: isoDate,
    taskCard: taskCard, emptyState: emptyState, quoteBanner: quoteBanner,
    tagStyleFor: tagStyleFor, animateOut: animateOut, completeWithHold: completeWithHold,
    sheetCount: function () { return sheetStack.length; }
  };
});
