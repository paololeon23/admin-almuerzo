/* Respaldo local. Versión 1. IndexedDB con fallback a localStorage. */
(function (root) {
  var VERSION = 1;
  var DB_NAME = "qberries-admin";
  var DB_STORE = "kv";
  var PREFIX = "qberries.v" + VERSION + ".";
  var memory = {};
  var dbp = null;

  function canLS() {
    try {
      return !!(root.localStorage);
    } catch (err) {
      return false;
    }
  }
  function lsGet(key) {
    if (!canLS()) return memory[key] || null;
    try {
      var raw = root.localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : memory[key] || null;
    } catch (err) {
      return memory[key] || null;
    }
  }
  function lsSet(key, value) {
    memory[key] = value;
    if (!canLS()) return false;
    try {
      root.localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (err) {
      try {
        root.localStorage.removeItem(PREFIX + key);
      } catch (e2) {}
      return false;
    }
  }
  function openDb() {
    if (dbp) return dbp;
    if (!root.indexedDB) {
      dbp = Promise.resolve(null);
      return dbp;
    }
    dbp = new Promise(function (resolve) {
      var timer = root.setTimeout(function () {
        resolve(null);
      }, 800);
      try {
        var req = root.indexedDB.open(DB_NAME, VERSION);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
        };
        req.onsuccess = function () {
          root.clearTimeout(timer);
          resolve(req.result);
        };
        req.onerror = function () {
          root.clearTimeout(timer);
          resolve(null);
        };
        req.onblocked = function () {
          root.clearTimeout(timer);
          resolve(null);
        };
      } catch (err) {
        root.clearTimeout(timer);
        resolve(null);
      }
    });
    return dbp;
  }
  function idbOp(fn) {
    return openDb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          fn(db, resolve);
        } catch (err) {
          resolve(null);
        }
      });
    });
  }
  function get(key) {
    return idbOp(function (db, resolve) {
      var tx = db.transaction(DB_STORE, "readonly");
      var req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = function () {
        var val = req.result;
        if (val === undefined) resolve(lsGet(key));
        else resolve(val);
      };
      req.onerror = function () {
        resolve(lsGet(key));
      };
    }).then(function (val) {
      return val == null ? lsGet(key) : val;
    });
  }
  function set(key, value) {
    if (value == null) return Promise.resolve(false);
    memory[key] = value;
    lsSet(key, value);
    return idbOp(function (db, resolve) {
      var tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = function () {
        resolve(true);
      };
      tx.onerror = function () {
        resolve(false);
      };
    }).then(function (ok) {
      return !!ok || true;
    });
  }
  function compactRows(rows, today) {
    var list = Array.isArray(rows) ? rows : [];
    var oldest = "";
    try {
      var d = new Date(String(today || "") + "T12:00:00");
      if (!isNaN(d.getTime())) {
        d.setDate(d.getDate() - 7);
        oldest = d.toISOString().slice(0, 10);
      }
    } catch (err) {}
    var kept = oldest
      ? list.filter(function (r) {
          return r && String(r.date || "") >= oldest;
        })
      : list.slice();
    if (kept.length > 4000) kept = kept.slice(kept.length - 4000);
    return kept;
  }

  root.QberriesStore = {
    version: VERSION,
    get: get,
    set: set,
    compactRows: compactRows,
    getReservations: function () {
      return get("reservations");
    },
    saveReservations: function (pack) {
      if (!pack || !Array.isArray(pack.rows)) return Promise.resolve(false);
      return set("reservations", {
        version: VERSION,
        at: pack.at || Date.now(),
        date: pack.date || "",
        rows: compactRows(pack.rows, pack.date),
      });
    },
    getCatalog: function () {
      return get("catalog");
    },
    saveCatalog: function (pack) {
      if (!pack) return Promise.resolve(false);
      var sups = Array.isArray(pack.supervisores) ? pack.supervisores : [];
      var halls = Array.isArray(pack.comedores) ? pack.comedores : [];
      var fundos = Array.isArray(pack.fundos) ? pack.fundos : [];
      if (!sups.length && !halls.length && !fundos.length) return Promise.resolve(false);
      return set("catalog", {
        version: VERSION,
        at: Date.now(),
        supervisores: sups,
        comedores: halls,
        fundos: fundos,
      });
    },
    getDaySnap: function (date) {
      return get("day:" + String(date || ""));
    },
    saveDaySnap: function (date, snap) {
      var key = String(date || "");
      if (!key || !snap) return Promise.resolve(false);
      if (snap.prepared == null && snap.extras == null) return Promise.resolve(false);
      return set("day:" + key, Object.assign({ version: VERSION, date: key, at: Date.now() }, snap));
    },
    getMeta: function () {
      return get("meta");
    },
    saveMeta: function (meta) {
      return set("meta", Object.assign({ version: VERSION }, meta || {}));
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
