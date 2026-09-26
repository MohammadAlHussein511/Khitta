/* ui/dnd.js — pointer-driven drag & drop for vertical lists.
 *
 * Design notes
 *  • Works with touch and mouse through Pointer Events; a dedicated handle has
 *    `touch-action:none` so a drag never fights the scroller, and long-press anywhere on a
 *    card also starts a drag (once it starts, native touch scrolling is suppressed).
 *  • The real node is moved in the DOM during the gesture and a floating clone follows the
 *    finger. Because the node lives in the layout, the "make way" animation is free, and
 *    crossing from one list into another needs no special casing.
 *  • Siblings are animated with FLIP (measure → move → invert → play), so every shift is
 *    smooth even with variable card heights.
 *  • Autoscroll near the edges of the scrolling ancestor.
 */
(function (root, factory) {
  var K = root.K = root.K || {};
  K.dnd = factory(K.util, K.dom, K.bridge);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (U, DOM, bridge) {
  'use strict';

  var EDGE = 54;           // px from an edge where autoscroll kicks in
  var LONG_PRESS = 300;    // ms
  var SLOP_HANDLE = 6;     // px before a handle drag starts
  var SLOP_BODY = 10;      // px of movement that cancels a pending long press

  var active = null;       // at most one session app-wide

  function rectsOf(nodes) {
    var out = [];
    for (var i = 0; i < nodes.length; i++) out.push(nodes[i].getBoundingClientRect());
    return out;
  }

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
   *   containerEl   element that receives pointerdown (usually the scrollable list)
   *   itemSelector  selector for draggable items
   *   handleSelector optional selector; dragging from it starts immediately
   *   zones()       → [{id, listEl, itemSelector?, scrollEl?}] droppable lists (default: container)
   *   modelOf(node) → the model behind a node
   *   onDrop(info)  → {node, model, fromZone, fromIndex, zone, index}
   *   onDragStart/onDragMove/onDragEnd hooks
   */
  function attach(cfg) {
    var container = cfg.containerEl;
    var selector = cfg.itemSelector;
    var session = null;
    var timers = {};

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
          rect: listEl.getBoundingClientRect(),
          scrollRect: scroller.getBoundingClientRect()
        };
      });
    }

    function preventTouch(e) { if (active) e.preventDefault(); }

    // -------------------------------------------------------------- gesture

    function onDown(e) {
      if (active) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var interactive = e.target.closest('button, input, textarea, select, a, [data-nodrag]');
      var onHandle = cfg.handleSelector ? !!e.target.closest(cfg.handleSelector) : false;
      if (interactive && !onHandle) return;

      var node = e.target.closest(selector);
      if (!node || !container.contains(node)) return;
      if (node.getAttribute && node.getAttribute('data-readonly')) return;
      if (cfg.canStart && cfg.canStart(node) === false) return;

      var start = { x: e.clientX, y: e.clientY, node: node, onHandle: onHandle, cancelled: false };

      if (!onHandle) {
        timers.lp = setTimeout(function () {
          if (!start.cancelled) begin(start);
        }, LONG_PRESS);
      }

      function move(ev) {
        var dx = ev.clientX - start.x;
        var dy = ev.clientY - start.y;
        if (!session) {
          if (onHandle && (Math.abs(dx) > SLOP_HANDLE || Math.abs(dy) > SLOP_HANDLE)) {
            begin(start, ev.clientX, ev.clientY);
          } else if (!onHandle && (Math.abs(dx) > SLOP_BODY || Math.abs(dy) > SLOP_BODY)) {
            start.cancelled = true;
            if (timers.lp) { clearTimeout(timers.lp); timers.lp = null; }
          }
        } else {
          onMove(ev.clientX, ev.clientY, ev);
        }
      }
      function up(ev) {
        if (timers.lp) { clearTimeout(timers.lp); timers.lp = null; }
        if (session) onUp();
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
      }
      function cancel() {
        start.cancelled = true;
        if (timers.lp) { clearTimeout(timers.lp); timers.lp = null; }
        if (session) onUp(true);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
      }

      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    }

    function begin(start, px, py) {
      var node = start.node;
      var list = zones();
      var hostZone = list.filter(function (z) { return z.listEl.contains(node); })[0] || list[0];
      var nodes = childrenOf(hostZone.listEl, hostZone.itemSelector);
      var index = nodes.indexOf(node);
      if (index < 0) return;

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
        px: px == null ? start.x : px,
        py: py == null ? start.y : py,
        offsetX: (px == null ? start.x : px) - rect.left,
        offsetY: (py == null ? start.y : py) - rect.top,
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
    }

    // -------------------------------------------------------------- move

    /**
     * Which drop zone is under the pointer? Hit-test each zone's OWN card/chip rect —
     * in the stacked matrix every section shares one page scroller, so the scroller's
     * rect cannot tell them apart (V2.2 fix).
     */
    function zoneAt(x, y) {
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
        /* eslint-disable no-loop-func */
        (function (el) {
          requestAnimationFrame(function () {
            el.style.transition = 'transform .2s cubic-bezier(.2,.8,.2,1)';
            el.style.transform = '';
            setTimeout(function () { el.style.transition = ''; }, 220);
          });
        })(n);
      }
    }

    function onMove(x, y, ev) {
      if (!session) return;
      session.px = x; session.py = y;
      if (ev && ev.cancelable) ev.preventDefault();

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

    // -------------------------------------------------------------- autoscroll

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
        // keep the drop index in sync while the list scrolls under the finger
        var idx = indexAt(z, session.px, session.py);
        if (idx !== session.index) onMove(session.px, session.py, null);
      }
      session.raf = requestAnimationFrame(loop);
    }

    // -------------------------------------------------------------- end

    function onUp(cancelled) {
      if (!session) return;
      var s = session;
      session = null;
      active = null;
      if (s.raf) cancelAnimationFrame(s.raf);

      // A cross-zone drag re-parents the live node into the hovered zone (a day chip,
      // for instance). Put it back before the view re-renders, so no orphan node is
      // left sitting inside a drop zone that the renderer never clears.
      if (s.node && s.originalParent && s.node.parentNode !== s.originalParent) {
        s.originalParent.appendChild(s.node);
      }

      s.zones.forEach(function (z) {
        z.listEl.classList.remove('list-dragging');
        z.highlightEl.classList.remove('is-drop-target');
      });
      s.node.classList.remove('is-drag-source');
      document.body.classList.remove('is-dragging-any');
      if (s.clone && s.clone.parentNode) s.clone.parentNode.removeChild(s.clone);

      if (!cancelled && cfg.onDrop) {
        cfg.onDrop({
          node: s.node, model: s.model,
          fromZone: s.fromZone, fromIndex: s.fromIndex,
          zone: s.zoneId, index: s.index,
          moved: s.zoneId !== s.fromZone || s.index !== s.fromIndex
        });
      }
      if (cfg.onDragEnd) cfg.onDragEnd(s, !cancelled);
    }

    container.addEventListener('pointerdown', onDown);
    document.addEventListener('touchmove', preventTouch, { passive: false, capture: true });

    return {
      destroy: function () {
        container.removeEventListener('pointerdown', onDown);
        document.removeEventListener('touchmove', preventTouch, { capture: true });
        if (session) onUp(true);
      },
      isActive: function () { return !!session; }
    };
  }

  return { attach: attach, get active() { return !!active; } };
});
