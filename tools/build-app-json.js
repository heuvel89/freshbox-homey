'use strict';

// Bouwt app.json uit .homeycompose, drivers en widgets (zoals "homey app build" doet).
// De GitHub-actie doet dit ook zelf; dit script is er voor wie geen Homey CLI heeft.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const app = read('.homeycompose/app.json');

app.capabilities = {};
for (const f of fs.readdirSync(path.join(root, '.homeycompose/capabilities')).sort()) {
  app.capabilities[f.replace(/\.json$/, '')] = read(`.homeycompose/capabilities/${f}`);
}

app.flow = { triggers: [], conditions: [], actions: [] };
app.drivers = [];
for (const id of fs.readdirSync(path.join(root, 'drivers')).sort()) {
  const driver = JSON.parse(JSON.stringify(read(`drivers/${id}/driver.compose.json`)).replace(/\{\{driverAssetsPath\}\}/g, `/drivers/${id}/assets`));
  app.drivers.push({ id, ...driver });
  const flowFile = `drivers/${id}/driver.flow.compose.json`;
  if (fs.existsSync(path.join(root, flowFile))) {
    const flow = read(flowFile);
    for (const kind of ['triggers', 'conditions', 'actions']) {
      for (const card of flow[kind] || []) {
        app.flow[kind].push({ ...card, args: [{ type: 'device', name: 'device', filter: `driver_id=${id}` }, ...(card.args || [])] });
      }
    }
  }
}

app.widgets = {};
for (const id of fs.readdirSync(path.join(root, 'widgets')).sort()) {
  app.widgets[id] = { ...read(`widgets/${id}/widget.compose.json`), id };
}

fs.writeFileSync(path.join(root, 'app.json'), `${JSON.stringify(app, null, 2)}\n`);
console.log(`app.json: ${app.drivers.length} driver, ${Object.keys(app.widgets).length} widgets, `
  + `${app.flow.triggers.length}/${app.flow.conditions.length}/${app.flow.actions.length} flowkaarten`);
