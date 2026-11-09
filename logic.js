export const COLS = 21;
export const ROWS = 21;

const BASE_TICK = 160;
const MIN_TICK = 72;
const GOLD_MS = 7000;
const START = [
  { x: 8, y: 10 },
  { x: 7, y: 10 },
  { x: 6, y: 10 },
];

export function createState(rand = Math.random) {
  const snake = START.map((cell) => ({ ...cell }));
  const state = {
    snake,
    from: snake.map((cell) => ({ ...cell })),
    dir: { x: 1, y: 0 },
    queue: [],
    food: null,
    golden: null,
    goldenLeft: 0,
    swallowed: null,
    apples: 0,
    score: 0,
    slowMs: 0,
    tickMs: BASE_TICK,
    status: "ready",
    rand,
  };
  spawnFood(state, [
    { x: 9, y: 10 },
    { x: 10, y: 10 },
    { x: 11, y: 10 },
  ]);
  return state;
}

export function restart(state) {
  const fresh = createState(state.rand);
  for (const key of Object.keys(fresh)) state[key] = fresh[key];
  state.status = "playing";
}

export function pause(state) {
  if (state.status === "playing") state.status = "paused";
}

export function resume(state) {
  if (state.status === "paused") state.status = "playing";
}

export function queueDir(state, x, y) {
  if (state.status !== "playing" && state.status !== "paused") return;
  if (Math.abs(x) + Math.abs(y) !== 1) return;
  const last = state.queue.length ? state.queue[state.queue.length - 1] : state.dir;
  if (last.x === x && last.y === y) return;
  if (last.x + x === 0 && last.y + y === 0) return;
  if (state.queue.length >= 2) return;
  state.queue.push({ x, y });
}

export function step(state) {
  if (state.status !== "playing") return { event: "idle" };

  if (state.queue.length) state.dir = state.queue.shift();

  const head = state.snake[0];
  const next = { x: head.x + state.dir.x, y: head.y + state.dir.y };
  if (!inside(next)) return die(state);

  const ateFood = same(state.food, next);
  const ateGold = same(state.golden, next);
  const growing = ateFood || ateGold;
  const body = growing ? state.snake : state.snake.slice(0, -1);
  if (body.some((cell) => cell.x === next.x && cell.y === next.y)) return die(state);

  const old = state.snake.map((cell) => ({ ...cell }));
  const snake = [next, ...state.snake];
  if (!growing) snake.pop();
  state.snake = snake;
  state.from = snake.map((_, i) => ({ ...old[Math.min(i, old.length - 1)] }));
  state.swallowed = null;

  let event = "move";
  if (ateFood) {
    state.score += 10;
    state.apples += 1;
    state.swallowed = { x: next.x, y: next.y, kind: "food" };
    state.food = null;
    event = "eat";
    if (state.snake.length >= COLS * ROWS) {
      state.status = "won";
      updateTick(state);
      return { event: "win" };
    }
    spawnFood(state);
    if (!state.food) {
      state.status = "won";
      updateTick(state);
      return { event: "win" };
    }
    if (state.apples % 5 === 0) {
      spawnGolden(state);
      if (state.golden) event = "eat-gold-spawn";
    }
  } else if (ateGold) {
    state.score += 50;
    state.swallowed = { x: next.x, y: next.y, kind: "gold" };
    state.golden = null;
    state.goldenLeft = 0;
    state.slowMs = 48;
    event = "gold";
  }

  if (!ateGold) state.slowMs = Math.max(0, state.slowMs - 2);

  if (state.golden) {
    state.goldenLeft -= state.tickMs;
    if (state.goldenLeft <= 0) {
      state.golden = null;
      state.goldenLeft = 0;
      if (event === "move") event = "gold-gone";
    }
  }

  updateTick(state);
  return { event };
}

function updateTick(state) {
  state.tickMs = Math.max(MIN_TICK, BASE_TICK - state.apples * 5) + state.slowMs;
}

function die(state) {
  state.status = "dead";
  state.swallowed = null;
  return { event: "dead" };
}

function spawnFood(state, extraBlocked = []) {
  const pool = openCells(state, extraBlocked);
  if (!pool.length) {
    state.food = null;
    return;
  }
  const index = Math.min(pool.length - 1, Math.floor(state.rand() * pool.length));
  state.food = pool[index];
}

function spawnGolden(state) {
  const pool = openCells(state);
  if (!pool.length) return;
  const index = Math.min(pool.length - 1, Math.floor(state.rand() * pool.length));
  state.golden = pool[index];
  state.goldenLeft = GOLD_MS;
}

function openCells(state, extraBlocked = []) {
  const used = new Set(state.snake.map((cell) => cell.x + "," + cell.y));
  if (state.food) used.add(state.food.x + "," + state.food.y);
  if (state.golden) used.add(state.golden.x + "," + state.golden.y);
  for (const cell of extraBlocked) used.add(cell.x + "," + cell.y);
  const open = [];
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (!used.has(x + "," + y)) open.push({ x, y });
    }
  }
  return open;
}

function inside(cell) {
  return cell.x >= 0 && cell.y >= 0 && cell.x < COLS && cell.y < ROWS;
}

function same(a, b) {
  return !!a && !!b && a.x === b.x && a.y === b.y;
}
