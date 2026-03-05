const COLS = 6;
const ROWS = 12;
const CELL = 60;
const FPS = 60;
const BASE_FALL_FRAMES = 40;
const SOFT_DROP_FRAMES = 3;
const COLORS = ['#ff595e', '#1982c4', '#8ac926', '#ffca3a'];

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const chainEl = document.getElementById('chain');
const overlay = document.getElementById('overlay');
const next1Canvas = document.getElementById('next1');
const next2Canvas = document.getElementById('next2');
const next1Ctx = next1Canvas.getContext('2d');
const next2Ctx = next2Canvas.getContext('2d');

const state = {
  board: createBoard(),
  active: null,
  queue: [],
  score: 0,
  chain: 0,
  frame: 0,
  softDrop: false,
  paused: false,
  gameOver: false,
  settling: false,
  settleFlash: 0,
  clearEffect: [],
};

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function randomColor() {
  return 1 + Math.floor(Math.random() * COLORS.length);
}

function makePair() {
  return { a: randomColor(), b: randomColor() };
}

function refillQueue() {
  while (state.queue.length < 4) {
    state.queue.push(makePair());
  }
}

function spawnPair() {
  refillQueue();
  const pair = state.queue.shift();
  state.active = {
    x: 2,
    y: 1,
    rot: 0,
    colors: [pair.a, pair.b],
    lockDelay: 0,
  };
  if (!canPlace(state.active.x, state.active.y, state.active.rot)) {
    setGameOver();
  }
}

function partnerOffset(rot) {
  if (rot === 0) return [0, -1];
  if (rot === 1) return [1, 0];
  if (rot === 2) return [0, 1];
  return [-1, 0];
}

function occupiedCells(x, y, rot, colors) {
  const [dx, dy] = partnerOffset(rot);
  return [
    { x, y, c: colors[0] },
    { x: x + dx, y: y + dy, c: colors[1] },
  ];
}

function inside(x, y) {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}

function canPlace(x, y, rot) {
  const cells = occupiedCells(x, y, rot, state.active?.colors ?? [1, 1]);
  for (const cell of cells) {
    if (!inside(cell.x, cell.y)) return false;
    if (state.board[cell.y][cell.x] !== 0) return false;
  }
  return true;
}

function move(dx, dy) {
  if (!state.active || state.paused || state.gameOver || state.settling) return false;
  const nx = state.active.x + dx;
  const ny = state.active.y + dy;
  if (canPlace(nx, ny, state.active.rot)) {
    state.active.x = nx;
    state.active.y = ny;
    return true;
  }
  return false;
}

function rotate(dir) {
  if (!state.active || state.paused || state.gameOver || state.settling) return;
  const targetRot = (state.active.rot + (dir > 0 ? 1 : 3)) % 4;
  const kicks = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, -1],
    [0, 1],
  ];
  for (const [kx, ky] of kicks) {
    const nx = state.active.x + kx;
    const ny = state.active.y + ky;
    if (canPlace(nx, ny, targetRot)) {
      state.active.x = nx;
      state.active.y = ny;
      state.active.rot = targetRot;
      return;
    }
  }
}

function lockActive() {
  const cells = occupiedCells(state.active.x, state.active.y, state.active.rot, state.active.colors);
  for (const cell of cells) {
    if (inside(cell.x, cell.y)) {
      state.board[cell.y][cell.x] = cell.c;
    }
  }
  state.active = null;
  state.settling = true;
  resolveBoard().then(() => {
    state.settling = false;
    spawnPair();
  });
}

async function resolveBoard() {
  state.chain = 0;
  let hadClear = false;

  while (true) {
    const moved = applyGravityStep();
    if (moved) {
      await sleep(55);
      continue;
    }

    const groups = findClearGroups();
    if (groups.length === 0) break;

    hadClear = true;
    state.chain += 1;
    chainEl.textContent = state.chain;
    const removed = clearGroups(groups);
    const chainBonus = state.chain * state.chain * 10;
    state.score += removed * 10 + chainBonus;
    scoreEl.textContent = state.score;
    await playClearEffect(groups);
  }

  if (!hadClear) {
    chainEl.textContent = '0';
  }
}

function applyGravityStep() {
  let moved = false;
  for (let y = ROWS - 2; y >= 0; y -= 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (state.board[y][x] !== 0 && state.board[y + 1][x] === 0) {
        state.board[y + 1][x] = state.board[y][x];
        state.board[y][x] = 0;
        moved = true;
      }
    }
  }
  return moved;
}

function findClearGroups() {
  const visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const groups = [];

  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const color = state.board[y][x];
      if (!color || visited[y][x]) continue;

      const queue = [[x, y]];
      const group = [];
      visited[y][x] = true;

      while (queue.length) {
        const [cx, cy] = queue.pop();
        group.push([cx, cy]);
        const neighbors = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];

        for (const [nx, ny] of neighbors) {
          if (!inside(nx, ny) || visited[ny][nx]) continue;
          if (state.board[ny][nx] === color) {
            visited[ny][nx] = true;
            queue.push([nx, ny]);
          }
        }
      }

      if (group.length >= 4) groups.push(group);
    }
  }

  return groups;
}

function clearGroups(groups) {
  let removed = 0;
  state.clearEffect = [];
  for (const group of groups) {
    for (const [x, y] of group) {
      state.board[y][x] = 0;
      state.clearEffect.push({ x, y, ttl: 18 });
      removed += 1;
    }
  }
  return removed;
}

async function playClearEffect() {
  for (let i = 0; i < 10; i += 1) {
    state.settleFlash = i;
    await sleep(24);
  }
  state.settleFlash = 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setGameOver() {
  state.gameOver = true;
  overlay.textContent = 'GAME OVER';
  overlay.classList.remove('hidden');
}

function drawPuyo(context, px, py, colorIndex, alpha = 1) {
  const color = COLORS[colorIndex - 1];
  context.save();
  context.globalAlpha = alpha;
  context.translate(px, py);

  const g = context.createRadialGradient(CELL * 0.3, CELL * 0.3, CELL * 0.1, CELL * 0.5, CELL * 0.5, CELL * 0.6);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.18, '#fff9');
  g.addColorStop(0.22, color);
  g.addColorStop(1, '#1117');

  context.fillStyle = g;
  context.beginPath();
  context.arc(CELL / 2, CELL / 2, CELL * 0.45, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

function drawBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const boardTop = 70;
  ctx.fillStyle = '#0a1534';
  ctx.fillRect(0, boardTop, COLS * CELL, ROWS * CELL);

  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const px = x * CELL;
      const py = boardTop + y * CELL;

      ctx.strokeStyle = '#223a72';
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);

      if (state.board[y][x]) {
        drawPuyo(ctx, px, py, state.board[y][x]);
      }
    }
  }

  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = '#ff9eb4';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, boardTop + CELL);
  ctx.lineTo(COLS * CELL, boardTop + CELL);
  ctx.stroke();
  ctx.setLineDash([]);

  if (state.active) {
    const cells = occupiedCells(state.active.x, state.active.y, state.active.rot, state.active.colors);
    for (const c of cells) {
      drawPuyo(ctx, c.x * CELL, boardTop + c.y * CELL, c.c);
    }
  }

  const effectAlpha = Math.max(0, (10 - state.settleFlash) / 10) * 0.7;
  for (const fx of state.clearEffect) {
    drawPuyo(ctx, fx.x * CELL, boardTop + fx.y * CELL, 1 + ((fx.x + fx.y) % COLORS.length), effectAlpha);
  }

  ctx.fillStyle = '#9fb7ff';
  ctx.font = '24px sans-serif';
  ctx.fillText('TSU RULE FIELD 6x12', 10, 35);
}

function drawNext(canvasCtx, pair) {
  canvasCtx.clearRect(0, 0, 120, 160);
  if (!pair) return;

  const size = 44;
  const offsetX = 38;
  const offsetY = 22;

  for (let i = 0; i < 2; i += 1) {
    const color = pair[i];
    canvasCtx.save();
    canvasCtx.translate(offsetX, offsetY + i * (size + 8));
    const grad = canvasCtx.createRadialGradient(size * 0.3, size * 0.3, 2, size * 0.45, size * 0.45, size * 0.42);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.2, COLORS[color - 1]);
    grad.addColorStop(1, '#1118');
    canvasCtx.fillStyle = grad;
    canvasCtx.beginPath();
    canvasCtx.arc(size * 0.45, size * 0.45, size * 0.4, 0, Math.PI * 2);
    canvasCtx.fill();
    canvasCtx.restore();
  }
}

function update() {
  if (state.paused || state.gameOver || state.settling || !state.active) return;
  const fallFrames = state.softDrop ? SOFT_DROP_FRAMES : BASE_FALL_FRAMES;

  if (state.frame % fallFrames === 0) {
    if (!move(0, 1)) {
      state.active.lockDelay += 1;
      if (state.active.lockDelay >= 2) {
        lockActive();
      }
    } else {
      state.active.lockDelay = 0;
    }
  }
}

function render() {
  drawBoard();
  drawNext(next1Ctx, state.queue[0] ? [state.queue[0].a, state.queue[0].b] : null);
  drawNext(next2Ctx, state.queue[1] ? [state.queue[1].a, state.queue[1].b] : null);
}

function loop() {
  state.frame += 1;
  update();
  render();
  requestAnimationFrame(loop);
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.key === 'p' || e.key === 'P') {
    state.paused = !state.paused;
    overlay.textContent = 'PAUSED';
    overlay.classList.toggle('hidden', !state.paused || state.gameOver);
    return;
  }

  if (state.paused || state.gameOver || state.settling || !state.active) return;

  if (e.key === 'ArrowLeft') move(-1, 0);
  if (e.key === 'ArrowRight') move(1, 0);
  if (e.key === 'ArrowDown') state.softDrop = true;
  if (e.key === 'z' || e.key === 'Z') rotate(-1);
  if (e.key === 'x' || e.key === 'X' || e.key === 'ArrowUp') rotate(1);
  if (e.key === ' ') {
    while (move(0, 1)) {
      state.score += 1;
    }
    scoreEl.textContent = state.score;
    lockActive();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowDown') state.softDrop = false;
});

refillQueue();
spawnPair();
render();
requestAnimationFrame(loop);

console.log(`Running at target ${FPS} FPS via requestAnimationFrame.`);
