# Casino Clash

A real-time 2-player browser game using fake credits.

## Features
- Two players on separate devices
- Room code matchmaking
- Both players start at 1,000 credits
- Automatic 3-minute match timer
- Blackjack
- Slots
- Roulette
- Live balance updates
- Winner determined by final balance

## Run locally

1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run:
   npm install
   npm start
4. Open http://localhost:3000

For two devices on the same network, use the computer's local IP instead of localhost.

## Deploy

This is a normal Node/Express + Socket.IO app and can be deployed to a host that supports long-running Node servers and WebSockets. Set the host's start command to:

npm start

The host should provide a PORT environment variable; server.js already uses it.

## Game rules

- Start with 1,000 fictional credits.
- The match begins when two players are in the same room and lasts 3 minutes.
- Blackjack: beat the dealer without exceeding 21; dealer stands on 17; blackjack pays 3:2.
- Slots: two matching symbols pay 2x, three matching symbols pay 5x, three 7s pay 10x.
- Roulette: red/black and odd/even pay 2x; a straight-up number pays 36x.
- At the end of 3 minutes, the higher balance wins.

No real money is used or accepted.