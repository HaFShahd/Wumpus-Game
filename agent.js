/**
 * agent.js — Wumpus World Environment + Knowledge-Based Agent
 */

// ============================================================
// WORLD STATE
// ============================================================
let world = null;
let kb = null;
let agentState = null;
let autoRunInterval = null;
let isAutoRunning = false;

// ============================================================
// WORLD INITIALIZATION
// ============================================================
function createWorld(rows, cols, numPits) {
  const grid = [];
  for (let r = 0; r < rows; r++) {
    grid[r] = [];
    for (let c = 0; c < cols; c++) {
      grid[r][c] = {
        hasWumpus: false,
        hasPit: false,
        hasGold: false,
        percepts: [],   // B, S, G
      };
    }
  }

  // Agent always starts at (0,0) — never place hazards here or (0,1),(1,0)
  const forbidden = new Set(['0,0', '0,1', '1,0']);

  // Place Wumpus (1 wumpus only)
  placeRandom(grid, rows, cols, forbidden, (r, c) => {
    grid[r][c].hasWumpus = true;
  });

  // Place Pits
  for (let i = 0; i < numPits; i++) {
    placeRandom(grid, rows, cols, forbidden, (r, c) => {
      grid[r][c].hasPit = true;
    });
  }

  // Place Gold (random, not at 0,0)
  const goldForbidden = new Set(['0,0']);
  placeRandom(grid, rows, cols, goldForbidden, (r, c) => {
    grid[r][c].hasGold = true;
  });

  // Compute percepts
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const adjs = getAdjacents(r, c, rows, cols);
      for (const [ar, ac] of adjs) {
        if (grid[ar][ac].hasWumpus && !grid[r][c].percepts.includes('S'))
          grid[r][c].percepts.push('S');
        if (grid[ar][ac].hasPit && !grid[r][c].percepts.includes('B'))
          grid[r][c].percepts.push('B');
      }
      if (grid[r][c].hasGold) grid[r][c].percepts.push('G');
    }
  }

  return { grid, rows, cols };
}

function placeRandom(grid, rows, cols, forbidden, setter) {
  let r, c, key;
  let attempts = 0;
  do {
    r = Math.floor(Math.random() * rows);
    c = Math.floor(Math.random() * cols);
    key = `${r},${c}`;
    attempts++;
    if (attempts > 1000) return; // Safety
  } while (forbidden.has(key) || grid[r][c].hasWumpus || grid[r][c].hasPit || grid[r][c].hasGold);
  forbidden.add(key);
  setter(r, c);
}

function getAdjacents(r, c, rows, cols) {
  const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
  return dirs
    .map(([dr,dc]) => [r+dr, c+dc])
    .filter(([nr,nc]) => nr>=0 && nr<rows && nc>=0 && nc<cols);
}

// ============================================================
// AGENT STATE
// ============================================================
function createAgent(rows, cols) {
  return {
    r: 0, c: 0,
    visited: new Set(['0,0']),
    // Inference results per cell: 'safe', 'danger', 'unknown'
    inference: {},
    alive: true,
    hasGold: false,
    steps: 0,
    score: 0,
    done: false,
    frontier: [],       // Cells to explore
    perceptHistory: [],
  };
}

// ============================================================
// GAME INITIALIZATION
// ============================================================
function initGame() {
  const rows = parseInt(document.getElementById('val-rows').textContent);
  const cols = parseInt(document.getElementById('val-cols').textContent);
  const pits = parseInt(document.getElementById('val-pits').textContent);

  if (autoRunInterval) {
    clearInterval(autoRunInterval);
    autoRunInterval = null;
    isAutoRunning = false;
  }

  world = createWorld(rows, cols, Math.min(pits, rows*cols - 4));
  kb = new KnowledgeBase();
  agentState = createAgent(rows, cols);

  // Tell KB: start cell is safe
  kb.tellFact('~P_0_0');
  kb.tellFact('~W_0_0');

  // Mark all cells as unknown
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      agentState.inference[`${r},${c}`] = 'unknown';
    }
  }
  agentState.inference['0,0'] = 'safe';

  // Process initial cell
  processCurrentCell();

  document.getElementById('btn-step').disabled = false;
  document.getElementById('btn-auto').disabled = false;
  document.getElementById('btn-auto').textContent = 'AUTO RUN';
  document.getElementById('btn-auto').classList.remove('active');
  document.getElementById('game-message').classList.remove('show');

  clearLogs();
  setStatus('RUNNING');
  renderAll();
  logEntry('info', 0, 'New game started', `Grid: ${rows}×${cols} | Pits: ${pits}`);
}

// ============================================================
// CORE: Process current cell
// ============================================================
function processCurrentCell() {
  const { r, c } = agentState;
  const cell = world.grid[r][c];
  const adjs = getAdjacents(r, c, world.rows, world.cols);

  // Tell KB about percepts at this cell
  kb.tellPerceptsAt(r, c, cell.percepts, adjs, world.rows, world.cols);

  // Record percept history
  agentState.perceptHistory.push({ r, c, percepts: [...cell.percepts] });

  // Run inference on all unvisited cells
  runInference();

  // Update frontier: adjacent unvisited cells
  for (const [ar, ac] of adjs) {
    const key = `${ar},${ac}`;
    if (!agentState.visited.has(key) && !agentState.frontier.includes(key)) {
      agentState.frontier.push(key);
    }
  }
}

// ============================================================
// INFERENCE: Update cell safety estimates
// ============================================================
function runInference() {
  const { rows, cols } = world;
  let newSafe = 0, newDanger = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${r},${c}`;
      if (agentState.visited.has(key)) {
        agentState.inference[key] = 'safe'; // visited = safe
        continue;
      }
      // Only re-evaluate unknowns
      if (agentState.inference[key] === 'unknown') {
        if (kb.isCellSafe(r, c)) {
          agentState.inference[key] = 'safe';
          newSafe++;
          logEntry('safe', agentState.steps, `Proved safe: (${r},${c})`, 'Resolution refutation succeeded');
        } else if (kb.isCellDangerous(r, c)) {
          agentState.inference[key] = 'danger';
          newDanger++;
          logEntry('danger', agentState.steps, `Proved dangerous: (${r},${c})`, 'Resolution refutation confirmed hazard');
        }
      }
    }
  }

  updateStats();
}

// ============================================================
// AGENT STEP
// ============================================================
function stepAgent() {
  if (!world || agentState.done) return;

  // Choose next cell
  const next = chooseNextCell();
  if (!next) {
    agentState.done = true;
    logEntry('info', agentState.steps, 'No reachable safe cells found.', 'Agent is stuck or explored all safe cells');
    setStatus('IDLE');
    showGameMessage('STUCK', 'lose');
    return;
  }

  const [nr, nc] = next;
  agentState.r = nr;
  agentState.c = nc;
  agentState.steps++;
  agentState.score -= 1;
  agentState.visited.add(`${nr},${nc}`);

  logEntry('move', agentState.steps, `Moved to (${nr},${nc})`, '');

  // Check for death
  const cell = world.grid[nr][nc];
  if (cell.hasPit) {
    agentState.alive = false;
    agentState.done = true;
    agentState.score -= 1000;
    logEntry('death', agentState.steps, `FELL INTO PIT at (${nr},${nc})!`, 'Game over');
    setStatus('DEAD');
    showGameMessage('YOU DIED', 'lose');
    if (autoRunInterval) { clearInterval(autoRunInterval); autoRunInterval = null; isAutoRunning = false; }
    renderAll();
    return;
  }
  if (cell.hasWumpus) {
    agentState.alive = false;
    agentState.done = true;
    agentState.score -= 1000;
    logEntry('death', agentState.steps, `EATEN BY WUMPUS at (${nr},${nc})!`, 'Game over');
    setStatus('DEAD');
    showGameMessage('WUMPUS!', 'lose');
    if (autoRunInterval) { clearInterval(autoRunInterval); autoRunInterval = null; isAutoRunning = false; }
    renderAll();
    return;
  }
  if (cell.hasGold && !agentState.hasGold) {
    agentState.hasGold = true;
    agentState.score += 1000;
    logEntry('gold', agentState.steps, `FOUND GOLD at (${nr},${nc})!`, '+1000 score');
  }

  // Remove from frontier
  agentState.frontier = agentState.frontier.filter(k => k !== `${nr},${nc}`);

  // Process new cell
  processCurrentCell();
  renderAll();

  // Check win (has gold and back at 0,0)
  if (agentState.hasGold && nr === 0 && nc === 0) {
    agentState.done = true;
    agentState.score += 500;
    logEntry('win', agentState.steps, 'RETURNED WITH GOLD! VICTORY!', `Final score: ${agentState.score}`);
    setStatus('WON');
    showGameMessage('VICTORY!', 'win');
    if (autoRunInterval) { clearInterval(autoRunInterval); autoRunInterval = null; isAutoRunning = false; }
  }
}

// ============================================================
// CELL SELECTION: Prefer known safe cells, then by heuristic
// ============================================================
function chooseNextCell() {
  const { r, c } = agentState;

  // 1. If agent has gold, try to navigate back to (0,0)
  if (agentState.hasGold) {
    const path = findSafePath(r, c, 0, 0);
    if (path && path.length > 0) return path[0];
  }

  // 2. Among frontier, prefer known-safe unvisited cells adjacent to current
  const adjSafe = getAdjacents(r, c, world.rows, world.cols)
    .filter(([ar,ac]) => {
      const key = `${ar},${ac}`;
      return !agentState.visited.has(key) && agentState.inference[key] === 'safe';
    });
  if (adjSafe.length > 0) return adjSafe[0];

  // 3. Move toward any known-safe frontier cell (BFS path through safe/visited cells)
  const safeFrontier = agentState.frontier
    .filter(key => agentState.inference[key] === 'safe')
    .map(key => key.split(',').map(Number));

  if (safeFrontier.length > 0) {
    // BFS to nearest safe frontier cell
    let best = null, bestDist = Infinity;
    for (const [tr, tc] of safeFrontier) {
      const path = findSafePath(r, c, tr, tc);
      if (path && path.length < bestDist) {
        bestDist = path.length;
        best = path[0];
      }
    }
    if (best) return best;
  }

  // 4. No proven-safe option: try unknown frontier (risky)
  const unknownFrontier = agentState.frontier
    .filter(key => agentState.inference[key] === 'unknown')
    .map(key => key.split(',').map(Number));

  if (unknownFrontier.length > 0) {
    logEntry('resolve', agentState.steps, 'No safe cell proved. Moving to unknown cell (risky!)', '');
    const [tr, tc] = unknownFrontier[0];
    const path = findSafePath(r, c, tr, tc);
    if (path && path.length > 0) return path[0];
    return unknownFrontier[0];
  }

  return null;
}

// BFS through visited+safe cells to reach target
function findSafePath(sr, sc, tr, tc) {
  if (sr === tr && sc === tc) return [];

  const queue = [[sr, sc, []]];
  const visited = new Set([`${sr},${sc}`]);

  while (queue.length > 0) {
    const [r, c, path] = queue.shift();
    const adjs = getAdjacents(r, c, world.rows, world.cols);
    for (const [ar, ac] of adjs) {
      const key = `${ar},${ac}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const inf = agentState.inference[key];
      const newPath = [...path, [ar, ac]];
      if (ar === tr && ac === tc) return newPath;
      // Only traverse safe or visited cells (don't walk through dangers)
      if (agentState.visited.has(key) || inf === 'safe') {
        queue.push([ar, ac, newPath]);
      }
    }
  }
  return null;
}

// ============================================================
// AUTO RUN
// ============================================================
function toggleAuto() {
  if (!world) return;
  if (isAutoRunning) {
    clearInterval(autoRunInterval);
    autoRunInterval = null;
    isAutoRunning = false;
    document.getElementById('btn-auto').textContent = 'AUTO RUN';
    document.getElementById('btn-auto').classList.remove('active');
  } else {
    isAutoRunning = true;
    document.getElementById('btn-auto').textContent = '⏹ STOP';
    document.getElementById('btn-auto').classList.add('active');
    const speed = parseInt(document.getElementById('speed').value);
    autoRunInterval = setInterval(() => {
      if (agentState.done) {
        clearInterval(autoRunInterval);
        autoRunInterval = null;
        isAutoRunning = false;
        document.getElementById('btn-auto').textContent = 'AUTO RUN';
        document.getElementById('btn-auto').classList.remove('active');
        return;
      }
      stepAgent();
    }, speed);
  }
}

// Expose globals
window.initGame = initGame;
window.stepAgent = stepAgent;
window.toggleAuto = toggleAuto;
