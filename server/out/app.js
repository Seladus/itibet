"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const crypto = require("crypto");
const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
var State;
(function (State) {
    State[State["OPEN"] = 0] = "OPEN";
    State[State["IN_PROGRESS"] = 1] = "IN_PROGRESS";
    State[State["CLOSED"] = 2] = "CLOSED";
})(State || (State = {}));
class Player {
    constructor(playerId, id, name, coins, isOwner) {
        this.playerId = playerId;
        this.name = name;
        this.coins = coins;
        this.isOwner = isOwner;
        this.id = id;
    }
    getInformations() {
        return {
            id: this.id,
            isOwner: this.isOwner,
            name: this.name,
            coins: this.coins,
        };
    }
}
class Team {
    constructor(name) {
        this.players = {};
        this.name = name;
    }
    isPlayerInTeam(playerId) {
        return playerId in this.players;
    }
    clear() {
        this.players = {};
    }
    addPlayerBet(player, bet) {
        this.players[player.playerId] = bet;
    }
    removePlayerBet(playerId) {
        delete this.players[playerId];
    }
    computeSum() {
        let sum = 0;
        for (let player in this.players) {
            sum += this.players[player];
        }
        return sum;
    }
}
class BetManager {
    constructor(managers, io) {
        this.players = {};
        this.rating = 1;
        this.state = State.CLOSED;
        this.managerId = this.generateID(managers);
        this.red = new Team("Red");
        this.blue = new Team("Blue");
        this.baseCoins = 100;
        this.socket = io;
    }
    cashout(winners, losers) {
        const winnersSum = winners.computeSum();
        const losersSum = losers.computeSum();
        if (this.rating !== 0) {
            for (let player in winners.players) {
                this.players[player].coins +=
                    winnersSum < losersSum
                        ? Math.round(winners.players[player] * this.rating)
                        : Math.round(winners.players[player] / this.rating);
            }
        }
        for (let player in losers.players) {
            this.players[player].coins -= losers.players[player];
            if (this.players[player].coins === 0) {
                this.players[player].coins = this.baseCoins;
            }
        }
    }
    computeRating(red, blue) {
        let redSum = red.computeSum();
        let blueSum = blue.computeSum();
        if (redSum > 0 && blueSum > 0) {
            return (Math.round((Math.max(redSum, blueSum) / Math.min(redSum, blueSum)) * 100) / 100);
        }
        else {
            return 0;
        }
    }
    placeBet(userId, value, team) {
        if (value <= this.players[userId].coins && value > 0) {
            this.red.removePlayerBet(userId);
            this.blue.removePlayerBet(userId);
            if (team === "red") {
                this.red.addPlayerBet(this.players[userId], value);
                console.log(`Player ${this.players[userId].name}#${userId} placed a ${value} coins bet for team ${team} in room ${this.managerId} `);
                return true;
            }
            else if (team === "blue") {
                console.log(`Player ${this.players[userId].name}#${userId} placed a ${value} coins bet for team ${team} in room ${this.managerId} `);
                this.blue.addPlayerBet(this.players[userId], value);
                this.askForUpdate();
                return true;
            }
            else {
                return false;
            }
        }
        else {
            return false;
        }
    }
    join(username) {
        const id = this.generatePlayerID();
        this.players[id] = new Player(id, Object.keys(this.players).length, username, this.baseCoins, Object.keys(this.players).length == 0);
        console.log(`Player ${username}#${id} joins room ${this.managerId}`);
        this.askForUpdate();
        return this.players[id];
    }
    askForUpdate() {
        this.socket.to(this.managerId).emit("update", {});
    }
    generateID(managers) {
        let id;
        do {
            id = crypto.randomBytes(8).toString("hex");
        } while (id in managers);
        return id;
    }
    generatePlayerID() {
        let id;
        do {
            id = crypto.randomBytes(4).toString("hex");
        } while (id in this.players);
        return id;
    }
    startBettingPhase() {
        console.log(`[${this.managerId}] Starting betting phase.`);
        this.state = State.OPEN;
        this.red.clear();
        this.blue.clear();
        this.askForUpdate();
        this.rating = 1;
    }
    endBettingPhase() {
        this.state = State.IN_PROGRESS;
        this.rating = this.computeRating(this.red, this.blue);
        const leaderIsRed = this.red.computeSum() > this.blue.computeSum();
        const betIsPlayed = this.red.computeSum() > 0 || this.blue.computeSum() > 0;
        let rc = 0;
        let rb = 0;
        if (leaderIsRed && betIsPlayed) {
            rc = this.rating === 0 ? 1 : this.rating;
            rb = this.rating === 0 ? this.rating : 1;
        }
        else if (betIsPlayed) {
            rc = this.rating !== 0 ? 1 : this.rating;
            rb = this.rating !== 0 ? this.rating : 1;
        }
        console.log(`[${this.managerId}] Ending betting phase with rating of (Red)${rc}:${rb}(Blue).`);
        this.askForUpdate();
    }
    closeBet(team) {
        console.log(`[${this.managerId}] Closing bet. Cashout to team ${team}`);
        if (team === "red") {
            this.cashout(this.red, this.blue);
        }
        else if (team === "blue") {
            this.cashout(this.blue, this.red);
        }
        this.red.clear();
        this.blue.clear();
        this.state = State.CLOSED;
        this.rating = 1;
        this.askForUpdate();
    }
    getLeaderBoard() {
        let playersList = [];
        for (let player in this.players) {
            playersList.push(this.players[player].getInformations());
        }
        playersList.sort((x, y) => x.coins - y.coins);
        return playersList;
    }
    getInformations() {
        const players = {};
        for (const player in this.players) {
            players[this.players[player].id] = this.players[player].getInformations();
        }
        const leaderBoard = this.getLeaderBoard();
        if (this.state == State.OPEN) {
            return {
                managerId: this.managerId,
                state: this.state,
                players: players,
                leaderBoard: leaderBoard,
            };
        }
        else if (this.state == State.IN_PROGRESS) {
            return {
                managerId: this.managerId,
                state: this.state,
                players: players,
                red: this.red,
                blue: this.blue,
                rating: this.rating,
                leaderBoard: leaderBoard,
            };
        }
        else if (this.state == State.CLOSED) {
            return {
                managerId: this.managerId,
                state: this.state,
                players: players,
                leaderBoard: leaderBoard,
            };
        }
    }
}
//setting middleware
app.use(express.json());
app.use(express.static(path_1.default.join(__dirname, "/../../client/src/public/js"))); //Serves resources from public folder
app.use(express.static(path_1.default.join(__dirname, "/../../client/public/html"))); //Serves resources from public folder
console.log(path_1.default.join(__dirname, "/../../client/public/src/js"));
console.log(__dirname + "/../client/public/html");
// sendFile will go here
app.get("/", function (req, res) {
    res.sendFile(path_1.default.join(__dirname, "/../../client/public/html/index.html"));
});
app.get("/play/identification/", function (req, res) {
    res.sendFile(path_1.default.join(__dirname, "/../../client/public/html/identification.html"));
});
app.get("/play", function (req, res) {
    res.sendFile(path_1.default.join(__dirname, "/../../client/public/html/play.html"));
});
const managers = {};
app.post("/room/create", function (req, res) {
    const newRoom = new BetManager(managers, io);
    console.log(`Creating room ${newRoom.managerId}`);
    managers[newRoom.managerId] = newRoom;
    res.send({ roomId: newRoom.managerId });
});
app.get("/room/:roomId", function (req, res) {
    if (req.params.roomId in managers) {
        res.status(200).send(managers[req.params.roomId].getInformations());
    }
    else {
        res.status(404).send("404 : Not found");
    }
});
app.post("/room/:roomId/join", function (req, res) {
    if ("username" in req.query && req.params.roomId in managers) {
        const newPlayer = managers[req.params.roomId].join(req.query.username);
        res.send(newPlayer);
    }
    else {
        res.status(400).send("400 : Bad request");
    }
});
app.post("/room/:roomId/bet/betting/start", function (req, res) {
    const room = managers[req.params.roomId];
    if ("userid" in req.query && room.players[req.query.userid].isOwner) {
        if (room.state == State.CLOSED) {
            room.startBettingPhase();
            res.send();
        }
        else {
            res.status(403).send("403 : Forbidden");
        }
    }
    else {
        res.status(403).send("403 : Forbidden");
    }
});
app.post("/room/:roomId/bet/betting/end", function (req, res) {
    const room = managers[req.params.roomId];
    if ("userid" in req.query && room.players[req.query.userid].isOwner) {
        if (room.state == State.OPEN) {
            room.endBettingPhase();
            res.send();
        }
        else {
            res.status(403).send("403 : Forbidden");
        }
    }
    else {
        res.status(403).send("403 : Forbidden");
    }
});
app.post("/room/:roomId/bet/close", function (req, res) {
    const room = managers[req.params.roomId];
    if ("userid" in req.query &&
        "team" in req.query &&
        room.players[req.query.userid].isOwner) {
        if (req.query.team === "red" ||
            req.query.team === "blue" ||
            req.query.team === "neutral") {
            if (room.state == State.IN_PROGRESS) {
                room.closeBet(req.query.team);
                res.send();
            }
            else {
                res.status(403).send("403 : Forbidden");
            }
        }
        else {
            res.status(400).send("400 : Bad request");
        }
    }
    else {
        res.status(403).send("403 : Forbidden");
    }
});
app.put("/room/:roomId/bet/place", function (req, res) {
    const room = managers[req.params.roomId];
    if (room.state == State.OPEN) {
        if ("userid" in req.query && "bet" in req.query && "team" in req.query) {
            if (req.query.userid in room.players &&
                (req.query.team == "red" || req.query.team == "blue")) {
                if (room.placeBet(req.query.userid, parseInt(req.query.bet, 10), req.query.team)) {
                    res.send("Bet placed");
                }
                else {
                    res.status(400).send("400 : Bad request");
                }
            }
            else {
                res.status(400).send("400 : Bad request");
            }
        }
    }
    else {
        res.status(403).send("403 : Bets are closed");
    }
});
io.on("connection", (socket) => {
    socket.on("join", function (data) {
        console.log(`User connected via websocket in room ${data.roomId}`);
        socket.join(data.roomId);
    }.bind(socket));
});
server.listen(8080);
