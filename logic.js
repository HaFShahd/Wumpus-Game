/**
 * logic.js — Propositional Logic Engine
 * Implements:
 *   - Knowledge Base (KB) as a set of CNF clauses
 *   - TELL: Add new percept axioms to KB
 *   - ASK (Resolution Refutation): Prove a query by contradiction
 */

class KnowledgeBase {
  constructor() {
    this.clauses = [];   // List of CNF clauses (each clause = Set of literals)
    this.facts = new Set(); // Unit clauses (direct facts)
  }

  reset() {
    this.clauses = [];
    this.facts = new Set();
  }

  // --- TELL: Add a clause (array of literals) to the KB ---
  tell(literals) {
    const clause = new Set(literals);
    // Check for duplicates
    for (const existing of this.clauses) {
      if (setsEqual(existing, clause)) return;
    }
    this.clauses.push(clause);
    if (clause.size === 1) {
      this.facts.add([...clause][0]);
    }
  }

  // Tell a direct fact
  tellFact(literal) {
    this.tell([literal]);
  }

  /**
   * TELL percept rules for a cell (r,c):
   * Breeze <=> at least one adjacent pit
   * Stench <=> at least one adjacent wumpus (only one wumpus)
   *
   * If breeze at (r,c):  B_r_c => P_adj1 v P_adj2 v ...
   * If no breeze at (r,c): ~P_adj1, ~P_adj2, ... (no pit in any adjacent)
   * Similarly for stench/wumpus.
   */
  tellPerceptsAt(r, c, percepts, adjacents, rows, cols) {
    const hasBr = percepts.includes('B');
    const hasSt = percepts.includes('S');

    // --- PITS ---
    if (hasBr) {
      // B_r_c => (P_a1 v P_a2 v ...)
      // Equivalently add clause: [P_a1, P_a2, ...]
      const pitLits = adjacents.map(([ar, ac]) => `P_${ar}_${ac}`);
      if (pitLits.length > 0) this.tell(pitLits);
    } else {
      // ~B_r_c => ~P_a1 ^ ~P_a2 ^ ...
      for (const [ar, ac] of adjacents) {
        this.tellFact(`~P_${ar}_${ac}`);
      }
    }

    // --- WUMPUS ---
    if (hasSt) {
      const wLits = adjacents.map(([ar, ac]) => `W_${ar}_${ac}`);
      if (wLits.length > 0) this.tell(wLits);
    } else {
      for (const [ar, ac] of adjacents) {
        this.tellFact(`~W_${ar}_${ac}`);
      }
    }

    // Current cell itself is safe (agent is here)
    this.tellFact(`~P_${r}_${c}`);
    this.tellFact(`~W_${r}_${c}`);
  }

  /**
   * ASK: Can we prove `literal` using Resolution Refutation?
   * i.e., is KB ∧ ~literal unsatisfiable?
   *
   * Algorithm:
   * 1. Add negation of query to KB copy
   * 2. Resolve all clause pairs
   * 3. If empty clause derived → proven (return true)
   * 4. If no new clauses → cannot prove (return false)
   */
  ask(literal) {
    // Special: if literal is a direct fact
    if (this.facts.has(literal)) return true;
    // If negation is a direct fact, literal is false
    const neg = negateLiteral(literal);
    if (this.facts.has(neg)) return false;

    // Build working set = KB clauses + {~literal}
    const workingClauses = this.clauses.map(c => new Set(c));
    workingClauses.push(new Set([neg]));

    const seen = new Set();
    workingClauses.forEach(c => seen.add(clauseKey(c)));

    let agenda = [...workingClauses];
    let iterations = 0;
    const MAX_ITER = 500;

    while (iterations < MAX_ITER) {
      iterations++;
      const newClauses = [];

      for (let i = 0; i < agenda.length; i++) {
        for (let j = i + 1; j < agenda.length; j++) {
          const resolvents = resolve(agenda[i], agenda[j]);
          for (const r of resolvents) {
            if (r.size === 0) return true; // Empty clause → contradiction found!
            const key = clauseKey(r);
            if (!seen.has(key)) {
              seen.add(key);
              newClauses.push(r);
            }
          }
        }
      }

      if (newClauses.length === 0) break; // No new info, can't prove
      agenda = [...agenda, ...newClauses];
    }

    return false;
  }

  /**
   * Ask if a cell is provably safe (no pit AND no wumpus)
   */
  isCellSafe(r, c) {
    return this.ask(`~P_${r}_${c}`) && this.ask(`~W_${r}_${c}`);
  }

  /**
   * Ask if a cell is provably dangerous
   */
  isCellDangerous(r, c) {
    return this.ask(`P_${r}_${c}`) || this.ask(`W_${r}_${c}`);
  }

  getClauseCount() { return this.clauses.length; }

  getClauses() { return this.clauses.map(c => [...c].join(' ∨ ')); }
}


// ============================================================
// Resolution: Given two clauses, find all resolvents
// A resolvent is formed by finding a literal L in one clause
// and ~L in another, then combining remaining literals.
// ============================================================
function resolve(c1, c2) {
  const resolvents = [];
  for (const lit of c1) {
    const neg = negateLiteral(lit);
    if (c2.has(neg)) {
      // Resolve on lit / ~lit
      const resolvent = new Set([
        ...[...c1].filter(l => l !== lit),
        ...[...c2].filter(l => l !== neg)
      ]);
      // Tautology check: if resolvent contains both L and ~L, skip
      if (!isTautology(resolvent)) {
        resolvents.push(resolvent);
      }
    }
  }
  return resolvents;
}

function negateLiteral(lit) {
  return lit.startsWith('~') ? lit.slice(1) : '~' + lit;
}

function isTautology(clause) {
  for (const lit of clause) {
    if (clause.has(negateLiteral(lit))) return true;
  }
  return false;
}

function clauseKey(clause) {
  return [...clause].sort().join('|');
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
