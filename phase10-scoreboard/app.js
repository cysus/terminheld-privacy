(function () {
  "use strict";

  const STORAGE_KEY = "phase10-scoreboard-state-v1";

  const PHASES = [
    { number: 1, description: "2 x 3 gleiche (Sets)" },
    { number: 2, description: "1 x 3 gleiche + 1 Folge von 4" },
    { number: 3, description: "1 x 4 gleiche + 1 Folge von 4" },
    { number: 4, description: "1 Folge von 7" },
    { number: 5, description: "1 Folge von 8" },
    { number: 6, description: "1 Folge von 9" },
    { number: 7, description: "2 x 4 gleiche (Sets)" },
    { number: 8, description: "7 Karten einer Farbe" },
    { number: 9, description: "1 x 5 gleiche + 1 x 2 gleiche" },
    { number: 10, description: "1 x 5 gleiche + 1 x 3 gleiche" },
  ];
  const MAX_PHASE = PHASES.length;

  /** @typedef {{ id:string, name:string }} Player */
  /** @typedef {{ scores: Record<string, number>, phaseCompleted: Record<string, boolean> }} Round */

  /** state */
  let state = {
    players: [],
    rounds: [],
    started: false,
  };

  // ---------- persistence ----------

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.players) && Array.isArray(parsed.rounds)) {
        state = parsed;
      }
    } catch (e) {
      console.warn("Konnte gespeicherten Spielstand nicht laden:", e);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // ---------- derived data ----------

  function currentPhaseFor(playerId) {
    let phase = 1;
    for (const round of state.rounds) {
      if (round.phaseCompleted[playerId]) {
        phase = Math.min(phase + 1, MAX_PHASE + 1);
      }
    }
    return phase; // 1..10 = in progress, 11 = finished all phases
  }

  function totalScoreFor(playerId) {
    return state.rounds.reduce((sum, r) => sum + (r.scores[playerId] || 0), 0);
  }

  function playersWhoFinished() {
    return state.players.filter((p) => currentPhaseFor(p.id) > MAX_PHASE);
  }

  function gameWinner() {
    const finished = playersWhoFinished();
    if (finished.length === 0) return null;
    return finished.reduce((best, p) =>
      totalScoreFor(p.id) < totalScoreFor(best.id) ? p : best
    );
  }

  // ---------- element refs ----------

  const setupView = document.getElementById("setupView");
  const gameView = document.getElementById("gameView");

  const addPlayerForm = document.getElementById("addPlayerForm");
  const playerNameInput = document.getElementById("playerNameInput");
  const playerList = document.getElementById("playerList");
  const startGameBtn = document.getElementById("startGameBtn");
  const setupHint = document.getElementById("setupHint");

  const playerHeaderRow = document.getElementById("playerHeaderRow");
  const roundsBody = document.getElementById("roundsBody");
  const totalsRow = document.getElementById("totalsRow");

  const addRoundBtn = document.getElementById("addRoundBtn");
  const undoRoundBtn = document.getElementById("undoRoundBtn");
  const winnerBanner = document.getElementById("winnerBanner");

  const phaseList = document.getElementById("phaseList");

  const roundModal = document.getElementById("roundModal");
  const roundForm = document.getElementById("roundForm");
  const roundInputs = document.getElementById("roundInputs");
  const roundNumberLabel = document.getElementById("roundNumberLabel");
  const cancelRoundBtn = document.getElementById("cancelRoundBtn");

  const resetBtn = document.getElementById("resetBtn");
  const confirmModal = document.getElementById("confirmModal");
  const cancelResetBtn = document.getElementById("cancelResetBtn");
  const confirmResetBtn = document.getElementById("confirmResetBtn");

  // ---------- rendering ----------

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function renderPhaseReference() {
    phaseList.innerHTML = "";
    for (const phase of PHASES) {
      const li = document.createElement("li");
      li.textContent = `Phase ${phase.number}: ${phase.description}`;
      phaseList.appendChild(li);
    }
  }

  function renderSetup() {
    playerList.innerHTML = "";
    state.players.forEach((player) => {
      const li = document.createElement("li");

      const nameSpan = document.createElement("span");
      nameSpan.textContent = player.name;
      li.appendChild(nameSpan);

      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-player";
      removeBtn.setAttribute("aria-label", `${player.name} entfernen`);
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => {
        state.players = state.players.filter((p) => p.id !== player.id);
        saveState();
        renderSetup();
      });
      li.appendChild(removeBtn);

      playerList.appendChild(li);
    });

    const canStart = state.players.length >= 2;
    startGameBtn.disabled = !canStart;
    setupHint.textContent = canStart
      ? `${state.players.length} Spieler bereit.`
      : "Mindestens 2 Spieler hinzufügen, um zu starten.";
  }

  function renderGame() {
    // header
    playerHeaderRow.innerHTML = "<th></th>";
    state.players.forEach((player) => {
      const th = document.createElement("th");
      const phase = currentPhaseFor(player.id);
      const finished = phase > MAX_PHASE;

      const wrap = document.createElement("div");
      wrap.className = "player-col-header";

      const nameEl = document.createElement("span");
      nameEl.className = "player-name-header";
      nameEl.textContent = player.name;
      wrap.appendChild(nameEl);

      const badge = document.createElement("span");
      badge.className = "phase-badge" + (finished ? " done" : "");
      badge.textContent = finished ? "Fertig!" : `Phase ${phase}`;
      wrap.appendChild(badge);

      th.appendChild(wrap);
      playerHeaderRow.appendChild(th);
    });

    // rounds
    roundsBody.innerHTML = "";
    state.rounds.forEach((round, index) => {
      const tr = document.createElement("tr");

      const roundCell = document.createElement("td");
      roundCell.className = "round-num-cell";
      roundCell.textContent = `Runde ${index + 1}`;
      tr.appendChild(roundCell);

      state.players.forEach((player) => {
        const td = document.createElement("td");
        const hit = round.phaseCompleted[player.id];
        td.className = "score-cell" + (hit ? " phase-hit" : "");
        const score = round.scores[player.id] || 0;
        td.textContent = hit ? `${score} ✓` : `${score}`;
        tr.appendChild(td);
      });

      roundsBody.appendChild(tr);
    });

    // totals + leader
    const totals = state.players.map((p) => totalScoreFor(p.id));
    const minTotal = totals.length ? Math.min(...totals) : null;

    totalsRow.innerHTML = "<td>Gesamt</td>";
    state.players.forEach((player) => {
      const td = document.createElement("td");
      const total = totalScoreFor(player.id);
      td.textContent = total;
      if (state.rounds.length > 0 && total === minTotal) {
        td.classList.add("leader-col");
      }
      totalsRow.appendChild(td);
    });

    undoRoundBtn.disabled = state.rounds.length === 0;

    // winner banner
    const winner = gameWinner();
    if (winner) {
      winnerBanner.textContent = `🏆 ${winner.name} hat alle 10 Phasen geschafft und gewinnt mit ${totalScoreFor(
        winner.id
      )} Punkten!`;
      winnerBanner.classList.remove("hidden");
    } else {
      winnerBanner.classList.add("hidden");
    }
  }

  function render() {
    const hasGame = state.started;
    setupView.classList.toggle("hidden", hasGame);
    gameView.classList.toggle("hidden", !hasGame);

    if (hasGame) {
      renderGame();
    } else {
      renderSetup();
    }
  }

  // ---------- round modal ----------

  function openRoundModal() {
    roundNumberLabel.textContent = String(state.rounds.length + 1);
    roundInputs.innerHTML = "";

    state.players.forEach((player) => {
      const phase = currentPhaseFor(player.id);
      const finished = phase > MAX_PHASE;

      const row = document.createElement("div");
      row.className = "round-input-row";

      const top = document.createElement("div");
      top.className = "row-top";

      const label = document.createElement("label");
      label.className = "player-label";
      label.textContent = player.name;
      label.setAttribute("for", `score-${player.id}`);
      top.appendChild(label);

      const hint = document.createElement("span");
      hint.className = "current-phase-hint";
      hint.textContent = finished ? "Alle Phasen geschafft" : `aktuell: Phase ${phase}`;
      top.appendChild(hint);

      row.appendChild(top);

      const scoreInput = document.createElement("input");
      scoreInput.type = "number";
      scoreInput.min = "0";
      scoreInput.step = "1";
      scoreInput.placeholder = "Punkte dieser Runde";
      scoreInput.id = `score-${player.id}`;
      scoreInput.dataset.playerId = player.id;
      scoreInput.value = "0";
      scoreInput.required = true;
      row.appendChild(scoreInput);

      if (!finished) {
        const checkboxLine = document.createElement("label");
        checkboxLine.className = "checkbox-line";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = `phase-${player.id}`;
        checkbox.dataset.playerId = player.id;

        checkboxLine.appendChild(checkbox);
        const span = document.createElement("span");
        span.textContent = `Phase ${phase} geschafft`;
        checkboxLine.appendChild(span);

        row.appendChild(checkboxLine);
      }

      roundInputs.appendChild(row);
    });

    roundModal.classList.remove("hidden");
    const firstInput = roundInputs.querySelector("input[type='number']");
    if (firstInput) firstInput.focus();
  }

  function closeRoundModal() {
    roundModal.classList.add("hidden");
  }

  function submitRound(event) {
    event.preventDefault();

    const scores = {};
    const phaseCompleted = {};

    state.players.forEach((player) => {
      const scoreInput = document.getElementById(`score-${player.id}`);
      const value = scoreInput ? parseInt(scoreInput.value, 10) : 0;
      scores[player.id] = Number.isFinite(value) ? Math.max(0, value) : 0;

      const checkbox = document.getElementById(`phase-${player.id}`);
      phaseCompleted[player.id] = checkbox ? checkbox.checked : false;
    });

    state.rounds.push({ scores, phaseCompleted });
    saveState();
    closeRoundModal();
    render();
  }

  // ---------- events ----------

  addPlayerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = playerNameInput.value.trim();
    if (!name) return;
    state.players.push({ id: uid(), name });
    playerNameInput.value = "";
    saveState();
    renderSetup();
    playerNameInput.focus();
  });

  startGameBtn.addEventListener("click", () => {
    if (state.players.length < 2) return;
    state.started = true;
    saveState();
    render();
  });

  addRoundBtn.addEventListener("click", openRoundModal);
  cancelRoundBtn.addEventListener("click", closeRoundModal);
  roundForm.addEventListener("submit", submitRound);

  roundModal.addEventListener("click", (e) => {
    if (e.target === roundModal) closeRoundModal();
  });

  undoRoundBtn.addEventListener("click", () => {
    state.rounds.pop();
    saveState();
    render();
  });

  resetBtn.addEventListener("click", () => {
    confirmModal.classList.remove("hidden");
  });
  cancelResetBtn.addEventListener("click", () => {
    confirmModal.classList.add("hidden");
  });
  confirmResetBtn.addEventListener("click", () => {
    state = { players: [], rounds: [], started: false };
    saveState();
    confirmModal.classList.add("hidden");
    render();
  });
  confirmModal.addEventListener("click", (e) => {
    if (e.target === confirmModal) confirmModal.classList.add("hidden");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeRoundModal();
      confirmModal.classList.add("hidden");
    }
  });

  // ---------- init ----------

  function init() {
    loadState();
    renderPhaseReference();
    render();
  }

  init();
})();
