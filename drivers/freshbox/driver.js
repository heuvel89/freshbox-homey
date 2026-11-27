'use strict';

const Homey = require('homey');
const { HelloFreshApi } = require('../../lib/HelloFreshApi');

class FreshBoxDriver extends Homey.Driver {

  async onInit() {
    const cond = (id, fn) => this.homey.flow.getConditionCard(id).registerRunListener(fn);
    const act = (id, fn) => this.homey.flow.getActionCard(id).registerRunListener(fn);
    const trig = (id, fn) => this.homey.flow.getDeviceTriggerCard(id).registerRunListener(fn);

    // Triggers met een eigen getal: alleen afgaan bij het gekozen aantal
    trig('slot_starts_in', ({ minutes }, state) => Number(minutes) === state.minutes);
    trig('menu_closes_in', ({ hours }, state) => Number(hours) === state.hours);

    // Voorwaarden
    cond('is_delivery_day', ({ device }) => device.isDeliveryDay());
    cond('is_week_skipped', ({ device, which }) => device.isWeekSkipped(which));
    cond('within_slot', ({ device }) => device.isWithinSlot());
    cond('delivery_within', ({ device, days }) => device.deliveryWithin(Number(days)));
    cond('box_outside', ({ device }) => device.isBoxOutside());
    cond('delivered_today', ({ device }) => device.isDeliveredToday());

    // Acties
    act('refresh', ({ device }) => device.poll(true));
    act('set_status', ({ device, status }) => device.setLiveState(status, 'flow'));
    act('box_inside', ({ device }) => device.boxInside());
    act('recipes_text', ({ device, which }) => device.recipesText(which));
    act('pantry_to_bring', ({ device, which }) => device.pantryToBring(which, 'flow'));

    this.log('FreshBox-driver gestart');
  }

  /** Gedeeld door koppelen en herstellen: inloggen met de link uit de mail */
  _loginHandlers(session, onDone) {
    let api = null;
    let pending = null;

    session.setHandler('start_login', async ({ email, country }) => {
      const mail = String(email || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw new Error(this.homey.__('pair.bad_email'));
      api = new HelloFreshApi({ country, log: this.log.bind(this) });
      const publicId = await api.startLogin(mail);
      pending = { email: mail, publicId, country: api.country };
      return true;
    });

    session.setHandler('finish_login', async ({ link }) => {
      if (!api || !pending) throw new Error(this.homey.__('pair.start_first'));
      const tokens = await api.finishLogin(link, pending);
      let info = {};
      try { info = await api.getCustomerInfo() || {}; } catch (err) { this.error('Klantgegevens ophalen mislukt', err.message); }
      return onDone({ tokens, info, pending });
    });
  }

  async onPair(session) {
    let found = null;

    this._loginHandlers(session, async ({ tokens, info, pending }) => {
      const id = String(info.uuid || info.id || pending.email).toLowerCase();
      found = {
        name: 'HelloFresh',
        data: { id },
        store: {
          country: pending.country,
          email: pending.email,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        },
      };
      return 'pair';
    });

    session.setHandler('list_devices', async () => {
      if (!found) throw new Error(this.homey.__('pair.start_first'));
      return [found];
    });
  }

  async onRepair(session, device) {
    this._loginHandlers(session, async ({ tokens, pending }) => {
      await device.updateLogin({ ...tokens, country: pending.country, email: pending.email });
      return 'repair';
    });
  }

}

module.exports = FreshBoxDriver;
