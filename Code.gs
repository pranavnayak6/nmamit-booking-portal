/**
 * NMAMIT Booking Portal - Google Sheets backend (Google Apps Script)
 * The Google Sheet is the database. Tabs: Venues, Bookings.
 * Admin password hashes and sign-in tokens are kept in Script Properties / Cache, never in the sheet.
 */

// 1) Set the two admin passwords, run setup() ONCE, then replace the passwords here with '' (or delete this block).
const ADMINS = { admin1: 'ChangeMe-1', admin2: 'ChangeMe-2' };
// 2) true = demo mode: the sign-in code is shown on the login page and no email is sent.
const SHOW_CODE_ON_SCREEN = false;

const EMAIL_OK = /^[^\s@]+@(nmamit\.in|nitte\.in)$/i, TIME_OK = /^([01]\d|2[0-3]):[0-5]\d$/, DAY_OK = /^\d{4}-\d{2}-\d{2}$/;
const VH = ['id', 'name', 'capacity', 'location', 'facilities', 'color', 'open'];
const BH = ['id', 'title', 'venue', 'date', 'start', 'end', 'requestedBy', 'status', 'reason', 'purpose', 'attendees', 'seen', 'decidedBy', 'created'];

/** Run this once from the editor: creates the sheets, adds the venues and stores the admin passwords safely. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [['Venues', VH], ['Bookings', BH]].forEach(function (x) {
    const sh = ss.getSheetByName(x[0]) || ss.insertSheet(x[0]);
    sh.getRange('A:Z').setNumberFormat('@');                       // keep dates and times as plain text
    sh.getRange(1, 1, 1, x[1].length).setValues([x[1]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  const vs = ss.getSheetByName('Venues');
  if (vs.getDataRange().getDisplayValues().length < 2) {
    [['sam', 'Sambhram', '#1F4E8C'], ['shm', 'Shambhavi', '#B85C00'], ['sad', 'Sadananda', '#7C5BC2'], ['amp', 'Amphitheatre', '#1B7A4B'],
     ['pha', 'Phalguni', '#C23B65'], ['abh', 'Abhyuday Hall', '#0E7C86'], ['con', 'Conference Room', '#8A6D00'], ['vis', 'Vista Lab', '#5A6478']]
      .forEach(function (v) { vs.appendRow([v[0], v[1], '', '', '', v[2], 'yes']); });
  }
  const p = props();
  if (!p.getProperty('salt')) p.setProperty('salt', Utilities.getUuid());
  Object.keys(ADMINS).forEach(function (u) { if (ADMINS[u]) p.setProperty('admin_' + u, H(ADMINS[u] + p.getProperty('salt') + u)); });
  return 'Setup done. Now deploy as a web app.';
}

// ---------- web app entry points ----------
function doPost(e) {
  let out;
  try { out = route(JSON.parse(e.postData.contents)); }
  catch (err) { out = { error: err.status ? err.message : 'Something went wrong. Please try again.', status: err.status || 500 }; if (!err.status) console.error(err); }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() { return ContentService.createTextOutput('NMAMIT Bookings API is running.'); }

function route(r) {
  const open = { requestOtp: requestOtp, verify: verify, adminLogin: adminLogin };
  if (open[r.action]) return open[r.action](r);
  const me = auth(r.token);
  const acts = { me: function () { return me; }, all: all, addBooking: addBooking, decide: decide, cancel: cancel, seen: seen, saveVenue: saveVenue, deleteVenue: deleteVenue };
  if (!acts[r.action]) fail('Unknown action.', 404);
  if (['all', 'me'].indexOf(r.action) > -1) return acts[r.action](r, me);
  const lock = LockService.getScriptLock(); lock.waitLock(15000);   // one writer at a time, so two people cannot clash
  try { return acts[r.action](r, me); } finally { lock.releaseLock(); }
}

// ---------- helpers ----------
const cache = function () { return CacheService.getScriptCache(); }, props = function () { return PropertiesService.getScriptProperties(); };
function H(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
function clean(s, n) { return String(s == null ? '' : s).replace(/[<>]/g, '').trim().slice(0, n); }
function fail(m, s) { const e = new Error(m); e.status = s || 400; throw e; }
function sheet(n) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n); }
function rows(n) {
  const v = sheet(n).getDataRange().getDisplayValues(), h = v.shift();
  return v.map(function (r, i) { const o = { _row: i + 2 }; h.forEach(function (k, j) { o[k] = r[j]; }); return o; }).filter(function (o) { return o.id; });
}
function setCell(n, row, col, val) { sheet(n).getRange(row, BH.indexOf(col) + 1).setValue(val); }
function issue(a) { const t = Utilities.getUuid() + Utilities.getUuid(); cache().put('t_' + t, JSON.stringify(a), 21600); return t; }
function auth(t) { const a = t && cache().get('t_' + t); if (!a) fail('Please sign in again.', 401); return JSON.parse(a); }
function adminOnly(me) { if (me.role !== 'admin') fail('Admins only.', 403); }
function clashWith(v, d, s, e, skip) {
  return rows('Bookings').filter(function (o) { return o.status === 'ok' && o.venue === v && o.date === d && o.id !== skip && s < o.end && e > o.start; })[0];
}
function V(o) { return { id: o.id, n: o.name, cap: o.capacity, loc: o.location, fac: o.facilities, c: o.color, on: o.open !== 'no' }; }
function Bk(o, me) {
  const mine = me.role === 'user' && o.requestedBy === me.email, adm = me.role === 'admin';
  return { id: o.id, t: o.title, v: o.venue, d: o.date, s: o.start, e: o.end, st: o.status, by: (mine || adm) ? o.requestedBy : '',
    reason: (mine || adm) ? o.reason : '', p: adm ? o.purpose : '', n: adm ? o.attendees : '', seen: o.seen === '1' };
}

// ---------- sign-in ----------
function requestOtp(r) {
  const email = clean(r.email, 120).toLowerCase();
  if (!EMAIL_OK.test(email)) fail('Only @nmamit.in and @nitte.in addresses can sign in.');
  if (cache().get('rl_' + email)) fail('Please wait a minute before asking for another code.', 429);
  const code = String(parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 8), 16) % 900000 + 100000);
  cache().put('otp_' + email, H(code + email), 600); cache().put('tries_' + email, '0', 600); cache().put('rl_' + email, '1', 60);
  if (SHOW_CODE_ON_SCREEN) return { ok: true, devCode: code };
  MailApp.sendEmail(email, 'Your NMAMIT Bookings sign-in code', 'Your sign-in code is ' + code + '. It works for 10 minutes. If you did not ask for it, ignore this email.');
  return { ok: true };
}
function verify(r) {
  const email = clean(r.email, 120).toLowerCase(), want = cache().get('otp_' + email), tries = +cache().get('tries_' + email) || 0;
  if (!want || tries >= 5) fail('Code expired. Ask for a new one.');
  if (want !== H(clean(r.code, 6) + email)) { cache().put('tries_' + email, String(tries + 1), 600); fail('That code is not right.'); }
  cache().remove('otp_' + email);
  return { token: issue({ role: 'user', email: email }), email: email };
}
function adminLogin(r) {
  const u = clean(r.username, 40).toLowerCase(), k = 'adm_' + u, tries = +cache().get(k) || 0;
  if (tries >= 5) fail('Too many attempts. Try again in a few minutes.', 429);
  const stored = props().getProperty('admin_' + u);
  if (!stored || stored !== H(String(r.password || '') + props().getProperty('salt') + u)) { cache().put(k, String(tries + 1), 300); fail('Wrong username or password.', 401); }
  return { token: issue({ role: 'admin', username: u }), username: u };
}

// ---------- data ----------
function all(r, me) {
  const b = rows('Bookings').filter(function (o) { return me.role === 'admin' || o.status !== 'blocked' || o.requestedBy === me.email; })
    .sort(function (x, y) { return (x.date + x.start) < (y.date + y.start) ? -1 : 1; }).map(function (o) { return Bk(o, me); });
  return { venues: rows('Venues').map(V), bookings: b };
}
function addBooking(r, me) {
  const title = clean(r.t, 80), v = rows('Venues').filter(function (x) { return x.id === r.v; })[0];
  if (!title) fail('Please add a title.');
  if (!v || v.open === 'no') fail('That venue is not open for booking.');
  if (!DAY_OK.test(r.d) || !TIME_OK.test(r.s) || !TIME_OK.test(r.e)) fail('Check the date and times.');
  if (r.e <= r.s) fail('End time must be after start time.');
  const c = clashWith(r.v, r.d, r.s, r.e);
  if (c) fail('Time clash with "' + c.title + '" (' + c.start + '-' + c.end + ').', 409);
  const adm = me.role === 'admin', id = 'b' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  sheet('Bookings').appendRow([id, title, r.v, r.d, r.s, r.e, adm ? me.username + ' (admin)' : me.email, adm ? 'ok' : 'pending', '', clean(r.p, 300), clean(r.n, 6), '0', adm ? me.username : '', new Date().toISOString()]);
  return { id: id, st: adm ? 'ok' : 'pending' };
}
function decide(r, me) {                                              // admin: accept or block
  adminOnly(me);
  const b = rows('Bookings').filter(function (o) { return o.id === r.id; })[0];
  if (!b) fail('Booking not found.', 404);
  if (['ok', 'blocked'].indexOf(r.st) < 0) fail('Status must be ok or blocked.');
  if (r.st === 'ok') { const c = clashWith(b.venue, b.date, b.start, b.end, b.id); if (c) fail('Clashes with confirmed "' + c.title + '".', 409); }
  setCell('Bookings', b._row, 'status', r.st); setCell('Bookings', b._row, 'reason', r.st === 'blocked' ? clean(r.reason, 200) : '');
  setCell('Bookings', b._row, 'decidedBy', me.username); setCell('Bookings', b._row, 'seen', '0');
  return { ok: true };
}
function cancel(r, me) {
  const b = rows('Bookings').filter(function (o) { return o.id === r.id; })[0];
  if (!b) fail('Booking not found.', 404);
  if (me.role === 'user' && b.requestedBy !== me.email) fail('You can only cancel your own bookings.', 403);
  sheet('Bookings').deleteRow(b._row); return { ok: true };
}
function seen(r, me) {
  if (me.role === 'user') rows('Bookings').forEach(function (o) { if (o.requestedBy === me.email && o.status !== 'pending' && o.seen !== '1') setCell('Bookings', o._row, 'seen', '1'); });
  return { ok: true };
}
function saveVenue(r, me) {
  adminOnly(me);
  const name = clean(r.n, 40); if (!name) fail('Venue name is required.');
  const vals = [name, clean(r.cap, 6), clean(r.loc, 60), clean(r.fac, 120), /^#[0-9a-f]{6}$/i.test(r.c) ? r.c : '#1F4E8C', r.on ? 'yes' : 'no'];
  if (r.id) {
    const v = rows('Venues').filter(function (o) { return o.id === r.id; })[0];
    if (!v) fail('Venue not found.', 404);
    sheet('Venues').getRange(v._row, 2, 1, 6).setValues([vals]); return { ok: true };
  }
  sheet('Venues').appendRow(['v' + Utilities.getUuid().replace(/-/g, '').slice(0, 6)].concat(vals)); return { ok: true };
}
function deleteVenue(r, me) {
  adminOnly(me);
  const vs = rows('Venues'), v = vs.filter(function (o) { return o.id === r.id; })[0];
  if (!v) fail('Venue not found.', 404);
  if (vs.length <= 1) fail('Keep at least one venue.');
  rows('Bookings').filter(function (o) { return o.venue === v.id; }).map(function (o) { return o._row; }).sort(function (a, b) { return b - a; })
    .forEach(function (n) { sheet('Bookings').deleteRow(n); });         // its bookings go with it
  sheet('Venues').deleteRow(v._row); return { ok: true };
}
