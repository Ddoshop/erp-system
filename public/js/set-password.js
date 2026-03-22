const params = new URLSearchParams(location.search);
const token = params.get("token");

function showInvalid() {
  document.getElementById("loadingArea").style.display = "none";
  document.getElementById("invalidArea").style.display = "block";
}

function showAlert(msg, type = "error") {
  const box = document.getElementById("alertBox");
  box.className = `alert alert-${type}`;
  box.textContent = msg;
  box.style.display = "block";
}

async function init() {
  if (!token) {
    showInvalid();
    return;
  }

  try {
    const res = await fetch(`/api/auth/check-invite?token=${encodeURIComponent(token)}`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      showInvalid();
      return;
    }

    document.getElementById("userName").textContent = data.name;
    document.getElementById("userEmail").textContent = data.email;
    document.getElementById("loadingArea").style.display = "none";
    document.getElementById("formArea").style.display = "block";
  } catch (e) {
    showInvalid();
  }
}

async function setPassword() {
  const pw = document.getElementById("password").value;
  const pw2 = document.getElementById("password2").value;
  const btn = document.getElementById("submitBtn");

  document.getElementById("alertBox").style.display = "none";

  if (pw.length < 6) {
    showAlert("Пароль должен содержать минимум 6 символов");
    return;
  }

  if (pw !== pw2) {
    showAlert("Пароли не совпадают");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Сохраняем...";

  try {
    const res = await fetch("/api/auth/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: pw })
    });

    const data = await res.json();

    if (!res.ok) {
      showAlert(data.message || "Ошибка");
      btn.disabled = false;
      btn.textContent = "Установить пароль";
      return;
    }

    document.getElementById("formArea").style.display = "none";
    document.getElementById("successScreen").style.display = "block";
  } catch (e) {
    showAlert("Ошибка соединения с сервером");
    btn.disabled = false;
    btn.textContent = "Установить пароль";
  }
}

document.getElementById("submitBtn").addEventListener("click", setPassword);
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    setPassword();
  }
});

init();
