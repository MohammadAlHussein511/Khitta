/* core/dom.js — DOM construction helpers (no framework, no innerHTML in hot paths). */
(function (root, factory) {
  var api = factory();
  root.K = root.K || {};
  root.K.dom = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * HTML boolean attributes (hidden, disabled…) are true by mere presence, so a false value
   * must omit them. ARIA *state* attributes are different: aria-pressed="false" is meaningful
   * and CSS hooks like [aria-pressed="true"] depend on the literal string.
   */
  var ARIA_STATE = {
    'aria-pressed': 1, 'aria-checked': 1, 'aria-selected': 1, 'aria-expanded': 1,
    'aria-disabled': 1, 'aria-modal': 1, 'aria-current': 1, 'aria-hidden': 1
  };

  function append(parent, children) {
    if (children == null || children === false) return parent;
    if (Array.isArray(children)) {
      for (var i = 0; i < children.length; i++) append(parent, children[i]);
      return parent;
    }
    if (children.nodeType) { parent.appendChild(children); return parent; }
    parent.appendChild(document.createTextNode(String(children)));
    return parent;
  }

  /**
   * el('div', { class:'card', onClick:fn, 'data-id':x }, [child, 'text'])
   */
  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      for (var key in props) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
        var v = props[key];
        if (v == null || v === false) continue;
        if (key === 'class') node.className = v;
        else if (key === 'text') node.textContent = v;
        else if (key === 'style' && typeof v === 'object') {
          for (var s in v) node.style.setProperty(s, v[s]);
        } else if (key === 'dataset') {
          for (var d in v) node.dataset[d] = v[d];
        } else if (key.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), v, key.slice(0, 3) === 'onP' ? { passive: true } : undefined);
        } else if (typeof v === 'boolean') {
          if (ARIA_STATE[key]) node.setAttribute(key, v ? 'true' : 'false');
          else if (v) node.setAttribute(key, '');
        } else node.setAttribute(key, v);
      }
    }
    return append(node, children);
  }

  function svgIcon(name, cls) {
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    var u = document.createElementNS(SVG_NS, 'use');
    u.setAttribute('href', '#i-' + name);
    s.appendChild(u);
    return s;
  }

  function frag(children) {
    var f = document.createDocumentFragment();
    return append(f, children);
  }

  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function clear(node) {
    while (node && node.lastChild) node.removeChild(node.lastChild);
    return node;
  }

  /** Event delegation with a CSS selector. */
  function delegate(rootEl, selector, type, handler, opts) {
    rootEl.addEventListener(type, function (e) {
      var t = e.target && e.target.closest ? e.target.closest(selector) : null;
      if (t && rootEl.contains(t)) handler(e, t);
    }, opts || false);
  }

  function setAttrs(node, attrs) {
    for (var k in attrs) {
      if (attrs[k] == null || attrs[k] === false) node.removeAttribute(k);
      else node.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    return node;
  }

  /** Animate with WAAPI when available, otherwise jump to the end state. */
  function animate(node, frames, opts) {
    if (node && node.animate) {
      try { return node.animate(frames, opts); } catch (e) { /* ignore */ }
    }
    return null;
  }

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  return {
    el: el, svgIcon: svgIcon, frag: frag, qs: qs, qsa: qsa, clear: clear,
    delegate: delegate, setAttrs: setAttrs, animate: animate, onReady: onReady, append: append
  };
});
