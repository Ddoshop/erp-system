const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const nodemailer = require("nodemailer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const { initDb } = require("./db");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret_in_production";

// ============= SECURITY MIDDLEWARE =============

// Helmet for additional security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  frameguard: { action: "deny" },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));

// CORS configuration - allow only same origin by default
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : ["http://localhost:3000"];
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Max-Age", "86400");
  
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  
  next();
});

// Rate limiting for login endpoint - prevent brute force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  message: "Слишком много попыток входа. Попробуйте позже.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for localhost in development
    return (req.ip === "::1" || req.ip === "127.0.0.1") && process.env.NODE_ENV === "development";
  }
});

// Rate limiting for API endpoints - prevent DoS
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: "Слишком много запросов. Попробуйте позже.",
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiting for file uploads
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 uploads per hour
  message: "Лимит загрузок файлов превышен.",
  standardHeaders: true,
  legacyHeaders: false
});

app.use(express.json({ limit: "20mb" }));
app.use(cookieParser());

app.use("/assets", express.static(path.join(__dirname, "public")));
app.use("/files", express.static(path.join(__dirname, "data", "tender_files")));
app.use("/submission-files", express.static(path.join(__dirname, "data", "submission_packages")));
app.use("/invoices", express.static(path.join(__dirname, "data", "invoices")));
app.use("/shipment-docs", express.static(path.join(__dirname, "data", "shipment_docs")));

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
}

function authRequired(req, res, next) {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).json({ message: "Требуется авторизация" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ message: "Сессия истекла" });
  }
}

function roleRequired(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Недостаточно прав" });
    }
    next();
  };
}

// Account lockout mechanism - in-memory storage
const failedLoginAttempts = new Map();
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_THRESHOLD = 5; // lock after 5 failed attempts

function recordFailedLogin(email) {
  const key = String(email || "").toLowerCase();
  const current = failedLoginAttempts.get(key) || { attempts: 0, lockedUntil: 0 };
  
  current.attempts += 1;
  current.lastAttempt = Date.now();
  
  if (current.attempts >= LOCKOUT_THRESHOLD) {
    current.lockedUntil = Date.now() + LOCKOUT_DURATION;
  }
  
  failedLoginAttempts.set(key, current);
}

function isAccountLocked(email) {
  const key = String(email || "").toLowerCase();
  const record = failedLoginAttempts.get(key);
  
  if (!record) return false;
  if (record.lockedUntil <= Date.now()) {
    failedLoginAttempts.delete(key);
    return false;
  }
  
  return record.lockedUntil > Date.now();
}

function clearFailedLogins(email) {
  const key = String(email || "").toLowerCase();
  failedLoginAttempts.delete(key);
}

// IDOR (Insecure Direct Object Reference) protection
// Verify user has access to requested resource
async function checkTenderAccess(db, tenderId, user) {
  const tender = await db.get("SELECT id, creator_id FROM tenders WHERE id = ?", [tenderId]);
  if (!tender) return false;
  
  // Allow: creator, admin, or manager role
  if (tender.creator_id === user.id || user.role === "admin" || user.role === "manager") {
    return true;
  }
  
  return false;
}

async function checkOrderAccess(db, orderId, user) {
  const order = await db.get("SELECT id, tender_id FROM tender_orders WHERE id = ?", [orderId]);
  if (!order) return false;
  
  const tender = await db.get("SELECT creator_id FROM tenders WHERE id = ?", [order.tender_id]);
  if (!tender) return false;
  
  // Allow: tender creator, admin, or manager role
  if (tender.creator_id === user.id || user.role === "admin" || user.role === "manager") {
    return true;
  }
  
  return false;
}

async function checkShipmentAccess(db, shipmentId, user) {
  const shipment = await db.get(
    `SELECT s.id FROM shipment_workflows s 
     JOIN tender_orders o ON o.id = s.order_id 
     JOIN tenders t ON t.id = o.tender_id 
     WHERE s.id = ?`,
    [shipmentId]
  );
  
  if (!shipment) return false;
  
  // Allow: admin, manager, or logistic role
  if (user.role === "admin" || user.role === "manager" || user.role === "logistic") {
    return true;
  }
  
  return false;
}

function pageAuth(req, res, next) {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.redirect("/login");
  }

  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.redirect("/login");
  }
}

function moneyRow(rows) {
  return rows.map((row) => ({ ...row }));
}

async function syncShipmentWithOrders(db) {
  const missing = await db.all(
    `SELECT o.id
     FROM tender_orders o
     LEFT JOIN shipment_workflows s ON s.order_id = o.id
     WHERE o.status = 'stocked' AND s.id IS NULL`
  );

  for (const row of missing) {
    await db.run(
      `INSERT INTO shipment_workflows (order_id, status, transfer_ready, shipment_date, created_at)
       VALUES (?, 'warehouse', 0, '', ?)`,
      [row.id, Date.now()]
    );
  }

  await db.run(
    `UPDATE tender_orders
     SET status = 'closed'
     WHERE id IN (SELECT order_id FROM shipment_workflows WHERE status = 'closed')
       AND status <> 'closed'`
  );

  const completedTenders = await db.all(
    `SELECT t.id, t.number
     FROM tenders t
     WHERE t.is_archived = 0
       AND EXISTS (SELECT 1 FROM tender_orders o WHERE o.tender_id = t.id)
       AND NOT EXISTS (
         SELECT 1
         FROM tender_orders o
         WHERE o.tender_id = t.id
           AND o.status <> 'closed'
       )`
  );

  if (completedTenders.length) {
    const todayIso = new Date().toISOString().slice(0, 10);
    for (const tender of completedTenders) {
      await db.run(
        `UPDATE tenders
         SET status = 'executed',
             internal_status = 'executed',
             is_archived = 1,
             archived_at = ?
         WHERE id = ?`,
        [todayIso, tender.id]
      );
      await db.run(
        "INSERT INTO logs (text, created_at) VALUES (?, ?)",
        [`Тендер №${tender.number}: все поставки выполнены, статус 'Исполнен', перенесен в архив`, Date.now()]
      );
    }
  }
}

async function getTenderItemRemaining(db, tenderId) {
  const items = await db.all(
    `SELECT
      ti.id,
      ti.article,
      ti.name,
      ti.quantity,
      ti.unit,
      ti.price_est,
      COALESCE(SUM(toi.quantity), 0) AS ordered_qty
     FROM tender_items ti
     LEFT JOIN tender_order_items toi ON toi.tender_item_id = ti.id
     LEFT JOIN tender_orders tor ON tor.id = toi.order_id
     WHERE ti.tender_id = ?
     GROUP BY ti.id
     ORDER BY ti.id ASC`,
    [tenderId]
  );

  return items.map((it) => {
    const total = Number(it.quantity || 0);
    const ordered = Number(it.ordered_qty || 0);
    return {
      ...it,
      quantity: total,
      ordered_qty: ordered,
      remaining_qty: Math.max(0, total - ordered),
    };
  });
}

function stripTags(text) {
  return String(text || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseRuDateToIso(value) {
  const m = String(value || "").match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseMoney(value) {
  if (!value) return 0;
  const cleaned = String(value).replace(/\s/g, "").replace(/,/g, ".").match(/\d+(?:\.\d+)?/);
  if (!cleaned) return 0;
  return Math.round(Number(cleaned[0]));
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function resolveUrl(raw, baseUrl) {
  if (!raw) return "";
  const cleaned = decodeHtmlEntities(raw).trim();
  if (!cleaned) return "";
  try {
    return new URL(cleaned, baseUrl || "https://zakupki.gov.ru").toString();
  } catch {
    return "";
  }
}

function sanitizeFileName(name) {
  return String(name || "file")
    .replace(/[<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function formatMoneyRu(value) {
  return Number(value || 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateRu(isoDate) {
  const dt = new Date(isoDate);
  if (Number.isNaN(dt.getTime())) return isoDate;
  const day = String(dt.getDate()).padStart(2, "0");
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const year = dt.getFullYear();
  return `${day}.${month}.${year}`;
}

const templateCache = new Map();

async function loadHtmlTemplate(fileName) {
  if (templateCache.has(fileName)) return templateCache.get(fileName);
  const absPath = path.join(__dirname, fileName);
  try {
    const html = await fsp.readFile(absPath, "utf8");
    templateCache.set(fileName, html);
    return html;
  } catch {
    return "";
  }
}

function fillTemplateTokens(html, tokens) {
  let out = String(html || "");
  for (const [key, rawValue] of Object.entries(tokens || {})) {
    const value = String(rawValue ?? "");
    out = out.split(`#${key}#`).join(value);
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeDocItems(items, fallbackTitle, amount) {
  const source = Array.isArray(items) ? items : [];
  const normalized = source
    .map((it) => {
      const quantity = Number(it.quantity || 0);
      const price = Number(it.price ?? it.price_est ?? 0);
      const total = Number(it.total ?? quantity * price);
      return {
        code: String(it.code || it.article || ""),
        name: String(it.name || fallbackTitle || "Товар"),
        unit: String(it.unit || "шт"),
        quantity,
        price,
        total,
      };
    })
    .filter((it) => it.quantity > 0 || it.total > 0);

  if (normalized.length) return normalized;

  return [{
    code: "",
    name: String(fallbackTitle || "Товар"),
    unit: "шт",
    quantity: 1,
    price: Number(amount || 0),
    total: Number(amount || 0),
  }];
}

function compactDocNo(prefix, entityId, isoDate) {
  const d = String(isoDate || "").replace(/-/g, "");
  return `${prefix}-${entityId}-${d}`;
}

async function renderInvoiceFromTemplate(data) {
  const tpl = await loadHtmlTemplate("счёт.html");
  if (!tpl) {
    return renderInvoiceHtml(data);
  }

  const dateRu = formatDateRu(data.date);
  const items = normalizeDocItems(data.items, `Поставка по заказу ${data.orderNumber}`, data.amount);
  const total = items.reduce((sum, it) => sum + Number(it.total || 0), 0);
  let html = fillTemplateTokens(tpl, {
    number: data.number,
    date: dateRu,
    order_number: data.orderNumber,
    tender_number: data.tenderNumber,
    client: data.client,
    amount: formatMoneyRu(total || data.amount),
  });

  const rowsHtml = items
    .map((it, idx) => `
      <tr>
        <td style="width:13mm; text-align:center;">${idx + 1}</td>
        <td>${escapeHtml(it.name)}</td>
        <td style="width:20mm; text-align:center;">${String(it.quantity).replace(".", ",")}</td>
        <td style="width:17mm; text-align:center;">${escapeHtml(it.unit)}</td>
        <td style="width:27mm; text-align: center;">${formatMoneyRu(it.price)}</td>
        <td style="width:27mm; text-align: center;">${formatMoneyRu(it.total)}</td>
      </tr>`)
    .join("");

  html = html.replace(
    /(<table[^>]*border="2"[^>]*>\s*<thead[\s\S]*?<\/thead>\s*<tbody\s*>)[\s\S]*?(<\/tbody>)/i,
    `$1${rowsHtml}$2`
  );

  html = html.replace(/Счет №\s*0\s*от\s*\d{2}\.\d{2}\.\d{4}/i, `Счет № ${data.number} от ${dateRu}`);
  html = html.replace(/(<td[^>]*>\s*Итого:\s*<\/td>\s*<td[^>]*>)([^<]*)(<\/td>)/i, `$1${formatMoneyRu(total)}$3`);
  html = html.replace(/(<td[^>]*>\s*Итого НДС:\s*<\/td>\s*<td[^>]*>)([^<]*)(<\/td>)/i, `$10.00$3`);
  html = html.replace(/(<td[^>]*>\s*Всего к оплате:\s*<\/td>\s*<td[^>]*>)([^<]*)(<\/td>)/i, `$1${formatMoneyRu(total)}$3`);
  html = html.replace(/Всего наименований\s*\d+\s*на сумму\s*[\d\s.,]+\s*рублей\./i, `Всего наименований ${items.length} на сумму ${formatMoneyRu(total)} рублей.`);
  return html;
}

async function renderUpdFromTemplate(data) {
  const tpl = await loadHtmlTemplate("упд.html");
  if (!tpl) {
    return renderUpdHtml(data);
  }

  const dateRu = formatDateRu(data.date);
  const items = normalizeDocItems(data.items, `Поставка по заказу ${data.orderNumber}`, data.amount);
  const total = items.reduce((sum, it) => sum + Number(it.total || 0), 0);
  const amountRu = formatMoneyRu(total || data.amount);
  const basis = `Заказ ${data.orderNumber} по тендеру ${data.tenderNumber}`;

  const itemRows = items
    .map((it, idx) => `
    <tr>
      <td style="border-right:2px solid #000">${escapeHtml(it.code)}</td>
      <td>${idx + 1}</td>
      <td>${escapeHtml(it.name)}</td>
      <td> </td>
      <td>046</td>
      <td>${escapeHtml(it.unit)}</td>
      <td>${Number(it.quantity).toFixed(3).replace(".", ",")}</td>
      <td>${formatMoneyRu(it.price)}</td>
      <td>${formatMoneyRu(it.total)}</td>
      <td> </td>
      <td>Без НДС</td>
      <td>0.00</td>
      <td>${formatMoneyRu(it.total)}</td>
      <td> </td>
      <td> </td>
      <td> </td>
    </tr>`)
    .join("");

  const totalsRow = `
    <tr>
      <td style="border-right:2px solid #000"> </td>
      <td colspan="7">Всего к оплате (9)</td>
      <td>ИТОГО ${formatMoneyRu(total)}</td>
      <td colspan="2" style="text-align: center !important">X</td>
      <td>НАЛОГ 0.00</td>
      <td>${formatMoneyRu(total)}</td>
      <td colspan="3"> </td>
    </tr>`;

  let html = fillTemplateTokens(tpl, {
    code: data.number,
    date: dateRu,
    basis,
    updpp: data.number,
    companyname: 'ООО "ТехноТрейд"',
    companyaddress: "г. Санкт-Петербург",
    companyinn: "7800000000",
    companykpp: "780001001",
    companydirectorname: "________________",
    companydirectorposition: "Руководитель",
    companyogrn: "______________",
    clientname: data.client,
    clientaddress: "",
    clientinn: "0000000000",
    clientkpp: "000000000",
    amount: amountRu,
    order_number: data.orderNumber,
    tender_number: data.tenderNumber,
  });

  html = html.replace(
    /<tr>\s*<td style="border-right:2px solid #000">[\s\S]*?<\/tr>\s*<tr>\s*<td style="border-right:2px solid #000">[\s\S]*?<\/tr>/i,
    `${itemRows}\n${totalsRow}`
  );

  return html;
}

function printableHtmlShell(title, bodyHtml) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { --border:#1f2937; --muted:#6b7280; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:"Times New Roman", Georgia, serif; color:#111827; background:#f8fafc; }
    .page { width:210mm; min-height:297mm; margin:10mm auto; background:#fff; padding:14mm 14mm 18mm; }
    .doc-title { text-align:center; font-size:24px; margin:0 0 6px; letter-spacing:0.3px; }
    .doc-subtitle { text-align:center; font-size:14px; margin:0 0 18px; color:#111827; }
    .meta { width:100%; border-collapse:collapse; margin-bottom:14px; font-size:14px; }
    .meta td { padding:3px 0; vertical-align:top; }
    .meta td:first-child { width:190px; color:var(--muted); }
    .line { margin:12px 0 14px; border-bottom:1px solid #111827; }
    .doc-table { width:100%; border-collapse:collapse; font-size:13px; margin-top:8px; }
    .doc-table th, .doc-table td { border:1px solid var(--border); padding:6px 7px; }
    .doc-table th { background:#f3f4f6; font-weight:700; text-align:center; }
    .doc-table td.num { text-align:right; white-space:nowrap; }
    .totals { margin-top:10px; margin-left:auto; width:280px; font-size:14px; }
    .totals .row { display:flex; justify-content:space-between; padding:4px 0; }
    .totals .row.total { font-size:16px; font-weight:700; border-top:1px solid #111827; margin-top:4px; padding-top:6px; }
    .sign { margin-top:38px; display:grid; grid-template-columns:1fr 1fr; gap:24px; font-size:14px; }
    .sign-line { margin-top:26px; border-bottom:1px solid #111827; height:1px; }
    .sign-label { margin-top:4px; color:var(--muted); font-size:12px; }
    .foot { margin-top:28px; color:var(--muted); font-size:12px; }
    @media print {
      body { background:#fff; }
      .page { margin:0; width:auto; min-height:auto; padding:0; }
    }
  </style>
</head>
<body>
  <div class="page">
    ${bodyHtml}
  </div>
</body>
</html>`;
}

function renderInvoiceHtml({ title, number, date, orderNumber, tenderNumber, client, amount, purpose, items }) {
  const invoiceItems = normalizeDocItems(items, `Поставка по заказу ${orderNumber}`, amount);
  const totalAmount = invoiceItems.reduce((sum, it) => sum + Number(it.total || 0), 0);
  const rowsHtml = invoiceItems.map((it, idx) => `
          <tr>
            <td style="text-align:center;">${idx + 1}</td>
            <td>${escapeHtml(it.name)}</td>
            <td class="num">${String(it.quantity).replace(".", ",")}</td>
            <td class="num">${formatMoneyRu(it.price)}</td>
            <td class="num">${formatMoneyRu(it.total)}</td>
          </tr>`).join("");
  return printableHtmlShell(
    title,
    `
      <h1 class="doc-title">${title}</h1>
      <p class="doc-subtitle">№ ${number} от ${date}</p>

      <table class="meta">
        <tr><td>Поставщик:</td><td>ООО "ТехноТрейд"</td></tr>
        <tr><td>Покупатель:</td><td>${client}</td></tr>
        <tr><td>Основание:</td><td>Заказ ${orderNumber} по тендеру ${tenderNumber}</td></tr>
        <tr><td>Назначение:</td><td>${purpose}</td></tr>
      </table>

      <table class="doc-table">
        <thead>
          <tr>
            <th style="width:50px;">№</th>
            <th>Наименование</th>
            <th style="width:120px;">Кол-во</th>
            <th style="width:150px;">Цена, руб.</th>
            <th style="width:160px;">Сумма, руб.</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="totals">
        <div class="row"><span>Итого:</span><span>${formatMoneyRu(totalAmount)} руб.</span></div>
        <div class="row total"><span>К оплате:</span><span>${formatMoneyRu(totalAmount)} руб.</span></div>
      </div>

      <div class="sign">
        <div>
          <div>Руководитель поставщика</div>
          <div class="sign-line"></div>
          <div class="sign-label">подпись / ФИО</div>
        </div>
        <div>
          <div>Главный бухгалтер</div>
          <div class="sign-line"></div>
          <div class="sign-label">подпись / ФИО</div>
        </div>
      </div>

      <div class="foot">Документ сформирован автоматически ERP-системой.</div>
    `
  );
}

function renderActHtml({ number, date, orderNumber, tenderNumber, client, amount, items }) {
  const actItems = normalizeDocItems(items, `Поставка по заказу ${orderNumber}`, amount);
  const totalAmount = actItems.reduce((sum, it) => sum + Number(it.total || 0), 0);
  const rowsHtml = actItems.map((it, idx) => `
          <tr>
            <td style="text-align:center;">${idx + 1}</td>
            <td>${escapeHtml(it.name)} (${String(it.quantity).replace(".", ",")} ${escapeHtml(it.unit)})</td>
            <td class="num">${formatMoneyRu(it.total)}</td>
          </tr>`).join("");
  return printableHtmlShell(
    "Акт приема-передачи",
    `
      <h1 class="doc-title">АКТ ПРИЕМА-ПЕРЕДАЧИ</h1>
      <p class="doc-subtitle">№ ${number} от ${date}</p>

      <table class="meta">
        <tr><td>Поставщик:</td><td>ООО "ТехноТрейд"</td></tr>
        <tr><td>Получатель:</td><td>${client}</td></tr>
        <tr><td>Заказ:</td><td>${orderNumber}</td></tr>
        <tr><td>Тендер:</td><td>${tenderNumber}</td></tr>
      </table>

      <table class="doc-table">
        <thead>
          <tr>
            <th style="width:50px;">№</th>
            <th>Описание работ / поставки</th>
            <th style="width:170px;">Сумма, руб.</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="totals">
        <div class="row total"><span>Общая сумма:</span><span>${formatMoneyRu(totalAmount)} руб.</span></div>
      </div>

      <div class="sign">
        <div>
          <div>Сдал (Поставщик)</div>
          <div class="sign-line"></div>
          <div class="sign-label">подпись / ФИО</div>
        </div>
        <div>
          <div>Принял (Получатель)</div>
          <div class="sign-line"></div>
          <div class="sign-label">подпись / ФИО</div>
        </div>
      </div>
    `
  );
}

function renderUpdHtml({ number, date, orderNumber, tenderNumber, client, amount, items }) {
  const updItems = normalizeDocItems(items, `Поставка по заказу ${orderNumber}`, amount);
  const totalAmount = updItems.reduce((sum, it) => sum + Number(it.total || 0), 0);
  const rowsHtml = updItems.map((it, idx) => `
          <tr>
            <td style="text-align:center;">${idx + 1}</td>
            <td>${escapeHtml(it.name)}</td>
            <td class="num">${String(it.quantity).replace(".", ",")}</td>
            <td class="num">${formatMoneyRu(it.price)}</td>
            <td class="num">${formatMoneyRu(it.total)}</td>
          </tr>`).join("");
  return printableHtmlShell(
    "УПД",
    `
      <h1 class="doc-title">УПД</h1>
      <p class="doc-subtitle">Универсальный передаточный документ № ${number} от ${date}</p>

      <table class="meta">
        <tr><td>Продавец:</td><td>ООО "ТехноТрейд"</td></tr>
        <tr><td>Покупатель:</td><td>${client}</td></tr>
        <tr><td>Основание:</td><td>Тендер ${tenderNumber}, заказ ${orderNumber}</td></tr>
      </table>

      <table class="doc-table">
        <thead>
          <tr>
            <th style="width:50px;">№</th>
            <th>Товар (работа, услуга)</th>
            <th style="width:120px;">Кол-во</th>
            <th style="width:130px;">Цена</th>
            <th style="width:130px;">Стоимость</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="totals">
        <div class="row"><span>Всего к оплате:</span><span>${formatMoneyRu(totalAmount)} руб.</span></div>
        <div class="row"><span>В т.ч. НДС:</span><span>Без НДС</span></div>
      </div>

      <div class="sign">
        <div>
          <div>Ответственный за правильность оформления</div>
          <div class="sign-line"></div>
          <div class="sign-label">подпись / ФИО</div>
        </div>
        <div>
          <div>Ответственный со стороны покупателя</div>
          <div class="sign-line"></div>
          <div class="sign-label">подпись / ФИО</div>
        </div>
      </div>
    `
  );
}

async function generateSubmissionPackage(db, tenderId) {
  const tender = await db.get("SELECT * FROM tenders WHERE id = ?", [tenderId]);
  if (!tender) throw new Error("Тендер не найден");
  if (String(tender.internal_status || "") !== "awaiting_application") {
    throw new Error("Генерация пакета доступна только при внутреннем статусе 'Ожидает подачи заявки'");
  }

  const items = await db.all(
    `SELECT article, name, quantity, unit, price_est, note
     FROM tender_items
     WHERE tender_id = ?
     ORDER BY id ASC`,
    [tenderId]
  );

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const pkgDir = path.join(__dirname, "data", "submission_packages", String(tenderId));
  await fsp.mkdir(pkgDir, { recursive: true });

  const goodsCost = items.reduce((sum, it) => sum + Number(it.quantity || 0) * Number(it.price_est || 0), 0);
  const participationFee = Number(tender.participation_fee || 5000);
  const deliveryCost = Number(tender.delivery_cost || 5000);
  const bankGuaranteeCost = Number(tender.bank_guarantee_cost || 0);
  const vatRate = Number(tender.vat_rate || 22);
  const baseCost = goodsCost + participationFee + deliveryCost + bankGuaranteeCost;
  const vatAmount = (baseCost * vatRate) / 100;
  const totalCost = baseCost + vatAmount;
  const marginAbs = Number(tender.price || 0) - totalCost;

  const itemsLines = items.length
    ? items.map((it, idx) => `${idx + 1}. ${it.name} | ${it.article || "-"} | ${it.quantity} ${it.unit} | ${Number(it.price_est || 0).toFixed(2)} руб.`).join("\n")
    : "Товарные позиции не добавлены";

  const docs = [
    {
      fileName: "01_cover_letter.txt",
      content: [
        "СОПРОВОДИТЕЛЬНОЕ ПИСЬМО",
        `Дата: ${dateStr}`,
        "",
        `Тендер: ${tender.number}`,
        `Предмет: ${tender.lot}`,
        `Заказчик: ${tender.client}`,
        "",
        "Подтверждаем готовность к участию в закупке и представляем комплект документов для подачи заявки.",
      ].join("\n"),
    },
    {
      fileName: "02_commercial_offer.txt",
      content: [
        "КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ",
        `Дата: ${dateStr}`,
        "",
        `Номер закупки: ${tender.number}`,
        `Сумма предложения (НМЦК): ${Number(tender.price || 0).toFixed(2)} руб.`,
        `Срок подачи заявок: ${tender.deadline || "-"}`,
        "",
        "Подтверждаем согласие на условия закупки и готовность исполнить обязательства.",
      ].join("\n"),
    },
    {
      fileName: "03_item_specification.txt",
      content: [
        "СПЕЦИФИКАЦИЯ ТОВАРОВ",
        `Тендер: ${tender.number}`,
        "",
        itemsLines,
      ].join("\n"),
    },
    {
      fileName: "04_finance_calculation.txt",
      content: [
        "ФИНАНСОВЫЙ РАСЧЕТ МАРЖИНАЛЬНОСТИ",
        `Тендер: ${tender.number}`,
        "",
        `Выручка (НМЦК): ${Number(tender.price || 0).toFixed(2)} руб.`,
        `Себестоимость товаров: ${goodsCost.toFixed(2)} руб.`,
        `Участие в тендере: ${participationFee.toFixed(2)} руб.`,
        `Доставка: ${deliveryCost.toFixed(2)} руб.`,
        `Банковская гарантия: ${bankGuaranteeCost.toFixed(2)} руб.`,
        `База до НДС: ${baseCost.toFixed(2)} руб.`,
        `НДС (${vatRate}%): ${vatAmount.toFixed(2)} руб.`,
        `Полная себестоимость: ${totalCost.toFixed(2)} руб.`,
        `Маржа: ${marginAbs.toFixed(2)} руб.`,
      ].join("\n"),
    },
  ];

  const files = [];
  for (const doc of docs) {
    const safeName = sanitizeFileName(doc.fileName);
    const absPath = path.join(pkgDir, safeName);
    await fsp.writeFile(absPath, doc.content, "utf8");
    const stat = await fsp.stat(absPath);
    files.push({
      file_name: safeName,
      file_size: Number(stat.size || 0),
      local_url: `/submission-files/${tenderId}/${safeName}`,
      created_at: Date.now(),
    });
  }

  return files;
}

function pickDocType(fileName) {
  const n = String(fileName || "").toLowerCase();
  if (/тех|tz|тз/.test(n)) return "ТЗ";
  if (/нмцк|мцд|расчет|расч[её]т/.test(n)) return "Расчет НМЦК";
  if (/проект.*контракт|contract/.test(n)) return "Проект контракта";
  if (/протокол/.test(n)) return "Протокол";
  return "Документ";
}

async function downloadTenderDocument(tenderId, doc, index) {
  const fileName = sanitizeFileName(doc.file_name || `document_${index + 1}.${doc.file_ext || "bin"}`);
  const tenderDir = path.join(__dirname, "data", "tender_files", String(tenderId));
  await fsp.mkdir(tenderDir, { recursive: true });

  const localName = `${Date.now()}_${index}_${fileName}`;
  const absPath = path.join(tenderDir, localName);
  const response = await fetch(doc.source_url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`download failed (${response.status})`);
  }
  const arr = await response.arrayBuffer();
  const buf = Buffer.from(arr);
  await fsp.writeFile(absPath, buf);

  return {
    local_url: `/files/${tenderId}/${localName}`,
    file_size: buf.length,
    file_name: fileName,
  };
}

function extractTenderDocuments(html, sourceUrl) {
  const docs = [];
  const seen = new Set();
  const docLinkRe = /<a\b([^>]*)\bhref="([^"]*\/download\/download\.html\?id=[^"]+)"([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = docLinkRe.exec(html)) !== null) {
    const href = resolveUrl(m[2], sourceUrl);
    if (!href || seen.has(href)) continue;
    const attrs = `${m[1] || ""} ${m[3] || ""}`;
    const text = stripTags(m[4] || "");
    const tooltip = (attrs.match(/data-tooltip=['"]([^'"]+)['"]/i) || [])[1] || "";
    const tooltipText = stripTags(decodeHtmlEntities(tooltip));
    const fileName = text && /\.(pdf|docx?|xlsx?|xls)$/i.test(text)
      ? text
      : (tooltipText.match(/[\wА-Яа-яЁё\-()\s.,_]+\.(?:pdf|docx?|xlsx?|xls)/i) || [""])[0].trim();
    const ext = ((fileName.match(/\.(pdf|docx?|xlsx?|xls)$/i) || [])[1] || "").toLowerCase();
    if (!ext) continue;
    seen.add(href);
    docs.push({
      source_url: href,
      file_name: fileName || `document.${ext}`,
      file_ext: ext,
      doc_type: pickDocType(fileName),
    });
  }
  return docs;
}

(async () => {
  const db = await initDb();

  app.get("/", (req, res) => res.redirect("/dashboard"));
  app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));

  ["dashboard", "tenders", "orders", "deliveries", "clients", "reports", "profile", "instructions", "contracts", "tasks", "applications", "accounting", "admin"].forEach((page) => {
    app.get(`/${page}`, pageAuth, (req, res) => {
      res.sendFile(path.join(__dirname, "public", `${page}.html`));
    });
  });

  // Apply rate limiting to all API endpoints
  app.use("/api/", apiLimiter);

  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    
    // Input validation
    if (!email || !password) {
      return res.status(400).json({ message: "Email и пароль обязательны" });
    }
    
    // Validate email format
    const emailString = String(email || "").trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailString) || emailString.length > 254) {
      return res.status(401).json({ message: "Неверный email или пароль" });
    }
    
    // Check if account is locked
    if (isAccountLocked(emailString)) {
      return res.status(429).json({ message: "Аккаунт временно заблокирован. Попробуйте позже." });
    }
    
    // Validate password length
    const passwordString = String(password || "").trim();
    if (passwordString.length < 1 || passwordString.length > 256) {
      recordFailedLogin(emailString);
      return res.status(401).json({ message: "Неверный email или пароль" });
    }
    
    // Query with parameterized query to prevent SQL injection
    const user = await db.get("SELECT * FROM users WHERE email = ?", [emailString]);

    if (!user) {
      recordFailedLogin(emailString);
      return res.status(401).json({ message: "Неверный email или пароль" });
    }

    const ok = await bcrypt.compare(passwordString, user.password_hash);
    if (!ok) {
      recordFailedLogin(emailString);
      return res.status(401).json({ message: "Неверный email или пароль" });
    }

    // Clear failed login attempts on successful login
    clearFailedLogins(emailString);

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      company: user.company,
      bio: user.bio,
    };

    const token = signToken(safeUser);
    // Enhanced cookie security: add Secure and SameSite flags
    res.cookie("auth_token", token, { 
      httpOnly: true, 
      sameSite: "strict", 
      maxAge: 8 * 60 * 60 * 1000,
      secure: process.env.NODE_ENV === "production"  // Enable Secure flag in production
    });
    res.json({ user: safeUser });
  });

  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("auth_token");
    res.json({ ok: true });
  });

  app.get("/api/auth/me", authRequired, async (req, res) => {
    const user = await db.get(
      "SELECT id, name, email, role, company, bio FROM users WHERE id = ?",
      [req.user.id]
    );

    if (!user) {
      return res.status(404).json({ message: "Пользователь не найден" });
    }

    res.json({ user });
  });

  app.put("/api/profile", authRequired, async (req, res) => {
    const { name, company, bio, password } = req.body;

    if (!name || !company) {
      return res.status(400).json({ message: "Имя и компания обязательны" });
    }

    if (password && String(password).trim()) {
      const hash = await bcrypt.hash(String(password), 10);
      await db.run(
        "UPDATE users SET name = ?, company = ?, bio = ?, password_hash = ? WHERE id = ?",
        [name, company, bio || "", hash, req.user.id]
      );
    } else {
      await db.run(
        "UPDATE users SET name = ?, company = ?, bio = ? WHERE id = ?",
        [name, company, bio || "", req.user.id]
      );
    }

    const user = await db.get("SELECT id, name, email, role, company, bio FROM users WHERE id = ?", [req.user.id]);
    res.json({ user });
  });

  app.get("/api/users", authRequired, roleRequired("manager", "admin", "director"), async (req, res) => {
    const items = await db.all(
      `SELECT id, name, email, role, company
       FROM users
       ORDER BY CASE role
         WHEN 'manager' THEN 1
         WHEN 'picker' THEN 2
         WHEN 'accountant' THEN 3
         WHEN 'logistic' THEN 4
         WHEN 'admin' THEN 5
         ELSE 6 END,
         name ASC`
    );
    res.json({ items });
  });

  function calculateTenderDashboardProgress(tender, orders, shipments) {
    const internal = String(tender.internal_status || "");
    const status = String(tender.status || "");
    const orderStatuses = orders.map((row) => String(row.status || ""));
    const shipmentStatuses = shipments.map((row) => String(row.status || ""));

    if (internal === "archived_lost") {
      return { percent: 100, stage: "Тендер завершен: проигран", tone: "risk" };
    }

    if (internal === "executed" || status === "executed") {
      return { percent: 100, stage: "Исполнение завершено", tone: "done" };
    }

    let percent = 8;
    let stage = "Новый тендер";
    let tone = "early";

    if (internal === "awaiting_picking") {
      percent = 16;
      stage = "Подбор товарных позиций";
    }

    if (internal === "awaiting_application") {
      percent = 32;
      stage = "Подготовка заявки";
    }

    if (internal === "submitted") {
      percent = 48;
      stage = "Заявка подана";
      tone = "mid";
    }

    if (status === "commission") {
      percent = 58;
      stage = "Работа комиссии";
      tone = "mid";
    }

    if (internal === "won_waiting_sign" || status === "awaiting_signing") {
      percent = 72;
      stage = "Ожидаем подписание договора";
      tone = "late";
    }

    if (internal === "signed_ours") {
      percent = 82;
      stage = "Подписано с нашей стороны";
      tone = "late";
    }

    if (internal === "signed_both" || status === "signed") {
      percent = 88;
      stage = "Договор подписан";
      tone = "late";
    }

    if (orders.length > 0) {
      percent = Math.max(percent, 90);
      stage = "Заказы сформированы";
      tone = "late";
    }

    if (orderStatuses.some((value) => value === "awaiting_payment")) {
      percent = Math.max(percent, 92);
      stage = "Ожидание оплаты заказа";
    }

    if (orderStatuses.some((value) => value === "paid")) {
      percent = Math.max(percent, 94);
      stage = "Заказ оплачен";
    }

    if (orderStatuses.some((value) => value === "stocked")) {
      percent = Math.max(percent, 96);
      stage = "Товар поставлен на склад";
    }

    if (shipmentStatuses.some((value) => value === "warehouse")) {
      percent = Math.max(percent, 97);
      stage = "Подготовка отгрузки";
    }

    if (shipmentStatuses.some((value) => value === "scheduled")) {
      percent = Math.max(percent, 98);
      stage = "Отгрузка запланирована";
    }

    if (shipmentStatuses.some((value) => value === "shipped" || value === "awaiting_payment")) {
      percent = Math.max(percent, 99);
      stage = "Поставка в исполнении";
    }

    if (orders.length > 0 && orderStatuses.every((value) => value === "closed")) {
      percent = 100;
      stage = "Исполнение завершено";
      tone = "done";
    }

    if (shipments.length > 0 && shipmentStatuses.every((value) => value === "closed")) {
      percent = 100;
      stage = "Исполнение завершено";
      tone = "done";
    }

    return { percent, stage, tone };
  }

  app.get("/api/dashboard", authRequired, async (req, res) => {
    const [allTenders, allOrders, allShipments, notifications, logs, dashboardTasks] = await Promise.all([
      db.all("SELECT * FROM tenders ORDER BY deadline ASC, id DESC"),
      db.all(
        `SELECT o.*, t.number AS tender_number, t.lot AS tender_lot, t.client AS tender_client
         FROM tender_orders o
         JOIN tenders t ON t.id = o.tender_id`
      ),
      db.all(
        `SELECT s.*, o.tender_id, o.order_number
         FROM shipment_workflows s
         JOIN tender_orders o ON o.id = s.order_id`
      ),
      db.all("SELECT id, text, created_at FROM notifications ORDER BY created_at DESC LIMIT 6"),
      db.all("SELECT id, text, created_at FROM logs ORDER BY created_at DESC LIMIT 14"),
      db.all(
        `SELECT t.*, assignee.name AS assignee, assignee.role AS assignee_role,
                creator.name AS creator_name, creator.role AS creator_role
         FROM tasks t
         LEFT JOIN users assignee ON assignee.id = t.user_id
         LEFT JOIN users creator ON creator.id = t.created_by
         WHERE (t.user_id = ? OR t.created_by = ?)
           AND t.status <> 'done'
         ORDER BY CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                  COALESCE(t.due_date, '9999-12-31') ASC,
                  t.created_at DESC
         LIMIT 8`,
        [req.user.id, req.user.id]
      ),
    ]);

    const activeTenders = allTenders.filter((row) => !Number(row.is_archived || 0));
    const workingTenders = activeTenders.filter((row) => !["executed", "closed"].includes(String(row.status || "")));

    const focusTenders = workingTenders
      .map((tender) => {
        const tenderOrders = allOrders.filter((row) => Number(row.tender_id) === Number(tender.id));
        const tenderShipments = allShipments.filter((row) => Number(row.tender_id) === Number(tender.id));
        const progress = calculateTenderDashboardProgress(tender, tenderOrders, tenderShipments);
        const orderAmount = tenderOrders.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const deadlineTs = tender.deadline ? new Date(`${tender.deadline}T00:00:00`).getTime() : NaN;
        const todayTs = new Date().setHours(0, 0, 0, 0);
        const daysLeft = Number.isNaN(deadlineTs) ? null : Math.ceil((deadlineTs - todayTs) / 86400000);
        return {
          id: tender.id,
          number: tender.number,
          lot: tender.lot,
          client: tender.client,
          price: Number(tender.price || 0),
          deadline: tender.deadline,
          status: tender.status,
          internal_status: tender.internal_status,
          progress_percent: progress.percent,
          progress_stage: progress.stage,
          progress_tone: progress.tone,
          orders_count: tenderOrders.length,
          shipments_count: tenderShipments.length,
          order_amount: orderAmount,
          days_left: daysLeft,
        };
      })
      .sort((left, right) => {
        const leftDays = left.days_left == null ? 99999 : left.days_left;
        const rightDays = right.days_left == null ? 99999 : right.days_left;
        if (leftDays !== rightDays) return leftDays - rightDays;
        return right.progress_percent - left.progress_percent;
      })
      .slice(0, 8);

    const avgTenderProgress = focusTenders.length
      ? Math.round(focusTenders.reduce((sum, row) => sum + Number(row.progress_percent || 0), 0) / focusTenders.length)
      : 0;
    const dueSoonCount = focusTenders.filter((row) => row.days_left !== null && row.days_left <= 7).length;
    const activeShipments = allShipments.filter((row) => String(row.status || "") !== "closed").length;
    const signedCount = workingTenders.filter((row) => ["signed_both", "signed_ours"].includes(String(row.internal_status || "")) || String(row.status || "") === "signed").length;
    const totalRevenue = allOrders.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const activeOrders = allOrders.filter((row) => !["closed", "stocked"].includes(String(row.status || ""))).length;

    res.json({
      kpi: {
        activeTenders: workingTenders.length,
        activeOrders,
        activeShipments,
        avgTenderProgress,
        signedCount,
        dueSoonCount,
        revenue: Number(totalRevenue || 0),
      },
      tenders: focusTenders,
      tasks: dashboardTasks,
      recentChanges: logs.map((row) => ({
        id: row.id,
        text: row.text,
        created_at: row.created_at,
        type: "log",
      })),
      notifications,
    });
  });

  app.get("/api/tenders", authRequired, async (req, res) => {
    const todayIso = new Date().toISOString().slice(0, 10);
    await db.run(
      `UPDATE tenders
       SET status = 'commission'
       WHERE is_archived = 0
         AND internal_status = 'submitted'
         AND deadline <= ?
         AND status NOT IN ('commission', 'awaiting_signing', 'signed', 'closed')`,
      [todayIso]
    );

    const search = String(req.query.search || "").trim();
    const statusFilter = String(req.query.status || "").trim();
    const internalStatusFilter = String(req.query.internal_status || "").trim();
    const archived = String(req.query.archived || "0").trim();

    const where = [];
    const params = [];

    if (archived === "1") {
      where.push("is_archived = 1");
    } else if (archived !== "both") {
      where.push("is_archived = 0");
    }
    if (statusFilter) { where.push("status = ?"); params.push(statusFilter); }
    if (internalStatusFilter) { where.push("internal_status = ?"); params.push(internalStatusFilter); }
    if (search) {
      where.push("(number LIKE ? OR lot LIKE ? OR client LIKE ?)");
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const data = await db.all(`SELECT * FROM tenders ${whereClause} ORDER BY id DESC`, params);
    res.json({ items: data });
  });

  app.get("/api/tenders/:id", authRequired, async (req, res) => {
    const tender = await db.get("SELECT * FROM tenders WHERE id = ?", [req.params.id]);
    if (!tender) return res.status(404).json({ error: "Тендер не найден" });
    res.json(tender);
  });

  // Вспомогательные функции для парсинга gov.ru
  function extractByTitle(html, title) {
    const escaped = title
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    const re = new RegExp(
      `<div[^>]*class="[^"]*common-text__title[^"]*"[^>]*>\\s*${escaped}\\s*<\\/div>[\\s\\S]*?<div[^>]*class="[^"]*common-text__value[^"]*"[^>]*>([\\s\\S]*?)<\\/div>`,
      "i"
    );
    const m = html.match(re);
    return m ? stripTags(m[1]) : "";
  }

  function extractByBodyTitle(html, title) {
    const escaped = title
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    const re = new RegExp(
      `<div[^>]*class="[^"]*registry-entry__body-title[^"]*"[^>]*>\\s*${escaped}\\s*<\\/div>[\\s\\S]*?<div[^>]*class="[^"]*registry-entry__body-value[^"]*"[^>]*>([\\s\\S]*?)<\\/div>`,
      "i"
    );
    const m = html.match(re);
    return m ? stripTags(m[1]) : "";
  }

  function extractByDataTitle(html, title) {
    const escaped = title
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    const re = new RegExp(
      `<div[^>]*class="[^"]*data-block__title[^"]*"[^>]*>\\s*${escaped}\\s*<\\/div>[\\s\\S]*?<div[^>]*class="[^"]*data-block__value[^"]*"[^>]*>([\\s\\S]*?)<\\/div>`,
      "i"
    );
    const m = html.match(re);
    return m ? stripTags(m[1]) : "";
  }

  function extractByPriceTitle(html, title) {
    const escaped = title
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    const re = new RegExp(
      `<div[^>]*class="[^"]*price-block__title[^"]*"[^>]*>\\s*${escaped}\\s*<\\/div>[\\s\\S]*?<div[^>]*class="[^"]*price-block__value[^"]*"[^>]*>([\\s\\S]*?)<\\/div>`,
      "i"
    );
    const m = html.match(re);
    return m ? stripTags(m[1]) : "";
  }

  function extractFirstByClass(html, className) {
    const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `<[^>]*class="[^"]*${escaped}[^"]*"[^>]*>([\\s\\S]*?)<\\/[^>]+>`,
      "i"
    );
    const m = html.match(re);
    return m ? stripTags(m[1]) : "";
  }

  function extractByGrayLabel(html, label) {
    const escaped = label
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    const re = new RegExp(
      `<div[^>]*common-text__value--gray[^>]*>\\s*${escaped}\\s*<\\/div>[\\s\\S]*?<div[^>]*class="[^"]*common-text__value[^"]*"[^>]*>([\\s\\S]*?)<\\/div>`,
      "i"
    );
    const m = html.match(re);
    return m ? stripTags(m[1]) : "";
  }

  function extractNoticeInfoId(url) {
    const m = String(url || "").match(/noticeInfoId=(\d+)/i);
    return m ? m[1] : "";
  }

  function buildNoticeUrls(noticeId) {
    const id = String(noticeId || "").trim();
    if (!id) return null;
    return {
      commonInfo: `https://zakupki.gov.ru/epz/order/notice/notice223/common-info.html?noticeInfoId=${id}`,
      documents: `https://zakupki.gov.ru/epz/order/notice/notice223/documents.html?noticeInfoId=${id}`,
    };
  }

  function extractTenderMeta(html, url) {
    const registryNumber = extractByTitle(html, "Реестровый номер извещения") || extractNoticeInfoId(url);
    const lot = extractByTitle(html, "Наименование закупки") || extractByBodyTitle(html, "Объект закупки");
    const client = extractByTitle(html, "Наименование организации") || extractByBodyTitle(html, "Заказчик") || "Заказчик не определён";
    const priceText =
      extractFirstByClass(html, "price-block__value") ||
      extractByPriceTitle(html, "Начальная цена") ||
      extractByDataTitle(html, "Начальная цена") ||
      extractByTitle(html, "Начальная цена") ||
      stripTags((html.match(/Начальная\s+цена[\s\S]{0,250}?>([\d\s.,]+)\s*(?:₽|&#8381;|руб)/i) || [])[1] || "");
    const deadlineText =
      extractByTitle(html, "Дата и время окончания срока подачи заявок (по местному времени заказчика)") ||
      extractByDataTitle(html, "Окончание подачи заявок");

    const publicationDate = parseRuDateToIso(
      extractByTitle(html, "Дата размещения извещения") || extractByDataTitle(html, "Размещено")
    );
    const updateDate = parseRuDateToIso(
      extractByTitle(html, "Дата размещения текущей редакции извещения") || extractByDataTitle(html, "Обновлено")
    );

    return {
      number: registryNumber || `IMPORT-${Date.now()}`,
      registry_number: registryNumber,
      lot: lot || "Без названия",
      client,
      price: parseMoney(priceText),
      deadline: parseRuDateToIso(deadlineText) || "",
      status: "open",
      source_url: url,
      procurement_method: extractByTitle(html, "Способ осуществления закупки"),
      platform_name: extractByTitle(html, "Наименование электронной площадки в информационно-телекоммуникационной сети «Интернет»"),
      platform_url: extractByTitle(html, "Адрес электронной площадки в информационно-телекоммуникационной сети «Интернет»"),
      publication_date: publicationDate,
      update_date: updateDate,
      decision_date: parseRuDateToIso(extractByTitle(html, "Дата принятия решения о внесении изменений")),
      customer_inn: extractByGrayLabel(html, "ИНН"),
      customer_kpp: extractByGrayLabel(html, "КПП"),
      customer_ogrn: extractByGrayLabel(html, "ОГРН"),
      customer_address: extractByTitle(html, "Место нахождения"),
      customer_postal_address: extractByTitle(html, "Почтовый адрес"),
      contact_name: extractByTitle(html, "Контактное лицо"),
      contact_email: extractByTitle(html, "Адрес электронной почты"),
      contact_phone: extractByTitle(html, "Контактный телефон"),
      application_start: parseRuDateToIso(extractByTitle(html, "Дата начала срока подачи заявок")),
      application_end: parseRuDateToIso(deadlineText),
      documents: extractTenderDocuments(html, url),
      parsed_at: new Date().toISOString(),
    };
  }

  // Парсинг URL закупок с gov.ru
  app.post("/api/tenders/parse-url", authRequired, async (req, res) => {
    const { url, html: providedHtml, tenderId, noticeInfoId } = req.body;
    const detectedId = String(noticeInfoId || tenderId || extractNoticeInfoId(url) || "").trim();
    const urls = buildNoticeUrls(detectedId);

    if (!url && !providedHtml && !detectedId) {
      return res.status(400).json({
        success: false,
        message: "Передайте ID закупки (noticeInfoId), URL или HTML карточки тендера",
      });
    }

    const FETCH_TIMEOUT = 8000;
    const fetchWithTimeout = async (targetUrl) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      try {
        const r = await fetch(targetUrl, {
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        });
        return r.ok ? r.text() : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      let html = String(providedHtml || "");

      // Priority 1: fetch common-info by ID
      if (!html && urls?.commonInfo) {
        html = await fetchWithTimeout(urls.commonInfo) || "";
      }

      // Priority 2: explicit URL (if id fetch failed/skipped)
      if (!html && url && url.startsWith("http")) {
        html = await fetchWithTimeout(url) || "";
      }

      // Parse whatever HTML we have (may be empty — that's OK, we return partial data)
      const parsed = extractTenderMeta(html, (urls?.commonInfo || url || ""));
      if (detectedId) {
        parsed.number = parsed.number || detectedId;
        parsed.registry_number = parsed.registry_number || detectedId;
      }
      if (!parsed.source_url && urls?.commonInfo) {
        parsed.source_url = urls.commonInfo;
      }

      // Try to fetch documents page; failure is non-fatal
      const docsUrl = urls?.documents || "";
      if (docsUrl) {
        const docsHtml = await fetchWithTimeout(docsUrl);
        if (docsHtml) {
          const docs = extractTenderDocuments(docsHtml, docsUrl);
          if (docs.length) parsed.documents = docs;
        }
      }

      // Ensure deadline has a sensible default
      if (!parsed.deadline) {
        const d = new Date();
        d.setDate(d.getDate() + 14);
        parsed.deadline = d.toISOString().split("T")[0];
      }

      // Return partial=true when we couldn't fetch live data so frontend can warn user
      const partial = !html;
      res.json({ success: true, partial, data: parsed });
    } catch (error) {
      console.error("Parse error:", error);
      res.status(400).json({
        success: false,
        message: `Ошибка парсинга: ${error.message}. Попробуйте заполнить данные вручную.`,
      });
    }
  });

  app.post("/api/tenders", authRequired, roleRequired("manager", "admin"), async (req, res) => {
    const {
      number, lot, client, price, deadline, status,
      participation_fee = 5000, delivery_cost = 5000, bank_guarantee_cost = 0, vat_rate = 22,
      source_url = "", registry_number = "", procurement_method = "",
      platform_name = "", platform_url = "", publication_date = "", update_date = "", decision_date = "",
      customer_inn = "", customer_kpp = "", customer_ogrn = "", customer_address = "", customer_postal_address = "",
      contact_name = "", contact_email = "", contact_phone = "", application_start = "", application_end = "",
      documents = [],
    } = req.body;
    if (!number || !lot || !client || !price || !deadline || !status) {
      return res.status(400).json({ message: "Нужно заполнить все поля" });
    }

    const result = await db.run(
      `INSERT INTO tenders (
        number, lot, client, price, deadline, status, internal_status,
        participation_fee, delivery_cost, bank_guarantee_cost, vat_rate,
        source_url, registry_number, procurement_method, platform_name, platform_url,
        publication_date, update_date, decision_date,
        customer_inn, customer_kpp, customer_ogrn, customer_address, customer_postal_address,
        contact_name, contact_email, contact_phone, application_start, application_end
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        number, lot, client, Number(price), deadline, status, "awaiting_picking",
        Number(participation_fee || 5000), Number(delivery_cost || 5000), Number(bank_guarantee_cost || 0), Number(vat_rate || 22),
        source_url, registry_number, procurement_method, platform_name, platform_url,
        publication_date, update_date, decision_date,
        customer_inn, customer_kpp, customer_ogrn, customer_address, customer_postal_address,
        contact_name, contact_email, contact_phone, application_start, application_end,
      ]
    );

    // Create/update a client card from imported customer and contacts.
    const existingClient = await db.get("SELECT id FROM clients WHERE company = ?", [client]);
    if (!existingClient && (contact_name || contact_email || contact_phone)) {
      await db.run(
        `INSERT INTO clients (company, person, email, phone, segment)
         VALUES (?, ?, ?, ?, ?)`,
        [
          client,
          contact_name || "Не указан",
          contact_email || "-",
          contact_phone || "-",
          "Крупный",
        ]
      );
    }

    const inputDocs = Array.isArray(documents) ? documents : [];
    for (let i = 0; i < inputDocs.length; i += 1) {
      const doc = inputDocs[i];
      if (!doc || !doc.source_url) continue;
      const ext = String(doc.file_ext || "").toLowerCase();
      if (!["pdf", "doc", "docx", "xls", "xlsx"].includes(ext)) continue;
      let local = { local_url: "", file_size: 0, file_name: sanitizeFileName(doc.file_name || `document.${ext}`) };
      try {
        local = await downloadTenderDocument(result.lastID, {
          ...doc,
          file_ext: ext,
          file_name: doc.file_name || `document.${ext}`,
        }, i);
      } catch (error) {
        // Keep source URL even when remote download fails.
      }
      await db.run(
        `INSERT INTO tender_files (tender_id, file_name, file_ext, doc_type, source_url, local_url, file_size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          result.lastID,
          local.file_name,
          ext,
          doc.doc_type || pickDocType(local.file_name),
          doc.source_url,
          local.local_url,
          Number(local.file_size || 0),
          Date.now(),
        ]
      );
    }

    await db.run("INSERT INTO logs (text, created_at) VALUES (?, ?)", [`Добавлен тендер №${number}`, Date.now()]);
    const item = await db.get("SELECT * FROM tenders WHERE id = ?", [result.lastID]);
    res.status(201).json({ item });
  });

  app.put("/api/tenders/:id", authRequired, roleRequired("manager", "admin"), async (req, res) => {
    const { number, lot, client, price, deadline, status } = req.body;
    await db.run(
      `UPDATE tenders SET number = ?, lot = ?, client = ?, price = ?, deadline = ?, status = ? WHERE id = ?`,
      [number, lot, client, Number(price), deadline, status, req.params.id]
    );
    const item = await db.get("SELECT * FROM tenders WHERE id = ?", [req.params.id]);
    res.json({ item });
  });

  app.put("/api/tenders/:id/finance", authRequired, roleRequired("manager", "admin"), async (req, res) => {
    const {
      participation_fee = 5000,
      delivery_cost = 5000,
      bank_guarantee_cost = 0,
      vat_rate = 22,
    } = req.body;

    await db.run(
      `UPDATE tenders
       SET participation_fee = ?, delivery_cost = ?, bank_guarantee_cost = ?, vat_rate = ?
       WHERE id = ?`,
      [
        Number(participation_fee || 0),
        Number(delivery_cost || 0),
        Number(bank_guarantee_cost || 0),
        Number(vat_rate || 0),
        req.params.id,
      ]
    );

    const item = await db.get("SELECT * FROM tenders WHERE id = ?", [req.params.id]);
    res.json({ success: true, item });
  });

  app.delete("/api/tenders/:id", authRequired, roleRequired("admin"), async (req, res) => {
    await db.run("DELETE FROM tenders WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  });

  app.get("/api/tenders/:id/files", authRequired, async (req, res) => {
    const items = await db.all(
      "SELECT * FROM tender_files WHERE tender_id = ? ORDER BY id ASC",
      [req.params.id]
    );
    res.json({ items });
  });

  // ── Подбор товаров снабженцем ──────────────────────────────────────────────
  app.get("/api/tenders/:id/items", authRequired, async (req, res) => {
    const items = await db.all(
      `SELECT ti.*, u.name AS added_by
       FROM tender_items ti
       LEFT JOIN users u ON u.id = ti.user_id
       WHERE ti.tender_id = ?
       ORDER BY ti.id ASC`,
      [req.params.id]
    );
    res.json({ items });
  });

  app.post("/api/tenders/:id/items", authRequired, roleRequired("picker", "admin"), async (req, res) => {
    const tender = await db.get("SELECT internal_status FROM tenders WHERE id = ?", [req.params.id]);
    if (!tender) return res.status(404).json({ message: "Тендер не найден" });
    if (tender.internal_status === "awaiting_application") {
      return res.status(400).json({ message: "Подбор уже завершён. Переводите тендер дальше по процессу." });
    }

    const { article = "", name, quantity, unit = "шт", price_est = 0, note = "" } = req.body;
    if (!name || !quantity) {
      return res.status(400).json({ success: false, message: "Наименование и количество обязательны" });
    }
    const result = await db.run(
      `INSERT INTO tender_items (tender_id, user_id, article, name, quantity, unit, price_est, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, req.user.id, article.trim(), name.trim(), Number(quantity), unit.trim() || "шт", Number(price_est), note.trim(), Date.now()]
    );
    const item = await db.get("SELECT * FROM tender_items WHERE id = ?", [result.lastID]);
    res.json({ success: true, item });
  });

  app.delete("/api/tenders/:id/items/:itemId", authRequired, roleRequired("picker", "admin"), async (req, res) => {
    await db.run("DELETE FROM tender_items WHERE id = ? AND tender_id = ?", [req.params.itemId, req.params.id]);
    res.json({ ok: true });
  });

  app.put("/api/tenders/:id/internal-status", authRequired, roleRequired("picker", "admin"), async (req, res) => {
    const { internal_status } = req.body;
    if (internal_status !== "awaiting_application") {
      return res.status(400).json({ message: "Разрешён только перевод в статус 'ожидает подачи заявки'" });
    }

    const tender = await db.get("SELECT id FROM tenders WHERE id = ?", [req.params.id]);
    if (!tender) return res.status(404).json({ message: "Тендер не найден" });

    const countRow = await db.get("SELECT COUNT(*) AS count FROM tender_items WHERE tender_id = ?", [req.params.id]);
    if (!countRow || Number(countRow.count || 0) === 0) {
      return res.status(400).json({ message: "Нельзя завершить подбор без товарных позиций" });
    }

    await db.run("UPDATE tenders SET internal_status = ? WHERE id = ?", [internal_status, req.params.id]);
    const item = await db.get("SELECT * FROM tenders WHERE id = ?", [req.params.id]);
    res.json({ success: true, item });
  });

  app.get("/api/tenders/:id/submission-package", authRequired, async (req, res) => {
    const pkgDir = path.join(__dirname, "data", "submission_packages", String(req.params.id));
    try {
      const dirEntries = await fsp.readdir(pkgDir, { withFileTypes: true });
      const files = [];
      for (const entry of dirEntries) {
        if (!entry.isFile()) continue;
        const absPath = path.join(pkgDir, entry.name);
        const stat = await fsp.stat(absPath);
        files.push({
          file_name: entry.name,
          file_size: Number(stat.size || 0),
          local_url: `/submission-files/${req.params.id}/${entry.name}`,
          created_at: Number(stat.mtimeMs || Date.now()),
        });
      }
      files.sort((a, b) => a.file_name.localeCompare(b.file_name));
      res.json({ items: files });
    } catch {
      res.json({ items: [] });
    }
  });

  app.post("/api/tenders/:id/submission-package/generate", authRequired, roleRequired("manager"), async (req, res) => {
    try {
      const files = await generateSubmissionPackage(db, req.params.id);
      await db.run(
        "INSERT INTO logs (text, created_at) VALUES (?, ?)",
        [`Сгенерирован комплект документов для подачи заявки по тендеру ID ${req.params.id}`, Date.now()]
      );
      res.json({ success: true, items: files });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message || "Не удалось сгенерировать комплект документов" });
    }
  });

  app.put("/api/tenders/:id/notice-number", authRequired, roleRequired("manager"), async (req, res) => {
    const notice_number = String(req.body.notice_number || "").trim();
    if (!notice_number) {
      return res.status(400).json({ success: false, message: "Укажите номер извещения" });
    }

    const tender = await db.get("SELECT id, internal_status FROM tenders WHERE id = ?", [req.params.id]);
    if (!tender) return res.status(404).json({ success: false, message: "Тендер не найден" });
    if (tender.internal_status !== "awaiting_application") {
      return res.status(400).json({ success: false, message: "Действие доступно только в статусе 'Ожидает подачи заявки'" });
    }

    const pkgDir = path.join(__dirname, "data", "submission_packages", String(req.params.id));
    let hasPackage = false;
    try {
      const dirEntries = await fsp.readdir(pkgDir, { withFileTypes: true });
      hasPackage = dirEntries.some((x) => x.isFile());
    } catch {
      hasPackage = false;
    }
    if (!hasPackage) {
      return res.status(400).json({ success: false, message: "Сначала сгенерируйте комплект документов" });
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    await db.run(
      "UPDATE tenders SET notice_number = ?, internal_status = 'submitted', submitted_at = ? WHERE id = ?",
      [notice_number, todayIso, req.params.id]
    );
    await db.run(
      "INSERT INTO logs (text, created_at) VALUES (?, ?)",
      [`Заявка подана по тендеру ID ${req.params.id}, номер извещения: ${notice_number}`, Date.now()]
    );
    const item = await db.get("SELECT * FROM tenders WHERE id = ?", [req.params.id]);
    res.json({ success: true, item });
  });

  app.put("/api/tenders/:id/contract-sign", authRequired, roleRequired("manager", "admin"), async (req, res) => {
    const stage = String(req.body.stage || "").trim();
    if (!["signed_ours", "signed_both"].includes(stage)) {
      return res.status(400).json({ success: false, message: "Передайте stage: signed_ours или signed_both" });
    }

    const tender = await db.get("SELECT id, number, internal_status, status FROM tenders WHERE id = ?", [req.params.id]);
    if (!tender) return res.status(404).json({ success: false, message: "Тендер не найден" });

    if (stage === "signed_ours" && tender.internal_status !== "won_waiting_sign") {
      return res.status(400).json({ success: false, message: "Сначала тендер должен быть в статусе 'Выиграли'" });
    }
    if (stage === "signed_both" && tender.internal_status !== "signed_ours") {
      return res.status(400).json({ success: false, message: "Сначала подпишите договор с нашей стороны" });
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    if (stage === "signed_ours") {
      await db.run(
        `UPDATE tenders
         SET internal_status = 'signed_ours',
             contract_signed_ours_at = ?
         WHERE id = ?`,
        [todayIso, req.params.id]
      );
      await db.run(
        "INSERT INTO logs (text, created_at) VALUES (?, ?)",
        [`Тендер №${tender.number}: договор подписан с нашей стороны`, Date.now()]
      );
    } else {
      await db.run(
        `UPDATE tenders
         SET internal_status = 'signed_both',
             contract_signed_both_at = ?,
             status = 'signed'
         WHERE id = ?`,
        [todayIso, req.params.id]
      );
      await db.run(
        "INSERT INTO logs (text, created_at) VALUES (?, ?)",
        [`Тендер №${tender.number}: договор подписан с двух сторон, статус площадки -> Подписан`, Date.now()]
      );
    }

    const item = await db.get("SELECT * FROM tenders WHERE id = ?", [req.params.id]);
    res.json({ success: true, item });
  });

  app.put("/api/tenders/:id/commission-decision", authRequired, roleRequired("manager", "admin"), async (req, res) => {
    const decision = String(req.body.decision || "").trim();
    if (!["won", "lost"].includes(decision)) {
      return res.status(400).json({ success: false, message: "Укажите решение: won или lost" });
    }

    const tender = await db.get("SELECT id, status, number FROM tenders WHERE id = ?", [req.params.id]);
    if (!tender) return res.status(404).json({ success: false, message: "Тендер не найден" });
    if (tender.status !== "commission") {
      return res.status(400).json({ success: false, message: "Решение комиссии доступно только в статусе 'Работа комиссии'" });
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    if (decision === "lost") {
      await db.run(
        `UPDATE tenders
         SET status = 'closed',
             internal_status = 'archived_lost',
             commission_decision = 'lost',
             is_archived = 1,
             archived_at = ?
         WHERE id = ?`,
        [todayIso, req.params.id]
      );
      await db.run(
        "INSERT INTO logs (text, created_at) VALUES (?, ?)",
        [`Тендер №${tender.number} завершен с результатом 'Проиграли' и перенесен в архив`, Date.now()]
      );
    } else {
      await db.run(
        `UPDATE tenders
         SET status = 'awaiting_signing',
             internal_status = 'won_waiting_sign',
             commission_decision = 'won'
         WHERE id = ?`,
        [req.params.id]
      );
      await db.run(
        "INSERT INTO logs (text, created_at) VALUES (?, ?)",
        [`Тендер №${tender.number}: решение комиссии 'Выиграли', статус -> 'Ожидание подписания на площадке'`, Date.now()]
      );
    }

    const item = await db.get("SELECT * FROM tenders WHERE id = ?", [req.params.id]);
    res.json({ success: true, item });
  });

  app.get("/api/orders/eligible-tenders", authRequired, roleRequired("picker", "admin"), async (req, res) => {
    const tenders = await db.all(
      `SELECT id, number, lot, client, price, internal_status
       FROM tenders
       WHERE is_archived = 0
         AND internal_status = 'signed_both'
       ORDER BY id DESC`
    );

    const items = [];
    for (const tender of tenders) {
      const remainingItems = await getTenderItemRemaining(db, tender.id);
      const hasRemaining = remainingItems.some((it) => Number(it.remaining_qty || 0) > 0);
      if (!hasRemaining) continue;
      items.push({
        ...tender,
        items: remainingItems,
      });
    }

    res.json({ items });
  });

  app.post("/api/orders", authRequired, roleRequired("picker", "admin"), async (req, res) => {
    const tenderId = Number(req.body.tender_id);
    const orderNumber = String(req.body.order_number || "").trim();
    const supplyDate = String(req.body.supply_date || "").trim();
    const amount = Number(req.body.amount || 0);
    const requestedItems = Array.isArray(req.body.items) ? req.body.items : [];

    if (!tenderId || !orderNumber || !supplyDate || amount <= 0) {
      return res.status(400).json({ success: false, message: "Заполните номер заказа, дату поставки и сумму" });
    }

    const tender = await db.get("SELECT id, number, client, internal_status FROM tenders WHERE id = ?", [tenderId]);
    if (!tender) return res.status(404).json({ success: false, message: "Тендер не найден" });
    if (String(tender.internal_status || "") !== "signed_both") {
      return res.status(400).json({ success: false, message: "Создавать заказы можно только по подписанному договору" });
    }

    const cleanItems = requestedItems
      .map((it) => ({
        tender_item_id: Number(it.tender_item_id),
        quantity: Number(it.quantity),
        price_actual: it.price_actual != null ? Number(it.price_actual) : null,
      }))
      .filter((it) => it.tender_item_id > 0 && it.quantity > 0);

    if (cleanItems.length === 0) {
      return res.status(400).json({ success: false, message: "Выберите хотя бы одну позицию с количеством" });
    }

    const remainingItems = await getTenderItemRemaining(db, tenderId);
    const byId = new Map(remainingItems.map((it) => [Number(it.id), it]));

    for (const reqItem of cleanItems) {
      const src = byId.get(reqItem.tender_item_id);
      if (!src) {
        return res.status(400).json({ success: false, message: "Одна из позиций не найдена" });
      }
      if (reqItem.quantity > Number(src.remaining_qty || 0)) {
        return res.status(400).json({
          success: false,
          message: `Превышено доступное количество по позиции '${src.name}'. Остаток: ${src.remaining_qty}`,
        });
      }
    }

    await db.exec("BEGIN TRANSACTION");
    try {
      const invoiceItems = [];
      const orderResult = await db.run(
        `INSERT INTO tender_orders (tender_id, order_number, supply_date, amount, status, created_by, created_at)
         VALUES (?, ?, ?, ?, 'awaiting_payment', ?, ?)`,
        [tenderId, orderNumber, supplyDate, amount, req.user.id, Date.now()]
      );

      for (const reqItem of cleanItems) {
        const src = byId.get(reqItem.tender_item_id);
        const priceUsed = reqItem.price_actual != null ? reqItem.price_actual : Number(src.price_est || 0);
        const total = Number(reqItem.quantity) * priceUsed;
        invoiceItems.push({
          article: src.article,
          name: src.name,
          unit: src.unit,
          quantity: Number(reqItem.quantity),
          price: priceUsed,
          total,
        });
        await db.run(
          `INSERT INTO tender_order_items (order_id, tender_item_id, quantity, price_est, total)
           VALUES (?, ?, ?, ?, ?)`,
          [orderResult.lastID, reqItem.tender_item_id, Number(reqItem.quantity), priceUsed, total]
        );
      }

      const todayIso = new Date().toISOString().slice(0, 10);
      const invoiceNo = `INV-${orderNumber}-${Date.now()}`;
      const invoiceFileName = `${invoiceNo}.html`;
      const invoiceDir = path.join(__dirname, "data", "invoices", String(orderResult.lastID));
      await fsp.mkdir(invoiceDir, { recursive: true });
      const invoiceContent = await renderInvoiceFromTemplate({
        title: "СЧЕТ НА ОПЛАТУ",
        number: invoiceNo,
        date: todayIso,
        orderNumber,
        tenderNumber: tender.number,
        client: tender.client,
        amount: Number(amount || 0),
        purpose: "Оплата поставки товара",
        items: invoiceItems,
      });
      await fsp.writeFile(path.join(invoiceDir, invoiceFileName), invoiceContent, "utf8");
      await db.run(
        `INSERT INTO order_invoices (order_id, invoice_number, amount, status, issue_date, paid_at, file_url, created_at)
         VALUES (?, ?, ?, 'unpaid', ?, '', ?, ?)`,
        [
          orderResult.lastID,
          invoiceNo,
          Number(amount || 0),
          todayIso,
          `/invoices/${orderResult.lastID}/${invoiceFileName}`,
          Date.now(),
        ]
      );

      await db.run(
        "INSERT INTO logs (text, created_at) VALUES (?, ?)",
        [`Создан заказ ${orderNumber} по тендеру №${tender.number}. Счет ${invoiceNo} создан автоматически`, Date.now()]
      );
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }

    const item = await db.get("SELECT * FROM tender_orders WHERE order_number = ? ORDER BY id DESC LIMIT 1", [orderNumber]);
    res.status(201).json({ success: true, item });
  });

  app.get("/api/orders", authRequired, async (req, res) => {
    await syncShipmentWithOrders(db);

    const search = String(req.query.search || "").trim();
    const statusFilter = String(req.query.status || "").trim();
    const archived = String(req.query.archived || "0").trim();

    const where = [];
    const params = [];

    const archivedStatuses = ["stocked", "closed"];
    if (archived !== "1" && !archivedStatuses.includes(statusFilter)) {
      where.push("o.status NOT IN ('stocked', 'closed')");
    }
    if (statusFilter) { where.push("o.status = ?"); params.push(statusFilter); }
    if (search) {
      where.push("(o.order_number LIKE ? OR t.number LIKE ? OR t.client LIKE ?)");
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const orders = await db.all(
      `SELECT
        o.*,
        t.number AS tender_number,
        t.client,
        t.lot,
        i.id AS invoice_id,
        i.invoice_number,
        i.status AS invoice_status,
        i.amount AS invoice_amount,
        i.issue_date AS invoice_issue_date,
        i.paid_at AS invoice_paid_at,
        i.file_url AS invoice_file_url
       FROM tender_orders o
       JOIN tenders t ON t.id = o.tender_id
       LEFT JOIN order_invoices i ON i.order_id = o.id
       ${whereClause}
       ORDER BY o.id DESC`,
      params
    );

    const orderIds = orders.map((o) => Number(o.id));
    let rows = [];
    if (orderIds.length) {
      const placeholders = orderIds.map(() => "?").join(",");
      rows = await db.all(
        `SELECT
          toi.order_id,
          toi.tender_item_id,
          toi.quantity,
          toi.price_est,
          toi.total,
          ti.article,
          ti.name,
          ti.unit
         FROM tender_order_items toi
         JOIN tender_items ti ON ti.id = toi.tender_item_id
         WHERE toi.order_id IN (${placeholders})
         ORDER BY toi.id ASC`,
        orderIds
      );
    }

    const grouped = new Map();
    for (const row of rows) {
      const key = Number(row.order_id);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }

    const items = orders.map((o) => ({
      ...o,
      amount: Number(o.amount || 0),
      items: grouped.get(Number(o.id)) || [],
    }));

    res.json({ items: moneyRow(items) });
  });

  app.get("/api/orders/:id", authRequired, async (req, res) => {
    const order = await db.get(
      `SELECT
        o.*,
        t.id AS tender_id,
        t.number AS tender_number,
        t.client,
        t.lot
       FROM tender_orders o
       JOIN tenders t ON t.id = o.tender_id
       WHERE o.id = ?`,
      [req.params.id]
    );
    if (!order) return res.status(404).json({ error: "Заказ не найден" });
    res.json(order);
  });

  app.put("/api/orders/:id/status", authRequired, roleRequired("manager", "admin", "picker"), async (req, res) => {
    const status = String(req.body.status || "").trim();
    const order = await db.get("SELECT id, order_number, status FROM tender_orders WHERE id = ?", [req.params.id]);
    if (!order) return res.status(404).json({ success: false, message: "Заказ не найден" });

    if (req.user.role === "picker") {
      if (!(order.status === "paid" && status === "stocked")) {
        return res.status(403).json({ success: false, message: "Подборщик может переводить только 'Оплачен' -> 'Поставлен на склад'" });
      }
    }

    await db.run("UPDATE tender_orders SET status = ? WHERE id = ?", [status, req.params.id]);
    if (status === "stocked") {
      const existingShipment = await db.get("SELECT id FROM shipment_workflows WHERE order_id = ?", [req.params.id]);
      if (!existingShipment) {
        await db.run(
          `INSERT INTO shipment_workflows (order_id, status, transfer_ready, shipment_date, created_at)
           VALUES (?, 'warehouse', 0, '', ?)`,
          [req.params.id, Date.now()]
        );
      }
    }
    await db.run(
      "INSERT INTO logs (text, created_at) VALUES (?, ?)",
      [`Заказ ${order.order_number}: статус изменен на ${status}`, Date.now()]
    );
    const item = await db.get("SELECT * FROM tender_orders WHERE id = ?", [req.params.id]);
    res.json({ item });
  });

  app.put("/api/invoices/:id/status", authRequired, roleRequired("accountant", "admin"), async (req, res) => {
    const status = String(req.body.status || "").trim();
    if (!["paid", "unpaid"].includes(status)) {
      return res.status(400).json({ success: false, message: "Допустимые статусы: paid, unpaid" });
    }

    const invoice = await db.get("SELECT id, order_id, invoice_number FROM order_invoices WHERE id = ?", [req.params.id]);
    if (!invoice) return res.status(404).json({ success: false, message: "Счет не найден" });

    const paidAt = status === "paid" ? new Date().toISOString().slice(0, 10) : "";
    await db.run("UPDATE order_invoices SET status = ?, paid_at = ? WHERE id = ?", [status, paidAt, req.params.id]);

    const nextOrderStatus = status === "paid" ? "paid" : "awaiting_payment";
    await db.run("UPDATE tender_orders SET status = ? WHERE id = ?", [nextOrderStatus, invoice.order_id]);

    await db.run(
      "INSERT INTO logs (text, created_at) VALUES (?, ?)",
      [`Счет ${invoice.invoice_number}: статус ${status === "paid" ? "Оплачен" : "Не оплачен"}`, Date.now()]
    );

    const item = await db.get("SELECT * FROM order_invoices WHERE id = ?", [req.params.id]);
    res.json({ success: true, item });
  });

  app.get("/api/shipments", authRequired, roleRequired("logistic", "accountant", "admin", "manager"), async (req, res) => {
    await syncShipmentWithOrders(db);

    const search = String(req.query.search || "").trim();
    const statusFilter = String(req.query.status || "").trim();
    const archived = String(req.query.archived || "0").trim();

    const where = [];
    const params = [];

    if (archived !== "1" && statusFilter !== "closed") {
      where.push("s.status <> 'closed'");
    }
    if (statusFilter) { where.push("s.status = ?"); params.push(statusFilter); }
    if (search) {
      where.push("(o.order_number LIKE ? OR t.client LIKE ? OR t.number LIKE ?)");
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const items = await db.all(
      `SELECT
        s.*,
        o.id AS order_id,
        o.order_number,
        o.amount,
        o.supply_date,
        o.tender_id,
        t.number AS tender_number,
        t.client,
        t.lot
       FROM shipment_workflows s
       JOIN tender_orders o ON o.id = s.order_id
       JOIN tenders t ON t.id = o.tender_id
       ${whereClause}
       ORDER BY s.id DESC`,
      params
    );
    res.json({ items });
  });

  app.get("/api/shipments/:id", authRequired, async (req, res) => {
    const shipment = await db.get(
      `SELECT
        s.*,
        o.id AS order_id,
        o.order_number,
        o.amount,
        o.supply_date,
        o.tender_id,
        t.number AS tender_number,
        t.client,
        t.lot
       FROM shipment_workflows s
       JOIN tender_orders o ON o.id = s.order_id
       JOIN tenders t ON t.id = o.tender_id
       WHERE s.id = ?`,
      [req.params.id]
    );
    if (!shipment) return res.status(404).json({ error: "Поставка не найдена" });
    res.json(shipment);
  });

  app.post("/api/shipments/:id/generate-docs", authRequired, roleRequired("accountant", "admin"), async (req, res) => {
    const shipment = await db.get(
      `SELECT s.id, s.order_id, o.order_number, o.amount, t.number AS tender_number, t.client
       FROM shipment_workflows s
       JOIN tender_orders o ON o.id = s.order_id
       JOIN tenders t ON t.id = o.tender_id
       WHERE s.id = ?`,
      [req.params.id]
    );
    if (!shipment) return res.status(404).json({ success: false, message: "Поставка не найдена" });

    const orderItems = await db.all(
      `SELECT ti.article, ti.name, ti.unit, toi.quantity, toi.price_est, toi.total
       FROM tender_order_items toi
       JOIN tender_items ti ON ti.id = toi.tender_item_id
       WHERE toi.order_id = ?
       ORDER BY toi.id ASC`,
      [shipment.order_id]
    );

    const todayIso = new Date().toISOString().slice(0, 10);
    const baseDir = path.join(__dirname, "data", "shipment_docs", String(shipment.id));
    await fsp.mkdir(baseDir, { recursive: true });

    const actNo = compactDocNo("ACT", shipment.id, todayIso);
    const updNo = compactDocNo("UPD", shipment.id, todayIso);
    const invNo = compactDocNo("INV", shipment.id, todayIso);
    const actName = `ACT-${shipment.order_number}.html`;
    const updName = `UPD-${shipment.order_number}.html`;
    const invName = `INVOICE-${shipment.order_number}.html`;

    await fsp.writeFile(
      path.join(baseDir, actName),
      renderActHtml({
        number: actNo,
        date: todayIso,
        orderNumber: shipment.order_number,
        tenderNumber: shipment.tender_number,
        client: shipment.client,
        amount: Number(shipment.amount || 0),
        items: orderItems,
      }),
      "utf8"
    );
    await fsp.writeFile(
      path.join(baseDir, updName),
      await renderUpdFromTemplate({
        number: updNo,
        date: todayIso,
        orderNumber: shipment.order_number,
        tenderNumber: shipment.tender_number,
        client: shipment.client,
        amount: Number(shipment.amount || 0),
        items: orderItems,
      }),
      "utf8"
    );
    await fsp.writeFile(
      path.join(baseDir, invName),
      await renderInvoiceFromTemplate({
        title: "СЧЕТ НА ОПЛАТУ",
        number: invNo,
        date: todayIso,
        orderNumber: shipment.order_number,
        tenderNumber: shipment.tender_number,
        client: shipment.client,
        amount: Number(shipment.amount || 0),
        purpose: "Оплата отгруженного товара",
        items: orderItems,
      }),
      "utf8"
    );

    await db.run(
      `UPDATE shipment_workflows
       SET act_file_url = ?, upd_file_url = ?, invoice_file_url = ?, docs_generated_at = ?
       WHERE id = ?`,
      [
        `/shipment-docs/${shipment.id}/${actName}`,
        `/shipment-docs/${shipment.id}/${updName}`,
        `/shipment-docs/${shipment.id}/${invName}`,
        todayIso,
        req.params.id,
      ]
    );

    const item = await db.get("SELECT * FROM shipment_workflows WHERE id = ?", [req.params.id]);
    res.json({ success: true, item });
  });

  app.put("/api/shipments/:id/handover", authRequired, roleRequired("accountant", "admin"), async (req, res) => {
    const shipment = await db.get("SELECT * FROM shipment_workflows WHERE id = ?", [req.params.id]);
    if (!shipment) return res.status(404).json({ success: false, message: "Поставка не найдена" });
    if (!shipment.act_file_url || !shipment.upd_file_url || !shipment.invoice_file_url) {
      return res.status(400).json({ success: false, message: "Сначала сгенерируйте и приложите документы" });
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    await db.run(
      `UPDATE shipment_workflows
       SET transfer_ready = 1,
           docs_handover_at = ?
       WHERE id = ?`,
      [todayIso, req.params.id]
    );
    const item = await db.get("SELECT * FROM shipment_workflows WHERE id = ?", [req.params.id]);
    res.json({ success: true, item });
  });

  app.put("/api/shipments/:id/status", authRequired, roleRequired("logistic", "admin"), async (req, res) => {
    const nextStatus = String(req.body.status || "").trim();
    const shipment = await db.get("SELECT * FROM shipment_workflows WHERE id = ?", [req.params.id]);
    if (!shipment) return res.status(404).json({ success: false, message: "Поставка не найдена" });

    const allowed = {
      warehouse: ["scheduled"],
      scheduled: ["shipped"],
      shipped: ["received"],
      received: [],
      awaiting_payment: [],
      closed: [],
    };
    if (!shipment.transfer_ready) {
      return res.status(400).json({ success: false, message: "Бухгалтер еще не передал поставку на отгрузку" });
    }
    const current = String(shipment.status || "warehouse");
    if (!allowed[current] || !allowed[current].includes(nextStatus)) {
      return res.status(400).json({ success: false, message: "Недопустимый переход статуса" });
    }

    const finalStatus = nextStatus === "received" ? "awaiting_payment" : nextStatus;
    const shipmentDate = nextStatus === "scheduled" ? String(req.body.shipment_date || "") : shipment.shipment_date;
    await db.run(
      "UPDATE shipment_workflows SET status = ?, shipment_date = ? WHERE id = ?",
      [finalStatus, shipmentDate || "", req.params.id]
    );
    const item = await db.get("SELECT * FROM shipment_workflows WHERE id = ?", [req.params.id]);
    res.json({ success: true, item });
  });

  app.put("/api/shipments/:id/payment", authRequired, roleRequired("accountant", "admin"), async (req, res) => {
    const shipment = await db.get("SELECT * FROM shipment_workflows WHERE id = ?", [req.params.id]);
    if (!shipment) return res.status(404).json({ success: false, message: "Поставка не найдена" });
    if (shipment.status !== "awaiting_payment") {
      return res.status(400).json({ success: false, message: "Оплата доступна только в статусе 'Ожидает оплаты счета'" });
    }
    const todayIso = new Date().toISOString().slice(0, 10);
    await db.run(
      "UPDATE shipment_workflows SET status = 'closed', paid_at = ? WHERE id = ?",
      [todayIso, req.params.id]
    );
    await db.run("UPDATE tender_orders SET status = 'closed' WHERE id = ?", [shipment.order_id]);
    await syncShipmentWithOrders(db);
    const item = await db.get("SELECT * FROM shipment_workflows WHERE id = ?", [req.params.id]);
    res.json({ success: true, item });
  });

  app.get("/api/accounting/overview", authRequired, roleRequired("accountant", "admin"), async (req, res) => {
    await syncShipmentWithOrders(db);

    const [
      signedTenders,
      orders,
      deliveries,
      invoices,
      shipments,
    ] = await Promise.all([
      db.all(
        `SELECT id, number, lot, client, internal_status, status
         FROM tenders
         WHERE is_archived = 0 AND internal_status = 'signed_both'
         ORDER BY id DESC
         LIMIT 20`
      ),
      db.all(
        `SELECT
          o.id, o.order_number, o.amount, o.status, o.supply_date, o.tender_id,
          t.number AS tender_number, t.client, t.lot, t.status AS tender_status, t.internal_status AS tender_internal_status,
          i.id AS invoice_id, i.invoice_number, i.status AS invoice_status, i.issue_date, i.paid_at, i.file_url AS invoice_file_url
         FROM tender_orders o
         JOIN tenders t ON t.id = o.tender_id
         LEFT JOIN order_invoices i ON i.order_id = o.id
         ORDER BY o.id DESC
         LIMIT 50`
      ),
      db.all("SELECT id, track, client, progress, status FROM deliveries ORDER BY id DESC LIMIT 30"),
      db.all("SELECT id, status FROM order_invoices ORDER BY id DESC"),
      db.all(
        `SELECT
          s.*,
          o.id AS order_id,
          o.order_number,
          o.amount,
          o.supply_date,
          o.tender_id,
          t.number AS tender_number,
          t.client,
          t.lot
         FROM shipment_workflows s
         JOIN tender_orders o ON o.id = s.order_id
         JOIN tenders t ON t.id = o.tender_id
         WHERE s.status <> 'closed'
         ORDER BY s.id DESC
         LIMIT 50`
      ),
    ]);

    const totalInvoices = invoices.length;
    const paidCount = invoices.filter((x) => String(x.status) === "paid").length;
    const unpaidCount = invoices.filter((x) => String(x.status) !== "paid").length;
    const paidPercent = totalInvoices > 0 ? (paidCount * 100) / totalInvoices : 0;
    const unpaidPercent = totalInvoices > 0 ? (unpaidCount * 100) / totalInvoices : 0;

    res.json({
      kpi: {
        totalInvoices,
        paidCount,
        unpaidCount,
        paidPercent,
        unpaidPercent,
      },
      signedTenders,
      orders,
      deliveries,
      shipments,
    });
  });

  app.get("/api/deliveries", authRequired, async (req, res) => {
    const items = await db.all("SELECT * FROM deliveries ORDER BY id DESC");
    const logs = await db.all("SELECT * FROM logs ORDER BY created_at DESC LIMIT 12");
    res.json({ items, logs });
  });

  app.put("/api/deliveries/:id/progress", authRequired, roleRequired("manager", "admin"), async (req, res) => {
    const delivery = await db.get("SELECT * FROM deliveries WHERE id = ?", [req.params.id]);
    if (!delivery) {
      return res.status(404).json({ message: "Поставка не найдена" });
    }

    const nextProgress = Math.min(100, Number(delivery.progress) + Number(req.body.step || 10));
    const nextStatus = nextProgress >= 100 ? "closed" : "shipped";
    await db.run("UPDATE deliveries SET progress = ?, status = ? WHERE id = ?", [nextProgress, nextStatus, req.params.id]);

    await db.run(
      "INSERT INTO logs (text, created_at) VALUES (?, ?)",
      [`Обновлена поставка ${delivery.track}: ${nextProgress}%`, Date.now()]
    );

    const item = await db.get("SELECT * FROM deliveries WHERE id = ?", [req.params.id]);
    res.json({ item });
  });

  app.get("/api/clients", authRequired, async (req, res) => {
    const items = await db.all("SELECT * FROM clients ORDER BY id DESC");
    res.json({ items });
  });

  app.get("/api/clients/search", authRequired, async (req, res) => {
    const name = String(req.query.name || "").trim();
    if (!name) return res.status(400).json({ error: "Укажите название компании" });
    let client = await db.get(
      "SELECT * FROM clients WHERE company COLLATE NOCASE = ? LIMIT 1",
      [name]
    );

    if (!client) {
      client = await db.get(
        "SELECT * FROM clients WHERE company COLLATE NOCASE LIKE ? LIMIT 1",
        [`%${name}%`]
      );
    }

    if (!client) return res.status(404).json({ error: "Клиент не найден" });
    res.json(client);
  });

  app.get("/api/clients/:id", authRequired, async (req, res) => {
    const client = await db.get("SELECT * FROM clients WHERE id = ?", [req.params.id]);
    if (!client) return res.status(404).json({ error: "Клиент не найден" });
    res.json(client);
  });

  app.post("/api/clients", authRequired, roleRequired("manager", "admin"), async (req, res) => {
    const { company, person, email, phone, segment } = req.body;
    const result = await db.run(
      `INSERT INTO clients (company, person, email, phone, segment)
       VALUES (?, ?, ?, ?, ?)`,
      [company, person, email, phone, segment]
    );
    const item = await db.get("SELECT * FROM clients WHERE id = ?", [result.lastID]);
    res.status(201).json({ item });
  });

  app.put("/api/clients/:id", authRequired, roleRequired("manager", "admin"), async (req, res) => {
    const { company, person, email, phone, segment } = req.body;
    await db.run(
      "UPDATE clients SET company = ?, person = ?, email = ?, phone = ?, segment = ? WHERE id = ?",
      [company, person, email, phone, segment, req.params.id]
    );
    const item = await db.get("SELECT * FROM clients WHERE id = ?", [req.params.id]);
    res.json({ item });
  });

  app.delete("/api/clients/:id", authRequired, roleRequired("manager", "admin"), async (req, res) => {
    await db.run("DELETE FROM clients WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  });

  app.get("/api/reports", authRequired, async (req, res) => {
    const [ordersCount, ordersSum, tendersOpen, delivered, segments] = await Promise.all([
      db.get("SELECT COUNT(*) AS count FROM tender_orders"),
      db.get("SELECT COALESCE(SUM(amount),0) AS sum FROM tender_orders"),
      db.get("SELECT COUNT(*) AS count FROM tenders WHERE status = 'open'"),
      db.get("SELECT COUNT(*) AS count FROM deliveries WHERE progress >= 100"),
      db.all("SELECT segment, COUNT(*) AS count FROM clients GROUP BY segment"),
    ]);

    res.json({
      summary: {
        ordersCount: ordersCount.count,
        ordersSum: Number(ordersSum.sum || 0),
        openTenders: tendersOpen.count,
        doneDeliveries: delivered.count,
      },
      segments,
    });
  });

  // ─── НМЦК: коммерческие предложения поставщиков ──────────────────────────
  app.get("/api/tenders/:id/quotes", authRequired, async (req, res) => {
    const tender = await db.get("SELECT source_url, status FROM tenders WHERE id = ?", [req.params.id]);
    const isManualDraft = tender && !String(tender.source_url || "").trim() && tender.status === "draft";
    if (!isManualDraft) {
      return res.status(400).json({ message: "КП / НМЦК доступны только для вручную созданных тендеров в статусе 'Черновик'" });
    }
    const quotes = await db.all(
      "SELECT * FROM price_quotes WHERE tender_id = ? ORDER BY price ASC",
      [req.params.id]
    );
    const nmck = quotes.length
      ? Math.round(quotes.reduce((s, q) => s + q.price, 0) / quotes.length)
      : null;
    res.json({ quotes, nmck });
  });

  app.post("/api/tenders/:id/quotes", authRequired, roleRequired("manager", "admin"), async (req, res) => {
    const tender = await db.get("SELECT source_url, status FROM tenders WHERE id = ?", [req.params.id]);
    const isManualDraft = tender && !String(tender.source_url || "").trim() && tender.status === "draft";
    if (!isManualDraft) {
      return res.status(400).json({ message: "КП / НМЦК доступны только для вручную созданных тендеров в статусе 'Черновик'" });
    }
    const { supplier_name, supplier_email, price, delivery_days, note } = req.body;
    if (!supplier_name || !price) {
      return res.status(400).json({ message: "supplier_name и price обязательны" });
    }
    const result = await db.run(
      `INSERT INTO price_quotes (tender_id, supplier_name, supplier_email, price, delivery_days, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, supplier_name, supplier_email || "", Number(price), Number(delivery_days || 0), note || "", Date.now()]
    );
    const item = await db.get("SELECT * FROM price_quotes WHERE id = ?", [result.lastID]);
    res.status(201).json({ item });
  });

  app.delete("/api/tenders/:tenderId/quotes/:id", authRequired, roleRequired("manager", "admin"), async (req, res) => {
    const tender = await db.get("SELECT source_url, status FROM tenders WHERE id = ?", [req.params.tenderId]);
    const isManualDraft = tender && !String(tender.source_url || "").trim() && tender.status === "draft";
    if (!isManualDraft) {
      return res.status(400).json({ message: "КП / НМЦК доступны только для вручную созданных тендеров в статусе 'Черновик'" });
    }
    await db.run("DELETE FROM price_quotes WHERE id = ? AND tender_id = ?", [req.params.id, req.params.tenderId]);
    res.json({ ok: true });
  });

  // ─── Контракты ────────────────────────────────────────────────────────────
  app.get("/api/contracts", authRequired, async (req, res) => {
    const items = await db.all(
      `SELECT c.*, t.number AS tender_number FROM contracts c
       LEFT JOIN tenders t ON t.id = c.tender_id ORDER BY c.id DESC`
    );
    for (const contract of items) {
      contract.stages = await db.all(
        "SELECT * FROM contract_stages WHERE contract_id = ? ORDER BY id ASC",
        [contract.id]
      );
    }
    res.json({ items });
  });

  app.get("/api/contracts/:id", authRequired, async (req, res) => {
    const contract = await db.get(
      `SELECT c.*, t.id AS tender_id, t.number AS tender_number FROM contracts c
       LEFT JOIN tenders t ON t.id = c.tender_id WHERE c.id = ?`,
      [req.params.id]
    );
    if (!contract) return res.status(404).json({ error: "Контракт не найден" });
    contract.stages = await db.all(
      "SELECT * FROM contract_stages WHERE contract_id = ? ORDER BY id ASC",
      [contract.id]
    );
    res.json(contract);
  });

  app.post("/api/contracts", authRequired, roleRequired("manager", "admin"), async (req, res) => {
    const { tender_id, number, client, amount, signed_date, deadline, note } = req.body;
    const result = await db.run(
      `INSERT INTO contracts (tender_id, number, client, amount, signed_date, deadline, status, note)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
      [tender_id || null, number, client, Number(amount), signed_date, deadline, note || ""]
    );
    await db.run("INSERT INTO logs (text, created_at) VALUES (?, ?)",
      [`Создан контракт №${number} с ${client}`, Date.now()]);
    const item = await db.get(
      `SELECT c.*, t.number AS tender_number FROM contracts c LEFT JOIN tenders t ON t.id = c.tender_id WHERE c.id = ?`,
      [result.lastID]
    );
    item.stages = [];
    res.status(201).json({ item });
  });

  app.put("/api/contracts/:id", authRequired, roleRequired("manager", "admin"), async (req, res) => {
    const { number, client, amount, signed_date, deadline, status, note } = req.body;
    await db.run(
      `UPDATE contracts SET number=?, client=?, amount=?, signed_date=?, deadline=?, status=?, note=? WHERE id=?`,
      [number, client, Number(amount), signed_date, deadline, status, note || "", req.params.id]
    );
    const item = await db.get(
      `SELECT c.*, t.number AS tender_number FROM contracts c LEFT JOIN tenders t ON t.id = c.tender_id WHERE c.id = ?`,
      [req.params.id]
    );
    item.stages = await db.all("SELECT * FROM contract_stages WHERE contract_id = ? ORDER BY id", [req.params.id]);
    res.json({ item });
  });

  app.get("/api/contracts/:id/stages", authRequired, async (req, res) => {
    const stages = await db.all(
      "SELECT * FROM contract_stages WHERE contract_id = ? ORDER BY id ASC", [req.params.id]
    );
    res.json({ stages });
  });

  app.post("/api/contracts/:id/stages", authRequired, roleRequired("manager", "admin"), async (req, res) => {
    const { title, percent, due_date } = req.body;
    const result = await db.run(
      `INSERT INTO contract_stages (contract_id, title, percent, status, due_date) VALUES (?, ?, ?, 'pending', ?)`,
      [req.params.id, title, Number(percent || 0), due_date]
    );
    const item = await db.get("SELECT * FROM contract_stages WHERE id = ?", [result.lastID]);
    res.status(201).json({ item });
  });

  app.put("/api/stages/:id", authRequired, roleRequired("manager", "admin"), async (req, res) => {
    const { title, percent, status, due_date, act_number } = req.body;
    const completed_at = status === "done" ? Date.now() : null;
    await db.run(
      `UPDATE contract_stages SET title=?, percent=?, status=?, due_date=?, act_number=?, completed_at=? WHERE id=?`,
      [title, Number(percent), status, due_date, act_number || "", completed_at, req.params.id]
    );
    const item = await db.get("SELECT * FROM contract_stages WHERE id = ?", [req.params.id]);
    res.json({ item });
  });

  app.delete("/api/stages/:id", authRequired, roleRequired("manager", "admin"), async (req, res) => {
    await db.run("DELETE FROM contract_stages WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  });

  // ─── Портал поставщика: заявки на тендеры ─────────────────────────────────
  app.get("/api/applications", authRequired, async (req, res) => {
    const isSupplier = req.user.role === "supplier";
    const query = isSupplier
      ? `SELECT a.*, t.number AS tender_number, t.lot FROM applications a
         LEFT JOIN tenders t ON t.id = a.tender_id
         WHERE a.user_id = ? ORDER BY a.id DESC`
      : `SELECT a.*, t.number AS tender_number, t.lot, u.name AS applicant_name FROM applications a
         LEFT JOIN tenders t ON t.id = a.tender_id
         LEFT JOIN users u ON u.id = a.user_id
         ORDER BY a.id DESC`;
    const params = isSupplier ? [req.user.id] : [];
    const items = await db.all(query, params);
    res.json({ items });
  });

  app.post("/api/applications", authRequired, roleRequired("supplier", "manager", "admin"), async (req, res) => {
    const { tender_id, price, delivery_days, note } = req.body;
    const user = await db.get("SELECT company FROM users WHERE id = ?", [req.user.id]);
    const existing = await db.get(
      "SELECT id FROM applications WHERE tender_id = ? AND user_id = ?",
      [tender_id, req.user.id]
    );
    if (existing) {
      return res.status(409).json({ message: "Вы уже подали заявку на этот тендер" });
    }
    const result = await db.run(
      `INSERT INTO applications (tender_id, user_id, company, price, delivery_days, note, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [tender_id, req.user.id, user.company, Number(price), Number(delivery_days || 0), note || "", Date.now()]
    );
    await db.run(
      "INSERT INTO notifications (text, created_at) VALUES (?, ?)",
      [`Новая заявка от ${user.company} на тендер ID ${tender_id}`, Date.now()]
    );
    const item = await db.get("SELECT * FROM applications WHERE id = ?", [result.lastID]);
    res.status(201).json({ item });
  });

  app.put("/api/applications/:id/status", authRequired, roleRequired("manager", "admin"), async (req, res) => {
    const { status } = req.body;
    await db.run("UPDATE applications SET status = ? WHERE id = ?", [status, req.params.id]);
    const item = await db.get("SELECT * FROM applications WHERE id = ?", [req.params.id]);
    res.json({ item });
  });

  // ─── Задачи ───────────────────────────────────────────────────────────────
  app.get("/api/tasks", authRequired, async (req, res) => {
    const query = `SELECT t.*, assignee.name AS assignee, assignee.role AS assignee_role,
                          creator.name AS creator_name, creator.role AS creator_role
                   FROM tasks t
                   LEFT JOIN users assignee ON assignee.id = t.user_id
                   LEFT JOIN users creator ON creator.id = t.created_by
                   WHERE (t.user_id = ? OR t.created_by = ?)
                   ORDER BY CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                            COALESCE(t.due_date, '9999-12-31') ASC,
                            t.created_at DESC`;
    const params = [req.user.id, req.user.id];
    const items = await db.all(query, params);
    res.json({ items });
  });

  app.post("/api/tasks", authRequired, async (req, res) => {
    const { title, description, priority, due_date, tender_id, order_id, user_id } = req.body;
    if (!title) return res.status(400).json({ message: "title обязателен" });
    const isSupervisor = ["manager", "admin", "director"].includes(String(req.user.role || ""));
    const targetUserId = isSupervisor && user_id ? Number(user_id) : req.user.id;
    const assignee = await db.get("SELECT id, name FROM users WHERE id = ?", [targetUserId]);
    if (!assignee) return res.status(400).json({ message: "Исполнитель не найден" });
    const result = await db.run(
      `INSERT INTO tasks (user_id, created_by, title, description, priority, status, due_date, tender_id, order_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      [
        targetUserId, req.user.id, title, description || "", priority || "medium",
        due_date || null, tender_id || null, order_id || null, Date.now()
      ]
    );
    await db.run(
      "INSERT INTO logs (text, created_at) VALUES (?, ?)",
      [
        `${req.user.role === "manager" || req.user.role === "admin" ? "Руководством поставлена" : "Создана"} задача '${title}'${String(assignee.name || "") ? ` для ${assignee.name}` : ""}`,
        Date.now(),
      ]
    );
    const item = await db.get(
      `SELECT t.*, assignee.name AS assignee, assignee.role AS assignee_role,
                creator.name AS creator_name, creator.role AS creator_role
       FROM tasks t
       LEFT JOIN users assignee ON assignee.id = t.user_id
       LEFT JOIN users creator ON creator.id = t.created_by
       WHERE t.id = ?`,
      [result.lastID]
    );
    res.status(201).json({ item });
  });

  app.put("/api/tasks/:id", authRequired, async (req, res) => {
    const task = await db.get("SELECT * FROM tasks WHERE id = ?", [req.params.id]);
    if (!task) return res.status(404).json({ message: "Задача не найдена" });
    const isSupervisor = ["manager", "admin", "director"].includes(String(req.user.role || ""));
    if (String(task.user_id) !== String(req.user.id) && String(task.created_by || "") !== String(req.user.id)) {
      return res.status(403).json({ message: "Нет доступа" });
    }
    const { title, description, priority, status, due_date, user_id } = req.body;
    const nextUserId = isSupervisor && user_id ? Number(user_id) : task.user_id;
    await db.run(
      `UPDATE tasks SET user_id=?, title=?, description=?, priority=?, status=?, due_date=? WHERE id=?`,
      [nextUserId, title || task.title, description ?? task.description, priority || task.priority, status || task.status, due_date ?? task.due_date, req.params.id]
    );
    const nextStatus = String(status || task.status);
    await db.run(
      "INSERT INTO logs (text, created_at) VALUES (?, ?)",
      [
        nextStatus === "done"
          ? `Задача '${title || task.title}' отмечена выполненной`
          : `Задача '${title || task.title}' обновлена`,
        Date.now(),
      ]
    );
    const item = await db.get(
      `SELECT t.*, assignee.name AS assignee, assignee.role AS assignee_role,
                creator.name AS creator_name, creator.role AS creator_role
       FROM tasks t
       LEFT JOIN users assignee ON assignee.id = t.user_id
       LEFT JOIN users creator ON creator.id = t.created_by
       WHERE t.id = ?`,
      [req.params.id]
    );
    res.json({ item });
  });

  app.delete("/api/tasks/:id", authRequired, async (req, res) => {
    const task = await db.get("SELECT * FROM tasks WHERE id = ?", [req.params.id]);
    if (!task) return res.status(404).json({ message: "Задача не найдена" });
    if (String(task.user_id) !== String(req.user.id) && String(task.created_by || "") !== String(req.user.id)) {
      return res.status(403).json({ message: "Нет доступа" });
    }
    await db.run("DELETE FROM tasks WHERE id = ?", [req.params.id]);
    await db.run(
      "INSERT INTO logs (text, created_at) VALUES (?, ?)",
      [`Задача '${task.title}' удалена`, Date.now()]
    );
    res.json({ ok: true });
  });

  // ─── Email-напоминания по дедлайнам тендеров ──────────────────────────────
  const REMINDER_DAYS = Number(process.env.REMINDER_DAYS || 3);

  function createTransport() {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }

  async function sendDeadlineReminders() {
    const transporter = createTransport();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + REMINDER_DAYS);
    const cutoffIso = cutoff.toISOString().slice(0, 10);

    const tenders = await db.all(
      `SELECT * FROM tenders WHERE status = 'open' AND deadline <= ?`, [cutoffIso]
    );
    if (!tenders.length) return;

    const managers = await db.all(
      `SELECT email, name FROM users WHERE role IN ('manager', 'admin')`
    );

    for (const tender of tenders) {
      const alreadySent = await db.get(
        `SELECT id FROM notifications WHERE text LIKE ? AND created_at > ?`,
        [`%дедлайн%${tender.number}%`, Date.now() - 86400000]
      );
      if (alreadySent) continue;

      const msg = `Тендер №${tender.number} «${tender.lot}» — дедлайн ${tender.deadline} (через ${REMINDER_DAYS} дн. или меньше)`;
      await db.run("INSERT INTO notifications (text, created_at) VALUES (?, ?)", [msg, Date.now()]);

      if (transporter) {
        for (const mgr of managers) {
          await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: mgr.email,
            subject: `Напоминание о дедлайне тендера №${tender.number}`,
            text: msg,
          }).catch((err) => console.error("Email error:", err.message));
        }
      } else {
        console.log(`[Reminder] SMTP не настроен — уведомление только в БД: ${msg}`);
      }
    }
  }

  sendDeadlineReminders();
  setInterval(sendDeadlineReminders, 6 * 60 * 60 * 1000);

  // ── Admin User Management API ───────────────────────────────────
  const crypto = require("crypto");

  // Page route for set-password
  app.get("/set-password", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "set-password.html"));
  });

  // POST /api/admin/users — create user
  app.post("/api/admin/users", authRequired, roleRequired("admin"), async (req, res) => {
    try {
      const { name, email, role, company } = req.body;
      if (!name || !email || !role) return res.status(400).json({ message: "Заполните имя, email и роль" });
      const tempHash = await bcrypt.hash(crypto.randomBytes(16).toString("hex"), 10);
      const result = await db.run(
        "INSERT INTO users (name, email, password_hash, role, company, bio) VALUES (?,?,?,?,?,?)",
        [name.trim(), email.trim().toLowerCase(), tempHash, role, (company || "ТехноТрейд").trim(), ""]
      );
      res.json({ success: true, id: result.lastID });
    } catch (e) {
      if (e.message && e.message.includes("UNIQUE")) return res.status(409).json({ message: "Пользователь с таким email уже существует" });
      console.error(e);
      res.status(500).json({ message: "Ошибка сервера" });
    }
  });

  // PUT /api/admin/users/:id — update user
  app.put("/api/admin/users/:id", authRequired, roleRequired("admin"), async (req, res) => {
    try {
      const { name, email, role, company } = req.body;
      if (!name || !email || !role) return res.status(400).json({ message: "Заполните все поля" });
      const existing = await db.get("SELECT id FROM users WHERE email=? AND id!=?", [email.trim().toLowerCase(), req.params.id]);
      if (existing) return res.status(409).json({ message: "Email уже занят другим пользователем" });
      await db.run(
        "UPDATE users SET name=?, email=?, role=?, company=? WHERE id=?",
        [name.trim(), email.trim().toLowerCase(), role, (company || "ТехноТрейд").trim(), req.params.id]
      );
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Ошибка сервера" });
    }
  });

  // DELETE /api/admin/users/:id — delete user
  app.delete("/api/admin/users/:id", authRequired, roleRequired("admin"), async (req, res) => {
    try {
      if (req.user.id === Number(req.params.id)) return res.status(400).json({ message: "Нельзя удалить свой аккаунт" });
      await db.run("DELETE FROM users WHERE id=?", [req.params.id]);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Ошибка сервера" });
    }
  });

  // POST /api/admin/users/:id/invite — generate set-password link
  app.post("/api/admin/users/:id/invite", authRequired, roleRequired("admin"), async (req, res) => {
    try {
      const user = await db.get("SELECT id, name, email FROM users WHERE id=?", [req.params.id]);
      if (!user) return res.status(404).json({ message: "Пользователь не найден" });
      const token = crypto.randomBytes(32).toString("hex");
      await db.run("DELETE FROM password_invite_tokens WHERE user_id=?", [user.id]);
      await db.run("INSERT INTO password_invite_tokens (user_id, token) VALUES (?,?)", [user.id, token]);
      const link = `${req.protocol}://${req.get("host")}/set-password?token=${token}`;
      res.json({ success: true, link, user: { name: user.name, email: user.email } });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Ошибка сервера" });
    }
  });

  // POST /api/auth/set-password — set password via invite token
  app.post("/api/auth/set-password", async (req, res) => {
    try {
      const { token, password } = req.body;
      if (!token || !password || password.length < 6) return res.status(400).json({ message: "Пароль должен содержать минимум 6 символов" });
      const record = await db.get("SELECT * FROM password_invite_tokens WHERE token=? AND used=0", [token]);
      if (!record) return res.status(400).json({ message: "Ссылка недействительна или уже использована" });
      const hash = await bcrypt.hash(String(password), 10);
      await db.run("UPDATE users SET password_hash=? WHERE id=?", [hash, record.user_id]);
      await db.run("UPDATE password_invite_tokens SET used=1 WHERE token=?", [token]);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Ошибка сервера" });
    }
  });

  // GET /api/auth/check-invite — validate token and return user info
  app.get("/api/auth/check-invite", async (req, res) => {
    try {
      const { token } = req.query;
      if (!token) return res.status(400).json({ message: "Токен не указан" });
      const record = await db.get(
        "SELECT t.*, u.name, u.email FROM password_invite_tokens t JOIN users u ON u.id=t.user_id WHERE t.token=? AND t.used=0",
        [token]
      );
      if (!record) return res.status(400).json({ message: "Ссылка недействительна или уже использована" });
      res.json({ success: true, name: record.name, email: record.email });
    } catch (e) {
      res.status(500).json({ message: "Ошибка сервера" });
    }
  });

  app.use((req, res) => {
    res.status(404).json({ message: "Not found" });
  });

  app.listen(PORT, () => {
    console.log(`ERP server started on http://localhost:${PORT}`);
  });
})();
