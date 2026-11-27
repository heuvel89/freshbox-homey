#!/usr/bin/env python3
"""Maakt de widgets van FreshBox aan (widget.compose.json, api.js en public/index.html).

Alle widgets delen dezelfde stijl en laadcode; alleen de render-functie verschilt.
Opnieuw draaien overschrijft de bestanden: pas dus dit script aan, niet de HTML.
"""
import json
import os

ROOT = os.path.join(os.path.dirname(__file__), '..', 'widgets')

CSS = r"""
  :root { --g: #067A46; --lime: #99CC33; --sun: #FFD95A; --mint: #DFF1C7; --coral: #FF8A65; --pink: #FFE1DC;
          --red: #C93A32; --ink: #242424; --cream: #FBF7EE; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: transparent; font-family: var(--homey-font-family, -apple-system, system-ui, sans-serif); color: var(--ink); }
  .t { border-radius: 22px; padding: 16px; height: 100%; display: flex; flex-direction: column; gap: 8px; overflow: hidden; position: relative; isolation: isolate; }
  .lab { font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .pill { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 12px; white-space: nowrap; letter-spacing: 0; text-transform: none; }
  .msg { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 13px; opacity: .8; padding: 8px; }
  .big { font-size: 26px; font-weight: 800; line-height: 1.1; }
  .sub { font-size: 13px; line-height: 1.35; }
  .muted { opacity: .75; }
  .btn { border: 0; border-radius: 20px; height: 40px; padding: 0 14px; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
  .btn:active { transform: scale(.97); }
  .btn.busy { opacity: .6; pointer-events: none; }
  .dot { position: absolute; border-radius: 50%; z-index: -1; }
  .ico { width: 18px; height: 18px; flex-shrink: 0; }
  .g { background: var(--g); color: #fff; } .lime { background: var(--lime); color: var(--ink); }
  .sun { background: var(--sun); color: #3D2E00; } .mint { background: var(--mint); color: #1E3A0A; }
  .coral { background: var(--coral); color: #2E0E04; } .pink { background: var(--pink); color: #3A1210; }
  .white { background: #fff; color: var(--ink); } .redc { background: var(--red); color: #fff; } .dark { background: var(--ink); color: #fff; }
"""

JS_COMMON = r"""
  let H = null; let deviceId = null; let lastData = null;
  const $root = () => document.getElementById('root');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SVG = (p, s = 18, c = 'currentColor') => `<svg class="ico" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const IC = {
    clock: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    box: SVG('<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>'),
    plus: SVG('<path d="M12 5v14M5 12h14"/>'),
    check: SVG('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    bowl: SVG('<path d="M4 11h16a8 8 0 0 1-16 0z"/><path d="M9 7c0-2 2-2 2-4M14 7c0-2 2-2 2-4"/>'),
    refresh: SVG('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  };
  const TINTS = ['var(--mint)', 'var(--sun)', 'var(--pink)', '#E6F2CF', '#FFE8A3'];
  function thumb(r, i, size) {
    const bg = TINTS[i % TINTS.length];
    const img = r.image ? `<img src="${esc(r.image)}" alt="" style="width:100%;height:100%;object-fit:cover" onerror="this.remove()">` : '';
    return `<div style="width:${size}px;height:${size}px;border-radius:12px;background:${bg};flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;position:relative"><span style="position:absolute">${IC.bowl}</span><span style="position:relative;width:100%;height:100%">${img}</span></div>`;
  }
  const mins = (r) => [r.minutes ? `${r.minutes} min` : '', r.difficulty || ''].filter(Boolean).join(' · ');

  function draw(d) {
    lastData = d;
    const root = $root();
    if (!d) { root.innerHTML = `<div class="t white"><div class="msg">Voeg eerst je HelloFresh-account toe in Homey</div></div>`; return; }
    if (d.loading) { root.innerHTML = `<div class="t white"><div class="msg">Gegevens ophalen…</div></div>`; return; }
    root.innerHTML = render(d);
    root.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => act(b)));
    fit();
  }

  function fit() {
    if (!H || typeof AUTO === 'undefined' || !AUTO) return;
    const el = $root().firstElementChild;
    if (!el) return;
    el.style.height = 'auto';
    const h = Math.ceil(el.getBoundingClientRect().height);
    el.style.height = '';
    $root().style.height = `${h}px`;
    try { H.setHeight(h); } catch (e) { /* oudere Homey */ }
  }

  async function load() {
    try {
      draw(await H.api('GET', deviceId ? `/?id=${encodeURIComponent(deviceId)}` : '/'));
    } catch (e) {
      $root().innerHTML = `<div class="t white"><div class="msg">${esc(e.message || e)}</div></div>`;
    }
  }

  async function act(btn) {
    btn.classList.add('busy');
    const old = btn.innerHTML;
    try {
      const res = await H.api('POST', '/action', { id: deviceId, action: btn.dataset.a, which: btn.dataset.w });
      if (btn.dataset.a === 'bring') btn.innerHTML = `${IC.check} ${res && res.count ? `${res.count} toegevoegd` : 'Stond er al op'}`;
      else btn.innerHTML = `${IC.check} Gedaan`;
    } catch (e) {
      btn.textContent = e.message || 'Mislukt';
    }
    setTimeout(() => { btn.innerHTML = old; btn.classList.remove('busy'); load(); }, 2500);
  }

  function onHomeyReady(Homey) {
    H = Homey;
    const settings = Homey.getSettings() || {};
    deviceId = settings.device && settings.device.id ? settings.device.id : null;
    $root().style.height = `${HEIGHT}px`;
    load().then(() => Homey.ready({ height: AUTO ? Math.ceil($root().getBoundingClientRect().height) || HEIGHT : HEIGHT }));
    setInterval(load, 60000);
    try { Homey.on('update', load); } catch (e) { /* oudere Homey */ }
  }
"""

# ---------- per widget: naam, hoogte, auto-hoogte, render-functie ----------

WIDGETS = {
  'this_week': dict(
    name=('This week', 'Deze week'), height=330, auto=True,
    render=r"""
  function render(d) {
    const w = d.thisWeek;
    const box = w && !w.skipped ? w : null;
    if (!w) return `<div class="t g"><div class="lab">Deze week</div><div class="msg">Deze week geen box</div></div>`;
    if (w.skipped) return `<div class="t mint"><div class="lab">Deze week · week ${esc(w.weekNo)}<span class="pill redc">Overgeslagen</span></div>
      <div class="big">${esc(w.long || w.label)}</div><div class="sub">Geen box deze week.</div></div>`;
    const slot = box.slot ? (box.slot.to ? `${box.slot.from} – ${box.slot.to}` : `vanaf ${box.slot.from}`) : 'Tijdvak nog onbekend';
    const rows = (box.recipes || []).map((r, i) => `<div style="display:flex;gap:10px;align-items:center;background:#fff;color:var(--ink);border-radius:14px;padding:7px">
        ${thumb(r, i, 42)}<div style="min-width:0;flex:1"><div style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.quantity > 1 ? `${r.quantity}× ` : ''}${esc(r.name)}</div>
        <div style="font-size:12px;opacity:.7">${esc(mins(r))}</div></div></div>`).join('');
    const state = d.thisWeek && d.nextBox && d.nextBox.week === box.week ? d.stateText : (box.date < d.today ? 'Bezorgd' : 'Gepland');
    return `<div class="t g">
      <span class="dot" style="width:150px;height:150px;background:var(--lime);top:-70px;right:-50px"></span>
      <span class="dot" style="width:40px;height:40px;background:var(--sun);top:58px;right:26px"></span>
      <div class="lab">Deze week · week ${esc(box.weekNo)}<span class="pill dark">${esc(state)}</span></div>
      <div class="big" style="max-width:78%">${esc(box.long)}</div>
      <div class="sub" style="display:flex;gap:6px;align-items:center">${IC.clock}${esc(slot)}</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px">${rows || '<div class="sub">Recepten nog niet bekend</div>'}</div>
    </div>`;
  }"""),

  'next_week': dict(
    name=('Next week', 'Volgende week'), height=170, auto=True,
    render=r"""
  function render(d) {
    const w = d.nextWeek;
    if (!w) return `<div class="t mint"><div class="lab">Volgende week</div><div class="msg">Nog geen gegevens voor volgende week</div></div>`;
    if (w.skipped) return `<div class="t mint"><div class="lab">Volgende week · week ${esc(w.weekNo)}<span class="pill redc">Overgeslagen</span></div>
      <div class="big">${esc(w.label)}</div><div class="sub">Geen box — het rolluik blijft dicht.</div></div>`;
    const names = (w.recipes || []).map((r) => esc(r.name)).join(' · ');
    return `<div class="t mint"><div class="lab">Volgende week · week ${esc(w.weekNo)}<span class="pill g">Actief</span></div>
      <div class="big">${esc(w.long)}</div>
      <div class="sub">${names || (w.locked ? 'Recepten nog niet bekend' : 'Recepten kun je nog kiezen')}</div></div>`;
  }"""),

  'delivery_live': dict(
    name=('Delivery live', 'Levertijd live'), height=170, auto=False,
    render=r"""
  function render(d) {
    const b = d.nextBox;
    if (!b) return `<div class="t white"><div class="lab">Levertijd</div><div class="msg">Geen bezorging gepland</div></div>`;
    const order = ['scheduled', 'on_the_way', 'delivered'];
    const st = d.state === 'today' ? 'scheduled' : d.state;
    const idx = Math.max(0, order.indexOf(st));
    const step = (i, label) => {
      const done = i < idx; const now = i === idx;
      const bg = now ? (i === 2 ? 'var(--g)' : 'var(--coral)') : done ? 'var(--g)' : '#D9DED6';
      const ring = now && i < 2 ? 'box-shadow:0 0 0 6px #FFE2CC;' : '';
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;width:74px"><span style="width:22px;height:22px;border-radius:11px;background:${bg};${ring}"></span><span style="font-size:12px;font-weight:${now ? 800 : 500}">${label}</span></div>`;
    };
    const line = (i) => `<div style="flex:1;height:4px;border-radius:2px;margin-bottom:22px;background:${i < idx ? 'var(--g)' : '#D9DED6'}"></div>`;
    const when = b.date === d.today ? 'Vandaag' : (b.daysUntil === 1 ? 'Morgen' : esc(b.label));
    const slot = d.slotText ? `tussen <b>${esc(d.slotText)}</b>` : 'tijdvak nog onbekend';
    return `<div class="t white"><div class="lab">Levertijd live<span class="pill mint">${esc(d.stateText)}</span></div>
      <div style="display:flex;align-items:center;margin-top:4px">${step(0, 'Gepland')}${line(0)}${step(1, 'Onderweg')}${line(1)}${step(2, 'Bezorgd')}</div>
      <div class="sub">${when} ${slot}${d.liveAt && d.state !== 'scheduled' && d.state !== 'today' ? ` · sinds ${esc(d.liveAt)}` : ''}</div></div>`;
  }"""),

  'countdown': dict(
    name=('Countdown', 'Aftellen'), height=170, auto=False,
    render=r"""
  function render(d) {
    const b = d.nextBox;
    if (!b) return `<div class="t lime"><div class="lab">Aftellen</div><div class="msg">Geen box gepland</div></div>`;
    const n = b.daysUntil;
    const big = n === 0 ? 'Vandaag!' : n;
    const text = n === 0 ? (d.slotText ? `tussen ${esc(d.slotText)}` : 'je box komt vandaag') : n === 1 ? 'dag tot je box' : 'dagen tot je box';
    return `<div class="t lime"><div class="lab">Aftellen<span class="pill dark">${esc(b.label)}</span></div>
      <div style="font-size:${n === 0 ? 40 : 64}px;font-weight:800;line-height:1;margin-top:auto">${big}</div>
      <div style="font-size:15px;font-weight:700">${text}</div></div>`;
  }"""),

  'menu_deadline': dict(
    name=('Choose menu', 'Menu kiezen'), height=170, auto=False,
    render=r"""
  function render(d) {
    const m = d.menuOpen;
    if (!m) return `<div class="t sun"><div class="lab">Menu kiezen</div><div class="msg">Geen open menu gevonden</div></div>`;
    const left = m.hoursLeft < 48 ? `nog ${m.hoursLeft} uur` : `nog ${Math.floor(m.hoursLeft / 24)} dagen`;
    return `<div class="t sun"><div class="lab">Menu kiezen<span class="pill dark">${esc(left)}</span></div>
      <div class="big" style="font-size:22px">Kies je recepten voor week ${esc(m.weekNo)}</div>
      <div class="sub" style="font-weight:700">vóór ${esc(m.label)}</div></div>`;
  }"""),

  'box_outside': dict(
    name=('Box outside', 'Box staat buiten'), height=170, auto=False,
    render=r"""
  function render(d) {
    if (!d.outsideSince) {
      const txt = d.state === 'today' || d.state === 'on_the_way' ? 'Je box komt vandaag. Hier zie je wanneer hij buiten staat.' : 'Er staat geen box buiten.';
      return `<div class="t mint"><div class="lab">Box staat buiten</div><div style="display:flex;gap:8px;align-items:center;margin-top:auto">${IC.check}<span class="sub" style="font-weight:700">${txt}</span></div></div>`;
    }
    return `<div class="t coral"><div class="lab">Box staat buiten</div>
      <div style="display:flex;gap:10px;align-items:center">${SVG('<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>', 30)}<div class="big">Sinds ${esc(d.outsideSince)}</div></div>
      <div class="sub">Zet hem in de koelkast.</div>
      <button class="btn dark" data-a="inside" style="margin-top:auto">${IC.check} Box is binnen</button></div>`;
  }"""),

  'pantry': dict(
    name=('From your pantry', 'Zelf in huis'), height=210, auto=True,
    render=r"""
  function render(d) {
    const b = d.nextBox;
    const items = (b && b.pantry) || [];
    const list = items.length ? items.map((i) => `<span style="background:#fff;border-radius:12px;padding:5px 10px;font-size:13px;font-weight:600">${esc(i)}</span>`).join('')
      : `<span class="sub">${b && b.recipes && b.recipes.length ? 'Niets extra nodig' : 'Nog geen recepten bekend'}</span>`;
    const btn = items.length && d.bringAvailable
      ? `<button class="btn redc" data-a="bring" data-w="box" style="margin-top:6px">${IC.plus} Zet op Bring-lijst</button>`
      : items.length ? '<div class="sub muted">Installeer de app Bring! Boodschappenlijst om dit op je lijst te zetten.</div>' : '';
    return `<div class="t pink"><div class="lab">Zelf in huis${b ? `<span class="pill white">${esc(b.label)}</span>` : ''}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${list}</div>${btn}</div>`;
  }"""),

  'weeks': dict(
    name=('Upcoming weeks', 'Komende weken'), height=150, auto=False,
    render=r"""
  function render(d) {
    const weeks = (d.weeks || []).filter((w) => !w.date || w.date >= d.today || w.week === (d.thisWeek && d.thisWeek.week)).slice(0, 4);
    if (!weeks.length) return `<div class="t white"><div class="lab">Komende weken</div><div class="msg">Geen weken gevonden</div></div>`;
    const cells = weeks.map((w) => `<div class="${w.skipped ? 'coral' : 'mint'}" style="border-radius:14px;padding:9px 8px;min-width:0">
        <div style="font-size:11px;font-weight:700">Week ${esc(w.weekNo)}</div>
        <div style="font-size:15px;font-weight:800;white-space:nowrap">${esc(w.label || '–')}</div>
        <div style="font-size:11px">${w.skipped ? 'Overgeslagen' : 'Actief'}</div></div>`).join('');
    return `<div class="t white"><div class="lab">Komende weken</div>
      <div style="display:grid;grid-template-columns:repeat(${weeks.length},minmax(0,1fr));gap:6px">${cells}</div></div>`;
  }"""),

  'statusbar': dict(
    name=('Status bar', 'Statusbalk'), height=56, auto=False,
    render=r"""
  function render(d) {
    const b = d.nextBox;
    let text = 'Geen box gepland';
    if (b) {
      const when = b.date === d.today ? 'vandaag' : b.daysUntil === 1 ? 'morgen' : b.label;
      text = [when, d.slotText, b.recipes && b.recipes.length ? `${b.recipes.length} recepten` : ''].filter(Boolean).join(' · ');
    }
    const dot = d.outsideSince ? 'var(--coral)' : d.state === 'on_the_way' ? 'var(--sun)' : 'var(--lime)';
    const extra = d.outsideSince ? ` · buiten sinds ${esc(d.outsideSince)}` : (d.state === 'on_the_way' || d.state === 'delivered' ? ` · ${esc(d.stateText.toLowerCase())}` : '');
    return `<div class="t g" style="flex-direction:row;align-items:center;gap:10px;padding:0 18px;border-radius:28px">
      <span style="width:12px;height:12px;border-radius:6px;background:${dot};flex-shrink:0"></span>
      <b style="font-size:15px">HelloFresh</b><span style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(text)}${extra}</span></div>`;
  }"""),
}

COMPOSE_SETTINGS = [{
  "id": "device", "type": "autocomplete",
  "title": {"en": "HelloFresh account", "nl": "HelloFresh-account"},
}]

API_JS = "'use strict';\n\nmodule.exports = require('../../lib/widgetApi');\n"


def page(wid, cfg):
    return f"""<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>{CSS}</style>
</head>
<body>
<div id="root"><div class="t white"><div class="msg">Laden…</div></div></div>
<script>
  const HEIGHT = {cfg['height']};
  const AUTO = {'true' if cfg['auto'] else 'false'};
{JS_COMMON}
{cfg['render']}
</script>
</body>
</html>
"""


for wid, cfg in WIDGETS.items():
    d = os.path.join(ROOT, wid)
    os.makedirs(os.path.join(d, 'public'), exist_ok=True)
    compose = {
        "name": {"en": cfg['name'][0], "nl": cfg['name'][1]},
        "height": cfg['height'],
        "transparent": True,
        "settings": COMPOSE_SETTINGS,
        "api": {
            "getData": {"method": "GET", "path": "/"},
            "action": {"method": "POST", "path": "/action"},
        },
    }
    with open(os.path.join(d, 'widget.compose.json'), 'w') as f:
        f.write(json.dumps(compose, indent=2, ensure_ascii=False) + '\n')
    with open(os.path.join(d, 'api.js'), 'w') as f:
        f.write(API_JS)
    with open(os.path.join(d, 'public', 'index.html'), 'w') as f:
        f.write(page(wid, cfg))
    print('widget', wid)
