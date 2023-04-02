// Import required libraries
const Discord = require('discord.js');
const mongoose = require('mongoose');
const randomstring = require('randomstring');
const TrueSkill = require('trueskill');

// Initialize Discord client
const client = new Discord.Client();

// Import other required libraries and define variables, functions, and event listeners
// ... your code here ...

// Add the ready event listener
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});


// Define the player schema
const playerSchema = new mongoose.Schema({
  discordId: String,
  elo: Number
});

// Define the game schema
const gameSchema = new mongoose.Schema({
  date: Date,
  time: String,
  creator: playerSchema,
  players: [playerSchema],
  winningTeam: String,
  winningTeamVotes: [String],
  losingTeamVotes: [String],
  status: String,
  team1VoiceChannelId: String,
  team2VoiceChannelId: String
});

// Define the game model
const Game = mongoose.model('Game', gameSchema);

// Define the category ID where game lobbies will be created
const categoryId = 'YOUR_CATEGORY_ID_HERE';

// Define the command prefix
const commandPrefix = '!';

// Define the maximum ELO difference allowed for team balancing
const maxEloDifference = 200;

// Define the delay between lobby creation and game start (in milliseconds)
const lobbyDelay = 10000;

// Define the maximum time allowed for game result reporting (in milliseconds)
const reportTimeLimit = 600000;

// Define the player queue
const playerQueue = [];

// Define the games object
const games = {};

// Function to create a new game lobby and text channel
async function createGameLobby(creator, gameRoom) {
  try {
    // Set permissions for game room
    // Generate lobby password
    const lobbyPassword = randomstring.generate(10);
    // Add creator to game object
    games[gameRoom.id] = {
      creator,
      players: [creator],
      status: 'lobby'
    };
    // Start lobby delay timer
    setTimeout(() => {
      // Check if there are enough players in game
      if (games[gameRoom.id].players.length >= 2) {
        startGame(gameRoom);
      } else {
        // Send message to players that game is cancelled due to not enough players
        delete games[gameRoom.id];
        gameRoom.delete();
      }
    }, lobbyDelay);
    return gameRoom;
  } catch (err) {
    console.error(err);
  }
}
// Function to update ELO after a game
async function updateElo(game) {
  try {
    const team1 = game.team1;
    const team2 = game.team2;
    const result = game.result;

    const team1Ratings = team1.map(player => new TrueSkill.Rating(player.elo));
    const team2Ratings = team2.map(player => new TrueSkill.Rating(player.elo));

    let newTeam1Ratings, newTeam2Ratings;
    if (result === 'team1') {
      [newTeam1Ratings, newTeam2Ratings] = TrueSkill.rate([team1Ratings, team2Ratings]);
    } else if (result === 'team2') {
      [newTeam1Ratings, newTeam2Ratings] = TrueSkill.rate([team1Ratings, team2Ratings], [1, 0]);
    }

    team1.forEach((player, index) => {
      player.elo = newTeam1Ratings[index].mu;
    });

    team2.forEach((player, index) => {
      player.elo = newTeam2Ratings[index].mu;
    });

    // Save updated ELO to the database
    for (const player of team1.concat(team2)) {
      await Player.updateOne({ discordId: player.discordId }, { elo: player.elo });
    }

    // Save voice channel IDs to the database
    await Game.updateOne({ _id: game._id }, { team1VoiceChannelId: game.team1VoiceChannelId, team2VoiceChannelId: game.team2VoiceChannelId });
  } catch (err) {
    console.error(err);
  }
}


// Function to start a game in a game room
async function startGame(gameRoom) {
  try {
    const game = games[gameRoom.id];
    if (game.status === 'lobby') {
      // Set game status to in progress
      game.status = 'in progress';
      // Balance teams by ELO
      const team1 = [];
      const team2 = [];
      const players = game.players;
      players.sort((a, b) => a.elo - b.elo);
      let i = 0;
      while (i < players.length) {
        team1.push(players[i++]);
        team2.push(players[i++]);
      }
      // Check for unbalanced teams
      const eloDifference = Math.abs(team1.reduce((total, player) => total + player.elo, 0) - team2.reduce((total, player) => total + player.elo, 0));
      if (eloDifference > maxEloDifference) {
        // Unbalanced teams, end game
        await endGame(gameRoom, 'unbalanced');
      } else {
        // Send lobby password to players
        // Send team assignments to players
        // Create
        const newGame = new Game({
          date: new Date(),
          time: new Date().toLocaleTimeString(),
          creator: game.creator,
          players: game.players,
          status: 'in progress'
        });
        await newGame.save();
        // Listen for game result reports
        setTimeout(() => checkGameResult(gameRoom), reportTimeLimit);
      }
    }
  } catch (err) {
    console.error(err);
  }
}


// Function to check the result of a game
async function checkGameResult(gameRoom) {
  try {
    const game = games[gameRoom.id];
    if (game.status === 'in progress') {
      // Set game status to on hold
      game.status = 'on hold';
      // Send message to players that game is on hold
      const channel = await client.channels.fetch(gameRoom.id);
      const players = game.players;
      players.forEach(player => {
        channel.send(`<@${player.discordId}> The game is currently on hold. Please wait for further instructions.`);
      });
      // Send message to admin with game details
      const admin = await client.users.fetch(process.env.ADMIN_USER_ID);
      admin.send(`The game in ${channel.name} is currently on hold. Please check the game room for more information.`);
    }
  } catch (err) {
    console.error(err);
  }
}

// Function to end a game in a game room
async function endGame(gameRoom, reason) {
  try {
    const game = games[gameRoom.id];
    if (game) {
      if (reason === 'unbalanced') {
        // Send message to players that game is cancelled due to unbalanced teams
      } else if (reason === 'manual') {
        // Send message to players that game is ended by admin
      }
      // Remove game from games object
      delete games[gameRoom.id];
      // Send message to players that game has ended
      // Update ELO
      await updateElo(game);
      // Delete team voice channels
      const team1VoiceChannel = await gameRoom.guild.channels.resolve(game.team1VoiceChannelId);
      const team2VoiceChannel = await gameRoom.guild.channels.resolve(game.team2VoiceChannelId);
      if (team1VoiceChannel) {
        await team1VoiceChannel.delete();
      }
      if (team2VoiceChannel) {
        await team2VoiceChannel.delete();
      }
    } else {
      // Send error message if game room not found
    }
  } catch (err) {
    console.error(err)
  }
  ;
 


// Listen for commands
client.on('message', async message => {
  try {
    if (!message.content.startsWith(commandPrefix) || message.author.bot) return;

    const args = message.content.slice(commandPrefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'join') {
      // Check if player is already in queue
      // Add player to queue
      // Send message to player that they are added to queue
    } else if (command === 'leave') {
      // Remove player from queue
      // Send message to player that they are removed from queue
    } else if (command === 'startgame') {
      // Check if player is admin
      // Check if there are enough players in queue
      // Get six players from queue
      // Create game lobby
    } else if (command === 'report') {
      // Get game object from message channel
      // Check if game is in progress
      // Get player object from message author
      // Store report in database
      // Send message to moderators that a new report has been filed
    } else if (command === 'reviewreports' && message.member.hasPermission('MANAGE_MESSAGES')) {
      // Fetch reports from database
      // Send message to moderators with the reports
    } else if (command === 'endgame' && message.member.hasPermission('MANAGE_MESSAGES')) {
      // Get game room ID from message content
      // End game in game room
    } else if (command === 'creategame') {
      // Check if player is in queue or game lobby
      // Create game lobby
      // Send message to Discord channel announcing game
      // Add reaction to message for players to join
    }
  } catch (err) {
    console.error(err);
  }
});

// Listen for new members and assign them 1000 ELO
client.on('guildMemberAdd', async member => {
  try {
    const Player = mongoose.model('Player');
    const player = await Player.findOne({ discordId: member.id });
    if (!player) {
      const newPlayer = new Player({
        discordId: member.id,
        elo: 1000
      });
      await newPlayer.save();
    }
  } catch (err) {
    console.error(err);
  }
});


// Listen for game room deletions and end games
client.on('channelDelete', async channel => {
  try {
    const game = games[channel.id];
    if (game) {
      // End game in game room
      await endGame(channel, 'manual');
    }
  } catch (err) {
    console.error(err);
  }
});



// Define the game model
const Game = mongoose.model('Game', gameSchema);

// Define the category ID where game lobbies will be created
const categoryId = 'YOUR_CATEGORY_ID_HERE';

// Define the command prefix
const commandPrefix = '!';

// Define the maximum ELO difference allowed for team balancing
const maxEloDifference = 200;

// Define the delay between lobby creation and game start (in milliseconds)
const lobbyDelay = 10000;

// Define the maximum time allowed for game result reporting (in milliseconds)
const reportTimeLimit = 600000;

// Define the player queue
const playerQueue = [];

// Define the games object
const games = {};

// Function to create a new game lobby and text channel
async function createGameLobby(creator, gameRoom) {
  try {
    // Set permissions for game room
    // Generate lobby password
    const lobbyPassword = randomstring.generate(10);
    // Add creator to game object
    games[gameRoom.id] = {
      creator,
      players: [creator],
      status: 'lobby'
    };
    // Start lobby delay timer
    setTimeout(() => {
      // Check if there are enough players in game
      if (games[gameRoom.id].players.length >= 2) {
        startGame(gameRoom);
      } else {
        // Send message to players that game is cancelled due to not enough players
        delete games[gameRoom.id];
        gameRoom.delete();
      }
    }, lobbyDelay);
    return gameRoom;
  } catch (err) {
    console.error(err);
  }
}
// Function to update ELO after a game
async function updateElo(game) {
  try {
    const team1 = game.team1;
    const team2 = game.team2;
    const result = game.result;

    const team1Ratings = team1.map(player => new TrueSkill.Rating(player.elo));
    const team2Ratings = team2.map(player => new TrueSkill.Rating(player.elo));

    let newTeam1Ratings, newTeam2Ratings;
    if (result === 'team1') {
      [newTeam1Ratings, newTeam2Ratings] = TrueSkill.rate([team1Ratings, team2Ratings]);
    } else if (result === 'team2') {
      [newTeam1Ratings, newTeam2Ratings] = TrueSkill.rate([team1Ratings, team2Ratings], [1, 0]);
    }

    team1.forEach((player, index) => {
      player.elo = newTeam1Ratings[index].mu;
    });

    team2.forEach((player, index) => {
      player.elo = newTeam2Ratings[index].mu;
    });

    // Save updated ELO to the database
    for (const player of team1.concat(team2)) {
      await Player.updateOne({ discordId: player.discordId }, { elo: player.elo });
    }
  } catch (err) {
    console.error(err);
  }
}

// Function to start a game in a game room
async function startGame(gameRoom) {
  try {
    const game = games[gameRoom.id];
    if (game.status === 'lobby') {
      // Set game status to in progress
      game.status = 'in progress';
      // Balance teams by ELO
      const team1 = [];
      const team2 = [];
      const players = game.players;
      players.sort((a, b) => a.elo - b.elo);
      let i = 0;
      while (i < players.length) {
        team1.push(players[i++]);
        team2.push(players[i++]);
      }
      // Check for unbalanced teams
      const eloDifference = Math.abs(team1.reduce((total, player) => total + player.elo, 0) - team2.reduce((total, player) => total + player.elo, 0));
      if (eloDifference > maxEloDifference) {
        // Unbalanced teams, end game
        await endGame(gameRoom, 'unbalanced');
      } else {
        // Create team voice channels
        const category = gameRoom.parent;
        const team1VoiceChannel = await gameRoom.guild.channels.create('Team 1', { type: 'voice', parent: category });
        const team2VoiceChannel = await gameRoom.guild.channels.create('Team 2', { type: 'voice', parent: category });
        // Move players to team voice channels
        for (const player of team1) {
          const member = await gameRoom.guild.members.fetch(player.discordId);
          await member.voice.setChannel(team1VoiceChannel);
        }
        for (const player of team2) {
          const member = await gameRoom.guild.members.fetch(player.discordId);
          await member.voice.setChannel(team2VoiceChannel);
        }
        // Send lobby password to players
        // Send team assignments to players
        // Create
        const newGame = new Game({
          date: new Date(),
          time: new Date().toLocaleTimeString(),
          creator: game.creator,
          players: game.players,
          team1VoiceChannelId: team1VoiceChannel.id,
          team2VoiceChannelId: team2VoiceChannel.id,
          status: 'in progress'
        });
        await newGame.save();
        // Listen for game result reports
        setTimeout(() => checkGameResult(gameRoom), reportTimeLimit);
      }
    }
  } catch (err) {
    console.error(err);
  }
}




async function checkGameResult(gameRoom) {
  try {
    const game = games[gameRoom.id];
    if (game.status === 'in progress') {
      // Set game status to on hold
      game.status = 'on hold';
      // Send message to players that game is on hold
      const channel = await client.channels.fetch(gameRoom.id);
      const players = game.players;
      players.forEach(player => {
        channel.send(`<@${player.discordId}> The game is currently on hold. Please wait for further instructions.`);
      });
      // Send message to admin with game details
      const admin = await client.users.fetch(process.env.ADMIN_USER_ID);
      admin.send(`The game in ${channel.name} is currently on hold. Please check the game room for more information.`);
      // Listen for game result reports
      const resultReactions = ['🇦', '🇧'];
      const resultCounts = { '🇦': 0, '🇧': 0 };
      const resultCollector = channel.createMessageCollector({
        filter: msg => msg.author.bot === false && resultReactions.includes(msg.content),
        time: reportTimeLimit,
        max: players.length
      });
      resultCollector.on('collect', msg => {
        resultCounts[msg.content]++;
        if (resultCounts['🇦'] + resultCounts['🇧'] === players.length) {
          resultCollector.stop();
        }
      });
      resultCollector.on('end', async collected => {
        let result = '';
        if (resultCounts['🇦'] >= 4) {
          result = 'team1';
        } else if (resultCounts['🇧'] >= 4) {
          result = 'team2';
        } else {
          await endGame(gameRoom, 'unresolved');
          return;
        }
        // Update game object with result
        game.result = result;
        // Send message to players with game result
        const team1Players = game.team1.map(player => `<@${player.discordId}>`);
        const team2Players = game.team2.map(player => `<@${player.discordId}>`);
        channel.send(`Team 1: ${team1Players.join(', ')}\nTeam 2: ${team2Players.join(', ')}\n\nThe game has ended, with ${result === 'team1' ? 'Team 1' : 'Team 2'} winning!`);
        // Update ELO
        await updateElo(game);
      });
    }
  } catch (err) {
    console.error(err);
  }
}


// Function to end a game in a game room
async function endGame(gameRoom, reason) {
  try {
    const game = games[gameRoom.id];
    if (game) {
      if (reason === 'unbalanced') {
        // Send message to players that game is cancelled due to unbalanced teams
      } else if (reason === 'manual') {
        // Send message to players that game is ended by admin
      }
      // Remove game from games object
      delete games[gameRoom.id];
      // Send message to players that game has ended
      // Update ELO
      await updateElo(game);
    } else {
      // Send error message if game room not found
    }
  } catch (err) {
    console.error(err);
  }
}

// Listen for commands
client.on('message', async message => {
  try {
    if (!message.content.startsWith(commandPrefix) || message.author.bot) return;

    const args = message.content.slice(commandPrefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'join') {
      // Check if player is already in queue
      // Add player to queue
      // Send message to player that they are added to queue
    } else if (command === 'leave') {
      // Remove player from queue
      // Send message to player that they are removed from queue
    } else if (command === 'startgame') {
      // Check if player is admin
      // Check if there are enough players in queue
      // Get six players from queue
      // Create game lobby
    } else if (command === 'report') {
      // Get game object from message channel
      // Check if game is in progress
      // Get player object from message author
      // Store report in database
      // Send message to moderators that a new report has been filed
    } else if (command === 'reviewreports' && message.member.hasPermission('MANAGE_MESSAGES')) {
      // Fetch reports from database
      // Send message to moderators with the reports
    } else if (command === 'endgame' && message.member.hasPermission('MANAGE_MESSAGES')) {
      // Get game room ID from message content
      // End game in game room
    } else if (command === 'creategame') {
      // Check if player is in queue or game lobby
      // Create game lobby
      // Send message to Discord channel announcing game
      // Add reaction to message for players to join
    }
  } catch (err) {
    console.error(err);
  }
});

// Listen for new members and assign them 1000 ELO
client.on('guildMemberAdd', async member => {
  try {
    const Player = mongoose.model('Player');
    const player = await Player.findOne({ discordId: member.id });
    if (!player) {
      const newPlayer = new Player({
        discordId: member.id,
        elo: 1000
      });
      await newPlayer.save();
    }
  } catch (err) {
    console.error(err);
  }
});


// Listen for game room deletions and end games
client.on('channelDelete', async channel => {
  try {
    const game = games[channel.id];
    if (game) {
      // End game in game room
      await endGame(channel, 'manual');
    }
  } catch (err) {
    console.error(err);
  }
});

// Log in to Discord
client.login('MTA5MTg3ODgwNTU4NjU4MzY3Mg.GW8asC.r9jZvI0-99G_OXrl-KsTJjguBpkIAKM7KXtteA');

}
