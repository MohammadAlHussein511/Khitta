/* ui/week.view.js — Saturday→Friday week: day strip, motivational banner, list OR table
 * view with configurable sorting, pending vs completed, drag-to-reschedule, and strict
 * read-only integrity for past days (history is for learning, not editing). */
(function (root, factory) {
  var K = root.K = root.K || {};
  K.views = K.views || {};
  K.views.week = factory(K.util, K.dom, K.date, K.i18n, K.model, K.matrix, K.week, K.store, K.ui, K.dnd, K.bridge, K.views);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, DOM, D, I, M, MX, WK, store, W, dnd, bridge, views) {
  'use strict';

  var el = DOM.el, icon = DOM.svgIcon;

  var els = {};
  var mounted = false;
  var weekOffset = 0;
  var selIndex = -1;              // -1 ⇒ resolve to "today" on the next render
  var pinned = false;             // true once the user deliberately chose another day/week
  var lastDragEnd = 0;
  var dragHintShown = false;
  var dndController = null;
  var quote = null;

  var SORTS = ['manual', 'time', 'quadrant', 'created'];

  function quadVars(q) {
    return {
      '--qc': 'var(' + q.varName + ')',
      '--qc-soft': 'var(' + q.varName + '-soft)',
      '--qc-ink': 'var(' + q.varName + '-ink)'
    };
  }

  function sortMode() { return store.settings().weekSort || 'manual'; }
  function viewMode() { return store.settings().weekView || 'list'; }
  function selectedDay(state, now) {
    var bounds = WK.weekBounds(now, weekOffset, state.settings.weekStart);
    var idx = selIndex >= 0 && selIndex <= 6 ? selIndex : 0;
    return { bounds: bounds, day: WK.dayPlan(state, bounds.days[idx], now), idx: idx };
  }
  function isReadonlyNow(now) {
    var bounds = WK.weekBounds(now == null ? Date.now() : now, weekOffset, store.settings().weekStart);
    var idx = selIndex >= 0 && selIndex <= 6 ? selIndex : 0;
    return WK.isReadOnlyDay(bounds.days[idx], now);
  }

  // ------------------------------------------------------------------ build

  function build() {
    els.title = el('div', { class: 'week-title', text: '' });
    els.range = el('div', { class: 'week-range num', text: '' });
    els.todayBtn = el('button', { class: 'btn-today', type: 'button', text: I.t('week.today') });

    els.strip = el('div', { class: 'day-strip', role: 'tablist', 'aria-label': I.t('nav.week') });
    els.chips = [];
    for (var i = 0; i < 7; i++) {
      var chip = el('button', {
        class: 'day-chip', type: 'button', role: 'tab', 'data-day': String(i)
      }, [
        el('span', { class: 'dow', text: '' }),
        el('span', { class: 'dnum num', text: '' }),
        el('span', { class: 'dots' })
      ]);
      els.chips.push(chip);
      els.strip.appendChild(chip);
    }

    els.pills = el('div', { class: 'day-summary' });
    els.progressFill = el('i');
    els.progress = el('div', { class: 'day-progress' }, [els.progressFill]);

    // motivational banner (one phrase per launch)
    els.quoteText = el('p', { class: 'qb-text', text: '' });
    els.quote = el('div', { class: 'quote-banner', role: 'note' }, [
      el('span', { class: 'qb-mark', 'aria-hidden': 'true' }, '”'),
      els.quoteText
    ]);

    // toolbar: view toggle + sorting + read-only pill
    els.viewSeg = W.segmented([
      { value: 'list', label: '', icon: 'i-list' },
      { value: 'grid', label: '', icon: 'i-table' }
    ], viewMode(), function (v) {
      store.setSetting('weekView', v);
      render(store.get(), Date.now());
    });
    els.viewSeg.querySelectorAll('button').forEach(function (b, bi) {
      DOM.clear(b);
      b.appendChild(icon(bi === 0 ? 'list' : 'table', 'ic-sm'));
      b.setAttribute('aria-label', I.t(bi === 0 ? 'week.viewList' : 'week.viewGrid'));
      b.title = I.t(bi === 0 ? 'week.viewList' : 'week.viewGrid');
    });
    els.sortChips = el('div', { class: 'sort-chips' });
    els.sortNodes = {};
    SORTS.forEach(function (mode) {
      var c = el('button', {
        class: 'chip', type: 'button', text: I.t('sort.' + mode),
        'aria-pressed': String(sortMode() === mode)
      });
      c.addEventListener('click', function () {
        store.setSetting('weekSort', mode);
        render(store.get(), Date.now());
        bridge.vibrate(5);
      });
      els.sortNodes[mode] = c;
      els.sortChips.appendChild(c);
    });
    els.lockPill = el('span', { class: 'lock-pill', hidden: true }, [
      icon('lock', 'ic-sm'), el('span', { text: I.t('week.readonly') })
    ]);
    els.tools = el('div', { class: 'week-tools' }, [els.viewSeg, els.sortChips, els.lockPill]);

    els.hint = el('div', { class: 'week-hint tiny faint' }, [icon('drag', 'ic-sm'), el('span', { text: I.t('week.dragHint') })]);

    els.pendingList = el('div', { class: 'week-list', 'data-list': 'pending', role: 'list' });
    els.doneList = el('div', { class: 'week-list', 'data-list': 'done', role: 'list' });
    els.pendingHead = el('div', { class: 'section-head' }, [
      el('span', { class: 'h-section', text: I.t('week.pending') }),
      el('span', { class: 'count num', text: '0' })
    ]);
    els.doneHead = el('div', { class: 'section-head' }, [
      el('span', { class: 'h-section', text: I.t('week.done') }),
      el('span', { class: 'count num', text: '0' })
    ]);
    els.pendingSection = el('div', { class: 'section' }, [els.pendingHead, els.pendingList]);
    els.doneSection = el('div', { class: 'section' }, [els.doneHead, els.doneList]);
    els.emptyHost = el('div', { class: 'section' });

    els.scroller = el('div', { class: 'scroller' }, [
      els.quote, els.emptyHost, els.pendingSection, els.doneSection
    ]);

    els.root = el('div', { class: 'week-screen' }, [
      el('div', { class: 'week-head' }, [
        el('div', { class: 'week-nav' }, [
          el('button', { class: 'nav-btn', type: 'button', 'data-nav': '-1', 'aria-label': I.t('week.prev') }, [icon('chevron-start')]),
          el('div', { class: 'col', style: { gap: '1px' } }, [els.title, els.range]),
          el('button', { class: 'nav-btn', type: 'button', 'data-nav': '1', 'aria-label': I.t('week.next') }, [icon('chevron-end')]),
          els.todayBtn
        ]),
        els.strip
      ]),
      els.pills,
      els.progress,
      els.tools,
      els.hint,
      els.scroller
    ]);
    return els.root;
  }

  // ------------------------------------------------------------------ dnd

  function attachDnd() {
    if (dndController) { dndController.destroy(); dndController = null; }
    dndController = dnd.attach({
      containerEl: els.pendingList,
      itemSelector: '.task',
      handleSelector: '.task-grip',
      canStart: function (node) {
        if (node.getAttribute('data-readonly')) return false;
        return sortMode() === 'manual';
      },
      zones: function () {
        var zones = [{
          id: 'pending',
          listEl: els.pendingList,
          highlightEl: els.pendingList,
          scrollEl: els.scroller,
          itemSelector: '.task'
        }];
        els.chips.forEach(function (chip, i) {
          zones.push({ id: 'day:' + i, listEl: chip, highlightEl: chip, scrollEl: chip, itemSelector: '.task' });
        });
        return zones;
      },
      modelOf: function (node) { return store.taskById(node.getAttribute('data-id')); },
      onDrop: function (info) {
        lastDragEnd = Date.now();
        dragHintShown = true;
        if (info.model && String(info.zone).indexOf('day:') === 0 && !isReadonlyNow(Date.now())) {
          var idx = Number(String(info.zone).slice(4));
          var bounds = WK.weekBounds(Date.now(), weekOffset, store.settings().weekStart);
          var targetDay = bounds.days[idx];
          var t = info.model;
          var p = D.parts(t.dueAt || Date.now());
          var tp = D.parts(targetDay);
          if (!D.sameDay(t.dueAt, targetDay)) {
            var newDue = D.fromParts({ y: tp.y, m: tp.m, d: tp.d, H: p.H, M: p.M, S: 0 });
            store.reschedule(t.id, newDue);
            bridge.vibrate(16);
            W.toast(I.t(t.rec && t.rec !== 'NONE' ? 'week.rescheduledSeries' : 'week.rescheduled', {
              day: I.fmtDayLabel(targetDay)
            }), { icon: 'calendar' });
          }
        }
        render(store.get(), Date.now());
      },
      onDragEnd: function () { lastDragEnd = Date.now(); render(store.get(), Date.now()); }
    });
  }

  // ------------------------------------------------------------------ past-day integrity

  function showPastModal() {
    bridge.vibrate(12);
    var m = W.openModal({
      title: I.t('past.title'),
      body: I.t('past.body'),
      content: el('div', { class: 'm-ico', style: { 'margin-block-end': '4px' } }, [icon('flame', 'ic-lg')])
    });
    m.root.classList.add('is-center');
    DOM.clear(m.root.querySelector('.modal-actions'));
    m.root.querySelector('.modal-actions').appendChild(
      el('button', {
        class: 'btn btn-primary', type: 'button', text: I.t('week.jumpToday'),
        onClick: function () { m.close(); focusToday(); }
      })
    );
  }

  // ------------------------------------------------------------------ events

  function onClick(e) {
    if (Date.now() - lastDragEnd < 260) return;
    if (Date.now() - (Number(document.body.dataset.navswipe) || 0) < 320) return;  // post-swipe click

    var nav = e.target.closest('[data-nav]');
    if (nav) {
      weekOffset += Number(nav.getAttribute('data-nav'));
      selIndex = -1;
      pinned = true;
      render(store.get(), Date.now());
      return;
    }
    if (e.target.closest('.btn-today')) { focusToday(); return; }
    var chip = e.target.closest('.day-chip');
    if (chip) {
      selIndex = Number(chip.getAttribute('data-day'));
      pinned = true;
      render(store.get(), Date.now());
      bridge.vibrate(5);
      return;
    }

    var card = e.target.closest('.task, .wgrid-row');
    if (card) {
      if (card.getAttribute('data-readonly')) { showPastModal(); return; }   // history: motivate, don't edit
      var id = card.getAttribute('data-id');
      var occ = Number(card.getAttribute('data-occ'));
      if (e.target.closest('[data-act="toggle"]')) {
        var done = card.classList.contains('is-done');
        if (done) {
          store.setOccurrenceDone(id, occ, false);
          bridge.vibrate(8);
          return;
        }
        W.completeWithHold(card, function () {
          store.setOccurrenceDone(id, occ, true);
        });
        bridge.vibrate(16);
        W.toast(I.t('task.completed'), { icon: 'check' });
        return;
      }
      views.editor.open({ taskId: id });
      return;
    }
    if (e.target.closest('[data-add-day]')) addOnSelectedDay();
  }

  function addOnSelectedDay() {
    var now = Date.now();
    if (isReadonlyNow(now)) { showPastModal(); return; }
    var bounds = WK.weekBounds(now, weekOffset, store.settings().weekStart);
    var idx = selIndex >= 0 ? selIndex : Math.max(0, WK.weekIndexOfToday(bounds, now));
    var day = bounds.days[idx];
    var s = store.settings();
    var p = D.parts(day);
    var due = D.fromParts({
      y: p.y, m: p.m, d: p.d,
      H: D.sameDay(day, now) && D.parts(now).H < s.dayStartHour ? s.dayStartHour : (D.sameDay(day, now) ? Math.min(23, D.parts(now).H + 1) : s.dayStartHour),
      M: 0, S: 0
    });
    views.editor.open({ dueAt: due });
  }

  // ------------------------------------------------------------------ mount / render

  function mount(host) {
    if (mounted) return;
    mounted = true;
    host.appendChild(build());
    els.root.addEventListener('click', onClick);
    attachDnd();
    if (quote) els.quoteText.textContent = quote.text;
  }

  /** The app shell owns quote rotation (new phrase per launch and per re-entry). */
  function setQuote(text) {
    quote = { text: text };
    if (els.quoteText) els.quoteText.textContent = text || '';
  }

  function cardFor(e, now, done, readonly) {
    return W.taskCard({
      task: e.task, at: e.at, done: done || e.done,
      overdue: e.overdue, doneAt: e.doneAt
    }, { now: now, showDate: false, showQuadrant: true, showNotes: false, readonly: readonly });
  }

  function gridRowFor(e, now, done, readonly) {
    var q = MX.byKey(e.quadrant || MX.keyOf(e.task));
    var overdue = e.overdue;
    return el('div', {
      class: 'wgrid-row' + (done ? ' is-done' : '') + (readonly ? ' is-readonly' : ''),
      'data-id': e.task.id, 'data-occ': String(e.at),
      'data-readonly': readonly ? '1' : null,
      style: quadVars(q)
    }, [
      el('button', {
        class: 'task-check', type: 'button', 'data-act': 'toggle',
        'aria-pressed': done ? 'true' : 'false', 'aria-label': I.t('a11y.toggleDone')
      }, [icon('check')]),
      el('div', { class: 'grow', style: { 'min-width': '0' } }, [
        el('div', { class: 'wg-title', text: e.task.title }),
        el('div', { class: 'wg-sub' }, [
          el('span', { class: 'badge is-q', style: W.tagStyleFor(q.key), text: I.quadrantName(q.key) }),
          e.task.untimed ? el('span', { class: 'badge', style: { 'margin-inline-start': '4px' }, text: I.t('task.untimed') }) : null
        ])
      ]),
      el('div', { class: 'wg-time num' + (overdue ? ' is-overdue' : '') }, [
        el('span', { text: e.task.untimed ? I.fmtDayLabel(e.at) : I.fmtTime(e.at) })
      ]),
      el('span', { style: { color: 'var(--text-3)', display: 'grid', 'place-items': 'center' } },
        [icon(e.task.rec && e.task.rec !== 'NONE' ? 'repeat' : (done ? 'check' : 'clock'), 'ic-sm')])
    ]);
  }

  function fill(host, entries, now, done, readonly, grid) {
    DOM.clear(host);
    if (!entries.length) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < entries.length; i++) {
      frag.appendChild(grid ? gridRowFor(entries[i], now, done, readonly) : cardFor(entries[i], now, done, readonly));
    }
    host.appendChild(frag);
  }

  function render(state, now) {
    if (!mounted) return;
    var n = now || Date.now();
    var settings = state.settings;
    var bounds = WK.weekBounds(n, weekOffset, settings.weekStart);
    var todayIdx = WK.weekIndexOfToday(bounds, n);
    if (selIndex < 0 || selIndex > 6) selIndex = todayIdx >= 0 ? todayIdx : 0;

    var day = WK.dayPlan(state, bounds.days[selIndex], n);
    var readonly = WK.isReadOnlyDay(bounds.days[selIndex], n);
    var grid = viewMode() === 'grid';
    var mode = sortMode();

    els.title.textContent = I.fmtMonthYear(bounds.days[3]);
    els.range.textContent = I.fmtWeekRange(bounds.start, D.startOfDay(bounds.days[6]));
    els.todayBtn.hidden = weekOffset === 0 && selIndex === todayIdx;

    for (var i = 0; i < 7; i++) {
      var d = WK.dayPlan(state, bounds.days[i], n);
      var chip = els.chips[i];
      var dp = D.parts(bounds.days[i]);
      chip.setAttribute('aria-selected', String(i === selIndex));
      chip.classList.toggle('is-today', i === todayIdx);
      chip.classList.toggle('is-dim', dp.m !== D.parts(bounds.days[3]).m);
      chip.querySelector('.dow').textContent = I.dowShortByIso(dp.iso);
      chip.querySelector('.dnum').textContent = String(dp.d);
      var dots = chip.querySelector('.dots');
      DOM.clear(dots);
      var seenQ = {}, shown = 0;
      for (var j = 0; j < d.pending.length && shown < 3; j++) {
        if (seenQ[d.pending[j].quadrant]) continue;
        seenQ[d.pending[j].quadrant] = 1;
        dots.appendChild(el('span', { class: 'dot', style: quadVars(MX.byKey(d.pending[j].quadrant)) }));
        shown++;
      }
      if (!shown && d.doneCount) dots.appendChild(el('span', { class: 'dot is-done' }));
    }

    DOM.clear(els.pills);
    els.pills.appendChild(el('span', { class: 'pill-stat' }, [
      el('span', { text: I.t('week.pending') }), el('b', { class: 'num', text: String(day.pendingCount) })
    ]));
    els.pills.appendChild(el('span', { class: 'pill-stat is-ok' }, [
      el('span', { text: I.t('week.done') }), el('b', { class: 'num', text: String(day.doneCount) })
    ]));
    if (day.overdueCount && !readonly) {
      els.pills.appendChild(el('span', { class: 'pill-stat is-late' }, [
        icon('alert', 'ic-sm'), el('b', { class: 'num', text: I.t('week.overdueIn', { n: day.overdueCount }) })
      ]));
    }
    els.progressFill.style.width = (day.total ? Math.round(day.doneCount / day.total * 100) : 0) + '%';
    els.progress.hidden = day.total === 0;

    // toolbar state
    els.lockPill.hidden = !readonly;
    els.viewSeg.querySelectorAll('button').forEach(function (b, bi) {
      b.setAttribute('aria-pressed', String((bi === 0 ? 'list' : 'grid') === viewMode()));
    });
    SORTS.forEach(function (m2) { els.sortNodes[m2].setAttribute('aria-pressed', String(m2 === mode)); });
    els.hint.hidden = readonly || (dragHintShown && mode === 'manual');
    els.hint.querySelector('span').textContent = mode === 'manual' ? I.t('week.dragHint') : I.t('sort.lockedHint');

    // lists / table
    var pending = WK.sortEntries(day.pending, mode);
    var completed = day.completed;
    DOM.clear(els.emptyHost);

    els.pendingList.className = grid ? 'wgrid' : 'week-list';
    els.doneList.className = grid ? 'wgrid' : 'week-list';

    fill(els.pendingList, pending, n, false, readonly, grid);
    fill(els.doneList, completed, n, true, readonly, grid);

    if (grid) {
      // header goes in after fill(), because fill() clears its host
      [els.pendingList, els.doneList].forEach(function (host) {
        if (!host.querySelector('.wgrid-head')) {
          host.insertBefore(el('div', { class: 'wgrid-head' }, [
            el('span'), el('span', { text: I.t('editor.title') }),
            el('span', { text: I.t('editor.time') }), el('span')
          ]), host.firstChild);
        }
      });
    }
    els.pendingHead.querySelector('.count').textContent = String(day.pendingCount);
    els.doneHead.querySelector('.count').textContent = String(day.doneCount);
    els.pendingSection.hidden = day.pendingCount === 0;
    els.doneSection.hidden = day.doneCount === 0;

    if (day.total === 0) {
      els.emptyHost.appendChild(W.emptyState({
        icon: readonly ? 'lock' : 'calendar',
        title: readonly ? I.t('week.readonly') : I.t('week.noTasks'),
        body: readonly ? I.t('past.body') : I.t('week.addOn', { day: I.fmtDayLabel(day.dayMs) }),
        actionLabel: readonly ? null : I.t('week.noTasksCta'),
        onAction: readonly ? null : addOnSelectedDay
      }));
    } else if (day.pendingCount === 0) {
      els.emptyHost.appendChild(el('div', { class: 'empty-state', style: { padding: 'var(--s5)' } }, [
        el('h3', { text: readonly ? I.t('week.readonly') : I.t('week.allDone') })
      ]));
    }
  }

  function relayout() {
    if (!mounted || !els.root || !els.root.parentNode) return;
    var host = els.root.parentNode;
    var stale = els.root;
    var fresh = build();
    host.replaceChild(fresh, stale);
    els.root = fresh;
    els.root.addEventListener('click', onClick);
    attachDnd();
    if (quote) els.quoteText.textContent = quote.text;
    render(store.get(), Date.now());
  }

  function focusToday() { weekOffset = 0; selIndex = -1; pinned = false; render(store.get(), Date.now()); }

  /**
   * Midnight rollover (or any system-date change): unless the user deliberately pinned
   * another day, snap the selection back to the new "today" so yesterday's list drops
   * away and the new day's instances (daily recurrences included) appear at once.
   */
  function onDateChanged() {
    if (!pinned) selIndex = -1;
    render(store.get(), Date.now());
  }

  function focusDay(ms) {
    if (!ms) { focusToday(); return; }
    var s = store.settings();
    var nowWeek = D.weekStart(Date.now(), s.weekStart);
    var targetWeek = D.weekStart(ms, s.weekStart);
    weekOffset = Math.round(D.diffDays(nowWeek, targetWeek) / 7);
    var bounds = WK.weekBounds(Date.now(), weekOffset, s.weekStart);
    selIndex = U.clamp(D.dayIndexInWeek(ms, bounds.start), 0, 6);
    pinned = true;
    render(store.get(), Date.now());
    flash(ms);
  }

  function flash(occMs) {
    setTimeout(function () {
      var node = els.root.querySelector('.task[data-occ="' + occMs + '"], .wgrid-row[data-occ="' + occMs + '"]');
      if (!node) return;
      node.classList.add('is-flash');
      try { node.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { node.scrollIntoView(); }
      setTimeout(function () { node.classList.remove('is-flash'); }, 2000);
    }, 140);
  }

  return {
    id: 'week',
    mount: mount, render: render, relayout: relayout,
    focusToday: focusToday, focusDay: focusDay, setQuote: setQuote,
    onDateChanged: onDateChanged,
    addOnSelectedDay: addOnSelectedDay,
    isReadonlyNow: isReadonlyNow, showPastModal: showPastModal
  };
});
