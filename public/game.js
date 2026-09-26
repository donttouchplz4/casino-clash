const socket = io();
let state = { room: null, myId: null, activeGame: "blackjack", bj: null };

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
  else if (state.activeGame === "roulette") area.innerHTML = rouletteHTML();
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

function rouletteHTML() {
  const nums = Array.from({length:37},(_,i)=>i);
  return `<div class="game-card">
    <h2>Roulette</h2><p class="muted">Red/black and odd/even pay 2×. A straight-up number pays 36×.</p>
    <div class="bet-row">${betInput()}<button id="rRed">Red</button><button id="rBlack">Black</button><button id="rOdd" class="secondary">Odd</button><button id="rEven" class="secondary">Even</button></div>
    <div class="roulette-grid">${nums.map(n=>`<button data-number="${n}">${n}</button>`).join("")}</div>
    <div id="rouletteResult" class="big-number">?</div>
  </div>`;
}

function bindGame() {
  $("spin")?.addEventListener("click", () => {
    const bet = Number($("bet").value);
    socket.emit("game:slots",{bet},res=>{
      if (!res.ok) return msg(gameMsg,res.error);
      $("slotResult").textContent = res.reels.join(" ");
      msg(gameMsg, res.multiplier ? `You won ${res.multiplier}×. Net: ${res.net >= 0 ? "+" : ""}${money(res.net)}.` : `No match. Net: -${money(bet)}.`, res.multiplier>0);
    });
  });

  ["Red","Black","Odd","Even"].forEach(x=>{
    const el = $("r"+x);
    el?.addEventListener("click",()=>roulette(x.toLowerCase()));
  });
  document.querySelectorAll("[data-number]").forEach(el=>{
    el.addEventListener("click",()=>roulette("number:"+el.dataset.number));
  });

  $("bjStart")?.addEventListener("click",()=>bjStart());
  $("bjHit")?.addEventListener("click",()=>socket.emit("game:blackjack:hit",bjResponse));
  $("bjStand")?.addEventListener("click",()=>socket.emit("game:blackjack:stand",bjResponse));
  $("bjAgain")?.addEventListener("click",()=>{state.bj=null;renderGame();});
}

function roulette(pick) {
  const bet = Number($("bet").value);
  socket.emit("game:roulette",{bet,pick},res=>{
    if (!res.ok) return msg(gameMsg,res.error);
    $("rouletteResult").textContent = `${res.number}${res.red ? " • RED" : res.number===0 ? " • GREEN" : " • BLACK"}`;
    msg(gameMsg, res.won ? `WIN! ${res.multiplier}× payout. Net +${money(res.net)}.` : `Loss: -${money(bet)}.`, res.won);
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
