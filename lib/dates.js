'use strict';

/** Datum- en weekhulpjes die rekening houden met de tijdzone van de Homey */

const DAY = 86400000;
const DAYS_SHORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const DAYS_LONG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** 'YYYY-MM-DD' in de tijdzone */
function localDate(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
}

/** 'HH:MM' in de tijdzone */
function localTime(date, tz) {
  return new Intl.DateTimeFormat('nl-NL', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

/** Minuten sinds middernacht in de tijdzone */
function localMinutes(date, tz) {
  const [h, m] = localTime(date, tz).split(':').map(Number);
  return h * 60 + m;
}

/** Datum uit de API lezen, ook met '+0100' zonder dubbele punt */
function parseApiDate(value) {
  if (!value || typeof value !== 'string') return null;
  let text = value.trim();
  if (/[+-]\d{4}$/.test(text)) text = `${text.slice(0, -2)}:${text.slice(-2)}`;
  const t = Date.parse(text);
  return Number.isNaN(t) ? null : new Date(t);
}

/** Kalenderdag 'YYYY-MM-DD' -> Date op 12:00 UTC (veilig rekenen met dagen) */
function ymdToUtcNoon(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** Aantal kalenderdagen van a naar b ('YYYY-MM-DD') */
function daysBetween(a, b) {
  return Math.round((ymdToUtcNoon(b) - ymdToUtcNoon(a)) / DAY);
}

/** ISO-week van een 'YYYY-MM-DD'-datum, als '2026-W49' */
function isoWeekOf(ymd) {
  const date = ymdToUtcNoon(ymd);
  const dow = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dow + 3);
  const isoYear = date.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4, 12));
  const week = 1 + Math.round((date - jan4) / DAY / 7 + ((jan4.getUTCDay() + 6) % 7 - 3) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** Maandag (als 'YYYY-MM-DD') van een ISO-week */
function mondayOfWeek(week) {
  const m = /^(\d{4})-W(\d{2})$/.exec(week || '');
  if (!m) return null;
  const year = Number(m[1]);
  const jan4 = new Date(Date.UTC(year, 0, 4, 12));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY + (Number(m[2]) - 1) * 7 * DAY);
  return monday.toISOString().slice(0, 10);
}

function shiftWeek(week, offset) {
  const monday = mondayOfWeek(week);
  if (!monday) return week;
  return isoWeekOf(new Date(ymdToUtcNoon(monday).getTime() + offset * 7 * DAY).toISOString().slice(0, 10));
}

function weekNumber(week) {
  const m = /-W(\d{2})$/.exec(week || '');
  return m ? Number(m[1]) : null;
}

/** 'di 1 dec' */
function shortLabel(ymd) {
  if (!ymd) return '';
  const d = ymdToUtcNoon(ymd);
  return `${DAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

/** 'dinsdag 1 december' */
function longLabel(ymd) {
  if (!ymd) return '';
  const d = ymdToUtcNoon(ymd);
  return `${DAYS_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function weekdayLong(ymd) {
  return ymd ? DAYS_LONG[ymdToUtcNoon(ymd).getUTCDay()] : '';
}

/** 'PT25M' / 'PT1H5M' -> minuten */
function isoDurationMinutes(value) {
  if (typeof value === 'number') return value;
  const m = /^P(?:T)?(?:(\d+)H)?(?:(\d+)M)?/i.exec(value || '');
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] || 0) * 60 + Number(m[2] || 0);
}

module.exports = {
  DAY, localDate, localTime, localMinutes, parseApiDate, daysBetween, isoWeekOf, mondayOfWeek,
  shiftWeek, weekNumber, shortLabel, longLabel, weekdayLong, isoDurationMinutes,
};
