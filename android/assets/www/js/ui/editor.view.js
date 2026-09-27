/* ui/editor.view.js — the task editor bottom sheet (create / edit / delete). */
(function (root, factory) {
  var K = root.K = root.K || {};
  K.views = K.views || {};
  K.views.editor = factory(K.util, K.dom, K.date, K.i18n, K.model, K.matrix, K.recurrence, K.store, K.ui, K.bridge);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, DOM, D, I, M, MX, R, store, W, bridge) {
  'use strict';

  var el = DOM.el, icon = DOM.svgIcon;

  var OFFSETS = [0, 5, 10, 30, 60, 1440];
  var OFFSET_KEYS = {
    0: 'offset.at', 5: 'offset.5', 10: 'offset.10', 30: 'offset.30',
    60: 'offset.60', 180: 'offset.180', 1440: 'offset.1440'
  };

  function quadVars(q) {
    return {
      '--qc': 'var(' + q.varName + ')',
      '--qc-soft': 'var(' + q.varName + '-soft)',
      '--qc-ink': 'var(' + q.varName + '-ink)'
    };
  }

  /**
   * @param {Object} cfg {taskId, quadrant, dueAt, onSaved, onDeleted}
   */
  function open(cfg) {
    var conf = cfg || {};
    var existing = conf.taskId ? store.taskById(conf.taskId) : null;
    var s = store.settings();

    var draft = existing ? {
      id: existing.id,
      title: existing.title,
      notes: existing.notes,
      imp: existing.imp,
      urg: existing.urg,
      dueAt: existing.dueAt,
      remind: existing.remind,
      remindOffset: existing.remindOffset,
      untimed: !!existing.untimed,
      rec: existing.rec,
      recEnd: U.clone(existing.recEnd || { mode: 'never' })
    } : (function () {
      var q = MX.byKey(conf.quadrant || 'q1');
      var due = typeof conf.dueAt === 'number'
        ? conf.dueAt
        : M.defaultDue(Date.now(), s);
      return {
        id: null, title: '', notes: '',
        imp: q.imp, urg: q.urg,
        dueAt: due, remind: true,
        remindOffset: s.defaultRemindOffset || 0,
        untimed: false,
        rec: 'NONE', recEnd: { mode: 'never' }
      };
    })();

    var refs = {};
    var sheet = null;

    // ---------------------------------------------------------------- fields

    var titleInput = el('input', {
      class: 'input', type: 'text', maxlength: '300',
      placeholder: I.t('editor.titlePh'), value: draft.title,
      'aria-label': I.t('editor.title'), autocomplete: 'off'
    });
    titleInput.addEventListener('input', function () {
      draft.title = titleInput.value;
      titleInput.classList.toggle('is-error', !titleInput.value.trim());
      var h = refs.errorHint;
      if (h) h.textContent = '';
    });

    var notesInput = el('textarea', {
      class: 'textarea', maxlength: '4000', rows: '3',
      placeholder: I.t('editor.notesPh'), 'aria-label': I.t('editor.notes')
    });
    notesInput.value = draft.notes;
    notesInput.addEventListener('input', function () { draft.notes = notesInput.value; });

    // quadrant picker
    var quadBtns = {};
    var quadPicker = el('div', { class: 'quad-picker' });
    MX.QUADRANTS.forEach(function (q) {
      var pressed = MX.fromFlags(draft.imp, draft.urg) === q.key;
      var b = el('button', {
        class: 'quad-opt', type: 'button', 'aria-pressed': String(pressed),
        style: quadVars(q)
      }, [
        el('span', { class: 'qo-ico' }, [icon(q.icon)]),
        el('span', { class: 'qo-t' }, [
          el('b', { text: I.t('matrix.' + q.key + '.name') }),
          el('span', { text: I.t('matrix.' + q.key + '.sub') })
        ])
      ]);
      b.addEventListener('click', function () {
        draft.imp = q.imp; draft.urg = q.urg;
        Object.keys(quadBtns).forEach(function (k) { quadBtns[k].setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        if (bridge.vibrate) bridge.vibrate(8);
      });
      quadBtns[q.key] = b;
      quadPicker.appendChild(b);
    });

    // when
    var dateBtn = el('button', { class: 'dt-btn grow', type: 'button' }, [icon('calendar'), el('span', { class: 'num', text: '' })]);
    var timeBtn = el('button', { class: 'dt-btn', type: 'button' }, [icon('clock'), el('span', { class: 'num', text: '' })]);
    function paintWhen() {
      dateBtn.querySelector('span').textContent = I.fmtDate(draft.dueAt);
      timeBtn.disabled = !!draft.untimed;
      timeBtn.querySelector('span').textContent = draft.untimed ? '—' : I.fmtTime(draft.dueAt);
      var today = D.sameDay(draft.dueAt, Date.now());
      dateBtn.classList.toggle('is-on', today);
      paintOccurrences();
    }
    dateBtn.addEventListener('click', function () {
      W.pickDate(draft.dueAt, { weekStart: s.weekStart }).then(function (ms) {
        if (ms == null) return;
        draft.dueAt = ms;
        paintWhen();
      });
    });
    timeBtn.addEventListener('click', function () {
      W.pickTime(draft.dueAt).then(function (ms) {
        if (ms == null) return;
        draft.dueAt = ms;
        paintWhen();
      });
    });

    var untimedSwitch = W.switchEl(draft.untimed, function (on) {
      draft.untimed = on;
      var pp = D.parts(draft.dueAt);
      if (on) {
        draft.dueAt = D.fromParts({ y: pp.y, m: pp.m, d: pp.d, H: 0, M: 0, S: 0 });
      } else if (pp.H === 0 && pp.M === 0) {
        draft.dueAt = D.fromParts({ y: pp.y, m: pp.m, d: pp.d, H: s.dayStartHour || 9, M: 0, S: 0 });
      }
      if (bridge.vibrate) bridge.vibrate(8);
      paintWhen();
      paintReminder();
    }, I.t('editor.untimed'));
    var untimedRow = el('div', { class: 'row-between', style: { gap: '10px' } }, [
      el('div', { class: 'set-text', style: { padding: '0' } }, [
        el('b', { style: { 'font-size': 'var(--fs-13)' }, text: I.t('editor.untimed') }),
        el('span', { class: 'untimed-note', text: I.t('editor.untimedDesc') })
      ]),
      untimedSwitch
    ]);

    var quickRow = el('div', { class: 'chips' });
    [['editor.quick.today', 0], ['editor.quick.tomorrow', 1], ['editor.quick.nextWeek', 7]].forEach(function (pair) {
      quickRow.appendChild(el('button', {
        class: 'chip', type: 'button', text: I.t(pair[0]),
        onClick: function () {
          var p = D.parts(draft.dueAt);
          var base = D.addDays(D.startOfDay(Date.now()), pair[1]);
          var bp = D.parts(base);
          draft.dueAt = D.fromParts({ y: bp.y, m: bp.m, d: bp.d, H: p.H, M: p.M, S: 0 });
          paintWhen();
        }
      }));
    });

    // reminder
    var remindSwitch = W.switchEl(draft.remind, function (on) {
      draft.remind = on;
      offsetWrap.hidden = !on;
      paintOccurrences();
    }, I.t('editor.reminder'));
    var remindHint = el('div', { class: 'hint', text: I.t('editor.untimedNoRemind') });
    var offsetWrap = el('div', { class: 'col', style: { gap: '6px' } });
    var offsetChips = W.chips(OFFSETS.map(function (m) {
      return { value: m, label: I.t(OFFSET_KEYS[m] || 'offset.at') };
    }), draft.remindOffset, function (v) {
      draft.remindOffset = Number(v);
      paintOccurrences();
    });
    offsetWrap.appendChild(el('div', { class: 'label', text: I.t('editor.remindBefore') }));
    offsetWrap.appendChild(offsetChips);
    offsetWrap.hidden = !draft.remind;

    /** Untimed goals carry no alarm at all (V2.4): the reminder controls stand down. */
    function paintReminder() {
      remindSwitch.disabled = !!draft.untimed;
      offsetWrap.hidden = !draft.remind || !!draft.untimed;
      remindHint.hidden = !draft.untimed;
    }

    // recurrence
    var rule = R.parse(draft.rec);
    var recSeg = W.segmented([
      { value: 'none', label: I.t('repeat.none') },
      { value: 'daily', label: I.t('repeat.daily') },
      { value: 'weekly', label: I.t('repeat.weekly') },
      { value: 'monthly', label: I.t('repeat.monthly') }
    ], rule.kind, function (v) {
      rule.kind = v;
      if (v === 'none') rule.interval = 1;
      if (v === 'weekly' && !rule.mask) rule.mask = 1 << (D.parts(draft.dueAt).iso - 1);
      draft.rec = R.format(rule);
      paintRec();
    });

    // specific-weekday multi-select (e.g. Sat + Mon + Wed)
    var dowWrap = el('div', { class: 'col', style: { gap: '6px' } });
    var dowChips = {};
    var dowGrid = el('div', { class: 'dow-chips' });
    [6, 7, 1, 2, 3, 4, 5].forEach(function (iso) {
      var b = el('button', {
        class: 'dow-chip', type: 'button',
        'aria-pressed': !!((rule.mask || 0) & (1 << (iso - 1))),
        text: I.dowShortByIso(iso)
      });
      b.addEventListener('click', function () {
        var bit = 1 << (iso - 1);
        rule.mask = (rule.mask || 0) ^ bit;
        b.setAttribute('aria-pressed', (rule.mask & bit) ? 'true' : 'false');
        draft.rec = R.format(rule);
        if (bridge.vibrate) bridge.vibrate(5);
        paintOccurrences();
      });
      dowChips[iso] = b;
      dowGrid.appendChild(b);
    });
    dowWrap.appendChild(el('div', { class: 'label', text: I.t('repeat.pickDays') }));
    dowWrap.appendChild(dowGrid);

    var intervalWrap = el('div', { class: 'col', style: { gap: '6px' } });
    var intervalLabel = el('div', { class: 'label' });
    var intervalValue = rule.interval || 1;
    var intervalStepper = W.stepper(intervalValue, 1, 90, function (v) {
      intervalValue = v; rule.interval = v; draft.rec = R.format(rule); paintRec();
    });
    intervalWrap.appendChild(intervalLabel);
    intervalWrap.appendChild(intervalStepper);

    var domWrap = el('div', { class: 'col', style: { gap: '6px' } });
    var domLabel = el('div', { class: 'label', text: I.t('repeat.dayOfMonth') });
    var domValue = rule.dom || 0;                       // 0 = automatic (the due day)
    var domStepper = W.stepper(domValue, 0, 31, function (v) {
      domValue = v; rule.dom = v > 0 ? v : null; draft.rec = R.format(rule); paintRec();
    });
    var domHint = el('div', { class: 'hint' });
    domWrap.appendChild(domLabel);
    domWrap.appendChild(domStepper);
    domWrap.appendChild(domHint);

    // end of repetition
    var endSeg = W.segmented([
      { value: 'never', label: I.t('end.never') },
      { value: 'count', label: I.t('end.count') },
      { value: 'date', label: I.t('end.date') }
    ], (draft.recEnd && draft.recEnd.mode) || 'never', function (v) {
      draft.recEnd = v === 'count' ? { mode: 'count', n: draft.recEnd && draft.recEnd.n ? draft.recEnd.n : 10 }
        : v === 'date' ? { mode: 'date', at: draft.recEnd && draft.recEnd.at ? draft.recEnd.at : D.addDays(draft.dueAt, 30) }
          : { mode: 'never' };
      paintRec();
    });

    var endWrap = el('div', { class: 'col', style: { gap: '6px' } });
    var endCountRow = el('div', { class: 'row-between', style: { gap: '10px' } });
    var endCountLabel = el('div', { class: 'label', text: I.t('end.countLabel') });
    var endCountStepper = W.stepper((draft.recEnd && draft.recEnd.n) || 10, 1, 999, function (v) {
      draft.recEnd = { mode: 'count', n: v };
      paintRec();
    });
    endCountRow.appendChild(endCountLabel);
    endCountRow.appendChild(endCountStepper);

    var endDateBtn = el('button', { class: 'dt-btn', type: 'button' }, [icon('calendar'), el('span', { class: 'num' })]);
    endDateBtn.addEventListener('click', function () {
      var init = draft.recEnd && draft.recEnd.at ? draft.recEnd.at : D.addDays(draft.dueAt, 30);
      W.pickDate(init, { weekStart: s.weekStart, title: I.t('end.dateLabel') }).then(function (ms) {
        if (ms == null) return;
        var p = D.parts(ms);
        draft.recEnd = { mode: 'date', at: D.endOfDay(D.fromParts({ y: p.y, m: p.m, d: p.d })) };
        paintRec();
      });
    });
    var endDateRow = el('div', { class: 'row-between', style: { gap: '10px' } }, [
      el('div', { class: 'label', text: I.t('end.dateLabel') }), endDateBtn
    ]);
    endWrap.appendChild(endCountRow);
    endWrap.appendChild(endDateRow);

    var occPreview = el('div', { class: 'col', style: { gap: '5px' } });

    function paintRec() {
      var repeating = rule.kind !== 'none';
      intervalWrap.hidden = !repeating;
      domWrap.hidden = rule.kind !== 'monthly';
      dowWrap.hidden = rule.kind !== 'weekly';
      [6, 7, 1, 2, 3, 4, 5].forEach(function (iso) {
        dowChips[iso].setAttribute('aria-pressed', ((rule.mask || 0) & (1 << (iso - 1))) ? 'true' : 'false');
      });
      endSeg.parentElement.hidden = !repeating;
      endWrap.hidden = !repeating || (draft.recEnd && draft.recEnd.mode === 'never');
      occPreview.hidden = !repeating;

      intervalLabel.textContent = rule.kind === 'daily' ? I.t('repeat.everyDays')
        : rule.kind === 'weekly' ? I.t('repeat.weekInterval')
          : I.t('repeat.everyMonths');
      domHint.textContent = domValue > 0 ? '' : I.t('repeat.dayOfMonthAuto');

      if (draft.recEnd && draft.recEnd.mode === 'date') {
        endDateBtn.querySelector('span').textContent = I.fmtDate(draft.recEnd.at);
      }
      paintOccurrences();
    }

    function paintOccurrences() {
      DOM.clear(occPreview);
      if (rule.kind === 'none') {
        var trig = draft.dueAt - (draft.remindOffset || 0) * 60000;
        occPreview.appendChild(el('div', { class: 'hint' }, [
          draft.remind
            ? el('span', { text: I.t('editor.reminderOn') + ' · ' + I.fmtDateTime(trig) })
            : el('span', { text: I.t('editor.reminderOff') })
        ]));
        return;
      }
      var list = R.occurrences(draft.rec, draft.dueAt, draft.recEnd, Date.now(), Date.now() + 120 * D.DAY, 4);
      if (!list.length) list = R.occurrences(draft.rec, draft.dueAt, draft.recEnd, draft.dueAt, draft.dueAt + 400 * D.DAY, 4);
      occPreview.appendChild(el('div', { class: 'label' }, [
        icon('repeat', 'ic-sm'),
        el('span', { text: ' ' + I.describeRecurrence(draft.rec, domValue || D.parts(draft.dueAt).d) + ' · ' + I.t('editor.nextOccurrences') })
      ]));
      list.forEach(function (at) {
        occPreview.appendChild(el('div', { class: 'tiny faint num', text: '· ' + I.fmtDateTime(at) }));
      });
      var total = draft.recEnd && draft.recEnd.mode === 'count'
        ? I.describeCount(draft.recEnd.n)
        : (draft.recEnd && draft.recEnd.mode === 'date' ? I.t('end.date') + ': ' + I.fmtDate(draft.recEnd.at) : I.t('end.never'));
      occPreview.appendChild(el('div', { class: 'tiny', style: { color: 'var(--brand)' }, text: total }));
    }

    var errorHint = el('div', { class: 'hint is-error' });
    refs.errorHint = errorHint;

    // ---------------------------------------------------------------- body

    var body = [
      el('div', { class: 'field' }, [el('div', { class: 'label', text: I.t('editor.title') }), titleInput, errorHint]),
      el('div', { class: 'field' }, [el('div', { class: 'label', text: I.t('editor.quadrant') }), quadPicker]),
      el('div', { class: 'field' }, [
        el('div', { class: 'label', text: I.t('editor.when') }),
        el('div', { class: 'dt-row' }, [dateBtn, timeBtn]),
        quickRow,
        untimedRow
      ]),
      el('div', { class: 'card card-pad col', style: { gap: '12px' } }, [
        el('div', { class: 'row-between' }, [
          el('div', { class: 'set-text' }, [
            el('b', { text: I.t('editor.reminder') }),
            el('span', { text: draft.remind ? I.t('editor.reminderOn') : I.t('editor.reminderOff') })
          ]),
          remindSwitch
        ]),
        remindHint,
        offsetWrap
      ]),
      el('div', { class: 'field', style: { gap: '10px' } }, [
        el('div', { class: 'label', text: I.t('editor.repeat') }),
        recSeg, intervalWrap, dowWrap, domWrap
      ]),
      el('div', { class: 'field', style: { gap: '10px' } }, [
        el('div', { class: 'label', text: I.t('editor.repeatEnd') }),
        endSeg, endWrap
      ]),
      occPreview,
      el('div', { class: 'field' }, [el('div', { class: 'label', text: I.t('editor.notes') }), notesInput])
    ];

    // ---------------------------------------------------------------- footer

    var footer = [];
    if (existing) {
      footer.push(el('button', {
        class: 'btn btn-danger', type: 'button', 'aria-label': I.t('editor.delete'),
        onClick: onDelete
      }, [icon('trash')]));
      if (existing.rec && existing.rec !== 'NONE' && !existing.closedAt) {
        footer.push(el('button', {
          class: 'btn btn-ghost', type: 'button', text: I.t('editor.closeSeries'),
          onClick: function () {
            store.closeSeries(existing.id);
            W.toast(I.t('task.seriesClosed'), { icon: 'check' });
            sheet.close();
          }
        }));
      }
    }
    footer.push(el('button', {
      class: 'btn btn-primary grow', type: 'button',
      text: existing ? I.t('editor.save') : I.t('editor.saveNew'),
      onClick: onSave
    }));

    function onSave() {
      var title = (draft.title || '').trim();
      if (!title) {
        errorHint.textContent = I.t('editor.errorTitle');
        titleInput.classList.add('is-error');
        titleInput.focus();
        if (bridge.vibrate) bridge.vibrate(30);
        return;
      }
      if (!draft.dueAt) {
        errorHint.textContent = I.t('editor.errorDue');
        return;
      }
      if (rule.kind === 'weekly') {
        // the series must always contain the day the task itself sits on
        rule.mask = (rule.mask || 0) | (1 << (D.parts(draft.dueAt).iso - 1));
      }
      var patch = {
        title: title,
        notes: (draft.notes || '').trim(),
        imp: draft.imp, urg: draft.urg,
        dueAt: draft.untimed ? D.startOfDay(draft.dueAt) : draft.dueAt,
        untimed: !!draft.untimed,
        remind: draft.remind,
        remindOffset: draft.remindOffset || 0,
        rec: R.format(rule),
        recEnd: R.normalizeEnd(draft.recEnd)
      };
      if (existing) {
        store.updateTask(existing.id, patch);
        W.toast(I.t('task.saved'), { icon: 'check' });
      } else {
        var t = store.addTask(patch);
        W.toast(I.t('task.saved'), { icon: 'check' });
        if (conf.onSaved) conf.onSaved(t);
      }
      sheet.close();
    }

    function onDelete() {
      W.confirmDialog({
        title: I.t('task.deleteConfirmTitle'),
        body: I.t('task.deleteConfirmBody', { title: existing.title }),
        okLabel: I.t('confirm.delete'),
        danger: true
      }).then(function (ok) {
        if (!ok || !existing) return;
        var snapshot = U.clone(existing);
        store.deleteTask(existing.id);
        sheet.close();
        W.toast(I.t('editor.deleted'), {
          icon: 'trash',
          actionLabel: I.t('task.undo'),
          duration: 6000,
          onAction: function () {
            store.restoreTask(snapshot);
            W.toast(I.t('task.saved'), { icon: 'check' });
          }
        });
        if (conf.onDeleted) conf.onDeleted(snapshot);
      });
    }

    sheet = W.openSheet({
      title: existing ? I.t('editor.edit') : I.t('editor.new'),
      sub: existing ? I.fmtDateTime(existing.dueAt) : I.t('app.tagline'),
      body: body,
      footer: footer,
      onClose: function () { if (conf.onClose) conf.onClose(); }
    });

    paintWhen();
    paintRec();
    paintReminder();
    setTimeout(function () {
      try { titleInput.focus(); } catch (e) { /* keyboard may be suppressed on first paint */ }
    }, 320);

    return sheet;
  }

  return { open: open };
});
