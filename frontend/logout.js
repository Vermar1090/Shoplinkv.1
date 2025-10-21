// logout.js
function logout() {
  localStorage.removeItem("userId");
  localStorage.removeItem("username");
  localStorage.removeItem("tiendaId");
  alert("Has cerrado sesión correctamente");
  window.location.href = "login.html";
}
