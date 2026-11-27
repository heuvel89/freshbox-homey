'use strict';

/**
 * Zet de ruwe antwoorden van HelloFresh om in een eenvoudig overzicht.
 * De API is niet gedocumenteerd, dus alles wordt voorzichtig gelezen:
 * ontbreekt een veld, dan blijft dat stukje leeg in plaats van dat de app stopt.
 */

const {
  localDate, localTime, parseApiDate, isoDurationMinutes,
} = require('./dates');

const MEDIA = 'https://media.hellofresh.com/hellofresh_s3';
const SKIPPED = ['PAUSED', 'CANCELLED', 'CANCELED', 'DONATED', 'SKIPPED', 'PAUSE', 'SKIP'];
const DELIVERED = ['DELIVERED', 'COMPLETED', 'COMPLETE'];
const ON_THE_WAY = ['SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DISPATCHED', 'ON_THE_WAY', 'IN_DELIVERY'];
const DIFFICULTY = { 1: 'gemakkelijk', 2: 'gemiddeld', 3: 'uitdagend' };

const ISO_WEEK = /^\d{4}-W\d{2}$/;

function str(v) { return typeof v === 'string' ? v : ''; }

/** Afbeelding uit de recepten-API naar media.hellofresh.com (zoals pyhellofresh) */
function mediaUrl(link, path) {
  const source = str(path).trim() || str(link).trim();
  if (!source) return null;
  if (/^https?:\/\//.test(source) && !source.includes('cloudfront.net')) return source;
  let asset = source;
  if (source.includes('cloudfront.net')) {
    const parts = source.split('/');
    if (parts.length <= 4) return source;
    asset = parts.slice(4).join('/');
  }
  asset = asset.replace(/^\/+/, '');
  return asset ? `${MEDIA}/${asset}` : null;
}

/* ---------- tijdvak zoeken ---------- */

function timeOf(value, tz) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  const hm = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(v);
  if (hm && Number(hm[1]) < 24 && Number(hm[2]) < 60) return `${hm[1].padStart(2, '0')}:${hm[2]}`;
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = parseApiDate(v);
    return d ? localTime(d, tz) : null;
  }
  return null;
}

const FROM_KEYS = /^(from|start|begin|earliest|starttime|start_time|fromtime|from_time|timefrom|windowstart|slotstart)$/i;
const TO_KEYS = /^(to|end|until|latest|endtime|end_time|totime|to_time|timeto|windowend|slotend)$/i;
const TIME_KEY = /slot|window|time|option|interval|handle|frame|delivery/i;
const RANGE = /(\d{1,2})[:.]?(\d{2})\s*(?:-|–|tot|to)\s*(\d{1,2})[:.]?(\d{2})/i;

function validSlot(from, to) {
  if (!from || !to || from === to) return null;
  if (to < from) return null;
  if (from === '00:00' && (to === '00:00' || to === '23:59')) return null;
  return { from, to };
}

function findSlot(obj, tz, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return null;
  // a) object met van/tot
  let from = null;
  let to = null;
  for (const [k, v] of Object.entries(obj)) {
    if (FROM_KEYS.test(k)) from = from || timeOf(v, tz);
    if (TO_KEYS.test(k)) to = to || timeOf(v, tz);
  }
  const pair = validSlot(from, to);
  if (pair) return pair;
  // b) tekst als "14:00-18:00" of "1400-1800" onder een sleutel die op tijd lijkt
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && TIME_KEY.test(k) && !/^\d{4}-\d{2}-\d{2}/.test(v)) {
      const m = RANGE.exec(v);
      if (m && Number(m[1]) < 24 && Number(m[3]) < 24 && Number(m[2]) < 60 && Number(m[4]) < 60) {
        const r = validSlot(`${m[1].padStart(2, '0')}:${m[2]}`, `${m[3].padStart(2, '0')}:${m[4]}`);
        if (r) return r;
      }
    }
  }
  // c) dieper zoeken, eerst in sleutels die op bezorging lijken
  const entries = Object.entries(obj).filter(([, v]) => v && typeof v === 'object');
  entries.sort(([a], [b]) => Number(TIME_KEY.test(b)) - Number(TIME_KEY.test(a)));
  for (const [, v] of entries) {
    const r = findSlot(v, tz, depth + 1);
    if (r) return r;
  }
  return null;
}

/* ---------- bezorgschema ---------- */

function weekId(raw) {
  const w = raw.week || raw.hfWeek || raw.deliveryWeek;
  if (typeof w === 'string' && ISO_WEEK.test(w)) return w;
  if (typeof raw.id === 'string' && ISO_WEEK.test(raw.id)) return raw.id;
  return '';
}

function hasWord(status, list) {
  const s = String(status || '').toUpperCase();
  return list.some((w) => s === w || s.includes(w));
}

/** Eén week uit het bezorgschema */
function parseWeek(raw, tz) {
  const status = str(raw.status) || str(raw.state) || str(raw.deliveryStatus);
  const deliveryAt = parseApiDate(raw.deliveryDate || raw.deliveryDateTime || raw.deliveryDay);
  const cutoffAt = parseApiDate(raw.cutoffDate || raw.cutoffDateTime || raw.cutoff);
  const skipped = raw.skipped === true || raw.isSkipped === true || raw.paused === true || hasWord(status, SKIPPED);
  let slot = findSlot(raw, tz);
  // Tijd in de bezorgdatum zelf (niet middernacht) is het begin van het tijdvak
  if (!slot && deliveryAt) {
    const t = localTime(deliveryAt, tz);
    if (t !== '00:00') slot = { from: t, to: null };
  }
  return {
    week: weekId(raw),
    status,
    skipped,
    delivered: hasWord(status, DELIVERED),
    onTheWay: hasWord(status, ON_THE_WAY),
    date: deliveryAt ? localDate(deliveryAt, tz) : null,
    cutoff: cutoffAt ? cutoffAt.toISOString() : null,
    slot,
  };
}

function parseDeliveries(data, tz) {
  const list = Array.isArray(data) ? data : ((data && (data.weeks || data.items || data.deliveries)) || []);
  return list.filter((w) => w && typeof w === 'object').map((w) => parseWeek(w, tz)).filter((w) => w.week);
}

/* ---------- menu en recepten ---------- */

function selectionQuantity(sel) {
  if (sel === null || sel === undefined || typeof sel === 'boolean') return 0;
  if (typeof sel === 'number') return Math.floor(sel);
  if (typeof sel === 'string') return Number.parseInt(sel, 10) || 0;
  if (typeof sel !== 'object' || sel.skipped) return 0;
  const q = sel.quantity;
  if (typeof q === 'number') return Math.floor(q);
  if (typeof q === 'string') return Number.parseInt(q, 10) || 0;
  return 0;
}

function parseRecipe(raw, quantity = 1) {
  if (!raw || typeof raw !== 'object') return null;
  const ingredients = Array.isArray(raw.ingredients) ? raw.ingredients : [];
  return {
    id: str(raw.id),
    name: str(raw.name) || 'Recept',
    headline: str(raw.headline),
    image: mediaUrl(raw.imageLink, raw.imagePath),
    minutes: isoDurationMinutes(raw.totalTime) || isoDurationMinutes(raw.prepTime),
    difficulty: DIFFICULTY[raw.difficulty] || null,
    url: str(raw.websiteUrl) || null,
    quantity,
    hasIngredients: ingredients.length > 0,
    pantry: ingredients.filter((i) => i && i.shipped === false && i.name).map((i) => String(i.name).trim()),
  };
}

function parseMenu(data) {
  const meals = (data && Array.isArray(data.meals)) ? data.meals : [];
  return meals
    .map((m) => ({ q: selectionQuantity(m.selection), recipe: m.recipe }))
    .filter((m) => m.q > 0 && m.recipe)
    .map((m) => parseRecipe(m.recipe, m.q))
    .filter(Boolean);
}

/** Zelf-in-huis van alle recepten samen, zonder dubbele en zonder wat je altijd hebt */
function pantryList(recipes, alwaysHave = []) {
  const skip = alwaysHave.map((s) => s.trim().toLowerCase()).filter(Boolean);
  const seen = new Map();
  for (const r of recipes || []) {
    for (const name of r.pantry || []) {
      const key = name.toLowerCase();
      if (skip.some((s) => key.includes(s))) continue;
      if (!seen.has(key)) seen.set(key, name.charAt(0).toUpperCase() + name.slice(1));
    }
  }
  return [...seen.values()];
}

module.exports = {
  parseDeliveries, parseWeek, parseMenu, parseRecipe, pantryList, findSlot, mediaUrl,
};
