"use strict";

(function () {
  const btnEdit = document.getElementById("tab-btn-edit");
  const btnSend = document.getElementById("tab-btn-send");
  const panelEdit = document.getElementById("tab-edit");
  const panelSend = document.getElementById("tab-send");

  function activate(which) {
    const onSend = which === "send";
    btnSend.classList.toggle("active", onSend);
    btnEdit.classList.toggle("active", !onSend);
    btnSend.setAttribute("aria-selected", String(onSend));
    btnEdit.setAttribute("aria-selected", String(!onSend));
    panelSend.hidden = !onSend;
    panelEdit.hidden = onSend;
  }

  btnEdit.addEventListener("click", () => activate("edit"));
  btnSend.addEventListener("click", () => activate("send"));

  // Exposed so edit.js can jump to the send tab after handing off files.
  window.activateSendTab = () => activate("send");
})();
