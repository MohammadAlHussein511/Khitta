/* ui/stats.view.js — the dashboard: completion ring, quadrant distribution, activity bars,
 * streak and workload tiles. Numbers come from the pure domain layer (K.stats). */
(function (root, factory) {
  var K = root.K = root.K || {};
  K.views = K.views || {};
  K.views.stats = factory(K.util, K.dom, K.date, K.i18n, K.model, K.matrix, K.stats, K.store, K.ui, K.bridge, K.views);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, DOM, D, I, M, MX, S, store, W, bridge, views) {
  'use strict';

  var el = DOM.el, icon = DOM.svgIcon;
  var els = {};
  var mounted = false;
  var R = 52, C = 2 * Math.PI * R;

  function quadVars(q) {
    return {
      '--qc': 'var(' + q.varName + ')',
      '--qc-soft': 'var(' + q.varName + '-soft)',
      '--qc-ink': 'var(' + q.varName + '-ink)'
    };
  }

  function build() {
    // hero: ring + facts
    // NOTE: SVG children must come from createElementNS — el() builds HTML nodes.
    var NS = 'http://www.w3.org/2000/svg';
    els.ringBar = document.createElementNS(NS, 'circle');
    els.ringBar.setAttribute('class', 'bar');
    els.ringBar.setAttribute('cx', '60');
    els.ringBar.setAttribute('cy', '60');
    els.ringBar.setAttribute('r', String(R));
    els.ringBar.setAttribute('stroke-dasharray', C.toFixed(1));
    els.ringBar.setAttribute('stroke-dashoffset', C.toFixed(1));
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    var defs = document.createElementNS(NS, 'defs');
    defs.innerHTML = '<linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">'
      + '<stop offset="0%" style="stop-color:var(--brand)"/>'
      + '<stop offset="100%" style="stop-color:var(--accent)"/>'
      + '</linearGradient>';
    svg.appendChild(defs);
    var track = document.createElementNS(NS, 'circle');
    track.setAttribute('class', 'track');
    track.setAttribute('cx', '60'); track.setAttribute('cy', '60'); track.setAttribute('r', String(R));
    svg.appendChild(track);
    svg.appendChild(els.ringBar);

    els.ringPct = el('b', { class: 'num', text: '0%' });
    els.ringCap = el('span', { text: I.t('stats.hero.done') });
    els.heroDone = el('b', { class: 'num', text: '0' });
    els.heroOf = el('span', { text: '' });
    els.heroToday = el('b', { class: 'num', text: '0' });
    els.heroOpen = el('b', { class: 'num', text: '0' });
    els.heroWindow = el('div', { class: 'tiny faint', text: '' });

    els.hero = el('div', { class: 'stat-hero' }, [
      el('div', { class: 'ring' }, [svg, el('div', { class: 'ring-label' }, [els.ringPct, els.ringCap])]),
      el('div', { class: 'hero-facts grow' }, [
        el('div', { class: 'fact' }, [els.heroDone, els.heroOf]),
        el('div', { class: 'row', style: { gap: 'var(--s5)' } }, [
          el('div', { class: 'fact' }, [els.heroToday, el('span', { text: I.t('stats.fact.today') })]),
          el('div', { class: 'fact' }, [els.heroOpen, el('span', { text: I.t('stats.fact.open') })])
        ]),
        els.heroWindow
      ])
    ]);

    // quadrant distribution
    els.quadGrid = el('div', { class: 'quad-grid' });
    els.quadCards = {};
    MX.QUADRANTS.forEach(function (q) {
      var bar = el('i');
      var n = el('span', { class: 'qs-n num', text: '0' });
      var sub = el('span', { class: 'qs-sub', text: '' });
      var card = el('div', { class: 'quad-stat', style: quadVars(q), 'data-quad': q.key }, [
        el('div', { class: 'qs-top' }, [
          el('span', { class: 'qo-ico', style: quadVars(q) }, [icon(q.icon, 'ic-sm')]),
          el('span', { class: 'qs-name', text: I.t('matrix.' + q.key + '.name') }),
          n
        ]),
        el('div', { class: 'qs-bar' }, [bar]),
        sub
      ]);
      els.quadCards[q.key] = { root: card, bar: bar, n: n, sub: sub, name: card.querySelector('.qs-name') };
      els.quadGrid.appendChild(card);
    });

    // tiles
    els.tiles = {};
    var tileDefs = [
      { key: 'overdue', icon: 'alert', color: 'var(--danger)', soft: 'var(--danger-soft)' },
      { key: 'today', icon: 'clock', color: 'var(--brand)', soft: 'var(--brand-soft)' },
      { key: 'next7', icon: 'calendar', color: 'var(--q3)', soft: 'var(--q3-soft)' },
      { key: 'streak', icon: 'flame', color: 'var(--q2)', soft: 'var(--q2-soft)' }
    ];
    els.tileGrid = el('div', { class: 'tile-grid' });
    tileDefs.forEach(function (d) {
      var val = el('b', { class: 'num', text: '0' });
      var cap = el('span', { text: '' });
      var card = el('div', { class: 'tile' }, [
        el('span', { class: 't-ico', style: { background: d.soft, color: d.color } }, [icon(d.icon)]),
        val, cap
      ]);
      els.tiles[d.key] = { val: val, cap: cap };
      els.tileGrid.appendChild(card);
    });

    // chart
    els.bars = el('div', { class: 'bars' });
    els.barCols = [];
    for (var i = 0; i < S.CHART_DAYS; i++) {
      var bar = el('div', { class: 'bar', style: { height: '3px' } });
      var val = el('div', { class: 'bv num', text: '' });
      var lab = el('div', { class: 'bl', text: '' });
      var col = el('div', { class: 'bar-col' }, [val, bar, lab]);
      els.barCols.push({ root: col, bar: bar, val: val, lab: lab });
      els.bars.appendChild(col);
    }
    els.chartCard = el('div', { class: 'card card-pad' }, [
      el('div', { class: 'section-head', style: { 'margin-block-end': 'var(--s2)' } }, [
        el('span', { class: 'h-section', text: I.t('stats.chart.title') })
      ]),
      els.bars,
      el('div', { class: 'legend' }, [
        el('span', {}, [el('i', { style: { background: 'var(--brand)' } }), el('span', { text: I.t('stats.chart.done') })]),
        el('span', {}, [el('i', { style: { background: 'var(--ok)' } }), el('span', { text: I.t('stats.chart.created') })])
      ])
    ]);
    els.chartTitle = els.chartCard.querySelector('.h-section');
    els.legendDone = els.chartCard.querySelectorAll('.legend span span')[0];
    els.legendCreated = els.chartCard.querySelectorAll('.legend span span')[1];

    els.quadTitle = el('div', { class: 'h-section', style: { 'margin-block-end': 'var(--s3)', padding: '0 2px' }, text: I.t('stats.quad.title') });
    els.empty = el('div', { class: 'section' });

    els.scroller = el('div', { class: 'scroller' }, [els.empty, els.hero, els.quadTitle, els.quadGrid, els.tileGrid, els.chartCard]);
    els.root = el('div', { class: 'stats-screen' }, [els.scroller]);
    return els.root;
  }

  function onClick(e) {
    var card = e.target.closest('[data-quad]');
    if (card) {
      bridge.vibrate(6);
      if (views.app && views.app.go) views.app.go('matrix');
    }
  }

  function mount(host) {
    if (mounted) return;
    mounted = true;
    host.appendChild(build());
    els.root.addEventListener('click', onClick);
  }

  function render(state, now) {
    if (!mounted) return;
    var n = now || Date.now();
    var s = S.compute(state, n);

    els.empty.hidden = state.tasks.length > 0;
    if (!state.tasks.length) {
      if (!els.empty.firstChild) {
        els.empty.appendChild(W.emptyState({
          icon: 'chart',
          title: I.t('stats.empty'),
          body: I.t('onb.body'),
          actionLabel: I.t('editor.saveNew'),
          onAction: function () { views.editor.open({}); }
        }));
      }
    } else if (els.empty.firstChild) {
      DOM.clear(els.empty);
    }

    // ring
    var pctv = s.ring.pct;
    els.ringBar.setAttribute('stroke-dashoffset', (C * (1 - pctv / 100)).toFixed(1));
    els.ringPct.textContent = pctv + '%';
    els.ringCap.textContent = I.t('stats.hero.title');
    els.heroDone.textContent = String(s.ring.done);
    els.heroOf.textContent = I.t('stats.hero.of', { n: s.ring.total });
    els.heroToday.textContent = String(s.totals.completedToday);
    els.heroOpen.textContent = String(s.totals.open);
    els.heroWindow.textContent = I.t('stats.hero.window', { n: s.windowDays });

    // quadrants
    s.quadrants.forEach(function (q) {
      var c = els.quadCards[q.key];
      c.n.textContent = String(q.total);
      c.bar.style.width = q.share + '%';
      c.name.textContent = I.t('matrix.' + q.key + '.name');
      c.sub.textContent = q.total
        ? I.t('stats.quad.done30', { n: q.done30 }) + (q.overdue ? ' · ' + I.t('week.overdueIn', { n: q.overdue }) : '')
        : I.t('stats.quad.none');
    });

    // tiles
    els.tiles.overdue.val.textContent = String(s.totals.overdue);
    els.tiles.overdue.cap.textContent = I.t('stats.tile.overdue');
    els.tiles.overdue.val.style.color = s.totals.overdue ? 'var(--danger)' : '';

    els.tiles.today.val.textContent = String(s.totals.dueToday);
    els.tiles.today.cap.textContent = I.t('stats.tile.today');

    els.tiles.next7.val.textContent = String(s.totals.next7);
    els.tiles.next7.cap.textContent = I.t('stats.tile.next7');

    els.tiles.streak.val.textContent = String(s.streak.current);
    els.tiles.streak.cap.textContent = s.streak.current
      ? I.t('stats.tile.streakBest', { n: s.streak.best })
      : I.t('stats.tile.streakNone');

    // chart
    var max = s.chartMax;
    s.chart.forEach(function (d, i) {
      var col = els.barCols[i];
      col.root.classList.toggle('is-today', !!d.isToday);
      col.bar.style.height = Math.max(3, Math.round(d.done / max * 78)) + 'px';
      col.val.textContent = d.done ? String(d.done) : '';
      col.lab.textContent = I.dowShortByIso(d.iso);
      col.root.title = I.fmtDate(d.dayMs) + ' · ' + d.done + ' / ' + d.created;
    });
    els.chartTitle.textContent = I.t('stats.chart.title');
    if (els.legendDone) els.legendDone.textContent = I.t('stats.chart.done');
    if (els.legendCreated) els.legendCreated.textContent = I.t('stats.chart.created');
  }

  function relayout() {
    if (!mounted || !els.root || !els.root.parentNode) return;
    var host = els.root.parentNode;
    var stale = els.root;            // build() reassigns els.root, so capture it first
    var fresh = build();
    host.replaceChild(fresh, stale);
    els.root = fresh;
    els.root.addEventListener('click', onClick);
    render(store.get(), Date.now());
  }

  return { id: 'stats', mount: mount, render: render, relayout: relayout };
});
