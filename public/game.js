const socket = io();
let state = { room: null, myId: null, activeGame: "blackjack", bj: null, mines: null };

const $ = id => document.getElementById(id);
const lobby = $("lobby"), roomPanel = $("roomPanel"), game = $("game");
const lobbyMsg = $("lobbyMsg"), gameMsg = $("gameMsg");

function msg(el, text, good=false) {
  el.textContent = text || "";
  el.style.color = good ? "var(--green)" : "";
}

function money(n) {
  return Number(n || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
}

function playerName() {
  return $("name").value.trim() || "Player";
}

$("create").onclick = () => {
  socket.emit("room:create", {name: playerName()}, res => {
    if (!res.ok) return msg(lobbyMsg, res.error);
    state.myId = res.playerId;
    msg(lobbyMsg, `Room ${res.code} created. Send the code to your opponent.`, true);
  });
};

$("join").onclick = () => {
  socket.emit("room:join", {name: playerName(), code: $("roomCode").value}, res => {
    if (!res.ok) return msg(lobbyMsg, res.error);
    state.myId = res.playerId;
    msg(lobbyMsg, `Joined room ${res.code}.`, true);
  });
};

$("start").onclick = () => socket.emit("match:start", res => {
  if (!res.ok) msg(gameMsg, res.error);
});

socket.on("room:update", room => {
  state.room = room;
  $("roomCodeDisplay").textContent = room.code;
  roomPanel.classList.remove("hidden");
  const waiting = room.players.length < 2;
  $("roomStatus").textContent = room.started ? "CLASH IN PROGRESS" : waiting ? "Waiting for opponent…" : "Ready to start";
  $("start").classList.toggle("hidden", waiting || room.started);
  $("players").innerHTML = room.players.map(p => `
    <div class="player-card ${p.id===state.myId ? "me":""}">
      <div class="player-name">${escapeHtml(p.name)} ${p.id===state.myId ? "(YOU)" : ""}</div>
      <div class="balance">${money(p.balance)}</div>
    </div>`).join("");
  renderScoreboard();
  if (room.started) {
    lobby.classList.add("hidden");
    game.classList.remove("hidden");
  }
});

socket.on("match:start", data => {
  lobby.classList.add("hidden");
  roomPanel.classList.remove("hidden");
  game.classList.remove("hidden");
  state.bj = null;
  state.mines = null;
  $("gameArea").innerHTML = "";
  renderGame();
});

socket.on("match:end", data => {
  $("timer").textContent = "00:00";
  const players = Array.isArray(data) ? data : data?.players;
  if (!players?.length) {
    msg(gameMsg, "The match ended, but final results are unavailable.");
    return;
  }

  const sorted = [...players].sort((a,b)=>b.balance-a.balance);
  const tied = sorted.length > 1 && Number(sorted[0].balance) === Number(sorted[1].balance);
  const headline = tied ? "It's a tie!" : `${escapeHtml(sorted[0].name)} wins!`;
  $("gameArea").innerHTML = `<div class="game-card" style="text-align:center">
    <div class="eyebrow">FINAL RESULTS</div>
    <h2>${headline}</h2>
    <p class="muted">${tied ? "Top final balance:" : "Winner's final balance:"} <strong>${money(sorted[0].balance)}</strong></p>
    <div class="players">${sorted.map(p=>`<div class="player-card"><div class="player-name">${escapeHtml(p.name)}</div><div class="balance">${money(p.balance)}</div></div>`).join("")}</div>
  </div>`;
});

setInterval(() => {
  const end = state.room?.endTime;
  if (!end || !state.room?.started) return;
  const left = Math.max(0, end - Date.now());
  const sec = Math.ceil(left / 1000);
  $("timer").textContent = `${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`;
}, 100);

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active");
    state.activeGame = btn.dataset.game;
    state.bj = null;
    renderGame();
  });
});

function renderScoreboard() {
  if (!state.room) return;
  $("scoreboard").innerHTML = state.room.players.map(p => `
    <div class="score ${p.id===state.myId ? "me":""}">
      <div class="name">${escapeHtml(p.name)} ${p.id===state.myId ? "• YOU" : ""}</div>
      <div class="cash">${money(p.balance)}</div>
    </div>`).join("");
}

function renderGame() {
  const area = $("gameArea");
  if (!state.room?.started) return;
  if (state.activeGame === "slots") area.innerHTML = slotsHTML();
  else if (state.activeGame === "mines") area.innerHTML = minesHTML();
  else area.innerHTML = blackjackHTML();
  bindGame();
}

function betInput(defaultVal=25) {
  return `<label>Bet amount<input id="bet" type="number" min="1" step="1" value="${defaultVal}"></label>`;
}

function blackjackHTML() {
  return `<div class="game-card">
    <h2>Blackjack</h2><p class="muted">Get as close to 21 as possible without going over. Dealer stands on 17. Blackjack pays 3:2.</p>
    ${state.bj ? blackjackTable() : `<div class="bet-row">${betInput()}<button id="bjStart">Deal</button></div>`}
  </div>`;
}

function blackjackTable() {
  const h = state.bj.hand;
  return `<div><h3>Your hand: ${state.bj.playerValue}</h3>
    <div class="cards">${h.player.map(c=>cardHTML(c)).join("")}</div>
    <h3>Dealer</h3>
    <div class="cards">${h.dealer.map((c,i)=>i===1 && state.bj.result==="playing" ? `<div class="card hidden-card">?</div>` : cardHTML(c)).join("")}</div>
    ${state.bj.result==="playing" ? `<div class="action-row"><button id="bjHit">Hit</button><button id="bjStand" class="secondary">Stand</button></div>` : `<p class="message">${resultText(state.bj.result)} ${state.bj.dealerValue != null ? `Dealer: ${state.bj.dealerValue}.`:""}</p><button id="bjAgain">New hand</button>`}
  </div>`;
}

function cardHTML(c) {
  const red = ["♥","♦"].includes(c.suit) ? "red" : "";
  return `<div class="card ${red}"><div>${c.rank}</div><div>${c.suit}</div></div>`;
}

function slotsHTML() {
  return `<div class="game-card">
    <h2>Slots</h2><p class="muted">Match two symbols for 1.5×. Match three for 5×. Three 7s pay 10×.</p>
    <div id="slotResult" class="result">🎰 🎰 🎰</div>
    <div class="bet-row">${betInput()}<button id="spin">SPIN</button></div>
  </div>`;
}

function minesHTML() {
  if (!state.mines) return `<div class="game-card">
    <h2>Mines</h2><p class="muted">A 5×5 board hides 3 mines. Reveal safe tiles to grow your cash-out. Hit a mine and lose your bet.</p>
    <div class="bet-row">${betInput()}<button id="minesStart">Start game</button></div>
  </div>`;

  const game = state.mines;
  const safeCells = new Set(game.safeCells || []);
  const mines = new Set(game.mines || []);
  const tiles = Array.from({length:25},(_,i)=>{
    const safe = safeCells.has(i);
    const mine = mines.has(i);
    const exploded = game.exploded === i;
    const revealed = safe || (game.over && mine);
    const label = exploded ? "💥" : safe ? "💎" : (game.over && mine) ? "💣" : "?";
    const klass = exploded ? "mine-tile exploded" : safe ? "mine-tile safe" : revealed ? "mine-tile mine" : "mine-tile";
    return `<button class="${klass}" data-mines-cell="${i}" ${revealed || game.over ? "disabled" : ""} aria-label="${revealed ? label : `Tile ${i+1}`}">${label}</button>`;
  }).join("");
  const canCashout = !game.over && (game.safeCells || []).length > 0;
  return `<div class="game-card">
    <h2>Mines</h2>
    <p class="muted">Bet: <strong>${money(game.bet)}</strong> · Safe tiles: <strong>${(game.safeCells || []).length}</strong> · 3 mines</p>
    ${!game.over ? `<p class="mine-payout">Cash-out now: <strong>${money(game.potentialPayout || 0)}</strong> (${Number(game.multiplier || 0).toFixed(2)}×)</p>` : ""}
    <div class="mine-grid">${tiles}</div>
    <div class="action-row mine-actions">
      ${canCashout ? `<button id="minesCashout">Cash out ${money(game.potentialPayout)}</button>` : ""}
      ${game.over ? `<button id="minesAgain">Play again</button>` : ""}
    </div>
  </div>`;
}
function bindGame() {
  $("spin")?.addEventListener("click", () => {
    const spinButton = $("spin");
    const slotResult = $("slotResult");
    if (spinButton.disabled) return;
    const bet = Number($("bet").value);
    const symbols = ["🍒", "🍋", "🔔", "⭐", "7️⃣"];
    spinButton.disabled = true;
    slotResult.classList.add("spinning");
    msg(gameMsg,"Spinning...");
    const spinTimer = setInterval(()=>{
      if (!slotResult.isConnected) return clearInterval(spinTimer);
      slotResult.textContent = Array.from({length:3},()=>symbols[Math.floor(Math.random()*symbols.length)]).join(" ");
    },70);

    socket.emit("game:slots",{bet},res=>{
      if (!res.ok) {
        clearInterval(spinTimer);
        slotResult.classList.remove("spinning");
        spinButton.disabled = false;
        if (slotResult.isConnected) slotResult.textContent = "🎰 🎰 🎰";
        return msg(gameMsg,res.error);
      }
      setTimeout(()=>{
        clearInterval(spinTimer);
        slotResult.classList.remove("spinning");
        spinButton.disabled = false;
        if (!slotResult.isConnected || state.activeGame !== "slots") return;
        slotResult.textContent = res.reels.join(" ");
        msg(gameMsg, res.multiplier ? `You won ${res.multiplier}×. Net: ${res.net >= 0 ? "+" : ""}${money(res.net)}.` : `No match. Net: -${money(bet)}.`, res.multiplier>0);
      },850);
    });
  });

  $("minesStart")?.addEventListener("click",()=>{
    socket.emit("game:mines:start",{bet:Number($("bet").value)},res=>{
      if (!res.ok) return msg(gameMsg,res.error);
      state.mines = {bet:res.bet,safeCells:[],mines:[],multiplier:0,potentialPayout:0,over:false};
      renderGame();
      msg(gameMsg,"Pick a tile. Cash out after any safe reveal.");
    });
  });
  document.querySelectorAll("[data-mines-cell]").forEach(tile=>{
    tile.addEventListener("click",()=>revealMine(Number(tile.dataset.minesCell)));
  });
  $("minesCashout")?.addEventListener("click",()=>{
    socket.emit("game:mines:cashout",res=>{
      if (!res.ok) return msg(gameMsg,res.error);
      state.mines = {...state.mines,...res,over:true,potentialPayout:res.payout};
      renderGame();
      msg(gameMsg,`Cashed out ${money(res.payout)} at ${res.multiplier.toFixed(2)}×. Net: ${res.net >= 0 ? "+" : ""}${money(res.net)}.`,res.net >= 0);
    });
  });
  $("minesAgain")?.addEventListener("click",()=>{state.mines=null;renderGame();});
  $("bjStart")?.addEventListener("click",()=>bjStart());
  $("bjHit")?.addEventListener("click",()=>socket.emit("game:blackjack:hit",bjResponse));
  $("bjStand")?.addEventListener("click",()=>socket.emit("game:blackjack:stand",bjResponse));
  $("bjAgain")?.addEventListener("click",()=>{state.bj=null;renderGame();});
}

function revealMine(cell) {
  socket.emit("game:mines:reveal",{cell},res=>{
    if (!res.ok) return msg(gameMsg,res.error);
    if (res.outcome === "mine") {
      state.mines = {...state.mines,...res,exploded:cell,over:true};
      renderGame();
      return msg(gameMsg,"Mine hit — your bet is lost.");
    }
    state.mines = {...state.mines,...res,safeCells:res.safeCells,potentialPayout:res.potentialPayout || res.payout || 0,over:res.outcome === "cleared"};
    renderGame();
    if (res.outcome === "cleared") msg(gameMsg,`Board cleared! You won ${money(res.payout)}.`,true);
    else msg(gameMsg,`Safe tile! Cash-out is ${money(res.potentialPayout)} at ${res.multiplier.toFixed(2)}×.`,true);
  });
}
function bjStart() {
  socket.emit("game:blackjack:start",{bet:Number($("bet").value)},res=>{
    if (!res.ok) return msg(gameMsg,res.error);
    state.bj = res;
    if (res.finished) {
      state.bj = res;
      renderGame();
      msg(gameMsg,resultText(res.result),res.result==="blackjack"||res.result==="push");
    } else renderGame();
  });
}

function bjResponse(res) {
  if (!res.ok) return msg(gameMsg,res.error);
  state.bj = res;
  renderGame();
  if (res.finished) msg(gameMsg,resultText(res.result),res.result==="win"||res.result==="blackjack"||res.result==="push");
}

function resultText(result) {
  return ({
    win:"You win the hand!",
    lose:"Dealer wins.",
    push:"Push — your bet is returned.",
    blackjack:"BLACKJACK!",
    bust:"Bust — you went over 21."
  })[result] || result;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
