"use strict";

const LOGIN_PLAYERS = [
  { login: "maciej", name: "Maciej Zając" },
  { login: "tomasz", name: "Tomasz Brocławik" },
];

const SESSION_KEY = "balticwood-me-2028-supabase-session-v1";
const LOCK_MINUTES = 10;

const state = {
  supabase: null,
  sessionToken: localStorage.getItem(SESSION_KEY),
  currentUser: null,
  matches: [],
  predictions: {},
  ranking: [],
  lastCalculatedAt: null,
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  loginForm: $("#login-form"),
  loginUser: $("#login-user"),
  loginPassword: $("#login-password"),
  loginError: $("#login-error"),
  app: $("#app"),
  currentUserName: $("#current-user-name"),
  currentUserRole: $("#current-user-role"),
  logoutButton: $("#logout-button"),
  matchesList: $("#matches-list"),
  rankingBody: $("#ranking-body"),
  lastCalculated: $("#last-calculated"),
  masterPanel: $("#master"),
  adminResults: $("#admin-results"),
  recalculateButton: $("#recalculate-button"),
  resetDemoButton: $("#reset-demo-button"),
  publicPredictions: $("#public-predictions"),
  publicPredictionsStatus: $("#public-predictions-status"),
  refreshPublicPredictions: $("#refresh-public-predictions"),
};

init();

async function init() {
  renderLoginOptions();
  bindEvents();

  if (!configureSupabase()) {
    showLoginOnly(
      "Brakuje konfiguracji Supabase. Wklej anon public key w pliku supabase-config.js.",
    );
    elements.publicPredictionsStatus.textContent = "Brakuje konfiguracji Supabase.";
    return;
  }

  await loadPublicPredictions();

  if (state.sessionToken) {
    await loadBootstrap();
  } else {
    showLoginOnly("");
  }

  window.setInterval(renderDynamicParts, 1000);
}

function configureSupabase() {
  const config = window.ME2028_SUPABASE;
  const isMissing =
    !config ||
    !config.url ||
    !config.anonKey ||
    config.anonKey.includes("WSTAW_TUTAJ");

  if (isMissing || !window.supabase?.createClient) {
    elements.loginForm.querySelector("button").disabled = true;
    return false;
  }

  state.supabase = window.supabase.createClient(
    normalizeSupabaseUrl(config.url),
    config.anonKey,
  );
  return true;
}

function normalizeSupabaseUrl(url) {
  return String(url).replace(/\/rest\/v1\/?$/i, "");
}

function bindEvents() {
  elements.loginForm.addEventListener("submit", handleLogin);
  elements.logoutButton.addEventListener("click", handleLogout);
  elements.recalculateButton.addEventListener("click", handleRecalculate);
  elements.resetDemoButton.addEventListener("click", handleResetDemo);
  elements.refreshPublicPredictions.addEventListener("click", loadPublicPredictions);
}

function renderLoginOptions() {
  elements.loginUser.innerHTML = LOGIN_PLAYERS.map(
    (player) => `<option value="${escapeHtml(player.login)}">${escapeHtml(player.name)}</option>`,
  ).join("");
}

async function handleLogin(event) {
  event.preventDefault();
  elements.loginError.textContent = "";

  const playerName = elements.loginUser.value;
  const pin = elements.loginPassword.value.trim();

  const { data, error } = await state.supabase.rpc("me2028_login", {
    p_player_name: playerName,
    p_pin: pin,
  });

  if (error) {
    elements.loginError.textContent = cleanError(error.message);
    return;
  }

  state.sessionToken = data.token;
  localStorage.setItem(SESSION_KEY, state.sessionToken);
  elements.loginPassword.value = "";
  applyBootstrap(data.data);
  render();
}

async function loadBootstrap() {
  const { data, error } = await state.supabase.rpc("me2028_get_bootstrap", {
    p_session_token: state.sessionToken,
  });

  if (error) {
    localStorage.removeItem(SESSION_KEY);
    state.sessionToken = null;
    showLoginOnly(cleanError(error.message));
    return;
  }

  applyBootstrap(data);
  render();
  await loadPublicPredictions();
}

function handleLogout() {
  state.sessionToken = null;
  state.currentUser = null;
  state.matches = [];
  state.predictions = {};
  state.ranking = [];
  state.lastCalculatedAt = null;
  localStorage.removeItem(SESSION_KEY);
  showLoginOnly("");
}

async function handleResetDemo() {
  if (!state.currentUser?.isMaster) return;
  const confirmed = window.confirm(
    "Czy na pewno zresetować testowe typy, wyniki i harmonogram meczów?",
  );
  if (!confirmed) return;

  const { data, error } = await state.supabase.rpc("me2028_reset_demo", {
    p_session_token: state.sessionToken,
  });

  if (error) {
    window.alert(cleanError(error.message));
    return;
  }

  applyBootstrap(data);
  render();
}

async function handleRecalculate() {
  if (!state.currentUser?.isMaster) return;

  elements.recalculateButton.disabled = true;
  elements.recalculateButton.textContent = "Zapisuję wyniki...";

  try {
    let latestData = null;

    for (const match of state.matches) {
      const homeInput = document.querySelector(`[data-result-home="${match.id}"]`);
      const awayInput = document.querySelector(`[data-result-away="${match.id}"]`);
      const homeValue = homeInput?.value.trim() ?? "";
      const awayValue = awayInput?.value.trim() ?? "";
      const bothEmpty = homeValue === "" && awayValue === "";

      if (!bothEmpty && (!isValidScore(homeValue) || !isValidScore(awayValue))) {
        window.alert(`Wynik meczu ${match.home} - ${match.away} musi być liczbą 0 lub większą.`);
        return;
      }

      const { data, error } = await state.supabase.rpc("me2028_save_match_result", {
        p_session_token: state.sessionToken,
        p_match_id: match.id,
        p_home_goals: bothEmpty ? null : Number(homeValue),
        p_away_goals: bothEmpty ? null : Number(awayValue),
      });

      if (error) {
        window.alert(cleanError(error.message));
        return;
      }

      latestData = data;
    }

    if (latestData) {
      applyBootstrap(latestData);
      render();
      await loadPublicPredictions();
    }
  } finally {
    elements.recalculateButton.disabled = false;
    elements.recalculateButton.textContent = "Zapisz wyniki i przelicz punktację";
  }
}

async function handleSavePrediction(matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  const statusElement = document.querySelector(`[data-save-status="${matchId}"]`);

  if (!match || !canEditPrediction(match)) {
    setSaveStatus(statusElement, "Typowanie tego meczu jest już zablokowane.", "error");
    return;
  }

  const homeInput = document.querySelector(`[data-prediction-home="${matchId}"]`);
  const awayInput = document.querySelector(`[data-prediction-away="${matchId}"]`);
  const homeValue = homeInput?.value.trim() ?? "";
  const awayValue = awayInput?.value.trim() ?? "";

  if (!isValidScore(homeValue) || !isValidScore(awayValue)) {
    setSaveStatus(statusElement, "Wpisz dwie liczby, np. 2 i 1.", "error");
    return;
  }

  const saveButton = document.querySelector(`[data-save-match="${matchId}"]`);
  saveButton.disabled = true;

  const { data, error } = await state.supabase.rpc("me2028_save_prediction", {
    p_session_token: state.sessionToken,
    p_match_id: matchId,
    p_home_goals: Number(homeValue),
    p_away_goals: Number(awayValue),
  });

  if (error) {
    setSaveStatus(statusElement, cleanError(error.message), "error");
    saveButton.disabled = !canEditPrediction(match);
    return;
  }

  applyBootstrap(data);
  render();

  const nextStatusElement = document.querySelector(`[data-save-status="${matchId}"]`);
  setSaveStatus(nextStatusElement, "Typ zapisany w bazie. Piłkarska intuicja poszła w świat.", "success");
  await loadPublicPredictions();
}

async function loadPublicPredictions() {
  if (!state.supabase) return;

  elements.refreshPublicPredictions.disabled = true;
  elements.publicPredictionsStatus.textContent = "Ładowanie typów...";

  const { data, error } = await state.supabase.rpc("me2028_public_predictions");

  elements.refreshPublicPredictions.disabled = false;

  if (error) {
    elements.publicPredictionsStatus.textContent = cleanError(error.message);
    elements.publicPredictions.innerHTML = "";
    return;
  }

  renderPublicPredictions(data);
  elements.publicPredictionsStatus.textContent = `Ostatnie odświeżenie: ${formatDateTime(data.generatedAt)}`;
}

function applyBootstrap(payload) {
  state.currentUser = payload.player;
  state.matches = payload.matches ?? [];
  state.predictions = Object.fromEntries(
    (payload.predictions ?? []).map((prediction) => [prediction.matchId, prediction]),
  );
  state.ranking = payload.ranking ?? [];
  state.lastCalculatedAt = payload.lastCalculatedAt ?? null;
}

function showLoginOnly(message) {
  document.body.classList.remove("logged-in");
  elements.app.hidden = true;
  elements.loginForm.closest(".login-card").hidden = false;
  document.querySelector(".nav-link-master").hidden = true;
  elements.loginError.textContent = message;
}

function render() {
  if (!state.currentUser) {
    showLoginOnly("");
    return;
  }

  document.body.classList.add("logged-in");
  elements.app.hidden = false;
  elements.loginForm.closest(".login-card").hidden = true;
  elements.currentUserName.textContent = state.currentUser.name;
  elements.currentUserRole.textContent = state.currentUser.isMaster
    ? "Rola: master administrator oraz zawodnik"
    : "Rola: zawodnik";

  renderMatches();
  renderRanking();
  renderAdmin();
  renderDynamicParts();
}

function renderDynamicParts() {
  if (!state.currentUser) return;

  state.matches.forEach((match) => {
    const countdown = document.querySelector(`[data-countdown="${match.id}"]`);
    const status = document.querySelector(`[data-status="${match.id}"]`);
    const card = document.querySelector(`[data-match-card="${match.id}"]`);
    const saveButton = document.querySelector(`[data-save-match="${match.id}"]`);
    const inputs = document.querySelectorAll(
      `[data-prediction-home="${match.id}"], [data-prediction-away="${match.id}"]`,
    );

    if (countdown) countdown.textContent = getCountdownText(match);
    if (status) {
      status.textContent = getStatusText(match);
      status.className = `status-pill ${getStatusClass(match)}`;
    }
    if (card) card.classList.toggle("locked", !canEditPrediction(match));
    if (saveButton) saveButton.disabled = !canEditPrediction(match);
    inputs.forEach((input) => {
      input.disabled = !canEditPrediction(match);
    });
  });
}

function renderMatches() {
  elements.matchesList.innerHTML = state.matches
    .map((match) => {
      const prediction = state.predictions[match.id] ?? {};
      const result = match.completed ? `${match.resultHome}:${match.resultAway}` : "brak";

      return `
        <article class="match-card" data-match-card="${match.id}">
          <div class="match-top">
            <div>
              <span class="match-number">Mecz ${match.number}</span>
              <h3>${escapeHtml(match.home)} - ${escapeHtml(match.away)}</h3>
            </div>
            <span class="status-pill" data-status="${match.id}">${getStatusText(match)}</span>
          </div>
          <p class="match-meta">
            Start: ${formatDateTime(match.kickoff)}
            <br />
            <strong data-countdown="${match.id}">${getCountdownText(match)}</strong>
          </p>
          <p class="match-status">Wynik oficjalny: <strong>${result}</strong></p>
          <div class="prediction-row">
            <label>
              ${escapeHtml(match.home)}
              <input
                type="number"
                min="0"
                inputmode="numeric"
                data-prediction-home="${match.id}"
                value="${prediction.home ?? ""}"
                aria-label="Typ gospodarzy"
              />
            </label>
            <span class="score-separator">:</span>
            <label>
              ${escapeHtml(match.away)}
              <input
                type="number"
                min="0"
                inputmode="numeric"
                data-prediction-away="${match.id}"
                value="${prediction.away ?? ""}"
                aria-label="Typ gości"
              />
            </label>
          </div>
          <div class="match-actions">
            <button class="button button-primary" data-save-match="${match.id}" type="button">
              Zapisz typ
            </button>
            <p class="save-status" data-save-status="${match.id}">
              ${prediction.savedAt ? `Zapisano: ${formatDateTime(prediction.savedAt)}` : ""}
            </p>
          </div>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll("[data-save-match]").forEach((button) => {
    button.addEventListener("click", () => handleSavePrediction(button.dataset.saveMatch));
  });
}

function renderRanking() {
  elements.rankingBody.innerHTML = state.ranking
    .map(
      (row) => `
        <tr>
          <td>${row.rank}</td>
          <td>${escapeHtml(row.name)}</td>
          <td>${row.points}</td>
          <td>${row.exact}</td>
          <td>${row.outcome}</td>
        </tr>
      `,
    )
    .join("");

  elements.lastCalculated.textContent = state.lastCalculatedAt
    ? `Ostatnie przeliczenie: ${formatDateTime(state.lastCalculatedAt)}`
    : "Punktacja nie była jeszcze przeliczona.";
}

function renderAdmin() {
  const isMaster = Boolean(state.currentUser?.isMaster);
  elements.masterPanel.hidden = !isMaster;
  document.querySelector(".nav-link-master").hidden = !isMaster;

  if (!isMaster) return;

  elements.adminResults.innerHTML = state.matches
    .map(
      (match) => `
        <article class="match-card">
          <div class="match-top">
            <div>
              <span class="match-number">Mecz ${match.number}</span>
              <h3>${escapeHtml(match.home)} - ${escapeHtml(match.away)}</h3>
            </div>
            <span class="status-pill ${match.completed ? "done" : ""}">
              ${match.completed ? "wynik zapisany" : "czeka na wynik"}
            </span>
          </div>
          <p class="match-meta">Start: ${formatDateTime(match.kickoff)}</p>
          <div class="result-row">
            <label>
              ${escapeHtml(match.home)}
              <input
                type="number"
                min="0"
                inputmode="numeric"
                data-result-home="${match.id}"
                value="${match.resultHome ?? ""}"
              />
            </label>
            <span class="score-separator">:</span>
            <label>
              ${escapeHtml(match.away)}
              <input
                type="number"
                min="0"
                inputmode="numeric"
                data-result-away="${match.id}"
                value="${match.resultAway ?? ""}"
              />
            </label>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderPublicPredictions(data) {
  const players = data.players ?? [];
  const matches = data.matches ?? [];

  if (matches.length === 0) {
    elements.publicPredictions.innerHTML = `<p class="public-hidden">Brak meczów do pokazania.</p>`;
    return;
  }

  elements.publicPredictions.innerHTML = matches
    .map((match) => {
      const result = match.completed ? `${match.resultHome}:${match.resultAway}` : "brak";
      const visibilityText = match.predictionsVisible
        ? "typy widoczne"
        : "typy ukryte do zamknięcia typowania";

      return `
        <article class="public-match">
          <header class="public-match-header">
            <div>
              <span class="match-number">Mecz ${match.number}</span>
              <h3>${escapeHtml(match.home)} - ${escapeHtml(match.away)}</h3>
              <p class="match-meta">Start: ${formatDateTime(match.kickoff)} · Wynik: <strong>${result}</strong></p>
            </div>
            <span class="status-pill ${match.predictionsVisible ? "done" : "locked"}">${visibilityText}</span>
          </header>
          <div class="public-match-body">
            ${
              match.predictionsVisible
                ? renderPublicPredictionsTable(players, match.predictions ?? {})
                : `<p class="public-hidden">Typy dla tego meczu pojawią się 10 minut przed startem spotkania.</p>`
            }
          </div>
        </article>
      `;
    })
    .join("");
}

function renderPublicPredictionsTable(players, predictions) {
  return `
    <div class="public-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Zawodnik</th>
            <th>Typ</th>
            <th>Zapisano</th>
          </tr>
        </thead>
        <tbody>
          ${players
            .map((player) => {
              const prediction = predictions[player.id];
              const score = prediction ? `${prediction.home}:${prediction.away}` : "-";
              return `
                <tr>
                  <td>${escapeHtml(player.name)}</td>
                  <td><span class="prediction-score ${prediction ? "" : "empty"}">${score}</span></td>
                  <td>${prediction ? formatDateTime(prediction.savedAt) : "brak typu"}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function setSaveStatus(element, message, type) {
  if (!element) return;
  element.textContent = message;
  element.className = `save-status ${type}`;
}

function canEditPrediction(match) {
  if (match.completed) return false;
  return Date.now() < getLockTime(match).getTime();
}

function getLockTime(match) {
  return new Date(new Date(match.kickoff).getTime() - LOCK_MINUTES * 60 * 1000);
}

function getStatusText(match) {
  if (match.completed) return "rozegrany";
  return canEditPrediction(match) ? "typowanie otwarte" : "typowanie zablokowane";
}

function getStatusClass(match) {
  if (match.completed) return "done";
  return canEditPrediction(match) ? "" : "locked";
}

function getCountdownText(match) {
  if (match.completed) return "Mecz zakończony.";

  const now = Date.now();
  const lockAt = getLockTime(match).getTime();
  const kickoff = new Date(match.kickoff).getTime();

  if (now >= kickoff) return "Mecz już się rozpoczął.";
  if (now >= lockAt) return "Mniej niż 10 minut do meczu. Typowanie zamknięte.";

  return `Typowanie zamyka się za ${formatDuration(lockAt - now)}.`;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days} d ${hours} godz.`;
  if (hours > 0) return `${hours} godz. ${minutes} min`;
  return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function isValidScore(value) {
  if (value === "") return false;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0;
}

function cleanError(message) {
  return String(message || "Wystąpił błąd.")
    .replace(/^Error:\s*/i, "")
    .replace(/^JSON object requested, multiple .*$/i, "Wystąpił błąd bazy danych.");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
