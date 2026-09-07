/* Único lugar para la API. Cuando la tengas, pégala en apiUrl.
   También sirve: QberriesAdmin.useApi("https://tu-api...")
   No pongas claves secretas aquí. */
(function (root) {
  var stored = "";
  try {
    stored = String((root.localStorage && root.localStorage.getItem("qberries.apiUrl")) || "");
  } catch (err) {
    stored = "";
  }
  var meta = typeof document !== "undefined" ? document.querySelector('meta[name="qberries-api"]') : null;
  var fromMeta = meta ? String(meta.getAttribute("content") || "").trim() : "";

  root.QberriesConfig = {
    apiUrl: String(root.QBERRIES_API_URL || stored || fromMeta || "https://script.google.com/macros/s/AKfycbwJ96j5p83jznd5y1lj345TguxKoczjZkJnHIpY7IxBg8gt5P7v1TVb8_I0cTLQ-lwy/exec").trim(),
    pollMs: 8000,
    timeoutMs: 12000,
    staleMs: 4000,
    retries: 2,
  };
})(typeof window !== "undefined" ? window : globalThis);
