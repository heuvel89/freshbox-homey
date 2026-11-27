'use strict';

// Wordt gebruikt door de instellingenpagina van de app
module.exports = {
  async diagnose({ homey }) {
    return homey.app.apiDiagnose();
  },
};
