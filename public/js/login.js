async function 
api(url, method = "GET", body) {
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
  // Tabs functionality removed - only login form available
}

function initLogin() {
  const form = document.getElementById("loginForm");
  const emailInput = document.getElementById("loginEmail");
  const passwordInput = document.getElementById("loginPassword");
  
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    
    const email = String(emailInput.value || "").trim();
    const password = String(passwordInput.value || "").trim();
    
    // Frontend validation
    if (!email || !password) {
      showError("Пожалуйста, заполните все поля");
      return;
    }
    
    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showError("Пожалуйста, введите корректный email");
      return;
    }
    
    if (password.length < 1) {
      showError("Пожалуйста, введите пароль");
      return;
    }
    
    try {
      await api("/api/auth/login", "POST", {
        email: email,
        password: password,
      });
      window.location.href = "/dashboard";
    } catch (error) {
      showError(error.message);
    }
  });
}

function showError(message) {
  // Use textContent to prevent XSS (safer than innerHTML)
  const errorDiv = document.createElement("div");
  errorDiv.textContent = message;
  errorDiv.style.color = "red";
  errorDiv.style.marginBottom = "10px";
  errorDiv.style.fontSize = "14px";
  
  const form = document.getElementById("loginForm");
  const existingError = form.parentElement.querySelector("div[style*='color: red']");
  if (existingError) {
    existingError.remove();
  }
  form.parentElement.insertBefore(errorDiv, form);
}

checkSession();
initTabs();
initLogin();
