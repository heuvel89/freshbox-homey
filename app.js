'use strict';

const Homey = require('homey');

const BRING_APP = 'nl.homeyapps.bringlist';
const WIDGETS = ['this_week', 'next_week', 'delivery_live', 'countdown', 'menu_deadline', 'box_outside', 'pantry', 'weeks', 'statusbar'];

class FreshBoxApp extends Homey.App {

  async onInit() {
    for (const id of WIDGETS) {
      try {
        this.homey.dashboards.getWidget(id)
          .registerSettingAutocompleteListener('device', async (query) => this.getBoxes()
            .filter((d) => d.getName().toLowerCase().includes((query || '').toLowerCase()))
            .map((d) => ({ name: d.getName(), description: d.getStoreValue('email') || 'HelloFresh', id: d.getData().id })));
      } catch (err) {
        this.error(`Widget ${id} niet gevonden`, err.message);
      }
    }

    // De Bring!-app op deze Homey gebruiken voor "zelf in huis"
    this.bring = this.homey.api.getApiApp(BRING_APP);
    this.bringInstalled = null;
    this.bring.on('install', () => { this.bringInstalled = true; });
    this.bring.on('uninstall', () => { this.bringInstalled = false; });
    this.bring.getInstalled().then((v) => { this.bringInstalled = v; }).catch(() => { this.bringInstalled = false; });

    this.log('FreshBox gestart');
  }

  getBoxes() {
    return Object.values(this.homey.drivers.getDrivers()).flatMap((driver) => driver.getDevices());
  }

  getBox(id) {
    const boxes = this.getBoxes();
    if (!boxes.length) return null;
    return boxes.find((d) => d.getData().id === id) || boxes[0];
  }

  /**
   * Zet producten op de Bring!-lijst via de Bring!-app.
   * Slaat over wat er al op staat. Geeft de toegevoegde namen terug.
   */
  async addToBring(items, spec = 'HelloFresh') {
    const installed = await this.bring.getInstalled().catch(() => false);
    this.bringInstalled = installed;
    if (!installed) throw new Error(this.homey.__('bring.not_installed'));
    let current = [];
    try {
      const list = await this.bring.get('/items');
      current = ((list && list.purchase) || []).map((i) => String(i.name || '').toLowerCase());
    } catch (err) {
      throw new Error(`${this.homey.__('bring.failed')}: ${err.message}`);
    }
    const added = [];
    for (const item of items) {
      if (current.includes(item.toLowerCase())) continue;
      await this.bring.post('/action', { action: 'add', item, spec });
      current.push(item.toLowerCase());
      added.push(item);
    }
    return added;
  }

  async apiDiagnose() {
    const box = this.getBox();
    if (!box) return { error: 'Nog geen HelloFresh-account gekoppeld' };
    return box.diagnose();
  }

}

module.exports = FreshBoxApp;
