/* ui/matrix.view.js — V2.2: the Eisenhower matrix as ONE vertically scrollable column of
 * four full-width, elegantly tinted section cards (no 2×2 grid, no inner scrolling).
 *
 * Why: full-width rows give Arabic titles ample room, so words never break mid-word and
 * rows auto-expand instead of clipping; the whole screen scrolls as one natural surface.
 * Drag & drop still works: reorder inside a section, or drag a card onto another section
 * to reclassify it (the page scroller auto-scrolls near its edges during the drag).
 */
(function (root, factory) {
  var K = root.K = root.K || {};
  K.views = K.views || {};
  K.views.matrix = factory(K.util, K.dom, K.date, K.i18n, K.model, K.matrix, K.store, K.ui, K.dnd, K.bridge, K.views);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, DOM, D, I, M, MX, store, W, dnd, bridge, views) {
  'use strict';

  var el = DOM.el, icon = DOM.svgIcon;

  var els = {};
  var mounted = false;
  var lastDragEnd = 0;
  var dndController = null;
  var quoteText = '';

  function quadVars(q) {
    return {
      '--qc': 'var(' + q.varName + ')',
      '--qc-soft': 'var(' + q.varName + '-soft)',
      '--qc-ink': 'var(' + q.varName + '-ink)'
    };
  }

  /**
   * The occurrence a matrix row represents: the task's first OPEN (not completed)
   * occurrence — a missed one first, otherwise the next upcoming instance.
   * Fully completed / closed tasks return null and are filtered out of this ACTIVE
   * view (they stay in the database and remain reviewable in the week's completed
   * section and in past days).
   */
  function currentOccurrence(task, now) {
    if (!task || !task.dueAt) return null;
    var open = M.openOccurrences(task, now - 60 * D.DAY, now + 400 * D.DAY, 1);
    return open.length ? open[0] : null;
  }

  // ------------------------------------------------------------------ build

  function build() {
    els.lists = {};
    els.cells = {};
    els.counts = {};
    els.names = {};
    els.subs = {};

    // minimalist motivational banner at the very top of the home screen
    els.quoteText = el('p', { class: 'qb-text', text: quoteText });
    els.quote = el('div', { class: 'quote-banner qb-home', role: 'note' }, [
      el('span', { class: 'qb-mark', 'aria-hidden': 'true' }, '”'),
      els.quoteText
    ]);

    var stack = el('div', { class: 'matrix-stack scroller' });
    stack.appendChild(els.quote);

    MX.QUADRANTS.forEach(function (q) {
      var list = el('div', { class: 'quad-list', 'data-list': q.key, role: 'list', 'aria-label': I.t('matrix.' + q.key + '.name') });
      var count = el('span', { class: 'quad-count num', text: '0', hidden: true });
      var name = el('span', { class: 'quad-name', text: I.t('matrix.' + q.key + '.name') });
      var sub = el('span', { class: 'quad-sub grow', text: I.t('matrix.' + q.key + '.sub') });

      var cell = el('section', { class: 'quad', 'data-quad': q.key, style: quadVars(q) }, [
        el('div', { class: 'quad-head' }, [
          el('span', { class: 'quad-ico' }, [icon(q.icon)]),
          name,
          sub,
          count,
          el('button', {
            class: 'quad-add', type: 'button', 'data-add': q.key,
            'aria-label': I.t('editor.new') + ' · ' + I.t('matrix.' + q.key + '.name')
          }, [icon('plus')])
        ]),
        list
      ]);

      els.lists[q.key] = list;
      els.cells[q.key] = cell;
      els.counts[q.key] = count;
      els.names[q.key] = name;
      els.subs[q.key] = sub;
      stack.appendChild(cell);
    });

    els.hint = el('div', { class: 'matrix-hint', role: 'note' }, [
      icon('drag', 'ic-sm'),
      el('span', { text: I.t('matrix.hint') })
    ]);
    stack.appendChild(els.hint);

    els.scroller = stack;
    els.root = el('div', { class: 'matrix-screen' }, [stack]);
    return els.root;
  }

  // ------------------------------------------------------------------ dnd

  function attachDnd() {
    if (dndController) { dndController.destroy(); dndController = null; }
    dndController = dnd.attach({
      containerEl: els.scroller,
      itemSelector: '.task',
      handleSelector: '.task-grip',
      zones: function () {
        return MX.QUADRANTS.map(function (q) {
          return {
            id: q.key,
            listEl: els.lists[q.key],
            highlightEl: els.cells[q.key],
            scrollEl: els.scroller,          // the page scroller auto-scrolls during drags
            itemSelector: '.task'
          };
        });
      },
      modelOf: function (node) { return store.taskById(node.getAttribute('data-id')); },
      onDrop: function (info) {
        lastDragEnd = Date.now();
        if (!info.model) { render(store.get(), Date.now()); return; }
        if (info.zone !== info.fromZone) {
          store.moveToQuadrant(info.model.id, info.zone, info.index);
          bridge.vibrate(14);
          W.toast(I.t('task.moved', { quad: I.quadrantName(info.zone) }), { icon: 'grid' });
        } else if (info.index !== info.fromIndex) {
          store.reorder(info.fromZone, info.fromIndex, info.index);
        }
        render(store.get(), Date.now());
      },
      onDragEnd: function () {
        lastDragEnd = Date.now();
        render(store.get(), Date.now());   // guarantees DOM ⇄ store agreement after a cancel
      }
    });
  }

  // ------------------------------------------------------------------ events

  function onClick(e) {
    if (Date.now() - lastDragEnd < 260) return;                    // the click that ends a drag
    if (Date.now() - (Number(document.body.dataset.navswipe) || 0) < 320) return;  // click after a nav swipe

    var addBtn = e.target.closest('[data-add]');
    if (addBtn) {
      views.editor.open({ quadrant: addBtn.getAttribute('data-add') });
      return;
    }
    var act = e.target.closest('[data-act="toggle"]');
    var card = e.target.closest('.task');
    if (!card) return;
    var id = card.getAttribute('data-id');
    var task = store.taskById(id);
    if (!task) return;
    var occ = Number(card.getAttribute('data-occ'));

    if (act) {
      var done = card.classList.contains('is-done');
      if (done) {
        store.setOccurrenceDone(id, occ, false);
        bridge.vibrate(8);
        W.toast(I.t('task.undone'), { icon: 'repeat' });
        return;
      }
      // show the check, breathe 400 ms, then slide the row out of the active view
      W.completeWithHold(card, function () {
        store.setOccurrenceDone(id, occ, true);
      });
      bridge.vibrate(16);
      W.toast(I.t('task.completed'), { icon: 'check' });
      return;
    }
    views.editor.open({ taskId: id });
  }

  function wire() {
    els.root.addEventListener('click', onClick);
    els.hint.addEventListener('click', function () {
      store.setSetting('matrixHintSeen', (store.settings().matrixHintSeen || 0) + 1);
    });
  }

  function mount(host) {
    if (mounted) return;
    mounted = true;
    host.appendChild(build());
    wire();
    attachDnd();
  }

  /** The app shell owns quote rotation (per launch and per re-entry). */
  function setQuote(text) {
    quoteText = text || '';
    if (els.quoteText) els.quoteText.textContent = quoteText;
  }

  // ------------------------------------------------------------------ render

  function render(state, now) {
    if (!mounted) return;
    var n = now || Date.now();
    var grouped = MX.group(state.tasks);

    MX.QUADRANTS.forEach(function (q) {
      var list = els.lists[q.key];
      var items = grouped[q.key] || [];
      var openCount = 0;

      DOM.clear(list);
      if (!items.length) {
        list.appendChild(el('div', { class: 'quad-empty' }, [
          icon(q.icon),
          el('div', { text: I.t('matrix.empty') })
        ]));
      } else {
        var frag = document.createDocumentFragment();
        for (var i = 0; i < items.length; i++) {
          var t = items[i];
          var occ = currentOccurrence(t, n);
          if (occ == null) continue;                 // completed/closed ⇒ hidden, not deleted
          openCount++;
          frag.appendChild(W.taskCard({
            task: t, at: occ, done: false,
            overdue: M.isOccurrenceOverdue(t, occ, n)
          }, { now: n, showDate: true, showQuadrant: false }));
        }
        list.appendChild(frag);
        if (!list.firstChild) {
          list.appendChild(el('div', { class: 'quad-empty' }, [
            icon(q.icon),
            el('div', { text: I.t('matrix.empty') })
          ]));
        }
      }
      els.counts[q.key].textContent = String(openCount);
      els.counts[q.key].hidden = openCount === 0;
      els.names[q.key].textContent = I.t('matrix.' + q.key + '.name');
      els.subs[q.key].textContent = I.t('matrix.' + q.key + '.sub');
    });

    var seen = state.settings.matrixHintSeen || 0;
    els.hint.hidden = seen >= 3 || state.tasks.length === 0;
  }

  function relayout() {
    if (!mounted || !els.root || !els.root.parentNode) return;
    var host = els.root.parentNode;
    var stale = els.root;            // build() reassigns els.root, so capture it first
    var fresh = build();
    host.replaceChild(fresh, stale);
    els.root = fresh;
    wire();
    attachDnd();
    render(store.get(), Date.now());
  }

  return {
    id: 'matrix',
    setQuote: setQuote,
    mount: mount,
    render: render,
    relayout: relayout,
    currentOccurrence: currentOccurrence
  };
});
