(function (root) {
  var inflight = {};
  var cache = {};
  var controllers = {};

  function cfg() {
    return root.QberriesConfig || {};
  }
  function online() {
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
    } catch (err) {}
    return true;
  }
  function friendlyStatus(status) {
    if (status === 401 || status === 403) return "No tiene permiso para ver esta información.";
    if (status === 404) return "No se encontró el servicio de reservas.";
    if (status === 408) return "La consulta tardó demasiado. Intente nuevamente.";
    if (status === 409 || status === 422) return "Los datos recibidos no se pudieron usar.";
    if (status === 429) return "Hay demasiadas consultas. Espere un momento.";
    if (status === 502 || status === 503 || status === 504) return "El servicio no está disponible ahora.";
    if (status >= 500) return "El servidor no pudo completar la consulta.";
    if (status >= 400) return "No se pudo cargar la información. Intente nuevamente.";
    return "No se pudo cargar la información. Intente nuevamente.";
  }
  function friendlyError(err) {
    if (!err) return "No se pudo cargar la información. Intente nuevamente.";
    if (err.offline) return "Sin conexión. Se muestran los datos guardados.";
    if (err.status) return friendlyStatus(err.status);
    if (err.name === "AbortError") return "La consulta tardó demasiado. Intente nuevamente.";
    if (typeof location !== "undefined" && location.protocol === "file:") {
      return "Ábrelo con Live Server. Desde un archivo local el panel no puede leer la hoja.";
    }
    return "No se pudo cargar la información. Intente nuevamente.";
  }
  function joinUrl(base, path) {
    var a = String(base || "").replace(/\/+$/, "");
    var b = String(path || "");
    if (!b) return a;
    if (/^https?:\/\//i.test(b)) return b;
    return a + (b.charAt(0) === "/" ? b : "/" + b);
  }
  function parseBody(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== "object") return [];
    if (Array.isArray(data.reservas)) return data.reservas;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.rows)) return data.rows;
    if (Array.isArray(data.items)) return data.items;
    return [];
  }
  function parseReservations(data) {
    if (Array.isArray(data)) return { rows: data, trusted: true };
    if (!data || typeof data !== "object") return null;
    if (data.ok === false) {
      throw { status: 422, message: adminMessage(data.error), data: data };
    }
    var rows = null;
    if (Array.isArray(data.reservas)) rows = data.reservas;
    else if (Array.isArray(data.data)) rows = data.data;
    else if (Array.isArray(data.rows)) rows = data.rows;
    else if (Array.isArray(data.items)) rows = data.items;
    if (!rows) return null;
    return { rows: rows, trusted: data.ok === true || Array.isArray(data.reservas) };
  }
  function retryable(err, method, attempt, max, allowRetry) {
    if (!allowRetry || method !== "GET" || attempt >= max) return false;
    var status = err && err.status;
    if (status === 400 || status === 401 || status === 403 || status === 404 || status === 409 || status === 422) return false;
    if (err && err.offline) return false;
    return true;
  }
  function waitMs(err, attempt) {
    var status = err && err.status;
    if (status === 429) return Math.min(8000, 1500 * Math.pow(2, attempt));
    return Math.min(4000, 400 * Math.pow(2, attempt));
  }
  function request(opts) {
    opts = opts || {};
    var method = String(opts.method || "GET").toUpperCase();
    var url = String(opts.url || "").trim();
    if (!url) {
      return Promise.reject({ status: 0, message: "Falta la URL de la API." });
    }
    var key = method + " " + url;
    var staleMs = opts.staleMs != null ? opts.staleMs : cfg().staleMs || 4000;
    if (method === "GET" && !opts.fresh && cache[key] && Date.now() - cache[key].at < staleMs) {
      return Promise.resolve(cache[key].data);
    }
    if (method === "GET" && inflight[key]) return inflight[key];
    var allowRetry = opts.retry !== false;
    var maxRetry = opts.retries != null ? Number(opts.retries) : Number(cfg().retries || 0);

    function once() {
      if (!online()) {
        if (method === "GET" && cache[key]) return Promise.resolve(cache[key].data);
        return Promise.reject({ status: 0, message: friendlyError({ offline: true }), offline: true });
      }
      if (controllers[key]) {
        try {
          controllers[key].abort();
        } catch (err) {}
      }
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      if (ctrl) controllers[key] = ctrl;
      var timeoutMs = opts.timeout != null ? opts.timeout : cfg().timeoutMs || 8000;
      var timer = root.setTimeout(function () {
        if (ctrl) ctrl.abort();
      }, timeoutMs);
      var headers = { Accept: "application/json" };
      if (opts.body != null) headers["Content-Type"] = "application/json";
      return fetch(url, {
        method: method,
        headers: headers,
        body: opts.body != null ? JSON.stringify(opts.body) : undefined,
        cache: "no-store",
        signal: ctrl ? ctrl.signal : undefined,
      })
        .then(function (res) {
          if (res.status === 204) return null;
          var type = (res.headers.get("content-type") || "").toLowerCase();
          var read =
            type.indexOf("json") !== -1
              ? res.json()
              : res.text().then(function (t) {
                  try {
                    return t ? JSON.parse(t) : null;
                  } catch (err) {
                    return null;
                  }
                });
          return read.then(function (data) {
            if (!res.ok) {
              throw { status: res.status, message: friendlyStatus(res.status), data: data };
            }
            return data;
          });
        })
        .then(function (data) {
          if (method === "GET" && data != null) cache[key] = { at: Date.now(), data: data };
          return data;
        })
        .catch(function (err) {
          if (err && err.status) throw err;
          throw { status: 0, message: friendlyError(err), cause: err, offline: !online() };
        })
        .finally(function () {
          root.clearTimeout(timer);
          if (controllers[key] === ctrl) delete controllers[key];
        });
    }

    function attempt(n) {
      return once().catch(function (err) {
        if (!retryable(err, method, n, maxRetry, allowRetry)) throw err;
        return new Promise(function (resolve) {
          root.setTimeout(resolve, waitMs(err, n));
        }).then(function () {
          return attempt(n + 1);
        });
      });
    }

    var started = attempt(0).finally(function () {
      if (inflight[key]) delete inflight[key];
    });
    if (method === "GET") inflight[key] = started;
    return started;
  }
  function queryUrl(base, params) {
    var url = String(base || "").trim();
    var parts = [];
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] == null || params[k] === "") return;
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
    });
    if (!url || !parts.length) return url;
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + parts.join("&");
  }
  function adminMessage(code) {
    var map = {
      dni_invalido: "El DNI debe tener 8 dígitos.",
      nombre_invalido: "Escribe el nombre completo.",
      supervisor_invalido: "No se encontró la lista de ese supervisor hoy.",
      comedor_requerido: "Falta el comedor de envío.",
      lock_timeout: "El servidor está ocupado. Intente de nuevo.",
      fecha_invalida: "La fecha no es válida.",
      json_invalido: "No se pudo leer la respuesta.",
      peticion_desconocida: "El servidor no reconoció la petición.",
      sin_cambios: "Ese comedor y fundo ya estaban guardados.",
      sesion_invalida: "Falta el DNI del supervisor.",
    };
    return map[String(code || "")] || "No se pudo guardar. Intente nuevamente.";
  }
  function unwrapAdmin(data) {
    if (data && data.ok === false) {
      if (data.error === "sin_cambios") return data;
      throw { status: 422, message: adminMessage(data.error), data: data };
    }
    return data;
  }
  function getReservations(opts) {
    var url = String((cfg().apiUrl || "").trim());
    return request(Object.assign({ method: "GET", url: url }, opts || {})).then(function (data) {
      var parsed = parseReservations(data);
      if (!parsed) throw { status: 422, message: "Los datos recibidos no se pudieron usar." };
      return parsed;
    });
  }
  function mutate(params) {
    var url = queryUrl(cfg().apiUrl, params);
    return request({ method: "GET", url: url, fresh: true, timeout: 20000, retry: false }).then(unwrapAdmin);
  }
  function addReserva(body) {
    return mutate({
      action: "add",
      dni: body.dni,
      name: body.name,
      nombre: body.name,
      apellido: body.apellido || "",
      apellidos: body.apellido || "",
      nombres: body.nombres || "",
      trabajador_apellido: body.apellido || "",
      trabajador_nombre: body.nombres || "",
      supervisor: body.supervisor,
      supervisor_id: body.supervisor_id || "",
      sede: body.sede || "",
      comedor: body.sede || body.comedor || "",
      fundo: body.fundo || body.etapa || "",
      etapa: body.fundo || body.etapa || "",
    });
  }
  function quitarReserva(body) {
    return mutate({
      action: "quitar",
      dni: body.dni,
      date: body.date,
      fecha: body.date,
      supervisor: body.supervisor || "",
      supervisor_id: body.supervisor_id || "",
    });
  }
  function editarReserva(body) {
    return mutate({
      action: "editar",
      dni: body.dni || "",
      date: body.date || "",
      fecha: body.date || "",
      supervisor: body.supervisor || "",
      supervisor_id: body.supervisor_id || "",
      sede: body.sede || "",
      comedor: body.sede || body.comedor || "",
      fundo: body.fundo || body.etapa || "",
      etapa: body.fundo || body.etapa || "",
    });
  }
  function getSupervisors() {
    var url = queryUrl(cfg().apiUrl, { path: "supervisores" });
    return request({ method: "GET", url: url }).then(function (data) {
      unwrapAdmin(data);
      return Array.isArray(data && data.supervisores) ? data.supervisores : [];
    });
  }
  function hallList(data) {
    return ((data && data.comedores) || [])
      .map(function (c) {
        return typeof c === "string" ? c : c && (c.name || c.sede || "");
      })
      .filter(Boolean);
  }
  function fundoList(data) {
    var raw = (data && (data.fundos || data.etapas)) || [];
    var out = [];
    raw.forEach(function (f) {
      var name = typeof f === "string" ? f : f && (f.name || f.fundo || f.etapa);
      if (name && out.indexOf(name) === -1) out.push(String(name).trim());
    });
    return out;
  }
  function getOpciones() {
    var url = queryUrl(cfg().apiUrl, { path: "comedores" });
    return request({ method: "GET", url: url }).then(function (data) {
      unwrapAdmin(data);
      return { comedores: hallList(data), fundos: fundoList(data) };
    });
  }
  function getComedores() {
    return getOpciones().then(function (data) {
      return data.comedores;
    });
  }

  root.QberriesApi = {
    request: request,
    queryUrl: queryUrl,
    online: online,
    get: function (path, opts) {
      return request(Object.assign({}, opts, { method: "GET", url: joinUrl(cfg().apiUrl, path) }));
    },
    post: function (path, body, opts) {
      return request(Object.assign({}, opts, { method: "POST", url: joinUrl(cfg().apiUrl, path), body: body, fresh: true, retry: false }));
    },
    put: function (path, body, opts) {
      return request(Object.assign({}, opts, { method: "PUT", url: joinUrl(cfg().apiUrl, path), body: body, fresh: true, retry: false }));
    },
    patch: function (path, body, opts) {
      return request(Object.assign({}, opts, { method: "PATCH", url: joinUrl(cfg().apiUrl, path), body: body, fresh: true, retry: false }));
    },
    del: function (path, opts) {
      return request(Object.assign({}, opts, { method: "DELETE", url: joinUrl(cfg().apiUrl, path), fresh: true, retry: false }));
    },
    getReservations: getReservations,
    addReserva: addReserva,
    quitarReserva: quitarReserva,
    editarReserva: editarReserva,
    getSupervisors: getSupervisors,
    getOpciones: getOpciones,
    getComedores: getComedores,
    parseBody: parseBody,
    parseReservations: parseReservations,
    friendlyError: friendlyError,
    clearCache: function () {
      cache = {};
    },
    abortAll: function () {
      Object.keys(controllers).forEach(function (k) {
        try {
          controllers[k].abort();
        } catch (err) {}
      });
      controllers = {};
      inflight = {};
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
