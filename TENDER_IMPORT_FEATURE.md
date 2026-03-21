# 🔗 Импорт тендеров по ссылке (gov.ru)

## 📌 Назначение

Менеджер/Поставщик может быстро добавить тендер двумя способами:
1. **По ссылке** — вставить URL с zakupki.gov.ru → система парсит автоматически
2. **Вручную** — заполнить форму самостоятельно

## 🎯 Сценарий использования

### Сценарий 1: Менеджер нашёл тендер на gov.ru
```
[Менеджер читает странице закупок]
         ↓
[Копирует ссылку: https://zakupki.gov.ru/epz/order/notice/notice223/common-info.html?noticeInfoId=19515624]
         ↓
[В системе: Импорт тендера → вставляет ссылку → клик на "Парсить"]
         ↓
[Система делает запрос на бэк → парсит HTML → возвращает данные]
         ↓
[Менеджер видит заполненные поля: номер, лот, клиент, НМЦК, срки]
         ↓
[Проверяет/Исправляет данные → Сохранить]
```

### Сценарий 2: Закрытая закупка (не опубликована)
```
[Менеджер проработал тендер с заказчиком]
         ↓
[Тендер ещё не выложен на gov.ru]
         ↓
[В системе: Импорт тендера → вкладка "Вручную"]
         ↓
[Заполняет форму вручную: номер, лот, клиент, ...]
         ↓
[Сохранить]
```

---

## 🏗️ Архитектура

### Бэк-энд: `/api/tenders/parse-url` (POST)

```http
POST /api/tenders/parse-url
Content-Type: application/json
Authorization: Bearer {token}

{
  "url": "https://zakupki.gov.ru/epz/order/notice/notice223/common-info.html?noticeInfoId=19515624"
}
```

**Ответ erfolg:**
```json
{
  "success": true,
  "data": {
    "number": "44-2026-001-000A1",
    "lot": "Поставка офисной бумаги формата А4",
    "client": "ООО Госзаказ",
    "price": 500000,
    "deadline": "2026-04-15",
    "status": "open",
    "source_url": "https://zakupki.gov.ru/...",
    "parsed_at": "2026-03-20T10:30:00Z"
  }
}
```

**Ответ ошибка:**
```json
{
  "success": false,
  "message": "Не удалось распарсить страницу. Проверьте ссылку и формат."
}
```

### Логика парсинга

```javascript
// Простой парсер (regex) без доп зависимостей:
1. Fetch HTML страницы по URL
2. Извлечение текста между тегами:
   - Номер закупки: <span id="noticeNumber"> или поиск по 44-XXXX-
   - Предмет закупки (лот): <p class="long"> или <h1>
   - Начальная цена (НМЦК): поиск "₽" или "руб"
   - Заказчик: <span class="customerName">
   - Сроки: вычисляется из "Дата поступления" + день

3. Валидация полученных данных
4. Возврат объекта для фронта
```

### Фронт-энд: Двухрежимный интерфейс

#### Вкладка 1: По ссылке
```
┌────────────────────────────────────────────┐
│  📺 Импорт по ссылке zakupki.gov.ru        │
├────────────────────────────────────────────┤
│                                             │
│  URL тендера:                               │
│  [____________________________________]    │
│                                             │
│  [🔍 Парсить] [↷ Очистить]                 │
│                                             │
│  ┌─ Загруженные данные ────────────┐       │
│  │                                 │       │
│  │  Номер:  44-2026-001-000A1      │       │
│  │  Лот:    Поставка офис бумаги   │       │
│  │  Клиент: ООО Госзаказ           │       │
│  │  НМЦК:   500000 ₽               │       │
│  │  Срок:   2026-04-15             │       │
│  │  Статус: open ✓                 │       │
│  │                                 │       │
│  └─────────────────────────────────┘       │
│                                             │
│  [Сохранить в систему]                     │
│                                             │
│  ℹ️ Если парсинг не сработал,              │
│     переключитесь на "Вручную"             │
│                                             │
└────────────────────────────────────────────┘
```

#### Вкладка 2: Вручную
```
┌──────────────────────────────────────────┐
│  ✏️ Добавить вручную                      │
├──────────────────────────────────────────┤
│                                          │
│  Номер закупки:     [______________]    │
│  Лот / Предмет:     [______________]    │
│  Заказчик:          [______________]    │
│  НМЦК (руб.):       [______________]    │
│  Срок подачи заявок: [__/05/2026___]    │
│  Статус:            [v open ▼]           │
│                                          │
│  [Сохранить]                              │
│                                          │
└──────────────────────────────────────────┘
```

---

## 💻 Реализация

### 1️⃣ Новый эндпоинт в `server.js`

```javascript
// Парсинг URL тендера с gov.ru
app.post("/api/tenders/parse-url", authRequired, async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ 
      success: false, 
      message: "URL не предоставлена" 
    });
  }

  try {
    // Fetch страница
    const response = await fetch(url);
    if (!response.ok) throw new Error("Страница недоступна");
    
    const html = await response.text();

    // Парсим основные данные (простой парсер)
    const parsed = {
      number: extractNumber(html),
      lot: extractLot(html),
      client: extractClient(html),
      price: extractPrice(html),
      deadline: extractDeadline(html),
      status: "open",
      source_url: url,
      parsed_at: new Date().toISOString(),
    };

    // Валидация
    if (!parsed.number || !parsed.lot) {
      throw new Error("Не удалось извлечь основные данные");
    }

    res.json({ success: true, data: parsed });
  } catch (error) {
    res.status(400).json({ 
      success: false, 
      message: `Ошибка парсинга: ${error.message}` 
    });
  }
});

// Вспомогательные функции парсинга
function extractNumber(html) {
  const match = html.match(/44-\d{4}-\d{3}-[A-Z0-9]+/);
  return match ? match[0] : null;
}

function extractLot(html) {
  // Ищем текст между <p> для описания лота
  const match = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
  return match ? match[1].trim() : null;
}

function extractClient(html) {
  // Ищем имя заказчика между определёнными тегами
  const match = html.match(/customerName[^>]*>(.*?)<\/span>/i);
  return match ? match[1].trim() : null;
}

function extractPrice(html) {
  // Ищем цену (НМЦК) с ₽ или "руб"
  const match = html.match(/(\d{1,3}(?:\s\d{3})*)\s*(?:₽|руб)/);
  return match ? parseInt(match[1].replace(/\s/g, "")) : null;
}

function extractDeadline(html) {
  // Ищем дату в формате дд.мм.гггг
  const match = html.match(/(\d{2}\.\d{2}\.\d{4})/);
  if (!match) return null;
  
  const [day, month, year] = match[1].split(".");
  return `${year}-${month}-${day}`;
}
```

### 2️⃣ Новая функция в `main.js`

```javascript
async function renderTenderImport(user) {
  const root = document.getElementById("pageRoot");
  const isSupplier = user.role === "supplier";

  root.innerHTML = `
    <div class="card">
      <h3>Импорт нового тендера</h3>
      <div id="importTabs" style="margin-top:16px">
        <button id="tabUrl" class="tab-btn active">🔗 По ссылке gov.ru</button>
        <button id="tabManual" class="tab-btn">✏️ Вручную</button>
      </div>

      <!-- Вкладка: По ссылке -->
      <div id="tabUrlContent" style="margin-top:20px">
        <div style="max-width:550px">
          <p class="muted" style="margin-bottom:12px">
            Вставьте ссылку с закупок.гов.ру — система автоматически заполнит данные
          </p>
          
          <div class="field">
            <label>URL тендера из закупок.гов.ру</label>
            <input id="urlInput" type="url" placeholder="https://zakupki.gov.ru/epz/order/notice/..." style="font-size:12px">
          </div>

          <div style="display:flex; gap:10px; margin-top:12px">
            <button id="parseBtn" class="btn-primary" type="button">🔍 Парсить</button>
            <button id="clearBtn" class="btn-secondary" type="button">↷ Очистить</button>
          </div>

          <div id="parseStatus" style="margin-top:12px"></div>

          <div id="parsedData" style="display:none; margin-top:20px; padding:16px; background:#f5f5f5; border-radius:8px">
            <h4 style="margin-bottom:12px">📋 Загруженные данные</h4>
            <div id="parsedFields"></div>
            <button id="saveParsedBtn" class="btn-primary" style="margin-top:16px" type="button">💾 Сохранить в систему</button>
          </div>
        </div>
      </div>

      <!-- Вкладка: Вручную -->
      <div id="tabManualContent" style="display:none; margin-top:20px">
        <form id="manualForm" style="max-width:550px">
          <div class="field"><label>Номер закупки</label><input name="number" required></div>
          <div class="field"><label>Лот / Предмет закупки</label><input name="lot" required></div>
          <div class="field"><label>Заказчик</label><input name="client" required></div>
          <div class="field"><label>НМЦК (руб.)</label><input name="price" type="number" value="1000000"></div>
          <div class="field"><label>Срок подачи заявок</label><input name="deadline" type="date" value="2026-04-01"></div>
          <div class="field">
            <label>Статус</label>
            <select name="status">
              <option value="draft">Черновик</option>
              <option value="open" selected>Прием заявок</option>
              <option value="review">На рассмотрении</option>
            </select>
          </div>
          <button class="btn-primary" type="submit">💾 Сохранить</button>
        </form>
      </div>
    </div>
  `;

  // Блокировка URL-парсинга для поставщиков (опционально - оставляем доступ)
  if (isSupplier) {
    document.getElementById("tabUrl").style.opacity = "0.6";
  }

  // Переключение табов
  document.getElementById("tabUrl").addEventListener("click", () => {
    document.getElementById("tabUrlContent").style.display = "";
    document.getElementById("tabManualContent").style.display = "none";
    document.getElementById("tabUrl").classList.add("active");
    document.getElementById("tabManual").classList.remove("active");
  });

  document.getElementById("tabManual").addEventListener("click", () => {
    document.getElementById("tabUrlContent").style.display = "none";
    document.getElementById("tabManualContent").style.display = "";
    document.getElementById("tabManual").classList.add("active");
    document.getElementById("tabUrl").classList.remove("active");
  });

  // Парсинг ссылки
  document.getElementById("parseBtn").addEventListener("click", async () => {
    const url = document.getElementById("urlInput").value.trim();
    const statusDiv = document.getElementById("parseStatus");

    if (!url) {
      statusDiv.innerHTML = '<p class="error" style="color:#ef4444">Вставьте URL</p>';
      return;
    }

    statusDiv.innerHTML = '<p class="muted">⏳ Парсим...</p>';

    try {
      const res = await api("/api/tenders/parse-url", "POST", { url });
      
      if (!res.success) throw new Error(res.message);

      // Показываем загруженные данные
      window.parsedTenderData = res.data;
      displayParsedData(res.data);
      statusDiv.innerHTML = '<p style="color:#10b981">✅ Данные загружены</p>';

    } catch (e) {
      statusDiv.innerHTML = `<p style="color:#ef4444">❌ ${e.message}</p>`;
    }
  });

  // Очистка
  document.getElementById("clearBtn").addEventListener("click", () => {
    document.getElementById("urlInput").value = "";
    document.getElementById("parsedData").style.display = "none";
    document.getElementById("parseStatus").innerHTML = "";
  });

  // Сохранение парсированных данных
  document.getElementById("saveParsedBtn").addEventListener("click", async () => {
    const data = window.parsedTenderData;
    try {
      await api("/api/tenders", "POST", {
        number: data.number,
        lot: data.lot,
        client: data.client,
        price: Number(data.price),
        deadline: data.deadline,
        status: data.status,
      });
      toast("Тендер добавлен из gov.ru");
      renderTenders(user); // Перейти на список тендеров
    } catch (e) {
      toast(e.message, "error");
    }
  });

  // Ручное добавление
  document.getElementById("manualForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api("/api/tenders", "POST", {
        number: f.number.value,
        lot: f.lot.value,
        client: f.client.value,
        price: Number(f.price.value),
        deadline: f.deadline.value,
        status: f.status.value,
      });
      toast("Тендер добавлен вручную");
      renderTenders(user);
    } catch (e) {
      toast(e.message, "error");
    }
  });

  function displayParsedData(data) {
    const fields = [
      ["Номер закупки", data.number],
      ["Лот / Предмет", data.lot],
      ["Заказчик", data.client],
      ["НМЦК", formatMoney(data.price || 0)],
      ["Срок подачи", formatDate(data.deadline)],
      ["Статус", "Прием заявок"],
      ["Источник", new URL(data.source_url).hostname],
    ];

    const html = fields
      .map(([k, v]) => `<div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #ddd">
        <span style="color:var(--muted); font-size:12px">${esc(k)}</span>
        <strong>${esc(String(v))}</strong>
      </div>`)
      .join("");

    document.getElementById("parsedFields").innerHTML = html;
    document.getElementById("parsedData").style.display = "";
  }
}

// Добавить в dispatch initPage():
if (page === "import") await renderTenderImport(user);
```

### 3️⃣ CSS для табов (в `styles.css`)

```css
.tab-btn {
  background: #fff;
  border: 1.5px solid var(--border);
  color: var(--text);
  padding: 10px 16px;
  border-radius: 8px 8px 0 0;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  margin-right: 4px;
  transition: all 0.2s;
}

.tab-btn:hover {
  background: var(--bg);
}

.tab-btn.active {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

.error {
  color: #ef4444;
  font-size: 14px;
}
```

### 4️⃣ Новая HTML страница `/public/import.html`

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Импорт тендера — ERP</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <!-- [конопи боковой панели из других страниц] -->
    </aside>
    <main>
      <div class="page" data-page="import">
        <div id="pageRoot"></div>
      </div>
    </main>
  </div>
  <div id="toastWrap"></div>
  <script src="/assets/js/main.js"></script>
</body>
</html>
```

### 5️⃣ Маршрут в `server.js`

```javascript
app.get("/import", pageAuth, (req, res) => {
  if (!["manager", "admin", "supplier"].includes(req.user.role)) {
    return res.redirect("/");
  }
  res.sendFile(path.join(__dirname, "public", "import.html"));
});
```

---

## 📊 Обновление навигации

В каждом HTML файле добавить ссылку:

```html
<a href="/import" class="nav-item">
  🔗 Импорт тендера
</a>
```

---

## ⚠️ Ограничения текущей версии

1. **Парсинг (regex)** — работает только с простой структурой закупок.гов.ру
2. **Не поддерживает** сложные форматы, JavaScript-rendered контент
3. **Cross-Origin** — может потребоваться прокси если CORS заблокирован

### Для улучшения (Future):
- Установить `npm install cheerio` и использовать JSdom парсер
- Подключить к API закупок.гов.ру (если будет доступен)
- Кэширование парсированных данных

---

## 🧪 Тестирование

**Ссылка для теста:**
```
https://zakupki.gov.ru/epz/order/notice/notice223/common-info.html?noticeInfoId=19515624
```

**Ожидаемый результат:**
```json
{
  "number": "44-2026-024-000A1",
  "lot": "Услуга по ремонту зданий и сооружений",
  "client": "МУП Берег",
  "price": 750000,
  "deadline": "2026-04-20"
}
```

