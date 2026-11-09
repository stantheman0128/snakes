import assert from "node:assert/strict";
import test from "node:test";
import { COLS, ROWS, createState, pause, queueDir, restart, resume, step } from "./logic.js";

function playing(rand = () => 0) {
  const state = createState(rand);
  state.status = "playing";
  return state;
}

test("starts facing right with three segments and food off the snake", () => {
  const state = createState(() => 0);
  assert.deepEqual(state.snake, [
    { x: 8, y: 10 },
    { x: 7, y: 10 },
    { x: 6, y: 10 },
  ]);
  assert.equal(state.score, 0);
  assert.equal(state.status, "ready");
  assert.ok(state.food);
  const occupied = new Set(state.snake.map((cell) => cell.x + "," + cell.y));
  assert.equal(occupied.has(state.food.x + "," + state.food.y), false);
  assert.notDeepEqual(state.food, { x: 9, y: 10 });
});

test("moves one cell and remembers the previous pose for interpolation", () => {
  const state = playing();
  state.food = { x: 0, y: 0 };
  const result = step(state);
  assert.equal(result.event, "move");
  assert.deepEqual(state.snake[0], { x: 9, y: 10 });
  assert.deepEqual(state.from[0], { x: 8, y: 10 });
  assert.deepEqual(state.from[1], { x: 7, y: 10 });
  assert.deepEqual(state.from[2], { x: 6, y: 10 });
  assert.equal(state.snake.length, 3);
});

test("rejects a reverse and keeps at most two queued turns", () => {
  const state = playing();
  queueDir(state, -1, 0);
  queueDir(state, 0, -1);
  queueDir(state, -1, 0);
  queueDir(state, 0, 1);
  assert.deepEqual(state.queue, [
    { x: 0, y: -1 },
    { x: -1, y: 0 },
  ]);
  step(state);
  assert.deepEqual(state.dir, { x: 0, y: -1 });
  assert.equal(state.snake[0].y, 9);
  step(state);
  assert.deepEqual(state.dir, { x: -1, y: 0 });
});

test("ignores direction input until the game is playing or paused", () => {
  const state = createState(() => 0);
  queueDir(state, 0, -1);
  assert.equal(state.queue.length, 0);
});

test("grows and scores when it eats, then speeds up", () => {
  const state = playing();
  state.food = { x: 9, y: 10 };
  const before = state.tickMs;
  const result = step(state);
  assert.equal(result.event, "eat");
  assert.equal(state.score, 10);
  assert.equal(state.apples, 1);
  assert.equal(state.snake.length, 4);
  assert.deepEqual(state.snake[0], { x: 9, y: 10 });
  assert.deepEqual(state.from[3], { x: 6, y: 10 });
  assert.deepEqual(state.swallowed, { x: 9, y: 10, kind: "food" });
  assert.ok(state.food);
  assert.ok(state.tickMs < before);
  const onSnake = state.snake.some((cell) => cell.x === state.food.x && cell.y === state.food.y);
  assert.equal(onSnake, false);
});

test("spawns a golden apple on every fifth apple", () => {
  const state = playing();
  for (let i = 0; i < 5; i += 1) {
    const head = state.snake[0];
    state.food = { x: head.x + 1, y: head.y };
    state.golden = null;
    step(state);
  }
  assert.equal(state.apples, 5);
  assert.equal(state.score, 50);
  assert.ok(state.golden);
  assert.ok(state.goldenLeft > 0);
  const overlap = state.snake.some((cell) => cell.x === state.golden.x && cell.y === state.golden.y);
  assert.equal(overlap, false);
});

test("golden apple scores 50 and slows the snake", () => {
  const state = playing();
  state.golden = { x: 9, y: 10 };
  state.goldenLeft = 7000;
  state.food = { x: 0, y: 0 };
  const result = step(state);
  assert.equal(result.event, "gold");
  assert.equal(state.score, 50);
  assert.equal(state.snake.length, 4);
  assert.equal(state.golden, null);
  assert.ok(state.slowMs > 0);
  assert.ok(state.tickMs > 160);
});

test("golden apple expires without being eaten", () => {
  const state = playing();
  state.food = { x: 0, y: 0 };
  state.golden = { x: 0, y: 1 };
  state.goldenLeft = 100;
  state.tickMs = 160;
  const result = step(state);
  assert.equal(result.event, "gold-gone");
  assert.equal(state.golden, null);
});

test("dies on the wall without moving into it", () => {
  const state = playing();
  state.snake = [
    { x: COLS - 1, y: 10 },
    { x: COLS - 2, y: 10 },
    { x: COLS - 3, y: 10 },
  ];
  state.food = { x: 0, y: 0 };
  const result = step(state);
  assert.equal(result.event, "dead");
  assert.equal(state.status, "dead");
  assert.equal(state.snake[0].x, COLS - 1);
  assert.equal(step(state).event, "idle");
  assert.equal(state.snake[0].x, COLS - 1);
});

test("dies when it bites its body", () => {
  const state = playing();
  state.snake = [
    { x: 2, y: 1 },
    { x: 2, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 0 },
  ];
  state.dir = { x: 0, y: -1 };
  state.food = { x: 5, y: 5 };
  assert.equal(step(state).event, "dead");
});

test("can follow its own tail into the cell the tail just left", () => {
  const state = playing();
  state.snake = [
    { x: 2, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 2 },
  ];
  state.dir = { x: 0, y: 1 };
  state.food = { x: 0, y: 0 };
  const result = step(state);
  assert.equal(result.event, "move");
  assert.deepEqual(state.snake[0], { x: 2, y: 2 });
  assert.equal(state.status, "playing");
});

test("dies if the tail cell is a meal, because the tail does not move", () => {
  const state = playing();
  state.snake = [
    { x: 2, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 2 },
  ];
  state.dir = { x: 0, y: 1 };
  state.food = { x: 2, y: 2 };
  assert.equal(step(state).event, "dead");
});

test("wins by filling the orchard", () => {
  const state = playing();
  const cells = [];
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) cells.push({ x, y });
  }
  const last = cells[cells.length - 1];
  state.snake = [{ x: last.x - 1, y: last.y }, ...cells.filter((cell) => cell.x !== last.x || cell.y !== last.y).slice(1)];
  assert.equal(state.snake.length, COLS * ROWS - 1);
  state.dir = { x: 1, y: 0 };
  state.food = last;
  state.golden = null;
  const result = step(state);
  assert.equal(result.event, "win");
  assert.equal(state.status, "won");
  assert.equal(state.snake.length, COLS * ROWS);
});

test("pause freezes the snake and resume continues", () => {
  const state = playing();
  state.food = { x: 0, y: 0 };
  pause(state);
  assert.equal(step(state).event, "idle");
  assert.deepEqual(state.snake[0], { x: 8, y: 10 });
  queueDir(state, 0, -1);
  resume(state);
  step(state);
  assert.deepEqual(state.snake[0], { x: 8, y: 9 });
});

test("restart returns a new game already in play", () => {
  const state = playing();
  state.score = 80;
  state.snake[0] = { x: 1, y: 1 };
  restart(state);
  assert.equal(state.status, "playing");
  assert.equal(state.score, 0);
  assert.equal(state.snake.length, 3);
  assert.deepEqual(state.snake[0], { x: 8, y: 10 });
});

test("a straight run from the opening dies on the right wall", () => {
  const state = playing();
  let guard = 0;
  while (state.status === "playing" && guard < 30) {
    step(state);
    guard += 1;
  }
  assert.equal(state.status, "dead");
  assert.equal(state.snake[0].x, COLS - 1);
  assert.equal(state.snake[0].y, 10);
});
