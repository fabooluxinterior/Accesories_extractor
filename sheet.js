// Read-only live mirror of the database Google Sheet ("masterdata" tab), running in the browser.
// - Reads the tab with the Google Sheets API (read-only key); never writes to the sheet.
// - Keeps the parsed catalog in memory and in this browser's localStorage (instant start next visit).
// - Re-checks every SYNC_MS, when the tab becomes visible again, when the browser comes online, and on demand.
(function () {
  const S = globalThis.FB_SETTINGS || {};
  const EX = () => globalThis.FB_extractor || require('./extractor');
  const LS_KEY = 'fb_acc_cache_v1';
  const TAB = 'masterdata';
  const SYNC_MS = S.SYNC_MS || 60000;
  const MIN_GAP = 2000;

  const state = { db: null, sig: '', lastCheck: 0, lastChange: 0, error: '', cached: false };
  const subs = [];
  let inflight = null;
  let timer = null;

  const configured = () => !!(S.SHEET_ID && S.API_KEY);

  function emit(changed) {
    const s = status();
    subs.forEach(f => { try { f(s, changed); } catch (e) { /* ignore UI errors */ } });
  }

  function lsGet() { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; } }
  function lsSet(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch (e) { /* storage full/blocked: fine */ } }

  const buildDb = rows => ({ catalog: EX().prepCatalog(rows) });

  async function fetchRows() {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${S.SHEET_ID}/values/${encodeURIComponent(TAB)}?key=${encodeURIComponent(S.API_KEY)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) return (await res.json()).values || [];
    let detail = '';
    try { detail = (await res.json()).error.message || ''; } catch (e) { /* no body */ }
    const err = new Error(detail || ('HTTP ' + res.status));
    err.status = res.status;
    err.detail = detail;
    throw err;
  }

  function explain(e) {
    if (e.status === 403) return 'Google refused access (403). Check: sheet shared as "Anyone with the link: Viewer", Google Sheets API enabled, and the API key allows this website.';
    if (e.status === 400 && /api key/i.test(e.detail || '')) return 'The API key in settings.js is not valid.';
    if (e.status === 400) return "Cannot find a tab named 'masterdata' in your Database sheet.";
    if (e.status === 404) return 'Database sheet not found. Check SHEET_ID in settings.js.';
    if (e instanceof TypeError) return 'Cannot reach Google (offline?). Using the last saved copy.';
    return e.message || String(e);
  }

  function refresh(opts) {
    const force = !!(opts && opts.force);
    if (inflight) return inflight;
    if (!force && Date.now() - state.lastCheck < MIN_GAP) return Promise.resolve(status());
    if (!configured()) {
      state.error = 'Setup needed: add your Google API key in settings.js (see README).';
      emit(false);
      return Promise.resolve(status());
    }

    inflight = (async () => {
      let changed = false;
      try {
        const rows = await fetchRows();
        state.lastCheck = Date.now();
        const sig = JSON.stringify(rows);
        if (sig !== state.sig || !state.db) {
          state.db = buildDb(rows);        // parse first; only swap on success
          state.sig = sig;
          state.lastChange = Date.now();
          state.cached = false;
          changed = true;
          lsSet({ sig, lastChange: state.lastChange });
        }
        state.error = '';
      } catch (e) {
        state.lastCheck = Date.now();
        state.error = explain(e);
      } finally {
        inflight = null;
      }
      emit(changed);
      return status();
    })();
    return inflight;
  }

  function start() {
    // Instant start from the last saved copy, then verify with Google.
    const saved = lsGet();
    if (saved && saved.sig) {
      try {
        state.db = buildDb(JSON.parse(saved.sig));
        state.sig = saved.sig;
        state.lastChange = saved.lastChange || 0;
        state.cached = true;
        emit(true);
      } catch (e) { /* ignore a bad cache */ }
    }
    refresh({ force: true });
    if (!timer) timer = setInterval(() => refresh({ force: true }), SYNC_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh({ force: true }); });
      window.addEventListener('online', () => refresh({ force: true }));
      window.addEventListener('focus', () => refresh());
    }
  }

  function getDatabase() {
    if (!state.db) throw new Error(state.error || 'Database is still loading, one moment…');
    return state.db;
  }

  function status() {
    return {
      ok: !!state.db,
      configured: configured(),
      items: state.db ? state.db.catalog.length : 0,
      lastCheck: state.lastCheck,
      lastChange: state.lastChange,
      cached: state.cached,
      error: state.error
    };
  }

  const exported = { start, refresh, getDatabase, status, buildDb, onChange: f => subs.push(f) };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else globalThis.FB_sheet = exported;
})();
