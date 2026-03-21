const path = require("path");
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const DB_PATH = path.join(__dirname, "data", "erp.sqlite");

async function initDb() {
  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });

  await db.exec("PRAGMA foreign_keys = ON");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      company TEXT NOT NULL,
      bio TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS password_invite_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      used INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tenders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL,
      lot TEXT NOT NULL,
      client TEXT NOT NULL,
      price INTEGER NOT NULL,
      deadline TEXT NOT NULL,
      status TEXT NOT NULL,
      internal_status TEXT NOT NULL DEFAULT 'awaiting_picking',
      participation_fee REAL NOT NULL DEFAULT 5000,
      delivery_cost REAL NOT NULL DEFAULT 5000,
      bank_guarantee_cost REAL NOT NULL DEFAULT 0,
      vat_rate REAL NOT NULL DEFAULT 22,
      notice_number TEXT DEFAULT '',
      submitted_at TEXT DEFAULT '',
      commission_decision TEXT DEFAULT '',
      is_archived INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT DEFAULT '',
      source_url TEXT DEFAULT '',
      registry_number TEXT DEFAULT '',
      procurement_method TEXT DEFAULT '',
      platform_name TEXT DEFAULT '',
      platform_url TEXT DEFAULT '',
      publication_date TEXT DEFAULT '',
      update_date TEXT DEFAULT '',
      decision_date TEXT DEFAULT '',
      customer_inn TEXT DEFAULT '',
      customer_kpp TEXT DEFAULT '',
      customer_ogrn TEXT DEFAULT '',
      customer_address TEXT DEFAULT '',
      customer_postal_address TEXT DEFAULT '',
      contact_name TEXT DEFAULT '',
      contact_email TEXT DEFAULT '',
      contact_phone TEXT DEFAULT '',
      application_start TEXT DEFAULT '',
      application_end TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tender_number TEXT NOT NULL,
      client TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track TEXT NOT NULL,
      client TEXT NOT NULL,
      progress INTEGER NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      person TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      segment TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS price_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
      supplier_name TEXT NOT NULL,
      supplier_email TEXT NOT NULL,
      price INTEGER NOT NULL,
      delivery_days INTEGER NOT NULL,
      note TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
      number TEXT NOT NULL,
      client TEXT NOT NULL,
      amount INTEGER NOT NULL,
      signed_date TEXT NOT NULL,
      deadline TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      note TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS contract_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      percent INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      due_date TEXT NOT NULL,
      act_number TEXT DEFAULT '',
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company TEXT NOT NULL,
      price INTEGER NOT NULL,
      delivery_days INTEGER NOT NULL,
      note TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'open',
      due_date TEXT,
      tender_id INTEGER REFERENCES tenders(id) ON DELETE SET NULL,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tender_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      file_ext TEXT NOT NULL,
      doc_type TEXT DEFAULT '',
      source_url TEXT NOT NULL,
      local_url TEXT DEFAULT '',
      file_size INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tender_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      article TEXT DEFAULT '',
      name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      unit TEXT NOT NULL DEFAULT 'шт',
      price_est REAL DEFAULT 0,
      note TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tender_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
      order_number TEXT NOT NULL,
      supply_date TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tender_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES tender_orders(id) ON DELETE CASCADE,
      tender_item_id INTEGER NOT NULL REFERENCES tender_items(id) ON DELETE CASCADE,
      quantity REAL NOT NULL,
      price_est REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS order_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES tender_orders(id) ON DELETE CASCADE,
      invoice_number TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unpaid',
      issue_date TEXT NOT NULL,
      paid_at TEXT DEFAULT '',
      file_url TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shipment_workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL UNIQUE REFERENCES tender_orders(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'warehouse',
      transfer_ready INTEGER NOT NULL DEFAULT 0,
      shipment_date TEXT DEFAULT '',
      act_file_url TEXT DEFAULT '',
      upd_file_url TEXT DEFAULT '',
      invoice_file_url TEXT DEFAULT '',
      docs_generated_at TEXT DEFAULT '',
      docs_handover_at TEXT DEFAULT '',
      paid_at TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    );
  `);

  // Lightweight migrations for already created databases.
  const tenderColumns = [
    ["internal_status", "TEXT NOT NULL DEFAULT 'awaiting_picking'"],
    ["participation_fee", "REAL NOT NULL DEFAULT 5000"],
    ["delivery_cost", "REAL NOT NULL DEFAULT 5000"],
    ["bank_guarantee_cost", "REAL NOT NULL DEFAULT 0"],
    ["vat_rate", "REAL NOT NULL DEFAULT 22"],
    ["notice_number", "TEXT DEFAULT ''"],
    ["submitted_at", "TEXT DEFAULT ''"],
    ["commission_decision", "TEXT DEFAULT ''"],
    ["is_archived", "INTEGER NOT NULL DEFAULT 0"],
    ["archived_at", "TEXT DEFAULT ''"],
    ["source_url", "TEXT DEFAULT ''"],
    ["registry_number", "TEXT DEFAULT ''"],
    ["procurement_method", "TEXT DEFAULT ''"],
    ["platform_name", "TEXT DEFAULT ''"],
    ["platform_url", "TEXT DEFAULT ''"],
    ["publication_date", "TEXT DEFAULT ''"],
    ["update_date", "TEXT DEFAULT ''"],
    ["decision_date", "TEXT DEFAULT ''"],
    ["customer_inn", "TEXT DEFAULT ''"],
    ["customer_kpp", "TEXT DEFAULT ''"],
    ["customer_ogrn", "TEXT DEFAULT ''"],
    ["customer_address", "TEXT DEFAULT ''"],
    ["customer_postal_address", "TEXT DEFAULT ''"],
    ["contact_name", "TEXT DEFAULT ''"],
    ["contact_email", "TEXT DEFAULT ''"],
    ["contact_phone", "TEXT DEFAULT ''"],
    ["application_start", "TEXT DEFAULT ''"],
    ["application_end", "TEXT DEFAULT ''"],
    ["contract_signed_ours_at", "TEXT DEFAULT ''"],
    ["contract_signed_both_at", "TEXT DEFAULT ''"],
  ];
  for (const [name, ddl] of tenderColumns) {
    try {
      await db.exec(`ALTER TABLE tenders ADD COLUMN ${name} ${ddl}`);
    } catch (error) {
      // Ignore "duplicate column" for existing schemas.
      if (!String(error.message || "").includes("duplicate column name")) {
        throw error;
      }
    }
  }

  try {
    await db.exec("ALTER TABLE tasks ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL");
  } catch (error) {
    if (!String(error.message || "").includes("duplicate column name")) {
      throw error;
    }
  }

  await db.run(
    `UPDATE tasks
     SET created_by = COALESCE(created_by, user_id)
     WHERE created_by IS NULL`
  );

  await db.run(
    `UPDATE tenders
     SET internal_status = 'awaiting_picking'
     WHERE internal_status IS NULL OR TRIM(internal_status) = ''`
  );

  await db.run(
    `UPDATE tenders
     SET participation_fee = COALESCE(participation_fee, 5000),
         delivery_cost = COALESCE(delivery_cost, 5000),
         bank_guarantee_cost = COALESCE(bank_guarantee_cost, 0),
      vat_rate = COALESCE(vat_rate, 22),
      is_archived = COALESCE(is_archived, 0)`
  );

  await db.run(
    `UPDATE users
     SET role = 'picker', email = 'picker@technotrade.ru', bio = 'Специалист по подбору товаров'
     WHERE role = 'supply' OR email = 'supply@technotrade.ru'`
  );

  const ensureUser = async (name, email, role, bio) => {
    const existingUser = await db.get("SELECT id FROM users WHERE email = ?", [email]);
    if (existingUser) return;
    const passwordHash = await bcrypt.hash("123456", 10);
    await db.run(
      `INSERT INTO users (name, email, password_hash, role, company, bio) VALUES (?, ?, ?, ?, ?, ?)`,
      [name, email, passwordHash, role, "ТехноТрейд", bio]
    );
  };

  await ensureUser("Генеральный директор", "director@technotrade.ru", "director", "Генеральный директор — главное лицо в управлении");
  await ensureUser("Иванов И.И.", "manager@technotrade.ru", "manager", "Руководитель тендерного направления");
  await ensureUser("Системный администратор", "admin@technotrade.ru", "admin", "Полный контроль бизнес-процессов");
  await ensureUser("Петров С.А.", "picker@technotrade.ru", "picker", "Специалист по подбору товаров");
  await ensureUser("Бухгалтер Е.Н.", "accountant@technotrade.ru", "accountant", "Оплата счетов и финансовый контроль");
  await ensureUser("Логист Н.В.", "logistic@technotrade.ru", "logistic", "Отгрузка и контроль доставки");

  const seedCheck = await db.get("SELECT COUNT(*) AS count FROM tenders");
  if (seedCheck.count === 0) {
    await db.run(
      `INSERT INTO tenders (number, lot, client, price, deadline, status)
       VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`,
      [
        "32413876543",
        "Ноутбуки Lenovo ThinkPad X1",
        "ООО Газпром-ЦР",
        2500000,
        "2026-03-25",
        "open",
        "32413887512",
        "Моноблоки HP EliteOne 840",
        "АО РЖД-Технологии",
        1800000,
        "2026-03-28",
        "review",
        "32413890123",
        "Серверы Dell PowerEdge",
        "ПАО Ростелеком",
        5200000,
        "2026-03-30",
        "draft",
      ]
    );

    await db.run(
      `INSERT INTO orders (tender_number, client, amount, status)
       VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)`,
      [
        "32413876543",
        "ООО Газпром-ЦР",
        2450000,
        "review",
        "32413887512",
        "АО РЖД-Технологии",
        1780000,
        "open",
        "32413890123",
        "ПАО Ростелеком",
        5150000,
        "draft",
      ]
    );

    await db.run(
      `INSERT INTO deliveries (track, client, progress, status)
       VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)`,
      [
        "CDEK-1234567890",
        "ООО Газпром-ЦР",
        68,
        "shipped",
        "BOX-7723881941",
        "АО РЖД-Технологии",
        35,
        "review",
        "UPS-9911823705",
        "ПАО Ростелеком",
        100,
        "closed",
      ]
    );

    await db.run(
      `INSERT INTO clients (company, person, email, phone, segment)
       VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
      [
        "ООО Газпром-ЦР",
        "Волков В.В.",
        "info@gazprom-cr.ru",
        "+7 495 111-22-33",
        "Крупный",
        "АО РЖД-Технологии",
        "Смирнов С.С.",
        "hello@rzd-tech.ru",
        "+7 499 444-55-66",
        "Крупный",
        "ООО НордТех",
        "Сидорова А.А.",
        "office@nordtech.ru",
        "+7 812 888-10-10",
        "Средний",
      ]
    );

    const now = Date.now();
    await db.run(
      `INSERT INTO notifications (text, created_at)
       VALUES (?, ?), (?, ?), (?, ?)`,
      [
        "Новый тендер по профилю: печатные станции",
        now - 3600000,
        "Заявка по тендеру №32413876543 подана",
        now - 7200000,
        "Поставка CDEK-1234567890 прошла таможню",
        now - 18000000,
      ]
    );

    await db.run(
      `INSERT INTO logs (text, created_at)
       VALUES (?, ?), (?, ?)`,
      [
        "Иванов И.И. принял в работу тендер №32413876543",
        now - 2000000,
        "Служба логистики обновила маршрут BOX-7723881941",
        now - 8600000,
      ]
    );
  }

  return db;
}

module.exports = { initDb };
