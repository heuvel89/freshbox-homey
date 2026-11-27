'use strict';

/**
 * Client voor de (onofficiële) gateway van HelloFresh.
 *
 * Gebaseerd op hoe de Python-bibliotheek pantherale0/pyhellofresh (MIT-licentie)
 * met hellofresh.co.uk praat, aangepast voor Nederland en België.
 * Dit is geen officiële API van HelloFresh en kan zonder aankondiging veranderen.
 */

const COUNTRIES = {
  NL: { base: 'https://www.hellofresh.nl', locale: 'nl-NL' },
  BE: { base: 'https://www.hellofresh.be', locale: 'nl-BE' },
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BRAND = 'BRAND_HELLOFRESH';
const TIMEOUT = 15000;

// Gasttoken uit pyhellofresh; wordt vervangen door een vers token van de inlogpagina zodra dat nodig is
const DEFAULT_GUEST_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.'
  + 'eyJleHAiOjE3ODc5NjE3NjUsImlhdCI6MTc4NTMzMjAyMiwiaXNzIjoic2VuZiIsImp0aSI6IjBmNDRhYmYwLWJmMjctNDc0Ni04MzI1LWZmNGMyNDcwODRjNSJ9.'
  + 'ojqzKBZ4RSnLsUEHIyyJfuSZvko11JUaNOHehvx3XsI';

class HelloFreshError extends Error {
  constructor(message, { status, auth = false } = {}) {
    super(message);
    this.name = auth ? 'AuthError' : 'HelloFreshError';
    this.status = status;
    this.auth = auth;
  }
}

class HelloFreshApi {

  /**
   * @param {object} opts
   * @param {'NL'|'BE'} [opts.country]
   * @param {string} [opts.accessToken]
   * @param {string} [opts.refreshToken]
   * @param {function} [opts.onTokens] wordt aangeroepen met {accessToken, refreshToken} als ze veranderen
   * @param {function} [opts.log]
   */
  constructor({ country = 'NL', accessToken = null, refreshToken = null, email = null, password = null, onTokens, log } = {}) {
    this.country = COUNTRIES[country] ? country : 'NL';
    this.base = COUNTRIES[this.country].base;
    this.locale = COUNTRIES[this.country].locale;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.email = email;
    this.password = password;
    this.guestToken = DEFAULT_GUEST_TOKEN;
    this.onTokens = onTokens || (() => {});
    this.log = log || (() => {});
    this._refreshing = null;
  }

  /* ---------- HTTP ---------- */

  async _fetch(url, options = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      return await fetch(url, { ...options, signal: ctrl.signal });
    } catch (err) {
      throw new HelloFreshError(err.name === 'AbortError' ? 'HelloFresh reageert niet (time-out)' : `Geen verbinding met HelloFresh: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async _send(method, path, { params, json, token }) {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json', Origin: this.base, Referer: `${this.base}/` };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    const res = await this._fetch(url, { method, headers, body: json !== undefined ? JSON.stringify(json) : undefined });
    const text = await res.text();
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* geen JSON */ }
    return { status: res.status, data, text };
  }

  async _request(method, path, { params, json, auth = true } = {}) {
    if (auth && !this.accessToken) throw new HelloFreshError('Niet ingelogd bij HelloFresh', { auth: true });
    const token = auth ? this.accessToken : (this.accessToken || this.guestToken);
    let res = await this._send(method, path, { params, json, token });

    // Gasttoken verlopen: vers token halen en één keer opnieuw
    if (res.status === 401 && !auth && !this.accessToken) {
      await this.fetchGuestToken().catch(() => {});
      res = await this._send(method, path, { params, json, token: this.guestToken });
    }

    // Toegangstoken verlopen: verversen en één keer opnieuw
    if ((res.status === 401 || res.status === 403) && auth && (this.refreshToken || this.password)) {
      await this.refresh();
      res = await this._send(method, path, { params, json, token: this.accessToken });
    }

    if (res.status === 401 || res.status === 403) {
      throw new HelloFreshError(`HelloFresh weigert toegang (${res.status}). Log opnieuw in.`, { status: res.status, auth: true });
    }
    if (res.status >= 400) {
      const msg = res.data && typeof res.data === 'object'
        ? (res.data.error_description || res.data.message || res.data.error || res.text) : res.text;
      const lower = String(msg || '').toLowerCase();
      const isAuth = ['invalid_grant', 'invalid_token', 'expired', 'refresh token'].some((k) => lower.includes(k));
      throw new HelloFreshError(`HelloFresh gaf fout ${res.status}: ${String(msg).slice(0, 200)}`, { status: res.status, auth: isAuth });
    }
    return res.data;
  }

  /** Vers gasttoken uit de inlogpagina (staat in __NEXT_DATA__) */
  async fetchGuestToken() {
    const res = await this._fetch(`${this.base}/login`, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
    const html = await res.text();
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
    if (m) {
      try {
        const data = JSON.parse(m[1]);
        const token = data && data.props && data.props.pageProps && data.props.pageProps.ssrPayload
          && data.props.pageProps.ssrPayload.serverAuth && data.props.pageProps.ssrPayload.serverAuth.access_token;
        if (typeof token === 'string' && token) {
          this.guestToken = token;
          return token;
        }
      } catch (e) { /* valt hieronder door */ }
    }
    throw new HelloFreshError('Kon geen gasttoken van HelloFresh halen');
  }

  _setTokens(data) {
    if (!data || typeof data !== 'object' || !data.access_token) {
      throw new HelloFreshError('HelloFresh gaf geen inlogtoken terug', { auth: true });
    }
    this.accessToken = data.access_token;
    if (data.refresh_token) this.refreshToken = data.refresh_token;
    this.onTokens({ accessToken: this.accessToken, refreshToken: this.refreshToken });
  }

  /* ---------- Inloggen met e-maillink ---------- */

  /** Vraagt HelloFresh een inloglink te mailen. Geeft de public_id terug. */
  async startLogin(email) {
    const publicId = (globalThis.crypto && globalThis.crypto.randomUUID)
      ? globalThis.crypto.randomUUID() : require('crypto').randomUUID();
    await this._request('POST', '/gw/v1/passwordless/start', {
      auth: false,
      params: { country: this.country, locale: this.locale },
      json: {
        email,
        channel: 'email',
        send: 'link',
        redirect_url: `${this.base}/my-account/deliveries/menu`,
        public_id: publicId,
      },
    });
    return publicId;
  }

  /** Haalt code, e-mail en public_id uit een (eventueel omgeleide) inloglink */
  async _parseLink(link) {
    const read = (u) => {
      try {
        const url = new URL(u);
        const q = url.searchParams;
        return { code: q.get('code'), email: q.get('email'), publicId: q.get('public_id'), redirect: q.get('redirect_url') };
      } catch (e) {
        return {};
      }
    };
    let found = read(link);
    // Trackinglink (zoals click.link.hellofresh.nl): volg de omleidingen tot de echte link
    let url = link;
    for (let i = 0; i < 5 && !(found.code && found.email) && /^https?:\/\//.test(url); i++) {
      const res = await this._fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'manual' });
      const location = res.headers.get('location');
      if (!location) break;
      url = new URL(location, url).toString();
      const next = read(url);
      found = { ...found, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v)) };
    }
    return found;
  }

  /**
   * Rondt het inloggen af met de link uit de mail.
   * @param {string} link de volledige link (of alleen de code)
   * @param {{email:string, publicId:string}} pending gegevens van startLogin
   */
  async finishLogin(link, { email, publicId }) {
    const text = String(link || '').trim();
    let parts = {};
    if (/^https?:\/\//i.test(text)) parts = await this._parseLink(text);
    else if (text) parts = { code: text };
    const code = parts.code;
    if (!code) throw new HelloFreshError('In deze link staat geen inlogcode. Kopieer de knop "Inloggen" uit de mail van HelloFresh.');
    const data = await this._request('GET', '/gw/v1/passwordless/magic-link/finish', {
      auth: false,
      params: {
        channel: 'email',
        code,
        country: this.country.toLowerCase(),
        email: parts.email || email,
        public_id: parts.publicId || publicId,
        redirect_url: parts.redirect || `${this.base}/my-account/deliveries/menu`,
      },
    });
    this._setTokens(data);
    return { accessToken: this.accessToken, refreshToken: this.refreshToken };
  }

  /** Leest een antwoord van inloggen of verversen, met duidelijke foutmeldingen */
  async _authResponse(res, wrongMessage) {
    const type = res.headers.get('content-type') || '';
    const text = await res.text();
    if (res.status >= 400 && (type.includes('text/html') || /cloudflare|just a moment|<html/i.test(text.slice(0, 400)))) {
      throw new HelloFreshError('HelloFresh blokkeerde de aanvraag met een beveiliging. Dit is geen fout wachtwoord. Probeer het over een paar minuten opnieuw.', { status: res.status });
    }
    if (res.status === 429) throw new HelloFreshError('Te vaak geprobeerd. Wacht even en probeer het opnieuw.', { status: 429 });
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* geen JSON */ }
    if (res.status >= 400) {
      const hint = data && typeof data === 'object' ? [data.error, data.error_description, data.message].filter(Boolean).join(' ') : '';
      if (/google|apple|facebook|social/i.test(hint)) {
        throw new HelloFreshError('Dit account logt in met Google, Apple of Facebook. Stel eerst een wachtwoord in via "Wachtwoord vergeten" op de website van HelloFresh.', { status: res.status, auth: true });
      }
      throw new HelloFreshError(wrongMessage, { status: res.status, auth: true });
    }
    return data;
  }

  _authHeaders(contentType) {
    return {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': contentType,
      Origin: this.base,
      Referer: `${this.base}/login`,
      'User-Agent': USER_AGENT,
    };
  }

  /** Inloggen met e-mailadres en wachtwoord (zoals op de website) */
  async loginPassword(email, password) {
    const url = new URL(`${this.base}/gw/login`);
    url.searchParams.set('country', this.country);
    url.searchParams.set('locale', this.locale);
    const res = await this._fetch(url, {
      method: 'POST',
      headers: this._authHeaders('application/json'),
      body: JSON.stringify({ username: String(email).trim(), password }),
    });
    const data = await this._authResponse(res, 'E-mailadres of wachtwoord klopt niet.');
    this.email = String(email).trim();
    this.password = password;
    this._setTokens(data);
    return { accessToken: this.accessToken, refreshToken: this.refreshToken };
  }

  async refresh() {
    if (!this._refreshing) {
      this._refreshing = (async () => {
        if (this.refreshToken) {
          try {
            const url = new URL(`${this.base}/gw/refresh`);
            url.searchParams.set('country', this.country);
            url.searchParams.set('locale', this.locale);
            // Zoals de website: JSON als platte tekst, zonder Authorization-header
            const res = await this._fetch(url, {
              method: 'POST',
              headers: this._authHeaders('text/plain;charset=UTF-8'),
              body: JSON.stringify({ refresh_token: this.refreshToken }),
            });
            const data = await this._authResponse(res, 'Inlog verlopen.');
            this._setTokens(data);
            this.log('HelloFresh-token ververst');
            return;
          } catch (err) {
            if (!err.auth || !this.password) throw err;
            this.log('Verversen geweigerd, opnieuw inloggen met wachtwoord');
          }
        }
        if (this.email && this.password) {
          await this.loginPassword(this.email, this.password);
          return;
        }
        throw new HelloFreshError('Inlog verlopen. Herstel het apparaat en log opnieuw in.', { auth: true });
      })().finally(() => { this._refreshing = null; });
    }
    return this._refreshing;
  }

  /* ---------- Gegevens ---------- */

  async getCustomerInfo() {
    return this._request('GET', '/gw/api/customers/me/info', { params: { country: this.country, locale: this.locale } });
  }

  async getProfile() {
    return this._request('GET', '/gw/profile-service/v2/customers/me/profile', { params: { brand: BRAND, regionCode: this.country } });
  }

  /** Bezorgschema; rangeStart/rangeEnd zijn ISO-weken zoals '2026-W49' */
  async getDeliveries(rangeStart, rangeEnd) {
    return this._request('GET', '/gw/api/customers/me/deliveries', {
      params: { country: this.country, locale: this.locale, rangeStart, rangeEnd },
    });
  }

  async getMenu(week, { subscription, sku } = {}) {
    return this._request('GET', '/gw/my-deliveries/menu', {
      params: { week, country: this.country.toLowerCase(), locale: this.locale, 'product-sku': sku, subscription },
    });
  }

  async getRecipe(id) {
    return this._request('GET', `/gw/recipes/recipes/${encodeURIComponent(id)}`, { params: { country: this.country, locale: this.locale } });
  }

}

module.exports = { HelloFreshApi, HelloFreshError, COUNTRIES };
