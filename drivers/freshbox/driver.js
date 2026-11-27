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

    // Inloggen met e-mailadres en wachtwoord
    session.setHandler('password_login', async ({ email, password, country }) => {
      const mail = String(email || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw new Error(this.homey.__('pair.bad_email'));
      if (!password) throw new Error(this.homey.__('pair.no_password'));
      const pwApi = new HelloFreshApi({ country, log: this.log.bind(this) });
      const tokens = await pwApi.loginPassword(mail, password);
      let info = {};
      try { info = await pwApi.getCustomerInfo() || {}; } catch (err) { this.error('Klantgegevens ophalen mislukt', err.message); }
      return onDone({ tokens, info, pending: { email: mail, country: pwApi.country, password } });
    });

    // Inloggen met de code van de HelloFresh-website (als inloggen vanaf Homey geblokkeerd wordt)
    session.setHandler('token_login', async ({ code, country }) => {
      const tokenApi = new HelloFreshApi({ country, log: this.log.bind(this) });
      const tokens = tokenApi.useWebsiteCode(code);
      let info = {};
      try {
        info = await tokenApi.getCustomerInfo() || {};
      } catch (err) {
        if (err.auth) throw new Error('HelloFresh accepteert deze code niet (meer). Log opnieuw in op de website en kopieer een nieuwe code.');
        this.error('Klantgegevens ophalen mislukt', err.message);
      }
      const email = info.email || info.username || '';
      return onDone({ tokens: { accessToken: tokenApi.accessToken, refreshToken: tokenApi.refreshToken || tokens.refreshToken }, info, pending: { email, country: tokenApi.country } });
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
      const id = String(info.uuid || info.id || pending.email || Date.now()).toLowerCase();
      found = {
        name: 'HelloFresh',
        data: { id },
        store: {
          country: pending.country,
          email: pending.email,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          password: pending.password || null,
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
      await device.updateLogin({ ...tokens, country: pending.country, email: pending.email, password: pending.password || null });
      return 'repair';
    });
  }

}

module.exports = FreshBoxDriver;
