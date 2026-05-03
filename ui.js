/**
 * ui.js — Rendering & UI Interactions
 */

// ============================================================
// CONFIG ADJUSTERS
// ============================================================
const CONFIG = { rows: 4, cols: 4, pits: 3 };
const LIMITS = { rows: [3,8], cols: [3,8], pits: [1,10] };

function adj(key, delta) {
  CONFIG[key] = Math.max(LIMITS[key][0], Math.min(LIMITS[key][1], CONFIG[key] + delta));
  document.getElementById(`val-${key}`).textContent = CONFIG[key];
}

document.getElementById('speed').addEventListener('input', function() {
  document.getElementById('speed-val').textContent = this.value + 'ms';
  if (isAutoRunning) {
    clearInterval(autoRunInterval);
    autoRunInterval = setInterval(() => {
      if (agentState && agentState.done) {
        clearInterval(autoRunInterval);
        autoRunInterval = null;
        isAutoRunning = false;
        return;
      }
      stepAgent();
    }, parseInt(this.value));
  }
});

// ============================================================
// RENDER
// ============================================================
function renderAll() {
  renderGrid();
  renderKB();
  renderPercepts();
  updateStats();
}

function renderGrid() {
  if (!world) return;
  const { rows, cols, grid } = world;
  const container = document.getElementById('grid-container');

  // Compute cell size dynamically
  const maxW = container.clientWidth - 48;
  const maxH = container.clientHeight - 48;
  const cellW = Math.min(80, Math.floor(maxW / cols));
  const cellH = Math.min(80, Math.floor(maxH / rows));
  const cellSize = Math.max(52, Math.min(cellW, cellH));

  let html = `<div class="grid" style="grid-template-columns:repeat(${cols},${cellSize}px)">`;

  // Render rows in reverse so (0,0) is at bottom-left visually
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = 0; c < cols; c++) {
      html += renderCell(r, c, grid[r][c], cellSize);
    }
  }

  html += '</div>';
  container.innerHTML = html;
}

function renderCell(r, c, cell, size) {
  const key = `${r},${c}`;
  const isAgent = agentState && agentState.r === r && agentState.c === c;
  const isVisited = agentState && agentState.visited.has(key);
  const inf = agentState ? agentState.inference[key] || 'unknown' : 'unknown';
  const isStart = r === 0 && c === 0;
  const isDead = agentState && !agentState.alive;
  const isDone = agentState && agentState.done;

  // Cell class
  let cls = 'cell';
  if (isAgent) cls += ' agent-here';
  else if (isVisited) {
    cls += ' visited';
    if (inf === 'safe') cls += ' known-safe';
  } else {
    if (inf === 'safe') cls += ' known-safe';
    else if (inf === 'danger') cls += ' known-danger';
    else cls += ' unknown';
  }
  if (isStart) cls += ' start';

  // Reveal actual content when dead or done
  const reveal = isDone;

  // Entity icon
  let entity = '';
  if (isAgent && agentState.alive) {
    entity = `<span class="cell-entity entity-agent" title="Agent">🤖</span>`;
  } else if (reveal && cell.hasWumpus) {
    entity = `<span class="cell-entity entity-wumpus" title="Wumpus">👾</span>`;
  } else if (reveal && cell.hasPit) {
    entity = `<span class="cell-entity entity-pit" title="Pit">🕳</span>`;
  } else if (cell.hasGold && !(agentState && agentState.hasGold)) {
    // Show gold only if visited or reveal
    if (reveal || isVisited) {
      entity = `<span class="cell-entity entity-gold" title="Gold">💰</span>`;
    }
  }

  // If agent just died here, show death
  if (isAgent && agentState && !agentState.alive) {
    entity = `<span class="cell-entity" style="font-size:22px">💀</span>`;
  }

  // Percepts (show only in visited cells)
  let perceptHtml = '';
  if (isVisited && agentState) {
    const ph = agentState.perceptHistory.find(p => p.r === r && p.c === c);
    if (ph && ph.percepts.length > 0) {
      const tags = ph.percepts.map(p => `<span class="percept ${p}">${p}</span>`).join('');
      perceptHtml = `<div class="percept-row">${tags}</div>`;
    } else if (ph) {
      perceptHtml = `<div class="percept-row"><span class="percept OK">OK</span></div>`;
    }
  }

  // Inference indicator
  let infHtml = '';
  if (!isVisited && agentState) {
    if (inf === 'safe')   infHtml = `<span class="cell-inference inf-safe">✓</span>`;
    else if (inf === 'danger') infHtml = `<span class="cell-inference inf-danger">✗</span>`;
    else infHtml = `<span class="cell-inference inf-unknown">?</span>`;
  }

  // Frontier indicator
  const isFrontier = agentState && agentState.frontier.includes(key);

  return `
    <div class="${cls}" style="width:${size}px;height:${size}px" title="(${r},${c})">
      <span class="cell-coord">${r},${c}</span>
      ${infHtml}
      ${entity}
      ${perceptHtml}
    </div>`;
}

// ============================================================
// KB RENDERING
// ============================================================
function renderKB() {
  if (!kb) return;
  const container = document.getElementById('kb-entries');
  const clauses = kb.getClauses();
  const facts = [...kb.facts];

  let html = `<div style="color:var(--text-dim);font-size:10px;margin-bottom:8px;letter-spacing:1px">UNIT FACTS (${facts.length})</div>`;
  for (const f of facts.slice(-30)) {
    html += `<div class="kb-clause fact">${f}</div>`;
  }
  html += `<div style="color:var(--text-dim);font-size:10px;margin:8px 0;letter-spacing:1px">COMPLEX CLAUSES (${clauses.length - facts.length})</div>`;
  for (const cl of clauses.filter(c => c.includes('∨')).slice(-40)) {
    html += `<div class="kb-clause">${cl}</div>`;
  }

  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

// ============================================================
// PERCEPT LOG
// ============================================================
function renderPercepts() {
  if (!agentState) return;
  const container = document.getElementById('percept-entries');
  let html = '';
  for (const entry of [...agentState.perceptHistory].reverse()) {
    const pTags = entry.percepts.length > 0
      ? entry.percepts.map(p => `<span class="pe-tag ${p}">${p === 'B' ? '💨 BREEZE' : p === 'S' ? '🦨 STENCH' : '✨ GLITTER'}</span>`).join('')
      : `<span class="pe-tag NONE">✅ NONE</span>`;
    html += `
      <div class="percept-entry">
        <div class="pe-cell">Cell (${entry.r},${entry.c})</div>
        <div class="pe-list">${pTags}</div>
      </div>`;
  }
  container.innerHTML = html || '<div style="color:var(--text-dim);padding:8px">No percepts yet</div>';
}

// ============================================================
// LOG
// ============================================================
const logHistory = [];

function logEntry(type, step, msg, detail) {
  logHistory.push({ type, step, msg, detail });
  const container = document.getElementById('log-entries');
  const el = document.createElement('div');
  el.className = `log-entry ${type}`;
  el.innerHTML = `
    <span class="log-step">[${String(step).padStart(3,'0')}]</span>
    <span class="log-msg">${msg}</span>
    ${detail ? `<span class="log-detail">${detail}</span>` : ''}`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function clearLogs() {
  logHistory.length = 0;
  document.getElementById('log-entries').innerHTML = '';
  document.getElementById('kb-entries').innerHTML = '';
  document.getElementById('percept-entries').innerHTML = '';
}

// ============================================================
// TABS
// ============================================================
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector(`[onclick="switchTab('${tab}')"]`).classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');
}

// ============================================================
// STATS
// ============================================================
function updateStats() {
  if (!agentState || !kb) return;
  document.getElementById('stat-steps').textContent = agentState.steps;
  document.getElementById('stat-score').textContent = agentState.score;
  document.getElementById('stat-kb').textContent = kb.getClauseCount();
  const safeCount = Object.values(agentState.inference).filter(v => v === 'safe').length;
  document.getElementById('stat-safe').textContent = safeCount;
}

// ============================================================
// STATUS
// ============================================================
function setStatus(s) {
  const el = document.getElementById('agent-status');
  el.textContent = s;
  el.className = 'status-pill';
  if (s === 'RUNNING') el.classList.add('running');
  else if (s === 'DEAD')    el.classList.add('dead');
  else if (s === 'WON')     el.classList.add('won');
}

// ============================================================
// GAME MESSAGE
// ============================================================
function showGameMessage(text, type) {
  const el = document.getElementById('game-message');
  el.textContent = text;
  el.className = `show ${type}`;
  // Fade out after 3s
  setTimeout(() => { el.classList.remove('show'); }, 3500);
}

// ============================================================
// TAB EXPOSE
// ============================================================
window.switchTab = switchTab;
window.adj = adj;
