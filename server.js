const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const STARTING_BALANCE = 1000;
const ROUND_MS = 3 * 60 * 1000;
const MAX_PLAYERS = 2;

const rooms = new Map();

function cleanName(name) {
  return String(name || "Player").trim().slice(0, 16) || "Player";
}

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({length: 5}, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function card() {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = [
    ["A", 11], ["2", 2], ["3", 3], ["4", 4], ["5", 5],
    ["6", 6], ["7", 7], ["8", 8], ["9", 9],
    ["10", 10], ["J", 10], ["Q", 10], ["K", 10]
  ];
  const [rank, value] = ranks[Math.floor(Math.random() * ranks.length)];
  return { rank, suit: suits[Math.floor(Math.random() * suits.length)], value };
}

function handValue(hand) {
  let total = hand.reduce((sum, c) => sum + c.value, 0);
  let aces = hand.filter(c => c.rank === "A").length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function dealBlackjack() {
  return { player: [card(), card()], dealer: [card(), card()] };
}

function publicRoom(room) {
  return {
    code: room.code,
    started: room.started,
    startTime: room.startTime,
    endTime: room.endTime,
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      balance: Math.round(p.balance * 100) / 100,
      connected: p.connected
    }))
  };
}

function emitRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}

function getPlayer(socket) {
  const room = rooms.get(socket.data.roomCode);
  return room ? room.players.get(socket.id) : null;
}

function requireActiveGame(socket, callback) {
  const room = rooms.get(socket.data.roomCode);
  const player = room?.players.get(socket.id);
  if (!room || !player) {
    callback?.({ ok: false, error: "You are not in a room." });
    return null;
  }
  if (!room.started) {
    callback?.({ ok: false, error: "The match has not started yet." });
    return null;
  }
  if (Date.now() >= room.endTime) {
    callback?.({ ok: false, error: "Time is up!" });
    return null;
  }
  return { room, player };
}

function broadcastBalances(room) {
  emitRoom(room);
}

function settleBlackjack(player, amount, result) {
  if (result === "win") player.balance += amount;
  else if (result === "blackjack") player.balance += amount * 1.5;
  else if (result === "push") player.balance += amount;
}

io.on("connection", socket => {
  socket.on("room:create", ({ name } = {}, cb) => {
    if (socket.data.roomCode) return cb?.({ ok: false, error: "You are already in a room." });
    const code = makeRoomCode();
    const room = {
      code,
      players: new Map(),
      started: false,
      startTime: null,
      endTime: null,
      timer: null
    };
    room.players.set(socket.id, {
      id: socket.id,
      name: cleanName(name),
      balance: STARTING_BALANCE,
      connected: true,
      blackjack: null,
      lastAction: 0
    });
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    cb?.({ ok: true, code, playerId: socket.id });
    emitRoom(room);
  });

  socket.on("room:join", ({ name, code } = {}, cb) => {
    if (socket.data.roomCode) return cb?.({ ok: false, error: "You are already in a room." });
    const normalized = String(code || "").trim().toUpperCase();
    const room = rooms.get(normalized);
    if (!room) return cb?.({ ok: false, error: "Room not found." });
    if (room.started) return cb?.({ ok: false, error: "That match has already started." });
    if (room.players.size >= MAX_PLAYERS) return cb?.({ ok: false, error: "That room is full." });

    room.players.set(socket.id, {
      id: socket.id,
      name: cleanName(name),
      balance: STARTING_BALANCE,
      connected: true,
      blackjack: null,
      lastAction: 0
    });
    socket.join(room.code);
    socket.data.roomCode = room.code;

    cb?.({ ok: true, code: room.code, playerId: socket.id });
    emitRoom(room);

    if (room.players.size === MAX_PLAYERS) {
      room.started = true;
      room.startTime = Date.now();
      room.endTime = room.startTime + ROUND_MS;
      room.timer = setTimeout(() => endRoom(room.code), ROUND_MS);
      io.to(room.code).emit("match:start", { startTime: room.startTime, endTime: room.endTime });
      emitRoom(room);
    }
  });

  socket.on("match:start", cb => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb?.({ ok: false, error: "Room not found." });
    if (room.players.size !== 2) return cb?.({ ok: false, error: "You need exactly 2 players." });
    if (room.started) return cb?.({ ok: true });
    room.started = true;
    room.startTime = Date.now();
    room.endTime = room.startTime + ROUND_MS;
    room.timer = setTimeout(() => endRoom(room.code), ROUND_MS);
    io.to(room.code).emit("match:start", { startTime: room.startTime, endTime: room.endTime });
    emitRoom(room);
    cb?.({ ok: true });
  });

  socket.on("game:slots", ({ bet } = {}, cb) => {
    const active = requireActiveGame(socket, cb);
    if (!active) return;
    const { room, player } = active;
    const amount = Number(bet);
    if (!Number.isFinite(amount) || amount < 1 || amount > player.balance) return cb?.({ ok: false, error: "Invalid bet." });
    const symbols = ["🍒", "🍋", "🔔", "⭐", "7️⃣"];
    const reels = [0,0,0].map(() => symbols[Math.floor(Math.random() * symbols.length)]);
    let multiplier = 0;
    if (reels[0] === reels[1] && reels[1] === reels[2]) {
      multiplier = reels[0] === "7️⃣" ? 10 : 5;
    } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
      multiplier = 2;
    }
    player.balance -= amount;
    player.balance += amount * multiplier;
    broadcastBalances(room);
    cb?.({ ok: true, reels, multiplier, net: amount * (multiplier - 1), balance: player.balance });
  });

  socket.on("game:roulette", ({ bet, pick } = {}, cb) => {
    const active = requireActiveGame(socket, cb);
    if (!active) return;
    const { room, player } = active;
    const amount = Number(bet);
    const choice = String(pick);
    if (!Number.isFinite(amount) || amount < 1 || amount > player.balance) return cb?.({ ok: false, error: "Invalid bet." });

    const number = Math.floor(Math.random() * 37);
    const red = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(number);
    let won = false;
    let multiplier = 0;

    if (choice === "red" || choice === "black") {
      won = number !== 0 && ((choice === "red") === red);
      multiplier = 2;
    } else if (choice === "odd" || choice === "even") {
      won = number !== 0 && ((choice === "odd") === (number % 2 === 1));
      multiplier = 2;
    } else if (/^number:\d+$/.test(choice)) {
      const n = Number(choice.split(":")[1]);
      won = n === number;
      multiplier = 36;
    }

    player.balance -= amount;
    if (won) player.balance += amount * multiplier;
    broadcastBalances(room);
    cb?.({ ok: true, number, red, won, multiplier, net: won ? amount * (multiplier - 1) : -amount, balance: player.balance });
  });

  socket.on("game:blackjack:start", ({ bet } = {}, cb) => {
    const active = requireActiveGame(socket, cb);
    if (!active) return;
    const { room, player } = active;
    if (player.blackjack) return cb?.({ ok: false, error: "Finish your current blackjack hand first." });
    const amount = Number(bet);
    if (!Number.isFinite(amount) || amount < 1 || amount > player.balance) return cb?.({ ok: false, error: "Invalid bet." });

    player.balance -= amount;
    player.blackjack = { bet: amount, ...dealBlackjack() };
    const value = handValue(player.blackjack.player);
    const dealerValue = handValue(player.blackjack.dealer);

    if (value === 21) {
      settleBlackjack(player, amount, dealerValue === 21 ? "push" : "blackjack");
      const result = dealerValue === 21 ? "push" : "blackjack";
      const hand = player.blackjack;
      player.blackjack = null;
      broadcastBalances(room);
      return cb?.({ ok: true, hand, result, playerValue: value, dealerValue, balance: player.balance, finished: true });
    }

    broadcastBalances(room);
    cb?.({
      ok: true,
      hand: player.blackjack,
      result: "playing",
      playerValue: value,
      dealerVisible: player.blackjack.dealer[0],
      balance: player.balance,
      finished: false
    });
  });

  socket.on("game:blackjack:hit", cb => {
    const active = requireActiveGame(socket, cb);
    if (!active) return;
    const { room, player } = active;
    const bj = player.blackjack;
    if (!bj) return cb?.({ ok: false, error: "No blackjack hand in progress." });

    bj.player.push(card());
    const value = handValue(bj.player);
    if (value > 21) {
      player.blackjack = null;
      broadcastBalances(room);
      return cb?.({ ok: true, hand: bj, result: "bust", playerValue: value, balance: player.balance, finished: true });
    }
    cb?.({ ok: true, hand: bj, result: "playing", playerValue: value, dealerVisible: bj.dealer[0], balance: player.balance, finished: false });
  });

  socket.on("game:blackjack:stand", cb => {
    const active = requireActiveGame(socket, cb);
    if (!active) return;
    const { room, player } = active;
    const bj = player.blackjack;
    if (!bj) return cb?.({ ok: false, error: "No blackjack hand in progress." });

    while (handValue(bj.dealer) < 17) bj.dealer.push(card());
    const pv = handValue(bj.player);
    const dv = handValue(bj.dealer);
    const result = dv > 21 || pv > dv ? "win" : pv === dv ? "push" : "lose";
    settleBlackjack(player, bj.bet, result);
    const hand = bj;
    player.blackjack = null;
    broadcastBalances(room);
    cb?.({ ok: true, hand, result, playerValue: pv, dealerValue: dv, balance: player.balance, finished: true });
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (player) player.connected = false;
    emitRoom(room);
  });
});

function endRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  room.started = false;
  io.to(code).emit("match:end", {
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, balance: Math.round(p.balance * 100) / 100 }))
  });
  emitRoom(room);
}

server.listen(PORT, () => {
  console.log(`Casino Clash running on port ${PORT}`);
});