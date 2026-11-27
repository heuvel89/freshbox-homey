'use strict';

const Homey = require('homey');
const { HelloFreshApi } = require('../../lib/HelloFreshApi');
const {
  parseDeliveries, parseMenu, parseRecipe, pantryList,
} = require('../../lib/model');
const {
  localDate, localTime, localMinutes, isoWeekOf, shiftWeek, weekNumber, shortLabel, longLabel,
  daysBetween, DAY,
} = require('../../lib/dates');

const STATE_TEXT = {
  none: 'Geen bezorging gepland',
  scheduled: 'Gepland',
  today: 'Wordt vandaag bezorgd',
  on_the_way: 'Onderweg',
  delivered: 'Bezorgd',
  skipped: 'Overgeslagen',
};
const MAX_RECIPE_CACHE = 40;

class FreshBoxDevice extends Homey.Device {

  async onInit() {
    this.recipeCache = this.getStoreValue('recipes') || {};
    this.summary = this.getStoreValue('summary') || null;
    this._makeApi();

    for (const cap of ['button.refresh', 'button.box_inside']) {
      if (!this.hasCapability(cap)) await this.addCapability(cap).catch(this.error);
    }
    this.registerCapabilityListener('button.refresh', () => this.poll(true));
    this.registerCapabilityListener('button.box_inside', () => this.boxInside());

    if (this.summary) await this._applyCapabilities().catch(this.error);
    this.tick = this.homey.setInterval(() => this._tick().catch(this.error), 60 * 1000);
    this.poll(true).catch(this.error);
  }

  _makeApi() {
    this.api = new HelloFreshApi({
      country: this.getStoreValue('country') || 'NL',
      accessToken: this.getStoreValue('accessToken'),
      refreshToken: this.getStoreValue('refreshToken'),
      email: this.getStoreValue('email'),
      password: this.getStoreValue('password'),
      log: this.log.bind(this),
      onTokens: ({ accessToken, refreshToken }) => {
        this.setStoreValue('accessToken', accessToken).catch(this.error);
        this.setStoreValue('refreshToken', refreshToken).catch(this.error);
      },
    });
  }

  async updateLogin({ accessToken, refreshToken, country, email, password }) {
    await this.setStoreValue('password', password || null);
    await this.setStoreValue('accessToken', accessToken);
    await this.setStoreValue('refreshToken', refreshToken);
    await this.setStoreValue('country', country);
    await this.setStoreValue('email', email);
    this._makeApi();
    await this.setAvailable().catch(this.error);
    await this.poll(true);
  }

  /* ---------- hulpjes ---------- */

  get tz() { return this.homey.clock.getTimezone(); }

  _today() { return localDate(new Date(), this.tz); }

  _alwaysHave() {
    return String(this.getSetting('always_have') || '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  }

  _fired() { return this.getStoreValue('fired') || {}; }

  async _setFired(patch) {
    await this.setStoreValue('fired', { ...this._fired(), ...patch });
  }

  _live() { return this.getStoreValue('live') || {}; }

  _trigger(id, tokens = {}, state = {}) {
    this.homey.flow.getDeviceTriggerCard(id).trigger(this, tokens, state).catch(this.error);
  }

  /* ---------- ophalen ---------- */

  async poll(force = false) {
    if (this._polling) return this._polling;
    if (this.pollTimer) this.homey.clearTimeout(this.pollTimer);
    this._polling = this._doPoll()
      .catch(async (err) => {
        this.error('Bijwerken mislukt:', err.message);
        if (err.auth) await this.setUnavailable(this.homey.__('device.login_failed')).catch(this.error);
        if (this.summary) {
          this.summary.error = err.message;
          this.homey.api.realtime('update', {}).catch(() => {});
        }
        if (force) throw err;
      })
      .finally(() => {
        this._polling = null;
        this._schedule();
      });
    return this._polling;
  }

  _schedule() {
    const s = this.summary;
    const deliveryDay = s && s.nextBox && s.nextBox.date === this._today();
    const minutes = deliveryDay ? (this.getSetting('poll_day') || 15) : (this.getSetting('poll_normal') || 60);
    this.pollTimer = this.homey.setTimeout(() => this.poll().catch(this.error), Math.max(5, minutes) * 60 * 1000);
  }

  async _info() {
    const cached = this.getStoreValue('info');
    if (cached && Date.now() - cached.at < DAY) return cached;
    try {
      const raw = await this.api.getCustomerInfo() || {};
      const sku = Array.isArray(raw.activeSubscriptionSkus) ? raw.activeSubscriptionSkus[0] : raw.activeSubscriptionSkus;
      const info = { at: Date.now(), subscription: raw.activeSubscriptionId || null, sku: sku || null };
      await this.setStoreValue('info', info);
      return info;
    } catch (err) {
      if (err.auth) throw err;
      this.error('Klantgegevens niet opgehaald:', err.message);
      return cached || {};
    }
  }

  async _recipesFor(week, info) {
    let raw;
    try {
      raw = await this.api.getMenu(week, info);
    } catch (err) {
      if (err.auth) throw err;
      this.error(`Menu ${week} niet opgehaald:`, err.message);
      return null;
    }
    const recipes = parseMenu(raw);
    // Ingrediënten (voor "zelf in huis") staan niet altijd in het menu: los ophalen en onthouden
    for (let i = 0; i < recipes.length; i++) {
      const r = recipes[i];
      if (r.hasIngredients || !r.id) continue;
      if (this.recipeCache[r.id]) {
        recipes[i] = { ...this.recipeCache[r.id], quantity: r.quantity };
        continue;
      }
      try {
        const full = parseRecipe(await this.api.getRecipe(r.id), r.quantity);
        if (full) {
          recipes[i] = { ...r, ...full, image: full.image || r.image };
          this.recipeCache[r.id] = recipes[i];
        }
      } catch (err) {
        this.error(`Recept ${r.id} niet opgehaald:`, err.message);
      }
    }
    return recipes;
  }

  async _doPoll() {
    const tz = this.tz;
    const today = this._today();
    const current = isoWeekOf(today);
    const raw = await this.api.getDeliveries(shiftWeek(current, -2), shiftWeek(current, 5));
    this.lastRaw = raw;
    const weeks = parseDeliveries(raw, tz).sort((a, b) => (a.week < b.week ? -1 : 1));
    const info = await this._info();

    const byWeek = (w) => weeks.find((x) => x.week === w) || null;
    const now = Date.now();

    // Volgende box: eerste niet-overgeslagen bezorging vanaf vandaag
    const upcoming = weeks.filter((w) => !w.skipped && w.date && w.date >= today);
    const nextBoxWeek = upcoming[0] || null;
    // Menu kiezen: eerste actieve week waarvan de deadline nog komt
    const open = weeks.filter((w) => !w.skipped && w.cutoff && Date.parse(w.cutoff) > now)[0] || null;

    // Welke weken hebben recepten nodig
    const thisWeek = byWeek(current) || (nextBoxWeek && daysBetween(today, nextBoxWeek.date) < 7 ? nextBoxWeek : null);
    const nextWeek = byWeek(shiftWeek(thisWeek ? thisWeek.week : current, 1));
    const need = [...new Set([thisWeek, nextWeek, nextBoxWeek].filter((w) => w && !w.skipped).map((w) => w.week))];
    const recipes = {};
    for (const w of need) recipes[w] = await this._recipesFor(w, info);

    // Cache opruimen
    const ids = Object.keys(this.recipeCache);
    if (ids.length > MAX_RECIPE_CACHE) for (const id of ids.slice(0, ids.length - MAX_RECIPE_CACHE)) delete this.recipeCache[id];
    await this.setStoreValue('recipes', this.recipeCache).catch(this.error);

    const always = this._alwaysHave();
    const decorate = (w) => {
      if (!w) return null;
      const r = recipes[w.week] || [];
      return {
        ...w,
        weekNo: weekNumber(w.week),
        label: shortLabel(w.date),
        long: longLabel(w.date),
        locked: !!(w.cutoff && Date.parse(w.cutoff) <= now),
        recipes: r,
        pantry: pantryList(r, always),
      };
    };

    const prev = this.summary;
    const list = weeks.filter((w) => w.week >= shiftWeek(current, -1)).slice(0, 6).map((w) => ({
      week: w.week, weekNo: weekNumber(w.week), date: w.date, label: shortLabel(w.date), skipped: w.skipped, status: w.status,
    }));

    const nextBox = decorate(nextBoxWeek);
    if (nextBox) nextBox.daysUntil = daysBetween(today, nextBox.date);

    // Live status uit de API overnemen (als HelloFresh die geeft)
    if (nextBoxWeek && nextBoxWeek.date === today) {
      if (nextBoxWeek.delivered && this._live().state !== 'delivered') await this.setLiveState('delivered', 'api');
      else if (nextBoxWeek.onTheWay && !this._live().state) await this.setLiveState('on_the_way', 'api');
    }

    this.summary = {
      updated: new Date().toISOString(),
      error: null,
      today,
      weeks: list,
      thisWeek: decorate(thisWeek),
      nextWeek: decorate(nextWeek),
      nextBox,
      menuOpen: open ? {
        week: open.week,
        weekNo: weekNumber(open.week),
        deadline: open.cutoff,
        label: `${shortLabel(localDate(new Date(open.cutoff), tz))} ${localTime(new Date(open.cutoff), tz)}`,
        hoursLeft: Math.max(0, Math.floor((Date.parse(open.cutoff) - now) / 3600000)),
      } : null,
    };
    await this.setStoreValue('summary', this.summary).catch(this.error);
    await this.setAvailable().catch(this.error);
    await this._applyCapabilities();
    await this._compare(prev, this.summary);
    this.homey.api.realtime('update', {}).catch(() => {});
  }

  /** Veranderingen sinds de vorige keer -> triggers */
  async _compare(prev, next) {
    // Week overgeslagen
    if (prev && prev.weeks) {
      for (const w of next.weeks) {
        const before = prev.weeks.find((p) => p.week === w.week);
        if (before && !before.skipped && w.skipped) {
          this._trigger('week_skipped', { week: w.weekNo || 0, date: w.label || '' });
        }
      }
    }

    // Nieuwe recepten: als de box vastligt (deadline voorbij) en de recepten anders zijn dan de vorige keer
    const box = next.nextBox;
    if (box && box.locked && box.recipes.length) {
      const hash = `${box.week}:${box.recipes.map((r) => `${r.id}x${r.quantity}`).sort().join(',')}`;
      const fired = this._fired();
      if (fired.recipes !== hash) {
        await this._setFired({ recipes: hash });
        this._trigger('new_recipes', {
          week: box.weekNo || 0,
          recipes: box.recipes.map((r) => r.name).join(', '),
          pantry: box.pantry.join(', '),
        });
        if (this.getSetting('bring_auto') && fired.bring !== box.week && box.pantry.length) {
          await this._setFired({ bring: box.week });
          this.pantryToBring('box', 'auto').catch((err) => this.error('Bring:', err.message));
        }
      }
    }

    const oldText = prev ? this._stateText(prev) : null;
    const newText = this._stateText(next);
    if (oldText && oldText !== newText) this._trigger('status_changed', { status: newText });
  }

  /* ---------- status ---------- */

  _stateKey(s = this.summary) {
    if (!s || !s.nextBox) return s && s.thisWeek && s.thisWeek.skipped ? 'skipped' : 'none';
    const live = this._live();
    if (s.nextBox.date === this._today()) {
      if (live.week === s.nextBox.week && live.state) return live.state;
      return 'today';
    }
    // Vandaag al bezorgd en de volgende box staat al klaar: dag blijft "bezorgd"
    if (live.state === 'delivered' && live.date === this._today()) return 'delivered';
    return 'scheduled';
  }

  _stateText(s) { return STATE_TEXT[this._stateKey(s)]; }

  _slotText(box) {
    if (!box || !box.slot) return '';
    return box.slot.to ? `${box.slot.from} – ${box.slot.to}` : `vanaf ${box.slot.from}`;
  }

  async setLiveState(state, source = 'flow') {
    const s = this.summary;
    const box = s && s.nextBox;
    const today = this._today();
    const old = this._live();
    if (state === 'scheduled') {
      await this.setStoreValue('live', {});
    } else {
      const same = old.state === state && old.date === today;
      const live = {
        state,
        source,
        week: box && box.date === today ? box.week : (old.week || (box && box.week)),
        date: today,
        at: same ? old.at : new Date().toISOString(),
        outsideSince: state === 'delivered' ? (same ? old.outsideSince : new Date().toISOString()) : null,
      };
      await this.setStoreValue('live', live);
      if (!same) {
        this.log(`Status ${state} (bron: ${source})`);
        if (state === 'on_the_way') this._trigger('on_the_way');
        if (state === 'delivered') this._trigger('delivered', { time: localTime(new Date(), this.tz) });
      }
    }
    const before = this.getCapabilityValue('fb_status');
    await this._applyCapabilities();
    const after = this.getCapabilityValue('fb_status');
    if (before && before !== after) this._trigger('status_changed', { status: after });
    this.homey.api.realtime('update', {}).catch(() => {});
    return true;
  }

  async boxInside() {
    const live = this._live();
    if (live.outsideSince) await this.setStoreValue('live', { ...live, outsideSince: null });
    await this._applyCapabilities();
    this.homey.api.realtime('update', {}).catch(() => {});
    return true;
  }

  async _applyCapabilities() {
    const s = this.summary;
    if (!s) return;
    const box = s.nextBox;
    const set = (cap, value) => (this.hasCapability(cap) ? this.setCapabilityValue(cap, value).catch(this.error) : null);
    await set('fb_status', this._stateText(s));
    await set('fb_next_delivery', box ? box.long : '–');
    await set('fb_time_slot', box ? (this._slotText(box) || 'onbekend') : '–');
    await set('fb_days_until', box ? box.daysUntil : null);
    const nw = s.nextWeek;
    await set('fb_next_week', nw ? (nw.skipped ? 'Overgeslagen' : `Actief · ${nw.label}`) : '–');
    await set('fb_recipes', box && box.recipes.length ? `${box.recipes.length} recepten` : '–');
    await set('alarm_generic', this.isBoxOutside());
  }

  /* ---------- elke minuut: tijd-triggers ---------- */

  async _tick() {
    const s = this.summary;
    if (!s) return;
    const now = new Date();
    const today = this._today();
    const minutes = localMinutes(now, this.tz);
    const fired = this._fired();
    const box = s.nextBox;

    // Box staat buiten: om middernacht vanzelf weg
    const live = this._live();
    if (live.outsideSince && localDate(new Date(live.outsideSince), this.tz) !== today) await this.boxInside();
    if (live.state && live.date && live.date !== today) await this.setStoreValue('live', {});

    if (box && box.date) {
      const slot = this._slotText(box);
      const days = daysBetween(today, box.date);
      const tomorrowHour = Number(this.getSetting('tomorrow_hour') ?? 19);
      const dayHour = Number(this.getSetting('day_hour') ?? 7);

      if (days === 1 && minutes >= tomorrowHour * 60 && fired.tomorrow !== box.week) {
        await this._setFired({ tomorrow: box.week });
        this._trigger('delivery_tomorrow', { date: box.long, slot });
      }
      if (days === 0 && minutes >= dayHour * 60 && fired.day !== box.week) {
        await this._setFired({ day: box.week });
        this._trigger('delivery_day', { date: box.long, slot, recipes: box.recipes.map((r) => r.name).join(', ') });
        await this._applyCapabilities();
        this.poll().catch(this.error);
      }
      // Tijdvak begint over x minuten
      if (days === 0 && box.slot && box.slot.from) {
        const [h, m] = box.slot.from.split(':').map(Number);
        const left = h * 60 + m - minutes;
        if (left >= 0 && left <= 360) this._trigger('slot_starts_in', { slot }, { minutes: left });
      }
    }

    // Menu kiezen sluit over x uur (op het hele uur)
    const menu = s.menuOpen;
    if (menu && menu.deadline) {
      const msLeft = Date.parse(menu.deadline) - now.getTime();
      const hoursLeft = Math.round(msLeft / 3600000);
      const mark = `${menu.week}:${hoursLeft}`;
      if (msLeft > 0 && Math.abs(msLeft - hoursLeft * 3600000) < 60000 && this._lastMenuMark !== mark) {
        this._lastMenuMark = mark;
        this._trigger('menu_closes_in', { week: menu.weekNo || 0, deadline: menu.label }, { hours: hoursLeft });
      }
    }
  }

  /* ---------- voor flowkaarten en widgets ---------- */

  isDeliveryDay() {
    const box = this.summary && this.summary.nextBox;
    return !!(box && box.date === this._today());
  }

  isWeekSkipped(which) {
    const s = this.summary;
    const w = s && (which === 'next' ? s.nextWeek : s.thisWeek);
    return !!(w && w.skipped);
  }

  isWithinSlot() {
    const box = this.summary && this.summary.nextBox;
    if (!box || box.date !== this._today() || !box.slot || !box.slot.from) return false;
    const now = localTime(new Date(), this.tz);
    return now >= box.slot.from && (!box.slot.to || now <= box.slot.to);
  }

  deliveryWithin(days) {
    const box = this.summary && this.summary.nextBox;
    return !!(box && box.daysUntil !== undefined && box.daysUntil <= days);
  }

  isBoxOutside() {
    const live = this._live();
    return !!(live.outsideSince && localDate(new Date(live.outsideSince), this.tz) === this._today());
  }

  isDeliveredToday() {
    const live = this._live();
    return live.state === 'delivered' && live.date === this._today();
  }

  _weekFor(which) {
    const s = this.summary || {};
    if (which === 'this') return s.thisWeek;
    if (which === 'next') return s.nextWeek;
    return s.nextBox;
  }

  async recipesText(which) {
    const w = this._weekFor(which);
    const recipes = (w && w.recipes) || [];
    return {
      text: recipes.length ? recipes.map((r) => (r.quantity > 1 ? `${r.quantity}× ${r.name}` : r.name)).join(', ') : '',
      pantry: ((w && w.pantry) || []).join(', '),
      count: recipes.length,
    };
  }

  async pantryToBring(which, source = 'flow') {
    const w = this._weekFor(which || 'box');
    const items = (w && w.pantry) || [];
    if (!items.length) return { added: '', count: 0 };
    const added = await this.homey.app.addToBring(items, this.getSetting('bring_spec') || 'HelloFresh');
    this.log(`Bring (${source}): ${added.length} toegevoegd`);
    return { added: added.join(', '), count: added.length };
  }

  /** Alles wat de widgets nodig hebben */
  getWidgetData() {
    const s = this.summary;
    if (!s) return { loading: true };
    const live = this._live();
    const key = this._stateKey(s);
    return {
      ...s,
      name: this.getName(),
      state: key,
      stateText: STATE_TEXT[key],
      slotText: this._slotText(s.nextBox),
      liveAt: live.at ? localTime(new Date(live.at), this.tz) : null,
      outsideSince: this.isBoxOutside() ? localTime(new Date(live.outsideSince), this.tz) : null,
      withinSlot: this.isWithinSlot(),
      now: localTime(new Date(), this.tz),
      bringAvailable: this.homey.app.bringInstalled !== false,
    };
  }

  /** Voor de instellingenpagina: ruwe gegevens zonder persoonlijke velden */
  async diagnose() {
    if (!this.lastRaw) await this.poll(true).catch(() => {});
    const strip = (v, depth = 0) => {
      if (Array.isArray(v)) return v.slice(0, 8).map((x) => strip(x, depth + 1));
      if (v && typeof v === 'object') {
        if (depth > 6) return '…';
        const out = {};
        for (const [k, val] of Object.entries(v)) {
          if (/name|email|phone|address|street|zip|postal|postcode|house|city|token|iban|card|firstname|lastname/i.test(k)
            && typeof val !== 'object') out[k] = '•••';
          else out[k] = strip(val, depth + 1);
        }
        return out;
      }
      return v;
    };
    return {
      updated: this.summary && this.summary.updated,
      error: this.summary && this.summary.error,
      country: this.api.country,
      deliveries: strip(this.lastRaw),
      parsed: this.summary && this.summary.weeks,
      nextBox: this.summary && this.summary.nextBox && {
        week: this.summary.nextBox.week, date: this.summary.nextBox.date, slot: this.summary.nextBox.slot, status: this.summary.nextBox.status,
        recipes: this.summary.nextBox.recipes.map((r) => ({ name: r.name, pantry: r.pantry, hasIngredients: r.hasIngredients })),
      },
    };
  }

  async onSettings({ changedKeys }) {
    if (changedKeys.some((k) => ['poll_normal', 'poll_day', 'always_have'].includes(k))) {
      this.homey.setTimeout(() => this.poll().catch(this.error), 500);
    }
  }

  async onDeleted() { this.onUninit(); }

  async onUninit() {
    if (this.tick) this.homey.clearInterval(this.tick);
    if (this.pollTimer) this.homey.clearTimeout(this.pollTimer);
  }

}

module.exports = FreshBoxDevice;
