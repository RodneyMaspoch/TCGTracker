/*!
 * DC Runtime — a tiny, dependency-free template engine that replaces the
 * Claude-artifact-only `<x-dc>` / `{{ }}` / `<sc-if>` / `<sc-for>` /
 * `<image-slot>` / `style-hover` runtime with plain browser APIs, so these
 * dashboards can run as fully static files (no build step, no server).
 *
 * ------------------------------------------------------------------------
 * WHAT THIS FILE PROVIDES
 * ------------------------------------------------------------------------
 * 1. `DCLogic` — a minimal base class (assigned to `window.DCLogic`) that
 *    the page's own `class Component extends DCLogic { ... }` script relies
 *    on for `this.state`, `this.setState(...)`, `this.props`, and the
 *    `componentDidMount` / `componentWillUnmount` lifecycle hooks.
 *
 * 2. `window.DCRuntime.mount(opts)` — reads the page's `<template>` (the
 *    original design markup, left completely untouched: same `sc-if`,
 *    `sc-for`, `{{ }}`, `image-slot`, `style-hover` attributes as before),
 *    compiles it once into a live, updatable DOM tree, and re-applies it
 *    every time the component's state changes.
 *
 * ------------------------------------------------------------------------
 * HOW RENDERING WORKS (read this before touching the code below)
 * ------------------------------------------------------------------------
 * The `<template>` element's content is never mutated — it is only ever
 * *read* (tag names, attributes, text). Every time real DOM is needed, we
 * build brand-new elements/text nodes from that read-only blueprint. This
 * means the same blueprint can be reused indefinitely by `sc-for`/`sc-if`
 * blocks without ever cloning or copying template nodes.
 *
 * Every compiled node exposes exactly two things:
 *   - `dom`  : the actual node to insert into the page (for `sc-if`/`sc-for`
 *              this is an anchor Comment; the block manages everything
 *              that follows it in the DOM).
 *   - `sync(scopeChain)` : re-applies bindings for the CURRENT render pass.
 *              `scopeChain` is an array of plain objects consulted from the
 *              end (innermost `sc-for` alias) towards the start (index 0 is
 *              always the full context object returned by renderVals()).
 *
 * Contract used everywhere in this file: a node's own `sync()` must only be
 * called *after* its `dom` has been appended somewhere with a real
 * `parentNode` (needed by `sc-if`/`sc-for`, which insert/remove siblings
 * relative to their anchor comment). Construction therefore never calls
 * `sync()` itself — callers build the whole subtree, attach it, and then
 * call `sync()` top-down.
 *
 * FOCUS / CURSOR PRESERVATION
 * A text input (search box, zip code, per-card price-alert field) never
 * gets torn down as long as the `sc-for` list it lives in keeps the same
 * *length* across a render pass — its subtree is updated in place (new
 * label/color/etc, same DOM nodes), so the browser never touches focus or
 * cursor position. Only a genuine structural change (a card added/removed,
 * a modal opening/closing) rebuilds a block's contents.
 */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  // NOTE: `onChange` here follows the React-style convention the original
  // component script is written against -- it must fire on every keystroke
  // (like the native `input` event), not only on blur/commit (the native
  // `change` event). Mapping it to `change` would silently drop most
  // keystrokes from controlled inputs (search box, zip code, per-card price
  // alert) since state (and therefore the controlled `value` binding) would
  // only resync once focus leaves the field.
  var EVENT_ATTR_NAMES = { onclick: 'click', onchange: 'input', onmousemove: 'mousemove', onmouseleave: 'mouseleave' };

  // ==========================================================================
  // DCLogic — the base class the page's `class Component extends DCLogic`
  // script is written against. Mirrors just enough of the original runtime's
  // component API (state/props/setState/lifecycle) for these two dashboards.
  // ==========================================================================
  function DCLogic(props) {
    this.props = props || {};
    this._dcScheduled = false;
    this._onUpdate = null;
  }
  DCLogic.prototype.setState = function (updater) {
    var prev = this.state || {};
    var partial = typeof updater === 'function' ? updater(prev) : updater;
    var next = {};
    for (var k in prev) if (Object.prototype.hasOwnProperty.call(prev, k)) next[k] = prev[k];
    if (partial) for (var k2 in partial) if (Object.prototype.hasOwnProperty.call(partial, k2)) next[k2] = partial[k2];
    this.state = next;
    if (!this._dcScheduled) {
      this._dcScheduled = true;
      var self = this;
      Promise.resolve().then(function () {
        self._dcScheduled = false;
        if (self._onUpdate) self._onUpdate();
      });
    }
  };
  DCLogic.prototype.componentDidMount = function () {};
  DCLogic.prototype.componentWillUnmount = function () {};

  // ==========================================================================
  // Expression evaluation
  // ------------------------------------------------------------------------
  // Every `{{ expr }}` in these two dashboards is one of: the literal
  // `true`/`false`, a bare identifier looked up in the current scope chain
  // (an `sc-for` alias, or a top-level key from renderVals()), or a single
  // `alias.field` member access. No arithmetic/ternaries/nested paths are
  // used anywhere in the source templates, so the evaluator only needs to
  // support that (verified by grepping every `{{ ... }}` occurrence in both
  // source files before writing this).
  // ==========================================================================
  function evalExpr(expr, scopeChain) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    var dot = expr.indexOf('.');
    var head = dot === -1 ? expr : expr.slice(0, dot);
    var rest = dot === -1 ? null : expr.slice(dot + 1);
    for (var i = scopeChain.length - 1; i >= 0; i--) {
      var frame = scopeChain[i];
      if (frame && Object.prototype.hasOwnProperty.call(frame, head)) {
        var val = frame[head];
        if (rest) {
          var parts = rest.split('.');
          for (var p = 0; p < parts.length; p++) {
            if (val == null) return undefined;
            val = val[parts[p]];
          }
        }
        return val;
      }
    }
    return undefined;
  }

  function stringify(v) {
    return v === null || v === undefined ? '' : String(v);
  }

  // Splits `"static {{ expr }} more static {{ expr2 }}"` into an ordered
  // list of `{ s: '...' }` (static) / `{ e: '...' }` (expression) parts.
  function parseParts(str) {
    var parts = [];
    var re = /\{\{([^{}]+)\}\}/g;
    var last = 0, m;
    while ((m = re.exec(str))) {
      if (m.index > last) parts.push({ s: str.slice(last, m.index) });
      parts.push({ e: m[1].trim() });
      last = re.lastIndex;
    }
    if (last < str.length) parts.push({ s: str.slice(last) });
    if (parts.length === 0) parts.push({ s: '' });
    return parts;
  }
  function renderParts(parts, scopeChain) {
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      out += p.s !== undefined ? p.s : stringify(evalExpr(p.e, scopeChain));
    }
    return out;
  }
  // For an attribute/value that is *entirely* a single `{{ expr }}` (e.g.
  // `value="{{ hist }}"`, `onClick="{{ d.toggle }}"`) — pulls out the bare
  // expression text so it can be evaluated directly (not stringified).
  function soleExpr(raw) {
    var m = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec((raw || '').trim());
    return m ? m[1] : (raw || '').trim();
  }

  // ==========================================================================
  // Hover styles ( `style-hover="..."` -> `.dc-hover-N:hover { ... }` )
  // ==========================================================================
  var hoverStyleEl = null;
  var hoverCounter = 0;
  var staticHoverCache = Object.create(null);
  function hoverSheet() {
    if (!hoverStyleEl) {
      hoverStyleEl = document.getElementById('dc-hover-styles');
      if (!hoverStyleEl) {
        hoverStyleEl = document.createElement('style');
        hoverStyleEl.id = 'dc-hover-styles';
        document.head.appendChild(hoverStyleEl);
      }
    }
    return hoverStyleEl.sheet;
  }
  function setupHover(rawVal, scopeChain) {
    var isDynamic = rawVal.indexOf('{{') !== -1;
    var sheet = hoverSheet();
    if (!isDynamic) {
      if (staticHoverCache[rawVal]) return { className: staticHoverCache[rawVal], dynamic: false };
      var cls = 'dc-hover-' + (hoverCounter++);
      try { sheet.insertRule('.' + cls + ':hover{' + rawVal + '}', sheet.cssRules.length); } catch (e) {}
      staticHoverCache[rawVal] = cls;
      return { className: cls, dynamic: false };
    }
    var cls2 = 'dc-hover-' + (hoverCounter++);
    var parts = parseParts(rawVal);
    var initialCss = renderParts(parts, scopeChain);
    var idx = 0;
    try { idx = sheet.insertRule('.' + cls2 + ':hover{' + initialCss + '}', sheet.cssRules.length); } catch (e) { idx = -1; }
    return {
      className: cls2,
      dynamic: true,
      parts: parts,
      lastCss: initialCss,
      setCss: function (css) {
        if (idx < 0 || css === this.lastCss) return;
        this.lastCss = css;
        try { sheet.cssRules[idx].style.cssText = css; } catch (e) {}
      },
    };
  }

  // ==========================================================================
  // image-slot -> <img> (non-empty src) or an empty filler box (no src),
  // matching the "safe empty state" convention already in the data: an
  // empty `art: ''` must never render a broken-image icon.
  // ==========================================================================
  function buildImageSlot(tmpl) {
    var srcAttr = tmpl.getAttribute('src');
    var shape = tmpl.getAttribute('shape') || 'rect';
    var parts = srcAttr ? parseParts(srcAttr) : null;
    // A plain in-flow block that fills its parent (rather than
    // `position:absolute`) -- every parent box in both dashboards is
    // already sized (via `aspect-ratio`, an explicit height, or its own
    // `position:absolute;inset:0`), and several image-slot parents (e.g.
    // Lorcana's category rings) are NOT `position:relative`, so an
    // absolutely-positioned slot would escape to the nearest positioned
    // ancestor instead of its intended box.
    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:block;width:100%;height:100%;' +
      (shape === 'circle' ? 'border-radius:50%;overflow:hidden' : '');
    var current; // sentinel: never equals a string on first sync
    function sync(sc) {
      var v = parts ? renderParts(parts, sc) : '';
      if (v === current) return;
      current = v;
      wrapper.textContent = '';
      if (v) {
        var img = document.createElement('img');
        img.src = v;
        img.alt = '';
        img.loading = 'lazy';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
        wrapper.appendChild(img);
      }
    }
    return { dom: wrapper, sync: sync };
  }

  // ==========================================================================
  // Plain text node with 0+ `{{ }}` placeholders
  // ==========================================================================
  function buildText(tmpl) {
    var raw = tmpl.nodeValue;
    if (raw.indexOf('{{') === -1) {
      return { dom: document.createTextNode(raw), sync: function () {} };
    }
    var parts = parseParts(raw);
    var node = document.createTextNode('');
    function sync(sc) {
      var v = renderParts(parts, sc);
      if (node.nodeValue !== v) node.nodeValue = v;
    }
    return { dom: node, sync: sync };
  }

  // ==========================================================================
  // A regular element: static/dynamic attributes, style-hover, event
  // handlers (real addEventListener, not stringified HTML), controlled
  // value binding for <input>/<select>, one-shot autoFocus, and children.
  // ==========================================================================
  function buildElement(tmpl, scopeChain, svgMode) {
    var tag = tmpl.tagName.toLowerCase();
    var isSvg = svgMode || tag === 'svg';
    var el = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);

    var dynamicAttrs = []; // { name, parts }
    var eventBindings = []; // { current }
    var valueBinding = null; // { parts }
    var autoFocusParts = null;
    var hoverInfo = null;

    var attrs = tmpl.attributes;
    for (var i = 0; i < attrs.length; i++) {
      var name = attrs[i].name;
      var val = attrs[i].value;

      if (name === 'style-hover') {
        hoverInfo = setupHover(val, scopeChain);
        el.classList.add(hoverInfo.className);
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(EVENT_ATTR_NAMES, name)) {
        (function (domEvent, exprText) {
          var binding = { current: null };
          el.addEventListener(domEvent, function (ev) { if (binding.current) binding.current(ev); });
          eventBindings.push({ binding: binding, expr: exprText });
        })(EVENT_ATTR_NAMES[name], soleExpr(val));
        continue;
      }
      if (name === 'autofocus') {
        autoFocusParts = parseParts(val);
        continue;
      }
      if (name === 'value' && (tag === 'input' || tag === 'select')) {
        valueBinding = { parts: parseParts(val) };
        continue;
      }
      if (val.indexOf('{{') === -1) {
        el.setAttribute(name, val);
      } else {
        dynamicAttrs.push({ name: name, parts: parseParts(val) });
      }
    }

    var childInstances = [];
    var cn = tmpl.childNodes;
    for (var c = 0; c < cn.length; c++) {
      var inst = buildNode(cn[c], scopeChain, isSvg);
      if (inst) { el.appendChild(inst.dom); childInstances.push(inst); }
    }

    var didAutoFocus = false;

    function sync(sc) {
      for (var a = 0; a < dynamicAttrs.length; a++) {
        var da = dynamicAttrs[a];
        var v = renderParts(da.parts, sc);
        if (el.getAttribute(da.name) !== v) el.setAttribute(da.name, v);
      }
      if (hoverInfo && hoverInfo.dynamic) hoverInfo.setCss(renderParts(hoverInfo.parts, sc));
      for (var e = 0; e < eventBindings.length; e++) {
        eventBindings[e].binding.current = evalExpr(eventBindings[e].expr, sc);
      }
      // Children first, so <option> elements exist/have correct values
      // before a parent <select>'s controlled value is applied below.
      for (var ci = 0; ci < childInstances.length; ci++) childInstances[ci].sync(sc);
      if (valueBinding) {
        var vv = renderParts(valueBinding.parts, sc);
        if (el.value !== vv) el.value = vv;
      }
      if (autoFocusParts && !didAutoFocus) {
        var af = renderParts(autoFocusParts, sc);
        if (af === 'true') {
          didAutoFocus = true;
          queueMicrotask(function () { try { el.focus(); } catch (e2) {} });
        }
      }
    }
    return { dom: el, sync: sync };
  }

  // ==========================================================================
  // A group of sibling template nodes (the direct children of an sc-if or
  // sc-for, or the whole top-level template) built against one scope chain.
  // ==========================================================================
  function buildGroup(templateNodes, scopeChain, svgMode) {
    var instances = [];
    for (var i = 0; i < templateNodes.length; i++) {
      var inst = buildNode(templateNodes[i], scopeChain, svgMode);
      if (inst) instances.push(inst);
    }
    return {
      nodes: instances.map(function (i2) { return i2.dom; }),
      syncAll: function (sc) { for (var i3 = 0; i3 < instances.length; i3++) instances[i3].sync(sc); },
      teardown: function () {
        for (var i4 = 0; i4 < instances.length; i4++) {
          var d = instances[i4].dom;
          if (d && d.parentNode) d.parentNode.removeChild(d);
        }
      },
    };
  }

  function insertNodesAfter(anchor, nodes) {
    var ref = anchor;
    for (var i = 0; i < nodes.length; i++) {
      ref.parentNode.insertBefore(nodes[i], ref.nextSibling);
      ref = nodes[i];
    }
  }

  // ==========================================================================
  // <sc-if value="{{ expr }}"> ... </sc-if>
  // Only rebuilds its contents when the boolean flips; otherwise it just
  // re-syncs the existing subtree in place (this is what keeps the search
  // box's focus intact while its own state — the search query — changes).
  // ==========================================================================
  function buildIfBlock(tmpl, scopeChain, svgMode) {
    var valueExpr = soleExpr(tmpl.getAttribute('value'));
    var templateNodes = Array.prototype.slice.call(tmpl.childNodes);
    var anchor = document.createComment('sc-if');
    var active = false;
    var group = null;

    function sync(sc) {
      var newActive = !!evalExpr(valueExpr, sc);
      if (newActive === active) {
        if (active && group) group.syncAll(sc);
        return;
      }
      if (group) { group.teardown(); group = null; }
      active = newActive;
      if (active) {
        group = buildGroup(templateNodes, sc, svgMode);
        insertNodesAfter(anchor, group.nodes);
        group.syncAll(sc);
      }
    }
    return { dom: anchor, sync: sync };
  }

  // ==========================================================================
  // <sc-for list="{{ expr }}" as="alias"> ... </sc-for>
  // Rebuilds item subtrees only when the list LENGTH changes; when the
  // length is unchanged, each index's existing subtree is updated in place
  // with that index's new item — this is what keeps a per-card price-alert
  // input focused while its own value changes on every keystroke.
  // ==========================================================================
  function buildForBlock(tmpl, scopeChain, svgMode) {
    var listExpr = soleExpr(tmpl.getAttribute('list'));
    var alias = tmpl.getAttribute('as');
    var templateNodes = Array.prototype.slice.call(tmpl.childNodes);
    var anchor = document.createComment('sc-for');
    var itemGroups = [];

    function sync(sc) {
      var list = evalExpr(listExpr, sc);
      var arr = Array.isArray(list) ? list : [];
      if (arr.length === itemGroups.length) {
        for (var i = 0; i < arr.length; i++) {
          var childScope = sc.concat([mkFrame(alias, arr[i])]);
          itemGroups[i].syncAll(childScope);
        }
        return;
      }
      for (var j = 0; j < itemGroups.length; j++) itemGroups[j].teardown();
      itemGroups = [];
      var allNodes = [];
      for (var k = 0; k < arr.length; k++) {
        var scope = sc.concat([mkFrame(alias, arr[k])]);
        var g = buildGroup(templateNodes, scope, svgMode);
        itemGroups.push(g);
        allNodes = allNodes.concat(g.nodes);
      }
      insertNodesAfter(anchor, allNodes);
      for (var m = 0; m < arr.length; m++) {
        itemGroups[m].syncAll(sc.concat([mkFrame(alias, arr[m])]));
      }
    }
    return { dom: anchor, sync: sync };
  }
  function mkFrame(alias, value) {
    var f = {};
    f[alias] = value;
    return f;
  }

  // ==========================================================================
  // Dispatcher
  // ==========================================================================
  function buildNode(tmpl, scopeChain, svgMode) {
    if (tmpl.nodeType === 3) return buildText(tmpl);
    if (tmpl.nodeType !== 1) return null; // comments, etc. — nothing to render
    var tag = tmpl.tagName.toLowerCase();
    if (tag === 'sc-if') return buildIfBlock(tmpl, scopeChain, svgMode);
    if (tag === 'sc-for') return buildForBlock(tmpl, scopeChain, svgMode);
    if (tag === 'image-slot') return buildImageSlot(tmpl);
    return buildElement(tmpl, scopeChain, svgMode);
  }

  // ==========================================================================
  // Public entry point
  // ==========================================================================
  function mount(opts) {
    var tmplEl = document.getElementById(opts.templateId);
    var rootEl = document.getElementById(opts.rootId);
    var templateNodes = Array.prototype.slice.call(tmplEl.content.childNodes);

    var component = new opts.ComponentClass(opts.props);
    var initialCtx = component.renderVals();
    var rootGroup = buildGroup(templateNodes, [initialCtx], false);
    for (var i = 0; i < rootGroup.nodes.length; i++) rootEl.appendChild(rootGroup.nodes[i]);
    rootGroup.syncAll([initialCtx]);

    component._onUpdate = function () {
      var ctx = component.renderVals();
      rootGroup.syncAll([ctx]);
    };

    if (typeof component.componentDidMount === 'function') component.componentDidMount();
    global.addEventListener('pagehide', function () {
      if (typeof component.componentWillUnmount === 'function') component.componentWillUnmount();
    }, { once: true });

    return component;
  }

  global.DCLogic = DCLogic;
  global.DCRuntime = { mount: mount };
})(window);
