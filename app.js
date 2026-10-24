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
  serverTimestamp
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

let auth = null;
let db = null;
let currentUser = null;
let currentIsAdmin = false;
let currentLinks = [];

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
    case "auth/admin-restricted-operation":
      return "이 프로젝트는 사용자의 계정 생성이 제한되어 있습니다.";
    default:
      return "로그인 중 문제가 발생했습니다. Firebase 설정과 보안 규칙을 확인해 주세요.";
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
    currentUser = user;
    currentIsAdmin = false;
    if (!user) {
      $("#user-bar").hidden = true;
      switchView("login");
      return;
    }

    try {
      const roleSnapshot = await get(ref(db, `roles/${user.uid}`));
      currentIsAdmin = roleSnapshot.val() === "admin";
      $("#user-email").textContent = user.email || user.uid;
      $("#role-badge").hidden = !currentIsAdmin;
      $("#user-bar").hidden = false;
      $("#scope-chip").textContent = currentIsAdmin ? "전체 링크 · 관리자" : "내 링크";
      switchView("dashboard");
      showStatus("");
      await loadLinks();
    } catch (error) {
      switchView("login");
      showStatus(`계정 권한을 확인하지 못했습니다. RTDB의 roles/${user.uid} 읽기 규칙을 확인해 주세요.`, "error");
      console.error("Role lookup failed:", error);
    }
  });
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

    snapshot.forEach((child) => {
      const value = child.val();
      if (value && typeof value.originalUrl === "string") {
        currentLinks.push({ customPath: child.key, ...value });
      }
    });
    currentLinks.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    $("#link-count").textContent = String(currentLinks.length);
    renderLinks();
  } catch (error) {
    showStatus("링크 목록을 불러오지 못했습니다. RTDB Security Rules와 인덱스를 확인해 주세요.", "error");
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
    deleteButton.addEventListener("click", async () => {
      const approved = window.confirm(`/${item.customPath} 링크를 삭제할까요? 접속 로그도 함께 삭제됩니다.`);
      if (!approved) return;
      deleteButton.disabled = true;
      try {
        await remove(ref(db, `links/${item.customPath}`));
        showStatus(`/${item.customPath} 링크를 삭제했습니다.`, "success");
        await loadLinks();
      } catch (error) {
        showStatus("삭제 권한이 없거나 데이터베이스 요청에 실패했습니다.", "error");
        console.error("Deleting link failed:", error);
      } finally {
        deleteButton.disabled = false;
      }
    });

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
        ...(expiresAt ? { expiresAt } : {})
      };
    }, { applyLocally: false });

    if (!result.committed) {
      showStatus(`/${customPath} 경로는 이미 사용 중입니다. 다른 경로를 선택해 주세요.`, "error");
      return;
    }

    createForm.reset();
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

function waitAtMost(promise, milliseconds) {
  return Promise.race([
    promise,
    new Promise((resolve) => window.setTimeout(resolve, milliseconds))
  ]);
}

async function getPublicIp() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch("https://api.ipify.org?format=json", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) return "unavailable";
    const json = await response.json();
    return typeof json.ip === "string" ? json.ip.slice(0, 80) : "unavailable";
  } catch {
    return "unavailable";
  } finally {
    window.clearTimeout(timeout);
  }
}

async function recordAccess(path) {
  const ip = await getPublicIp();
  const logsRef = ref(db, `links/${path}/logs`);
  const newLogRef = push(logsRef);
  const writePromise = set(newLogRef, {
    timestamp: serverTimestamp(),
    ip,
    userAgent: String(navigator.userAgent || "unknown").slice(0, 512)
  }).catch((error) => {
    // 리다이렉트는 로그 실패로 막지 않습니다. 실제 운영에서는 App Check/서버 측 로깅을 권장합니다.
    console.warn("Access log was not saved:", error);
  });
  await waitAtMost(writePromise, 1600);
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
      showRedirectError("링크를 찾을 수 없습니다.", "주소가 잘못되었거나 링크가 삭제되었을 수 있습니다.");
      return;
    }

    const linkSnapshot = await get(ref(db, `links/${path}`));
    const linkData = linkSnapshot.val();
    if (linkData?.expiresAt && Number(linkData.expiresAt) <= Date.now()) {
      showRedirectError("만료된 링크입니다.", "이 단축 URL의 유효 기간이 끝났습니다.");
      return;
    }
    const originalUrl = validateSafeHttpUrl(String(urlSnapshot.val()));
    if (!originalUrl) {
      showRedirectError("이동할 수 없는 링크입니다.", "저장된 원본 주소가 유효한 http 또는 https URL이 아닙니다.");
      return;
    }

    redirectTitle.textContent = "주소로 이동 중입니다.";
    redirectMessage.textContent = "접속 기록을 저장한 뒤 원본 페이지로 이동합니다.";
    await recordAccess(path);
    window.location.replace(originalUrl);
  } catch (error) {
    showRedirectError("링크를 열 수 없습니다.", "데이터베이스 연결을 확인하거나 잠시 후 다시 시도해 주세요.");
    console.error("Resolving short link failed:", error);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = String($("#email-input").value || "").trim();
  const password = String($("#password-input").value || "");
  loginButton.disabled = true;
  loginButton.textContent = "로그인 중…";
  showStatus("");
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    // 브라우저에서 수집한 IP/User-Agent는 위조 가능하며 보안 감사용 증거로 사용하지 마세요.
    try {
      const ip = await getPublicIp();
      const logRef = push(ref(db, `loginLogs/${credential.user.uid}`));
      await set(logRef, {
        timestamp: serverTimestamp(),
        email: String(credential.user.email || email).slice(0, 320),
        uid: credential.user.uid,
        ip,
        userAgent: String(navigator.userAgent || "unknown").slice(0, 512)
      });
    } catch (logError) {
      console.warn("Login log was not saved:", logError);
      showStatus("로그인은 성공했지만 로그인 기록을 저장하지 못했습니다. 보안 규칙을 확인해 주세요.", "error");
    }
  } catch (error) {
    showStatus(friendlyAuthError(error), "error");
    console.error("Sign-in failed:", error);
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "로그인";
  }
});

$("#logout-button").addEventListener("click", async () => {
  try {
    await signOut(auth);
    showStatus("로그아웃했습니다.", "success");
  } catch (error) {
    showStatus("로그아웃하지 못했습니다. 다시 시도해 주세요.", "error");
    console.error("Sign-out failed:", error);
  }
});

createForm.addEventListener("submit", createShortLink);
$("#refresh-button").addEventListener("click", loadLinks);

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
