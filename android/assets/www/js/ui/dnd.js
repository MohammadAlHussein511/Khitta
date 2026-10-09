/* ui/dnd.js — pointer-driven drag & drop for vertical lists, with a dedicated TOUCH path.
 *
 * Why two paths (V2.4.1 regression fix): on a real phone the page scroller is always
 * scrollable, so the compositor claims a vertical finger movement and fires pointercancel
 * before a pointer-event-only drag can own the gesture (mouse never cancels, which is why
 * desktop tests passed while fingers failed). The touch path below drives the session from
 * touchstart/touchmove/touchend and preventDefaults the scroll during the long-press window
 * and for the whole drag, so a long-press always matures into a drag and never gets stolen.
 *
 * Gesture arbitration
 *  • long-press (300 ms) on a card, or immediate drag from the grip  ⇒ reorder / reclassify
 *  • quick horizontal movement before the long-press matures          ⇒ released to the
 *    navigation swipe recogniser (we stop preventing and cancel the timer)
 *  • vertical movement before the long-press matures                  ⇒ normal page scroll
 *  • once a drag session is live, every touchmove is prevented: no scroll, no cancel
 *
 * The real node is moved in the DOM during the gesture (so "make way" is free) while a
 * floating clone follows the finger; siblings animate with FLIP.
 */
(function (root, factory) {
  var K = root.K = root.K || {};
  K.dnd = factory(K.util, K.dom, K.bridge);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, DOM, bridge) {
  'use strict';

  var EDGE = 54;           // px from an edge where autoscroll kicks in
  var LONG_PRESS = 260;    // ms — short enough to feel instant, long enough to beat a tap
  var SLOP_HANDLE = 5;     // px before a handle drag starts
  // Real fingers jitter while holding still; 18 px tolerates that without cancelling the
  // long-press, yet is far below any deliberate scroll or swipe.
  var SLOP_BODY = 18;

  var active = null;       // at most one session app-wide

  function childrenOf(listEl, selector) {
    return Array.prototype.slice.call(listEl.querySelectorAll(':scope > ' + selector));
  }

  function scrollParent(el) {
    var p = el && el.parentElement;
    while (p && p !== document.body) {
      var oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
      p = p.parentElement;
    }
    return el;
  }

  /**
   * @param {Object} cfg
   *   containerEl   element that receives the gesture starters (usually the scrollable list)
   *   itemSelector  selector for draggable items
   *   handleSelector optional selector; dragging from it starts immediately
   *   canStart(node) optional veto (e.g. read-only days, non-manual sorting)
   *   zones()       → [{id, listEl, highlightEl?, itemSelector?, scrollEl?}] droppable lists
   *   modelOf(node) → the model behind a node
   *   onDrop(info)  → {node, model, fromZone, fromIndex, zone, index, moved}
   *   onDragStart / onDragMove / onDragEnd hooks
   */
  function attach(cfg) {
    var container = cfg.containerEl;
    var selector = cfg.itemSelector;
    var session = null;
    var press = null;          // pending long-press (touch path)
    var pressTimer = null;

    function zones() {
      var z = cfg.zones ? cfg.zones() : null;
      if (!z || !z.length) z = [{ id: 'main', listEl: container, itemSelector: selector }];
      return z.map(function (x) {
        var listEl = x.listEl;
        var scroller = x.scrollEl || scrollParent(listEl);
        return {
          id: x.id,
          listEl: listEl,
          highlightEl: x.highlightEl || listEl,
          itemSelector: x.itemSelector || selector,
          scrollEl: scroller,
          pointZone: !!x.pointZone,      // drop-target-only zones never keep the dragged node
          rect: listEl.getBoundingClientRect(),
          scrollRect: scroller.getBoundingClientRect()
        };
      });
    }

    // keep any native scroll from racing a live session (belt & braces)
    function preventTouchCapture(e) { if (active) e.preventDefault(); }

    // -------------------------------------------------------------- session core

    function begin(node, px, py) {
      var list = zones();
      var hostZone = null;
      for (var zi = 0; zi < list.length; zi++) {
        if (list[zi].listEl.contains(node)) { hostZone = list[zi]; break; }
      }
      if (!hostZone) hostZone = list[0];
      var nodes = childrenOf(hostZone.listEl, hostZone.itemSelector);
      var index = nodes.indexOf(node);
      // V2.4.7: a store-driven re-render inside the long-press window (e.g. the debounced
      // alarm sync that follows an add/complete) replaces the card nodes; re-bind to the
      // fresh node carrying the same data-id instead of silently dropping the drag.
      if (index < 0 && node.getAttribute && node.getAttribute('data-id')) {
        var sel = ':scope > ' + selector + '[data-id="' + node.getAttribute('data-id') + '"]';
        for (var zj = 0; zj < list.length; zj++) {
          var alt = list[zj].listEl.querySelector(sel);
          if (alt) {
            node = alt;
            hostZone = list[zj];
            nodes = childrenOf(hostZone.listEl, hostZone.itemSelector);
            index = nodes.indexOf(node);
            break;
          }
        }
      }
      if (index < 0) return false;

      var rect = node.getBoundingClientRect();
      var clone = node.cloneNode(true);
      clone.className = node.className + ' is-dragging';
      clone.removeAttribute('id');
      clone.style.position = 'fixed';
      clone.style.left = rect.left + 'px';
      clone.style.top = rect.top + 'px';
      clone.style.width = rect.width + 'px';
      clone.style.height = rect.height + 'px';
      clone.style.margin = '0';
      clone.style.pointerEvents = 'none';
      clone.style.zIndex = '9000';
      clone.style.transition = 'none';
      clone.style.transform = 'scale(1.03)';
      clone.style.boxShadow = 'var(--sh-drag)';
      document.body.appendChild(clone);

      session = {
        cfg: cfg, node: node, clone: clone,
        originalParent: node.parentNode,
        zones: list, zone: hostZone, zoneId: hostZone.id,
        index: index, fromIndex: index, fromZone: hostZone.id,
        rect: rect,
        px: px, py: py,
        offsetX: px - rect.left,
        offsetY: py - rect.top,
        model: cfg.modelOf ? cfg.modelOf(node) : null,
        raf: null
      };
      active = session;

      node.classList.add('is-drag-source');
      document.body.classList.add('is-dragging-any');
      list.forEach(function (z) { z.listEl.classList.add('list-dragging'); });
      if (bridge && bridge.vibrate) bridge.vibrate(18);
      if (cfg.onDragStart) cfg.onDragStart(session);
      loop();
      return true;
    }

    function zoneAt(x, y) {
      /**
       * Which drop zone is under the pointer? Hit-test each zone's OWN card/chip rect —
       * in the stacked matrix every section shares one page scroller, so the scroller's
       * rect cannot tell them apart.
       */
      for (var i = 0; i < session.zones.length; i++) {
        var r = session.zones[i].highlightEl.getBoundingClientRect();
        if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6) {
          return session.zones[i];
        }
      }
      return session.zone;
    }

    function indexAt(zone, x, y) {
      var nodes = childrenOf(zone.listEl, zone.itemSelector).filter(function (n) { return n !== session.node; });
      var idx = nodes.length;
      for (var i = 0; i < nodes.length; i++) {
        var r = nodes[i].getBoundingClientRect();
        if (y < r.top + r.height / 2) { idx = i; break; }
      }
      return idx;
    }

    function flipMove(mutate) {
      var touched = [];
      session.zones.forEach(function (z) {
        childrenOf(z.listEl, z.itemSelector).forEach(function (n) { touched.push([n, n.getBoundingClientRect().top]); });
      });
      mutate();
      for (var i = 0; i < touched.length; i++) {
        var n = touched[i][0], before = touched[i][1];
        if (n === session.node) continue;
        var after = n.getBoundingClientRect().top;
        var delta = before - after;
        if (Math.abs(delta) < 1) continue;
        n.style.transition = 'none';
        n.style.transform = 'translateY(' + delta + 'px)';
        (function (el) {
          requestAnimationFrame(function () {
            el.style.transition = 'transform .2s cubic-bezier(.2,.8,.2,1)';
            el.style.transform = '';
            setTimeout(function () { el.style.transition = ''; }, 220);
          });
        })(n);
      }
    }

    function onMove(x, y) {
      if (!session) return;
      session.px = x; session.py = y;

      var clone = session.clone;
      clone.style.left = (x - session.offsetX) + 'px';
      clone.style.top = (y - session.offsetY) + 'px';

      var zone = zoneAt(x, y);
      var index = indexAt(zone, x, y);

      session.zones.forEach(function (z) {
        z.highlightEl.classList.toggle('is-drop-target', z === zone && z.id !== session.fromZone);
      });

      if (zone !== session.zone || index !== session.index) {
        var node = session.node;
        flipMove(function () {
          var siblings = childrenOf(zone.listEl, zone.itemSelector).filter(function (n) { return n !== node; });
          var ref = siblings[index] || null;
          zone.listEl.insertBefore(node, ref);
        });
        session.zone = zone;
        session.zoneId = zone.id;
        session.index = index;
      }
      if (cfg.onDragMove) cfg.onDragMove(session);
    }

    function loop() {
      if (!session) return;
      // the page may auto-scroll under the finger: keep zone geometry fresh so
      // cross-section drops stay accurate in the stacked (scrollable) layout
      for (var zi = 0; zi < session.zones.length; zi++) {
        session.zones[zi].rect = session.zones[zi].listEl.getBoundingClientRect();
        session.zones[zi].scrollRect = session.zones[zi].scrollEl.getBoundingClientRect();
      }
      var z = session.zone;
      var el = z.scrollEl;
      var r = z.scrollRect;
      var y = session.py;
      var step = 0;
      if (el && el.scrollHeight > el.clientHeight + 2) {
        if (y < r.top + EDGE) step = -Math.ceil((EDGE - (y - r.top)) / EDGE * 11);
        else if (y > r.bottom - EDGE) step = Math.ceil((EDGE - (r.bottom - y)) / EDGE * 11);
      }
      if (step) {
        el.scrollTop += step;
        var idx = indexAt(z, session.px, session.py);
        if (idx !== session.index) onMove(session.px, session.py);
      }
      session.raf = requestAnimationFrame(loop);
    }

    function onUp(cancelled) {
      if (!session) return;
      var s = session;
      session = null;
      active = null;
      if (s.raf) cancelAnimationFrame(s.raf);

      // If the node ended up inside a real drop LIST, keep it exactly where the user
      // placed it — the drop callback snapshots the arranged DOM as the source of truth.
      // Only non-list zones (e.g. a week day-chip) get their borrowed node returned,
      // so no orphan is left inside a container the renderer never clears.
      if (s.node && s.originalParent && s.node.parentNode !== s.originalParent) {
        var inZoneList = false;
        for (var zzi = 0; zzi < s.zones.length; zzi++) {
          // point zones (e.g. week day-chips) only receive the node transiently
          if (s.zones[zzi].listEl === s.node.parentNode && !s.zones[zzi].pointZone) { inZoneList = true; break; }
        }
        if (!inZoneList) s.originalParent.appendChild(s.node);
      }

      s.zones.forEach(function (z) {
        z.listEl.classList.remove('list-dragging');
        z.highlightEl.classList.remove('is-drop-target');
      });
      s.node.classList.remove('is-drag-source');
      document.body.classList.remove('is-dragging-any');
      if (s.clone && s.clone.parentNode) s.clone.parentNode.removeChild(s.clone);

      if (cfg.onDrop) {
        cfg.onDrop({
          node: s.node, model: s.model,
          fromZone: s.fromZone, fromIndex: s.fromIndex,
          zone: s.zoneId, index: s.index,
          moved: s.zoneId !== s.fromZone || s.index !== s.fromIndex,
          cancelled: !!cancelled
        });
      }
      if (cfg.onDragEnd) cfg.onDragEnd(s, !cancelled);
    }

    function candidateFrom(target) {
      var interactive = target.closest && target.closest('button, input, textarea, select, a, [data-nodrag]');
      var onHandle = cfg.handleSelector ? !!target.closest(cfg.handleSelector) : false;
      if (interactive && !onHandle) return null;
      var node = target.closest ? target.closest(selector) : null;
      if (!node || !container.contains(node)) return null;
      if (node.getAttribute && node.getAttribute('data-readonly')) return null;
      if (cfg.canStart && cfg.canStart(node) === false) return null;
      return { node: node, onHandle: onHandle };
    }

    // -------------------------------------------------------------- mouse / pen path

    function onPointerDown(e) {
      if (active) return;
      if (e.pointerType === 'touch') return;          // the touch path owns fingers
      if (e.button !== 0) return;
      var cand = candidateFrom(e.target);
      if (!cand) return;

      var start = { x: e.clientX, y: e.clientY, node: cand.node, onHandle: cand.onHandle, cancelled: false };
      var timer = null;
      if (!start.onHandle) {
        timer = setTimeout(function () {
          if (!start.cancelled) begin(start.node, start.x, start.y);
        }, LONG_PRESS);
      }

      function move(ev) {
        var dx = ev.clientX - start.x;
        var dy = ev.clientY - start.y;
        if (!session) {
          if (start.onHandle && (Math.abs(dx) > SLOP_HANDLE || Math.abs(dy) > SLOP_HANDLE)) {
            begin(start.node, ev.clientX, ev.clientY);
            if (session) onMove(ev.clientX, ev.clientY);
          } else if (!start.onHandle && (Math.abs(dx) > SLOP_BODY || Math.abs(dy) > SLOP_BODY)) {
            start.cancelled = true;
            if (timer) { clearTimeout(timer); timer = null; }
          }
        } else {
          if (ev.cancelable) ev.preventDefault();
          onMove(ev.clientX, ev.clientY);
        }
      }
      function up() {
        if (timer) { clearTimeout(timer); timer = null; }
        if (session) onUp(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
      }
      function cancel() {
        start.cancelled = true;
        if (timer) { clearTimeout(timer); timer = null; }
        if (session) onUp(true);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
      }

      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    }

    // -------------------------------------------------------------- touch path

    function onTouchStart(e) {
      if (active || e.touches.length !== 1) return;
      var t = e.touches[0];
      var cand = candidateFrom(e.target);
      if (!cand) return;
      if (cand.onHandle && e.cancelable) {
        // The grip is the guaranteed drag path: blocking the gesture at touchstart means
        // no scroll, no compositor takeover and no pointercancel can ever intercept it.
        e.preventDefault();
      }
      press = { x: t.clientX, y: t.clientY, node: cand.node, onHandle: cand.onHandle, pending: true };
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      if (!cand.onHandle) {
        pressTimer = setTimeout(function () {
          pressTimer = null;
          if (press && press.pending && !session) {
            press.pending = false;
            begin(press.node, press.x, press.y);
          }
        }, LONG_PRESS);
      }
    }

    function onTouchMove(e) {
      if (session) {
        // the drag owns this gesture entirely: no scroll, no compositor takeover
        if (e.cancelable) e.preventDefault();
        var t0 = e.touches[0] || e.changedTouches[0];
        if (t0) onMove(t0.clientX, t0.clientY);
        return;
      }
      if (!press || !press.pending) return;
      var t = e.touches[0];
      if (!t) return;
      var dx = t.clientX - press.x;
      var dy = t.clientY - press.y;
      var adx = Math.abs(dx), ady = Math.abs(dy);

      if (press.onHandle) {
        // the grip never scrolls: it becomes a drag as soon as it moves
        if (e.cancelable) e.preventDefault();
        if (adx > SLOP_HANDLE || ady > SLOP_HANDLE) {
          press.pending = false;
          if (begin(press.node, t.clientX, t.clientY)) onMove(t.clientX, t.clientY);
        }
        return;
      }
      if (adx > SLOP_BODY || ady > SLOP_BODY) {
        // a real movement before the long-press matured: hand the gesture back
        // (horizontal ⇒ navigation swipe, vertical ⇒ page scroll)
        press.pending = false;
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        return;
      }
      // micro-jitter while pressing: hold the scroller so the long-press can mature
      if (e.cancelable) e.preventDefault();
    }

    function onTouchEnd(e) {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      press = null;
      if (session) onUp(e.type === 'touchcancel');
    }

    container.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', onTouchEnd);
    document.addEventListener('touchmove', preventTouchCapture, { passive: false, capture: true });

    return {
      destroy: function () {
        container.removeEventListener('pointerdown', onPointerDown);
        container.removeEventListener('touchstart', onTouchStart);
        container.removeEventListener('touchmove', onTouchMove);
        container.removeEventListener('touchend', onTouchEnd);
        container.removeEventListener('touchcancel', onTouchEnd);
        document.removeEventListener('touchmove', preventTouchCapture, { capture: true });
        if (session) onUp(true);
      },
      isActive: function () { return !!session; }
    };
  }

  return { attach: attach, get active() { return !!active; } };
});
