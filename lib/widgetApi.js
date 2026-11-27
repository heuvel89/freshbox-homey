'use strict';

/** Gedeelde widget-API: alle widgets halen dezelfde gegevens op */
function box(homey, id) {
  const device = homey.app.getBox(id);
  if (!device) throw new Error('Nog geen HelloFresh-account gekoppeld');
  return device;
}

module.exports = {
  async getData({ homey, query }) {
    const device = homey.app.getBox(query && query.id);
    if (!device) return null;
    return device.getWidgetData();
  },

  async action({ homey, body }) {
    const device = box(homey, body && body.id);
    switch (body && body.action) {
      case 'refresh': return device.poll(true);
      case 'inside': return device.boxInside();
      case 'on_the_way': return device.setLiveState('on_the_way', 'widget');
      case 'delivered': return device.setLiveState('delivered', 'widget');
      case 'bring': return device.pantryToBring(body.which || 'box', 'widget');
      default: throw new Error('Onbekende actie');
    }
  },
};
