import path from "path";
import { Socket } from "socket.io";

const crypto = require("crypto");
const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

enum State {
  OPEN,
  IN_PROGRESS,
  CLOSED,
}

class Player {
  public isOwner: boolean;
  public playerId: string;
  public id: number;
  public name: string;
  public coins: number;
  constructor(
    playerId: string,
    id: number,
    name: string,
    coins: number,
    isOwner: boolean
  ) {
    this.playerId = playerId;
    this.name = name;
    this.coins = coins;
    this.isOwner = isOwner;
    this.id = id;
  }

  public getInformations() {
    return {
      id: this.id,
      isOwner: this.isOwner,
      name: this.name,
      coins: this.coins,
    };
  }
}

class Team {
  public players: { [playerId: number]: number } = {};
  public name: string;
  constructor(name: string) {
    this.name = name;
  }

  public isPlayerInTeam(id): boolean {
    return id in this.players;
  }

  public clear() {
    this.players = {};
  }

  public addPlayerBet(player: Player, bet: number) {
    this.players[player.id] = bet;
  }

  public removePlayerBet(id: number) {
    delete this.players[id];
  }

  public computeSum() {
    let sum = 0;
    for (let player in this.players) {
      sum += this.players[player];
    }
    return sum;
  }
}

class BetManager {
  public managerId: string;
  public baseCoins: number;
  public state: State;
  public red: Team;
  public blue: Team;
  public players: { [playerId: string]: Player } = {};
  private socket: any;
  public rating = 1;
  private rr = 0;
  private rb = 0;

  constructor(managers: { [managerId: string]: BetManager }, io: any) {
    this.state = State.CLOSED;
    this.managerId = this.generateID(managers);
    this.red = new Team("Red");
    this.blue = new Team("Blue");
    this.baseCoins = 100;
    this.socket = io;
  }

  private getIdByPlayerId(playerId: string) {
    for (const player in this.players) {
      if (player === playerId) {
        return this.players[player].id;
      }
    }
  }

  private getPlayerIdById(id: number) {
    for (const player in this.players) {
      if (this.players[player].id === id) {
        return this.players[player].playerId;
      }
    }
  }

  public cashout(winners: Team, losers: Team) {
    const winnersSum = winners.computeSum();
    const losersSum = losers.computeSum();

    if (this.rating !== 0) {
      for (let player in winners.players) {
        const pId = this.getPlayerIdById(parseInt(player));
        this.players[pId].coins +=
          winnersSum < losersSum
            ? Math.round(winners.players[player] * this.rating)
            : Math.round(winners.players[player] / this.rating);
      }
    }

    for (let player in losers.players) {
      const pId = this.getPlayerIdById(parseInt(player));
      this.players[pId].coins -= losers.players[player];
      if (this.players[pId].coins === 0) {
        this.players[pId].coins = this.baseCoins;
      }
    }
  }

  public computeRating(red: Team, blue: Team): number {
    let redSum = red.computeSum();

    let blueSum = blue.computeSum();

    if (redSum > 0 && blueSum > 0) {
      return (
        Math.round(
          (Math.max(redSum, blueSum) / Math.min(redSum, blueSum)) * 100
        ) / 100
      );
    } else {
      return 0;
    }
  }

  public placeBet(userId: string, value: number, team: string): boolean {
    const id = this.getIdByPlayerId(userId);
    if (value <= this.players[userId].coins && value > 0) {
      this.red.removePlayerBet(id);
      this.blue.removePlayerBet(id);
      if (team === "red") {
        this.red.addPlayerBet(this.players[userId], value);
        console.log(
          `Player ${this.players[userId].name}#${userId} placed a ${value} coins bet for team ${team} in room ${this.managerId} `
        );
        this.askForUpdate();
        return true;
      } else if (team === "blue") {
        console.log(
          `Player ${this.players[userId].name}#${userId} placed a ${value} coins bet for team ${team} in room ${this.managerId} `
        );
        this.blue.addPlayerBet(this.players[userId], value);
        this.askForUpdate();
        return true;
      } else {
        return false;
      }
    } else {
      return false;
    }
  }

  public join(username: string): Player {
    const id = this.generatePlayerID();
    this.players[id] = new Player(
      id,
      Object.keys(this.players).length,
      username,
      this.baseCoins,
      Object.keys(this.players).length == 0
    );
    console.log(`Player ${username}#${id} joins room ${this.managerId}`);
    this.askForUpdate();
    return this.players[id];
  }

  public askForUpdate() {
    this.socket.to(this.managerId).emit("update", {});
  }

  private generateID(managers: { [managerId: string]: BetManager }): string {
    let id;
    do {
      id = crypto.randomBytes(8).toString("hex");
    } while (id in managers);
    return id;
  }

  private generatePlayerID(): string {
    let id;
    do {
      id = crypto.randomBytes(4).toString("hex");
    } while (id in this.players);
    return id;
  }

  public startBettingPhase() {
    console.log(`[${this.managerId}] Starting betting phase.`);
    this.state = State.OPEN;
    this.red.clear();
    this.blue.clear();
    this.askForUpdate();
    this.rating = 1;
  }

  public endBettingPhase() {
    this.state = State.IN_PROGRESS;
    this.rating = this.computeRating(this.red, this.blue);
    const leaderIsRed = this.red.computeSum() > this.blue.computeSum();
    const betIsPlayed = this.red.computeSum() > 0 || this.blue.computeSum() > 0;
    let rc = 0;
    let rb = 0;
    if (leaderIsRed && betIsPlayed) {
      rc = this.rating === 0 ? 1 : this.rating;
      rb = this.rating === 0 ? this.rating : 1;
    } else if (betIsPlayed) {
      rc = this.rating !== 0 ? 1 : this.rating;
      rb = this.rating !== 0 ? this.rating : 1;
    }
    this.rr = rc;
    this.rb = rb;
    console.log(
      `[${this.managerId}] Ending betting phase with rating of (Red)${rc}:${rb}(Blue).`
    );
    this.askForUpdate();
  }

  public closeBet(team: string) {
    console.log(`[${this.managerId}] Closing bet. Cashout to team ${team}`);
    if (team === "red") {
      this.cashout(this.red, this.blue);
    } else if (team === "blue") {
      this.cashout(this.blue, this.red);
    }
    this.red.clear();
    this.blue.clear();
    this.state = State.CLOSED;
    this.rating = 1;
    this.askForUpdate();
  }

  public getLeaderBoard() {
    let playersList: {
      id: number;
      isOwner: boolean;
      name: string;
      coins: number;
    }[] = [];
    for (let player in this.players) {
      playersList.push(this.players[player].getInformations());
    }
    playersList.sort((x, y) => y.coins - x.coins);
    return playersList;
  }

  public getInformations() {
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
        red: this.red,
        blue: this.blue,
      };
    } else if (this.state == State.IN_PROGRESS) {
      return {
        managerId: this.managerId,
        state: this.state,
        players: players,
        red: this.red,
        blue: this.blue,
        ratingBlue: this.rb,
        ratingRed: this.rr,
        leaderBoard: leaderBoard,
      };
    } else if (this.state == State.CLOSED) {
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
app.use(
  express.static(path.join(__dirname, "public"), { extensions: ["html"] })
); //Serves resources from public folder
// app.use(express.static(path.join(__dirname, '/../../client/public/html'))); //Serves resources from public folder

// console.log(path.join(__dirname, '/../../client/public/src/js'));
// console.log(__dirname + '/../client/public/html');

// // sendFile will go here
// app.get('/', function (req: any, res: any) {
//   res.sendFile(path.join(__dirname, '/../../client/public/html/index.html'));
// });

// app.get('/play/identification/', function (req: any, res: any) {
//   res.sendFile(
//     path.join(__dirname, '/../../client/public/html/identification.html')
//   );
// });

// app.get('/play', function (req: any, res: any) {
//   res.sendFile(path.join(__dirname, '/../../client/public/html/play.html'));
// });

const managers: { [managerId: string]: BetManager } = {};

app.post("/room/create", function (req: any, res: any) {
  const newRoom = new BetManager(managers, io);
  console.log(`Creating room ${newRoom.managerId}`);
  managers[newRoom.managerId] = newRoom;
  res.send({ roomId: newRoom.managerId });
});

app.get("/room/:roomId", function (req: any, res: any) {
  if (req.params.roomId in managers) {
    res.status(200).send(managers[req.params.roomId].getInformations());
  } else {
    res.status(404).send("404 : Not found");
  }
});

app.post("/room/:roomId/join", function (req: any, res: any) {
  if ("username" in req.query && req.params.roomId in managers) {
    const newPlayer = managers[req.params.roomId].join(req.query.username);
    res.send(newPlayer);
  } else {
    res.status(400).send("400 : Bad request");
  }
});

app.post("/room/:roomId/bet/betting/start", function (req: any, res: any) {
  const room = managers[req.params.roomId];
  if ("userid" in req.query && room.players[req.query.userid].isOwner) {
    if (room.state == State.CLOSED) {
      room.startBettingPhase();
      res.send();
    } else {
      res.status(403).send("403 : Forbidden");
    }
  } else {
    res.status(403).send("403 : Forbidden");
  }
});

app.post("/room/:roomId/bet/betting/end", function (req: any, res: any) {
  const room = managers[req.params.roomId];
  if ("userid" in req.query && room.players[req.query.userid].isOwner) {
    if (room.state == State.OPEN) {
      room.endBettingPhase();
      res.send();
    } else {
      res.status(403).send("403 : Forbidden");
    }
  } else {
    res.status(403).send("403 : Forbidden");
  }
});

app.post("/room/:roomId/bet/close", function (req: any, res: any) {
  const room = managers[req.params.roomId];
  if (
    "userid" in req.query &&
    "team" in req.query &&
    room.players[req.query.userid].isOwner
  ) {
    if (
      req.query.team === "red" ||
      req.query.team === "blue" ||
      req.query.team === "neutral"
    ) {
      if (room.state == State.IN_PROGRESS) {
        room.closeBet(req.query.team);
        res.send();
      } else {
        res.status(403).send("403 : Forbidden");
      }
    } else {
      res.status(400).send("400 : Bad request");
    }
  } else {
    res.status(403).send("403 : Forbidden");
  }
});

app.put("/room/:roomId/bet/place", function (req: any, res: any) {
  const room = managers[req.params.roomId];
  if (room.state == State.OPEN) {
    if ("userid" in req.query && "bet" in req.query && "team" in req.query) {
      if (
        req.query.userid in room.players &&
        (req.query.team == "red" || req.query.team == "blue")
      ) {
        if (
          room.placeBet(
            req.query.userid,
            parseInt(req.query.bet, 10),
            req.query.team
          )
        ) {
          res.send("Bet placed");
        } else {
          res.status(400).send("400 : Bad request");
        }
      } else {
        res.status(400).send("400 : Bad request");
      }
    }
  } else {
    res.status(403).send("403 : Bets are closed");
  }
});

io.on("connection", (socket: Socket) => {
  socket.on(
    "join",
    function (data) {
      console.log(`User connected via websocket in room ${data.roomId}`);
      socket.join(data.roomId);
    }.bind(socket)
  );
});

server.listen(8080);
