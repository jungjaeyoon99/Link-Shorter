/**
JJY Links - Custom URL Shortener
Copyright (C) 2026 Jaeyun Jeong
This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License
as published by the Free Software Foundation, either version 3
of the License, or (at your option) any later version.
This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
See the GNU Affero General Public License for details.
License: https://www.gnu.org/licenses/agpl-3.0.html
*/
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  get,
  query,
  orderByChild,
  equalTo,
  push,
  set,
  update,
  remove,
  runTransaction,
  serverTimestamp,
  onValue,
  limitToLast,
  endAt
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js";

// Firebase Console > Project settings > Your apps에서 발급한 값으로 교체하세요.
const firebaseConfig = {
  apiKey: "AIzaSyD2_C-IztoFPOKiIKBoawrsj2Y4xVmXIAg",
  authDomain: "jjy-link-shorter.firebaseapp.com",
  databaseURL: "https://jjy-link-shorter-default-rtdb.firebaseio.com",
  projectId: "jjy-link-shorter",
  storageBucket: "jjy-link-shorter.firebasestorage.app",
  messagingSenderId: "712169188028",
  appId: "1:712169188028:web:d87a416fcbd7130b4c3eb9",
  measurementId: "G-BLPYKV4T43"
};

const $ = (selector) => document.querySelector(selector);
const views = {
  login: $("#login-view"),
  dashboard: $("#dashboard-view"),
  redirect: $("#redirect-view")
};
const statusNode = $("#status-message");
const loginForm = $("#login-form");
const loginButton = $("#login-button");
const createForm = $("#create-form");
const createButton = $("#create-button");
const linksList = $("#links-list");
const emptyState = $("#empty-state");
const redirectTitle = $("#redirect-title");
const redirectMessage = $("#redirect-message");
const redirectSpinner = $("#redirect-spinner");
const redirectHome = $("#redirect-home");
const surveyForm = $("#survey-form");
const surveySubmitButton = $("#survey-submit-button");
const surveyEnabledInput = $("#survey-enabled-input");
const surveyBuilder = $("#survey-builder");
const surveyQuestionList = $("#survey-question-list");
const createRateLimitGroup = document.querySelector(".rate-limit-group");
if (createRateLimitGroup) createRateLimitGroup.hidden = true;
const surveyQuestionsContainer = $("#survey-questions-container");

let auth = null;
let db = null;
let currentUser = null;
let currentIsAdmin = false;
let currentLinks = [];
let pendingSurvey = null;
let loginInProgress = false;
let authObservationId = 0;
let accessLogUnsubscribe = null;

function isConfigReady() {
  const required = ["apiKey", "authDomain", "databaseURL", "projectId", "appId"];
  return required.every((key) => {
    const value = firebaseConfig[key];
    return typeof value === "string" && value.length > 0 && !value.includes("YOUR_");
  });
}

function showStatus(message, type = "info") {
  statusNode.textContent = message;
  statusNode.className = "status-message";
  if (type === "error" || type === "success") statusNode.classList.add(type);
  statusNode.hidden = !message;
}

function switchView(viewName) {
  Object.entries(views).forEach(([name, node]) => {
    node.hidden = name !== viewName;
  });
  if (viewName !== "dashboard") $("#user-bar").hidden = true;
}

function consumeGitHubPagesRoute() {
  const url = new URL(window.location.href);
  const packedRoute = url.searchParams.get("__ghpages_route");

  if (packedRoute !== null) {
    const restored = new URL(packedRoute, window.location.origin);
    window.history.replaceState(null, "", `${restored.pathname}${restored.search}${restored.hash}`);
    return restored.pathname.split("/").filter(Boolean).join("/");
  }

  const pathParts = url.pathname.split("/").filter(Boolean);
  if (pathParts.length === 0 || (pathParts.length === 1 && pathParts[0] === "index.html")) {
    return null;
  }
  return pathParts.join("/");
}

function friendlyAuthError(error) {
  switch (error?.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "이메일 또는 비밀번호를 확인해 주세요.";
    case "auth/invalid-email":
      return "올바른 이메일 주소를 입력해 주세요.";
    case "auth/too-many-requests":
      return "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.";
    case "auth/network-request-failed":
      return "네트워크 연결을 확인한 뒤 다시 시도해 주세요.";
    case "auth/operation-not-allowed":
      return "Firebase Console에서 이메일/비밀번호 로그인을 활성화해 주세요.";
    case "auth/invalid-api-key":
      return "Firebase API 키가 올바르지 않습니다. app.js의 Firebase 설정을 확인해 주세요.";
    case "auth/unauthorized-domain":
      return "현재 사이트 도메인이 Firebase Authentication의 승인된 도메인에 없습니다.";
    case "auth/user-disabled":
      return "이 계정은 비활성화되어 있습니다. 관리자에게 문의해 주세요.";
    case "auth/admin-restricted-operation":
      return "이 프로젝트는 사용자의 계정 생성을 제한합니다. 관리자 계정으로 등록된 계정인지 확인해 주세요.";
    default:
      console.error("Unmapped Firebase Auth error:", error);
      return `로그인 중 문제가 발생했습니다 (${error?.code || "알 수 없는 오류"}). Firebase Authentication 설정과 승인된 도메인을 확인해 주세요.`;
  }
}

function validateSafeHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.href.length <= 2048
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

function makeShortUrl(path) {
  return `${window.location.origin}/${encodeURIComponent(path)}`;
}

function formatDate(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return "생성 시간 알 수 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit"
  }).format(new Date(Number(timestamp)));
}

async function startApplication(routePath) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);

  if (routePath !== null) {
    switchView("redirect");
    await resolveShortLink(routePath);
    return;
  }

  switchView("login");
  onAuthStateChanged(auth, async (user) => {
    const observationId = ++authObservationId;
    currentUser = user;
    currentIsAdmin = false;

    if (!user) {
      currentLinks = [];
      if(accessLogUnsubscribe){accessLogUnsubscribe();accessLogUnsubscribe=null;}
      $("#admin-access-logs").hidden=true;
      $("#user-bar").hidden = true;
      switchView("login");
      return;
    }

    try {
      const roleSnapshot = await get(ref(db, `roles/${user.uid}`));
      // Ignore a slow role request if another auth state has already superseded it.
      if (observationId !== authObservationId || auth.currentUser?.uid !== user.uid) return;

      currentIsAdmin = roleSnapshot.val() === "admin";
      const createRateGroup = document.querySelector(".rate-limit-group");
      if (createRateGroup) createRateGroup.hidden = !currentIsAdmin;
      $("#user-email").textContent = user.email || user.uid;
      $("#role-badge").hidden = !currentIsAdmin;
      $("#user-bar").hidden = false;
      $("#scope-chip").textContent = currentIsAdmin ? "전체 링크 · 관리자" : "내 링크";
      switchView("dashboard");
      showStatus("");
      await loadLinks();
    } catch (error) {
      // Do not leave the browser authenticated while forcing it back to the login screen.
      // That state made subsequent login attempts appear to do nothing when role reads were denied.
      console.error("Role lookup failed:", error);
      if (observationId !== authObservationId || auth.currentUser?.uid !== user.uid) return;
      let authResetSucceeded = true;
      try {
        await signOut(auth);
      } catch (signOutError) {
        authResetSucceeded = false;
        console.error("Could not reset auth after role lookup failure:", signOutError);
      }
      switchView("login");
      showStatus(
        authResetSucceeded
          ? `Firebase 로그인은 확인됐지만 권한 정보를 읽지 못했습니다. RTDB Rules에서 roles/${user.uid} 본인 읽기를 허용한 뒤 다시 로그인해 주세요.`
          : `권한 정보를 읽지 못했고 로그아웃 처리도 실패했습니다. RTDB Rules에서 roles/${user.uid} 본인 읽기를 허용한 뒤 페이지를 새로고침해 주세요.`,
        "error"
      );
    }
  });
}

function makeQuestionId() {
  return `q_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

function addQuestionEditor(question = {}, target = surveyQuestionList) {
  const row = document.createElement("div"); row.className = "survey-question-editor";
  row.dataset.questionId = question.id || makeQuestionId();
  const label = document.createElement("input"); label.type = "text"; label.className = "survey-question-label";
  label.placeholder = "질문 내용"; label.maxLength = 120; label.value = question.label || ""; label.required = true;
  const type = document.createElement("select"); type.className = "survey-question-type";
  [["int","숫자 입력"], ...(currentIsAdmin ? [["char","문자 입력"]] : []), ["singleChoice","객관식 · 하나 선택"], ["multipleChoice","객관식 · 여러 개 선택"]].forEach(([v,t]) => type.add(new Option(t,v)));
  type.value = ["int","singleChoice","multipleChoice"].includes(question.type) || (currentIsAdmin && question.type === "char") ? question.type : "int";
  const options = document.createElement("textarea"); options.className = "survey-question-options";
  options.placeholder = "선택지를 한 줄에 하나씩 입력 (객관식 전용)"; options.rows = 3;
  options.value = Array.isArray(question.options) ? question.options.join("\n") : "";
  options.hidden = !["singleChoice","multipleChoice"].includes(type.value);
  type.addEventListener("change", () => { options.hidden = !["singleChoice","multipleChoice"].includes(type.value); });
  const removeButton = document.createElement("button"); removeButton.type = "button";
  removeButton.className = "button button-quiet button-small"; removeButton.textContent = "삭제";
  removeButton.addEventListener("click", () => row.remove()); row.append(label,type,options,removeButton); target.append(row); return row;
}
function readQuestionEditors(target = surveyQuestionList) {
  return [...target.querySelectorAll(".survey-question-editor")].map(row => {
    const type = row.querySelector(".survey-question-type")?.value || "int";
    const q = { id: row.dataset.questionId || makeQuestionId(), label: String(row.querySelector(".survey-question-label")?.value || "").trim().slice(0,120), type };
    if (type === "singleChoice" || type === "multipleChoice") q.options = [...new Set(String(row.querySelector(".survey-question-options")?.value || "").split(/\r?\n/).map(v=>v.trim()).filter(Boolean))].slice(0,30);
    return q;
  }).filter(q=>q.label);
}
function renderSurveyQuestions(questions, target = surveyQuestionsContainer) {
  target.replaceChildren(); const list = Array.isArray(questions) ? questions : Object.values(questions || {});
  for (const q of list) {
    const field = document.createElement("fieldset"); field.className = "survey-question-field";
    const legend = document.createElement("legend"); legend.textContent = q.label || "질문"; field.append(legend);
    if (q.type === "singleChoice" || q.type === "multipleChoice") {
      (q.options || []).forEach((option,index)=>{ const label=document.createElement("label"); label.className="choice-option";
        const input=document.createElement("input"); input.type=q.type === "singleChoice" ? "radio" : "checkbox"; input.name=q.id; input.value=option;
        input.dataset.questionId=q.id; input.dataset.questionType=q.type; input.required=q.type === "singleChoice" && index===0;
        label.append(input,document.createTextNode(option)); field.append(label); });
    } else {
      const input=document.createElement("input"); input.id=`response-${q.id}`; input.name=q.id; input.dataset.questionId=q.id;
      input.dataset.questionType=q.type === "char" ? "char" : "int"; input.type=q.type === "char" ? "text" : "number";
      input.inputMode=q.type === "char" ? "text" : "numeric"; input.maxLength=q.type === "char" ? 200 : 40;
      if(input.type==="number") input.step="1"; input.placeholder=q.type === "char" ? "응답 입력" : "숫자만 입력"; input.required=true; field.append(input);
    }
    target.append(field);
  }
}

async function loadSurveyConfig(path) {
  const snap = await get(ref(db, `surveyConfigs/${path}`));
  return snap.exists() ? snap.val() : { enabled: false, questions: [] };
}


function setupAdminAccessLogs() {
  const panel = $("#admin-access-logs");
  if (!panel || !currentIsAdmin) return;
  panel.hidden = false;
  const search = $("#access-log-search"), ipFilter = $("#access-log-ip-filter");
  const linkFilter = $("#access-log-link-filter"), fromFilter = $("#access-log-from");
  const toFilter = $("#access-log-to"), body = $("#access-log-rows");
  const status = $("#access-log-status"), count = $("#access-log-count");
  const more = $("#access-log-more"), pageSize = 100;
  const rowsByKey = new Map(), cursors = new Map(), exhausted = new Set(), failed = new Set();
  let loading = false;
  if (accessLogUnsubscribe) { accessLogUnsubscribe(); accessLogUnsubscribe = null; }
  linkFilter.replaceChildren(new Option("전체 링크", ""));
  currentLinks.forEach(item => linkFilter.add(new Option(`/${item.customPath}`, item.customPath)));

  const filteredRows = () => {
    const term = String(search.value || "").trim().toLowerCase();
    const ipTerm = String(ipFilter.value || "").trim().toLowerCase();
    const selectedPath = linkFilter.value;
    const from = fromFilter.value ? new Date(`${fromFilter.value}T00:00:00`).getTime() : -Infinity;
    const to = toFilter.value ? new Date(`${toFilter.value}T23:59:59.999`).getTime() : Infinity;
    return [...rowsByKey.values()].filter(r => {
      const ts = Number(r.timestamp || 0);
      if (selectedPath && r.path !== selectedPath) return false;
      if (ipTerm && !String(r.ip || "").toLowerCase().includes(ipTerm)) return false;
      if (ts < from || ts > to) return false;
      return !term || `${r.path} ${r.originalUrl} ${r.ip} ${r.userAgent} ${r.id}`.toLowerCase().includes(term);
    }).sort((a,b) => Number(b.timestamp || 0) - Number(a.timestamp || 0) || String(b.id).localeCompare(String(a.id)));
  };
  const draw = () => {
    body.replaceChildren();
    const rows = filteredRows();
    rows.forEach(r => {
      const tr = document.createElement("tr");
      [r.path, r.originalUrl || "-", r.timestamp ? formatDate(Number(r.timestamp)) : "-",
       r.ip || "미기록", r.userAgent || "미기록", r.id].forEach(v => {
        const td = document.createElement("td"); td.textContent = String(v); tr.append(td);
      });
      body.append(tr);
    });
    count.textContent = `${rows.length.toLocaleString()}건 표시 / ${rowsByKey.size.toLocaleString()}건 로드`;
    status.textContent = failed.size
      ? `일부 링크 조회 실패: ${[...failed].join(", ")} · 나머지 링크 결과는 계속 표시됩니다.`
      : `로드된 로그 ${rowsByKey.size.toLocaleString()}건 · 링크별 ${pageSize}건 단위 · 최신순`;
    more.disabled = loading || (cursors.size > 0 && [...cursors.keys()].every(path => exhausted.has(path)));
  };
  const loadPage = async (path, older = false) => {
    const cursor = cursors.get(path);
    const logRef = ref(db, `privateAccessLogs/${path}`);
    const q = older && cursor
      ? query(logRef, orderByChild("timestamp"), endAt(cursor.timestamp, cursor.id), limitToLast(pageSize + 1))
      : query(logRef, orderByChild("timestamp"), limitToLast(pageSize));
    const snap = await get(q), page = [];
    snap.forEach(child => page.push({ path, id: child.key,
      originalUrl: currentLinks.find(x => x.customPath === path)?.originalUrl || "-", ...(child.val() || {}) }));
    page.sort((a,b) => Number(a.timestamp || 0) - Number(b.timestamp || 0) || String(a.id).localeCompare(String(b.id)));
    const unique = page.filter(r => !rowsByKey.has(`${path}::${r.id}`));
    unique.forEach(r => rowsByKey.set(`${path}::${r.id}`, r));
    if (page.length < (older ? pageSize + 1 : pageSize) || (older && unique.length === 0)) exhausted.add(path);
    if (unique.length) {
      const oldest = unique[0];
      cursors.set(path, { timestamp: Number(oldest.timestamp || 0), id: oldest.id });
    } else if (!cursors.has(path)) {
      cursors.set(path, { timestamp: 0, id: "" }); exhausted.add(path);
    }
  };
  const refresh = async () => {
    if (loading) return;
    loading = true; rowsByKey.clear(); cursors.clear(); exhausted.clear(); failed.clear(); draw();
    await Promise.all(currentLinks.map(async item => {
      try { await loadPage(item.customPath, false); }
      catch (error) { failed.add(item.customPath); console.error(`Access log query failed for ${item.customPath}:`, error); }
    }));
    loading = false; draw();
  };
  const loadMore = async () => {
    if (loading) return;
    loading = true; draw();
    await Promise.all(currentLinks.filter(item => cursors.has(item.customPath) && !exhausted.has(item.customPath)).map(async item => {
      try { await loadPage(item.customPath, true); failed.delete(item.customPath); }
      catch (error) { failed.add(item.customPath); console.error(`Older access log query failed for ${item.customPath}:`, error); }
    }));
    loading = false; draw();
  };
  [search, ipFilter, linkFilter, fromFilter, toFilter].forEach(el => { el.oninput = draw; el.onchange = draw; });
  more.onclick = loadMore;
  $("#access-log-refresh").onclick = refresh;
  accessLogUnsubscribe = () => {
    more.onclick = null; $("#access-log-refresh").onclick = null;
    [search, ipFilter, linkFilter, fromFilter, toFilter].forEach(el => { el.oninput = null; el.onchange = null; });
  };
  refresh();
}

async function loadLinks() {
  if (!currentUser || !db) return;
  linksList.replaceChildren();
  emptyState.hidden = true;
  $("#link-count").textContent = "…";

  try {
    const linksRef = ref(db, "links");
    const linksQuery = currentIsAdmin
      ? linksRef
      : query(linksRef, orderByChild("creatorUid"), equalTo(currentUser.uid));
    const snapshot = await get(linksQuery);
    currentLinks = [];

    const linkItems = [];
    snapshot.forEach((child) => {
      const value = child.val();
      if (value && typeof value.originalUrl === "string" && (currentIsAdmin || value.isDeleted !== true)) linkItems.push({ customPath: child.key, ...value });
    });
    currentLinks = await Promise.all(linkItems.map(async (item) => {
      try { const config = await loadSurveyConfig(item.customPath); return { ...item, surveyEnabled: config.enabled === true }; }
      catch { return { ...item, surveyEnabled: false }; }
    }));
    currentLinks.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    $("#link-count").textContent = String(currentLinks.length);
    renderLinks();
    if (currentIsAdmin) setupAdminAccessLogs();
  } catch (error) {
    $("#link-count").textContent = "—";
    emptyState.hidden = true;
    showStatus("링크 목록을 불러오지 못했습니다. RTDB Security Rules, creatorUid 인덱스, 로그인 상태를 확인해 주세요.", "error");
    console.error("Loading links failed:", error);
  }
}

function renderLinks() {
  linksList.replaceChildren();
  emptyState.hidden = currentLinks.length !== 0;

  for (const item of currentLinks) {
    const card = document.createElement("article");
    card.className = "link-card";

    const main = document.createElement("div");
    main.className = "link-main";

    const shortLink = document.createElement("a");
    shortLink.className = "link-short";
    shortLink.href = makeShortUrl(item.customPath);
    shortLink.target = "_blank";
    shortLink.rel = "noopener noreferrer";
    shortLink.textContent = shortLink.href;

    const original = document.createElement("div");
    original.className = "link-original";
    original.title = item.originalUrl;
    original.textContent = item.originalUrl;

    const meta = document.createElement("div");
    meta.className = "link-meta";
    const created = document.createElement("span");
    created.textContent = formatDate(item.createdAt);
    meta.append(created);
    const expiry = document.createElement("span");
    expiry.textContent = item.expiresAt ? `만료: ${formatDate(item.expiresAt)}${Number(item.expiresAt) <= Date.now() ? " (만료됨)" : ""}` : "만료 없음";
    meta.append(expiry);
    if (item.isDeleted === true) {
      const deleted = document.createElement("span");
      deleted.className = "deleted-label";
      deleted.textContent = `삭제됨${item.deletedAt ? ` · ${formatDate(item.deletedAt)}` : ""}`;
      meta.append(deleted);
    }
    if (item.surveyEnabled === true) {
      const surveyTag = document.createElement("span");
      surveyTag.textContent = "접속 설문 사용 중";
      meta.append(surveyTag);
    }
    if (currentIsAdmin) {
      const creator = document.createElement("span");
      creator.className = "creator-label";
      creator.textContent = `생성자 UID: ${item.creatorUid || "알 수 없음"}`;
      meta.append(creator);
    }
    main.append(shortLink, original, meta);

    const actions = document.createElement("div");
    actions.className = "link-actions";
    const copyButton = document.createElement("button");
    copyButton.className = "button button-quiet button-small";
    copyButton.type = "button";
    copyButton.textContent = "주소 복사";
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(makeShortUrl(item.customPath));
        showStatus("단축 주소를 클립보드에 복사했습니다.", "success");
      } catch {
        showStatus("클립보드 복사에 실패했습니다. 주소를 직접 복사해 주세요.", "error");
      }
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "button button-small delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "삭제";
    deleteButton.disabled = item.isDeleted === true;
    deleteButton.addEventListener("click", async () => {
      const approved = window.confirm(`/${item.customPath} 링크를 휴지통으로 이동할까요? 관리자는 나중에 복구할 수 있습니다.`);
      if (!approved) return;
      deleteButton.disabled = true;
      try {
        await update(ref(db, `links/${item.customPath}`), {
          isDeleted: true,
          deletedAt: Date.now(),
          deletedBy: currentUser.uid
        });
        showStatus(`/${item.customPath} 링크를 soft delete 처리했습니다.`, "success");
        await loadLinks();
      } catch (error) {
        showStatus("링크를 삭제 처리하지 못했습니다. 링크 소유권과 보안 규칙을 확인해 주세요.", "error");
        console.error("Soft deleting link failed:", error);
      } finally {
        deleteButton.disabled = false;
      }
    });

    if (currentIsAdmin && item.isDeleted === true) {
      const restoreButton = document.createElement("button");
      restoreButton.className = "button button-primary button-small";
      restoreButton.type = "button";
      restoreButton.textContent = "복구";
      restoreButton.addEventListener("click", async () => {
        if (!window.confirm(`/${item.customPath} 링크를 복구할까요?`)) return;
        restoreButton.disabled = true;
        try {
          await update(ref(db, `links/${item.customPath}`), {
            isDeleted: false,
            deletedAt: null,
            deletedBy: null
          });
          showStatus(`/${item.customPath} 링크를 복구했습니다.`, "success");
          await loadLinks();
        } catch (error) {
          showStatus("링크를 복구하지 못했습니다. 관리자 권한과 보안 규칙을 확인해 주세요.", "error");
          console.error("Restoring link failed:", error);
        } finally {
          restoreButton.disabled = false;
        }
      });
      actions.append(restoreButton);
    }

    const qrButton = document.createElement("button");
    qrButton.className = "button button-quiet button-small";
    qrButton.type = "button";
    qrButton.textContent = "QR 코드";
    qrButton.addEventListener("click", () => {
      const shortUrl = makeShortUrl(item.customPath);
      // QR 생성 서비스에 단축 URL을 전달합니다. 민감한 URL은 외부 QR 서비스로 보내지 마세요.
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(shortUrl)}`;
      window.open(qrUrl, "_blank", "noopener,noreferrer");
    });

    const expiryButton = document.createElement("button");
    expiryButton.className = "button button-quiet button-small";
    expiryButton.type = "button";
    expiryButton.textContent = "만료일 변경";
    expiryButton.addEventListener("click", async () => {
      const currentValue = item.expiresAt ? new Date(Number(item.expiresAt) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
      const input = window.prompt("만료 시각을 입력하세요 (YYYY-MM-DDTHH:mm). 비우면 만료 없음.", currentValue);
      if (input === null) return;
      let nextExpiry = null;
      if (input.trim()) {
        nextExpiry = new Date(input).getTime();
        if (!Number.isFinite(nextExpiry) || nextExpiry <= Date.now()) {
          showStatus("만료 시각은 현재보다 미래로 입력해 주세요.", "error");
          return;
        }
      }
      try {
        const patch = { expiresAt: nextExpiry };
        await update(ref(db, `links/${item.customPath}`), patch);
        showStatus("링크 만료일을 변경했습니다.", "success");
        await loadLinks();
      } catch (error) {
        showStatus("만료일을 변경하지 못했습니다. 링크 소유권과 보안 규칙을 확인해 주세요.", "error");
        console.error("Updating link expiry failed:", error);
      }
    });

    if (item.surveyEnabled === true || currentIsAdmin) {
      if (item.surveyEnabled === true) {
      const responsesButton = document.createElement("button");
      responsesButton.className = "button button-quiet button-small";
      responsesButton.type = "button";
      responsesButton.textContent = "설문 응답 보기";

      const loadResponsesIntoPanel = async (responsePanel) => {
        responsesButton.disabled = true;
        responsePanel.replaceChildren();
        responsePanel.classList.add("is-loading");
        const loading = document.createElement("p");
        loading.className = "survey-response-loading";
        loading.textContent = "응답을 불러오는 중…";
        responsePanel.append(loading);

        try {
          const [config, responseSnap, privateLogSnap] = await Promise.all([
            loadSurveyConfig(item.customPath),
            get(ref(db, `surveyResponses/${item.customPath}`)),
            currentIsAdmin
              ? get(ref(db, `privateAccessLogs/${item.customPath}`))
              : Promise.resolve(null)
          ]);

          // IP와 User-Agent는 관리자만 별도 비공개 로그 경로에서 읽습니다.
          const privateLogsById = new Map();
          if (currentIsAdmin && privateLogSnap) {
            privateLogSnap.forEach((snap) => {
              if (snap.exists()) privateLogsById.set(snap.key, snap.val());
            });
          }

          const responseRecords = [];
          responseSnap.forEach((snap) => {
            const value = snap.val();
            if (value && typeof value === "object") {
              responseRecords.push({ id: snap.key, ...value });
            }
          });
          responseRecords.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

          let questions = Object.values(config.questions || {}).filter((question) =>
            question && typeof question === "object" && (question.id || question.label)
          );

          // 예전 설정에 질문 목록이 없더라도 저장된 answers 키를 기반으로 응답을 표시합니다.
          if (questions.length === 0) {
            const discoveredIds = new Set();
            for (const response of responseRecords) {
              Object.keys(response.answers || {}).forEach((questionId) => discoveredIds.add(questionId));
            }
            questions = [...discoveredIds].map((id) => ({ id, label: id, type: "char" }));
          }

          responsePanel.replaceChildren();
          responsePanel.classList.remove("is-loading");

          const header = document.createElement("div");
          header.className = "survey-response-heading";
          const heading = document.createElement("h3");
          heading.textContent = `설문 응답 · ${responseRecords.length}건`;
          const count = document.createElement("span");
          count.className = "survey-response-count";
          count.textContent = `${responseRecords.length}개 응답`;
          header.append(heading, count);
          responsePanel.append(header);

          if (questions.length > 0) {
            const qText = document.createElement("p");
            qText.className = "survey-config-summary";
            qText.textContent = `질문 ${questions.length}개 · ${questions.map((q) => q.label || q.id).join(" · ")}`;
            responsePanel.append(qText);
            for (const question of questions.filter(q => q.type === "singleChoice" || q.type === "multipleChoice")) {
              const stat = document.createElement("div"); stat.className = "survey-stat-block";
              const title = document.createElement("strong"); title.textContent = `${question.label} · 선택 비율`; stat.append(title);
              const total = responseRecords.filter(r => r.answers && r.answers[question.id] !== undefined).length;
              for (const option of question.options || []) {
                const count = responseRecords.filter(r => { const a=r.answers?.[question.id]; return Array.isArray(a) ? a.includes(option) : a === option; }).length;
                const line=document.createElement("div"); line.className="survey-stat-line";
                const label=document.createElement("span"); label.textContent=`${option} · ${count}명 (${total ? (count/total*100).toFixed(1) : "0.0"}%)`;
                const bar=document.createElement("div"); bar.className="survey-stat-track"; const fill=document.createElement("span"); fill.style.width=`${total ? count/total*100 : 0}%`; bar.append(fill); line.append(label,bar); stat.append(line);
              }
              responsePanel.append(stat);
            }
          }

          if (responseRecords.length === 0) {
            const empty = document.createElement("div");
            empty.className = "survey-response-empty";
            const emptyTitle = document.createElement("strong");
            emptyTitle.textContent = "아직 제출된 응답이 없습니다.";
            const emptyDescription = document.createElement("p");
            emptyDescription.textContent = "누군가 설문에 답변하고 제출하면 이곳에 결과가 표시됩니다.";
            empty.append(emptyTitle, emptyDescription);
            responsePanel.append(empty);
            return;
          }

          const tableWrap = document.createElement("div");
          tableWrap.className = "survey-response-table-wrap";
          const table = document.createElement("table");
          table.className = "survey-response-table";
          const thead = document.createElement("thead");
          const headerRow = document.createElement("tr");
          const tableHeaders = ["제출 시각"];
          if (currentIsAdmin) tableHeaders.push("접속 IP");
          tableHeaders.push("연결 로그 ID", ...questions.map((q) => q.label || q.id || "질문"));
          for (const title of tableHeaders) {
            const th = document.createElement("th");
            th.scope = "col";
            th.textContent = title;
            headerRow.append(th);
          }
          thead.append(headerRow);
          table.append(thead);

          const tbody = document.createElement("tbody");
          for (const response of responseRecords) {
            const row = document.createElement("tr");
            const timeCell = document.createElement("td");
            timeCell.textContent = response.timestamp ? formatDate(response.timestamp) : "-";
            row.append(timeCell);

            const privateLog = response.accessLogId ? privateLogsById.get(response.accessLogId) : null;
            if (currentIsAdmin) {
              const ipCell = document.createElement("td");
              const responseIp = typeof privateLog?.ip === "string" ? privateLog.ip : "";
              ipCell.textContent = !responseIp
                ? "이전 응답 · IP 미기록"
                : responseIp === "unavailable" ? "IP 조회 실패" : responseIp;
              if (privateLog?.userAgent) ipCell.title = `브라우저 정보: ${String(privateLog.userAgent).slice(0, 512)}`;
              row.append(ipCell);
            }

            const logCell = document.createElement("td");
            logCell.className = "survey-response-log-id";
            logCell.textContent = response.accessLogId || "연결 기록 없음";
            if (response.accessLogId) logCell.title = `privateAccessLogs/${item.customPath}/${response.accessLogId}`;
            row.append(logCell);

            for (const question of questions) {
              const cell = document.createElement("td");
              const answer = response.answers?.[question.id];
              cell.textContent = answer === undefined || answer === null || answer === "" ? "-" : String(answer);
              row.append(cell);
            }
            tbody.append(row);
          }
          table.append(tbody);
          tableWrap.append(table);
          responsePanel.append(tableWrap);

          const tableHint = document.createElement("p");
          tableHint.className = "survey-response-hint";
          const hasUnlinkedResponses = responseRecords.some((response) => !response.accessLogId);
          tableHint.textContent = currentIsAdmin
            ? (hasUnlinkedResponses
              ? "IP 주소는 관리자 전용 비공개 로그에서 조회합니다. 연결 로그 ID가 없는 과거 응답은 IP를 정확하게 소급 연결할 수 없습니다."
              : "IP 주소는 관리자에게만 표시됩니다. 연결 로그 ID는 privateAccessLogs/경로/로그ID에서 확인할 수 있습니다.")
            : "개인정보 보호를 위해 IP 주소와 브라우저 정보는 표시하지 않습니다. 연결 로그 ID는 관리자에게 문의하거나 로그 추적에 사용할 수 있습니다.";
          tableHint.textContent += " 질문이 많으면 표를 좌우로 스크롤하세요.";
          responsePanel.append(tableHint);
        } catch (error) {
          responsePanel.replaceChildren();
          responsePanel.classList.remove("is-loading");
          const isPermissionError = /PERMISSION_DENIED|permission.denied|insufficient permissions/i.test(
            `${error?.code || ""} ${error?.message || ""}`
          );
          const errorTitle = document.createElement("h3");
          errorTitle.textContent = isPermissionError ? "설문 결과를 읽을 권한이 없습니다." : "설문 결과를 불러오지 못했습니다.";
          const errorMessage = document.createElement("p");
          errorMessage.className = "survey-response-error-message";
          const linkOwnerMatches = Boolean(currentUser?.uid && item.creatorUid === currentUser.uid);
          if (isPermissionError && (linkOwnerMatches || currentIsAdmin)) {
            errorMessage.textContent = `화면에서는 ${currentIsAdmin ? "관리자" : "링크 생성자"} 계정으로 확인되지만 데이터베이스 읽기가 거부되었습니다. app.js의 databaseURL이 규칙을 게시한 Realtime Database 주소와 같은지, 그 데이터베이스의 Rules가 실제로 게시되었는지 확인해 주세요. 읽기 규칙은 admin 또는 links/${item.customPath}/creatorUid와 로그인 UID가 같은 계정에 허용되어야 합니다.`;
          } else if (isPermissionError) {
            errorMessage.textContent = `현재 로그인 계정은 이 링크의 생성자(${item.creatorUid || "UID 없음"})와 다르고 관리자 권한도 없는 것으로 확인됩니다. 링크 생성자 계정으로 로그인하거나 roles/${currentUser?.uid || "사용자 UID"} 값을 admin으로 지정한 관리자 계정으로 확인해 주세요.`;
          } else {
            errorMessage.textContent = "네트워크 연결과 Firebase 프로젝트 설정을 확인해 주세요. 자세한 오류는 브라우저 개발자 도구의 Console에서 확인할 수 있습니다.";
          }
          const errorCode = document.createElement("code");
          errorCode.className = "survey-response-error-code";
          errorCode.textContent = `오류 정보: ${String(error?.code || error?.message || "unknown").slice(0, 180)}`;
          responsePanel.append(errorTitle, errorMessage, errorCode);
          console.error(`Loading survey responses failed for ${item.customPath}:`, error);
        } finally {
          responsesButton.disabled = false;
        }
      };

      responsesButton.addEventListener("click", async () => {
        const existingPanel = card.querySelector(".survey-response-panel");
        if (existingPanel) {
          existingPanel.remove();
          responsesButton.textContent = "설문 응답 보기";
          return;
        }
        const responsePanel = document.createElement("section");
        responsePanel.className = "survey-response-panel";
        responsePanel.setAttribute("aria-label", `/${item.customPath} 설문 응답 결과`);
        card.append(responsePanel);
        responsesButton.textContent = "응답 닫기";
        await loadResponsesIntoPanel(responsePanel);
      });
      actions.append(responsesButton);
      }
      if (currentIsAdmin) {
        const editSurveyButton = document.createElement("button");
        editSurveyButton.className = "button button-quiet button-small";
        editSurveyButton.type = "button";
        editSurveyButton.textContent = "설문 옵션 변경 (관리자)";
        editSurveyButton.addEventListener("click", async () => {
          try {
            const config = await loadSurveyConfig(item.customPath);
            const editor = document.createElement("div"); editor.className = "survey-edit-overlay";
            const panel = document.createElement("div"); panel.className = "survey-edit-panel";
            const heading = document.createElement("h3"); heading.textContent = `/${item.customPath} 설문 설정`;
            const enabledLabel = document.createElement("label"); enabledLabel.className = "checkbox-label";
            const enabled = document.createElement("input"); enabled.type = "checkbox"; enabled.checked = config.enabled === true;
            enabledLabel.append(enabled, document.createTextNode(" 접속 전 설문 활성화"));
            const qList = document.createElement("div"); qList.className = "survey-question-list";
            for (const q of Object.values(config.questions || {})) addQuestionEditor(q, qList);
            const add = document.createElement("button"); add.type = "button"; add.className = "button button-quiet button-small"; add.textContent = "질문 추가 +"; add.addEventListener("click", () => addQuestionEditor({}, qList));
            const save = document.createElement("button"); save.type = "button"; save.className = "button button-primary"; save.textContent = "설정 저장";
            const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "button button-quiet"; cancel.textContent = "취소"; cancel.addEventListener("click", () => editor.remove());
            save.addEventListener("click", async () => {
              const questions = readQuestionEditors(qList);
              if (enabled.checked && questions.length === 0) { showStatus("설문을 켜려면 질문을 하나 이상 추가하세요.", "error"); return; }
              save.disabled = true;
              try { await set(ref(db, `surveyConfigs/${item.customPath}`), { enabled: enabled.checked, questions: Object.fromEntries(questions.map((q) => [q.id, q])), updatedAt: Date.now() }); await loadLinks(); showStatus("설문 옵션을 저장했습니다.", "success"); editor.remove(); }
              catch (error) { showStatus("설문 옵션 저장에 실패했습니다. 관리자 권한과 Firebase Rules를 확인하세요.", "error"); console.error(error); }
              finally { save.disabled = false; }
            });
            panel.append(heading, enabledLabel, qList, add, save, cancel); editor.append(panel); document.body.append(editor);
          } catch (error) { showStatus("설문 설정을 불러오지 못했습니다.", "error"); console.error(error); }
        });
        actions.append(editSurveyButton);
      }
    }
    if (currentIsAdmin) {
      const rateButton = document.createElement("button");
      rateButton.className = "button button-quiet button-small";
      rateButton.type = "button";
      rateButton.textContent = "IP 제한 설정";
      rateButton.addEventListener("click", async () => {
        try {
          const snap = await get(ref(db, `rateLimitSettings/${item.customPath}`));
          const cfg = snap.exists() ? (snap.val() || {}) : {
            enabled: item.rateLimitEnabled === true,
            max: item.rateLimitMax || 5,
            message: item.rateLimitMessage || "접속 횟수 제한에 도달했습니다. 관리자에게 문의해 주세요."
          };
          const editor = document.createElement("section"); editor.className = "survey-edit-overlay";
          const panel = document.createElement("div"); panel.className = "survey-edit-panel";
          const heading = document.createElement("h3"); heading.textContent = `/${item.customPath} IP별 접근 제한`;
          const enabledLabel = document.createElement("label"); enabledLabel.className = "checkbox-label";
          const enabled = document.createElement("input"); enabled.type = "checkbox"; enabled.checked = cfg.enabled === true;
          enabledLabel.append(enabled, document.createTextNode(" IP별 접근 횟수 제한 활성화"));
          const maxLabel = document.createElement("label"); maxLabel.textContent = "허용 접근 횟수 (1~100)";
          const maxInput = document.createElement("input"); maxInput.type = "number"; maxInput.min = "1"; maxInput.max = "100"; maxInput.value = String(Math.min(100, Math.max(1, Number(cfg.max || 5))));
          const msgLabel = document.createElement("label"); msgLabel.textContent = "제한 초과 메시지";
          const msgInput = document.createElement("input"); msgInput.type = "text"; msgInput.maxLength = 240; msgInput.value = String(cfg.message || "").slice(0,240);
          const feedback = document.createElement("p"); feedback.className = "field-help"; feedback.setAttribute("aria-live","polite");
          const save = document.createElement("button"); save.className = "button button-primary"; save.type = "button"; save.textContent = "저장";
          const cancel = document.createElement("button"); cancel.className = "button button-quiet"; cancel.type = "button"; cancel.textContent = "취소"; cancel.onclick = () => editor.remove();
          save.onclick = async () => {
            const max = Number(maxInput.value);
            if (!Number.isInteger(max) || max < 1 || max > 100) { feedback.textContent = "허용 횟수는 1~100의 정수여야 합니다."; return; }
            save.disabled = true; feedback.textContent = "저장 중…";
            try {
              await set(ref(db, `rateLimitSettings/${item.customPath}`), {
                enabled: enabled.checked, max,
                message: String(msgInput.value || "접속 횟수 제한에 도달했습니다.").slice(0,240),
                updatedAt: Date.now(), updatedBy: currentUser.uid
              });
              feedback.textContent = "저장했습니다. 이후 접속부터 새 설정을 적용합니다.";
              showStatus(`/${item.customPath} IP 제한 설정을 저장했습니다.`, "success");
              editor.remove();
            } catch (error) {
              const denied = /PERMISSION_DENIED|permission_denied|permission denied/i.test(`${error?.code||""} ${error?.message||""}`);
              feedback.textContent = denied ? "Firebase Rules에서 권한이 거부되었습니다." : "네트워크 또는 Firebase 오류로 저장하지 못했습니다.";
              console.error("Saving rate limit settings failed:", error);
            } finally { save.disabled = false; }
          };
          panel.append(heading, enabledLabel, maxLabel, maxInput, msgLabel, msgInput, feedback, save, cancel);
          editor.append(panel); document.body.append(editor);
        } catch (error) {
          showStatus(/PERMISSION_DENIED|permission.denied/i.test(`${error?.code||""} ${error?.message||""}`) ? "IP 제한 설정 조회 권한이 없습니다." : "IP 제한 설정을 불러오지 못했습니다. 네트워크를 확인해 주세요.", "error");
          console.error(error);
        }
      });
      actions.append(rateButton);
    }
    actions.append(copyButton, qrButton, expiryButton, deleteButton);
    card.append(main, actions);
    linksList.append(card);
  }
}

async function createShortLink(event) {
  event.preventDefault();
  if (!currentUser || !db) return;

  const formData = new FormData(createForm);
  const customPath = String(formData.get("customPath") || "").trim().toLowerCase();
  const inputUrl = String(formData.get("originalUrl") || "").trim();
  const originalUrl = validateSafeHttpUrl(inputUrl);
  const expiryInput = String(formData.get("expiresAt") || "").trim();
  const expiresAt = expiryInput ? new Date(expiryInput).getTime() : null;
  const surveyEnabled = formData.get("surveyEnabled") === "on";
  const surveyQuestions = readQuestionEditors();

  if (surveyEnabled && surveyQuestions.length === 0) { showStatus("설문을 활성화하려면 질문을 하나 이상 입력하세요.", "error"); return; }
  if (surveyEnabled && surveyQuestions.some(q => (q.type === "singleChoice" || q.type === "multipleChoice") && q.options.length < 2)) { showStatus("객관식 질문에는 선택지를 2개 이상 입력해 주세요.", "error"); return; }
  if (!/^[a-z0-9_-]{3,40}$/.test(customPath)) {
    showStatus("경로는 영문 소문자, 숫자, 하이픈(-), 밑줄(_)로 된 3~40자여야 합니다.", "error");
    return;
  }
  if (!originalUrl) {
    showStatus("올바른 http:// 또는 https:// 원본 URL을 입력해 주세요.", "error");
    return;
  }
  if (expiryInput && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) {
    showStatus("만료 시각은 현재보다 미래로 설정해 주세요.", "error");
    return;
  }

  createButton.disabled = true;
  createButton.textContent = "생성 중…";
  try {
    // Public redirect lookup이 가능한 originalUrl 노드로 먼저 중복 여부를 빠르게 검사합니다.
    const existing = await get(ref(db, `links/${customPath}/originalUrl`));
    if (existing.exists()) {
      showStatus(`/${customPath} 경로는 이미 사용 중입니다. 다른 경로를 선택해 주세요.`, "error");
      return;
    }

    // Transaction으로 경로 선점 경쟁을 처리합니다. 이미 존재하면 덮어쓰지 않습니다.
    const result = await runTransaction(ref(db, `links/${customPath}`), (currentData) => {
      if (currentData !== null) return undefined;
      return {
        originalUrl,
        creatorUid: currentUser.uid,
        createdAt: Date.now(),
        isDeleted: false,
        ...(expiresAt ? { expiresAt } : {})
      };
    }, { applyLocally: false });

    if (!result.committed) {
      showStatus(`/${customPath} 경로는 이미 사용 중입니다. 다른 경로를 선택해 주세요.`, "error");
      return;
    }

    if (currentIsAdmin) {
      try {
        await set(ref(db, `rateLimitSettings/${customPath}`), {
          enabled: formData.get("rateLimitEnabled") === "on",
          max: Math.min(100, Math.max(1, Number(formData.get("rateLimitMax") || 5))),
          message: String(formData.get("rateLimitMessage") || "접속 횟수 제한에 도달했습니다. 관리자에게 문의해 주세요.").slice(0, 240),
          updatedAt: Date.now(), updatedBy: currentUser.uid
        });
      } catch (settingsError) {
        console.error("Saving initial rate limit settings failed:", settingsError);
        try { await remove(ref(db, `links/${customPath}`)); } catch (rollbackError) { console.error(rollbackError); }
        showStatus("관리자 접근 제한 설정 저장에 실패해 링크 생성을 취소했습니다. Rules를 확인해 주세요.", "error");
        await loadLinks(); return;
      }
    }

    if (surveyEnabled) {
      try {
        await set(ref(db, `surveyConfigs/${customPath}`), { enabled: true, questions: Object.fromEntries(surveyQuestions.map((q) => [q.id, q])), createdAt: Date.now() });
      } catch (surveyError) {
        console.error("Saving initial survey config failed:", surveyError);
        // Avoid leaving an unexpectedly usable link behind when its required survey was not saved.
        try {
          await remove(ref(db, `links/${customPath}`));
        } catch (rollbackError) {
          console.error("Could not roll back partially-created link:", rollbackError);
        }
        showStatus("설문 설정 저장에 실패해 링크 생성을 취소했습니다. Firebase Rules를 확인해 주세요.", "error");
        await loadLinks();
        return;
      }
    }
    createForm.reset();
    surveyQuestionList.replaceChildren();
    surveyBuilder.hidden = true;
    showStatus(`링크가 생성되었습니다: ${makeShortUrl(customPath)}`, "success");
    await loadLinks();
  } catch (error) {
    showStatus("링크를 생성하지 못했습니다. Firebase 로그인 상태와 RTDB Security Rules를 확인해 주세요.", "error");
    console.error("Creating link failed:", error);
  } finally {
    createButton.disabled = false;
    createButton.innerHTML = '링크 생성 <span aria-hidden="true">↗</span>';
  }
}

async function getPublicIp() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch("https://api.ipify.org?format=json", {
      method: "GET", cache: "no-store", signal: controller.signal
    });
    if (!response.ok) return "unavailable";
    const json = await response.json();
    return typeof json.ip === "string" ? json.ip.slice(0, 80) : "unavailable";
  } catch (error) {
    console.warn("Public IP lookup failed; continuing with unavailable IP:", error);
    return "unavailable";
  } finally {
    window.clearTimeout(timeout);
  }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// 접속 시도당 로그를 한 번만 생성합니다. 설문 제출 시에는 재호출하지 않습니다.
async function checkAndRecordAccess(path) {
  const ip = await getPublicIp();
  const userAgent = String(navigator.userAgent || "unknown").slice(0, 512);
  const timestamp = Date.now();
  const logRef = push(ref(db, `privateAccessLogs/${path}`));
  const accessLogId = logRef.key;
  if (!accessLogId) throw new Error("접속 로그 ID를 생성하지 못했습니다.");

  // 로그를 먼저 저장합니다. IP 조회 장애 시에도 unavailable 값으로 저장을 시도합니다.
  await set(logRef, { timestamp, ip, userAgent });

  let allowed = true;
  let message = "";
  try {
    const settingsSnap = await get(ref(db, `rateLimitSettings/${path}`));
    const settings = settingsSnap.exists() ? (settingsSnap.val() || {}) : null;
    // Legacy fallback: old link-level fields remain readable until an administrator saves new settings.
    const enabled = settings ? settings.enabled === true : (await get(ref(db, `links/${path}/rateLimitEnabled`))).val() === true;
    const maxValue = settings ? settings.max : (await get(ref(db, `links/${path}/rateLimitMax`))).val();
    const messageValue = settings ? settings.message : (await get(ref(db, `links/${path}/rateLimitMessage`))).val();
    if (enabled && ip !== "unavailable") {
      const key = await sha256Hex(ip);
      const counter = ref(db, `rateLimits/${path}/${key}`);
      const tx = await runTransaction(counter, current => Number(current || 0) + 1, { applyLocally: false });
      if (Number(tx.snapshot.val() || 0) > Math.max(1, Number(maxValue || 5))) {
        allowed = false;
        message = String(messageValue || "접속 횟수 제한에 도달했습니다.").slice(0, 240);
      }
    }
  } catch (rateLimitError) {
    // 제한 설정이 켜져 있는데 카운터를 확인할 수 없으면 우회 허용하지 않습니다.
    console.error("Rate-limit enforcement failed after access log was saved:", rateLimitError);
    allowed = false;
    message = "접속 횟수 제한을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.";
  }
  return { allowed, message, accessLogId };
}

function showRedirectError(title, message) {
  redirectSpinner.classList.add("stopped");
  redirectTitle.textContent = title;
  redirectMessage.textContent = message;
  redirectHome.hidden = false;
}

async function resolveShortLink(path) {
  if (!/^[a-zA-Z0-9_-]{3,40}$/.test(path)) {
    showRedirectError("올바르지 않은 링크입니다.", "커스텀 경로는 영문, 숫자, 하이픈, 밑줄로 된 3~40자여야 합니다.");
    return;
  }

  try {
    const urlSnapshot = await get(ref(db, `links/${path}/originalUrl`));
    if (!urlSnapshot.exists()) {
      showRedirectError("링크를 찾을 수 없습니다.", "주소가 잘못되었거나 링크가 존재하지 않습니다.");
      return;
    }

    // Public route에서는 필요한 public 필드만 각각 읽습니다.
    const [deletedSnapshot, expirySnapshot, surveyConfig] = await Promise.all([
      get(ref(db, `links/${path}/isDeleted`)),
      get(ref(db, `links/${path}/expiresAt`)),
      loadSurveyConfig(path)
    ]);
    if (deletedSnapshot.val() === true) {
      showRedirectError("삭제된 링크입니다.", "이 링크는 소유자 또는 관리자가 삭제 처리했습니다.");
      return;
    }
    const expiresAt = Number(expirySnapshot.val() || 0);
    if (expiresAt && expiresAt <= Date.now()) {
      showRedirectError("만료된 링크입니다.", "이 단축 URL의 유효 기간이 끝났습니다.");
      return;
    }
    const originalUrl = validateSafeHttpUrl(String(urlSnapshot.val()));
    if (!originalUrl) {
      showRedirectError("이동할 수 없는 링크입니다.", "저장된 원본 주소가 유효한 http 또는 https URL이 아닙니다.");
      return;
    }

    // 최초 접속 시 로그를 저장한 뒤, 설문 표시 또는 원본 URL 이동을 진행합니다.
    let access;
    try {
      access = await checkAndRecordAccess(path);
    } catch (logError) {
      console.error("Access log save failed:", logError);
      if (surveyConfig.enabled === true) {
        showRedirectError("접속 기록 저장 실패", "접속 기록을 저장하지 못해 설문을 표시하지 않았습니다. 잠시 후 다시 시도해 주세요.");
      } else {
        redirectTitle.textContent = "접속 기록 저장 실패";
        redirectMessage.textContent = "접속 기록 저장에 실패했습니다. 원본 링크 이동을 별도로 시도합니다.";
        window.location.replace(originalUrl);
      }
      return;
    }

    if (!access.allowed) {
      showRedirectError("접속 횟수 제한", access.message);
      return;
    }

    if (surveyConfig.enabled === true) {
      pendingSurvey = {
        path, originalUrl,
        questions: Object.values(surveyConfig.questions || {}),
        accessLogId: access.accessLogId
      };
      renderSurveyQuestions(pendingSurvey.questions);
      redirectSpinner.classList.add("stopped");
      redirectTitle.textContent = "설문조사";
      redirectMessage.textContent = "아래 질문에 응답해 주세요. 접속 기록은 이미 저장되었습니다.";
      surveyForm.hidden = false;
      redirectHome.hidden = true;
      return;
    }

    window.location.replace(originalUrl);
  } catch (error) {
    showRedirectError("링크를 열 수 없습니다.", "데이터베이스 연결을 확인하거나 잠시 후 다시 시도해 주세요.");
    console.error("Resolving short link failed:", error);
  }
}

surveyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingSurvey || !db) return;
  const consent = $("#survey-consent").checked;
  const answers = {};
  for (const question of pendingSurvey.questions || []) {
    const controls = [...surveyQuestionsContainer.querySelectorAll(`[data-question-id="${question.id}"]`)];
    if (question.type === "singleChoice" || question.type === "multipleChoice") {
      const selected = controls.filter(c=>c.checked).map(c=>c.value);
      if (!selected.length) { redirectMessage.textContent=`“${question.label}” 항목을 선택해 주세요.`; controls[0]?.focus(); return; }
      answers[question.id] = question.type === "singleChoice" ? selected[0] : selected;
    } else {
      const input=controls[0], value=String(input?.value || "").trim();
      if (!value || (question.type !== "char" && !/^[0-9]+$/.test(value))) { redirectMessage.textContent=`“${question.label}” 항목을 입력해 주세요.`; input?.focus(); return; }
      answers[question.id]=question.type === "char" ? value.slice(0,200) : Number(value);
    }
  }
  if (!consent) { redirectMessage.textContent = "응답 저장 동의에 체크해 주세요."; return; }
  surveySubmitButton.disabled = true;
  surveySubmitButton.textContent = "저장 중…";
  try {
    if (!pendingSurvey.accessLogId) {
      throw new Error("접속 로그가 저장되지 않아 설문 응답과 연결할 수 없습니다.");
    }
    const timestamp = Date.now();
    const responseRef = push(ref(db, `surveyResponses/${pendingSurvey.path}`));
    const responseId = responseRef.key;
    if (!responseId) throw new Error("설문 응답 ID를 생성하지 못했습니다.");

    // 최초 접속 때 생성된 로그를 참조만 합니다. 여기서 접속 로그를 재생성하지 않습니다.
    await set(responseRef, {
      answers,
      consent: true,
      timestamp,
      accessLogId: pendingSurvey.accessLogId
    });

    redirectTitle.textContent = "제출 완료";
    redirectMessage.textContent = "설문 응답이 저장되었습니다. 접속 로그는 최초 접속 시 저장되었습니다. 원본 사이트로 이동합니다.";
    surveyForm.hidden = true;
    window.location.replace(pendingSurvey.originalUrl);
  } catch (error) {
    redirectMessage.textContent = "응답을 저장하지 못했습니다. 입력 내용을 확인하거나 관리자에게 문의해 주세요.";
    console.error("Saving survey response failed:", error);
  } finally {
    surveySubmitButton.disabled = false;
    surveySubmitButton.textContent = "제출하고 이동";
  }
});

async function recordLogin(user, fallbackEmail) {
  // Login auditing is best-effort and must never hold the UI on the login screen.
  try {
    const ip = await getPublicIp();
    const logRef = push(ref(db, `loginLogs/${user.uid}`));
    await set(logRef, {
      timestamp: serverTimestamp(),
      email: String(user.email || fallbackEmail || "").slice(0, 320),
      uid: user.uid,
      ip,
      userAgent: String(navigator.userAgent || "unknown").slice(0, 512)
    });
  } catch (error) {
    console.warn("Login log was not saved; login itself remains successful:", error);
  }
}

async function handleLogin(event) {
  event?.preventDefault();
  if (loginInProgress) return;

  if (!loginForm.reportValidity()) return;

  const emailInput = $("#email-input");
  const passwordInput = $("#password-input");
  const email = String(emailInput?.value || "").trim();
  const password = String(passwordInput?.value || "");

  if (!auth || !db) {
    showStatus("Firebase가 아직 초기화되지 않았습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.", "error");
    return;
  }
  if (!email || !password) {
    showStatus("이메일과 비밀번호를 모두 입력해 주세요.", "error");
    (!email ? emailInput : passwordInput)?.focus();
    return;
  }

  loginInProgress = true;
  loginButton.disabled = true;
  loginButton.setAttribute("aria-busy", "true");
  loginButton.textContent = "로그인 중…";
  showStatus("로그인을 확인하고 있습니다…");

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged performs the role check and transitions to the dashboard.
    // Start optional logging in the background, without blocking that transition.
    void recordLogin(credential.user, email);
  } catch (error) {
    showStatus(friendlyAuthError(error), "error");
    console.error("Sign-in failed:", error);
  } finally {
    loginInProgress = false;
    loginButton.disabled = false;
    loginButton.removeAttribute("aria-busy");
    loginButton.textContent = "로그인";
  }
}

// Use the form's native submit path for both button clicks and Enter-key submission.
loginForm.addEventListener("submit", handleLogin);

$("#logout-button").addEventListener("click", async () => {
  try {
    await signOut(auth);
    showStatus("로그아웃했습니다.", "success");
  } catch (error) {
    showStatus("로그아웃하지 못했습니다. 다시 시도해 주세요.", "error");
    console.error("Sign-out failed:", error);
  }
});

surveyEnabledInput.addEventListener("change", () => {
  surveyBuilder.hidden = !surveyEnabledInput.checked;
  if (surveyEnabledInput.checked && !surveyQuestionList.children.length) addQuestionEditor({ label: "학번", type: "int" });
});
$("#add-survey-question").addEventListener("click", () => addQuestionEditor());
createForm.addEventListener("submit", createShortLink);
$("#refresh-button").addEventListener("click", loadLinks);


function setExpiryQuick(value) { const input=$("#expires-at-input"); if(!input)return; const d=new Date(); if(value==="midnight") d.setHours(24,0,0,0); else d.setTime(d.getTime()+Number(value)*3600000); input.value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); }
document.querySelectorAll("[data-expiry]").forEach(button=>button.addEventListener("click",()=>setExpiryQuick(button.dataset.expiry)));
const initialRoutePath = consumeGitHubPagesRoute();
if (!isConfigReady()) {
  if (initialRoutePath !== null) {
    switchView("redirect");
    showRedirectError("Firebase 설정이 필요합니다.", "app.js의 firebaseConfig를 프로젝트 설정값으로 교체한 뒤 다시 접속해 주세요.");
  } else {
    switchView("login");
    showStatus("Firebase 설정이 완료되지 않았습니다. app.js의 firebaseConfig를 먼저 입력해 주세요.", "error");
  }
} else {
  startApplication(initialRoutePath).catch((error) => {
    console.error("Application startup failed:", error);
    if (initialRoutePath !== null) {
      switchView("redirect");
      showRedirectError("앱을 시작할 수 없습니다.", "Firebase 설정과 데이터베이스 URL을 확인해 주세요.");
    } else {
      switchView("login");
      showStatus("앱을 시작할 수 없습니다. Firebase 설정을 확인해 주세요.", "error");
    }
  });
}
