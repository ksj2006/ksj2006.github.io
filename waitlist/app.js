"use strict";

const API_URL = "https://script.google.com/macros/s/AKfycbzPySNE6y5F-BC8VfJ0K_jq1Zr9KrPd74QGlvqA9EWUQLPsQjIIP6zuJRi611w9YzKN/exec";
const RESTAURANT = "柳橙餐廳";
const DEMO_STAFF_KEY = "staff";
const DEMO_QUEUE_KEY = "restaurant_waitlist_demo";
const POLL_INTERVAL_MS = 5000;

const isDemoMode = !API_URL.trim();
const page = document.body.dataset.page;
let customerTicket = null;
let customerPoll = null;
let staffPoll = null;
let staffKey = "";
let refreshInProgress = false;

document.querySelectorAll("[data-restaurant]").forEach((element) => {
  element.textContent = RESTAURANT;
});
document.querySelectorAll("#mode-label").forEach((element) => {
  element.textContent = isDemoMode ? "示範模式 · 資料只存在此瀏覽器" : "正式模式";
});

function setFeedback(element, message, success) {
  if (!element) return;
  element.textContent = message || "";
  element.classList.toggle("success", Boolean(success));
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function getDemoState() {
  try {
    const stored = JSON.parse(localStorage.getItem(DEMO_QUEUE_KEY) || "null");
    if (stored && Array.isArray(stored.queue)) {
      return {
        queue: stored.queue,
        nextId: Number.isInteger(stored.nextId) ? stored.nextId : 1,
        stats: stored.stats || { seated: 0, cancelled: 0, joined: 0, totalWaitMs: 0 },
      };
    }
  } catch (error) {
    console.error("無法讀取示範候位資料：", error);
  }
  return { queue: [], nextId: 1, stats: { seated: 0, cancelled: 0, joined: 0, totalWaitMs: 0 } };
}

function saveDemoState(state) {
  localStorage.setItem(DEMO_QUEUE_KEY, JSON.stringify(state));
}

function demoPosition(id) {
  const state = getDemoState();
  const index = state.queue.findIndex((item) => Number(item.id) === Number(id));
  if (index < 0) return { found: false, waiting: state.queue.length };
  return {
    found: true,
    item: state.queue[index],
    waiting: state.queue.length,
    ahead: index,
  };
}

function demoDispatch(action, data) {
  const state = getDemoState();
  const id = Number(data.id);
  const itemIndex = state.queue.findIndex((item) => Number(item.id) === id);
  const item = itemIndex >= 0 ? state.queue[itemIndex] : null;

  if (["queue", "log", "reset"].includes(action) && data.key !== DEMO_STAFF_KEY) {
    return { ok: false, error: "員工密碼錯誤。" };
  }
  if (action === "count") return { ok: true, waiting: state.queue.length };
  if (action === "status") {
    const result = demoPosition(data.id);
    return result.found
      ? { ok: true, found: true, item: result.item, waiting: result.waiting, ahead: result.ahead }
      : { ok: true, found: false, waiting: result.waiting };
  }
  if (action === "join") {
    const newItem = {
      id: state.nextId++,
      name: data.name,
      gender: data.gender,
      email: data.email,
      party_size: Number(data.party_size),
      status: "waiting",
      created_at: new Date().toISOString(),
      notified_at: "",
    };
    state.queue.push(newItem);
    state.stats.joined += 1;
    saveDemoState(state);
    const result = demoPosition(newItem.id);
    return { ok: true, item: newItem, waiting: result.waiting, ahead: result.ahead };
  }
  if (action === "queue") {
    return {
      ok: true,
      queue: state.queue,
      stats: {
        joined: state.stats.joined,
        seated: state.stats.seated,
        cancelled: state.stats.cancelled,
        average_wait_minutes: state.stats.seated + state.stats.cancelled
          ? Math.round(state.stats.totalWaitMs / (state.stats.seated + state.stats.cancelled) / 60000 * 10) / 10
          : 0,
      },
    };
  }
  if (action === "notify") {
    if (!item) return { ok: false, error: "找不到這筆候位資料。" };
    item.status = "notified";
    item.notified_at = new Date().toISOString();
    saveDemoState(state);
    return { ok: true, message: "示範模式不會實際寄出 E-mail，狀態已更新為已通知。" };
  }
  if (action === "seat" || action === "cancel" || action === "leave") {
    if (!item) return { ok: false, error: "找不到這筆候位資料，可能已被移除。" };
    state.queue.splice(itemIndex, 1);
    state.stats.totalWaitMs += Math.max(0, Date.now() - Date.parse(item.created_at));
    if (action === "seat") state.stats.seated += 1;
    else state.stats.cancelled += 1;
    saveDemoState(state);
    return { ok: true, message: action === "seat" ? "已完成入座。" : "已取消候位。" };
  }
  if (action === "log") return { ok: true, events: [] };
  if (action === "reset") {
    localStorage.removeItem(DEMO_QUEUE_KEY);
    return { ok: true, message: "示範資料已清除。" };
  }
  return { ok: false, error: "不支援的操作。" };
}

async function requestApi(action, data, method) {
  if (isDemoMode) return demoDispatch(action, data || {});

  const values = Object.assign({}, data || {}, { action });
  let url = API_URL.trim();
  let options;
  if (method === "POST") {
    options = { method: "POST", body: JSON.stringify(values) };
  } else {
    const query = new URLSearchParams(values);
    url += (url.includes("?") ? "&" : "?") + query.toString();
    options = { method: "GET" };
  }
  const response = await fetch(url, options);
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch (error) {
    throw new Error("後端回傳的內容不是有效 JSON，請確認 API_URL 與 Apps Script 部署設定。");
  }
  if (!response.ok || result.ok === false) {
    throw new Error(result.error || `後端請求失敗（HTTP ${response.status}）。`);
  }
  return result;
}

function setQueueCount(count) {
  const target = document.getElementById("queue-count");
  if (target) target.textContent = Number.isFinite(Number(count)) ? String(count) : "—";
}

async function refreshPublicCount() {
  const connection = document.getElementById("connection-state");
  try {
    const result = await requestApi("count", {}, "GET");
    setQueueCount(result.waiting);
    if (connection) {
      connection.textContent = isDemoMode ? "示範資料" : "已連線";
      connection.classList.add("is-online");
    }
  } catch (error) {
    if (connection) {
      connection.textContent = "連線失敗";
      connection.classList.remove("is-online");
    }
    console.error("讀取候位組數失敗：", error);
  }
}

function showCustomerTicket(item, waiting, ahead) {
  customerTicket = item;
  document.getElementById("join-panel").classList.add("hidden");
  document.getElementById("ticket-panel").classList.remove("hidden");
  document.getElementById("ticket-number").textContent = `#${item.id}`;
  document.getElementById("ticket-total").textContent = `${waiting} 組`;
  document.getElementById("ticket-ahead").textContent = `${ahead} 組`;
  document.getElementById("ticket-party").textContent = `${item.party_size} 人`;
  updateTicketStatus(item.status);
  if (customerPoll) window.clearInterval(customerPoll);
  customerPoll = window.setInterval(updateCustomerTicket, POLL_INTERVAL_MS);
  updateCustomerTicket();
}

function updateTicketStatus(status) {
  const statusElement = document.getElementById("ticket-status");
  const hint = document.getElementById("ticket-hint");
  const values = {
    waiting: ["等候中", "目前仍在候位隊伍中，請留意您的電子郵件。", ""],
    notified: ["已通知", "已寄出候位通知，請儘速到櫃台報到。", "notified"],
    seated: ["已入座", "已完成入座。", "done"],
    cancelled: ["已取消", "此候位已取消。", "done"],
    removed: ["已離開隊伍", "此號碼已離開候位隊伍，請洽服務人員確認狀態。", "done"],
  };
  const display = values[status] || values.waiting;
  statusElement.textContent = display[0];
  statusElement.className = `status-pill ${display[2]}`;
  hint.textContent = display[1];
  document.getElementById("leave-button").classList.toggle("hidden", status !== "waiting" && status !== "notified");
}

async function updateCustomerTicket() {
  if (!customerTicket) return;
  try {
    const result = await requestApi("status", { id: customerTicket.id }, "GET");
    setQueueCount(result.waiting);
    document.getElementById("ticket-total").textContent = `${result.waiting} 組`;
    if (!result.found) {
      updateTicketStatus("removed");
      document.getElementById("ticket-ahead").textContent = "—";
      if (customerPoll) window.clearInterval(customerPoll);
      customerPoll = null;
      return;
    }
    customerTicket = result.item;
    document.getElementById("ticket-ahead").textContent = `${result.ahead} 組`;
    updateTicketStatus(result.item.status);
  } catch (error) {
    setFeedback(document.getElementById("ticket-feedback"), error.message, false);
  }
}

function initializeCustomerPage() {
  const form = document.getElementById("join-form");
  const submit = document.getElementById("join-submit");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    const customer = {
      name: String(values.get("name") || "").trim(),
      gender: String(values.get("gender") || "").trim(),
      email: String(values.get("email") || "").trim(),
      party_size: Number(values.get("party_size")),
    };
    if (!customer.name || !customer.gender || !customer.email || !Number.isInteger(customer.party_size)) {
      setFeedback(document.getElementById("join-feedback"), "請完整填寫候位資料。", false);
      return;
    }
    submit.disabled = true;
    setFeedback(document.getElementById("join-feedback"), "正在加入候位隊伍…", true);
    try {
      const result = await requestApi("join", customer, "POST");
      if (!result.item) throw new Error("後端沒有回傳候位資料，請稍後再試。");
      showCustomerTicket(result.item, result.waiting, result.ahead);
      setQueueCount(result.waiting);
    } catch (error) {
      setFeedback(document.getElementById("join-feedback"), error.message, false);
    } finally {
      submit.disabled = false;
    }
  });

  document.getElementById("leave-button").addEventListener("click", async () => {
    if (!customerTicket || !window.confirm("確定要取消這筆候位嗎？")) return;
    const button = document.getElementById("leave-button");
    button.disabled = true;
    try {
      await requestApi("leave", { id: customerTicket.id }, "POST");
      customerTicket = null;
      if (customerPoll) window.clearInterval(customerPoll);
      customerPoll = null;
      document.getElementById("ticket-panel").classList.add("hidden");
      document.getElementById("join-panel").classList.remove("hidden");
      document.getElementById("join-form").reset();
      setFeedback(document.getElementById("join-feedback"), "已取消候位。", true);
      await refreshPublicCount();
    } catch (error) {
      setFeedback(document.getElementById("ticket-feedback"), error.message, false);
    } finally {
      button.disabled = false;
    }
  });

  refreshPublicCount();
  window.setInterval(refreshPublicCount, POLL_INTERVAL_MS);
}

function renderQueue(result) {
  const body = document.getElementById("queue-body");
  const queue = Array.isArray(result.queue) ? result.queue : [];
  body.innerHTML = queue.map((item) => {
    const status = item.status === "notified" ? "已通知" : "等候中";
    const statusClass = item.status === "notified" ? "notified" : "";
    const created = item.created_at ? new Date(item.created_at).toLocaleString("zh-TW", { hour12: false }) : "—";
    return `<tr>
      <td class="id-cell">#${escapeHtml(item.id)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.gender)}</td>
      <td>${escapeHtml(item.party_size)} 人</td>
      <td>${escapeHtml(item.email)}</td>
      <td>${escapeHtml(created)}</td>
      <td><span class="table-status ${statusClass}">${status}</span></td>
      <td><div class="row-actions">
        <button class="button action-notify" data-action="notify" data-id="${escapeHtml(item.id)}" ${item.status === "notified" ? "disabled" : ""}>通知</button>
        <button class="button action-seat" data-action="seat" data-id="${escapeHtml(item.id)}">入座</button>
        <button class="button action-cancel" data-action="cancel" data-id="${escapeHtml(item.id)}">取消</button>
      </div></td>
    </tr>`;
  }).join("");
  document.getElementById("queue-empty").classList.toggle("hidden", queue.length > 0);
  document.getElementById("stat-waiting").textContent = String(queue.length);
  const stats = result.stats || {};
  document.getElementById("stat-seated").textContent = String(stats.seated || 0);
  document.getElementById("stat-cancelled").textContent = String(stats.cancelled || 0);
  document.getElementById("stat-average").textContent = `${Number(stats.average_wait_minutes || 0)} 分`;
  document.getElementById("queue-updated").textContent = `最後更新：${new Date().toLocaleTimeString("zh-TW", { hour12: false })}`;
}

async function refreshStaffQueue() {
  if (!staffKey || refreshInProgress) return;
  refreshInProgress = true;
  try {
    const result = await requestApi("queue", { key: staffKey }, "GET");
    renderQueue(result);
  } catch (error) {
    if (/密碼/.test(error.message)) {
      staffKey = "";
      sessionStorage.removeItem("waitlist_staff_key");
      document.getElementById("staff-dashboard").classList.add("hidden");
      document.getElementById("staff-login-panel").classList.remove("hidden");
      setFeedback(document.getElementById("login-feedback"), error.message, false);
      if (staffPoll) window.clearInterval(staffPoll);
      staffPoll = null;
    } else {
      setFeedback(document.getElementById("dashboard-feedback"), error.message, false);
    }
  } finally {
    refreshInProgress = false;
  }
}

function showStaffDashboard(key) {
  staffKey = key;
  sessionStorage.setItem("waitlist_staff_key", key);
  document.getElementById("staff-login-panel").classList.add("hidden");
  document.getElementById("staff-dashboard").classList.remove("hidden");
  refreshStaffQueue();
  if (staffPoll) window.clearInterval(staffPoll);
  staffPoll = window.setInterval(refreshStaffQueue, POLL_INTERVAL_MS);
}

function initializeStaffPage() {
  const form = document.getElementById("staff-login-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const key = document.getElementById("staff-key").value;
    const button = form.querySelector("button");
    button.disabled = true;
    setFeedback(document.getElementById("login-feedback"), "正在驗證…", true);
    try {
      await requestApi("queue", { key }, "GET");
      showStaffDashboard(key);
      setFeedback(document.getElementById("login-feedback"), "", true);
    } catch (error) {
      setFeedback(document.getElementById("login-feedback"), error.message, false);
    } finally {
      button.disabled = false;
    }
  });

  const rememberedKey = sessionStorage.getItem("waitlist_staff_key");
  if (rememberedKey) {
    staffKey = rememberedKey;
    refreshStaffQueue().then(() => {
      if (staffKey) {
        document.getElementById("staff-login-panel").classList.add("hidden");
        document.getElementById("staff-dashboard").classList.remove("hidden");
        staffPoll = window.setInterval(refreshStaffQueue, POLL_INTERVAL_MS);
      }
    });
  }

  document.getElementById("staff-logout").addEventListener("click", () => {
    staffKey = "";
    sessionStorage.removeItem("waitlist_staff_key");
    if (staffPoll) window.clearInterval(staffPoll);
    staffPoll = null;
    document.getElementById("staff-dashboard").classList.add("hidden");
    document.getElementById("staff-login-panel").classList.remove("hidden");
    document.getElementById("staff-key").value = "";
  });

  document.getElementById("refresh-queue").addEventListener("click", refreshStaffQueue);
  document.getElementById("queue-body").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || !staffKey) return;
    const action = button.dataset.action;
    const id = button.dataset.id;
    const confirmText = action === "seat" ? "確認此組顧客已入座？" : action === "cancel" ? "確定要取消此組候位？" : "";
    if (confirmText && !window.confirm(confirmText)) return;
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = "處理中";
    try {
      const result = await requestApi(action, { id, key: staffKey }, "POST");
      setFeedback(document.getElementById("dashboard-feedback"), result.message || "操作成功。", true);
      await refreshStaffQueue();
    } catch (error) {
      setFeedback(document.getElementById("dashboard-feedback"), error.message, false);
      button.disabled = false;
      button.textContent = oldText;
    }
  });
}

if (page === "customer") initializeCustomerPage();
if (page === "staff") initializeStaffPage();
