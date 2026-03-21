async function api(url, method = "GET", body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || "Ошибка запроса");
  }
  return data;
}

async function checkSession() {
  try {
    await api("/api/auth/me");
    window.location.href = "/dashboard";
  } catch (error) {
    // User is not logged in.
  }
}

function initTabs() {
  const loginTab = document.getElementById("loginTab");
  const registerTab = document.getElementById("registerTab");
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");

  loginTab.addEventListener("click", () => {
    loginTab.classList.add("active");
    registerTab.classList.remove("active");
    loginForm.style.display = "grid";
    registerForm.style.display = "none";
  });

  registerTab.addEventListener("click", () => {
    registerTab.classList.add("active");
    loginTab.classList.remove("active");
    loginForm.style.display = "none";
    registerForm.style.display = "grid";
  });
}

function initLogin() {
  const form = document.getElementById("loginForm");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/auth/login", "POST", {
        email: form.loginEmail.value,
        password: form.loginPassword.value,
      });
      window.location.href = "/dashboard";
    } catch (error) {
      alert(error.message);
    }
  });
}

function initRegister() {
  const form = document.getElementById("registerForm");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/auth/register", "POST", {
        name: form.regName.value,
        email: form.regEmail.value,
        company: form.regCompany.value,
        role: form.regRole.value,
        password: form.regPassword.value,
      });
      window.location.href = "/dashboard";
    } catch (error) {
      alert(error.message);
    }
  });
}

checkSession();
initTabs();
initLogin();
initRegister();
