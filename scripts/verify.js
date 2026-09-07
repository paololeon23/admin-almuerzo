/* Chequeo de sintaxis y de parseo de reservas. No llama a la API de producción. */
var fs = require("fs");
var path = require("path");
var vm = require("vm");
var assert = require("assert");
var { execSync } = require("child_process");

var root = path.join(__dirname, "..");
var files = ["js/config.js", "js/store.js", "js/api.js", "js/report.js", "js/app.js", "sw.js"];
files.forEach(function (f) {
  execSync("node --check " + JSON.stringify(path.join(root, f)), { stdio: "inherit" });
});

var ctx = {
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  AbortController: AbortController,
  fetch: function () {
    return Promise.reject(new Error("offline-test"));
  },
  indexedDB: undefined,
  localStorage: {
    getItem: function () {
      return null;
    },
    setItem: function () {},
    removeItem: function () {},
  },
  navigator: { onLine: true },
  document: {
    querySelector: function () {
      return null;
    },
    getElementById: function () {
      return null;
    },
    readyState: "complete",
    addEventListener: function () {},
    body: { style: {} },
  },
  location: { protocol: "https:", hash: "#/dashboard", hostname: "localhost" },
  window: null,
};
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.root = ctx;
vm.createContext(ctx);
["js/config.js", "js/store.js", "js/api.js"].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
});

var parse = ctx.QberriesApi.parseReservations;
assert.strictEqual(parse(null), null);
assert.strictEqual(parse(undefined), null);
assert.strictEqual(parse({}), null);
var empty = parse({ ok: true, reservas: [] });
assert.ok(empty.trusted);
assert.strictEqual(empty.rows.length, 0);
var arr = parse([{ dni: "123", date: "2026-09-07" }]);
assert.strictEqual(arr.rows.length, 1);
var nested = parse({ reservas: [{ dni: "1" }] });
assert.strictEqual(nested.rows.length, 1);
var failed = false;
try {
  parse({ ok: false, error: "dni_invalido" });
} catch (err) {
  failed = true;
  assert.ok(err.status === 422);
}
assert.ok(failed);
assert.ok(ctx.QberriesStore.version === 1);
assert.strictEqual(ctx.QberriesStore.compactRows([{ date: "2026-09-07" }, { date: "2020-01-01" }], "2026-09-07").length, 1);

var html = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.ok(html.indexOf("js/store.js") !== -1);
assert.ok(html.indexOf("manifest.webmanifest") !== -1);
var toml = fs.readFileSync(path.join(root, "netlify.toml"), "utf8");
assert.ok(toml.indexOf("/*") !== -1);
assert.ok(toml.indexOf("/index.html") !== -1);
assert.ok(toml.indexOf("must-revalidate") !== -1);

console.log("verify ok");
