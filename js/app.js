(function (root) {
  var MEALS = [
    { id: "arroz-con-pollo", name: "Arroz con pollo", color: "#55A846" },
    { id: "lomo-saltado", name: "Lomo saltado", color: "#F7941D" },
    { id: "pollo-plancha", name: "Pollo a la plancha", color: "#3F8736" },
    { id: "vegetariano", name: "Vegetariano", color: "#B7C934" },
  ];
  var SEDES = (function () {
    var list = [];
    var n;
    for (n = 1; n <= 11; n += 1) list.push("Comedor " + n);
    list.push("Comedor Galpón", "Garita 1", "Garita 2", "Comedor Administrativo");
    return list;
  })();
  var SUPERVISORS = [
    "Aguirre Noriega Marco Antonio",
    "Chilón Sánchez Danny Roberth",
    "Vásquez Delgado Roberto Carlos",
    "Ponce Ruiz Isidro",
    "Díaz Varas Fanny del Milagro",
    "Plasencia Correa Nadia Yvonne",
    "Verde Pinillos Luis Pablito",
    "Rojas Castillo Elena Patricia",
  ];
  var SUPERVISOR_SEDE = {
    "Aguirre Noriega Marco Antonio": "Comedor 1",
    "Chilón Sánchez Danny Roberth": "Comedor 2",
    "Vásquez Delgado Roberto Carlos": "Comedor 3",
    "Ponce Ruiz Isidro": "Comedor 4",
    "Díaz Varas Fanny del Milagro": "Comedor 5",
    "Plasencia Correa Nadia Yvonne": "Comedor 9",
    "Verde Pinillos Luis Pablito": "Comedor Galpón",
    "Rojas Castillo Elena Patricia": "Garita 1",
  };
  var GROUP_SIZE = 30;
  var CFG = root.QberriesConfig || {};
  var CONFIG = {
    apiUrl: String(CFG.apiUrl || "").trim(),
    pollMs: Number(CFG.pollMs) || 8000,
    timeoutMs: Number(CFG.timeoutMs) || 12000,
    staleMs: Number(CFG.staleMs) || 4000,
  };
  var ALL = [];
  var stamp = "";
  var pendingTeamMeals = {};
  function rememberPendingMeal(row) {
    var id = digitsDni(row && row.dni);
    if (!id || !row) return;
    pendingTeamMeals[id] = row;
  }
  function forgetPendingMeal(dni) {
    delete pendingTeamMeals[digitsDni(dni)];
  }
  function overlayPending(rows) {
    var next = (rows || []).slice();
    Object.keys(pendingTeamMeals).forEach(function (id) {
      var pending = pendingTeamMeals[id];
      var mine = next.filter(function (r) {
        return r.date === TODAY && digitsDni(r.dni) === id && r.status !== "cancelled";
      });
      if (!mine.length) {
        next.push(pending);
        return;
      }
      if (pending && pending.extra && mine.length === 1 && !mine[0].extra) {
        next = next.map(function (r) {
          if (r.date === TODAY && digitsDni(r.dni) === id && r.status !== "cancelled") {
            return Object.assign({}, r, { extra: true });
          }
          return r;
        });
      }
      delete pendingTeamMeals[id];
    });
    return next;
  }
  var TODAY = todayKey();
  var CATALOG_SUPS = [];
  var CATALOG_HALLS = [];
  var CATALOG_FUNDOS = [];
  var FUNDOS = ["LICAPA I", "LICAPA II", "LICAPA III"];
  var teamDestChoice = {};
  function sedeOfSupervisor(name) {
    if (SUPERVISOR_SEDE[name]) return SUPERVISOR_SEDE[name];
    var i;
    for (i = ALL.length - 1; i >= 0; i -= 1) {
      if (ALL[i].supervisor === name && ALL[i].sede && ALL[i].status !== "cancelled") return ALL[i].sede;
    }
    return SEDES[0];
  }
  function personParts(row) {
    var ap = String((row && (row.apellido || row.lastName)) || "").replace(/\s+/g, " ").trim();
    var no = String((row && (row.nombres || row.firstName)) || "").replace(/\s+/g, " ").trim();
    if (!no && row && row.nombre && fold(row.nombre) !== fold(row.name)) {
      no = String(row.nombre).replace(/\s+/g, " ").trim();
    }
    if (ap || no) {
      return { apellido: ap, nombres: no, full: (ap + " " + no).replace(/\s+/g, " ").trim() };
    }
    var bits = String((row && row.name) || "")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean);
    if (bits.length >= 3) {
      return { apellido: bits[0] + " " + bits[1], nombres: bits.slice(2).join(" "), full: bits.join(" ") };
    }
    return { apellido: bits.join(" "), nombres: "", full: bits.join(" ") };
  }
  function twoApellidos(name) {
    var parts = String(name || "").replace(/\s+/g, " ").trim().split(" ");
    if (parts.length >= 2) return parts[0] + " " + parts[1];
    return parts[0] || "";
  }
  function supervisorKeyOf(name) {
    var duty = dutyOf(name);
    return duty.supervisor_id || String(name || "").trim();
  }
  function dutyOf(name) {
    var want = fold(name);
    var out = { name: String(name || "").trim(), supervisor_id: "", sede: "", fundo: "" };
    var i;
    for (i = ALL.length - 1; i >= 0; i--) {
      var r = ALL[i];
      if (fold(r.supervisor) !== want) continue;
      if (r.supervisor_id) out.supervisor_id = r.supervisor_id;
      if (r.sede) out.sede = r.sede;
      if (r.fundo) out.fundo = r.fundo;
      if (out.supervisor_id && out.sede && out.fundo) break;
    }
    for (i = 0; i < CATALOG_SUPS.length; i++) {
      var s = CATALOG_SUPS[i];
      var full = s.name || s.nombre || "";
      var dni = String(s.dni || s.id || "").replace(/\D/g, "");
      if (fold(full) !== want && fold(twoApellidos(full)) !== want) continue;
      if (!out.supervisor_id && dni) out.supervisor_id = dni;
      if (!out.sede && (s.sede || s.comedor)) out.sede = s.sede || s.comedor;
      if (!out.fundo && (s.fundo || s.etapa)) out.fundo = s.fundo || s.etapa;
    }
    return out;
  }
  function rememberTeamDest(supervisor, sede, fundo) {
    var key = String(supervisor || "").trim();
    if (!key) return;
    var prev = teamDestChoice[key] || {};
    teamDestChoice[key] = {
      sede: String(sede || prev.sede || "").trim(),
      fundo: String(fundo || prev.fundo || "").trim(),
    };
  }
  function applyDestLocal(supervisor, sede, fundo) {
    var want = fold(supervisor);
    var next = ALL.map(function (r) {
      if (r.date !== TODAY || r.status === "cancelled") return r;
      if (fold(r.supervisor) !== want) return r;
      return Object.assign({}, r, {
        sede: sede || r.sede,
        fundo: fundo || r.fundo,
      });
    });
    applyRows(next, { render: true });
  }
  function fundoNames() {
    var list = CATALOG_FUNDOS.length ? CATALOG_FUNDOS.slice() : FUNDOS.slice();
    var seen = {};
    return list.filter(function (name) {
      name = String(name || "").trim();
      if (!name || seen[name]) return false;
      seen[name] = true;
      return true;
    });
  }
  function hallNames() {
    var seen = {};
    var list = [];
    function add(name) {
      name = String(name || "").trim();
      if (!name || fold(name) === "garita" || seen[name]) return;
      seen[name] = true;
      list.push(name);
    }
    SEDES.forEach(add);
    CATALOG_HALLS.forEach(add);
    ALL.forEach(function (r) {
      add(r.sede);
    });
    return list;
  }
  var DEFAULT_VENDORS = [
    { id: "valle", name: "Refrigerios del Valle", short: "Valle" },
    { id: "gemelitas", name: "Gemelitas", short: "Gemelitas" },
  ];
  var VENDOR_STORE = "qberries.kitchenVendors";
  var VENDOR_CATALOG_STORE = "qberries.kitchenVendorCatalog";
  var VENDORS = DEFAULT_VENDORS.slice();
  var kitchenVendors = {};
  var kitchenVendorFilter = "all";
  var kitchenListPage = 1;
  var KITCHEN_LIST_SIZE = 8;
  function vendorShortFromName(name) {
    var parts = String(name || "")
      .trim()
      .split(/\s+/);
    if (!parts[0]) return "Dist.";
    if (parts.length === 1) return parts[0].slice(0, 14);
    if (/^(del|de|la|los|las)$/i.test(parts[parts.length - 2] || "")) {
      return parts[parts.length - 1].slice(0, 14);
    }
    return parts[parts.length - 1].slice(0, 14);
  }
  function vendorIdFromName(name) {
    var base = String(name || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    return base || "dist";
  }
  function normalizeVendorList(list) {
    var out = [];
    var seen = {};
    (Array.isArray(list) ? list : []).forEach(function (item) {
      if (!item || typeof item !== "object") return;
      var name = String(item.name || "").trim();
      if (!name) return;
      var id = String(item.id || vendorIdFromName(name)).trim() || vendorIdFromName(name);
      if (seen[id]) return;
      seen[id] = true;
      out.push({
        id: id,
        name: name,
        short: String(item.short || vendorShortFromName(name)).trim() || vendorShortFromName(name),
      });
    });
    return out;
  }
  function saveVendorCatalog() {
    try {
      root.localStorage.setItem(VENDOR_CATALOG_STORE, JSON.stringify(VENDORS));
    } catch (err) {}
  }
  (function loadVendorCatalog() {
    try {
      var raw = JSON.parse(root.localStorage.getItem(VENDOR_CATALOG_STORE) || "null");
      var list = normalizeVendorList(raw);
      VENDORS = list.length ? list : DEFAULT_VENDORS.slice();
    } catch (err) {
      VENDORS = DEFAULT_VENDORS.slice();
    }
  })();
  (function loadKitchenVendors() {
    try {
      var raw = JSON.parse(root.localStorage.getItem(VENDOR_STORE) || "{}");
      if (raw && typeof raw === "object") kitchenVendors = raw;
    } catch (err) {
      kitchenVendors = {};
    }
  })();
  function saveKitchenVendors() {
    try {
      root.localStorage.setItem(VENDOR_STORE, JSON.stringify(kitchenVendors));
    } catch (err) {}
  }
  function findVendor(id) {
    var i;
    for (i = 0; i < VENDORS.length; i += 1) {
      if (VENDORS[i].id === id) return VENDORS[i];
    }
    return null;
  }
  function vendorName(id) {
    var v = findVendor(id);
    return v ? v.name : "Sin proveedor";
  }
  function vendorShort(id) {
    var v = findVendor(id);
    return v ? v.short : "—";
  }
  function isKnownVendor(id) {
    return !!findVendor(id);
  }
  function vendorOfHall(name) {
    return String(kitchenVendors[name] || "");
  }
  function setHallVendor(hall, vendorId, opts) {
    hall = String(hall || "").trim();
    if (!hall) return;
    opts = opts || {};
    vendorId = String(vendorId || "").trim();
    if (opts.toggle && isKnownVendor(vendorId) && kitchenVendors[hall] === vendorId) {
      delete kitchenVendors[hall];
    } else if (isKnownVendor(vendorId)) {
      kitchenVendors[hall] = vendorId;
    } else {
      delete kitchenVendors[hall];
    }
    saveKitchenVendors();
    paintVendorBoard();
    if (kitchenVendors[hall]) logMove("Asignó " + hall + " a " + vendorName(kitchenVendors[hall]) + ".");
    else logMove("Quitó el proveedor de " + hall + ".");
    if (!opts.silent) paint();
  }
  function addDistributor(name) {
    name = String(name || "").trim();
    if (!name) return { ok: false, error: "Escribe el nombre." };
    var folded = fold(name);
    var i;
    for (i = 0; i < VENDORS.length; i += 1) {
      if (fold(VENDORS[i].name) === folded) {
        return { ok: false, error: "Esa distribuidora ya está registrada." };
      }
    }
    var base = vendorIdFromName(name);
    var id = base;
    var n = 2;
    while (findVendor(id)) {
      id = base + "-" + n;
      n += 1;
    }
    VENDORS.push({ id: id, name: name, short: vendorShortFromName(name) });
    saveVendorCatalog();
    logMove("Registró la distribuidora " + name + ".");
    return { ok: true, id: id };
  }
  function removeDistributor(id) {
    id = String(id || "").trim();
    var vendor = findVendor(id);
    if (!vendor) return false;
    VENDORS = VENDORS.filter(function (v) {
      return v.id !== id;
    });
    Object.keys(kitchenVendors).forEach(function (hall) {
      if (kitchenVendors[hall] === id) delete kitchenVendors[hall];
    });
    if (kitchenVendorFilter === id) kitchenVendorFilter = "all";
    saveVendorCatalog();
    saveKitchenVendors();
    logMove("Eliminó la distribuidora " + vendor.name + ".");
    return true;
  }
  function paintDistList() {
    var box = document.getElementById("dist-list");
    if (!box) return;
    if (!VENDORS.length) {
      box.innerHTML = '<p class="empty">Aún no hay distribuidoras. Registra la primera.</p>';
      return;
    }
    box.innerHTML = VENDORS.map(function (v) {
      return (
        '<div class="dist-row">' +
        "<div><strong>" +
        esc(v.name) +
        "</strong><small>" +
        esc(v.short) +
        '</small></div><button type="button" class="dist-del" data-dist-del="' +
        esc(v.id) +
        '">Eliminar</button></div>'
      );
    }).join("");
  }
  function openDistModal() {
    var modal = document.getElementById("dist-modal");
    var input = document.getElementById("dist-name");
    if (!modal) return;
    paintDistList();
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
    if (input) {
      input.value = "";
      root.setTimeout(function () {
        input.focus();
      }, 40);
    }
  }
  function closeDistModal() {
    var modal = document.getElementById("dist-modal");
    if (modal) modal.classList.remove("open");
    document.body.style.overflow = "";
    paint();
  }
  var vendorPickHall = "";
  function hallShort(name) {
    return String(name || "").replace(/^Comedor\s+/i, "C. ");
  }
  function vendorTileHtml(c) {
    return (
      '<button type="button" class="vendor-tile" draggable="true" data-vendor-tile="' +
      esc(c.name) +
      '"><strong>' +
      esc(c.name) +
      "</strong><span>" +
      c.count +
      "</span></button>"
    );
  }
  function paintVendorBoard() {
    var board = document.getElementById("vendor-board");
    if (!board) return;
    var halls = comedorCounts(ALL, TODAY);
    var groups = { none: [] };
    VENDORS.forEach(function (v) {
      groups[v.id] = [];
    });
    halls.forEach(function (c) {
      var vid = vendorOfHall(c.name) || "none";
      if (!groups[vid]) groups.none.push(c);
      else groups[vid].push(c);
    });
    function bin(id, title, extraClass) {
      var list = groups[id] || [];
      return (
        '<section class="vendor-bin ' +
        extraClass +
        '" data-drop="' +
        id +
        '"><header><h3>' +
        esc(title) +
        "</h3><b>" +
        list.length +
        "</b></header><div class=\"vendor-tiles\">" +
        (list.length ? list.map(vendorTileHtml).join("") : '<p class="vendor-drop-hint">Suelta aquí</p>') +
        "</div></section>"
      );
    }
    var tone = ["is-valle", "is-gem", "is-extra", "is-mint"];
    board.innerHTML =
      bin("none", "Sin asignar", "is-pool") +
      VENDORS.map(function (v, idx) {
        return bin(v.id, v.name, tone[idx % tone.length]);
      }).join("");
    if (vendorPickHall) {
      var on = board.querySelector('[data-vendor-tile="' + vendorPickHall.replace(/"/g, "") + '"]');
      if (on) on.classList.add("is-picked");
    }
    var hint = document.getElementById("vendor-hint");
    if (hint) {
      hint.textContent = vendorPickHall
        ? "Toca el recuadro del proveedor para lanzar " + vendorPickHall + "."
        : "Arrastra cada comedor al recuadro. En celular, tócalo y luego toca el proveedor.";
    }
  }
  function openVendorModal() {
    var modal = document.getElementById("vendor-modal");
    if (!modal) return;
    vendorPickHall = "";
    paintVendorBoard();
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function closeVendorModal() {
    var modal = document.getElementById("vendor-modal");
    vendorPickHall = "";
    if (modal) modal.classList.remove("open");
    document.body.style.overflow = "";
    paint();
  }
  function closeKitchenPicks() {
    document.querySelectorAll(".k-vendor-pick.open").forEach(function (el) {
      el.classList.remove("open");
      var menu = el.querySelector(".pick-menu");
      var btn = el.querySelector(".pick-btn");
      if (menu) menu.hidden = true;
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }
  function toggleKitchenPick(pick) {
    var wasOpen = pick.classList.contains("open");
    closeKitchenPicks();
    closeReservaPick();
    if (wasOpen) return;
    pick.classList.add("open");
    var menu = pick.querySelector(".pick-menu");
    var btn = pick.querySelector(".pick-btn");
    if (menu) menu.hidden = false;
    if (btn) btn.setAttribute("aria-expanded", "true");
  }
  function supervisorOptions() {
    var seen = {};
    var list = [];
    function add(name) {
      name = String(name || "").trim();
      if (!name || seen[fold(name)]) return;
      seen[fold(name)] = true;
      list.push(name);
    }
    CATALOG_SUPS.forEach(function (s) {
      add(s.name || s.nombre);
    });
    ALL.forEach(function (r) {
      add(r.supervisor);
    });
    if (!CONFIG.apiUrl) SUPERVISORS.forEach(add);
    list.sort(function (a, b) {
      return a.localeCompare(b, "es");
    });
    return list;
  }
  function primaryComedor(comedores) {
    var names = Object.keys(comedores || {});
    if (!names.length) return "";
    names.sort(function (a, b) {
      return comedores[b].meals - comedores[a].meals || a.localeCompare(b, "es");
    });
    return names[0];
  }
  var WORKERS_SEED = [
    ["70501230", "Villarreal Muñoz María del Carmen", "Cosecha"],
    ["70485667", "Villarreal Muñoz Jenny Aurora", "Cosecha"],
    ["41767303", "Vallejos Tito Dorotty Raquel", "Empaque"],
    ["47055637", "Tineo Guerrero Jhon Miguel", "Cosecha"],
    ["73503509", "Terrones Portal Luis Melbin", "Riego"],
    ["73255232", "Sánchez Díaz Nilson Nolberto", "Cosecha"],
    ["60473829", "Polo Polo Jorge Isaías", "Mantenimiento"],
    ["44062139", "Centurión Barturen Wilson Edy", "Cosecha"],
    ["72752397", "Castrejón Gonzales Exequiel", "Empaque"],
    ["41171243", "Campos Machuca Maribel", "Calidad"],
    ["74684641", "Cabrera Correa Jhordan Anderson", "Cosecha"],
    ["72123573", "Cabanillas Izquierdo Edgar", "Riego"],
    ["46426978", "Burgos Vásquez Ebelio", "Cosecha"],
    ["40123890", "Alva Rojas Karina Elizabeth", "Empaque"],
    ["45881234", "Becerra Quispe Henry Daniel", "Cosecha"],
    ["70214567", "Castañeda Ruiz Lucía Fernanda", "Empaque"],
    ["73450987", "Espinoza Torres Ana Lucía", "Calidad"],
    ["46781230", "Flores Huamán Pedro Alonso", "Cosecha"],
    ["70892345", "García León Rosa María", "Administración"],
    ["42345678", "Herrera Salas Miguel Ángel", "Riego"],
    ["45123456", "Jiménez Rojas Carlos Enrique", "Cosecha"],
    ["71678901", "López Cueva Diana Patricia", "Calidad"],
    ["40987654", "Mendoza Silva José Antonio", "Cosecha"],
    ["74567890", "Paredes Cruz Melisa Andrea", "Cosecha"],
    ["41876543", "Quispe Ramos Edwin Jair", "Riego"],
  ];
  var EXTRA_NAMES = [
    ["Aguilar Soto Paola Milagros", "Empaque"],
    ["Ríos Fernández Kevin André", "Cosecha"],
    ["Chávez Palacios Rosa Elena", "Calidad"],
    ["Navarro Díaz Julio César", "Riego"],
    ["Salazar Vega Andrea Lucero", "Administración"],
    ["Huamán Cruz Elvis Jair", "Cosecha"],
    ["Torres Medina Fiorella Isabel", "Empaque"],
    ["Ramírez Paredes Óscar Daniel", "Mantenimiento"],
    ["Gutiérrez Rojas Sandra Milagros", "Calidad"],
    ["Pérez Alvarado Renzo Alonso", "Cosecha"],
    ["Silva Castro Angie Patricia", "Empaque"],
    ["Morales Quispe Bruno Alexis", "Riego"],
    ["Fernández León Carmen Rosa", "Cosecha"],
    ["Rojas Palomino Diego Armando", "Calidad"],
    ["Vargas Núñez Lizeth Marisol", "Empaque"],
    ["Cueva Santos Franklin José", "Cosecha"],
    ["Delgado Pinedo Mónica Beatriz", "Administración"],
    ["Cruz Valverde Héctor Manuel", "Riego"],
    ["Ortiz Campos Nataly Estefany", "Cosecha"],
    ["Pineda Rojas Walter Enrique", "Mantenimiento"],
    ["León Huertas Katherine Yulissa", "Empaque"],
    ["Soto Alarcón Miguel Ángel", "Cosecha"],
    ["Cárdenas Vega Rocío del Pilar", "Calidad"],
    ["Mejía Torres Brayan Smith", "Cosecha"],
    ["Alarcón Díaz Evelyn Vanessa", "Empaque"],
    ["Núñez Castillo Pedro Pablo", "Riego"],
    ["Palacios Ramos Fátima Nicole", "Cosecha"],
    ["Valverde Soto Christian Joel", "Mantenimiento"],
    ["Huertas López Yesenia Magaly", "Calidad"],
    ["Castillo Pérez Anderson Luis", "Cosecha"],
  ];
  var ROUTES = ["/dashboard", "/supervisores", "/comedores", "/reservas", "/cocina"];

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pad(n) {
    return String(n).padStart(2, "0");
  }
  function limaParts(now) {
    var map = {};
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Lima",
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      hourCycle: "h23",
    }).formatToParts(now || new Date()).forEach(function (p) {
      if (p.type !== "literal") map[p.type] = p.value;
    });
    if (map.hour === "24") map.hour = "00";
    return map;
  }
  function todayKey(now) {
    var p = limaParts(now);
    return p.year + "-" + p.month + "-" + p.day;
  }
  function addDays(key, days) {
    var p = key.split("-").map(Number);
    var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  }
  function weekday(key) {
    var p = key.split("-").map(Number);
    return ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][new Date(p[0], p[1] - 1, p[2]).getDay()];
  }
  function longDate(key) {
    var p = key.split("-").map(Number);
    var dt = new Date(p[0], p[1] - 1, p[2]);
    var weekday = new Intl.DateTimeFormat("es-PE", { weekday: "long" }).format(dt);
    var month = new Intl.DateTimeFormat("es-PE", { month: "long" }).format(dt);
    var text = weekday + ", " + p[2] + " de " + month + " de " + p[0];
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  function pad2(v) {
    return ("0" + v).slice(-2);
  }
  function limaNow() {
    var p = limaParts();
    return {
      date: longDate(p.year + "-" + p.month + "-" + p.day),
      time: [pad2(p.hour), pad2(p.minute), pad2(p.second)].join(":"),
    };
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fold(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }
  function initials(name) {
    return String(name || "")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map(function (p) {
        return p[0];
      })
      .join("")
      .toUpperCase();
  }
  function pick(rand, list) {
    return list[Math.floor(rand() * list.length)];
  }
  function parseRoute(hash) {
    var value = String(hash || "#/dashboard").replace(/^#/, "").replace(/\/+$/, "");
    if (!value || value === "/") return "/dashboard";
    if (value.charAt(0) !== "/") value = "/" + value;
    return ROUTES.indexOf(value) === -1 ? "/dashboard" : value;
  }
  function matchesQuery(row, query) {
    var q = fold(query);
    if (!q) return true;
    return (
      fold(row.name).indexOf(q) !== -1 ||
      String(row.dni).indexOf(q.replace(/\D/g, "") || q) !== -1 ||
      fold(row.supervisor).indexOf(q) !== -1 ||
      fold(row.mealName).indexOf(q) !== -1 ||
      fold(row.sede).indexOf(q) !== -1
    );
  }
  function buildRoster() {
    var rand = mulberry32(20260906);
    var used = {};
    var roster = [];
    function add(dni, name, area, supervisor) {
      if (used[dni]) return;
      used[dni] = true;
      roster.push({
        dni: dni,
        name: name,
        area: area,
        supervisor: supervisor,
        sede: sedeOfSupervisor(supervisor),
      });
    }
    WORKERS_SEED.forEach(function (w, i) {
      add(w[0], w[1], w[2], SUPERVISORS[i % SUPERVISORS.length]);
    });
    EXTRA_NAMES.forEach(function (w, i) {
      var dni = String(40000000 + Math.floor(rand() * 49999999));
      add(dni, w[0], w[1], SUPERVISORS[(WORKERS_SEED.length + i) % SUPERVISORS.length]);
    });
    var given = ["Luis", "María", "José", "Ana", "Carlos", "Rosa", "Pedro", "Lucía", "Miguel", "Elena", "Jorge", "Patricia"];
    var family = ["Rojas", "Pérez", "Torres", "Díaz", "Cruz", "Vega", "Silva", "López", "Ramos", "Soto", "Quispe", "León"];
    var areas = ["Cosecha", "Empaque", "Riego", "Calidad", "Mantenimiento", "Administración"];
    SUPERVISORS.forEach(function (sup, si) {
      var have = 0;
      roster.forEach(function (w) {
        if (w.supervisor === sup) have += 1;
      });
      var n = 0;
      while (have < 24) {
        var dni = String(30000000 + si * 100000 + have * 37 + n);
        var name =
          family[n % family.length] +
          " " +
          family[(n + si + 3) % family.length] +
          " " +
          given[n % given.length] +
          " " +
          given[(n + 5) % given.length];
        add(dni, name, areas[n % areas.length], sup);
        have += 1;
        n += 1;
      }
    });
    return roster.sort(function (a, b) {
      return a.supervisor.localeCompare(b.supervisor, "es") || a.name.localeCompare(b.name, "es");
    });
  }
  var ROSTER = buildRoster();
  function syncWorkers() {
    WORKERS = ROSTER.map(function (w) {
      return [w.dni, w.name, w.area, w.supervisor, w.sede];
    });
  }
  var WORKERS = [];
  syncWorkers();
  function matchWorkerPrecise(row, query) {
    var raw = String(query || "").trim();
    if (!raw) return { ok: true, rank: 2 };
    var digits = raw.replace(/\D/g, "");
    var dni = String(row.dni);
    var name = fold(row.name);
    var area = fold(row.area);
    var onlyDigits = /^\d[\d\s-]*$/.test(raw);
    if (onlyDigits && digits) {
      if (dni === digits) return { ok: true, rank: 0 };
      if (dni.indexOf(digits) === 0) return { ok: true, rank: 1 };
      return { ok: false, rank: 9 };
    }
    var tokens = fold(raw.replace(/\d/g, " "))
      .split(/\s+/)
      .filter(Boolean);
    var nameHit = tokens.length && tokens.every(function (t) {
      return name.indexOf(t) !== -1;
    });
    var dniHit = digits && (dni === digits || dni.indexOf(digits) === 0);
    if (dniHit && nameHit) return { ok: true, rank: 0 };
    if (dniHit) return { ok: true, rank: 1 };
    if (nameHit) return { ok: true, rank: tokens[0] && name.indexOf(tokens[0]) === 0 ? 2 : 3 };
    if (area.indexOf(fold(raw)) !== -1) return { ok: true, rank: 4 };
    return { ok: false, rank: 9 };
  }
  function digitsDni(value) {
    return String(value || "").replace(/\D/g, "");
  }
  function sameDni(a, b) {
    var left = digitsDni(a);
    var right = digitsDni(b);
    return !!(left && right && left === right);
  }
  function sameSupervisor(a, b) {
    var fa = fold(a);
    var fb = fold(b);
    if (!fa || !fb) return false;
    if (fa === fb) return true;
    var ta = fold(twoApellidos(a));
    var tb = fold(twoApellidos(b));
    return fa === tb || fb === ta || ta === tb;
  }
  function belongsToSupervisor(row, supervisor) {
    if (!row) return false;
    if (sameSupervisor(row.supervisor, supervisor)) return true;
    var duty = dutyOf(supervisor);
    var wantId = digitsDni(duty && duty.supervisor_id);
    var gotId = digitsDni(row.supervisor_id);
    return !!(wantId && gotId && wantId === gotId);
  }
  function activeTodayFor(dni, supervisor) {
    var id = digitsDni(dni);
    if (!id) return null;
    var hits = [];
    ALL.forEach(function (r) {
      if (r.date !== TODAY || r.status === "cancelled") return;
      if (digitsDni(r.dni) !== id) return;
      if (supervisor && !belongsToSupervisor(r, supervisor)) return;
      hits.push(r);
    });
    return hits.length ? hits[hits.length - 1] : null;
  }
  function supervisorHasMealsToday(supervisor) {
    return ALL.some(function (r) {
      return r.date === TODAY && r.status !== "cancelled" && belongsToSupervisor(r, supervisor);
    });
  }
  function mergeTodayRow(row) {
    var n = normalizeReservation(row) || row;
    if (!n || !n.dni || !n.date) return;
    n = Object.assign({}, n, { dni: digitsDni(n.dni) || n.dni });
    var id = digitsDni(n.dni);
    var next = ALL.filter(function (r) {
      if (r.date !== n.date || digitsDni(r.dni) !== id) return true;
      if (r.status === "cancelled") return true;
      return !!r.extra !== !!n.extra;
    });
    next.push(n);
    applyRows(next, { render: true });
  }
  function workersOfSupervisor(supervisor) {
    var map = {};
    function put(w, today) {
      if (!w || !w.dni) return;
      var id = digitsDni(w.dni);
      if (!id) return;
      var current = map[id];
      var meal =
        today && today.status !== "cancelled"
          ? today
          : current && current.status !== "cancelled" && current.status !== "none"
            ? current
            : today;
      map[id] = {
        dni: id,
        name: w.name || (current && current.name) || "",
        apellido: w.apellido || (current && current.apellido) || "",
        nombres: w.nombres || w.nombre || (current && current.nombres) || "",
        area: w.area || (current && current.area) || "",
        supervisor: supervisor,
        sede: w.sede || (current && current.sede) || sedeOfSupervisor(supervisor),
        mealName: meal && meal.status !== "cancelled" ? meal.mealName || (current && current.mealName) || "" : "",
        extra: meal ? !!meal.extra : !!(current && current.extra),
        status: meal && meal.status ? meal.status : current && current.status ? current.status : "none",
      };
    }
    ROSTER.forEach(function (w) {
      if (!sameSupervisor(w.supervisor, supervisor)) return;
      if (CONFIG.apiUrl && !w.local) return;
      put(w, activeTodayFor(w.dni, supervisor));
    });
    ALL.forEach(function (r) {
      if (r.date !== TODAY || !belongsToSupervisor(r, supervisor)) return;
      put(r, activeTodayFor(r.dni, supervisor) || r);
    });
    return Object.keys(map)
      .map(function (k) {
        return map[k];
      })
      .sort(function (a, b) {
        var ao = a.status !== "none" && a.status !== "cancelled" ? 0 : 1;
        var bo = b.status !== "none" && b.status !== "cancelled" ? 0 : 1;
        return ao - bo || a.name.localeCompare(b.name, "es");
      });
  }
  function nowTime() {
    return limaNow().time.slice(0, 5);
  }
  function findWorker(dni) {
    var id = digitsDni(dni);
    var fromRoster = ROSTER.filter(function (w) {
      return sameDni(w.dni, id);
    })[0];
    if (fromRoster) return fromRoster;
    var fromAll = ALL.filter(function (r) {
      return sameDni(r.dni, id);
    })[0];
    if (!fromAll) return null;
    return {
      dni: fromAll.dni,
      name: fromAll.name,
      apellido: fromAll.apellido || "",
      nombres: fromAll.nombres || fromAll.nombre || "",
      area: fromAll.area || "",
      supervisor: fromAll.supervisor,
      sede: fromAll.sede,
    };
  }
  function upsertRoster(supervisor, data) {
    var dni = String(data.dni || "").replace(/\D/g, "");
    var name = String(data.name || "").trim();
    var apellido = String(data.apellido || "").replace(/\s+/g, " ").trim();
    var nombres = String(data.nombres || data.nombre || "").replace(/\s+/g, " ").trim();
    if (!name) name = (apellido + " " + nombres).replace(/\s+/g, " ").trim();
    var sede = sedeOfSupervisor(supervisor);
    var found = findWorker(dni);
    if (found) {
      found.name = name || found.name;
      found.apellido = apellido || found.apellido;
      found.nombres = nombres || found.nombres;
      found.supervisor = supervisor;
      found.sede = sede;
      found.local = true;
    } else {
      ROSTER.push({
        dni: dni,
        name: name,
        apellido: apellido,
        nombres: nombres,
        area: "",
        supervisor: supervisor,
        sede: sede,
        local: true,
      });
      ROSTER.sort(function (a, b) {
        return a.supervisor.localeCompare(b.supervisor, "es") || a.name.localeCompare(b.name, "es");
      });
    }
    syncWorkers();
    return findWorker(dni);
  }
  function addMealToday(supervisor, worker, extra) {
    if (teamBusy || !worker || !worker.dni) return Promise.resolve(false);
    teamBusy = true;
    var sede = worker.sede || sedeOfSupervisor(supervisor);
    var asExtra = !!extra || !!activeTodayFor(worker.dni, supervisor) || supervisorHasMealsToday(supervisor);
    function optimisticRow(apiRow) {
      var duty = dutyOf(supervisor);
      var fromApi = apiRow ? normalizeReservation(apiRow) : null;
      if (fromApi && fromApi.status === "cancelled") fromApi = null;
      if (fromApi && asExtra) fromApi = Object.assign({}, fromApi, { extra: true });
      return fromApi || {
        id: "rh-" + Date.now(),
        dni: digitsDni(worker.dni),
        name: worker.name,
        apellido: worker.apellido || "",
        nombres: worker.nombres || "",
        area: worker.area || "",
        mealId: "",
        mealName: "",
        date: TODAY,
        time: nowTime(),
        supervisor: supervisor,
        supervisor_id: duty.supervisor_id || "",
        sede: sede || duty.sede,
        fundo: duty.fundo || "",
        extra: asExtra,
        status: "confirmed",
      };
    }
    function applyLocal(apiRow) {
      var row = optimisticRow(apiRow);
      rememberPendingMeal(row);
      mergeTodayRow(row);
      teamPage = 1;
      paintTeamList();
    }
    function toastAdded(flag) {
      toast(flag ? "Agregado como extra." : "Agregado a la lista de hoy.");
      logMove(
        (flag ? "Agregó como extra a " : "Agregó a la lista a ") +
          (worker.name || worker.dni) +
          (supervisor ? " · " + supervisor : "") +
          "."
      );
    }
    function finishLocal(apiRow) {
      applyLocal(apiRow);
      toastAdded(asExtra);
      return true;
    }
    if (CONFIG.apiUrl && root.QberriesApi && root.QberriesApi.addReserva) {
      var duty = dutyOf(supervisor);
      return root.QberriesApi.addReserva({
        dni: worker.dni,
        name: worker.name,
        apellido: worker.apellido || "",
        nombres: worker.nombres || "",
        supervisor: supervisor,
        supervisor_id: duty.supervisor_id,
        sede: sede || duty.sede,
        fundo: duty.fundo,
      })
        .then(function (data) {
          if (data && data.extra) asExtra = true;
          applyLocal(data && data.reserva);
          toastAdded(asExtra);
          root.QberriesApi.clearCache();
          return waitApiFree()
            .then(function () {
              return pullApi({ fresh: true });
            })
            .catch(function () {
              return false;
            })
            .then(function () {
              if (!activeTodayFor(worker.dni, supervisor)) applyLocal(data && data.reserva);
              else paintTeamList();
              return true;
            });
        })
        .catch(function (err) {
          toast((err && err.message) || "No se pudo guardar. Intente nuevamente.");
          return false;
        })
        .finally(function () {
          teamBusy = false;
        });
    }
    try {
      return Promise.resolve(finishLocal());
    } finally {
      teamBusy = false;
    }
  }
  function dropMealToday(dni, supervisor) {
    if (teamBusy || !dni) return Promise.resolve(false);
    teamBusy = true;
    function finishLocal() {
      var person = dni;
      ALL.some(function (r) {
        if (r.date === TODAY && sameDni(r.dni, dni) && r.status !== "cancelled" && belongsToSupervisor(r, supervisor)) {
          person = r.name || dni;
          return true;
        }
        return false;
      });
      logMove("Eliminó a " + person + " de la lista" + (supervisor ? " de " + supervisor : "") + ".");
      forgetPendingMeal(dni);
      var next = ALL.map(function (r) {
        if (r.date === TODAY && sameDni(r.dni, dni) && r.status !== "cancelled" && belongsToSupervisor(r, supervisor)) {
          return Object.assign({}, r, { status: "cancelled", extra: false });
        }
        return r;
      });
      applyRows(next, { render: true });
      paintTeamList();
      toast("Eliminado de la lista de hoy.");
      return true;
    }
    if (CONFIG.apiUrl && root.QberriesApi && root.QberriesApi.quitarReserva) {
      var duty = dutyOf(supervisor || "");
      return root.QberriesApi.quitarReserva({
        dni: dni,
        date: TODAY,
        supervisor: supervisor || "",
        supervisor_id: duty.supervisor_id,
      })
        .then(function () {
          finishLocal();
          root.QberriesApi.clearCache();
          return pullApi({ fresh: true }).then(function () {
            paintTeamList();
            return true;
          });
        })
        .catch(function (err) {
          toast((err && err.message) || "No se pudo eliminar. Intente nuevamente.");
          return false;
        })
        .finally(function () {
          teamBusy = false;
        });
    }
    try {
      return Promise.resolve(finishLocal());
    } finally {
      teamBusy = false;
    }
  }
  function destLabel(s) {
    var hall = primaryComedor(s.comedores);
    var bits = [];
    if (hall) bits.push(hall);
    if (s.fundo) bits.push(s.fundo);
    return bits.join(" · ");
  }
  function closeTeamPick(kind) {
    var pick = document.getElementById("team-" + kind + "-pick");
    var btn = document.getElementById("team-" + kind + "-btn");
    var menu = document.getElementById("team-" + kind + "-menu");
    if (pick) pick.classList.remove("open");
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (menu) menu.hidden = true;
  }
  function closeTeamPicks() {
    closeTeamPick("comedor");
    closeTeamPick("fundo");
  }
  function toggleTeamPick(kind) {
    var pick = document.getElementById("team-" + kind + "-pick");
    var btn = document.getElementById("team-" + kind + "-btn");
    var menu = document.getElementById("team-" + kind + "-menu");
    if (!pick || !btn || !menu) return;
    var open = !pick.classList.contains("open");
    closeTeamPicks();
    if (!open) return;
    pick.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    menu.hidden = false;
  }
  function setTeamPick(kind, value) {
    var hidden = document.getElementById("team-" + kind);
    var text = document.getElementById("team-" + kind + "-text");
    var pick = document.getElementById("team-" + kind + "-pick");
    var v = String(value || "").trim();
    if (hidden) hidden.value = v;
    if (text) text.textContent = v || "Elegir";
    if (pick) {
      pick.setAttribute("data-value", v);
      Array.prototype.forEach.call(pick.querySelectorAll(".pick-opt"), function (opt) {
        var on = (opt.getAttribute("data-value") || "") === v;
        opt.classList.toggle("on", on);
        opt.setAttribute("aria-selected", on ? "true" : "false");
      });
    }
    closeTeamPick(kind);
    var modal = document.getElementById("team-modal");
    var supervisor = modal ? modal.getAttribute("data-supervisor") || "" : "";
    if (kind === "comedor") rememberTeamDest(supervisor, v, "");
    else if (kind === "fundo") rememberTeamDest(supervisor, "", v);
  }
  function fillTeamDest(forcedSede, forcedFundo) {
    var modal = document.getElementById("team-modal");
    if (!modal) return;
    var supervisor = modal.getAttribute("data-supervisor") || "";
    var duty = dutyOf(supervisor);
    var choice = teamDestChoice[supervisor] || {};
    var halls = hallNames().filter(function (n) {
      return fold(n) !== "garita";
    });
    var fundos = fundoNames();
    var sede = String(forcedSede || choice.sede || duty.sede || "").trim();
    var fundo = String(forcedFundo || choice.fundo || duty.fundo || "").trim();
    function pickInList(list, current) {
      var i;
      var want = fold(current);
      if (!want) return "";
      for (i = 0; i < list.length; i++) {
        if (list[i] === current || fold(list[i]) === want) return list[i];
      }
      return "";
    }
    function fill(kind, list, current) {
      var menu = document.getElementById("team-" + kind + "-menu");
      var value = pickInList(list, current) || list[0] || "";
      if (menu) {
        menu.innerHTML = list
          .map(function (v) {
            return (
              '<button type="button" class="pick-opt' +
              (v === value ? " on" : "") +
              '" role="option" data-value="' +
              esc(v) +
              '" aria-selected="' +
              (v === value ? "true" : "false") +
              '"><span>' +
              esc(v) +
              "</span></button>"
            );
          })
          .join("");
      }
      setTeamPick(kind, value);
    }
    fill("comedor", halls, sede);
    fill("fundo", fundos, fundo || fundos[0] || "");
  }
  function saveTeamDest() {
    var modal = document.getElementById("team-modal");
    var supervisor = modal ? modal.getAttribute("data-supervisor") || "" : "";
    var hallEl = document.getElementById("team-comedor");
    var fundoEl = document.getElementById("team-fundo");
    var btn = document.getElementById("team-dest-btn");
    if (!supervisor || !hallEl || !fundoEl) return Promise.resolve(false);
    var sede = String(hallEl.value || "").trim();
    var fundo = String(fundoEl.value || "").trim();
    if (!sede && !fundo) {
      toast("Elige un comedor o un fundo.");
      return Promise.resolve(false);
    }
    if (teamBusy) return Promise.resolve(false);
    teamBusy = true;
    if (btn) {
      btn.disabled = true;
        btn.textContent = "Editando…";
    }
    var duty = dutyOf(supervisor);
    function done() {
      teamBusy = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Editar";
      }
    }
    if (CONFIG.apiUrl && root.QberriesApi && root.QberriesApi.editarReserva) {
      return root.QberriesApi.editarReserva({
        supervisor: supervisor,
        supervisor_id: duty.supervisor_id,
        sede: sede,
        fundo: fundo,
        date: TODAY,
      })
        .then(function (data) {
          rememberTeamDest(supervisor, sede, fundo);
          applyDestLocal(supervisor, sede, fundo);
          root.QberriesApi.clearCache();
          return pullApi({ fresh: true }).then(function () {
            applyDestLocal(supervisor, sede, fundo);
            fillTeamDest(sede, fundo);
            return data;
          });
        })
        .then(function (data) {
          if (data && data.error === "sin_cambios") toast("Ese comedor y fundo ya estaban guardados.");
          else {
            toast("Comedor y fundo actualizados.");
            logMove("Cambió el destino de " + supervisor + " a " + [sede, fundo].filter(Boolean).join(" · ") + ".");
          }
          return true;
        })
        .catch(function (err) {
          toast((err && err.message) || "No se pudo guardar. Intente nuevamente.");
          return false;
        })
        .finally(done);
    }
    var next = ALL.map(function (r) {
      if (r.date !== TODAY || r.supervisor !== supervisor || r.status === "cancelled") return r;
      return Object.assign({}, r, {
        sede: sede || r.sede,
        fundo: fundo || r.fundo,
      });
    });
    applyRows(next, { render: true });
    rememberTeamDest(supervisor, sede, fundo);
    fillTeamDest(sede, fundo);
    toast("Comedor y fundo actualizados.");
    logMove("Cambió el destino de " + supervisor + " a " + [sede, fundo].filter(Boolean).join(" · ") + ".");
    done();
    return Promise.resolve(true);
  }
  function statusLabel(row) {
    if (row.status === "cancelled") return { text: "Cancelada", cls: "bad" };
    if (row.status === "pending") return { text: "Pendiente", cls: "info" };
    if (row.extra) return { text: "Extra", cls: "warn" };
    return { text: "Lista", cls: "neutral" };
  }

  function truthyExtra(v) {
    if (v === true || v === 1) return true;
    var s = fold(v);
    return s === "1" || s === "true" || s === "si" || s === "extra";
  }
  function normalizeStatus(v) {
    var s = fold(v);
    if (s === "cancelled" || s === "cancelada" || s === "canceled") return "cancelled";
    if (s === "pending" || s === "pendiente") return "pending";
    return "confirmed";
  }
  function normalizeReservation(raw) {
    if (!raw || typeof raw !== "object") return null;
    var supervisor = String(raw.supervisor || raw.supervisor_name || "").trim();
    var sede = String(raw.sede || raw.comedor || raw.hall || "").trim() || sedeOfSupervisor(supervisor);
    var status = normalizeStatus(raw.status || raw.estado);
    var tipo = fold(raw.tipo || raw.type);
    var extra = tipo === "normal" || tipo === "lista" ? false : (tipo === "extra" || truthyExtra(raw.extra));
    if (status === "cancelled") extra = false;
    var date = String(raw.date || raw.fecha || "").slice(0, 10);
    if (!date) return null;
    var dni = String(raw.dni || raw.documento || "").replace(/\D/g, "");
    var time = String(raw.time || raw.hora || "").trim();
    var id = String(raw.id || raw._id || "").trim();
    if (!id || id === dni) {
      id = dni + "-" + date + (extra ? "-x" : "-l") + "-" + time;
    }
    var apellido = String(raw.apellido || raw.trabajador_apellido || "").trim();
    var nombres = String(raw.nombres || raw.nombre_trabajador || raw.trabajador_nombre || "").trim();
    var name = String(raw.name || raw.trabajador || "").trim();
    if (!nombres && raw.nombre && name && fold(raw.nombre) !== fold(name)) {
      nombres = String(raw.nombre).trim();
    }
    if (!name) name = String(raw.nombre || "").trim();
    if (!name) name = (apellido + " " + nombres).replace(/\s+/g, " ").trim();
    return {
      id: id,
      dni: dni,
      name: name,
      apellido: apellido,
      nombres: nombres,
      area: String(raw.area || "").trim(),
      mealId: raw.mealId || raw.plato_id || "",
      mealName: String(raw.mealName || raw.plato || "").trim(),
      date: date,
      time: time,
      supervisor: supervisor,
      supervisor_id: String(raw.supervisor_id || raw.supervisorId || "").replace(/\D/g, "").slice(0, 8),
      sede: sede,
      fundo: String(raw.fundo || raw.etapa || "").trim(),
      extra: extra,
      status: status,
    };
  }
  function generate(now) {
    var rand = mulberry32(20260905);
    var today = todayKey(now);
    var rows = [];
    var seen = {};
    var i;
    for (i = 0; i < 520; i += 1) {
      var ago = rand() < 0.55 ? 0 : rand() < 0.72 ? 1 : Math.floor(rand() * 7);
      var date = addDays(today, -ago);
      var worker = WORKERS[i % WORKERS.length];
      var key = String(worker[0]) + "|" + date;
      if (seen[key]) continue;
      seen[key] = true;
      var meal = rand() < 0.36 ? MEALS[0] : rand() < 0.62 ? MEALS[1] : rand() < 0.85 ? MEALS[2] : MEALS[3];
      var supervisor = worker[3] || SUPERVISORS[i % SUPERVISORS.length];
      var sede = worker[4] || sedeOfSupervisor(supervisor);
      var hour = rand() < 0.7 ? 6 + Math.floor(rand() * 3) : 9 + Math.floor(rand() * 4);
      var extra = hour >= 9 ? (ago === 0 ? rand() < 0.28 : ago === 1 ? rand() < 0.38 : rand() < 0.08) : rand() < 0.06;
      var status = rand() < 0.9 ? "confirmed" : rand() < 0.6 ? "cancelled" : "pending";
      if (status === "cancelled") extra = false;
      rows.push({
        id: "rsv-" + String(rows.length + 1).padStart(4, "0"),
        dni: worker[0],
        name: worker[1],
        area: worker[2],
        mealId: meal.id,
        mealName: meal.name,
        date: date,
        time: pad(hour) + ":" + pad(Math.floor(rand() * 60)),
        supervisor: supervisor,
        sede: sede,
        extra: extra,
        status: status,
      });
    }
    return rows;
  }
  function bumpHall(map, name) {
    if (!map[name]) map[name] = { name: name, meals: 0, extras: 0, regular: 0, sups: {} };
    return map[name];
  }
  function bumpSup(map, name) {
    if (!map[name]) {
      map[name] = { supervisor: name, supervisor_id: "", fundo: "", meals: 0, extras: 0, regular: 0, cancelled: 0, comedores: {} };
    }
    return map[name];
  }
  function dayView(rows, date) {
    var hallsMap = {};
    var supMap = {};
    var seen = {};
    var list = [];
    var cancelled = 0;
    hallNames().forEach(function (name) {
      bumpHall(hallsMap, name);
    });
    (rows || []).forEach(function (raw) {
      var r = raw && raw.date ? raw : normalizeReservation(raw);
      if (!r || r.date !== date) return;
      var key = r.dni + "|" + r.date + "|" + (r.extra ? "x" : "l") + "|" + r.status + "|" + (r.time || "");
      if (seen[key]) return;
      seen[key] = true;
      if (r.status === "cancelled") {
        cancelled += 1;
        bumpSup(supMap, r.supervisor).cancelled += 1;
        return;
      }
      list.push(r);
      var h = bumpHall(hallsMap, r.sede || sedeOfSupervisor(r.supervisor));
      h.meals += 1;
      if (r.extra) h.extras += 1;
      else h.regular += 1;
      h.sups[r.supervisor] = true;
      var s = bumpSup(supMap, r.supervisor);
      if (r.supervisor_id) s.supervisor_id = r.supervisor_id;
      if (r.fundo) s.fundo = r.fundo;
      var sentAt = String(r.time || "").trim();
      if (sentAt.length === 5) sentAt += ":00";
      if (sentAt && (!s.lastTime || sentAt > s.lastTime)) s.lastTime = sentAt;
      s.meals += 1;
      if (r.extra) s.extras += 1;
      else s.regular += 1;
      if (!s.comedores[h.name]) s.comedores[h.name] = { meals: 0, extras: 0 };
      s.comedores[h.name].meals += 1;
      if (r.extra) s.comedores[h.name].extras += 1;
    });
    var extras = list.filter(function (r) {
      return r.extra;
    }).length;
    var prepared = list.length;
    var regular = prepared - extras;
    var groups = {};
    list.forEach(function (r) {
      groups[r.supervisor] = true;
    });
    var groupCount = Object.keys(groups).length;
    var halls = Object.keys(hallsMap)
      .map(function (name) {
        var h = hallsMap[name];
        h.supervisors = Object.keys(h.sups);
        return h;
      })
      .sort(function (a, b) {
        var ia = SEDES.indexOf(a.name);
        var ib = SEDES.indexOf(b.name);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.name.localeCompare(b.name, "es");
      });
    var hallsActive = halls
      .filter(function (h) {
        return h.meals > 0;
      })
      .slice()
      .sort(function (a, b) {
        return b.meals - a.meals || a.name.localeCompare(b.name, "es");
      });
    var supervisors = Object.keys(supMap)
      .map(function (k) {
        return supMap[k];
      })
      .sort(function (a, b) {
        return b.meals - a.meals || a.supervisor.localeCompare(b.supervisor, "es");
      });
    return {
      list: list,
      cancelled: cancelled,
      extras: extras,
      regular: regular,
      prepared: prepared,
      groups: groupCount,
      authorized: groupCount * GROUP_SIZE,
      comedores: hallsActive.length,
      halls: halls,
      hallsActive: hallsActive,
      supervisors: supervisors,
    };
  }
  var viewMemo = { stamp: "", map: {} };
  function viewOf(rows, date) {
    var d = date || TODAY;
    var r = rows || ALL;
    if (r !== ALL) return dayView(r, d);
    if (viewMemo.stamp !== stamp) viewMemo = { stamp: stamp, map: {} };
    if (!viewMemo.map[d]) viewMemo.map[d] = dayView(ALL, d);
    return viewMemo.map[d];
  }
  function activeOn(rows, date) {
    return viewOf(rows, date).list;
  }
  function cancelledOn(rows, date) {
    return viewOf(rows, date).cancelled;
  }
  function bySupervisor(rows, date) {
    return viewOf(rows, date).supervisors;
  }
  function byComedor(rows, date) {
    return viewOf(rows, date).hallsActive;
  }
  function comedorCounts(rows, date) {
    return viewOf(rows, date).halls.map(function (h) {
      return {
        name: h.name,
        count: h.meals,
        extras: h.extras,
        regular: h.regular,
      };
    });
  }
  function totals(rows, date) {
    var d = viewOf(rows, date);
    return {
      prepared: d.prepared,
      extras: d.extras,
      regular: d.regular,
      cancelled: d.cancelled,
      all: d.prepared + d.cancelled,
      groups: d.groups,
      authorized: d.authorized,
      comedores: d.comedores,
    };
  }
  function comedoresFromSupervisors(list) {
    var map = {};
    list.forEach(function (s) {
      Object.keys(s.comedores || {}).forEach(function (name) {
        if (!map[name]) map[name] = { name: name, meals: 0, extras: 0 };
        map[name].meals += s.comedores[name].meals;
        map[name].extras += s.comedores[name].extras;
      });
    });
    return Object.keys(map).map(function (k) {
      return map[k];
    });
  }
  function week(rows, date) {
    var out = [];
    for (var i = 6; i >= 0; i -= 1) {
      var key = addDays(date, -i);
      var day = viewOf(rows, key);
      out.push({
        date: key,
        label: weekday(key),
        total: day.prepared,
      });
    }
    return out;
  }
  function supervisorsWhoAsked(rows, date) {
    return viewOf(rows, date).groups;
  }
  function rowsStamp(rows) {
    return (rows || [])
      .map(function (r) {
        return [r.id, r.date, r.status, r.extra ? 1 : 0, r.sede, r.supervisor, r.fundo || "", r.supervisor_id || ""].join(":");
      })
      .sort()
      .join("|");
  }
  function reconcileOrphanExtras(rows) {
    var lista = {};
    (rows || []).forEach(function (r) {
      if (!r || r.status === "cancelled" || r.extra) return;
      var key = (r.date || "") + "|" + String(r.supervisor || "").trim();
      lista[key] = (lista[key] || 0) + 1;
    });
    return (rows || []).map(function (r) {
      if (!r || r.status === "cancelled" || !r.extra) return r;
      var key = (r.date || "") + "|" + String(r.supervisor || "").trim();
      if (lista[key]) return r;
      return Object.assign({}, r, { extra: false });
    });
  }
  function applyRows(rows, opts) {
    opts = opts || {};
    if (!Array.isArray(rows) && rows != null) return false;
    var next = [];
    (rows || []).forEach(function (raw) {
      var r = normalizeReservation(raw) || (raw && raw.date ? raw : null);
      if (r) next.push(r);
    });
    next = reconcileOrphanExtras(next);
    next = overlayPending(next);
    if (!next.length && ALL.length && !opts.allowEmpty) return false;
    var nextStamp = rowsStamp(next);
    if (nextStamp === stamp) return false;
    stamp = nextStamp;
    ALL = next;
    if (typeof paintNotices === "function") paintNotices();
    if (opts.render && typeof paint === "function") requestPaint();
    if (!opts.fromCache && (next.length || opts.allowEmpty)) {
      rememberDaySnap(TODAY, daySnapFromAll(TODAY));
      var y = addDays(TODAY, -1);
      var ySnap = daySnapFromAll(y);
      if (ySnap.prepared || ySnap.extras || ySnap.regular || !DAY_SNAPS[y]) rememberDaySnap(y, ySnap);
      if (next.length) schedulePersist();
    }
    return true;
  }
  var DAY_SNAPS = {};
  var lastSyncAt = 0;
  var dataSource = "live";
  var persistTimer = 0;
  function isOnline() {
    try {
      if (root.QberriesApi && root.QberriesApi.online) return root.QberriesApi.online();
      if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
    } catch (err) {}
    return true;
  }
  function stampTime(ms) {
    if (!ms) return "";
    try {
      var d = new Date(ms);
      if (isNaN(d.getTime())) return "";
      var dd = String(d.getDate()).padStart(2, "0");
      var mm = String(d.getMonth() + 1).padStart(2, "0");
      var yy = d.getFullYear();
      var hh = String(d.getHours()).padStart(2, "0");
      var mi = String(d.getMinutes()).padStart(2, "0");
      return dd + "/" + mm + "/" + yy + " " + hh + ":" + mi;
    } catch (err) {
      return "";
    }
  }
  function setDataStamp() {
    var el = document.getElementById("data-stamp");
    if (!el) return;
    var label = stampTime(lastSyncAt);
    if (!label || dataSource === "live") {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = "Última actualización: " + label;
  }
  function daySnapFromAll(date) {
    var t = totals(ALL, date);
    var ySups = bySupervisor(ALL, date)
      .slice()
      .sort(function (a, b) {
        return b.extras - a.extras || b.meals - a.meals;
      });
    var late = ySups.filter(function (s) {
      return s.extras > 0;
    })[0];
    var lastExtra = activeOn(ALL, date)
      .filter(function (r) {
        return r.extra;
      })
      .sort(function (a, b) {
        return b.time.localeCompare(a.time);
      })[0];
    return {
      prepared: t.prepared,
      extras: t.extras,
      regular: t.regular,
      cancelled: t.cancelled,
      comedores: t.comedores,
      late: late ? { supervisor: late.supervisor, extras: late.extras } : null,
      lastExtra: lastExtra ? { time: lastExtra.time, name: lastExtra.name } : null,
    };
  }
  function rememberDaySnap(date, snap) {
    if (!date || !snap) return;
    if (snap.prepared == null && snap.extras == null) return;
    DAY_SNAPS[date] = Object.assign({ date: date, at: Date.now() }, snap);
  }
  function flushPersist() {
    var store = root.QberriesStore;
    if (!store || !ALL.length) return;
    lastSyncAt = lastSyncAt || Date.now();
    store.saveReservations({ at: lastSyncAt, date: TODAY, rows: ALL });
    var todaySnap = daySnapFromAll(TODAY);
    if (todaySnap.prepared || todaySnap.extras || todaySnap.regular || !DAY_SNAPS[TODAY]) {
      store.saveDaySnap(TODAY, todaySnap);
    }
    var y = addDays(TODAY, -1);
    var ySnap = daySnapFromAll(y);
    if (ySnap.prepared || ySnap.extras || ySnap.regular) store.saveDaySnap(y, ySnap);
    store.saveMeta({ at: lastSyncAt, date: TODAY, source: dataSource });
  }
  function schedulePersist() {
    root.clearTimeout(persistTimer);
    persistTimer = root.setTimeout(flushPersist, 400);
  }
  var apiBusy = false;
  var teamBusy = false;
  var pendingPaint = false;
  var pollTimer = 0;
  var clockTimer = 0;
  var pollFails = 0;
  var verifyQ = "";
  var toastTimer = 0;
  function uiBusy() {
    try {
      var box = document.getElementById("swal");
      if (box && !box.hidden) return true;
      var pick = document.getElementById("reserva-sup-pick");
      if (pick && pick.classList.contains("open")) return true;
      if (document.querySelector(".team-pick.open")) return true;
      var ae = document.activeElement;
      if (!ae) return false;
      if (ae.id === "verify-q" || ae.id === "reserva-dni" || ae.id === "team-q") return true;
      if (ae.closest && (ae.closest("#team-add") || ae.closest("#team-dest"))) return true;
    } catch (err) {}
    return false;
  }
  function requestPaint() {
    if (uiBusy()) {
      pendingPaint = true;
      return;
    }
    pendingPaint = false;
    paint();
  }
  function flushPaint() {
    if (!pendingPaint) return;
    requestPaint();
  }
  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.add("show");
    root.clearTimeout(toastTimer);
    toastTimer = root.setTimeout(function () {
      el.classList.remove("show");
      el.hidden = true;
    }, 2600);
  }
  function setApiBar(state, text) {
    var bar = document.getElementById("api-bar");
    var label = document.getElementById("api-bar-text");
    if (!bar || !label) return;
    if (!CONFIG.apiUrl || state === "hidden" || state === "ok") {
      bar.hidden = true;
      bar.className = "api-bar";
      return;
    }
    bar.hidden = false;
    bar.className = "api-bar is-" + state;
    label.textContent = text || "";
  }
  function pullApi(opts) {
    opts = opts || {};
    if (!CONFIG.apiUrl || !root.QberriesApi) return Promise.resolve(false);
    if (apiBusy) return Promise.resolve(false);
    if (!isOnline()) {
      dataSource = ALL.length ? "cache" : dataSource;
      setDataStamp();
      return Promise.resolve(false);
    }
    apiBusy = true;
    var silent = !!opts.silent;
    if (!silent && !ALL.length) setApiBar("loading", "Cargando reservas…");
    return root.QberriesApi.getReservations({
      fresh: true,
      timeout: silent ? 8000 : CONFIG.timeoutMs,
    })
      .then(function (pack) {
        var rows = Array.isArray(pack) ? pack : pack && pack.rows;
        var trusted = Array.isArray(pack) || !!(pack && pack.trusted);
        if (!Array.isArray(rows)) throw { status: 422, message: "Los datos recibidos no se pudieron usar." };
        if (silent && teamBusy) {
          pollFails = 0;
          setApiBar("ok");
          return false;
        }
        if (!rows.length && ALL.length && !trusted) return false;
        pollFails = 0;
        var changed = applyRows(rows, { render: true, allowEmpty: trusted && !rows.length });
        lastSyncAt = Date.now();
        dataSource = "live";
        setApiBar("ok");
        setDataStamp();
        return changed;
      })
      .catch(function (err) {
        pollFails += 1;
        if (ALL.length || DAY_SNAPS[TODAY] || DAY_SNAPS[addDays(TODAY, -1)]) {
          dataSource = "stale";
          setDataStamp();
          if (!silent && pollFails >= 2) {
            setApiBar(
              "error",
              (err && err.offline ? "Sin conexión. Se muestran los datos guardados." : err && err.message) ||
                "No se pudo actualizar. Se muestran los datos guardados."
            );
          } else {
            setApiBar("hidden");
          }
          return false;
        }
        if (!silent || pollFails >= 3) {
          setApiBar("error", (err && err.message) || "No se pudo cargar la información. Intente nuevamente.");
        }
        return false;
      })
      .finally(function () {
        apiBusy = false;
      });
  }
  function showSync(state, title, text) {
    var box = document.getElementById("sync");
    var h = document.getElementById("sync-title");
    var p = document.getElementById("sync-text");
    if (!box || !h || !p) return;
    box.hidden = false;
    box.className = "sync open" + (state === "ok" ? " is-ok" : state === "err" ? " is-err" : "");
    h.textContent = title || "Revisando datos";
    p.textContent = text || "Consultando la lista de hoy y los extras.";
  }
  function hideSync() {
    var box = document.getElementById("sync");
    if (!box) return;
    box.hidden = true;
    box.className = "sync";
  }
  function waitApiFree() {
    if (!apiBusy) return Promise.resolve();
    return new Promise(function (resolve) {
      var n = 0;
      var t = root.setInterval(function () {
        n += 1;
        if (!apiBusy || n > 30) {
          root.clearInterval(t);
          resolve();
        }
      }, 150);
    });
  }
  var refreshBusy = false;
  var syncTimer = 0;
  function refreshNow() {
    if (refreshBusy) return;
    var btn = document.getElementById("refresh-btn");
    refreshBusy = true;
    if (btn) {
      btn.disabled = true;
      btn.classList.add("is-spin");
    }
    closeNotices();
    showSync("loading", "Revisando datos", "Estamos trayendo la lista de hoy y los extras.");
    var finished = false;
    function finishOk() {
      if (finished) return;
      finished = true;
      var stats = totals(ALL, TODAY);
      var extras = extrasToday().length;
      showSync(
        "ok",
        dataSource === "live" ? "Datos al día" : "Datos guardados",
        stats.regular + " en lista  ·  " + extras + (extras === 1 ? " extra" : " extras") + "  ·  " + stats.prepared + " total"
      );
      toast(dataSource === "live" ? "Datos actualizados." : "Se muestran los datos guardados.");
      logMove("Actualizó los datos del día.");
      root.clearTimeout(syncTimer);
      syncTimer = root.setTimeout(hideSync, 1600);
    }
    root.clearTimeout(syncTimer);
    syncTimer = root.setTimeout(function () {
      if (refreshBusy) finishOk();
    }, 12000);
    waitApiFree()
      .then(function () {
        return pullCatalog();
      })
      .then(function () {
        return pullApi({ silent: true, fresh: true });
      })
      .then(function () {
        finishOk();
      })
      .catch(function () {
        if (ALL.length || DAY_SNAPS[TODAY]) finishOk();
        else {
          showSync("err", "No se pudo actualizar", "Intente nuevamente en un momento.");
          root.clearTimeout(syncTimer);
          syncTimer = root.setTimeout(hideSync, 2200);
        }
      })
      .finally(function () {
        refreshBusy = false;
        if (btn) {
          btn.disabled = false;
          btn.classList.remove("is-spin");
        }
      });
  }
  function pullCatalog() {
    if (!CONFIG.apiUrl || !root.QberriesApi) return Promise.resolve();
    var api = root.QberriesApi;
    var sups = api.getSupervisors ? api.getSupervisors() : Promise.resolve([]);
    var opts = api.getOpciones
      ? api.getOpciones()
      : api.getComedores
        ? api.getComedores().then(function (c) {
            return { comedores: c || [], fundos: [] };
          })
        : Promise.resolve({ comedores: [], fundos: [] });
    return Promise.all([sups, opts])
      .then(function (parts) {
        var nextSups = parts[0] || [];
        var nextHalls = (parts[1] && parts[1].comedores) || [];
        var nextFundos = (parts[1] && parts[1].fundos) || [];
        if (nextSups.length) CATALOG_SUPS = nextSups;
        if (nextHalls.length) CATALOG_HALLS = nextHalls;
        if (nextFundos.length) CATALOG_FUNDOS = nextFundos;
        if (nextSups.length || nextHalls.length || nextFundos.length) {
          if (root.QberriesStore) {
            root.QberriesStore.saveCatalog({
              supervisores: CATALOG_SUPS,
              comedores: CATALOG_HALLS,
              fundos: CATALOG_FUNDOS,
            });
          }
        }
        var modal = document.getElementById("team-modal");
        if (modal && modal.classList.contains("open") && !document.querySelector(".team-pick.open")) {
          var hallEl = document.getElementById("team-comedor");
          var fundoEl = document.getElementById("team-fundo");
          fillTeamDest(hallEl && hallEl.value, fundoEl && fundoEl.value);
        }
      })
      .catch(function () {});
  }
  function hydrateLocal() {
    var store = root.QberriesStore;
    if (!store) return Promise.resolve(false);
    var y = addDays(TODAY, -1);
    return Promise.all([store.getReservations(), store.getCatalog(), store.getDaySnap(TODAY), store.getDaySnap(y), store.getMeta()])
      .then(function (parts) {
      var pack = parts[0];
      var cat = parts[1];
      var todaySnap = parts[2];
      var ySnap = parts[3];
      var meta = parts[4];
      if (todaySnap) rememberDaySnap(TODAY, todaySnap);
      if (ySnap) rememberDaySnap(y, ySnap);
      if (cat) {
        if (Array.isArray(cat.supervisores) && cat.supervisores.length) CATALOG_SUPS = cat.supervisores;
        if (Array.isArray(cat.comedores) && cat.comedores.length) CATALOG_HALLS = cat.comedores;
        if (Array.isArray(cat.fundos) && cat.fundos.length) CATALOG_FUNDOS = cat.fundos;
      }
      if (pack && Array.isArray(pack.rows) && pack.rows.length) {
        lastSyncAt = pack.at || (meta && meta.at) || Date.now();
        dataSource = "cache";
        applyRows(pack.rows, { render: false, fromCache: true });
        return true;
      }
      if (meta && meta.at) lastSyncAt = meta.at;
      return !!(todaySnap || ySnap);
    }).catch(function () {
      return false;
    });
  }
  function liveTick() {
    try {
      var now = todayKey();
      if (now !== TODAY) {
        TODAY = now;
        stamp = "";
        viewMemo = { stamp: "", map: {} };
        clearNoticeSeen();
        requestPaint();
      }
      if (!CONFIG.apiUrl) return Promise.resolve(false);
      if (typeof document !== "undefined" && document.hidden) return Promise.resolve(false);
      if (!isOnline()) return Promise.resolve(false);
      return pullApi({ silent: true, fresh: true });
    } catch (err) {
      return Promise.resolve(false);
    }
  }
  function armPoll() {
    root.clearTimeout(pollTimer);
    pollTimer = root.setTimeout(function () {
      Promise.resolve(liveTick()).then(armPoll, armPoll);
    }, pollFails ? Math.min(60000, (CONFIG.pollMs || 8000) * Math.pow(2, Math.min(pollFails, 3))) : CONFIG.pollMs || 8000);
  }
  function vsAyer(today, ayer, unit) {
    var d = today - ayer;
    var base = "Ayer " + ayer + (unit ? " " + unit : "");
    if (d > 0) return base + " · +" + d;
    if (d < 0) return base + " · " + d;
    return base + " · igual";
  }
  function yesterdayNotes() {
    var y = addDays(TODAY, -1);
    var yStats = totals(ALL, y);
    var ySups = bySupervisor(ALL, y).slice().sort(function (a, b) {
      return b.extras - a.extras || b.meals - a.meals;
    });
    var late = ySups.filter(function (s) {
      return s.extras > 0;
    })[0];
    var lastExtra = activeOn(ALL, y)
      .filter(function (r) {
        return r.extra;
      })
      .sort(function (a, b) {
        return b.time.localeCompare(a.time);
      })[0];
    var snap = DAY_SNAPS[y];
    if (snap && !yStats.prepared && !yStats.extras && !yStats.regular) {
      yStats = {
        prepared: Number(snap.prepared) || 0,
        extras: Number(snap.extras) || 0,
        regular: Number(snap.regular) || 0,
        cancelled: Number(snap.cancelled) || 0,
        comedores: Number(snap.comedores) || 0,
      };
      if (!late && snap.late) late = snap.late;
      if (!lastExtra && snap.lastExtra) lastExtra = snap.lastExtra;
    }
    return { stats: yStats, late: late, lastExtra: lastExtra };
  }
  function shortSupervisor(name) {
    return String(name || "")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .join(" ");
  }
  function filterSupervisors(list, query) {
    var q = fold(query);
    if (!q) return list;
    return list.filter(function (s) {
      return fold(s.supervisor).indexOf(q) !== -1;
    });
  }

  if (CONFIG.apiUrl) ALL = [];
  else applyRows(generate());

  function emptyState(text) {
    return '<p class="empty">' + esc(text) + "</p>";
  }
  function workerTodayLabel(row) {
    if (row.status === "none") return { text: "Sin pedido", cls: "neutral" };
    if (row.status === "cancelled") return { text: "Cancelada", cls: "bad" };
    if (row.status === "pending") return { text: "Pendiente", cls: "info" };
    if (row.extra) return { text: "Extra", cls: "warn" };
    return { text: "Comida solicitada", cls: "ok" };
  }
  function filterTeam(list, query) {
    var raw = String(query || "").trim();
    return list
      .map(function (row) {
        var hit = matchWorkerPrecise(row, query);
        return { row: row, hit: hit };
      })
      .filter(function (item) {
        return item.hit.ok;
      })
      .sort(function (a, b) {
        if (!raw) return 0;
        return a.hit.rank - b.hit.rank || a.row.name.localeCompare(b.row.name, "es");
      })
      .map(function (item) {
        return item.row;
      });
  }
  function renderTeamRows(rows, query) {
    if (!rows.length) {
      return '<p class="team-empty">No hay trabajadores con ese DNI o nombre.</p>';
    }
    var q = String(query || "").trim();
    return rows
      .map(function (w) {
        var st = workerTodayLabel(w);
        var parts = personParts(w);
        var shown = parts.apellido || w.name;
        var sub = parts.nombres ? parts.nombres + " · " + w.dni : w.dni;
        var exact = q && String(w.dni) === q.replace(/\D/g, "");
        var onList = w.status !== "none" && w.status !== "cancelled";
        return (
          '<article class="team-row' +
          (exact ? " team-hit" : "") +
          '"><span class="avatar">' +
          esc(initials(shown)) +
          '</span><div class="who"><strong>' +
          esc(shown) +
          "</strong><small>" +
          esc(sub) +
          '</small></div><div class="team-meta"><span class="badge ' +
          st.cls +
          '">' +
          esc(st.text) +
          "</span><div class='team-actions'>" +
          (onList
            ? '<button type="button" class="team-act" data-drop-meal="' +
              esc(w.dni) +
              '" data-name="' +
              esc(parts.full || w.name) +
              '">Eliminar</button>'
            : '<button type="button" class="team-act team-act-ok" data-add-meal="' +
              esc(w.dni) +
              '">Agregar</button>') +
          "</div></div></article>"
        );
      })
      .join("");
  }
  var TEAM_PAGE_SIZE = 10;
  var teamPage = 1;
  var reservaDni = "";
  var reservaSup = "";
  var reservaPage = 1;
  var RESERVA_PAGE_SIZE = 25;
  function renderTeamPager(total, page) {
    var pager = document.getElementById("team-pager");
    if (!pager) return;
    var pages = Math.max(1, Math.ceil(total / TEAM_PAGE_SIZE));
    if (total <= TEAM_PAGE_SIZE) {
      pager.hidden = true;
      pager.innerHTML = "";
      return;
    }
    pager.hidden = false;
    var from = (page - 1) * TEAM_PAGE_SIZE + 1;
    var to = Math.min(page * TEAM_PAGE_SIZE, total);
    pager.innerHTML =
      '<button type="button" class="page-btn" data-team-page="' +
      (page - 1) +
      '" ' +
      (page <= 1 ? "disabled" : "") +
      ">Anterior</button><span>Mostrando " +
      from +
      "–" +
      to +
      " de " +
      total +
      '</span><button type="button" class="page-btn" data-team-page="' +
      (page + 1) +
      '" ' +
      (page >= pages ? "disabled" : "") +
      ">Siguiente</button>";
  }
  function paintTeamList(opts) {
    var title = document.getElementById("team-title");
    var count = document.getElementById("team-count");
    var list = document.getElementById("team-list");
    var search = document.getElementById("team-q");
    var modal = document.getElementById("team-modal");
    if (!title || !count || !list || !search || !modal) return;
    var supervisor = modal.getAttribute("data-supervisor") || "";
    var query = search.value;
    var team = workersOfSupervisor(supervisor);
    var visible = filterTeam(team, query);
    var pages = Math.max(1, Math.ceil(visible.length / TEAM_PAGE_SIZE));
    if (teamPage > pages) teamPage = pages;
    if (teamPage < 1) teamPage = 1;
    var start = (teamPage - 1) * TEAM_PAGE_SIZE;
    var pageRows = visible.slice(start, start + TEAM_PAGE_SIZE);
    var y = list.scrollTop;
    title.textContent = supervisor;
    count.textContent = query
      ? visible.length + " de " + team.length + " trabajadores"
      : team.length + " trabajadores";
    list.innerHTML = renderTeamRows(pageRows, query);
    renderTeamPager(visible.length, teamPage);
    list.scrollTop = opts && opts.keepScroll ? y : 0;
  }
  function openTeam(supervisor) {
    var modal = document.getElementById("team-modal");
    var search = document.getElementById("team-q");
    if (!modal || !search || !supervisor) return;
    modal.setAttribute("data-supervisor", supervisor);
    var duty = dutyOf(supervisor);
    if (duty.supervisor_id) modal.setAttribute("data-supervisor-id", duty.supervisor_id);
    else modal.removeAttribute("data-supervisor-id");
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
    search.value = "";
    teamPage = 1;
    fillTeamDest();
    paintTeamList();
    window.setTimeout(function () {
      search.focus();
    }, 20);
  }
  function closeTeam() {
    var modal = document.getElementById("team-modal");
    closeTeamPicks();
    if (modal) modal.classList.remove("open");
    document.body.style.overflow = "";
  }
  var swalDone = null;
  function closeSwal(ok) {
    var box = document.getElementById("swal");
    if (box) {
      box.hidden = true;
      box.classList.remove("open");
    }
    document.body.classList.remove("swal-on");
    if (swalDone) {
      var done = swalDone;
      swalDone = null;
      done(!!ok);
    }
    root.setTimeout(flushPaint, 0);
  }
  function askTop(opts) {
    if (swalDone) closeSwal(false);
    var box = document.getElementById("swal");
    var title = document.getElementById("swal-title");
    var text = document.getElementById("swal-text");
    var okBtn = document.getElementById("swal-ok");
    var cancelBtn = document.getElementById("swal-cancel");
    if (!box || !title || !text || !okBtn || !cancelBtn) {
      return Promise.resolve(!!window.confirm(opts.text || opts.title));
    }
    title.textContent = opts.title || "";
    text.textContent = opts.text || "";
    okBtn.textContent = opts.ok || "Aceptar";
    cancelBtn.textContent = opts.cancel || "Cancelar";
    cancelBtn.hidden = !!opts.hideCancel;
    box.hidden = false;
    box.classList.add("open");
    document.body.classList.add("swal-on");
    return new Promise(function (resolve) {
      swalDone = resolve;
    });
  }

  var ICONS = {
    dashboard: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18"/><path d="M6 12h12"/><path d="M6 16h12"/><path d="M10 6h.01"/><path d="M14 6h.01"/><path d="M10 10h.01"/><path d="M14 10h.01"/><path d="M2 22h20"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
    hat: '<path d="M6 13a6 6 0 0 1 12 0"/><path d="M4 13h16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 21h8"/><path d="M12 7V5"/>',
    utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
    pot: '<path d="M2 12h20"/><path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8"/><path d="M4 8h16"/><path d="M7 8V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"/>',
    list: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M8 12h8M8 16h6"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m7.8 7.8 2.1 2.1M14.1 14.1l2.1 2.1M16.2 7.8l-2.1 2.1M9.9 14.1l-2.1 2.1"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
    cloche: '<path d="M4 18h16"/><path d="M5 18a7 7 0 0 1 14 0"/><path d="M12 6v2"/><path d="M10 6h4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
  };
  function icon(name) {
    return (
      '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONS[name] || ICONS.utensils) +
      "</svg>"
    );
  }
  function cartRow(ico, label, value, extraClass) {
    return (
      '<div class="cart-row' +
      (extraClass ? " " + extraClass : "") +
      '"><span class="cart-ico">' +
      icon(ico) +
      "</span><span>" +
      esc(label) +
      "</span><b>" +
      value +
      "</b></div>"
    );
  }

  function navHtml(current) {
    var items = [
      ["/dashboard", "Dashboard", "dashboard"],
      ["/supervisores", "Supervisores", "users"],
      ["/comedores", "Comedores", "building"],
      ["/reservas", "Reservas de hoy", "calendar"],
      ["/cocina", "Modo cocina", "hat"],
    ];
    return (
      '<p class="nav-label">Menú</p>' +
      items
        .map(function (it) {
          return (
            '<a href="#' +
            it[0] +
            '" class="' +
            (current === it[0] ? "on" : "") +
            '">' +
            icon(it[2]) +
            esc(it[1]) +
            "</a>"
          );
        })
        .join("")
    );
  }

  function kpi(label, value, hint, tone, key, ico, extraClass) {
    var waiting = CONFIG.apiUrl && !ALL.length && !DAY_SNAPS[addDays(TODAY, -1)] && !DAY_SNAPS[TODAY];
    return (
      '<article class="card kpi' +
      (extraClass ? " " + extraClass : "") +
      (waiting ? " kpi-wait" : "") +
      '" data-kpi="' +
      esc(key) +
      '"><div class="kpi-top"><span>' +
      esc(label) +
      '</span><div class="bubble ' +
      tone +
      '">' +
      icon(ico || "utensils") +
      "</div></div><b>" +
      (waiting ? '<span class="skel" aria-hidden="true"></span>' : value) +
      "</b><small>" +
      esc(hint) +
      "</small></article>"
    );
  }

  function supervisorTable(rows, stats, coms) {
    if (!rows.length) return emptyState("No hay supervisores con ese criterio.");
    return (
      '<div class="table-wrap"><table class="admin-table verify-table"><thead><tr><th>Supervisor</th><th>Lista</th><th>Extras</th><th>Comedor</th><th>Total</th></tr></thead><tbody>' +
      rows
        .map(function (s) {
          var destText = destLabel(s);
          return (
            "<tr data-search='" +
            esc(fold(s.supervisor + " " + destText)) +
            "'><td><div class='who'><span class='avatar'>" +
            esc(initials(s.supervisor)) +
            "</span><span>" +
            esc(s.supervisor) +
            "</span><button type='button' class='plus plus-sm' data-open-team='" +
            esc(s.supervisor) +
            "' aria-label='Ver trabajadores de " +
            esc(s.supervisor) +
            "'>+</button></div></td><td>" +
            s.regular +
            "</td><td data-extras='" +
            s.extras +
            "'>" +
            (s.extras ? "<span class='badge warn'>" + s.extras + " extra" + (s.extras === 1 ? "" : "s") + "</span>" : "<span class='muted'>Sin extras</span>") +
            "</td><td>" +
            esc(destText) +
            "</td><td class='num-strong'>" +
            s.meals +
            "</td></tr>"
          );
        })
        .join("") +
      '</tbody><tfoot><tr class="foot"><td>Total</td><td>' +
      stats.regular +
      "</td><td>" +
      stats.extras +
      "</td><td class='muted'>" +
      (coms || []).length +
      " comedores" +
      "</td><td>" +
      stats.prepared +
      "</td></tr></tfoot></table></div>"
    );
  }
  function exportButtonsHtml(scope) {
    return (
      '<div class="export-btns">' +
      '<button type="button" class="tool-btn export-btn" data-export="excel" data-scope="' +
      esc(scope) +
      '">Excel</button>' +
      '<button type="button" class="tool-btn tool-btn-dark export-btn" data-export="pdf" data-scope="' +
      esc(scope) +
      '">PDF</button>' +
      "</div>"
    );
  }
  function verifyToolbar() {
    return (
      '<div class="verify-head"><div><h2>Verificación</h2><p class="reserva-count">Listado formal por supervisor</p></div><div class="verify-tools">' +
      '<label class="verify-search"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
      '<input id="verify-q" type="search" placeholder="Buscar supervisor o comedor…" autocomplete="off" /></label>' +
      exportButtonsHtml("verify") +
      "</div></div>"
    );
  }
  function visibleVerifyRows() {
    var table = document.querySelector(".verify-table");
    if (!table) return [];
    return Array.prototype.slice.call(table.querySelectorAll("tbody tr")).filter(function (tr) {
      return tr.style.display !== "none";
    });
  }
  function fundoMark(raw) {
    var text = String(raw || "").replace(/\s+/g, " ").trim();
    var rest = text.replace(/^licapa\s+/i, "").trim();
    if (!rest) return "";
    if (/^[ivxlcdm]+$/i.test(rest)) return rest.toUpperCase();
    var n = parseInt(rest, 10);
    var romans = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
    if (String(n) === rest && n > 0 && n < romans.length) return romans[n];
    return rest;
  }
  function fundoRank(mark) {
    var order = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
    return order[String(mark || "").toUpperCase()] || 100;
  }
  function splitComedorLabel(label) {
    var raw = String(label || "").trim();
    var bits = raw.split(/\s*[·•]\s*/);
    var hall = (bits[0] || "").trim();
    var fundo = fundoMark(bits.slice(1).join(" · "));
    var numbered = hall.match(/^comedor\s+(\d+)$/i);
    if (numbered) {
      return { comedor: Number(numbered[1]), fundo: fundo, rank: Number(numbered[1]), nameKey: "" };
    }
    return { comedor: hall, fundo: fundo, rank: 100000, nameKey: fold(hall) };
  }
  function verifyExportRows() {
    var rows = visibleVerifyRows().map(function (tr) {
      var cells = tr.querySelectorAll("td");
      var name = (tr.querySelector(".who span:not(.avatar)") || {}).textContent || "";
      var parts = splitComedorLabel((cells[3] && cells[3].textContent.trim()) || "");
      return {
        supervisor: name.trim(),
        comidas: (cells[1] && cells[1].textContent.trim()) || "0",
        extras: tr.querySelector("[data-extras]") ? tr.querySelector("[data-extras]").getAttribute("data-extras") : "0",
        comedor: parts.comedor,
        fundo: parts.fundo,
        total: (cells[4] && cells[4].textContent.trim()) || "0",
        _rank: parts.rank,
        _nameKey: parts.nameKey,
        _fundoRank: fundoRank(parts.fundo),
      };
    });
    rows.sort(function (a, b) {
      if (a._rank !== b._rank) return a._rank - b._rank;
      var byName = String(a._nameKey).localeCompare(String(b._nameKey), "es");
      if (byName) return byName;
      if (a._fundoRank !== b._fundoRank) return a._fundoRank - b._fundoRank;
      return (Number(b.total) || 0) - (Number(a.total) || 0) || String(a.supervisor).localeCompare(String(b.supervisor), "es");
    });
    return rows;
  }
  function downloadFile(name, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || "application/octet-stream" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 500);
  }
  function exportMeta() {
    return {
      title: "Qberries · Verificación de almuerzos",
      subtitle: longDate(TODAY) + "  ·  Listado por supervisor y cantidades",
      sheet: "Verificación",
      columns: [
        { key: "supervisor", label: "Supervisor", align: "left", width: 38 },
        { key: "comidas", label: "Lista", align: "center", width: 12, num: true },
        { key: "extras", label: "Extras", align: "center", width: 12, num: true },
        { key: "comedor", label: "Comedor", align: "center", width: 22 },
        { key: "fundo", label: "Fundo", align: "center", width: 12 },
        { key: "total", label: "Total", align: "center", width: 12, num: true },
      ],
      footer: (function () {
        var rows = verifyExportRows();
        var comidas = 0;
        var extras = 0;
        var total = 0;
        var comedores = {};
        rows.forEach(function (r) {
          comidas += Number(r.comidas) || 0;
          extras += Number(r.extras) || 0;
          total += Number(r.total) || 0;
          var hall = r.comedor == null ? "" : String(r.comedor).trim();
          if (hall) comedores[hall] = true;
        });
        return {
          supervisor: "Total",
          comidas: comidas,
          extras: extras,
          comedor: Object.keys(comedores).length + " comedores",
          fundo: "",
          total: total,
        };
      })(),
    };
  }
  function comedorExportRows() {
    return byComedor(ALL, TODAY).map(function (c) {
      return {
        comedor: c.name,
        lista: c.regular,
        extras: c.extras,
        total: c.meals,
        supervisores: c.supervisors.length,
      };
    });
  }
  function comedorExportMeta(rows) {
    var lista = 0;
    var extras = 0;
    var total = 0;
    var supervisores = 0;
    rows.forEach(function (r) {
      lista += Number(r.lista) || 0;
      extras += Number(r.extras) || 0;
      total += Number(r.total) || 0;
      supervisores += Number(r.supervisores) || 0;
    });
    return {
      title: "Qberries · Comedores",
      subtitle: longDate(TODAY) + "  ·  Envíos por comedor",
      sheet: "Comedores",
      columns: [
        { key: "comedor", label: "Comedor", align: "left", width: 28 },
        { key: "lista", label: "Lista", align: "center", width: 12, num: true },
        { key: "extras", label: "Extras", align: "center", width: 12, num: true },
        { key: "total", label: "Total", align: "center", width: 12, num: true },
        { key: "supervisores", label: "Supervisores", align: "center", width: 14, num: true },
      ],
      footer: {
        comedor: "Total",
        lista: lista,
        extras: extras,
        total: total,
        supervisores: supervisores,
      },
    };
  }
  function reservaExportRows() {
    return filteredReservas().map(function (r) {
      var parts = personParts(r);
      var st = statusLabel(r);
      return {
        dni: r.dni,
        trabajador: parts.full || r.name,
        hora: r.time || "",
        supervisor: r.supervisor || "",
        comedor: r.sede || "",
        tipo: st.text || "",
      };
    });
  }
  function reservaExportMeta(rows) {
    return {
      title: "Qberries · Reservas de hoy",
      subtitle: longDate(TODAY) + "  ·  " + rows.length + (rows.length === 1 ? " reserva" : " reservas"),
      sheet: "Reservas",
      columns: [
        { key: "dni", label: "DNI", align: "center", width: 12 },
        { key: "trabajador", label: "Trabajador", align: "left", width: 34, clip: 42 },
        { key: "hora", label: "Hora", align: "center", width: 10 },
        { key: "supervisor", label: "Supervisor", align: "left", width: 28, clip: 36 },
        { key: "comedor", label: "Comedor", align: "left", width: 18 },
        { key: "tipo", label: "Tipo", align: "center", width: 12 },
      ],
      footer: {
        dni: "Total",
        trabajador: rows.length + (rows.length === 1 ? " reserva" : " reservas"),
        hora: "",
        supervisor: "",
        comedor: "",
        tipo: "",
      },
    };
  }
  var exportBusy = false;
  function runExport(kind, rows, meta, fileBase) {
    if (exportBusy) return;
    if (!rows.length || !root.QberriesReport) {
      toast("No hay filas para exportar.");
      return;
    }
    exportBusy = true;
    var blob =
      kind === "pdf"
        ? root.QberriesReport.pdf(rows, meta)
        : root.QberriesReport.xlsx(rows, meta);
    var ext = kind === "pdf" ? ".pdf" : ".xlsx";
    var mime =
      kind === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    downloadFile(fileBase + "_" + TODAY + ext, blob, mime);
    toast(kind === "pdf" ? "PDF descargado." : "Excel descargado.");
    logMove("Descargó el " + (kind === "pdf" ? "PDF" : "Excel") + " de " + exportOrigin(meta && meta.exportScope) + ".");
    root.setTimeout(function () {
      exportBusy = false;
    }, 400);
  }
  function exportOrigin(scope) {
    var route = parseRoute(location.hash);
    var tabs = {
      "/dashboard": "Dashboard",
      "/supervisores": "Supervisores",
      "/comedores": "Comedores",
      "/reservas": "Reservas",
      "/cocina": "Cocina",
    };
    var tab = tabs[route] || "";
    var file = scope === "comedores" ? "Comedores" : scope === "reservas" ? "Reservas" : "Supervisores";
    if (tab && fold(tab) !== fold(file)) return file + ", pestaña " + tab;
    return file;
  }
  function withExportScope(meta, scope) {
    var next = {};
    var key;
    for (key in meta) if (Object.prototype.hasOwnProperty.call(meta, key)) next[key] = meta[key];
    next.exportScope = scope || "verify";
    return next;
  }
  function exportVerifyExcel() {
    runExport("excel", verifyExportRows(), withExportScope(exportMeta(), "verify"), "Qberries_Verificacion");
  }
  function exportVerifyPdf() {
    runExport("pdf", verifyExportRows(), withExportScope(exportMeta(), "verify"), "Qberries_Verificacion");
  }
  function exportByScope(kind, scope) {
    if (scope === "comedores") {
      var cRows = comedorExportRows();
      runExport(kind, cRows, withExportScope(comedorExportMeta(cRows), "comedores"), "Qberries_Comedores");
      return;
    }
    if (scope === "reservas") {
      var rRows = reservaExportRows();
      runExport(kind, rRows, withExportScope(reservaExportMeta(rRows), "reservas"), "Qberries_Reservas");
      return;
    }
    if (kind === "pdf") exportVerifyPdf();
    else exportVerifyExcel();
  }
  function filterVerifyTable(query) {
    var table = document.querySelector(".verify-table");
    if (!table) return;
    var q = fold(query);
    var rows = table.querySelectorAll("tbody tr");
    var shown = 0;
    Array.prototype.forEach.call(rows, function (tr) {
      var ok = !q || (tr.getAttribute("data-search") || "").indexOf(q) !== -1;
      tr.style.display = ok ? "" : "none";
      if (ok) shown += 1;
    });
    var empty = table.parentNode.querySelector(".verify-empty");
    if (!shown) {
      if (!empty) {
        empty = document.createElement("p");
        empty.className = "empty verify-empty";
        empty.textContent = "No hay supervisores con ese criterio.";
        table.parentNode.appendChild(empty);
      }
      table.style.display = "none";
    } else {
      table.style.display = "";
      if (empty) empty.remove();
    }
  }

  function cardsByArrival(list) {
    return (list || []).slice().sort(function (a, b) {
      var ta = a.lastTime || "";
      var tb = b.lastTime || "";
      if (!ta && !tb) return b.meals - a.meals || a.supervisor.localeCompare(b.supervisor, "es");
      if (!ta) return 1;
      if (!tb) return -1;
      if (ta !== tb) return tb.localeCompare(ta);
      return b.meals - a.meals || a.supervisor.localeCompare(b.supervisor, "es");
    });
  }
  function renderDashboard(q) {
    var stats = totals(ALL, TODAY);
    var sups = filterSupervisors(bySupervisor(ALL, TODAY), q);
    var visibleStats = {
      regular: sups.reduce(function (a, b) { return a + b.regular; }, 0),
      extras: sups.reduce(function (a, b) { return a + b.extras; }, 0),
      prepared: sups.reduce(function (a, b) { return a + b.meals; }, 0),
    };
    var memory = yesterdayNotes();
    var lateHint = memory.late
      ? shortSupervisor(memory.late.supervisor) +
        " envió tarde" +
        (memory.lastExtra ? " · " + memory.lastExtra.time : "")
      : "Ayer nadie envió tarde";
    var coms = byComedor(ALL, TODAY);
    var footerComs = q ? comedoresFromSupervisors(sups) : coms;
    return (
      '<div class="layout"><div class="col">' +
      '<section class="hero"><div><p>' +
      esc(longDate(TODAY)) +
      "</p><h1>Solicitudes de almuerzo de hoy</h1><p>Aquí se ve cuántas comidas pidió cada supervisor, si hay extras y a qué comedor se envían.</p><div class=\"hero-actions\"><a class=\"btn btn-light\" href=\"#/supervisores\">Ver supervisores</a><a class=\"btn btn-ghost\" href=\"#/cocina\">Ver cocina</a></div></div><img class=\"hero-chef\" src=\"entrada.png\" alt=\"Chef Qberries\" width=\"280\" height=\"230\" loading=\"lazy\" decoding=\"async\"></section>" +
      '<div class="kpis">' +
      kpi("Menús ayer", memory.stats.prepared, "A cocina el día anterior", "tl", "yesterday-meals", "hat") +
      kpi(
        "Cuidado",
        memory.late ? memory.late.extras : 0,
        lateHint,
        "or",
        "yesterday-late",
        "spark",
        memory.late ? "kpi-care" : ""
      ) +
      kpi("Extras ayer", memory.stats.extras, "Fuera de horario ayer", "bl", "yesterday-extras", "list") +
      "</div></div>" +
      '<aside class="rail"><section class="summary"><div class="chef-orb"><img src="comida1.png" alt="Almuerzo Qberries" width="160" height="160" loading="lazy" decoding="async"></div><h2>Resumen del día</h2>' +
      cartRow("list", "Lista", stats.regular) +
      cartRow("spark", "Extra", stats.extras) +
      '<div class="total-line"><span>' +
      icon("hat") +
      " Total</span><strong data-kpi=\"prepared\">" +
      stats.prepared +
      "</strong></div>" +
      cartRow("building", "Comedores activos hoy", stats.comedores, "cart-note") +
      '<a class="btn-block" href="#/cocina">' +
      icon("hat") +
      " Verificar en cocina</a></section></aside>" +
      '<div class="full"><div class="section-head"><h2>Comidas por supervisor</h2><a href="#/supervisores" class="link">Ver todos</a></div>' +
      '<div class="sup-grid">' +
      (sups.length
        ? cardsByArrival(sups).slice(0, 8)
            .map(function (s) {
              var destText = destLabel(s);
              return (
                '<article class="card sup-card"><div class="split"><h3>' +
                esc(s.supervisor) +
                '</h3><button type="button" class="plus" data-open-team="' +
                esc(s.supervisor) +
                '" aria-label="Ver trabajadores de ' +
                esc(s.supervisor) +
                '">+</button></div><div class="qty">' +
                s.meals +
                '</div><p class="muted">Lista ' +
                s.regular +
                (s.extras ? " · " + s.extras + " extras" : " · sin extras") +
                "</p><p class=\"muted\">" +
                esc(destText || "Sin comedor") +
                "</p></article>"
              );
            })
            .join("")
        : emptyState("No hay supervisores con ese criterio.")) +
      "</div>" +
      '<section class="card verify">' +
      verifyToolbar() +
      supervisorTable(sups, visibleStats, footerComs) +
      "</section></div></div>"
    );
  }

  function renderSupervisores(q) {
    var rows = filterSupervisors(bySupervisor(ALL, TODAY), q);
    var stats = {
      prepared: rows.reduce(function (a, b) { return a + b.meals; }, 0),
      extras: rows.reduce(function (a, b) { return a + b.extras; }, 0),
      regular: rows.reduce(function (a, b) { return a + b.regular; }, 0),
    };
    return (
      '<header class="page-head"><p class="kicker">Administración</p><h1 class="h1">Supervisores</h1><p class="sub">Cuántas comidas pidió cada uno, si hay extras y a qué comedor se envían.</p></header>' +
      '<div class="grid3"><article class="card mini"><span>Supervisores</span><b>' +
      rows.length +
      '</b></article><article class="card mini mini-meals"><span>Comidas a preparar</span><b>' +
      stats.prepared +
      '</b></article><article class="card mini mini-extras"><span>Extras</span><b>' +
      stats.extras +
      "</b></article></div>" +
      '<section class="card verify">' +
      verifyToolbar() +
      supervisorTable(rows, stats, comedoresFromSupervisors(rows)) +
      "</section>"
    );
  }

  function renderComedores() {
    var rows = byComedor(ALL, TODAY);
    var total = rows.reduce(function (a, b) { return a + b.meals; }, 0);
    var extras = rows.reduce(function (a, b) { return a + b.extras; }, 0);
    var lista = rows.reduce(function (a, b) { return a + b.regular; }, 0);
    var table = rows.length
      ? '<div class="table-wrap"><table class="admin-table comedor-table"><thead><tr><th>Comedor</th><th>Lista</th><th>Extras</th><th>Total</th><th>Supervisores</th></tr></thead><tbody>' +
        rows
          .map(function (c) {
            return (
              "<tr><td><strong>" +
              esc(c.name) +
              "</strong></td><td>" +
              c.regular +
              "</td><td>" +
              (c.extras
                ? "<span class='badge warn'>" + c.extras + " extra" + (c.extras === 1 ? "" : "s") + "</span>"
                : "<span class='muted'>Sin extras</span>") +
              "</td><td class='num-strong'>" +
              c.meals +
              "</td><td>" +
              c.supervisors.length +
              "</td></tr>"
            );
          })
          .join("") +
        '</tbody><tfoot><tr class="foot"><td>Total</td><td>' +
        lista +
        "</td><td>" +
        extras +
        "</td><td>" +
        total +
        "</td><td>" +
        rows.reduce(function (a, b) { return a + b.supervisors.length; }, 0) +
        "</td></tr></tfoot></table></div>"
      : emptyState("Hoy no hay comidas para enviar.");
    return (
      '<header class="page-head"><p class="kicker">Administración</p><h1 class="h1">Comedores</h1><p class="sub">A qué comedor se envían las comidas y cuántas extras lleva cada uno.</p></header>' +
      '<div class="grid3"><article class="card mini"><span>Comedores activos</span><b>' +
      rows.length +
      '</b></article><article class="card mini mini-meals"><span>Comidas a enviar</span><b>' +
      total +
      '</b></article><article class="card mini mini-extras"><span>Extras</span><b>' +
      extras +
      "</b></article></div>" +
      '<section class="card verify">' +
      '<div class="verify-head"><div><h2>Comedores</h2><p class="reserva-count">Listado formal por comedor</p></div><div class="verify-tools">' +
      exportButtonsHtml("comedores") +
      "</div></div>" +
      table +
      "</section>"
    );
  }

  function reservaSupLabel() {
    return reservaSup || "Todos los supervisores";
  }
  function reservaToolbar(total) {
    var sups = supervisorOptions();
    var options =
      '<button type="button" class="pick-opt' +
      (reservaSup ? "" : " on") +
      '" role="option" aria-selected="' +
      (reservaSup ? "false" : "true") +
      '" data-value=""><span>Todos los supervisores</span><small>' +
      sups.length +
      " en la lista</small></button>" +
      sups.map(function (name) {
        var on = reservaSup === name;
        return (
          '<button type="button" class="pick-opt' +
          (on ? " on" : "") +
          '" role="option" aria-selected="' +
          (on ? "true" : "false") +
          '" data-value="' +
          esc(name) +
          '"><span>' +
          esc(name) +
          "</span><small>" +
          esc(sedeOfSupervisor(name)) +
          "</small></button>"
        );
      }).join("");
    return (
      '<div class="verify-head"><div><h2>Reservas</h2><p class="reserva-count" id="reserva-count">' +
      total +
      (total === 1 ? " reserva" : " reservas") +
      '</p></div><div class="verify-tools">' +
      '<div class="pick" id="reserva-sup-pick">' +
      '<button type="button" class="pick-btn" id="reserva-sup-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="Filtrar por supervisor">' +
      '<span class="pick-label"><small>Supervisor</small><strong id="reserva-sup-text">' +
      esc(reservaSupLabel()) +
      "</strong></span>" +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg></button>' +
      '<div class="pick-menu" id="reserva-sup-menu" role="listbox" hidden>' +
      options +
      "</div></div>" +
      '<label class="verify-search"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
      '<input id="reserva-dni" type="search" inputmode="numeric" maxlength="8" placeholder="Buscar DNI…" autocomplete="off" value="' +
      esc(reservaDni) +
      '" /></label>' +
      exportButtonsHtml("reservas") +
      "</div></div>"
    );
  }
  function todayReservas() {
    return ALL.filter(function (r) {
      return r.date === TODAY;
    }).sort(function (a, b) {
      return String(b.time || "").localeCompare(String(a.time || ""));
    });
  }
  function filteredReservas() {
    return todayReservas().filter(function (r) {
      return (!reservaDni || String(r.dni).indexOf(reservaDni) !== -1) && (!reservaSup || r.supervisor === reservaSup);
    });
  }
  function reservaRowHtml(r) {
    var st = statusLabel(r);
    var parts = personParts(r);
    return (
      '<tr data-dni="' +
      esc(r.dni) +
      '" data-supervisor="' +
      esc(r.supervisor) +
      '"><td>' +
      esc(r.dni) +
      '</td><td><div class="person-name"><strong>' +
      esc(parts.apellido || r.name) +
      "</strong>" +
      (parts.nombres ? "<small>" + esc(parts.nombres) + "</small>" : "") +
      "</div></td><td>" +
      esc(r.time) +
      "</td><td>" +
      esc(r.supervisor) +
      "</td><td>" +
      esc(r.sede) +
      "</td><td><span class='badge " +
      st.cls +
      "'>" +
      st.text +
      "</span></td></tr>"
    );
  }
  function closeReservaPick() {
    var pick = document.getElementById("reserva-sup-pick");
    var btn = document.getElementById("reserva-sup-btn");
    var menu = document.getElementById("reserva-sup-menu");
    if (pick) pick.classList.remove("open");
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (menu) menu.hidden = true;
    root.setTimeout(flushPaint, 0);
  }
  function toggleReservaPick() {
    var pick = document.getElementById("reserva-sup-pick");
    var btn = document.getElementById("reserva-sup-btn");
    var menu = document.getElementById("reserva-sup-menu");
    if (!pick || !menu || !btn) return;
    var open = !pick.classList.contains("open");
    closeReservaPick();
    if (!open) return;
    pick.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    menu.hidden = false;
  }
  function setReservaSup(name) {
    reservaSup = name || "";
    var text = document.getElementById("reserva-sup-text");
    if (text) text.textContent = reservaSupLabel();
    var pick = document.getElementById("reserva-sup-pick");
    if (pick) {
      Array.prototype.forEach.call(pick.querySelectorAll(".pick-opt"), function (opt) {
        var on = (opt.getAttribute("data-value") || "") === reservaSup;
        opt.classList.toggle("on", on);
        opt.setAttribute("aria-selected", on ? "true" : "false");
      });
    }
    reservaPage = 1;
    closeReservaPick();
    filterReservasTable();
  }
  function filterReservasTable() {
    var body = document.getElementById("reserva-body");
    var table = document.querySelector(".reserva-table");
    if (!body || !table) return;
    var dniEl = document.getElementById("reserva-dni");
    if (dniEl) reservaDni = String(dniEl.value || "").replace(/\D/g, "");
    if (dniEl && dniEl.value !== reservaDni) dniEl.value = reservaDni;
    var allToday = todayReservas();
    var rows = filteredReservas();
    var pages = Math.max(1, Math.ceil(rows.length / RESERVA_PAGE_SIZE));
    if (reservaPage > pages) reservaPage = pages;
    if (reservaPage < 1) reservaPage = 1;
    var start = (reservaPage - 1) * RESERVA_PAGE_SIZE;
    var pageRows = rows.slice(start, start + RESERVA_PAGE_SIZE);
    body.innerHTML = pageRows.map(reservaRowHtml).join("");
    var count = document.getElementById("reserva-count");
    if (count) {
      count.textContent =
        rows.length === allToday.length
          ? allToday.length + (allToday.length === 1 ? " reserva" : " reservas")
          : rows.length + " de " + allToday.length;
    }
    var empty = table.parentNode.querySelector(".reserva-empty");
    if (!rows.length) {
      if (!empty) {
        empty = document.createElement("p");
        empty.className = "empty reserva-empty";
        empty.textContent = reservaDni || reservaSup
          ? "No hay reservas con ese supervisor o DNI."
          : "Hoy no hay reservas.";
        table.parentNode.appendChild(empty);
      }
      table.style.display = "none";
    } else {
      if (empty) empty.remove();
      table.style.display = "";
    }
    var pager = document.getElementById("reserva-pager");
    if (pager) {
      if (rows.length <= RESERVA_PAGE_SIZE) {
        pager.hidden = true;
        pager.innerHTML = "";
      } else {
        var from = start + 1;
        var to = Math.min(start + RESERVA_PAGE_SIZE, rows.length);
        pager.hidden = false;
        pager.innerHTML =
          '<button type="button" class="page-btn" data-reserva-page="' +
          (reservaPage - 1) +
          '" ' +
          (reservaPage <= 1 ? "disabled" : "") +
          ">Anterior</button><span>Mostrando " +
          from +
          "–" +
          to +
          " de " +
          rows.length +
          '</span><button type="button" class="page-btn" data-reserva-page="' +
          (reservaPage + 1) +
          '" ' +
          (reservaPage >= pages ? "disabled" : "") +
          ">Siguiente</button>";
      }
    }
  }
  function renderReservas() {
    var rows = todayReservas();
    return (
      '<header class="page-head"><p class="kicker">Administración</p><h1 class="h1">Reservas de hoy</h1><p class="sub">Filtra por supervisor o DNI. No es el listado global.</p></header>' +
      '<section class="card verify reserva-card">' +
      reservaToolbar(rows.length) +
      '<div class="table-wrap"><table class="admin-table reserva-table"><thead><tr><th>DNI</th><th>Trabajador</th><th>Hora</th><th>Supervisor</th><th>Comedor</th><th>Tipo</th></tr></thead><tbody id="reserva-body"></tbody></table></div>' +
      '<div id="reserva-pager" class="team-pager" hidden></div>' +
      "</section>"
    );
  }

  function renderCocina() {
    var halls = comedorCounts(ALL, TODAY);
    var visible = halls.filter(function (c) {
      if (kitchenVendorFilter === "all") return true;
      return vendorOfHall(c.name) === kitchenVendorFilter;
    });
    var visMeals = visible.reduce(function (a, c) { return a + c.count; }, 0);
    var visExtras = visible.reduce(function (a, c) { return a + c.extras; }, 0);
    var visLista = visMeals - visExtras;
    return (
      '<div class="kitchen">' +
      '<header class="k-head">' +
      '<div class="k-head-copy"><p class="kicker">' +
      icon("hat") +
      " Modo cocina</p><h1 class=\"h1\">Menús por comedor</h1><p class=\"sub\">Raciones de hoy por comedor. Lista y extras se cuentan juntas en el mismo envío.</p></div>" +
      (function () {
        var now = limaNow();
        return (
          '<div class="k-clock"><span id="k-clock-date">' +
          esc(now.date) +
          '</span><strong id="k-clock-time">' +
          esc(now.time) +
          "</strong></div>"
        );
      })() +
      "</header>" +
      '<div class="k-layout">' +
      '<aside class="k-side">' +
      "<h2>Proveedores</h2>" +
      '<p class="k-side-sub">Abre el tablero y lanza cada comedor.</p>' +
      '<button type="button" class="k-open-vendors" data-open-vendors>Asignar comedores</button>' +
      '<button type="button" class="k-open-vendors k-open-dist" data-open-dist>Agregar distribuidora</button>' +
      '<label class="k-filter">' +
      '<select id="kitchen-vendor-filter" class="k-filter-select" aria-label="Filtrar proveedor">' +
      '<option value="all"' +
      (kitchenVendorFilter === "all" ? " selected" : "") +
      ">Todos</option>" +
      VENDORS.map(function (v) {
        return (
          '<option value="' +
          esc(v.id) +
          '"' +
          (kitchenVendorFilter === v.id ? " selected" : "") +
          ">" +
          esc(v.name) +
          "</option>"
        );
      }).join("") +
      "</select></label>" +
      '<div class="k-vendor-list">' +
      (function () {
        var pages = Math.max(1, Math.ceil(halls.length / KITCHEN_LIST_SIZE));
        if (kitchenListPage > pages) kitchenListPage = pages;
        if (kitchenListPage < 1) kitchenListPage = 1;
        var start = (kitchenListPage - 1) * KITCHEN_LIST_SIZE;
        var slice = halls.slice(start, start + KITCHEN_LIST_SIZE);
        var rows = slice
          .map(function (c) {
            var vid = vendorOfHall(c.name);
            return (
              '<button type="button" class="k-vendor-row" data-open-vendors>' +
              '<span class="k-vendor-hall">' +
              esc(c.name) +
              '</span><span class="k-vendor-now">' +
              esc(vid ? vendorShort(vid) : "—") +
              "</span></button>"
            );
          })
          .join("");
        var pager =
          halls.length > KITCHEN_LIST_SIZE
            ? '<div class="k-list-pager">' +
              '<button type="button" class="page-btn" data-kitchen-list="' +
              (kitchenListPage - 1) +
              '" ' +
              (kitchenListPage <= 1 ? "disabled" : "") +
              ">Ant</button><span>" +
              kitchenListPage +
              " / " +
              pages +
              '</span><button type="button" class="page-btn" data-kitchen-list="' +
              (kitchenListPage + 1) +
              '" ' +
              (kitchenListPage >= pages ? "disabled" : "") +
              ">Sig</button></div>"
            : "";
        return rows + pager;
      })() +
      "</div></aside>" +
      '<div class="k-main"><div class="k-board">' +
      (visible.length
        ? visible
            .map(function (c) {
              var lista = c.count - c.extras;
              var note = c.count
                ? c.extras
                  ? lista + " lista + " + c.extras + " extras"
                  : lista + " lista"
                : "Sin envío hoy";
              var vid = vendorOfHall(c.name);
              return (
                '<div class="k-send' +
                (c.count ? "" : " is-zero") +
                (c.extras ? " has-extra" : "") +
                '"><span class="k-send-name">' +
                esc(c.name) +
                '</span><span class="k-send-qty">' +
                c.count +
                "</span><small>" +
                esc(note) +
                "</small>" +
                (vid ? '<em class="k-vendor-tag">' + esc(vendorName(vid)) + "</em>" : "") +
                "</div>"
              );
            })
            .join("")
        : '<p class="empty k-empty">No hay comedores en este proveedor.</p>') +
      '<div class="k-send k-send-total"><span class="k-send-name">Total' +
      (kitchenVendorFilter === "all" ? "" : " · " + vendorName(kitchenVendorFilter)) +
      '</span><span class="k-send-qty">' +
      visMeals +
      "</span><small>" +
      visLista +
      " lista + " +
      visExtras +
      " extras</small></div></div></div></div></div>"
    );
  }

  function render(routeName, query) {
    if (routeName === "/supervisores") return renderSupervisores(query);
    if (routeName === "/comedores") return renderComedores();
    if (routeName === "/reservas") return renderReservas();
    if (routeName === "/cocina") return renderCocina();
    return renderDashboard(query);
  }

  function extrasToday() {
    return activeOn(ALL, TODAY)
      .filter(function (r) {
        return r.extra;
      })
      .sort(function (a, b) {
        return b.time.localeCompare(a.time);
      });
  }
  var NOTICE_STORE = "qberries.noticeSeen";
  var NOTICE_TTL_MS = 24 * 60 * 60 * 1000;
  var noticeSeen = { day: "", at: 0, ids: {} };
  function noticeKey(r) {
    return String(
      (r && r.id) ||
        [r && r.date, r && r.dni, r && r.time, r && r.supervisor, r && r.sede].join("|")
    );
  }
  function saveNoticeSeen() {
    try {
      root.localStorage.setItem(NOTICE_STORE, JSON.stringify(noticeSeen));
    } catch (err) {}
  }
  function clearNoticeSeen() {
    noticeSeen = { day: TODAY, at: Date.now(), ids: {} };
    saveNoticeSeen();
  }
  function purgeNoticeSeen() {
    var staleDay = !noticeSeen.day || noticeSeen.day !== TODAY;
    var staleAge = !noticeSeen.at || Date.now() - Number(noticeSeen.at || 0) > NOTICE_TTL_MS;
    if (staleDay || staleAge) clearNoticeSeen();
  }
  (function loadNoticeSeen() {
    try {
      var raw = JSON.parse(root.localStorage.getItem(NOTICE_STORE) || "null");
      if (raw && typeof raw === "object") {
        noticeSeen = {
          day: String(raw.day || ""),
          at: Number(raw.at) || 0,
          ids: raw.ids && typeof raw.ids === "object" ? raw.ids : {},
        };
      }
    } catch (err) {
      noticeSeen = { day: "", at: 0, ids: {} };
    }
    purgeNoticeSeen();
  })();
  function unseenExtras() {
    purgeNoticeSeen();
    return extrasToday().filter(function (r) {
      return !noticeSeen.ids[noticeKey(r)];
    });
  }
  function markNoticesSeen() {
    purgeNoticeSeen();
    extrasToday().forEach(function (r) {
      noticeSeen.ids[noticeKey(r)] = 1;
    });
    noticeSeen.day = TODAY;
    noticeSeen.at = Date.now();
    saveNoticeSeen();
  }
  function paintNotices() {
    try {
    var badge = document.getElementById("notice-badge");
    var list = document.getElementById("notice-list");
    var sub = document.getElementById("notice-sub");
    if (!badge || !list || !sub) return;
    purgeNoticeSeen();
    var extras = extrasToday();
    var unseen = unseenExtras();
    if (unseen.length) {
      badge.hidden = false;
      badge.textContent = unseen.length > 99 ? "99+" : String(unseen.length);
    } else {
      badge.hidden = true;
    }
    sub.textContent = extras.length
      ? extras.length +
        (extras.length === 1 ? " extra pedida hoy" : " extras pedidas hoy") +
        (unseen.length ? " · " + unseen.length + " sin ver" : " · al día")
      : "No hay extras hoy";
    list.innerHTML = extras.length
      ? extras
          .map(function (r) {
            var unread = !noticeSeen.ids[noticeKey(r)];
            return (
              '<article class="notice-item' +
              (unread ? " is-new" : "") +
              '"><span class="avatar">' +
              esc(initials(r.name)) +
              "</span><div><strong>Se ha pedido un extra</strong><small>" +
              esc(r.name) +
              '</small><small class="notice-dni">DNI ' +
              esc(r.dni) +
              "</small><small>" +
              esc(r.supervisor) +
              '</small><small class="notice-hall">' +
              esc(r.sede || "") +
              '</small></div><div class="notice-time">' +
              esc(r.time) +
              "</div></article>"
            );
          })
          .join("")
      : '<p class="notice-empty">Hoy no se ha pedido ningún extra.</p>';
    } catch (err) {}
  }
  function toggleNotices() {
    var panel = document.getElementById("notice-panel");
    var btn = document.getElementById("notice-btn");
    if (!panel || !btn) return;
    var open = panel.hidden;
    if (!open) {
      markNoticesSeen();
      paintNotices();
    }
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) paintNotices();
  }
  function closeNotices() {
    var panel = document.getElementById("notice-panel");
    var btn = document.getElementById("notice-btn");
    if (panel && !panel.hidden) {
      markNoticesSeen();
      paintNotices();
    }
    if (panel) panel.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  var MOVE_STORE = "qberries.moves";
  var MOVE_TTL = 24 * 60 * 60 * 1000;
  var MOVE_PAGE_SIZE = 10;
  var movesPage = 1;
  function writeMoves(list) {
    try {
      root.localStorage.setItem(MOVE_STORE, JSON.stringify(list));
    } catch (err) {}
  }
  function readMoves() {
    var raw = [];
    try {
      raw = JSON.parse(root.localStorage.getItem(MOVE_STORE) || "[]");
    } catch (err) {
      raw = [];
    }
    if (!Array.isArray(raw)) raw = [];
    var cut = Date.now() - MOVE_TTL;
    var next = raw.filter(function (m) {
      return m && typeof m.at === "number" && m.at >= cut && m.text;
    });
    if (next.length !== raw.length) writeMoves(next);
    return next;
  }
  function moveHourTitle(m) {
    var today = todayKey();
    var when = m.day === today ? "Hoy" : m.day === addDays(today, -1) ? "Ayer" : "";
    if (!when && m.day) {
      var p = String(m.day).split("-");
      var months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
      if (p.length === 3) when = Number(p[2]) + " " + (months[Number(p[1]) - 1] || "");
    }
    return (when || "Día") + " · " + (m.hour || "");
  }
  function logMove(text) {
    text = String(text || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    try {
      var p = limaParts();
      var list = readMoves();
      list.unshift({
        at: Date.now(),
        time: pad2(p.hour) + ":" + pad2(p.minute),
        hour: pad2(p.hour) + ":00",
        day: p.year + "-" + p.month + "-" + p.day,
        text: text,
      });
      if (list.length > 400) list.length = 400;
      writeMoves(list);
      movesPage = 1;
      paintMoveBadge();
      if (document.getElementById("moves-modal") && document.getElementById("moves-modal").classList.contains("open")) paintMoves();
    } catch (err) {}
  }
  function paintMoveBadge() {
    var badge = document.getElementById("moves-badge");
    if (!badge) return;
    var n = readMoves().length;
    badge.hidden = !n;
    badge.textContent = n > 99 ? "99+" : String(n);
  }
  function paintMoves() {
    var listEl = document.getElementById("moves-list");
    var countEl = document.getElementById("moves-count");
    var pager = document.getElementById("moves-pager");
    if (!listEl || !pager) return;
    var list = readMoves();
    var pages = Math.max(1, Math.ceil(list.length / MOVE_PAGE_SIZE));
    if (movesPage > pages) movesPage = pages;
    if (movesPage < 1) movesPage = 1;
    var start = (movesPage - 1) * MOVE_PAGE_SIZE;
    var slice = list.slice(start, start + MOVE_PAGE_SIZE);
    if (countEl) {
      countEl.textContent = list.length
        ? list.length + (list.length === 1 ? " movimiento" : " movimientos") + " en 24 horas"
        : "Sin movimientos en las últimas 24 horas";
    }
    if (!slice.length) {
      listEl.innerHTML = '<p class="moves-empty">Cuando agreguen, quiten o cambien algo en el sistema, queda anotado aquí con su hora.</p>';
    } else {
      var html = "";
      var lastKey = "";
      slice.forEach(function (m) {
        var key = (m.day || "") + "|" + (m.hour || "");
        if (key !== lastKey) {
          lastKey = key;
          html += '<p class="move-hour">' + esc(moveHourTitle(m)) + "</p>";
        }
        html += '<article class="move-row"><time>' + esc(m.time || "") + "</time><p>" + esc(m.text) + "</p></article>";
      });
      listEl.innerHTML = html;
    }
    if (list.length <= MOVE_PAGE_SIZE) {
      pager.hidden = true;
      pager.innerHTML = "";
      return;
    }
    pager.hidden = false;
    var from = start + 1;
    var to = Math.min(start + MOVE_PAGE_SIZE, list.length);
    pager.innerHTML =
      '<button type="button" class="page-btn" data-moves-page="' +
      (movesPage - 1) +
      '" ' +
      (movesPage <= 1 ? "disabled" : "") +
      ">Anterior</button><span>Mostrando " +
      from +
      "–" +
      to +
      " de " +
      list.length +
      '</span><button type="button" class="page-btn" data-moves-page="' +
      (movesPage + 1) +
      '" ' +
      (movesPage >= pages ? "disabled" : "") +
      ">Siguiente</button>";
  }
  function openMoves() {
    var modal = document.getElementById("moves-modal");
    if (!modal) return;
    movesPage = 1;
    paintMoves();
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
    closeMenu();
  }
  function closeMoves() {
    var modal = document.getElementById("moves-modal");
    if (modal) modal.classList.remove("open");
    document.body.style.overflow = "";
  }

  function paint() {
    try {
      var nav = document.getElementById("nav");
      var app = document.getElementById("app");
      var search = document.getElementById("q");
      if (!nav || !app || !search) return;
      var current = parseRoute(location.hash);
      var verifyEl = document.getElementById("verify-q");
      if (verifyEl) verifyQ = verifyEl.value;
      nav.innerHTML = navHtml(current);
      try {
        app.innerHTML = render(current, search.value);
      } catch (err) {
        if (!app.innerHTML) {
          app.innerHTML =
            '<p class="empty">No se pudo mostrar esta pantalla. Use el menú para seguir navegando.</p>';
        }
      }
      paintNotices();
      paintKitchenClock();
      filterReservasTable();
      verifyEl = document.getElementById("verify-q");
      if (verifyEl && verifyQ) {
        verifyEl.value = verifyQ;
        filterVerifyTable(verifyQ);
      }
      var teamModal = document.getElementById("team-modal");
      if (teamModal && teamModal.classList.contains("open")) paintTeamList({ keepScroll: true });
      setDataStamp();
    } catch (err) {}
  }

  function paintKitchenClock() {
    try {
      var dateEl = document.getElementById("k-clock-date");
      var timeEl = document.getElementById("k-clock-time");
      if (!dateEl || !timeEl) return;
      var now = limaNow();
      if (dateEl.textContent !== now.date) dateEl.textContent = now.date;
      timeEl.textContent = now.time;
    } catch (err) {}
  }

  function closeMenu() {
    var sidebar = document.getElementById("sidebar");
    var backdrop = document.getElementById("backdrop");
    if (sidebar) sidebar.classList.remove("open");
    if (backdrop) backdrop.classList.remove("show");
  }

  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    if (location.protocol === "file:") {
      var fileWarn = document.getElementById("file-warn");
      if (fileWarn) {
        fileWarn.hidden = false;
        fileWarn.classList.add("open", "is-err");
      }
    }
    if (!location.hash) location.hash = "#/dashboard";
    var search = document.getElementById("q");
    var menu = document.getElementById("menu");
    var backdrop = document.getElementById("backdrop");
    var logo = document.getElementById("logo");
    var searchTimer = 0;
    if (search) {
      search.addEventListener("input", function () {
        root.clearTimeout(searchTimer);
        searchTimer = root.setTimeout(paint, 300);
      });
    }
    if (menu) {
      menu.addEventListener("click", function () {
        document.getElementById("sidebar").classList.toggle("open");
        document.getElementById("backdrop").classList.toggle("show");
      });
    }
    if (backdrop) backdrop.addEventListener("click", closeMenu);
    var noticeBtn = document.getElementById("notice-btn");
    var noticePanel = document.getElementById("notice-panel");
    if (noticeBtn) {
      noticeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleNotices();
      });
    }
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".notice")) closeNotices();
    });
    if (noticePanel) {
      noticePanel.addEventListener("click", function (e) {
        e.stopPropagation();
      });
    }
    var movesEye = document.getElementById("moves-eye");
    var movesModal = document.getElementById("moves-modal");
    var movesClose = document.getElementById("moves-close");
    if (movesEye) {
      movesEye.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        openMoves();
      });
    }
    if (movesClose) movesClose.addEventListener("click", closeMoves);
    if (movesModal) {
      movesModal.addEventListener("click", function (e) {
        if (e.target === movesModal) closeMoves();
        var pageBtn = e.target.closest && e.target.closest("[data-moves-page]");
        if (pageBtn && !pageBtn.disabled) {
          var nextMove = Number(pageBtn.getAttribute("data-moves-page"));
          if (nextMove >= 1) {
            movesPage = nextMove;
            paintMoves();
          }
        }
      });
    }
    paintMoveBadge();
    root.setInterval(function () {
      paintMoveBadge();
      if (movesModal && movesModal.classList.contains("open")) paintMoves();
    }, 60000);
    var teamModal = document.getElementById("team-modal");
    var teamClose = document.getElementById("team-close");
    var teamSearch = document.getElementById("team-q");
    if (teamClose) teamClose.addEventListener("click", closeTeam);
    var vendorClose = document.getElementById("vendor-close");
    var vendorModal = document.getElementById("vendor-modal");
    if (vendorClose) vendorClose.addEventListener("click", closeVendorModal);
    if (vendorModal) {
      vendorModal.addEventListener("click", function (e) {
        if (e.target === vendorModal) closeVendorModal();
      });
      vendorModal.addEventListener("dragstart", function (e) {
        var tile = e.target.closest && e.target.closest("[data-vendor-tile]");
        if (!tile || !e.dataTransfer) return;
        vendorPickHall = tile.getAttribute("data-vendor-tile") || "";
        e.dataTransfer.setData("text/plain", vendorPickHall);
        e.dataTransfer.effectAllowed = "move";
        tile.classList.add("is-picked");
      });
      vendorModal.addEventListener("dragend", function () {
        vendorModal.querySelectorAll(".vendor-bin.is-over").forEach(function (el) {
          el.classList.remove("is-over");
        });
      });
      vendorModal.addEventListener("dragover", function (e) {
        var bin = e.target.closest && e.target.closest("[data-drop]");
        if (!bin) return;
        e.preventDefault();
        vendorModal.querySelectorAll(".vendor-bin.is-over").forEach(function (el) {
          el.classList.remove("is-over");
        });
        bin.classList.add("is-over");
      });
      vendorModal.addEventListener("drop", function (e) {
        var bin = e.target.closest && e.target.closest("[data-drop]");
        if (!bin) return;
        e.preventDefault();
        var hall = (e.dataTransfer && e.dataTransfer.getData("text/plain")) || vendorPickHall;
        var dest = bin.getAttribute("data-drop") || "";
        vendorPickHall = "";
        bin.classList.remove("is-over");
        if (hall) setHallVendor(hall, dest === "none" ? "" : dest, { toggle: false });
      });
    }
    var distClose = document.getElementById("dist-close");
    var distModal = document.getElementById("dist-modal");
    var distForm = document.getElementById("dist-form");
    if (distClose) distClose.addEventListener("click", closeDistModal);
    if (distModal) {
      distModal.addEventListener("click", function (e) {
        if (e.target === distModal) closeDistModal();
      });
    }
    if (distForm) {
      distForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var input = document.getElementById("dist-name");
        var result = addDistributor(input ? input.value : "");
        if (!result.ok) {
          askTop({ title: "No se pudo registrar", text: result.error, hideCancel: true, ok: "Entendido" });
          return;
        }
        if (input) input.value = "";
        paintDistList();
        paintVendorBoard();
        paint();
        if (input) input.focus();
      });
    }
    var teamSearchTimer = 0;
    if (teamSearch) {
      teamSearch.addEventListener("input", function () {
        teamPage = 1;
        root.clearTimeout(teamSearchTimer);
        teamSearchTimer = root.setTimeout(paintTeamList, 180);
      });
    }
    if (teamModal) {
      teamModal.addEventListener("click", function (e) {
        if (e.target === teamModal) closeTeam();
        if (e.target.closest("#team-comedor-btn")) {
          e.preventDefault();
          toggleTeamPick("comedor");
          return;
        }
        if (e.target.closest("#team-fundo-btn")) {
          e.preventDefault();
          toggleTeamPick("fundo");
          return;
        }
        var hallOpt = e.target.closest("#team-comedor-pick .pick-opt");
        if (hallOpt) {
          e.preventDefault();
          setTeamPick("comedor", hallOpt.getAttribute("data-value") || "");
          return;
        }
        var fundoOpt = e.target.closest("#team-fundo-pick .pick-opt");
        if (fundoOpt) {
          e.preventDefault();
          setTeamPick("fundo", fundoOpt.getAttribute("data-value") || "");
          return;
        }
        if (!e.target.closest(".team-pick")) closeTeamPicks();
        var pageBtn = e.target.closest("[data-team-page]");
        if (pageBtn && !pageBtn.disabled) {
          var next = Number(pageBtn.getAttribute("data-team-page"));
          if (next) {
            teamPage = next;
            paintTeamList();
          }
          return;
        }
        var addBtn = e.target.closest("[data-add-meal]");
        if (addBtn) {
          var supervisor = teamModal.getAttribute("data-supervisor") || "";
          var worker = findWorker(addBtn.getAttribute("data-add-meal"));
          if (worker) addMealToday(supervisor, worker, false);
          return;
        }
        var dropMeal = e.target.closest("[data-drop-meal]");
        if (dropMeal) {
          var mealName = dropMeal.getAttribute("data-name") || "esta persona";
          var dni = dropMeal.getAttribute("data-drop-meal");
          askTop({
            title: "Eliminar de la lista",
            text: "¿Eliminar a " + mealName + " de la lista de hoy?",
            ok: "Eliminar",
            cancel: "Cancelar",
          }).then(function (ok) {
            var supervisor = teamModal.getAttribute("data-supervisor") || "";
            if (ok) dropMealToday(dni, supervisor);
          });
        }
      });
    }
    var teamAdd = document.getElementById("team-add");
    if (teamAdd) {
      if (teamAdd.dni) {
        teamAdd.dni.addEventListener("input", function () {
          teamAdd.dni.value = String(teamAdd.dni.value || "").replace(/\D/g, "").slice(0, 8);
        });
      }
      teamAdd.addEventListener("submit", function (e) {
        e.preventDefault();
        if (teamAdd.getAttribute("data-busy") === "1") return;
        var modal = document.getElementById("team-modal");
        var supervisor = modal ? modal.getAttribute("data-supervisor") || "" : "";
        if (!supervisor) return;
        var dni = String(teamAdd.dni.value || "").replace(/\D/g, "");
        var apellido = String(teamAdd.apellido ? teamAdd.apellido.value : "").replace(/\s+/g, " ").trim();
        var nombres = String(teamAdd.nombres ? teamAdd.nombres.value : "").replace(/\s+/g, " ").trim();
        var name = (apellido + " " + nombres).replace(/\s+/g, " ").trim();
        if (dni.length < 8 || !apellido || !nombres) {
          askTop({
            title: "Falta un dato",
            text: "Escribe el DNI, los apellidos y los nombres.",
            ok: "Entendido",
            hideCancel: true,
          });
          return;
        }
        teamAdd.setAttribute("data-busy", "1");
        var addBtn = document.getElementById("team-add-btn");
        if (addBtn) {
          addBtn.disabled = true;
          addBtn.textContent = "Guardando…";
        }
        var worker = upsertRoster(supervisor, { dni: dni, name: name, apellido: apellido, nombres: nombres });
        Promise.resolve(addMealToday(supervisor, worker, false)).then(function (ok) {
          if (ok) teamAdd.reset();
        }).finally(function () {
          teamAdd.removeAttribute("data-busy");
          if (addBtn) {
            addBtn.disabled = false;
            addBtn.textContent = "Agregar";
          }
        });
      });
    }
    var teamDest = document.getElementById("team-dest");
    if (teamDest) {
      teamDest.addEventListener("submit", function (e) {
        e.preventDefault();
        saveTeamDest();
      });
    }
    var refreshBtn = document.getElementById("refresh-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        refreshNow();
      });
    }
    var syncBox = document.getElementById("sync");
    if (syncBox) {
      syncBox.addEventListener("click", function (e) {
        if (e.target === syncBox && !refreshBusy) hideSync();
      });
    }
    var apiRetry = document.getElementById("api-retry");
    if (apiRetry) {
      apiRetry.addEventListener("click", function () {
        if (apiRetry.disabled) return;
        apiRetry.disabled = true;
        pullApi({ fresh: true }).finally(function () {
          apiRetry.disabled = false;
        });
      });
    }
    var reservaDniTimer = 0;
    document.addEventListener("input", function (e) {
      if (e.target && e.target.id === "verify-q") {
        verifyQ = e.target.value;
        filterVerifyTable(e.target.value);
      }
      if (e.target && e.target.id === "reserva-dni") {
        reservaPage = 1;
        root.clearTimeout(reservaDniTimer);
        reservaDniTimer = root.setTimeout(filterReservasTable, 220);
      }
    });
    document.addEventListener("change", function (e) {
      if (e.target && e.target.id === "kitchen-vendor-filter") {
        kitchenVendorFilter = e.target.value || "all";
        kitchenListPage = 1;
        closeKitchenPicks();
        paint();
      }
    });
    document.addEventListener("click", function (e) {
      var kOpen = e.target.closest && e.target.closest("[data-open-vendors]");
      if (kOpen) {
        e.preventDefault();
        openVendorModal();
        return;
      }
      var kDist = e.target.closest && e.target.closest("[data-open-dist]");
      if (kDist) {
        e.preventDefault();
        openDistModal();
        return;
      }
      var distDel = e.target.closest && e.target.closest("[data-dist-del]");
      if (distDel) {
        e.preventDefault();
        var delId = distDel.getAttribute("data-dist-del") || "";
        var delVendor = findVendor(delId);
        if (!delVendor) return;
        askTop({
          title: "Eliminar distribuidora",
          text: "¿Quitar “" + delVendor.name + "”? Los comedores asignados quedarán sin proveedor.",
          ok: "Eliminar",
          cancel: "Cancelar",
        }).then(function (ok) {
          if (!ok) return;
          removeDistributor(delId);
          paintDistList();
          paintVendorBoard();
          paint();
        });
        return;
      }
      var kListPage = e.target.closest && e.target.closest("[data-kitchen-list]");
      if (kListPage && !kListPage.disabled) {
        e.preventDefault();
        var nextList = Number(kListPage.getAttribute("data-kitchen-list"));
        if (nextList >= 1) {
          kitchenListPage = nextList;
          paint();
        }
        return;
      }
      var kPickBtn = e.target.closest && e.target.closest("[data-kitchen-pick]");
      if (kPickBtn) {
        e.preventDefault();
        openVendorModal();
        return;
      }
      var vTile = e.target.closest && e.target.closest("[data-vendor-tile]");
      if (vTile) {
        e.preventDefault();
        vendorPickHall = vTile.getAttribute("data-vendor-tile") || "";
        paintVendorBoard();
        return;
      }
      var vDrop = e.target.closest && e.target.closest("[data-drop]");
      if (vDrop && vendorPickHall) {
        e.preventDefault();
        var dest = vDrop.getAttribute("data-drop") || "";
        var hall = vendorPickHall;
        vendorPickHall = "";
        setHallVendor(hall, dest === "none" ? "" : dest, { toggle: false });
        return;
      }
      if (!e.target.closest || !e.target.closest(".k-vendor-pick")) closeKitchenPicks();
      if (e.target.closest && e.target.closest("#reserva-sup-btn")) {
        e.preventDefault();
        toggleReservaPick();
        return;
      }
      var pickOpt = e.target.closest && e.target.closest("#reserva-sup-pick .pick-opt");
      if (pickOpt) {
        e.preventDefault();
        setReservaSup(pickOpt.getAttribute("data-value") || "");
        return;
      }
      if (!e.target.closest || !e.target.closest("#reserva-sup-pick")) closeReservaPick();
      var reservaPageBtn = e.target.closest("[data-reserva-page]");
      if (reservaPageBtn && !reservaPageBtn.disabled) {
        var nextPage = Number(reservaPageBtn.getAttribute("data-reserva-page"));
        if (nextPage >= 1) {
          reservaPage = nextPage;
          filterReservasTable();
        }
        return;
      }
      if (e.target.closest("[data-export='excel']") || e.target.closest("[data-export='pdf']")) {
        e.preventDefault();
        var btn = e.target.closest("[data-export]");
        exportByScope(btn.getAttribute("data-export"), btn.getAttribute("data-scope") || "verify");
        return;
      }
      var teamBtn = e.target.closest("[data-open-team]");
      if (!teamBtn) return;
      e.preventDefault();
      openTeam(teamBtn.getAttribute("data-open-team"));
    });
    document.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("#swal-ok")) {
        e.preventDefault();
        e.stopPropagation();
        closeSwal(true);
        return;
      }
      if (e.target.closest && e.target.closest("#swal-cancel")) {
        e.preventDefault();
        e.stopPropagation();
        closeSwal(false);
        return;
      }
      if (e.target && e.target.id === "swal") closeSwal(false);
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var openSwal = document.getElementById("swal");
      if (openSwal && !openSwal.hidden) {
        closeSwal(false);
        return;
      }
      var openSync = document.getElementById("sync");
      if (openSync && !openSync.hidden) {
        if (!refreshBusy) hideSync();
        return;
      }
      var vendorBox = document.getElementById("vendor-modal");
      if (vendorBox && vendorBox.classList.contains("open")) {
        closeVendorModal();
        return;
      }
      var distBox = document.getElementById("dist-modal");
      if (distBox && distBox.classList.contains("open")) {
        closeDistModal();
        return;
      }
      var openPick = document.querySelector("#reserva-sup-pick.open");
      if (openPick) {
        closeReservaPick();
        return;
      }
      var openKitchen = document.querySelector(".k-vendor-pick.open");
      if (openKitchen) {
        closeKitchenPicks();
        return;
      }
      closeTeam();
      closeNotices();
    });
    if (logo) {
      logo.addEventListener("error", function () {
        logo.style.display = "none";
        if (logo.parentNode && !logo.parentNode.querySelector(".logo-fallback")) {
          var span = document.createElement("strong");
          span.className = "logo-fallback";
          span.textContent = "Qberries";
          logo.parentNode.appendChild(span);
        }
      });
    }
    paint();
    Promise.resolve(CONFIG.apiUrl ? hydrateLocal() : Promise.resolve(false))
      .then(function () {
        paint();
        setDataStamp();
        if (CONFIG.apiUrl) {
          if (!ALL.length) setApiBar("loading", "Cargando reservas…");
          return Promise.all([pullCatalog(), pullApi({ fresh: true, silent: !!ALL.length })]);
        }
      })
      .catch(function () {});
    if (CONFIG.pollMs) armPoll();
    root.clearInterval(clockTimer);
    clockTimer = window.setInterval(paintKitchenClock, 1000);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden || !isOnline()) return;
      pullApi({ silent: true, fresh: true });
    });
    window.addEventListener("online", function () {
      if (!CONFIG.apiUrl) return;
      pullCatalog();
      pullApi({ fresh: true, silent: !!ALL.length });
    });
    window.addEventListener("offline", function () {
      if (ALL.length) dataSource = "cache";
      setDataStamp();
    });
    if (navigator.serviceWorker && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        if (reg.waiting) {
          try {
            reg.waiting.postMessage({ type: "SKIP_WAITING" });
          } catch (err) {}
        }
        reg.addEventListener("updatefound", function () {
          var sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", function () {
            if (sw.state === "installed" && navigator.serviceWorker.controller) {
              toast("Hay una versión nueva. Recarga cuando puedas.");
            }
          });
        });
      }).catch(function () {});
    }
  }

  root.QberriesAdmin = {
    CONFIG: CONFIG,
    MEALS: MEALS,
    SEDES: SEDES,
    SUPERVISORS: SUPERVISORS,
    generate: generate,
    todayKey: todayKey,
    addDays: addDays,
    esc: esc,
    fold: fold,
    parseRoute: parseRoute,
    matchesQuery: matchesQuery,
    statusLabel: statusLabel,
    activeOn: activeOn,
    cancelledOn: cancelledOn,
    bySupervisor: bySupervisor,
    byComedor: byComedor,
    comedoresFromSupervisors: comedoresFromSupervisors,
    week: week,
    comedorCounts: comedorCounts,
    totals: totals,
    dayView: dayView,
    applyRows: applyRows,
    api: root.QberriesApi,
    useApi: function (url, ms) {
      CONFIG.apiUrl = String(url || "").trim();
      if (root.QberriesConfig) root.QberriesConfig.apiUrl = CONFIG.apiUrl;
      try {
        if (root.localStorage) {
          if (CONFIG.apiUrl) root.localStorage.setItem("qberries.apiUrl", CONFIG.apiUrl);
          else root.localStorage.removeItem("qberries.apiUrl");
        }
      } catch (err) {}
      if (ms) CONFIG.pollMs = ms;
      if (root.QberriesApi) root.QberriesApi.clearCache();
      pullApi({ fresh: true });
      return CONFIG;
    },
    filterSupervisors: filterSupervisors,
    matchWorkerPrecise: matchWorkerPrecise,
    workersOfSupervisor: workersOfSupervisor,
    filterTeam: filterTeam,
    extrasToday: extrasToday,
    paintNotices: paintNotices,
    openTeam: openTeam,
    closeTeam: closeTeam,
    render: render,
    paint: paint,
    boot: boot,
  };

  if (typeof document !== "undefined") {
    window.addEventListener("hashchange", function () {
      closeMenu();
      closeTeam();
      closeVendorModal();
      closeDistModal();
      closeNotices();
      closeSwal(false);
      closeReservaPick();
      closeKitchenPicks();
      paint();
    });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})(typeof window !== "undefined" ? window : globalThis);
