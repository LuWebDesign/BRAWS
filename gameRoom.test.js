const test = require('node:test');
const assert = require('node:assert/strict');
const { GameRoom } = require('./gameRoom');

function createRoom() {
  const events = [];
  const io = {
    to: () => ({
      emit: (name, payload) => events.push({ name, payload }),
    }),
  };
  const room = new GameRoom('TEST', {
    name: 'Test',
    maxPlayers: 2,
    isPrivate: true,
    hostId: 'p1',
    hostName: 'P1',
    io,
  });
  room.addPlayer({ id: 'p1' }, {
    nickname: 'P1',
    skin: { color: '#fff', botClass: 'brawler' },
  });
  room.addPlayer({ id: 'p2' }, {
    nickname: 'P2',
    skin: { color: '#000', botClass: 'brawler' },
  });
  return { room, events };
}

test('procesa inputs en orden y acusa el último seq procesado', () => {
  const { room, events } = createRoom();

  room.handleInput('p1', { seq: 0, dx: 1, dy: 0, action: false });
  room.handleInput('p1', { seq: 1, dx: 0, dy: 1, action: false });
  room.handleInput('p1', { seq: 0, dx: -1, dy: 0, action: false });
  room.processInputs(1 / 60, Date.now());
  room.broadcastState(Date.now());

  const snapshot = events.at(-1).payload;
  const player = snapshot.players.find(({ id }) => id === 'p1');

  assert.equal(player.lastProcessedInput, 1);
  assert.deepEqual(room.inputs.get('p1'), { dx: 0, dy: 1, action: false });
  assert.equal(room.inputQueue.pendingCount('p1'), 0);

  room.destroy();
});

test('rechaza inputs sin sequence number válido', () => {
  const { room } = createRoom();

  room.handleInput('p1', { dx: 1, dy: 0, action: false });
  room.processInputs(1 / 60, Date.now());

  assert.equal(room.inputQueue.lastProcessedInput('p1'), -1);
  assert.equal(room.inputQueue.pendingCount('p1'), 0);

  room.destroy();
});
