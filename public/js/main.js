const page = document.body.dataset.page;
const ROLE_LABELS = {
  director: "Генеральный директор",
  manager: "Менеджер",
  supplier: "Поставщик",
  client: "Клиент",
  admin: "Администратор",
  picker: "Подборщик",
  accountant: "Бухгалтер",
  logistic: "Логист",
};

function formatMoney(value) {
  return Number(value || 0).toLocaleString("ru-RU") + " ₽";
}

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
}

function formatDate(iso) {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("ru-RU");
}

function statusBadge(status) {
  const labels = {
    open: "Прием заявок",
    review: "На рассмотрении",
    draft: "Черновик",
    closed: "Закрыт",
    shipped: "Отгружено",
    commission: "Работа комиссии",
    awaiting_signing: "Ожидание подписания на площадке",
    signed: "Подписан",
    executed: "Исполнен",
    awaiting_payment: "Ожидает оплаты",
    paid: "Оплачен",
    unpaid: "Не оплачен",
    stocked: "Поставлен на склад",
    warehouse: "На складе",
    scheduled: "Назначено на дату отгрузки",
    received: "Получено клиентом",
  };
  return `<span class="status ${status}">${labels[status] || status}</span>`;
}

function internalStatusBadge(status) {
  const labels = {
    awaiting_picking: "Ожидает подбора",
    awaiting_application: "Ожидает подачи заявки",
    submitted: "Заявка подана",
    won_waiting_sign: "Выиграли",
    signed_ours: "Подписан с нашей стороны",
    signed_both: "Подписан с двух сторон",
    executed: "Исполнен",
    archived_lost: "Проиграли (архив)",
  };
  return `<span class="status ${status || "draft"}">${labels[status] || "—"}</span>`;
}

async function api(url, method = "GET", body) {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Ошибка API");
  return data;
}

function toast(message, type = "info") {
  const wrap = document.getElementById("toastWrap");
  const node = document.createElement("div");
  node.className = `toast toast-${type}`;
  node.textContent = message;
  wrap.appendChild(node);
  setTimeout(() => node.remove(), 2800);
}

async function loadMe() {
  try {
    const { user } = await api("/api/auth/me");
    window.__erpUserRole = user.role;
    window.__erpCurrentUser = user;
    document.getElementById("userName").textContent = user.name;
    document.getElementById("userRole").textContent = ROLE_LABELS[user.role] || user.role;
    document.getElementById("userCompany").textContent = user.company;
    return user;
  } catch (error) {
    window.location.href = "/login";
    throw error;
  }
}

function bindCommon(user) {
  const menu = document.querySelector(".menu");

  // Почтовая вкладка доступна всем авторизованным пользователям.
  if (menu) {
    const exists = menu.querySelector('a[href="/mail"]');
    if (exists) {
      if (page === "mail") exists.classList.add("active");
    } else {
      const link = document.createElement("a");
      link.href = "/mail";
      link.textContent = "Почта";
      if (page === "mail") link.classList.add("active");
      const profile = menu.querySelector('a[href="/profile"]');
      if (profile) menu.insertBefore(link, profile);
      else menu.appendChild(link);
    }
  }
  
  // Бухгалтерия доступна для бухгалтеров и администраторов
  if (menu && ["accountant", "admin"].includes(String(user.role || ""))) {
    const exists = menu.querySelector('a[href="/accounting"]');
    if (!exists) {
      const link = document.createElement("a");
      link.href = "/accounting";
      link.textContent = "Бухгалтерия";
      if (page === "accounting") link.classList.add("active");
      const profile = menu.querySelector('a[href="/profile"]');
      if (profile) menu.insertBefore(link, profile);
      else menu.appendChild(link);
    }
  }

  // Админ панель доступна только для администраторов
  if (menu && user.role === "admin") {
    const exists = menu.querySelector('a[href="/admin"]');
    if (exists) {
      if (page === "admin") exists.classList.add("active");
    } else {
      const link = document.createElement("a");
      link.href = "/admin";
      link.textContent = "Админ";
      if (page === "admin") link.classList.add("active");
      const profile = menu.querySelector('a[href="/profile"]');
      if (profile) menu.insertBefore(link, profile);
      else menu.appendChild(link);
    }
  } else {
    const adminLink = menu?.querySelector('a[href="/admin"]');
    if (adminLink) adminLink.remove();
  }

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("/api/auth/logout", "POST");
    window.location.href = "/login";
  });
}

// ═══════════════════════════════════════════════
// Модальная система
// ═══════════════════════════════════════════════

function ensureModal() {
  if (document.getElementById("erpModal")) return;
  const el = document.createElement("div");
  el.id = "erpModal";
  el.className = "modal-backdrop";
  el.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 id="modalTitle"></h3>
        <button id="modalCloseBtn" type="button" class="modal-close" aria-label="Закрыть">&#10005;</button>
      </div>
      <div id="modalBody" class="modal-body"></div>
    </div>
  `;
  document.body.appendChild(el);
  el.addEventListener("click", (e) => { if (e.target === el) closeModal(); });
  document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
}

function openModal(title, bodyHTML) {
  ensureModal();
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").innerHTML = bodyHTML;
  const modal = document.getElementById("erpModal");
  modal.classList.add("open");
  setTimeout(() => {
    const first = modal.querySelector("input:not([disabled]), select, textarea, button");
    if (first) first.focus();
  }, 50);
}

function closeModal() {
  const el = document.getElementById("erpModal");
  if (el) el.classList.remove("open");
  const box = document.querySelector(".modal-box");
  if (box) box.classList.remove("modal-wide");
}

/**
 * fields: [{ name, label, type?, value?, required?, placeholder?, options? }]
 * type "select" — options: [{ value, label }]
 * type "textarea" — многострочное поле
 * Returns Promise<object|null>
 */
function showForm(title, fields) {
  return new Promise((resolve) => {
    const fieldsHtml = fields.map((f) => {
      if (f.type === "select") {
        const opts = f.options
          .map((o) => `<option value="${esc(String(o.value))}" ${String(o.value) === String(f.value ?? "") ? "selected" : ""}>${esc(o.label)}</option>`)
          .join("");
        return `<div class="field"><label>${esc(f.label)}</label><select name="${esc(f.name)}">${opts}</select></div>`;
      }
      if (f.type === "textarea") {
        return `<div class="field"><label>${esc(f.label)}</label><textarea name="${esc(f.name)}" rows="3" placeholder="${esc(f.placeholder || "")}">${esc(String(f.value || ""))}</textarea></div>`;
      }
      return `<div class="field"><label>${esc(f.label)}</label><input name="${esc(f.name)}" type="${f.type || "text"}" value="${esc(String(f.value ?? ""))}" placeholder="${esc(f.placeholder || "")}" ${f.required ? "required" : ""}></div>`;
    }).join("");

    openModal(title, `
      <form id="erpModalForm" novalidate>
        ${fieldsHtml}
        <div class="modal-actions">
          <button type="submit" class="btn-primary">Сохранить</button>
          <button type="button" id="erpModalCancel" class="btn-secondary">Отмена</button>
        </div>
      </form>
    `);

    document.getElementById("erpModalForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      closeModal();
      resolve(data);
    });
    document.getElementById("erpModalCancel").addEventListener("click", () => {
      closeModal();
      resolve(null);
    });
  });
}

/** Диалог подтверждения. Returns Promise<boolean> */
function confirmModal(message, actionLabel = "Удалить", actionClass = "btn-danger") {
  return new Promise((resolve) => {
    openModal("Подтверждение", `
      <p class="modal-confirm-msg">${esc(message)}</p>
      <div class="modal-actions">
        <button id="erpConfirmYes" type="button" class="${esc(actionClass)}">${esc(actionLabel)}</button>
        <button id="erpConfirmNo" type="button" class="btn-secondary">Отмена</button>
      </div>
    `);
    document.getElementById("erpConfirmYes").addEventListener("click", () => { closeModal(); resolve(true); });
    document.getElementById("erpConfirmNo").addEventListener("click", () => { closeModal(); resolve(false); });
  });
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ═══════════════════════════════════════════════
// Страницы
// ═══════════════════════════════════════════════

const DASHBOARD_REFRESH_MS = 15000;
let dashboardRefreshHandle = null;
let dashboardLastChangeId = 0;

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("ru-RU");
}

function formatRelativeTime(value) {
  if (!value) return "только что";
  const delta = Math.max(0, Date.now() - Number(value));
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

function getDeadlineLabel(daysLeft) {
  if (daysLeft == null) return "Срок не указан";
  if (daysLeft < 0) return `Просрочено на ${Math.abs(daysLeft)} дн`;
  if (daysLeft === 0) return "Дедлайн сегодня";
  if (daysLeft === 1) return "1 день до дедлайна";
  return `${daysLeft} дн до дедлайна`;
}

function getDeadlineTone(daysLeft) {
  if (daysLeft == null) return "calm";
  if (daysLeft < 0) return "danger";
  if (daysLeft <= 3) return "warning";
  if (daysLeft <= 7) return "focus";
  return "calm";
}

function getTaskTone(task) {
  if (String(task.status || "") === "done") return "done";
  if (String(task.priority || "") === "high") return "high";
  if (String(task.priority || "") === "medium") return "medium";
  return "low";
}

function getTaskOrigin(task, currentUser) {
  const creatorId = String(task.created_by || "");
  const currentUserId = String(currentUser?.id || "");
  const creatorRole = String(task.creator_role || "");
  const creatorName = task.creator_name || "Система";
  if (!creatorId || creatorId === currentUserId) return "Личная задача";
  if (["manager", "admin", "director"].includes(creatorRole)) return `От руководства: ${creatorName}`;
  return `Поставил: ${creatorName}`;
}

function renderDashboardView(root, payload) {
  const { kpi = {}, tenders = [], recentChanges = [], tasks = [] } = payload || {};
  const currentUser = window.__erpCurrentUser || null;
  const riskyTenders = tenders.filter((row) => row.days_left !== null && row.days_left <= 7);
  const lastUpdatedAt = recentChanges[0]?.created_at || Date.now();
  const visibleTenderCount = 4;
  const visibleChangeCount = 6;

  root.innerHTML = `
    <div class="dashboard-shell">
      <section class="dashboard-kpi-grid">
        <article class="dashboard-kpi-card accent-blue">
          <small>Тендеры в работе</small>
          <strong>${kpi.activeTenders || 0}</strong>
          <span>Все закупки, которые ещё идут по процессу</span>
        </article>
        <article class="dashboard-kpi-card accent-cyan">
          <small>Средний прогресс</small>
          <strong>${kpi.avgTenderProgress || 0}%</strong>
          <span>Средняя стадия по активному портфелю</span>
        </article>
        <article class="dashboard-kpi-card accent-amber">
          <small>Критичные сроки</small>
          <strong>${kpi.dueSoonCount || 0}</strong>
          <span>Тендеры с дедлайном в ближайшие 7 дней</span>
        </article>
        <article class="dashboard-kpi-card accent-emerald">
          <small>Подписанные тендеры</small>
          <strong>${kpi.signedCount || 0}</strong>
          <span>Закупки на стадии исполнения договора</span>
        </article>
        <article class="dashboard-kpi-card accent-indigo">
          <small>Активные заказы</small>
          <strong>${kpi.activeOrders || 0}</strong>
          <span>Заказы, которые ещё не ушли в архив</span>
        </article>
        <article class="dashboard-kpi-card accent-slate">
          <small>Портфель заказов</small>
          <strong>${formatMoney(kpi.revenue || 0)}</strong>
          <span>Совокупная сумма заказов в системе</span>
        </article>
      </section>

      <section class="dashboard-layout">
        <div class="dashboard-column dashboard-column-main">
          <div class="card dashboard-panel">
            <div class="panel-head">
              <div>
                <h3>Прогресс по тендерам в работе</h3>
                <div class="muted">Процент строится по этапу процесса: заявка, комиссия, подписание, заказ, склад, отгрузка.</div>
              </div>
            </div>
            <div class="tender-progress-list dashboard-scroll dashboard-scroll-tenders" style="--visible-count:${visibleTenderCount}">
              ${tenders.length ? tenders.map((t) => `
                <article class="tender-progress-card tone-${esc(t.progress_tone || "early")}">
                  <div class="tender-progress-head">
                    <div>
                      <div class="tender-progress-number"><a data-entity-type="tender" data-entity-id="${t.id}" style="color:inherit;">№${esc(t.number)}</a></div>
                      <div class="tender-progress-title">${esc(t.lot || "Без названия")}</div>
                      <div class="muted"><a data-entity-type="client" data-entity-id="${t.client}" style="color:inherit;">${esc(t.client || "Клиент не указан")}</a></div>
                    </div>
                    <div class="tender-progress-badges">
                      ${statusBadge(t.status)}
                      ${internalStatusBadge(t.internal_status)}
                    </div>
                  </div>
                  <div class="progress dashboard-progress-bar"><div style="width:${Math.max(0, Math.min(100, Number(t.progress_percent || 0)))}%"></div></div>
                  <div class="tender-progress-foot">
                    <strong>${Number(t.progress_percent || 0)}%</strong>
                    <span>${esc(t.progress_stage || "В обработке")}</span>
                    <span class="deadline-chip deadline-${getDeadlineTone(t.days_left)}">${esc(getDeadlineLabel(t.days_left))}</span>
                  </div>
                  <div class="tender-progress-metrics">
                    <span>НМЦК: ${formatMoney(t.price || 0)}</span>
                    <span>Заказы: ${Number(t.orders_count || 0)}</span>
                    <span>Поставки: ${Number(t.shipments_count || 0)}</span>
                    <span>Портфель: ${formatMoney(t.order_amount || 0)}</span>
                  </div>
                </article>
              `).join("") : '<div class="dashboard-empty">Сейчас нет активных тендеров в работе.</div>'}
            </div>
          </div>
        </div>

        <div class="dashboard-column dashboard-column-side">
          ${currentUser?.role === "director" ? `
          <div class="card dashboard-panel">
            <div class="panel-head">
              <div>
                <h3>Фокус руководителя</h3>
                <div class="muted">Что требует внимания в ближайшее время.</div>
              </div>
            </div>
            <div class="dashboard-focus-list">
              <div class="focus-stat">
                <span>Активные поставки</span>
                <strong>${kpi.activeShipments || 0}</strong>
              </div>
              <div class="focus-stat">
                <span>Тендеры на подписи</span>
                <strong>${kpi.signedCount || 0}</strong>
              </div>
              <div class="focus-stat">
                <span>Срочные дедлайны</span>
                <strong>${kpi.dueSoonCount || 0}</strong>
              </div>
            </div>
            <div class="dashboard-alerts">
              ${riskyTenders.length ? riskyTenders.slice(0, 4).map((t) => `
                <div class="alert-card ${getDeadlineTone(t.days_left)}">
                  <strong>№${esc(t.number)}</strong>
                  <span>${esc(t.lot || "Без названия")}</span>
                  <div class="muted">${esc(getDeadlineLabel(t.days_left))}</div>
                </div>
              `).join("") : '<div class="dashboard-empty">Срочных дедлайнов на ближайшие 7 дней нет.</div>'}
            </div>
          </div>

          <div class="card dashboard-panel">
            <div class="panel-head">
              <div>
                <h3>Задачи и поручения</h3>
                <div class="muted">Создавайте и назначайте задачи команде.</div>
              </div>
              <button id="addDashboardTaskBtn" class="btn-primary" type="button" title="Добавить задачу">+</button>
            </div>
            <div class="dashboard-task-list dashboard-scroll dashboard-scroll-tasks">
              ${tasks.length ? tasks.map((task) => `
                <article class="dashboard-task-card tone-${esc(getTaskTone(task))}">
                  <div class="dashboard-task-head">
                    <div>
                      <div class="dashboard-task-title">${esc(task.title || "Без названия")}</div>
                      <div class="muted">${esc(getTaskOrigin(task, currentUser))}</div>
                    </div>
                    <span class="status ${PRIORITY_CLASS[task.priority] || "open"}">${PRIORITY_LABEL[task.priority] || task.priority}</span>
                  </div>
                  <div class="dashboard-task-meta">
                    <span>Срок: ${formatDate(task.due_date)}</span>
                    <span>Исполнитель: ${esc(task.assignee || currentUser?.name || "—")}</span>
                    <span>Статус: ${String(task.status || "") === "done" ? "Выполнена" : "Открыта"}</span>
                  </div>
                  <div class="dashboard-task-body">${esc(task.description || "Без описания")}</div>
                </article>
              `).join("") : '<div class="dashboard-empty">Открытых задач сейчас нет.</div>'}
            </div>
          </div>
          ` : `
          <div class="card dashboard-panel">
            <div class="panel-head">
              <div>
                <h3>Последние изменения</h3>
                <div class="muted">Лента обновляется автоматически без перезагрузки страницы.</div>
              </div>
            </div>
            <div class="dashboard-feed dashboard-scroll dashboard-scroll-feed" style="--visible-count:3">
              ${recentChanges.length ? recentChanges.map((item) => `
                <div class="feed-item">
                  <div class="feed-dot"></div>
                  <div>
                    <div class="feed-text">${esc(item.text || "—")}</div>
                    <div class="muted">${formatRelativeTime(item.created_at)} · ${formatDateTime(item.created_at)}</div>
                  </div>
                </div>
              `).join("") : '<div class="dashboard-empty">Пока нет последних изменений.</div>'}
            </div>
          </div>

          <div class="card dashboard-panel">
            <div class="panel-head">
              <div>
                <h3>Задачи и поручения</h3>
                <div class="muted">Здесь видны личные задачи и поручения, поставленные руководством.</div>
              </div>
              <button id="addDashboardTaskBtn" class="btn-primary" type="button" title="Добавить задачу">+</button>
            </div>
            <div class="dashboard-task-list dashboard-scroll dashboard-scroll-tasks">
              ${tasks.length ? tasks.map((task) => `
                <article class="dashboard-task-card tone-${esc(getTaskTone(task))}">
                  <div class="dashboard-task-head">
                    <div>
                      <div class="dashboard-task-title">${esc(task.title || "Без названия")}</div>
                      <div class="muted">${esc(getTaskOrigin(task, currentUser))}</div>
                    </div>
                    <span class="status ${PRIORITY_CLASS[task.priority] || "open"}">${PRIORITY_LABEL[task.priority] || task.priority}</span>
                  </div>
                  <div class="dashboard-task-meta">
                    <span>Срок: ${formatDate(task.due_date)}</span>
                    <span>Исполнитель: ${esc(task.assignee || currentUser?.name || "—")}</span>
                    <span>Статус: ${String(task.status || "") === "done" ? "Выполнена" : "Открыта"}</span>
                  </div>
                  <div class="dashboard-task-body">${esc(task.description || "Без описания")}</div>
                </article>
              `).join("") : '<div class="dashboard-empty">Открытых задач сейчас нет.</div>'}
            </div>
          </div>
          `}
        </div>
      </section>
    </div>
  `;
}

async function renderDashboard() {
  const root = document.getElementById("pageRoot");
  const payload = await api("/api/dashboard");
  dashboardLastChangeId = payload.recentChanges?.[0]?.id || 0;
  renderDashboardView(root, payload);
  await bindDashboardTaskComposer(payload);

  if (dashboardRefreshHandle) clearInterval(dashboardRefreshHandle);
  dashboardRefreshHandle = setInterval(async () => {
    if (document.body.dataset.page !== "dashboard") return;
    try {
      const nextPayload = await api("/api/dashboard");
      const nextTopId = nextPayload.recentChanges?.[0]?.id || 0;
      if (dashboardLastChangeId && nextTopId > dashboardLastChangeId) {
        toast("На дашборд поступили новые изменения", "info");
      }
      dashboardLastChangeId = Math.max(dashboardLastChangeId, nextTopId);
      renderDashboardView(root, nextPayload);
      await bindDashboardTaskComposer(nextPayload);
    } catch (error) {
      console.error(error);
    }
  }, DASHBOARD_REFRESH_MS);
}

async function bindDashboardTaskComposer(payload) {
  const btn = document.getElementById("addDashboardTaskBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const user = window.__erpCurrentUser || payload?.currentUser || {};
    const canAssign = ["manager", "admin", "director"].includes(String(user.role || ""));
    const users = canAssign ? (await api("/api/users").catch(() => ({ items: [] }))).items || [] : [];

    const data = await showForm("Добавить задачу", [
      { name: "title", label: "Название задачи", required: true },
      { name: "description", label: "Описание", type: "textarea", placeholder: "Необязательно" },
      {
        name: "priority",
        label: "Приоритет",
        type: "select",
        options: [
          { value: "high", label: "Высокий" },
          { value: "medium", label: "Средний" },
          { value: "low", label: "Низкий" },
        ],
        value: "medium",
      },
      { name: "due_date", label: "Срок", type: "date" },
      ...(canAssign ? [{
        name: "user_id",
        label: "Исполнитель",
        type: "select",
        options: users.map((entry) => ({ value: String(entry.id), label: `${entry.name} (${ROLE_LABELS[entry.role] || entry.role})` })),
        value: String(user.id || ""),
      }] : []),
    ]);

    if (!data) return;

    await api("/api/tasks", "POST", {
      title: data.title,
      description: data.description || "",
      priority: data.priority || "medium",
      due_date: data.due_date || null,
      user_id: canAssign && data.user_id ? Number(data.user_id) : null,
    });

    toast("Задача добавлена");
    const root = document.getElementById("pageRoot");
    const nextPayload = await api("/api/dashboard");
    dashboardLastChangeId = nextPayload.recentChanges?.[0]?.id || 0;
    renderDashboardView(root, nextPayload);
    await bindDashboardTaskComposer(nextPayload);
  });
}

const TENDER_STATUSES = [
  { value: "open",   label: "Прием заявок" },
  { value: "review", label: "На рассмотрении" },
  { value: "draft",  label: "Черновик" },
  { value: "closed", label: "Закрыт" },
];

async function renderTenders(user) {
  const root = document.getElementById("pageRoot");
  const canEdit = user.role === "manager" || user.role === "admin";
  const isSupplier = user.role === "supplier";
  const isPicker = user.role === "picker";
  const isAdmin = user.role === "admin";
  const isManager = user.role === "manager";

  root.innerHTML = `
    <div class="card">
      <div class="top">
        <div><h3>Реестр тендеров</h3></div>
        ${canEdit ? '<button id="addTenderBtn" class="btn-primary" type="button">+ Тендер</button>' : ""}
      </div>
      <div class="filter-bar">
        <input id="filterSearch" type="search" placeholder="Поиск по номеру, лоту, клиенту..." class="filter-input">
        <select id="filterStatus" class="filter-select">
          <option value="">Все статусы площадки</option>
          <option value="open">Прием заявок</option>
          <option value="review">На рассмотрении</option>
          <option value="draft">Черновик</option>
          <option value="commission">Работа комиссии</option>
          <option value="awaiting_signing">Ожидание подписания</option>
          <option value="signed">Подписан</option>
          <option value="closed">Закрыт</option>
        </select>
        <select id="filterInternalStatus" class="filter-select">
          <option value="">Все внутр. статусы</option>
          <option value="awaiting_picking">Ожидает подбора</option>
          <option value="awaiting_application">Ожидает подачи заявки</option>
          <option value="submitted">Заявка подана</option>
          <option value="won_waiting_sign">Выиграли</option>
          <option value="signed_ours">Подписан с нашей стороны</option>
          <option value="signed_both">Подписан с двух сторон</option>
          <option value="executed">Исполнен</option>
          <option value="archived_lost">Проиграли (архив)</option>
        </select>
        <label class="filter-archive-toggle">
          <input id="filterArchived" type="checkbox"> Показать архивные
        </label>
      </div>
      <table class="table">
        <thead><tr><th>Номер</th><th>Лот</th><th>Клиент</th><th>НМЦК</th><th>Срок</th><th>Статус площадки</th><th>Внутр. статус</th><th>Действия</th></tr></thead>
        <tbody id="tendersTableBody"><tr><td colspan="8" class="muted" style="text-align:center">Загрузка...</td></tr></tbody>
      </table>
    </div>
  `;

  let items = [];
  let filterTimer;

  async function loadTable() {
    const search = (document.getElementById("filterSearch")?.value || "").trim();
    const status = document.getElementById("filterStatus")?.value || "";
    const internalStatus = document.getElementById("filterInternalStatus")?.value || "";
    const archived = document.getElementById("filterArchived")?.checked ? "1" : "0";
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (internalStatus) params.set("internal_status", internalStatus);
    params.set("archived", archived);

    const tbody = document.getElementById("tendersTableBody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="muted" style="text-align:center">Загрузка...</td></tr>`;

    try {
      const data = await api(`/api/tenders?${params}`);
      items = data.items || [];
    } catch (e) {
      items = [];
    }

    const tbody2 = document.getElementById("tendersTableBody");
    if (!tbody2) return;

    if (items.length === 0) {
      tbody2.innerHTML = `<tr><td colspan="8" class="muted" style="text-align:center">Ничего не найдено</td></tr>`;
      return;
    }

    tbody2.innerHTML = items.map((t) => `<tr>
      <td><a data-entity-type="tender" data-entity-id="${t.id}">${t.number}</a></td>
      <td>${t.lot}</td>
      <td><a data-entity-type="client" data-entity-id="${t.client}">${t.client}</a></td>
      <td>${formatMoney(t.price)}</td><td>${formatDate(t.deadline)}</td><td>${statusBadge(t.status)}</td><td>${internalStatusBadge(t.internal_status)}</td>
      <td>
        <div class="row-actions">
          <button data-details="${t.id}" type="button">Детали</button>
          ${canEdit ? `<button data-edit="${t.id}" type="button">Изменить</button>` : ""}
          ${(canEdit && !String(t.source_url || "").trim() && t.status === "draft") ? `<button data-quotes="${t.id}" type="button">КП / НМЦК</button>` : ""}
          ${isAdmin ? `<button data-del="${t.id}" type="button" class="btn-danger-outline">Удалить</button>` : ""}
          ${isSupplier ? `<button data-apply="${t.id}" type="button">Подать заявку</button>` : ""}
          ${isPicker ? `<button data-items="${t.id}" type="button">Подбор товаров</button>` : ""}
          ${(isManager && t.internal_status === "awaiting_application") ? `<button data-submitpkg="${t.id}" type="button">Подача заявки</button>` : ""}
          ${(canEdit && t.status === "commission") ? `<button data-commission="${t.id}" type="button">Сменить статус</button>` : ""}
          ${(isManager && ["won_waiting_sign", "signed_ours"].includes(String(t.internal_status || ""))) ? `<button data-contractsign="${t.id}" type="button">Подписание договора</button>` : ""}
        </div>
      </td>
    </tr>
    <tr id="details-row-${t.id}" style="display:none"><td colspan="8"><div id="details-panel-${t.id}" class="quotes-panel"></div></td></tr>
    <tr id="quotes-row-${t.id}" style="display:none"><td colspan="8"><div id="quotes-panel-${t.id}" class="quotes-panel"></div></td></tr>
    <tr id="items-row-${t.id}" style="display:none"><td colspan="8"><div id="items-panel-${t.id}" class="quotes-panel"></div></td></tr>
    <tr id="submitpkg-row-${t.id}" style="display:none"><td colspan="8"><div id="submitpkg-panel-${t.id}" class="quotes-panel"></div></td></tr>`).join("");

    bindTableListeners();
  }

  function bindTableListeners() {
    const tbody = document.getElementById("tendersTableBody");
    if (!tbody) return;

    tbody.querySelectorAll("[data-details]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tid = btn.dataset.details;
        const row = document.getElementById(`details-row-${tid}`);
        const panel = document.getElementById(`details-panel-${tid}`);
        const tender = items.find((x) => String(x.id) === String(tid));
        if (row.style.display !== "none") { row.style.display = "none"; return; }
        row.style.display = "";
        await renderTenderDetailsPanel(panel, tender);
      });
    });

    if (canEdit) {
      tbody.querySelectorAll("[data-edit]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const row = items.find((x) => String(x.id) === String(btn.dataset.edit));
          const data = await showForm("Редактировать тендер", [
            { name: "number",   label: "Номер закупки",         value: row.number,   required: true },
            { name: "lot",      label: "Лот / Предмет закупки", value: row.lot },
            { name: "client",   label: "Заказчик",              value: row.client },
            { name: "price",    label: "НМЦК (руб.)",           type: "number", value: row.price },
            { name: "deadline", label: "Срок подачи заявок",    type: "date",   value: row.deadline },
            { name: "status",   label: "Статус",                type: "select", options: TENDER_STATUSES, value: row.status },
          ]);
          if (!data) return;
          try {
            await api(`/api/tenders/${row.id}`, "PUT", { ...data, price: Number(data.price) });
            toast("Тендер обновлён");
            loadTable();
          } catch (e) { toast(e.message, "error"); }
        });
      });

      tbody.querySelectorAll("[data-del]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!await confirmModal("Удалить тендер? Все связанные данные также будут удалены.")) return;
          await api(`/api/tenders/${btn.dataset.del}`, "DELETE");
          toast("Тендер удалён");
          loadTable();
        });
      });

      tbody.querySelectorAll("[data-quotes]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const tid = btn.dataset.quotes;
          const row = document.getElementById(`quotes-row-${tid}`);
          const panel = document.getElementById(`quotes-panel-${tid}`);
          if (row.style.display !== "none") { row.style.display = "none"; return; }
          row.style.display = "";
          await renderQuotesPanel(panel, tid, user);
        });
      });

      tbody.querySelectorAll("[data-commission]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const tid = btn.dataset.commission;
          const tender = items.find((x) => String(x.id) === String(tid));
          const form = await showForm("Решение комиссии", [
            {
              name: "decision",
              label: "Результат",
              type: "select",
              value: "won",
              options: [
                { value: "won", label: "Выиграли" },
                { value: "lost", label: "Проиграли" },
              ],
            },
          ]);
          if (!form) return;
          try {
            await api(`/api/tenders/${tender.id}/commission-decision`, "PUT", { decision: form.decision });
            toast(form.decision === "lost" ? "Тендер проигран и перенесен в архив" : "Тендер выигран: статус площадки -> Ожидание подписания");
            loadTable();
          } catch (e) { toast(e.message, "error"); }
        });
      });
    }

    if (isPicker) {
      tbody.querySelectorAll("[data-items]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const tid = btn.dataset.items;
          const row = document.getElementById(`items-row-${tid}`);
          const panel = document.getElementById(`items-panel-${tid}`);
          const tender = items.find((x) => String(x.id) === String(tid));
          if (row.style.display !== "none") { row.style.display = "none"; return; }
          row.style.display = "";
          await renderTenderItemsPanel(panel, tender, user);
        });
      });
    }

    if (isManager) {
      tbody.querySelectorAll("[data-submitpkg]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const tid = btn.dataset.submitpkg;
          const row = document.getElementById(`submitpkg-row-${tid}`);
          const panel = document.getElementById(`submitpkg-panel-${tid}`);
          const tender = items.find((x) => String(x.id) === String(tid));
          if (row.style.display !== "none") { row.style.display = "none"; return; }
          row.style.display = "";
          await renderSubmissionPackagePanel(panel, tender);
        });
      });

      tbody.querySelectorAll("[data-contractsign]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const tid = btn.dataset.contractsign;
          const tender = items.find((x) => String(x.id) === String(tid));
          const isFirstStep = String(tender.internal_status || "") === "won_waiting_sign";
          const form = await showForm("Подписание договора", [
            {
              name: "stage",
              label: "Следующий внутренний статус",
              type: "select",
              value: isFirstStep ? "signed_ours" : "signed_both",
              options: isFirstStep
                ? [{ value: "signed_ours", label: "Подписан с нашей стороны" }]
                : [{ value: "signed_both", label: "Подписан с двух сторон" }],
            },
          ]);
          if (!form) return;
          try {
            await api(`/api/tenders/${tender.id}/contract-sign`, "PUT", { stage: form.stage });
            toast(form.stage === "signed_both" ? "Договор подписан с двух сторон, статус площадки -> Подписан" : "Договор подписан с нашей стороны");
            loadTable();
          } catch (e) { toast(e.message, "error"); }
        });
      });
    }

    if (isSupplier) {
      tbody.querySelectorAll("[data-apply]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const tenderId = btn.dataset.apply;
          const data = await showForm("Подать заявку на участие", [
            { name: "price",         label: "Ваша цена (руб.)",      type: "number", required: true },
            { name: "delivery_days", label: "Срок поставки (дней)",  type: "number", value: "14" },
            { name: "note",          label: "Комментарий",           type: "textarea", placeholder: "Необязательно" },
          ]);
          if (!data) return;
          try {
            await api("/api/applications", "POST", {
              tender_id: Number(tenderId),
              price: Number(data.price),
              delivery_days: Number(data.delivery_days || 14),
              note: data.note || "",
            });
            toast("Заявка подана");
          } catch (e) { toast(e.message, "error"); }
        });
      });
    }
  }

  // Bind filter events (once on shell elements)
  document.getElementById("filterSearch")?.addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(loadTable, 300);
  });
  document.getElementById("filterStatus")?.addEventListener("change", loadTable);
  document.getElementById("filterInternalStatus")?.addEventListener("change", loadTable);
  document.getElementById("filterArchived")?.addEventListener("change", loadTable);

  if (canEdit) {
    document.getElementById("addTenderBtn")?.addEventListener("click", async () => {
      const mode = await showForm("Добавить тендер", [
        {
          name: "mode",
          label: "Режим добавления",
          type: "select",
          value: "manual",
          options: [
            { value: "manual", label: "Вручную" },
            { value: "import", label: "Импорт по ID закупки" },
          ],
        },
      ]);
      if (!mode) return;

      try {
        if (mode.mode === "manual") {
          const data = await showForm("Добавить тендер вручную", [
            { name: "number",   label: "Номер закупки",          required: true },
            { name: "lot",      label: "Лот / Предмет закупки",  required: true },
            { name: "client",   label: "Заказчик",               required: true },
            { name: "price",    label: "НМЦК (руб.)",            type: "number", value: "1000000" },
            { name: "deadline", label: "Срок подачи заявок",     type: "date",   value: "2026-04-01" },
            { name: "status",   label: "Статус",                 type: "select", options: TENDER_STATUSES, value: "open" },
          ]);
          if (!data) return;
          await api("/api/tenders", "POST", { ...data, price: Number(data.price) });
          toast("Тендер добавлен");
          loadTable();
          return;
        }

        const source = await showForm("Импорт тендера по ID", [
          { name: "tender_id", label: "ID закупки или ссылка", required: true, placeholder: "Например: 19493882 или https://zakupki.gov.ru/...noticeInfoId=19493882" },
          { name: "url", label: "Ссылка (необязательно)", placeholder: "https://zakupki.gov.ru/epz/order/notice/notice223/documents.html?noticeInfoId=..." },
        ]);
        if (!source) return;

        const rawTenderInput = (source.tender_id || "").trim();
        const extractedId = (rawTenderInput.match(/noticeInfoId=(\d+)/i)?.[1]
          || rawTenderInput.match(/(\d{6,})/)?.[1]
          || "").trim();
        const resolvedUrl = (source.url || (rawTenderInput.startsWith("http") ? rawTenderInput : "")).trim();

        const parsedResp = await api("/api/tenders/parse-url", "POST", {
          ...(resolvedUrl ? { url: resolvedUrl } : {}),
          tenderId: extractedId,
          noticeInfoId: extractedId,
        });
        const parsed = parsedResp.data || {};

        const formTitle = parsedResp.partial
          ? "Сайт недоступен — заполните вручную"
          : "Проверьте данные перед сохранением";

        const reviewed = await showForm(formTitle, [
          { name: "number", label: "Номер закупки", value: parsed.number, required: true },
          { name: "registry_number", label: "Реестровый номер", value: parsed.registry_number },
          { name: "lot", label: "Лот / Предмет закупки", value: parsed.lot, required: true },
          { name: "client", label: "Заказчик", value: parsed.client, required: true },
          { name: "price", label: "НМЦК (руб.)", type: "number", value: String(parsed.price || 0) },
          { name: "deadline", label: "Срок подачи заявок", type: "date", value: parsed.deadline },
          { name: "status", label: "Статус", type: "select", options: TENDER_STATUSES, value: parsed.status || "open" },
          { name: "documents_count", label: "Найдено документов", value: String((parsed.documents || []).length || 0) },
          { name: "customer_inn", label: "ИНН", value: parsed.customer_inn },
          { name: "customer_kpp", label: "КПП", value: parsed.customer_kpp },
          { name: "contact_name", label: "Контактное лицо", value: parsed.contact_name },
          { name: "contact_email", label: "Контактный email", type: "email", value: parsed.contact_email },
          { name: "contact_phone", label: "Контактный телефон", value: parsed.contact_phone },
        ]);
        if (!reviewed) return;

        await api("/api/tenders", "POST", {
          ...parsed,
          ...reviewed,
          source_url: (source.url || parsed.source_url || "").trim(),
          documents: parsed.documents || [],
          price: Number(reviewed.price || 0),
        });
        toast("Тендер импортирован");
        loadTable();
      } catch (e) {
        toast(e.message, "error");
      }
    });
  }

  await loadTable();
}

async function renderTenderDetailsPanel(panel, tender) {
  panel.innerHTML = "<p class='muted'>Загрузка данных...</p>";
  let files = [];
  let items = [];
  let submissionFiles = [];
  try {
    const [filesResp, itemsResp, submissionResp] = await Promise.all([
      api(`/api/tenders/${tender.id}/files`),
      api(`/api/tenders/${tender.id}/items`).catch(() => ({ items: [] })),
      api(`/api/tenders/${tender.id}/submission-package`).catch(() => ({ items: [] })),
    ]);
    files = filesResp.items || [];
    items = itemsResp.items || [];
    submissionFiles = submissionResp.items || [];
  } catch {
    files = [];
    items = [];
    submissionFiles = [];
  }

  const procurement = [
    ["Реестровый номер", tender.registry_number || tender.number || "—"],
    ["Номер извещения", tender.notice_number || "—"],
    ["Способ закупки", tender.procurement_method || "—"],
    ["Площадка", tender.platform_name || "—"],
    ["Ссылка на площадку", tender.platform_url || "—"],
    ["Дата публикации", tender.publication_date ? formatDate(tender.publication_date) : "—"],
    ["Дата обновления", tender.update_date ? formatDate(tender.update_date) : "—"],
    ["Решение об изменениях", tender.decision_date ? formatDate(tender.decision_date) : "—"],
    ["Источник", tender.source_url || "—"],
  ];

  const company = [
    ["Заказчик", tender.client || "—"],
    ["ИНН", tender.customer_inn || "—"],
    ["КПП", tender.customer_kpp || "—"],
    ["ОГРН", tender.customer_ogrn || "—"],
    ["Адрес", tender.customer_address || "—"],
    ["Почтовый адрес", tender.customer_postal_address || "—"],
  ];

  const contacts = [
    ["Контактное лицо", tender.contact_name || "—"],
    ["Email", tender.contact_email || "—"],
    ["Телефон", tender.contact_phone || "—"],
    ["Начало подачи", tender.application_start ? formatDate(tender.application_start) : "—"],
    ["Окончание подачи", tender.application_end ? formatDate(tender.application_end) : formatDate(tender.deadline)],
  ];

  const goodsCost = items.reduce((sum, it) => sum + Number(it.quantity || 0) * Number(it.price_est || 0), 0);
  const participationFee = Number(tender.participation_fee || 5000);
  const deliveryCost = Number(tender.delivery_cost || 5000);
  const bankGuaranteeCost = Number(tender.bank_guarantee_cost || 0);
  const vatRate = Number(tender.vat_rate || 22);

  const baseCost = goodsCost + participationFee + deliveryCost + bankGuaranteeCost;
  const vatAmount = (baseCost * vatRate) / 100;
  const totalCost = baseCost + vatAmount;
  const revenue = Number(tender.price || 0);
  const marginAbs = revenue - totalCost;
  const marginPct = revenue > 0 ? (marginAbs / revenue) * 100 : 0;

  const canManageFinance = ["manager", "admin"].includes(window.__erpUserRole || "");

  const allFiles = [
    ...files.map((f) => ({
      doc_type: f.doc_type || "Документ закупки",
      file_name: f.file_name,
      file_ext: f.file_ext,
      href: f.local_url || f.source_url || "#",
    })),
    ...submissionFiles.map((f) => ({
      doc_type: "Пакет для подачи заявки",
      file_name: f.file_name,
      file_ext: (String(f.file_name || "").split(".").pop() || "").toLowerCase(),
      href: f.local_url || "#",
    })),
  ];

  const documentsRows = allFiles.length
    ? allFiles.map((f) => {
        const label = `${f.file_name} (${(f.file_ext || "").toUpperCase()})`;
        return `<div class="list-item"><strong>${esc(f.doc_type || "Документ")}:</strong> <a href="${esc(f.href)}" target="_blank">${esc(label)}</a></div>`;
      }).join("")
    : '<div class="list-item">Файлы не добавлены</div>';

  const block = (title, rows) => `
    <div style="padding:10px 0;">
      <h4 style="margin-bottom:8px;">${esc(title)}</h4>
      <div class="list">${rows.map(([k, v]) => `<div class="list-item"><strong>${esc(k)}:</strong> ${esc(String(v))}</div>`).join("")}</div>
    </div>
  `;

  const financeBlock = `
    <div style="padding:10px 0;">
      <div class="top" style="margin-bottom:8px;">
        <h4 style="margin:0;">Маржинальность тендера</h4>
        ${canManageFinance ? `<button id="financeSettingsBtn-${tender.id}" type="button">Параметры расчёта</button>` : ""}
      </div>
      <div class="list">
        <div class="list-item"><strong>Выручка (НМЦК):</strong> ${formatMoney(revenue)}</div>
        <div class="list-item"><strong>Себестоимость товаров:</strong> ${formatMoney(goodsCost)}</div>
        <div class="list-item"><strong>Участие в тендере:</strong> ${formatMoney(participationFee)}</div>
        <div class="list-item"><strong>Доставка до клиента:</strong> ${formatMoney(deliveryCost)}</div>
        <div class="list-item"><strong>Банковская гарантия:</strong> ${formatMoney(bankGuaranteeCost)}</div>
        <div class="list-item"><strong>База до НДС:</strong> ${formatMoney(baseCost)}</div>
        <div class="list-item"><strong>НДС (${formatPercent(vatRate)}):</strong> ${formatMoney(vatAmount)}</div>
        <div class="list-item"><strong>Полная себестоимость:</strong> ${formatMoney(totalCost)}</div>
        <div class="list-item"><strong>Маржа:</strong> ${formatMoney(marginAbs)} (${formatPercent(marginPct)})</div>
      </div>
    </div>
  `;

  const financeVisibleStatuses = ["awaiting_application", "submitted", "won_waiting_sign", "signed_ours", "signed_both", "archived_lost"];
  const canShowFinance = financeVisibleStatuses.includes(String(tender.internal_status || ""));

  const financeSection = canShowFinance
    ? financeBlock
    : `<div style="padding:10px 0;"><h4 style="margin-bottom:8px;">Маржинальность тендера</h4><div class="list"><div class="list-item">Финансовый блок доступен после перехода во внутренний статус "Ожидает подачи заявки".</div></div></div>`;

  panel.innerHTML = `${block("Карточка тендера", procurement)}${block("Карточка компании", company)}${block("Контакты", contacts)}${financeSection}<div style="padding:10px 0;"><h4 style="margin-bottom:8px;">Документы</h4><div class="list">${documentsRows}</div></div>`;

  if (canManageFinance && canShowFinance) {
    const btn = panel.querySelector(`#financeSettingsBtn-${tender.id}`);
    if (btn) {
      btn.addEventListener("click", async () => {
        const data = await showForm("Параметры маржинальности", [
          { name: "participation_fee", label: "Участие в тендере (руб.)", type: "number", value: String(participationFee) },
          { name: "delivery_cost", label: "Доставка до клиента (руб.)", type: "number", value: String(deliveryCost) },
          { name: "bank_guarantee_cost", label: "Банковская гарантия (руб.)", type: "number", value: String(bankGuaranteeCost) },
          { name: "vat_rate", label: "НДС (%)", type: "number", value: String(vatRate) },
        ]);
        if (!data) return;
        try {
          const resp = await api(`/api/tenders/${tender.id}/finance`, "PUT", {
            participation_fee: Number(data.participation_fee || 0),
            delivery_cost: Number(data.delivery_cost || 0),
            bank_guarantee_cost: Number(data.bank_guarantee_cost || 0),
            vat_rate: Number(data.vat_rate || 0),
          });
          Object.assign(tender, resp.item || {});
          toast("Параметры маржинальности сохранены");
          await renderTenderDetailsPanel(panel, tender);
        } catch (e) { toast(e.message, "error"); }
      });
    }
  }
}

async function renderSubmissionPackagePanel(panel, tender) {
  panel.innerHTML = "<p class='muted'>Загрузка...</p>";

  const canGenerate = tender.internal_status === "awaiting_application";
  const resp = await api(`/api/tenders/${tender.id}/submission-package`).catch(() => ({ items: [] }));
  const files = resp.items || [];
  const hasGeneratedPackage = files.length > 0;

  const filesHtml = files.length
    ? files.map((f) => `<div class="list-item"><a href="${esc(f.local_url)}" target="_blank">${esc(f.file_name)}</a> <span class="muted">(${Math.round(Number(f.file_size || 0) / 1024)} KB)</span></div>`).join("")
    : '<div class="list-item">Пакет еще не сгенерирован</div>';

  panel.innerHTML = `
    <div style="padding:10px 0;">
      <div class="top" style="margin-bottom:8px;">
        <h4 style="margin:0;">Комплект документов для подачи заявки</h4>
        ${canGenerate ? `<div style="display:flex;gap:8px;flex-wrap:wrap;"><button id="generateSubmissionBtn-${tender.id}" class="btn-primary" type="button">Сгенерировать комплект</button>${hasGeneratedPackage ? `<button id="markSubmittedBtn-${tender.id}" type="button">Заявка подана</button>` : ""}</div>` : ""}
      </div>
      ${canGenerate ? "" : `<p class="muted" style="margin-bottom:8px;">Доступно только во внутреннем статусе "Ожидает подачи заявки".</p>`}
      ${tender.notice_number ? `<p class="muted" style="margin-bottom:8px;">Номер извещения: <strong>${esc(tender.notice_number)}</strong></p>` : ""}
      <div class="list">${filesHtml}</div>
    </div>
  `;

  if (canGenerate) {
    const btn = panel.querySelector(`#generateSubmissionBtn-${tender.id}`);
    if (btn) {
      btn.addEventListener("click", async () => {
        if (!await confirmModal("Сгенерировать комплект документов для подачи заявки?", "Подтвердить", "btn-primary")) return;
        try {
          await api(`/api/tenders/${tender.id}/submission-package/generate`, "POST", {});
          toast("Комплект документов сформирован");
          await renderSubmissionPackagePanel(panel, tender);
        } catch (e) { toast(e.message, "error"); }
      });
    }

    const submittedBtn = panel.querySelector(`#markSubmittedBtn-${tender.id}`);
    if (submittedBtn) {
      submittedBtn.addEventListener("click", async () => {
        const form = await showForm("Заявка подана", [
          { name: "notice_number", label: "Номер извещения", required: true, value: tender.notice_number || "" },
        ]);
        if (!form) return;
        try {
          const respUpdate = await api(`/api/tenders/${tender.id}/notice-number`, "PUT", {
            notice_number: String(form.notice_number || "").trim(),
          });
          Object.assign(tender, respUpdate.item || {});
          toast("Номер извещения сохранен");
          await renderSubmissionPackagePanel(panel, tender);
        } catch (e) { toast(e.message, "error"); }
      });
    }
  }
}

async function renderTenderItemsPanel(panel, tender, user) {
  const canEdit = user.role === "picker" || user.role === "admin";
  panel.innerHTML = "<p class='muted'>Загрузка...</p>";

  // Load docs and items in parallel
  const [filesResp, itemsResp] = await Promise.all([
    api(`/api/tenders/${tender.id}/files`).catch(() => ({ items: [] })),
    api(`/api/tenders/${tender.id}/items`).catch(() => ({ items: [] })),
  ]);
  const files = filesResp.items || [];
  const tenderItems = itemsResp.items || [];

  const docsHtml = files.length
    ? files.map((f) => {
        const href = f.local_url || f.source_url || "#";
        const ext = (f.file_ext || "").toUpperCase();
        return `<div class="list-item">
          <strong>${esc(f.doc_type || "Документ")}:</strong>
          <a href="${esc(href)}" target="_blank">${esc(f.file_name)} (${ext})</a>
        </div>`;
      }).join("")
    : '<div class="list-item muted">Документы не загружены</div>';

  const itemsTableHtml = tenderItems.length
    ? `<table class="table" style="margin-top:8px;">
        <thead><tr>
          <th>Артикул</th><th>Наименование</th><th>Кол-во</th><th>Ед.</th>
          <th>Цена ориент.</th><th>Примечание</th><th>Добавил</th>
          ${canEdit ? "<th></th>" : ""}
        </tr></thead>
        <tbody>
          ${tenderItems.map((it) => `<tr>
            <td>${esc(it.article || "—")}</td>
            <td><strong>${esc(it.name)}</strong></td>
            <td>${it.quantity}</td>
            <td>${esc(it.unit)}</td>
            <td>${it.price_est ? formatMoney(it.price_est) : "—"}</td>
            <td>${esc(it.note || "—")}</td>
            <td>${esc(it.added_by || "—")}</td>
            ${canEdit ? `<td><button data-del-item="${it.id}" class="btn-danger-outline" type="button">✕</button></td>` : ""}
          </tr>`).join("")}
        </tbody>
      </table>
      <p style="margin-top:8px;font-weight:600;">
        Итого позиций: ${tenderItems.length} | 
        Ориентировочная сумма: ${formatMoney(tenderItems.reduce((s, i) => s + (i.price_est || 0) * (i.quantity || 1), 0))}
      </p>`
    : '<p class="muted">Товарные позиции ещё не добавлены</p>';

  panel.innerHTML = `
    <div style="padding:10px 0;">
      <h4 style="margin-bottom:8px;">Документация тендера</h4>
      <div class="list">${docsHtml}</div>
    </div>
    <div style="padding:10px 0;">
      <div class="top" style="margin-bottom:8px;">
        <h4>Подобранные товары</h4>
        ${canEdit ? `<div style="display:flex;gap:8px;flex-wrap:wrap;"><button id="addItemBtn-${tender.id}" class="btn-primary" type="button">+ Добавить позицию</button>${tender.internal_status !== "awaiting_application" ? `<button id="finishPickingBtn-${tender.id}" type="button">Завершить подбор</button>` : ""}</div>` : ""}
      </div>
      <p class="muted" style="margin-bottom:8px;">Внутренний статус: ${internalStatusBadge(tender.internal_status)}</p>
      ${itemsTableHtml}
    </div>
  `;

  if (canEdit) {
    panel.querySelectorAll("[data-del-item]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!await confirmModal("Удалить позицию?")) return;
        await api(`/api/tenders/${tender.id}/items/${btn.dataset.delItem}`, "DELETE");
        await renderTenderItemsPanel(panel, tender, user);
      });
    });

    const addBtn = panel.querySelector(`#addItemBtn-${tender.id}`);
    if (addBtn) {
      addBtn.addEventListener("click", async () => {
        const data = await showForm("Добавить товарную позицию", [
          { name: "article",   label: "Артикул / Код",                placeholder: "Необязательно" },
          { name: "name",      label: "Наименование товара",          required: true },
          { name: "quantity",  label: "Количество",                   type: "number", value: "1", required: true },
          { name: "unit",      label: "Единица измерения",            value: "шт", placeholder: "шт / кг / л / м / уп" },
          { name: "price_est", label: "Ориентировочная цена (руб.)", type: "number", value: "0" },
          { name: "note",      label: "Примечание",                   type: "textarea", placeholder: "Необязательно" },
        ]);
        if (!data) return;
        try {
          await api(`/api/tenders/${tender.id}/items`, "POST", {
            ...data,
            quantity: Number(data.quantity),
            price_est: Number(data.price_est || 0),
          });
          toast("Позиция добавлена");
          await renderTenderItemsPanel(panel, tender, user);
        } catch (e) { toast(e.message, "error"); }
      });
    }

    const finishBtn = panel.querySelector(`#finishPickingBtn-${tender.id}`);
    if (finishBtn) {
      finishBtn.addEventListener("click", async () => {
        if (!await confirmModal("Завершить подбор и перевести во внутренний статус 'Ожидает подачи заявки'?", "Подтвердить", "btn-primary")) return;
        try {
          await api(`/api/tenders/${tender.id}/internal-status`, "PUT", { internal_status: "awaiting_application" });
          toast("Внутренний статус обновлён: Ожидает подачи заявки");
          renderTenders(user);
        } catch (e) { toast(e.message, "error"); }
      });
    }
  }
}

async function renderQuotesPanel(panel, tenderId, user) {
  const canEdit = user.role === "manager" || user.role === "admin";
  const { quotes, nmck } = await api(`/api/tenders/${tenderId}/quotes`);

  panel.innerHTML = `
    <div style="padding:12px 0;">
      <h4 style="margin-bottom:8px;">Коммерческие предложения — расчёт НМЦК</h4>
      ${quotes.length
        ? `<p>Среднее (метод сопоставимых рыночных цен): <strong>${formatMoney(nmck)}</strong> — ${quotes.length} КП</p>`
        : "<p class='muted'>КП ещё не добавлены</p>"}
      <table class="table" style="margin-top:8px;">
        <thead><tr><th>Поставщик</th><th>Email</th><th>Цена</th><th>Срок (дн.)</th><th>Примечание</th>${canEdit ? "<th></th>" : ""}</tr></thead>
        <tbody>
          ${quotes.map((q) => `<tr>
            <td>${q.supplier_name}</td><td>${q.supplier_email || "—"}</td><td>${formatMoney(q.price)}</td>
            <td>${q.delivery_days || "—"}</td><td>${q.note || "—"}</td>
            ${canEdit ? `<td><button data-qd="${q.id}" class="btn-danger-outline" type="button">Удалить</button></td>` : ""}
          </tr>`).join("")}
        </tbody>
      </table>
      ${canEdit ? `<button id="addQuoteBtn-${tenderId}" class="btn-primary" style="margin-top:8px" type="button">+ Добавить КП</button>` : ""}
    </div>
  `;

  if (canEdit) {
    panel.querySelectorAll("[data-qd]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!await confirmModal("Удалить это КП?")) return;
        await api(`/api/tenders/${tenderId}/quotes/${btn.dataset.qd}`, "DELETE");
        await renderQuotesPanel(panel, tenderId, user);
      });
    });

    const addBtn = panel.querySelector(`#addQuoteBtn-${tenderId}`);
    if (addBtn) {
      addBtn.addEventListener("click", async () => {
        const data = await showForm("Добавить коммерческое предложение", [
          { name: "supplier_name",  label: "Поставщик",               required: true },
          { name: "supplier_email", label: "Email поставщика",         type: "email", placeholder: "Необязательно" },
          { name: "price",          label: "Цена (руб.)",              type: "number", value: "0", required: true },
          { name: "delivery_days",  label: "Срок поставки (дней)",     type: "number", value: "14" },
          { name: "note",           label: "Примечание",               placeholder: "Необязательно" },
        ]);
        if (!data) return;
        try {
          await api(`/api/tenders/${tenderId}/quotes`, "POST", {
            ...data, price: Number(data.price), delivery_days: Number(data.delivery_days || 0),
          });
          toast("КП добавлено");
          await renderQuotesPanel(panel, tenderId, user);
        } catch (e) { toast(e.message, "error"); }
      });
    }
  }
}

async function renderOrders(user) {
  const root = document.getElementById("pageRoot");
  const canEdit = user.role === "manager" || user.role === "admin";
  const canCreate = user.role === "picker" || user.role === "admin";
  let eligible = [];
  if (canCreate) {
    eligible = (await api("/api/orders/eligible-tenders").catch(() => ({ items: [] }))).items || [];
  }

  const orderStatuses = {
    draft: "Черновик",
    open: "В работе",
    review: "На согласовании",
    closed: "Закрыт",
    awaiting_payment: "Ожидает оплаты",
    paid: "Оплачен",
    stocked: "Поставлен на склад",
  };

  const tenderCards = canCreate
    ? `<div class="card">
        <div class="top">
          <h3>Подписанные договоры для заказа</h3>
        </div>
        ${eligible.length === 0 ? '<p class="muted">Нет подписанных договоров с доступными позициями.</p>' : ""}
        <div class="list">
          ${eligible.map((t) => {
            const available = (t.items || []).filter((it) => Number(it.remaining_qty || 0) > 0);
            const left = available
              .map((it) => `${esc(it.name)}: ${it.remaining_qty} ${esc(it.unit || "шт")}`)
              .join(" | ");
            const hasItems = available.length > 0;
            return `<div class="list-item">
              <div><strong>Тендер №${esc(t.number)}</strong> • ${esc(t.client || "—")}</div>
              <div class="muted">${esc(t.lot || "—")}</div>
              <div class="muted" style="margin-top:4px;">${hasItems
                ? `Доступные позиции: ${esc(left)}`
                : '<span style="color:#dc2626">Позиции не добавлены — зайдите в Тендеры → Подбор товаров</span>'}</div>
              <div style="margin-top:8px;">${hasItems
                ? `<button data-create-order="${t.id}" class="btn-primary" type="button">Создать заказ</button>`
                : ''}</div>
            </div>`;
          }).join("")}
        </div>
      </div>`
    : "";

  root.innerHTML = `
    ${tenderCards}
    <div class="card">
      <div class="top">
        <h3>Заказы</h3>
      </div>
      <div class="filter-bar">
        <input id="filterSearch" type="search" placeholder="Поиск по номеру, тендеру, клиенту..." class="filter-input">
        <select id="filterStatus" class="filter-select">
          <option value="">Все статусы</option>
          <option value="draft">Черновик</option>
          <option value="open">В работе</option>
          <option value="review">На согласовании</option>
          <option value="awaiting_payment">Ожидает оплаты</option>
          <option value="paid">Оплачен</option>
          <option value="stocked">Поставлен на склад</option>
          <option value="closed">Закрыт</option>
        </select>
        <label class="filter-archive-toggle">
          <input id="filterArchived" type="checkbox"> Показать архивные (склад / закрытые)
        </label>
      </div>
      <table class="table">
        <thead><tr><th>ID</th><th>Номер заказа</th><th>Тендер</th><th>Клиент</th><th>Счет</th><th>Поставка к нам</th><th>Сумма</th><th>Позиции</th><th>Статус</th><th>Действие</th></tr></thead>
        <tbody id="ordersTableBody"><tr><td colspan="10" class="muted" style="text-align:center">Загрузка...</td></tr></tbody>
      </table>
    </div>
  `;

  let items = [];
  let filterTimer;

  async function loadTable() {
    const search = (document.getElementById("filterSearch")?.value || "").trim();
    const status = document.getElementById("filterStatus")?.value || "";
    const archived = document.getElementById("filterArchived")?.checked ? "1" : "0";
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    params.set("archived", archived);

    const tbody = document.getElementById("ordersTableBody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="muted" style="text-align:center">Загрузка...</td></tr>`;

    try {
      const data = await api(`/api/orders?${params}`);
      items = data.items || [];
    } catch (e) {
      items = [];
    }

    const tbody2 = document.getElementById("ordersTableBody");
    if (!tbody2) return;

    if (items.length === 0) {
      tbody2.innerHTML = `<tr><td colspan="10" class="muted" style="text-align:center">Ничего не найдено</td></tr>`;
      return;
    }

    tbody2.innerHTML = items.map((o) => `<tr>
      <td>${o.id}</td>
      <td><a data-entity-type="order" data-entity-id="${o.id}">${esc(o.order_number || "—")}</a></td>
      <td><a data-entity-type="tender" data-entity-id="${o.tender_id}">${esc(o.tender_number || "—")}</a></td>
      <td><a data-entity-type="client" data-entity-id="${o.client}">${esc(o.client || "—")}</a></td>
      <td>${o.invoice_number ? `${esc(o.invoice_number)}<div class="muted">${statusBadge(o.invoice_status || "unpaid")}</div>` : "—"}</td>
      <td>${formatDate(o.supply_date)}</td>
      <td>${formatMoney(o.amount)}</td>
      <td>${(o.items || []).map((it) => `${esc(it.name)} (${it.quantity} ${esc(it.unit || "шт")})`).join("; ") || "—"}</td>
      <td><span class="status ${o.status}">${orderStatuses[o.status] || o.status}</span></td>
      <td>${canEdit ? `<button data-cycle="${o.id}" type="button">Сменить статус</button>` : (user.role === "picker" && o.status === "paid" ? `<button data-stocked="${o.id}" class="btn-primary" type="button">Поставлен на склад</button>` : "—")}</td>
    </tr>`).join("");

    bindTableListeners();
  }

  function bindTableListeners() {
    const tbody = document.getElementById("ordersTableBody");
    if (!tbody) return;

    if (canEdit) {
      tbody.querySelectorAll("[data-cycle]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const statuses = ["awaiting_payment", "paid", "open", "review", "closed"];
          const row = items.find((x) => String(x.id) === String(btn.dataset.cycle));
          const next = statuses[(statuses.indexOf(row.status) + 1) % statuses.length];
          await api(`/api/orders/${row.id}/status`, "PUT", { status: next });
          toast("Статус обновлён");
          loadTable();
        });
      });
    }

    if (user.role === "picker") {
      tbody.querySelectorAll("[data-stocked]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await api(`/api/orders/${btn.dataset.stocked}/status`, "PUT", { status: "stocked" });
            toast("Заказ переведен в статус 'Поставлен на склад'");
            loadTable();
          } catch (e) { toast(e.message, "error"); }
        });
      });
    }
  }

  if (canCreate) {
    root.querySelectorAll("[data-create-order]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tender = eligible.find((x) => String(x.id) === String(btn.dataset.createOrder));
        if (!tender) return;

        const available = (tender.items || []).filter((it) => Number(it.remaining_qty || 0) > 0);
        if (available.length === 0) {
          toast("Нет доступных позиций для заказа", "error");
          return;
        }

        const today = new Date().toISOString().slice(0, 10);
        const defaultOrderNum = `ORD-${Date.now()}`;

        const itemRows = available.map((it) => `
          <tr>
            <td>${esc(it.article || "—")}</td>
            <td>${esc(it.name)}</td>
            <td>${esc(it.unit || "шт")}</td>
            <td style="text-align:center;font-weight:600;">${it.remaining_qty}</td>
            <td style="white-space:nowrap;">
              <input type="number" class="order-item-qty" data-id="${it.id}"
                     min="0" max="${it.remaining_qty}" value="0" step="1"
                     style="width:70px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;">
            </td>
            <td style="white-space:nowrap;">
              <input type="number" class="order-item-price" data-id="${it.id}"
                     min="0" step="0.01" value="${Number(it.price_est || 0).toFixed(2)}"
                     style="width:100px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;">
            </td>
            <td class="order-item-total" data-id="${it.id}" style="white-space:nowrap;font-weight:600;">0,00 ₽</td>
          </tr>`).join("");

        ensureModal();
        document.getElementById("modalTitle").textContent = `Создать заказ — Тендер №${tender.number}`;
        document.getElementById("modalBody").innerHTML = `
          <div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
              <div class="field"><label>Номер заказа</label>
                <input id="newOrderNum" value="${esc(defaultOrderNum)}">
              </div>
              <div class="field"><label>Дата поставки к нам</label>
                <input id="newOrderDate" type="date" value="${today}">
              </div>
            </div>
            <table class="table" style="margin-bottom:14px;">
              <thead><tr>
                <th>Артикул</th><th>Наименование</th><th>Ед.</th>
                <th>Макс.</th><th>Кол-во</th><th>Цена закупки (₽)</th><th>Сумма</th>
              </tr></thead>
              <tbody>${itemRows}</tbody>
              <tfoot><tr>
                <td colspan="6" style="text-align:right;font-weight:700;padding:8px;">ИТОГО:</td>
                <td id="orderTotalSum" style="font-weight:700;white-space:nowrap;">0,00 ₽</td>
              </tr></tfoot>
            </table>
            <div class="modal-actions">
              <button id="confirmCreateOrderBtn" class="btn-primary" type="button">Создать заказ</button>
              <button id="cancelCreateOrderBtn" type="button" class="btn-secondary">Отмена</button>
            </div>
          </div>
        `;
        // Widen the modal-box for the table
        document.querySelector(".modal-box").classList.add("modal-wide");
        document.getElementById("erpModal").classList.add("open");

        function recalc() {
          let total = 0;
          available.forEach((it) => {
            const qtyEl = document.querySelector(`.order-item-qty[data-id="${it.id}"]`);
            const priceEl = document.querySelector(`.order-item-price[data-id="${it.id}"]`);
            const totalEl = document.querySelector(`.order-item-total[data-id="${it.id}"]`);
            if (!qtyEl || !priceEl || !totalEl) return;
            const qty = Math.min(Math.max(0, Number(qtyEl.value || 0)), Number(it.remaining_qty));
            const price = Math.max(0, Number(priceEl.value || 0));
            const lineTotal = qty * price;
            total += lineTotal;
            totalEl.textContent = lineTotal.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
          });
          const el = document.getElementById("orderTotalSum");
          if (el) el.textContent = total.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
        }

        document.querySelectorAll(".order-item-qty, .order-item-price").forEach((el) => {
          el.addEventListener("input", recalc);
        });
        recalc();

        document.getElementById("cancelCreateOrderBtn").addEventListener("click", closeModal);

        document.getElementById("confirmCreateOrderBtn").addEventListener("click", async () => {
          const orderNumber = (document.getElementById("newOrderNum").value || "").trim();
          const supplyDate = (document.getElementById("newOrderDate").value || "").trim();
          if (!orderNumber || !supplyDate) {
            toast("Укажите номер заказа и дату поставки", "error");
            return;
          }

          const selectedItems = [];
          let totalAmount = 0;
          available.forEach((it) => {
            const qtyEl = document.querySelector(`.order-item-qty[data-id="${it.id}"]`);
            const priceEl = document.querySelector(`.order-item-price[data-id="${it.id}"]`);
            if (!qtyEl || !priceEl) return;
            const qty = Math.min(Math.max(0, Number(qtyEl.value || 0)), Number(it.remaining_qty));
            const price = Math.max(0, Number(priceEl.value || 0));
            if (qty > 0) {
              selectedItems.push({ tender_item_id: Number(it.id), quantity: qty, price_actual: price });
              totalAmount += qty * price;
            }
          });

          if (selectedItems.length === 0) {
            toast("Выберите хотя бы одну позицию (кол-во > 0)", "error");
            return;
          }

          try {
            await api("/api/orders", "POST", {
              tender_id: tender.id,
              order_number: orderNumber,
              supply_date: supplyDate,
              amount: totalAmount,
              items: selectedItems,
            });
            closeModal();
            toast("Заказ создан");
            loadTable();
          } catch (e) { toast(e.message, "error"); }
        });
      });
    });
  }

  document.getElementById("filterSearch")?.addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(loadTable, 300);
  });
  document.getElementById("filterStatus")?.addEventListener("change", loadTable);
  document.getElementById("filterArchived")?.addEventListener("change", loadTable);

  await loadTable();
}

async function renderDeliveries(user) {
  const root = document.getElementById("pageRoot");
  const canLogistic = ["logistic", "admin"].includes(user.role);

  root.innerHTML = `
    <div class="card">
      <div class="top">
        <h3>Поставки</h3>
      </div>
      <div class="filter-bar">
        <input id="filterSearch" type="search" placeholder="Поиск по заказу, тендеру, клиенту..." class="filter-input">
        <select id="filterStatus" class="filter-select">
          <option value="">Все статусы</option>
          <option value="warehouse">На складе</option>
          <option value="scheduled">Назначено на дату отгрузки</option>
          <option value="shipped">Отгружено</option>
          <option value="received">Получено клиентом</option>
          <option value="closed">Закрыто</option>
        </select>
        <label class="filter-archive-toggle">
          <input id="filterArchived" type="checkbox"> Показать закрытые
        </label>
      </div>
      <table class="table">
        <thead><tr><th>Заказ</th><th>Тендер</th><th>Клиент</th><th>Лот</th><th>Дата отгрузки</th><th>Статус</th><th>Действия</th></tr></thead>
        <tbody id="deliveriesTableBody"><tr><td colspan="7" class="muted" style="text-align:center">Загрузка...</td></tr></tbody>
      </table>
    </div>
  `;

  let items = [];
  let filterTimer;

  async function loadTable() {
    const search = (document.getElementById("filterSearch")?.value || "").trim();
    const status = document.getElementById("filterStatus")?.value || "";
    const archived = document.getElementById("filterArchived")?.checked ? "1" : "0";
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    params.set("archived", archived);

    const tbody = document.getElementById("deliveriesTableBody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center">Загрузка...</td></tr>`;

    try {
      const data = await api(`/api/shipments?${params}`);
      items = data.items || [];
    } catch (e) {
      items = [];
    }

    const tbody2 = document.getElementById("deliveriesTableBody");
    if (!tbody2) return;

    if (items.length === 0) {
      tbody2.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center">Ничего не найдено</td></tr>`;
      return;
    }

    tbody2.innerHTML = items.map((s) => {
      const action = !canLogistic
        ? "—"
        : !s.transfer_ready
          ? "<span class=\"muted\">Ожидает передачи от бухгалтера</span>"
          : s.status === "warehouse"
            ? `<button data-ship-status=\"${s.id}\" data-next=\"scheduled\" type=\"button\">Назначить дату</button>`
            : s.status === "scheduled"
              ? `<button data-ship-status=\"${s.id}\" data-next=\"shipped\" type=\"button\">Отгружено</button>`
              : s.status === "shipped"
                ? `<button data-ship-status=\"${s.id}\" data-next=\"received\" type=\"button\">Получено клиентом</button>`
                : "—";

      return `<tr>
        <td><a data-entity-type="order" data-entity-id="${s.order_id}">${esc(s.order_number || "—")}</a></td>
        <td><a data-entity-type="tender" data-entity-id="${s.tender_id}">${esc(s.tender_number || "—")}</a></td>
        <td><a data-entity-type="client" data-entity-id="${s.client}">${esc(s.client || "—")}</a></td>
        <td>${esc(s.lot || "—")}</td>
        <td>${formatDate(s.shipment_date)}</td>
        <td>${statusBadge(s.status || "warehouse")}</td>
        <td><div class="row-actions">${action}</div></td>
      </tr>`;
    }).join("");

    bindTableListeners();
  }

  function bindTableListeners() {
    if (canLogistic) {
      document.getElementById("deliveriesTableBody")?.querySelectorAll("[data-ship-status]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.shipStatus;
          const next = btn.dataset.next;
          try {
            if (next === "scheduled") {
              const form = await showForm("Назначить дату отгрузки", [
                { name: "shipment_date", label: "Дата отгрузки", type: "date", required: true, value: new Date().toISOString().slice(0, 10) },
              ]);
              if (!form) return;
              await api(`/api/shipments/${id}/status`, "PUT", { status: next, shipment_date: form.shipment_date });
            } else {
              await api(`/api/shipments/${id}/status`, "PUT", { status: next });
            }
            toast("Статус поставки обновлён");
            loadTable();
          } catch (e) { toast(e.message, "error"); }
        });
      });
    }
  }

  document.getElementById("filterSearch")?.addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(loadTable, 300);
  });
  document.getElementById("filterStatus")?.addEventListener("change", loadTable);
  document.getElementById("filterArchived")?.addEventListener("change", loadTable);

  await loadTable();
}

async function renderClients(user) {
  const root = document.getElementById("pageRoot");
  const { items } = await api("/api/clients");
  const canEdit = user.role === "manager" || user.role === "admin";

  root.innerHTML = `
    <div class="card">
      <div class="top">
        <h3>Клиенты</h3>
        ${canEdit ? '<button id="addClientBtn" class="btn-primary" type="button">+ Клиент</button>' : ""}
      </div>
      <table class="table">
        <thead><tr><th>Компания</th><th>Контакт</th><th>Email</th><th>Телефон</th><th>Сегмент</th><th>Действия</th></tr></thead>
        <tbody>
          ${items.map((c) => `<tr>
            <td><a data-entity-type="client" data-entity-id="${c.id}">${c.company}</a></td>
            <td>${c.person}</td><td>${c.email}</td><td>${c.phone}</td><td>${c.segment}</td>
            <td>${canEdit ? `<div class="row-actions">
              <button data-edit="${c.id}" type="button">Изменить</button>
              <button data-del="${c.id}" type="button" class="btn-danger-outline">Удалить</button>
            </div>` : "—"}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  if (!canEdit) return;

  const SEGMENTS = [
    { value: "Крупный", label: "Крупный" },
    { value: "Средний", label: "Средний" },
    { value: "Малый",   label: "Малый" },
  ];
  const clientFields = (row = {}) => [
    { name: "company", label: "Компания",          value: row.company, required: true },
    { name: "person",  label: "Контактное лицо",   value: row.person },
    { name: "email",   label: "Email",             type: "email", value: row.email },
    { name: "phone",   label: "Телефон",           value: row.phone },
    { name: "segment", label: "Сегмент",           type: "select", options: SEGMENTS, value: row.segment || "Средний" },
  ];

  document.getElementById("addClientBtn").addEventListener("click", async () => {
    const data = await showForm("Добавить клиента", clientFields());
    if (!data) return;
    try {
      await api("/api/clients", "POST", data);
      toast("Клиент добавлен");
      renderClients(user);
    } catch (e) { toast(e.message, "error"); }
  });

  root.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = items.find((x) => String(x.id) === String(btn.dataset.edit));
      const data = await showForm("Редактировать клиента", clientFields(row));
      if (!data) return;
      try {
        await api(`/api/clients/${row.id}`, "PUT", data);
        toast("Клиент обновлён");
        renderClients(user);
      } catch (e) { toast(e.message, "error"); }
    });
  });

  root.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!await confirmModal("Удалить клиента?")) return;
      await api(`/api/clients/${btn.dataset.del}`, "DELETE");
      toast("Клиент удалён");
      renderClients(user);
    });
  });
}

async function renderReports() {
  const root = document.getElementById("pageRoot");
  const { summary, segments } = await api("/api/reports");

  root.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <h3>Сводка месяца</h3>
        <div class="list">
          <div class="list-item">Количество заказов: ${summary.ordersCount}</div>
          <div class="list-item">Сумма заказов: ${formatMoney(summary.ordersSum)}</div>
          <div class="list-item">Открытые тендеры: ${summary.openTenders}</div>
          <div class="list-item">Доставлено полностью: ${summary.doneDeliveries}</div>
        </div>
      </div>
      <div class="card">
        <h3>Сегменты клиентов</h3>
        <div class="list">
          ${segments.map((s) => `<div class="list-item">${s.segment}: <strong>${s.count}</strong></div>`).join("")}
        </div>
      </div>
    </div>
  `;
}

async function renderProfile(user) {
  const root = document.getElementById("pageRoot");

  root.innerHTML = `
    <div class="card">
      <h3>Профиль</h3>
      <form id="profileForm" style="max-width:650px;margin-top:10px;">
        <div class="field"><label>ФИО</label><input name="name" value="${esc(user.name)}"></div>
        <div class="field"><label>Компания</label><input name="company" value="${esc(user.company)}"></div>
        <div class="field"><label>Роль</label><input value="${esc(ROLE_LABELS[user.role] || user.role)}" disabled></div>
        <div class="field"><label>Описание</label><textarea name="bio">${esc(user.bio || "")}</textarea></div>
        <div class="field"><label>Новый пароль</label><input name="password" type="password" placeholder="Оставьте пустым, чтобы не менять"></div>
        <button class="btn-primary" type="submit">Сохранить</button>
      </form>
    </div>
  `;

  document.getElementById("profileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api("/api/profile", "PUT", {
        name: f.name.value,
        company: f.company.value,
        bio: f.bio.value,
        password: f.password.value,
      });
      toast("Профиль сохранён");
    } catch (err) { toast(err.message, "error"); }
  });
}

// ═══════════════════════════════════════════════
// Контракты
// ═══════════════════════════════════════════════

async function renderContracts(user) {
  const root = document.getElementById("pageRoot");
  const canEdit = user.role === "manager" || user.role === "admin";
  const { items } = await api("/api/contracts");

  root.innerHTML = `
    <div class="card">
      <div class="top">
        <h3>Контракты</h3>
        ${canEdit ? '<button id="addContractBtn" class="btn-primary" type="button">+ Контракт</button>' : ""}
      </div>
      <table class="table">
        <thead><tr><th>Номер</th><th>Клиент</th><th>Тендер</th><th>Сумма</th><th>Срок</th><th>Статус</th><th>Этапы</th><th>Действия</th></tr></thead>
        <tbody>
          ${items.map((c) => `
            <tr>
              <td><a data-entity-type="contract" data-entity-id="${c.id}">${c.number}</a></td>
              <td><a data-entity-type="client" data-entity-id="${c.client}">${c.client}</a></td>
              <td><a data-entity-type="tender" data-entity-id="${c.tender_id}">${c.tender_number || "—"}</a></td>
              <td>${formatMoney(c.amount)}</td><td>${formatDate(c.deadline)}</td>
              <td><span class="status ${c.status === "closed" ? "closed" : "open"}">${c.status === "closed" ? "Закрыт" : "Активен"}</span></td>
              <td>${c.stages.length ? `${c.stages.filter((s) => s.status === "done").length}/${c.stages.length}` : "—"}</td>
              <td>
                <div class="row-actions">
                  <button data-stages="${c.id}" type="button">Этапы</button>
                  ${canEdit ? `<button data-edit-contract="${c.id}" type="button">Изменить</button>` : ""}
                </div>
              </td>
            </tr>
            <tr id="stages-row-${c.id}" style="display:none">
              <td colspan="8"><div id="stages-panel-${c.id}" class="quotes-panel"></div></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  root.querySelectorAll("[data-stages]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const cid = btn.dataset.stages;
      const row = document.getElementById(`stages-row-${cid}`);
      const panel = document.getElementById(`stages-panel-${cid}`);
      if (row.style.display !== "none") { row.style.display = "none"; return; }
      row.style.display = "";
      const contract = items.find((x) => String(x.id) === String(cid));
      await renderStagesPanel(panel, cid, contract.stages, canEdit);
    });
  });

  if (!canEdit) return;

  const contractFields = (row = {}) => [
    { name: "number",      label: "Номер контракта",            value: row.number,      required: true },
    { name: "client",      label: "Клиент / Заказчик",          value: row.client,      required: true },
    { name: "amount",      label: "Сумма контракта (руб.)",     type: "number", value: row.amount ?? "0" },
    { name: "signed_date", label: "Дата подписания",            type: "date",   value: row.signed_date || new Date().toISOString().slice(0, 10) },
    { name: "deadline",    label: "Срок исполнения",            type: "date",   value: row.deadline || "2026-12-31" },
    { name: "status",      label: "Статус",                     type: "select", options: [{ value: "active", label: "Активен" }, { value: "closed", label: "Закрыт" }], value: row.status || "active" },
    { name: "tender_id",   label: "ID тендера (необязательно)", type: "number", value: row.tender_id || "", placeholder: "— без привязки —" },
    { name: "note",        label: "Примечание",                 type: "textarea", value: row.note || "" },
  ];

  document.getElementById("addContractBtn").addEventListener("click", async () => {
    const data = await showForm("Добавить контракт", contractFields());
    if (!data) return;
    try {
      await api("/api/contracts", "POST", {
        ...data, amount: Number(data.amount),
        tender_id: data.tender_id ? Number(data.tender_id) : null,
      });
      toast("Контракт добавлен");
      renderContracts(user);
    } catch (e) { toast(e.message, "error"); }
  });

  root.querySelectorAll("[data-edit-contract]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = items.find((x) => String(x.id) === String(btn.dataset.editContract));
      const data = await showForm("Редактировать контракт", contractFields(row));
      if (!data) return;
      try {
        await api(`/api/contracts/${row.id}`, "PUT", { ...data, amount: Number(data.amount) });
        toast("Контракт обновлён");
        renderContracts(user);
      } catch (e) { toast(e.message, "error"); }
    });
  });
}

async function renderStagesPanel(panel, contractId, stages, canEdit) {
  panel.innerHTML = `
    <div style="padding:12px 0;">
      <h4>Этапы исполнения контракта</h4>
      ${stages.length === 0 ? "<p class='muted' style='margin-top:8px'>Этапов ещё нет</p>" : ""}
      ${stages.length > 0 ? `<table class="table" style="margin-top:8px;">
        <thead><tr><th>Этап</th><th>%</th><th>Срок</th><th>Статус</th><th>Акт №</th>${canEdit ? "<th></th>" : ""}</tr></thead>
        <tbody>
          ${stages.map((s) => `<tr>
            <td>${s.title}</td>
            <td><div class="progress" style="min-width:60px"><div style="width:${s.percent}%"></div></div><span class="muted">${s.percent}%</span></td>
            <td>${formatDate(s.due_date)}</td>
            <td><span class="status ${s.status === "done" ? "open" : "draft"}">${s.status === "done" ? "Выполнен" : "Ожидает"}</span></td>
            <td>${s.act_number || "—"}</td>
            ${canEdit ? `<td><div class="row-actions">
              ${s.status !== "done" ? `<button data-done="${s.id}" type="button">Принять</button>` : ""}
              <button data-stage-del="${s.id}" class="btn-danger-outline" type="button">Удалить</button>
            </div></td>` : ""}
          </tr>`).join("")}
        </tbody>
      </table>` : ""}
      ${canEdit ? `<button id="addStageBtn-${contractId}" class="btn-primary" style="margin-top:8px" type="button">+ Добавить этап</button>` : ""}
    </div>
  `;

  if (!canEdit) return;

  const refresh = async () => {
    const { stages: fresh } = await api(`/api/contracts/${contractId}/stages`);
    await renderStagesPanel(panel, contractId, fresh, canEdit);
  };

  panel.querySelectorAll("[data-done]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const s = stages.find((x) => String(x.id) === String(btn.dataset.done));
      const data = await showForm(`Принять этап: ${s.title}`, [
        { name: "act_number", label: "Номер акта приёмки", placeholder: "Необязательно" },
      ]);
      if (data === null) return;
      try {
        await api(`/api/stages/${s.id}`, "PUT", {
          title: s.title, percent: s.percent, status: "done", due_date: s.due_date, act_number: data.act_number || "",
        });
        toast("Этап принят");
        await refresh();
      } catch (e) { toast(e.message, "error"); }
    });
  });

  panel.querySelectorAll("[data-stage-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!await confirmModal("Удалить этап?")) return;
      await api(`/api/stages/${btn.dataset.stageDel}`, "DELETE");
      await refresh();
    });
  });

  const addStageBtn = panel.querySelector(`#addStageBtn-${contractId}`);
  if (addStageBtn) {
    addStageBtn.addEventListener("click", async () => {
      const data = await showForm("Добавить этап исполнения", [
        { name: "title",    label: "Название этапа",               required: true },
        { name: "percent",  label: "Доля от суммы контракта (%)",  type: "number", value: "25" },
        { name: "due_date", label: "Срок выполнения",              type: "date",   value: new Date().toISOString().slice(0, 10) },
      ]);
      if (!data) return;
      try {
        await api(`/api/contracts/${contractId}/stages`, "POST", { ...data, percent: Number(data.percent) });
        toast("Этап добавлен");
        await refresh();
      } catch (e) { toast(e.message, "error"); }
    });
  }
}

// ═══════════════════════════════════════════════
// Задачи
// ═══════════════════════════════════════════════

const PRIORITY_LABEL = { high: "Высокий", medium: "Средний", low: "Низкий" };
const PRIORITY_CLASS = { high: "closed", medium: "review", low: "open" };

async function renderTasks(user) {
  const root = document.getElementById("pageRoot");
  const canAssign = ["manager", "admin", "director"].includes(String(user.role || ""));
  const { items } = await api("/api/tasks");
  const users = canAssign ? (await api("/api/users").catch(() => ({ items: [] }))).items || [] : [];
  const open = items.filter((t) => t.status === "open");
  const done = items.filter((t) => t.status === "done");

  root.innerHTML = `
    <div class="card">
      <div class="top">
        <h3>${canAssign ? "Задачи команды" : "Мои задачи и поручения"}</h3>
        <button id="addTaskBtn" class="btn-primary" type="button">+ Задача</button>
      </div>
      ${open.length === 0 ? '<p class="muted" style="padding:12px 0">Нет открытых задач</p>' : ""}
      ${open.length > 0 ? `<table class="table">
        <thead><tr><th>Задача</th><th>Приоритет</th><th>Срок</th>${canAssign ? "<th>Исполнитель</th>" : ""}<th>Источник</th><th>Описание</th><th>Действия</th></tr></thead>
        <tbody>${open.map((t) => taskRow(t)).join("")}</tbody>
      </table>` : ""}
      ${done.length ? `
        <details style="margin-top:16px">
          <summary class="muted" style="cursor:pointer">Выполнено (${done.length})</summary>
          <table class="table" style="margin-top:8px;opacity:.65">
            <thead><tr><th>Задача</th><th>Приоритет</th><th>Срок</th>${canAssign ? "<th>Исполнитель</th>" : ""}<th>Источник</th><th>Описание</th><th></th></tr></thead>
            <tbody>${done.map((t) => taskRow(t)).join("")}</tbody>
          </table>
        </details>` : ""}
    </div>
  `;

  document.getElementById("addTaskBtn").addEventListener("click", async () => {
    const data = await showForm("Добавить задачу", [
      { name: "title",       label: "Название задачи",                required: true },
      { name: "description", label: "Описание",                       type: "textarea", placeholder: "Необязательно" },
      { name: "priority",    label: "Приоритет",                      type: "select",
        options: [{ value: "high", label: "Высокий" }, { value: "medium", label: "Средний" }, { value: "low", label: "Низкий" }],
        value: "medium" },
      { name: "due_date",    label: "Срок",                           type: "date" },
      ...(canAssign ? [{
        name: "user_id",
        label: "Исполнитель",
        type: "select",
        options: users.map((entry) => ({ value: String(entry.id), label: `${entry.name} (${ROLE_LABELS[entry.role] || entry.role})` })),
        value: String(user.id),
      }] : []),
      { name: "tender_id",   label: "Привязать к тендеру (ID)",       type: "number", placeholder: "Необязательно" },
      { name: "order_id",    label: "Привязать к заказу (ID)",        type: "number", placeholder: "Необязательно" },
    ]);
    if (!data) return;
    try {
      await api("/api/tasks", "POST", {
        title: data.title,
        description: data.description || "",
        priority: data.priority || "medium",
        due_date: data.due_date || null,
        user_id: canAssign && data.user_id ? Number(data.user_id) : null,
        tender_id: data.tender_id ? Number(data.tender_id) : null,
        order_id: data.order_id ? Number(data.order_id) : null,
      });
      toast("Задача добавлена");
      renderTasks(user);
    } catch (e) { toast(e.message, "error"); }
  });

  root.querySelectorAll("[data-done-task]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const t = items.find((x) => String(x.id) === String(btn.dataset.doneTask));
      await api(`/api/tasks/${t.id}`, "PUT", {
        title: t.title, description: t.description, priority: t.priority, status: "done", due_date: t.due_date,
      });
      toast("Задача выполнена");
      renderTasks(user);
    });
  });

  root.querySelectorAll("[data-del-task]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!await confirmModal("Удалить задачу?")) return;
      await api(`/api/tasks/${btn.dataset.delTask}`, "DELETE");
      toast("Задача удалена");
      renderTasks(user);
    });
  });
}

function taskRow(t) {
  const isDone = t.status === "done";
  const canAssign = ["manager", "admin", "director"].includes(String(window.__erpCurrentUser?.role || ""));
  return `<tr style="${isDone ? "text-decoration:line-through;opacity:.6" : ""}">
    <td>${esc(t.title || "Без названия")}</td>
    <td><span class="status ${PRIORITY_CLASS[t.priority] || "open"}">${PRIORITY_LABEL[t.priority] || t.priority}</span></td>
    <td>${formatDate(t.due_date)}</td>
    ${canAssign ? `<td>${esc(t.assignee || "—")}</td>` : ""}
    <td>${esc(getTaskOrigin(t, window.__erpCurrentUser))}</td>
    <td>${esc(t.description || "—")}</td>
    <td>
      <div class="row-actions">
        ${!isDone ? `<button data-done-task="${t.id}" type="button">Выполнить</button>` : ""}
        <button data-del-task="${t.id}" class="btn-danger-outline" type="button">Удалить</button>
      </div>
    </td>
  </tr>`;
}

// ═══════════════════════════════════════════════
// Портал поставщика: заявки
// ═══════════════════════════════════════════════

async function renderApplications(user) {
  const root = document.getElementById("pageRoot");
  const canReview = user.role === "manager" || user.role === "admin";
  const { items } = await api("/api/applications");

  root.innerHTML = `
    <div class="card">
      <h3>${user.role === "supplier" ? "Мои заявки" : "Заявки поставщиков"}</h3>
      ${items.length === 0 ? '<p class="muted" style="padding:12px 0">Заявок нет</p>' : ""}
      ${items.length > 0 ? `<table class="table">
        <thead><tr>
          <th>Тендер</th><th>Лот</th>
          ${canReview ? "<th>Компания</th>" : ""}
          <th>Цена</th><th>Срок (дн.)</th><th>Статус</th>
          ${canReview ? "<th>Действие</th>" : ""}
        </tr></thead>
        <tbody>
          ${items.map((a) => `<tr>
            <td>${a.tender_number || a.tender_id}</td><td>${a.lot || "—"}</td>
            ${canReview ? `<td>${a.applicant_name || a.company}</td>` : ""}
            <td>${formatMoney(a.price)}</td><td>${a.delivery_days || "—"}</td>
            <td><span class="status ${a.status === "approved" ? "open" : a.status === "rejected" ? "closed" : "draft"}">${
              a.status === "approved" ? "Одобрена" : a.status === "rejected" ? "Отклонена" : "На рассмотрении"
            }</span></td>
            ${canReview ? `<td><div class="row-actions">
              ${a.status === "pending" ? `
                <button data-approve="${a.id}" type="button">Одобрить</button>
                <button data-reject="${a.id}" class="btn-danger-outline" type="button">Отклонить</button>` : "—"}
            </div></td>` : ""}
          </tr>`).join("")}
        </tbody>
      </table>` : ""}
    </div>
  `;

  if (canReview) {
    root.querySelectorAll("[data-approve]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await api(`/api/applications/${btn.dataset.approve}/status`, "PUT", { status: "approved" });
        toast("Заявка одобрена");
        renderApplications(user);
      });
    });
    root.querySelectorAll("[data-reject]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!await confirmModal("Отклонить заявку поставщика?", "Отклонить")) return;
        await api(`/api/applications/${btn.dataset.reject}/status`, "PUT", { status: "rejected" });
        toast("Заявка отклонена");
        renderApplications(user);
      });
    });
  }
}

async function renderAccounting() {
  const root = document.getElementById("pageRoot");
  const { kpi, signedTenders, orders, shipments } = await api("/api/accounting/overview");

  root.innerHTML = `
    <div class="card">
      <div class="kpi">
        <div class="tile"><small>Всего счетов</small><strong>${kpi.totalInvoices}</strong></div>
        <div class="tile"><small>Оплачено</small><strong>${Number(kpi.paidPercent || 0).toFixed(1)}%</strong><div class="muted">${kpi.paidCount} шт.</div></div>
        <div class="tile"><small>Не оплачено</small><strong>${Number(kpi.unpaidPercent || 0).toFixed(1)}%</strong><div class="muted">${kpi.unpaidCount} шт.</div></div>
        <div class="tile"><small>Заказы</small><strong>${orders.length}</strong></div>
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <h3>Заказы и счета</h3>
        <table class="table">
          <thead><tr><th>Заказ</th><th>Тендер</th><th>Клиент</th><th>Счет</th><th>Сумма</th><th>Статус</th><th>Действия</th></tr></thead>
          <tbody>
            ${orders.map((o) => `<tr>
              <td><a data-entity-type="order" data-entity-id="${o.id}">${esc(o.order_number || "—")}</a></td>
              <td><a data-entity-type="tender" data-entity-id="${o.tender_id}">${esc(o.tender_number || "—")}</a></td>
              <td><a data-entity-type="client" data-entity-id="${o.client}">${esc(o.client || "—")}</a></td>
              <td>${o.invoice_number ? `<a href="${esc(o.invoice_file_url || "#")}" target="_blank">${esc(o.invoice_number)}</a><div class="muted">${formatDate(o.issue_date)}</div>` : "—"}</td>
              <td>${formatMoney(o.amount)}</td>
              <td>${statusBadge(o.invoice_status || "unpaid")}</td>
              <td>
                <div class="row-actions">
                  <button data-tender-info="${o.id}" type="button">Тендер</button>
                  <button data-contract-items="${o.id}" type="button">Позиции договора</button>
                  ${o.invoice_id && o.invoice_status !== "paid" ? `<button data-pay-invoice="${o.invoice_id}" class="btn-primary" type="button">Оплатили</button>` : "—"}
                </div>
              </td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="card">
        <h3>Подписанные тендеры</h3>
        <div class="list">
          ${signedTenders.length ? signedTenders.map((t) => `<div class="list-item"><strong>№${esc(t.number)}</strong> — ${esc(t.client)}<div class="muted">${esc(t.lot || "—")}</div></div>`).join("") : '<div class="list-item">Нет данных</div>'}
        </div>
      </div>
    </div>
    <div class="card">
      <h3>Блок поставок</h3>
      <table class="table">
        <thead><tr><th>Заказ</th><th>Тендер</th><th>Клиент</th><th>Документы</th><th>Статус</th><th>Действие</th></tr></thead>
        <tbody>
          ${shipments.map((s) => `<tr>
            <td><a data-entity-type="order" data-entity-id="${s.order_id}">${esc(s.order_number || "—")}</a></td>
            <td><a data-entity-type="tender" data-entity-id="${s.tender_id}">${esc(s.tender_number || "—")}</a></td>
            <td><a data-entity-type="client" data-entity-id="${s.client}">${esc(s.client || "—")}</a></td>
            <td>
              ${s.act_file_url ? `<a href="${esc(s.act_file_url)}" target="_blank">Акт</a>` : "—"}
              ${s.upd_file_url ? ` | <a href="${esc(s.upd_file_url)}" target="_blank">УПД</a>` : ""}
              ${s.invoice_file_url ? ` | <a href="${esc(s.invoice_file_url)}" target="_blank">Счет</a>` : ""}
            </td>
            <td>${statusBadge(s.status || "warehouse")}</td>
            <td>
              <div class="row-actions">
                ${!s.docs_generated_at ? `<button data-gen-docs="${s.id}" type="button">Сгенерировать формы</button>` : ""}
                ${s.docs_generated_at && !s.transfer_ready ? `<button data-handover="${s.id}" class="btn-primary" type="button">Передать на отгрузку</button>` : ""}
                ${s.status === "awaiting_payment" ? `<button data-close-payment="${s.id}" class="btn-primary" type="button">Счет оплатили</button>` : ""}
              </div>
            </td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  root.querySelectorAll("[data-pay-invoice]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/api/invoices/${btn.dataset.payInvoice}/status`, "PUT", { status: "paid" });
        toast("Счет отмечен как оплаченный");
        renderAccounting();
      } catch (e) { toast(e.message, "error"); }
    });
  });

  root.querySelectorAll("[data-tender-info]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = orders.find((x) => String(x.id) === String(btn.dataset.tenderInfo));
      if (!row) return;
      openModal("Информация по тендеру", `
        <div class="list">
          <div class="list-item"><strong>Номер тендера:</strong> ${esc(row.tender_number || "—")}</div>
          <div class="list-item"><strong>Клиент:</strong> ${esc(row.client || "—")}</div>
          <div class="list-item"><strong>Лот:</strong> ${esc(row.lot || "—")}</div>
          <div class="list-item"><strong>Статус площадки:</strong> ${statusBadge(row.tender_status || "draft")}</div>
          <div class="list-item"><strong>Внутренний статус:</strong> ${internalStatusBadge(row.tender_internal_status || "")}</div>
        </div>
      `);
    });
  });

  root.querySelectorAll("[data-contract-items]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = orders.find((x) => String(x.id) === String(btn.dataset.contractItems));
      if (!row) return;
      try {
        const resp = await api(`/api/tenders/${row.tender_id}/items`);
        const items = resp.items || [];
        openModal("Позиции по договору", `
          <table class="table">
            <thead><tr><th>Артикул</th><th>Наименование</th><th>Кол-во</th><th>Ед.</th><th>Ориент. цена</th></tr></thead>
            <tbody>
              ${items.map((it) => `<tr><td>${esc(it.article || "—")}</td><td>${esc(it.name || "—")}</td><td>${it.quantity}</td><td>${esc(it.unit || "шт")}</td><td>${formatMoney(it.price_est || 0)}</td></tr>`).join("") || '<tr><td colspan="5">Нет позиций</td></tr>'}
            </tbody>
          </table>
        `);
      } catch (e) {
        toast(e.message, "error");
      }
    });
  });

  root.querySelectorAll("[data-gen-docs]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/api/shipments/${btn.dataset.genDocs}/generate-docs`, "POST", {});
        toast("Печатные формы сгенерированы");
        renderAccounting();
      } catch (e) { toast(e.message, "error"); }
    });
  });

  root.querySelectorAll("[data-handover]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/api/shipments/${btn.dataset.handover}/handover`, "PUT", {});
        toast("Поставка передана на отгрузку");
        renderAccounting();
      } catch (e) { toast(e.message, "error"); }
    });
  });

  root.querySelectorAll("[data-close-payment]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/api/shipments/${btn.dataset.closePayment}/payment`, "PUT", {});
        toast("Оплата подтверждена, поставка закрыта");
        renderAccounting();
      } catch (e) { toast(e.message, "error"); }
    });
  });
}

// ═══════════════════════════════════════════════

async function renderMail(user) {
  const root = document.getElementById("pageRoot");
  if (!root) return;

  const payload = await api("/api/mail/me");
  const mailbox = payload.mailbox || {};
  const items = payload.items || [];

  const safeItems = items.map((item) => ({
    ...item,
    preview: String(item.text_body || item.html_body || "").replace(/\s+/g, " ").trim(),
  }));

  const sentCount = safeItems.filter((item) => item.status === "sent").length;
  const failedCount = safeItems.filter((item) => item.status === "failed").length;
  const queuedCount = safeItems.filter((item) => item.status === "queued").length;

  root.innerHTML = `
    <div class="mail-shell">
      <aside class="mail-sidebar-panel card">
        <button id="mailComposeOpen" class="mail-compose-btn" type="button">+ Написать</button>
        <div class="mailbox-chip">
          <div class="mailbox-chip-title">Текущий ящик</div>
          <div class="mailbox-chip-address">${esc(mailbox.email || "—")}</div>
          <div class="mailbox-chip-state">${Number(mailbox.is_active) === 1 ? "Активен" : "Отключен"}</div>
        </div>
        <nav class="mail-folders">
          <button class="mail-folder active" type="button" data-folder="sent">
            <span>Отправленные</span><span class="mail-folder-count">${sentCount}</span>
          </button>
          <button class="mail-folder" type="button" data-folder="queued">
            <span>Очередь</span><span class="mail-folder-count">${queuedCount}</span>
          </button>
          <button class="mail-folder" type="button" data-folder="failed">
            <span>Ошибки</span><span class="mail-folder-count">${failedCount}</span>
          </button>
          <button class="mail-folder" type="button" data-folder="all">
            <span>Все</span><span class="mail-folder-count">${safeItems.length}</span>
          </button>
        </nav>
      </aside>

      <section class="mail-list-panel card">
        <header class="mail-list-head">
          <h3>Почта сотрудника: ${esc(user.name || "—")}</h3>
          <input id="mailSearch" type="search" placeholder="Поиск по теме или получателю">
        </header>
        <div id="mailList" class="mail-list"></div>
      </section>

      <section class="mail-preview-panel card">
        <div id="mailPreview" class="mail-preview-empty">Выберите письмо слева, чтобы посмотреть детали</div>
      </section>
    </div>

    <div id="mailComposerBackdrop" class="mail-composer-backdrop" aria-hidden="true">
      <div class="mail-composer-card">
        <div class="mail-composer-head">
          <h3>Новое письмо</h3>
          <button id="mailComposeClose" type="button" class="mail-close-btn">✕</button>
        </div>
        <form id="mailComposeForm" class="mail-compose-form">
          <label>От кого</label>
          <input type="text" value="${esc(user.name || "Сотрудник")} <${esc(mailbox.email || "no-reply")}>" readonly>
          <label>Кому</label>
          <input id="mailTo" type="email" placeholder="user@example.com" required>
          <label>Тема</label>
          <input id="mailSubject" type="text" placeholder="Тема письма" required>
          <label>Текст</label>
          <textarea id="mailText" rows="8" placeholder="Напишите сообщение..." required></textarea>
          <div class="mail-compose-actions">
            <button id="mailSendBtn" type="submit" class="btn-primary">Отправить</button>
          </div>
        </form>
      </div>
    </div>
  `;

  let activeFolder = "sent";
  let activeSearch = "";
  let selectedId = safeItems[0]?.id || null;

  function getStatusLabel(status) {
    if (status === "sent") return "Отправлено";
    if (status === "failed") return "Ошибка";
    if (status === "queued") return "В очереди";
    return status || "—";
  }

  function normalizeFolderItems() {
    let list = [...safeItems];
    if (activeFolder !== "all") {
      list = list.filter((item) => item.status === activeFolder);
    }
    if (activeSearch) {
      const needle = activeSearch.toLowerCase();
      list = list.filter((item) =>
        String(item.to_email || "").toLowerCase().includes(needle)
        || String(item.subject || "").toLowerCase().includes(needle)
        || String(item.preview || "").toLowerCase().includes(needle)
      );
    }
    return list;
  }

  function renderList() {
    const listWrap = document.getElementById("mailList");
    if (!listWrap) return;
    const current = normalizeFolderItems();

    if (!current.length) {
      listWrap.innerHTML = '<div class="mail-empty">Нет писем для выбранного фильтра</div>';
      renderPreview(null);
      return;
    }

    if (!current.some((item) => String(item.id) === String(selectedId))) {
      selectedId = current[0].id;
    }

    listWrap.innerHTML = current.map((item) => `
      <button class="mail-item ${String(item.id) === String(selectedId) ? "active" : ""}" type="button" data-mail-id="${item.id}">
        <div class="mail-item-top">
          <strong>${esc(item.to_email || "—")}</strong>
          <span>${formatDateTime(item.created_at)}</span>
        </div>
        <div class="mail-item-subject">${esc(item.subject || "Без темы")}</div>
        <div class="mail-item-preview">${esc(item.preview || "(пустое сообщение)")}</div>
        <div class="mail-item-foot">
          <span class="mail-status mail-status-${esc(item.status || "queued")}">${esc(getStatusLabel(item.status))}</span>
        </div>
      </button>
    `).join("");

    listWrap.querySelectorAll("[data-mail-id]").forEach((node) => {
      node.addEventListener("click", () => {
        selectedId = node.dataset.mailId;
        renderList();
      });
    });

    renderPreview(current.find((item) => String(item.id) === String(selectedId)) || current[0]);
  }

  function renderPreview(item) {
    const preview = document.getElementById("mailPreview");
    if (!preview) return;
    if (!item) {
      preview.className = "mail-preview-empty";
      preview.textContent = "Выберите письмо слева, чтобы посмотреть детали";
      return;
    }

    preview.className = "mail-preview";
    preview.innerHTML = `
      <header class="mail-preview-head">
        <h4>${esc(item.subject || "Без темы")}</h4>
        <span class="mail-status mail-status-${esc(item.status || "queued")}">${esc(getStatusLabel(item.status))}</span>
      </header>
      <div class="mail-preview-meta">
        <div><strong>От:</strong> ${esc(item.from_email || mailbox.email || "—")}</div>
        <div><strong>Кому:</strong> ${esc(item.to_email || "—")}</div>
        <div><strong>Дата:</strong> ${formatDateTime(item.created_at)}</div>
        <div><strong>Отправлено:</strong> ${item.sent_at ? formatDateTime(item.sent_at) : "—"}</div>
      </div>
      ${item.error_text ? `<div class="mail-preview-error">Ошибка доставки: ${esc(item.error_text)}</div>` : ""}
      <article class="mail-preview-body">${esc(item.text_body || item.preview || "")}</article>
    `;
  }

  document.querySelectorAll(".mail-folder").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFolder = btn.dataset.folder || "all";
      document.querySelectorAll(".mail-folder").forEach((it) => it.classList.remove("active"));
      btn.classList.add("active");
      renderList();
    });
  });

  document.getElementById("mailSearch")?.addEventListener("input", (event) => {
    activeSearch = String(event.target?.value || "").trim();
    renderList();
  });

  const composer = document.getElementById("mailComposerBackdrop");
  const openComposer = () => {
    composer?.classList.add("open");
    composer?.setAttribute("aria-hidden", "false");
    document.getElementById("mailTo")?.focus();
  };
  const closeComposer = () => {
    composer?.classList.remove("open");
    composer?.setAttribute("aria-hidden", "true");
  };

  document.getElementById("mailComposeOpen")?.addEventListener("click", openComposer);
  document.getElementById("mailComposeClose")?.addEventListener("click", closeComposer);
  composer?.addEventListener("click", (event) => {
    if (event.target === composer) closeComposer();
  });

  document.getElementById("mailComposeForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const sendBtn = document.getElementById("mailSendBtn");
    const to = String(document.getElementById("mailTo")?.value || "").trim();
    const subject = String(document.getElementById("mailSubject")?.value || "").trim();
    const text = String(document.getElementById("mailText")?.value || "").trim();

    if (!to || !subject || !text) {
      toast("Заполните получателя, тему и текст", "error");
      return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = "Отправляем...";
    try {
      await api("/api/mail/send", "POST", { to, subject, text });
      toast("Письмо отправлено", "info");
      closeComposer();
      await renderMail(user);
    } catch (error) {
      toast(error.message || "Ошибка отправки", "error");
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = "Отправить";
    }
  });

  renderList();
}

// ═══════════════════════════════════════════════

async function renderAdmin() {
  console.log("renderAdmin called, page:", page);
  const root = document.getElementById("pageRoot");
  if (!root) { console.error("pageRoot not found!"); return; }
  root.innerHTML = '<div style="padding: 20px; color: #3b82f6;">⏳ Загрузка панели...</div>';

  async function loadAndRender() {
    const usersResponse = await api("/api/users?limit=100");
    const users = usersResponse.items || [];
    const dashData = await api("/api/dashboard");
    const mailboxResponse = await api("/api/admin/mailboxes").catch(() => ({ items: [] }));
    const mailboxes = mailboxResponse.items || [];
    return { users, dashData, mailboxes };
  }

  function buildHTML(users, dashData, mailboxes) {
    const totalUsers = users.length;
    const admins = users.filter(u => u.role === "admin").length;
    const directors = users.filter(u => u.role === "director").length;

    const roleOptions = Object.entries(ROLE_LABELS).map(([val, label]) =>
      `<option value="${val}">${label}</option>`
    ).join("");

    const usersRows = users.map(u => {
      const roleLabel = ROLE_LABELS[u.role] || u.role;
      const badgeColor = { admin: "#ef4444", director: "#8b5cf6", manager: "#3b82f6", accountant: "#f59e0b", picker: "#10b981", logistic: "#06b6d4" }[u.role] || "#6b7280";
      return `<tr data-uid="${u.id}">
        <td style="padding:10px 12px; color:#a0aec0; font-size:13px;">${u.id}</td>
        <td style="padding:10px 12px; font-weight:500;">${u.name}</td>
        <td style="padding:10px 12px; color:#a0aec0; font-size:13px;">${u.email}</td>
        <td style="padding:10px 12px;">
          <span style="background:${badgeColor}22; color:${badgeColor}; padding:3px 10px; border-radius:20px; font-size:12px; font-weight:500;">${roleLabel}</span>
        </td>
        <td style="padding:10px 12px; color:#a0aec0; font-size:13px;">${u.company || "—"}</td>
        <td style="padding:10px 12px;">
          <button class="admin-btn-edit" data-id="${u.id}" style="background:#3b82f620; color:#3b82f6; border:1px solid #3b82f6; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:12px; margin-right:4px;">✏️ Изменить</button>
          <button class="admin-btn-invite" data-id="${u.id}" style="background:#10b98120; color:#10b981; border:1px solid #10b981; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:12px; margin-right:4px;">🔗 Пароль</button>
          <button class="admin-btn-delete" data-id="${u.id}" style="background:#ef444420; color:#ef4444; border:1px solid #ef4444; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:12px;">🗑</button>
        </td>
      </tr>`;
    }).join("");

    const mailRows = mailboxes.length ? mailboxes.map((box) => {
      const activeBadge = Number(box.is_active) === 1
        ? '<span style="background:#10b98122;color:#10b981;padding:2px 8px;border-radius:12px;font-size:12px;">Активен</span>'
        : '<span style="background:#ef444422;color:#ef4444;padding:2px 8px;border-radius:12px;font-size:12px;">Отключен</span>';
      return `<tr>
        <td style="padding:10px 12px;">${box.id}</td>
        <td style="padding:10px 12px;">${esc(box.user_name || "—")}</td>
        <td style="padding:10px 12px; color:#a0aec0;">${esc(box.user_login || "—")}</td>
        <td style="padding:10px 12px;">${esc(box.email || "—")}</td>
        <td style="padding:10px 12px;">${activeBadge}</td>
        <td style="padding:10px 12px; display:flex; gap:6px; flex-wrap:wrap;">
          <button class="admin-mail-toggle" data-id="${box.id}" data-active="${box.is_active}" style="background:#3b82f620; color:#3b82f6; border:1px solid #3b82f6; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:12px;">${Number(box.is_active) === 1 ? "Отключить" : "Включить"}</button>
          <button class="admin-mail-regen" data-id="${box.id}" style="background:#f59e0b20; color:#f59e0b; border:1px solid #f59e0b; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:12px;">Новый адрес</button>
        </td>
      </tr>`;
    }).join("") : '<tr><td colspan="6" style="padding:12px; text-align:center; color:#a0aec0;">Почтовые ящики не найдены</td></tr>';

    return `
      <!-- Add/Edit User Modal -->
      <div id="adminModal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,.7); z-index:1000; align-items:center; justify-content:center;">
        <div style="background:#1a1f26; border:1px solid #2d3139; border-radius:12px; padding:32px; width:100%; max-width:480px; margin:16px;">
          <h3 id="modalTitle" style="color:#3b82f6; margin-bottom:24px; font-size:18px;">Новый пользователь</h3>
          <input type="hidden" id="modalUserId">
          <div style="margin-bottom:14px;">
            <label style="display:block; color:#a0aec0; font-size:13px; margin-bottom:5px;">Имя *</label>
            <input id="modalName" type="text" placeholder="Иванов Иван Иванович" style="width:100%; background:#242a33; border:1px solid #2d3139; color:#e3e8f0; padding:9px 12px; border-radius:6px; font-size:14px; outline:none;">
          </div>
          <div style="margin-bottom:14px;">
            <label style="display:block; color:#a0aec0; font-size:13px; margin-bottom:5px;">Email *</label>
            <input id="modalEmail" type="email" placeholder="user@technotrade.ru" style="width:100%; background:#242a33; border:1px solid #2d3139; color:#e3e8f0; padding:9px 12px; border-radius:6px; font-size:14px; outline:none;">
          </div>
          <div style="margin-bottom:14px;">
            <label style="display:block; color:#a0aec0; font-size:13px; margin-bottom:5px;">Роль *</label>
            <select id="modalRole" style="width:100%; background:#242a33; border:1px solid #2d3139; color:#e3e8f0; padding:9px 12px; border-radius:6px; font-size:14px; outline:none;">
              ${roleOptions}
            </select>
          </div>
          <div style="margin-bottom:24px;">
            <label style="display:block; color:#a0aec0; font-size:13px; margin-bottom:5px;">Компания</label>
            <input id="modalCompany" type="text" placeholder="ТехноТрейд" style="width:100%; background:#242a33; border:1px solid #2d3139; color:#e3e8f0; padding:9px 12px; border-radius:6px; font-size:14px; outline:none;" value="ТехноТрейд">
          </div>
          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button id="modalCancelBtn" style="background:transparent; border:1px solid #2d3139; color:#a0aec0; padding:9px 20px; border-radius:6px; cursor:pointer;">Отмена</button>
            <button id="modalSaveBtn" style="background:#3b82f6; border:none; color:white; padding:9px 24px; border-radius:6px; cursor:pointer; font-weight:500;">Сохранить</button>
          </div>
        </div>
      </div>

      <!-- Invite Link Modal -->
      <div id="inviteModal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,.7); z-index:1000; align-items:center; justify-content:center;">
        <div style="background:#1a1f26; border:1px solid #2d3139; border-radius:12px; padding:32px; width:100%; max-width:520px; margin:16px;">
          <h3 style="color:#10b981; margin-bottom:8px; font-size:18px;">🔗 Ссылка для установки пароля</h3>
          <p id="inviteUserInfo" style="color:#a0aec0; font-size:13px; margin-bottom:20px;"></p>
          <div style="background:#0f1419; border:1px solid #2d3139; border-radius:6px; padding:12px; margin-bottom:16px; word-break:break-all;">
            <a id="inviteLink" href="#" target="_blank" style="color:#3b82f6; font-size:13px; text-decoration:none;"></a>
          </div>
          <p style="color:#f59e0b; font-size:12px; margin-bottom:20px;">⚠️ Ссылка одноразовая. Скопируйте и передайте пользователю.</p>
          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button id="copyLinkBtn" style="background:#10b98120; border:1px solid #10b981; color:#10b981; padding:9px 20px; border-radius:6px; cursor:pointer;">📋 Копировать</button>
            <button id="inviteCloseBtn" style="background:transparent; border:1px solid #2d3139; color:#a0aec0; padding:9px 20px; border-radius:6px; cursor:pointer;">Закрыть</button>
          </div>
        </div>
      </div>

      <div class="admin-section" style="padding:20px;">
        <h2 style="margin-top:0; color:#3b82f6;">Обзор системы</h2>
        <div class="admin-grid">
          <div class="stat-card"><div>Всего пользователей</div><strong>${totalUsers}</strong></div>
          <div class="stat-card"><div>Администраторов</div><strong>${admins}</strong></div>
          <div class="stat-card"><div>Директоров</div><strong>${directors}</strong></div>
          <div class="stat-card"><div>Активных тендеров</div><strong>${dashData.kpi?.activeTenders || 0}</strong></div>
        </div>
      </div>

      <div class="admin-section" style="padding:20px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
          <h2 style="color:#3b82f6; margin:0;">Управление пользователями</h2>
          <button id="addUserBtn" style="background:#3b82f6; border:none; padding:9px 18px; color:white; border-radius:6px; cursor:pointer; font-size:13px; font-weight:500;">+ Добавить пользователя</button>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; min-width:600px;">
            <thead>
              <tr style="background:#242a33;">
                <th style="text-align:left; padding:10px 12px; border-bottom:2px solid #3b82f6; font-size:12px; color:#3b82f6;">ID</th>
                <th style="text-align:left; padding:10px 12px; border-bottom:2px solid #3b82f6; font-size:12px; color:#3b82f6;">Имя</th>
                <th style="text-align:left; padding:10px 12px; border-bottom:2px solid #3b82f6; font-size:12px; color:#3b82f6;">Email</th>
                <th style="text-align:left; padding:10px 12px; border-bottom:2px solid #3b82f6; font-size:12px; color:#3b82f6;">Роль</th>
                <th style="text-align:left; padding:10px 12px; border-bottom:2px solid #3b82f6; font-size:12px; color:#3b82f6;">Компания</th>
                <th style="text-align:left; padding:10px 12px; border-bottom:2px solid #3b82f6; font-size:12px; color:#3b82f6;">Действия</th>
              </tr>
            </thead>
            <tbody id="usersTableBody">
              ${usersRows}
            </tbody>
          </table>
        </div>
      </div>

      <div class="admin-section" style="padding:20px;">
        <h2 style="color:#3b82f6; margin:0 0 16px 0;">Почтовые ящики пользователей</h2>
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; min-width:760px;">
            <thead>
              <tr style="background:#242a33;">
                <th style="text-align:left; padding:10px 12px; border-bottom:2px solid #3b82f6; font-size:12px; color:#3b82f6;">ID</th>
                <th style="text-align:left; padding:10px 12px; border-bottom:2px solid #3b82f6; font-size:12px; color:#3b82f6;">Пользователь</th>
                <th style="text-align:left; padding:10px 12px; border-bottom:2px solid #3b82f6; font-size:12px; color:#3b82f6;">Логин ERP</th>
                <th style="text-align:left; padding:10px 12px; border-bottom:2px solid #3b82f6; font-size:12px; color:#3b82f6;">Почтовый адрес</th>
                <th style="text-align:left; padding:10px 12px; border-bottom:2px solid #3b82f6; font-size:12px; color:#3b82f6;">Статус</th>
                <th style="text-align:left; padding:10px 12px; border-bottom:2px solid #3b82f6; font-size:12px; color:#3b82f6;">Действия</th>
              </tr>
            </thead>
            <tbody>
              ${mailRows}
            </tbody>
          </table>
        </div>
      </div>

      <div class="admin-section" style="padding:20px;">
        <h2 style="color:#3b82f6;">Статистика системы</h2>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px,1fr)); gap:15px; margin-top:15px;">
          <div style="background:#1a1f26; padding:15px; border-radius:6px; border-left:4px solid #10b981;">
            <div style="color:#a0aec0; font-size:13px;">Активные заказы</div>
            <strong style="color:#10b981; font-size:22px;">${dashData.kpi?.activeOrders || 0}</strong>
          </div>
          <div style="background:#1a1f26; padding:15px; border-radius:6px; border-left:4px solid #f59e0b;">
            <div style="color:#a0aec0; font-size:13px;">Портфель заказов</div>
            <strong style="color:#f59e0b; font-size:22px;">${formatMoney(dashData.kpi?.revenue || 0)}</strong>
          </div>
          <div style="background:#1a1f26; padding:15px; border-radius:6px; border-left:4px solid #3b82f6;">
            <div style="color:#a0aec0; font-size:13px;">Активные поставки</div>
            <strong style="color:#3b82f6; font-size:22px;">${dashData.kpi?.activeShipments || 0}</strong>
          </div>
          <div style="background:#1a1f26; padding:15px; border-radius:6px; border-left:4px solid #ef4444;">
            <div style="color:#a0aec0; font-size:13px;">Критичные сроки</div>
            <strong style="color:#ef4444; font-size:22px;">${dashData.kpi?.dueSoonCount || 0}</strong>
          </div>
        </div>
      </div>

      <div class="admin-section" style="padding:20px; margin-bottom:20px;">
        <h2 style="color:#3b82f6;">Логирование и безопасность</h2>
        <div style="background:#1a1f26; padding:15px; border-radius:6px; color:#a0aec0; font-size:13px;">
          <strong style="color:#e3e8f0;">Последние действия в системе:</strong><br><br>
          • ${dashData.recentChanges?.length || 0} изменений сегодня<br>
          • Сервер запущен и здоров<br>
          • Все API endpoints отвечают корректно
        </div>
      </div>
    `;
  }

  function bindEvents(users) {
    const modal = document.getElementById("adminModal");
    const inviteModal = document.getElementById("inviteModal");

    // Open add modal
    document.getElementById("addUserBtn").addEventListener("click", () => {
      document.getElementById("modalTitle").textContent = "Новый пользователь";
      document.getElementById("modalUserId").value = "";
      document.getElementById("modalName").value = "";
      document.getElementById("modalEmail").value = "";
      document.getElementById("modalRole").value = "manager";
      document.getElementById("modalCompany").value = "ТехноТрейд";
      modal.style.display = "flex";
    });

    document.getElementById("modalCancelBtn").addEventListener("click", () => { modal.style.display = "none"; });
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });

    // Save user (create or update)
    document.getElementById("modalSaveBtn").addEventListener("click", async () => {
      const id = document.getElementById("modalUserId").value;
      const name = document.getElementById("modalName").value.trim();
      const email = document.getElementById("modalEmail").value.trim();
      const role = document.getElementById("modalRole").value;
      const company = document.getElementById("modalCompany").value.trim() || "ТехноТрейд";
      if (!name || !email || !role) { toast("Заполните все обязательные поля", "error"); return; }
      const btn = document.getElementById("modalSaveBtn");
      btn.disabled = true; btn.textContent = "Сохраняем...";
      try {
        if (id) {
          await api(`/api/admin/users/${id}`, "PUT", { name, email, role, company });
          toast("Пользователь обновлён");
        } else {
          await api("/api/admin/users", "POST", { name, email, role, company });
          toast("Пользователь создан. Сгенерируйте ссылку для установки пароля.");
        }
        modal.style.display = "none";
        await renderAdmin();
      } catch (e) {
        toast(e.message, "error");
      } finally {
        btn.disabled = false; btn.textContent = "Сохранить";
      }
    });

    // Edit buttons
    document.querySelectorAll(".admin-btn-edit").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const u = users.find(x => String(x.id) === id);
        if (!u) return;
        document.getElementById("modalTitle").textContent = "Редактировать пользователя";
        document.getElementById("modalUserId").value = u.id;
        document.getElementById("modalName").value = u.name;
        document.getElementById("modalEmail").value = u.email;
        document.getElementById("modalRole").value = u.role;
        document.getElementById("modalCompany").value = u.company || "ТехноТрейд";
        modal.style.display = "flex";
      });
    });

    // Invite (set-password) buttons
    document.querySelectorAll(".admin-btn-invite").forEach(btn => {
      btn.addEventListener("click", async () => {
        btn.disabled = true; btn.textContent = "⏳...";
        try {
          const data = await api(`/api/admin/users/${btn.dataset.id}/invite`, "POST", {});
          document.getElementById("inviteUserInfo").textContent = `${data.user.name} (${data.user.email})`;
          const linkEl = document.getElementById("inviteLink");
          linkEl.textContent = data.link;
          linkEl.href = data.link;
          inviteModal.style.display = "flex";
        } catch (e) {
          toast(e.message, "error");
        } finally {
          btn.disabled = false; btn.textContent = "🔗 Пароль";
        }
      });
    });

    document.getElementById("inviteCloseBtn").addEventListener("click", () => { inviteModal.style.display = "none"; });
    inviteModal.addEventListener("click", (e) => { if (e.target === inviteModal) inviteModal.style.display = "none"; });
    document.getElementById("copyLinkBtn").addEventListener("click", () => {
      const link = document.getElementById("inviteLink").textContent;
      navigator.clipboard.writeText(link).then(() => toast("Ссылка скопирована!")).catch(() => toast("Не удалось скопировать", "error"));
    });

    // Delete buttons
    document.querySelectorAll(".admin-btn-delete").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const u = users.find(x => String(x.id) === id);
        if (!confirm(`Удалить пользователя "${u?.name}"? Это действие нельзя отменить.`)) return;
        btn.disabled = true;
        try {
          await api(`/api/admin/users/${id}`, "DELETE");
          toast("Пользователь удалён");
          await renderAdmin();
        } catch (e) {
          toast(e.message, "error");
          btn.disabled = false;
        }
      });
    });

    document.querySelectorAll(".admin-mail-toggle").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const active = Number(btn.dataset.active) === 1;
        btn.disabled = true;
        try {
          await api(`/api/admin/mailboxes/${id}`, "PUT", { is_active: active ? 0 : 1 });
          toast(active ? "Ящик отключен" : "Ящик включен");
          await renderAdmin();
        } catch (error) {
          toast(error.message || "Ошибка обновления", "error");
          btn.disabled = false;
        }
      });
    });

    document.querySelectorAll(".admin-mail-regen").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Сгенерировать новый адрес ящика для этого пользователя?")) return;
        btn.disabled = true;
        try {
          await api(`/api/admin/mailboxes/${btn.dataset.id}/regenerate`, "POST", {});
          toast("Новый адрес ящика сгенерирован");
          await renderAdmin();
        } catch (error) {
          toast(error.message || "Ошибка генерации", "error");
          btn.disabled = false;
        }
      });
    });
  }

  try {
    const { users, dashData, mailboxes } = await loadAndRender();
    root.innerHTML = buildHTML(users, dashData, mailboxes);
    bindEvents(users);
  } catch (error) {
    console.error("renderAdmin error:", error);
    root.innerHTML = `<div style="padding:20px; color:#ef4444;">Ошибка загрузки: ${error.message}</div>`;
  }
}

// ═══════════════════════════════════════════════
// ДЕТАЛЬНАЯ ИНФОРМАЦИЯ ПО СУЩНОСТЯМ
// ═══════════════════════════════════════════════

async function getEntityDetails(entityType, entityId) {
  // Специальная обработка для клиентов
  if (entityType === "client") {
    try {
      // Сначала пытаемся получить как ID
      const isNumeric = /^\d+$/.test(String(entityId).trim());
      
      if (isNumeric) {
        // Если это число, ищем по ID
        const client = await api(`/api/clients/${entityId}`);
        return client;
      } else {
        // Если это строка, ищем по названию
        const client = await api(`/api/clients/search?name=${encodeURIComponent(entityId)}`);
        return client;
      }
    } catch (e) {
      console.error("Клиент не найден:", e);
      throw new Error("Клиент не найден");
    }
  }

  const apiMap = {
    tender: `/api/tenders/${entityId}`,
    order: `/api/orders/${entityId}`,
    shipment: `/api/shipments/${entityId}`,
    contract: `/api/contracts/${entityId}`,
  };

  if (!apiMap[entityType]) throw new Error(`Неизвестный тип: ${entityType}`);

  const data = await api(apiMap[entityType]);
  return data;
}

function renderEntityDetails(entity, entityType) {
  const sections = [];

  if (entityType === "tender") {
    sections.push({
      title: "Основная информация",
      fields: [
        { label: "№ тендера", value: entity.number },
        { label: "Лот", value: entity.lot },
        { label: "Заказчик", value: entity.client },
        { label: "Статус", value: statusBadge(entity.status) },
        { label: "Внутренний статус", value: internalStatusBadge(entity.internal_status) },
        { label: "Начальная цена", value: formatMoney(entity.price) },
        { label: "Дедлайн подачи", value: formatDate(entity.deadline) },
        { label: "Метод закупки", value: entity.procurement_method },
        { label: "Площадка", value: entity.platform_name },
      ],
    });

    if (entity.customer_inn || entity.customer_kpp) {
      sections.push({
        title: "Реквизиты заказчика",
        fields: [
          { label: "ИНН", value: entity.customer_inn },
          { label: "КПП", value: entity.customer_kpp },
          { label: "Адрес", value: entity.customer_address },
          { label: "Контактное лицо", value: entity.contact_name },
          { label: "Email", value: entity.contact_email },
          { label: "Телефон", value: entity.contact_phone },
        ],
      });
    }

    if (entity.registry_number || entity.source_url) {
      sections.push({
        title: "Источник закупки",
        fields: [
          { label: "Номер в реестре", value: entity.registry_number },
          { label: "Ссылка", value: entity.source_url ? `<a href="${entity.source_url}" target="_blank">Открыть</a>` : "-" },
        ],
      });
    }
  }

  if (entityType === "order") {
    sections.push({
      title: "Информация о заказе",
      fields: [
        { label: "№ заказа", value: entity.order_number },
        { label: "№ тендера", value: entity.tender_number },
        { label: "Клиент", value: entity.client },
        { label: "Лот", value: entity.lot },
        { label: "Сумма", value: formatMoney(entity.amount) },
        { label: "Статус", value: statusBadge(entity.status) },
        { label: "Дата доставки", value: formatDate(entity.supply_date) },
        { label: "Создан", value: formatDate(entity.created_at) },
      ],
    });

    if (entity.invoice_number) {
      sections.push({
        title: "Счёт-фактура",
        fields: [
          { label: "№ счёта", value: entity.invoice_number },
          { label: "Сумма", value: formatMoney(entity.invoice_amount) },
          { label: "Статус", value: statusBadge(entity.invoice_status) },
          { label: "Дата выписки", value: formatDate(entity.invoice_issue_date) },
          { label: "Дата оплаты", value: entity.invoice_paid_at ? formatDate(entity.invoice_paid_at) : "не оплачен" },
        ],
      });
    }
  }

  if (entityType === "shipment") {
    sections.push({
      title: "Информация о поставке",
      fields: [
        { label: "№ поставки", value: entity.id },
        { label: "№ заказа", value: entity.order_number },
        { label: "№ тендера", value: entity.tender_number },
        { label: "Клиент", value: entity.client },
        { label: "Лот", value: entity.lot },
        { label: "Сумма", value: formatMoney(entity.amount) },
        { label: "Статус", value: statusBadge(entity.status) },
        { label: "Дата отгрузки", value: formatDate(entity.supply_date) },
      ],
    });
  }

  if (entityType === "client") {
    sections.push({
      title: "Информация о компании",
      fields: [
        { label: "Название", value: entity.company },
        { label: "Контактное лицо", value: entity.person },
        { label: "Email", value: entity.email },
        { label: "Телефон", value: entity.phone },
        { label: "Сегмент", value: entity.segment },
      ],
    });
  }

  if (entityType === "contract") {
    sections.push({
      title: "Информация о контракте",
      fields: [
        { label: "№ контракта", value: entity.number },
        { label: "№ тендера", value: entity.tender_number },
        { label: "Клиент", value: entity.client },
        { label: "Сумма", value: formatMoney(entity.amount) },
        { label: "Статус", value: statusBadge(entity.status) },
        { label: "Дата подписания", value: formatDate(entity.signed_date) },
        { label: "Дедлайн", value: formatDate(entity.deadline) },
      ],
    });
  }

  // Универсальное отображение секций
  let html = '<div class="details-panel">';
  
  sections.forEach(section => {
    html += `<div class="details-section"><h3>${section.title}</h3><table class="details-table">`;
    section.fields.forEach(field => {
      if (field.value && field.value !== "-") {
        html += `<tr><td class="label">${field.label}:</td><td class="value">${field.value}</td></tr>`;
      }
    });
    html += '</table></div>';
  });

  html += '</div>';
  return html;
}

async function openDetailsModal(entityType, entityId) {
  try {
    let modal = document.getElementById("detailsModal");
    
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "detailsModal";
      modal.className = "modal";
      modal.innerHTML = '<div class="modal-overlay"></div><div class="modal-content"></div>';
      document.body.appendChild(modal);
    }

    const content = modal.querySelector(".modal-content");
    content.innerHTML = '<div style="padding: 20px; text-align: center; color: #3b82f6;">⏳ Загрузка...</div>';
    modal.classList.add("open");

    const entity = await getEntityDetails(entityType, entityId);
    if (!entity) {
      content.innerHTML = '<div style="padding: 20px; color: #ef4444;">Сущность не найдена</div>';
      return;
    }

    const typeLabels = {
      tender: "Тендер",
      order: "Заказ",
      shipment: "Поставка",
      client: "Клиент",
      contract: "Контракт",
    };

    const html = renderEntityDetails(entity, entityType);
    
    content.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 15px;">
        <h2 style="margin: 0;">${typeLabels[entityType] || entityType}</h2>
        <button type="button" style="background: none; border: none; font-size: 24px; cursor: pointer; color: inherit;" onclick="document.getElementById('detailsModal').classList.remove('open')">✕</button>
      </div>
      ${html}
    `;

    modal.querySelector(".modal-overlay").onclick = () => modal.classList.remove("open");
  } catch (error) {
    toast(`Ошибка загрузки информации: ${error.message}`, "error");
    console.error(error);
  }
}

// Обработчик делегирования для кликов на кликабельные элементы
document.addEventListener("click", (e) => {
  const target = e.target.closest("[data-entity-type][data-entity-id]");
  if (target) {
    e.preventDefault();
    const entityType = target.dataset.entityType;
    const entityId = target.dataset.entityId;
    openDetailsModal(entityType, entityId);
  }
});

function renderInstructions() {
  const root = document.getElementById("pageRoot");
  if (!root) return;

  root.innerHTML = `
    <section class="instructions-shell">
      <article class="card instructions-hero">
        <div>
          <div class="instructions-eyebrow">Внутренний стандарт работы</div>
          <h2>Единый регламент по ролям: от входящего тендера до закрытия поставки</h2>
          <p>
            Эта страница нужна как рабочая памятка на каждый день: что делать, в какой последовательности,
            на каких этапах фиксировать действия в ERP и где чаще всего возникают ошибки.
          </p>
        </div>
        <div class="instructions-hero-box">
          <h3>Базовый цикл</h3>
          <ol>
            <li>Тендер принят в работу и заполнен без пропусков.</li>
            <li>Смета и подбор согласованы, заявка подана в срок.</li>
            <li>После победы оформлен заказ, затем поставка и документы.</li>
            <li>Оплата отражена, статус закрыт, лог завершен.</li>
          </ol>
        </div>
      </article>

      <article class="card instructions-common">
        <h3>Общие правила для всех сотрудников</h3>
        <div class="instructions-grid-3">
          <div class="rule-block">
            <h4>1. Качество данных</h4>
            <p>Не оставляйте обязательные поля пустыми: номер, клиент, суммы, сроки, ответственный.</p>
            <p>Перед сохранением перепроверьте ИНН/КПП, сумму и дедлайн подачи.</p>
          </div>
          <div class="rule-block">
            <h4>2. Прозрачность статусов</h4>
            <p>Любое изменение этапа фиксируется сразу в системе, без отложенных правок.</p>
            <p>Статус в ERP должен совпадать с реальным состоянием сделки на сегодня.</p>
          </div>
          <div class="rule-block">
            <h4>3. Ответственность по задачам</h4>
            <p>В задачах указывайте понятный заголовок, дедлайн и краткий ожидаемый результат.</p>
            <p>Если задача заблокирована, пишите причину в описании и уведомляйте инициатора.</p>
          </div>
        </div>
      </article>

      <article class="card role-section role-director">
        <div class="role-head">
          <h3>Генеральный директор</h3>
          <span class="status review">Стратегический контроль</span>
        </div>
        <div class="instructions-grid-2">
          <div class="role-block">
            <h4>Что контролировать ежедневно</h4>
            <ul>
              <li>Воронку активных тендеров и динамику по просроченным срокам.</li>
              <li>Сделки с высокой суммой и повышенным риском срыва исполнения.</li>
              <li>Нагрузку ключевых сотрудников и узкие места по задачам.</li>
            </ul>
          </div>
          <div class="role-block">
            <h4>Когда вмешиваться лично</h4>
            <ul>
              <li>Если дедлайн критически близко, а тендер не готов к подаче.</li>
              <li>Если нет согласованного плана по поставке/оплате крупного заказа.</li>
              <li>Если задача заблокирована более 1 рабочего дня без решения.</li>
            </ul>
          </div>
        </div>
      </article>

      <article class="card role-section role-manager">
        <div class="role-head">
          <h3>Менеджер тендерного направления</h3>
          <span class="status open">Операционный владелец процесса</span>
        </div>
        <div class="instructions-grid-2">
          <div class="role-block">
            <h4>Пошаговый сценарий</h4>
            <ol>
              <li>Занести тендер: номер, клиент, НМЦК, дедлайн, источник, контактные данные.</li>
              <li>Проверить комплектность ТЗ и передать в подбор номенклатуры.</li>
              <li>Контролировать готовность заявки и перевести в этап подачи.</li>
              <li>После победы запустить оформление заказа и договорного контура.</li>
            </ol>
          </div>
          <div class="role-block">
            <h4>Чек-лист качества перед подачей</h4>
            <ul>
              <li>Суммы в карточке тендера соответствуют актуальному расчету.</li>
              <li>Сроки и контактные лица проверены по официальному источнику.</li>
              <li>Нет задач без исполнителя на ближайшие 48 часов.</li>
              <li>Все документы прикреплены и читаемы.</li>
            </ul>
          </div>
        </div>
      </article>

      <article class="card role-section role-picker">
        <div class="role-head">
          <h3>Подборщик</h3>
          <span class="status shipped">Подбор и спецификация</span>
        </div>
        <div class="instructions-grid-2">
          <div class="role-block">
            <h4>Что требуется по каждой позиции</h4>
            <ul>
              <li>Корректное наименование, единица измерения, количество, ориентир цены.</li>
              <li>Проверка соответствия ТЗ и доступности поставки в нужные сроки.</li>
              <li>Фиксация комментариев по аналогам и техническим ограничениям.</li>
            </ul>
          </div>
          <div class="role-block">
            <h4>Критические ошибки</h4>
            <ul>
              <li>Подбор без сверки требований к характеристикам и допускам.</li>
              <li>Отсутствие отметки о рисках поставки и сроках логистики.</li>
              <li>Передача неполной спецификации в следующий этап.</li>
            </ul>
          </div>
        </div>
      </article>

      <article class="card role-section role-logistic">
        <div class="role-head">
          <h3>Логист</h3>
          <span class="status warehouse">Отгрузка и доставка</span>
        </div>
        <div class="instructions-grid-2">
          <div class="role-block">
            <h4>Перед отправкой</h4>
            <ul>
              <li>Проверить состав отгрузки и соответствие заказу.</li>
              <li>Подтвердить окно доставки, адрес и контакт получателя.</li>
              <li>Подготовить закрывающие документы для передачи бухгалтерии.</li>
            </ul>
          </div>
          <div class="role-block">
            <h4>После доставки</h4>
            <ul>
              <li>Обновить статус поставки в день фактического получения.</li>
              <li>Зафиксировать отклонения: недопоставка, перенос, рекламации.</li>
              <li>Передать подтверждения по документам в карточку поставки.</li>
            </ul>
          </div>
        </div>
      </article>

      <article class="card role-section role-accountant">
        <div class="role-head">
          <h3>Бухгалтер</h3>
          <span class="status paid">Оплаты и документы</span>
        </div>
        <div class="instructions-grid-2">
          <div class="role-block">
            <h4>Финансовый цикл</h4>
            <ol>
              <li>Проверить комплект документов по поставке.</li>
              <li>Сформировать/провести счет и отметить этап оплаты.</li>
              <li>После поступления средств закрыть обязательства в ERP.</li>
            </ol>
          </div>
          <div class="role-block">
            <h4>Контрольная точка недели</h4>
            <ul>
              <li>Сверка списка неоплаченных отгрузок и просроченной дебиторки.</li>
              <li>Проверка статусов счетов: выставлен, оплачен, закрыт.</li>
              <li>Эскалация менеджеру и руководству по рисковым оплатам.</li>
            </ul>
          </div>
        </div>
      </article>

      <article class="card role-section role-admin">
        <div class="role-head">
          <h3>Администратор системы</h3>
          <span class="status closed">Контур безопасности и доступов</span>
        </div>
        <div class="instructions-grid-2">
          <div class="role-block">
            <h4>Обязанности</h4>
            <ul>
              <li>Управление ролями пользователей и корректностью прав доступа.</li>
              <li>Контроль жизненного цикла учетных записей и паролей.</li>
              <li>Мониторинг журналов действий и аномалий в работе системы.</li>
            </ul>
          </div>
          <div class="role-block">
            <h4>Регламент изменений</h4>
            <ul>
              <li>Новые права выдаются только по согласованию с руководителем.</li>
              <li>Критичные изменения фиксируются с указанием причины и времени.</li>
              <li>Деактивированные пользователи не должны иметь активных сессий.</li>
            </ul>
          </div>
        </div>
      </article>

      <article class="card instructions-footer">
        <h3>Кому писать при проблеме</h3>
        <div class="instructions-grid-3">
          <div class="rule-block">
            <h4>Ошибка доступа или роль</h4>
            <p>Администратор системы.</p>
          </div>
          <div class="rule-block">
            <h4>Блокер по тендеру или срокам</h4>
            <p>Менеджер направления, при риске срыва сразу эскалация директору.</p>
          </div>
          <div class="rule-block">
            <h4>Проблемы по оплатам и документам</h4>
            <p>Бухгалтер и ответственный менеджер по сделке.</p>
          </div>
        </div>
      </article>
    </section>
  `;
}


async function initPage() {
  const user = await loadMe();
  bindCommon(user);

  if (page === "dashboard")    await renderDashboard();
  if (page === "tenders")      await renderTenders(user);
  if (page === "orders")       await renderOrders(user);
  if (page === "deliveries")   await renderDeliveries(user);
  if (page === "clients")      await renderClients(user);
  if (page === "reports")      await renderReports();
  if (page === "profile")      await renderProfile(user);
  if (page === "contracts")    await renderContracts(user);
  if (page === "tasks")        await renderTasks(user);
  if (page === "applications") await renderApplications(user);
  if (page === "accounting")   await renderAccounting();
  if (page === "admin")        await renderAdmin();
  if (page === "mail")         await renderMail(user);
  if (page === "instructions") renderInstructions();
}

initPage().catch(console.error);
