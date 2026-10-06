import type { Candidate } from "./types";

/**
 * Global award allocation as a min-cost flow problem.
 *
 *   source ──(3 parallel edges, cost −3, −2, −1)──► player
 *   player ──(cap 1 per family)──────────────────► (player, family)
 *   (player, family) ──(cap 1, cost −score)──────► metric
 *   metric ──(cap 1)─────────────────────────────► sink
 *
 * - metric → sink capacity 1: each metric (and so each award title,
 *   high OR low) goes to at most one player.
 * - player ← source: at most `perPlayer` awards. The decreasing slot bonuses
 *   (3, 2, 1 — all larger than any score, which is ≤ 1) mean the solver
 *   always prefers giving someone their FIRST award over giving another
 *   player a third, and always prefers more awards over fewer.
 * - (player, family) capacity 1: no player gets two awards from the same
 *   family (e.g. two death awards).
 *
 * Successive shortest paths (Bellman-Ford, since costs are negative) are
 * augmented while the cheapest path still has negative cost. Min-cost flow
 * cost is convex in the flow value, so stopping at the first non-negative
 * path gives the global optimum — unlike a greedy pass, it will move an
 * award from one player to another if that lets the server as a whole do
 * better.
 */

export function allocateAwards(candidates: readonly Candidate[], perPlayer = 3): Candidate[] {
  if (perPlayer <= 0 || candidates.length === 0) return [];
  const ordered = [...candidates].sort(
    (a, b) => a.metricId.localeCompare(b.metricId) || a.playerKey.localeCompare(b.playerKey) || a.direction.localeCompare(b.direction),
  );

  const graph = new FlowGraph();
  const S = graph.node();
  const T = graph.node();
  const playerNode = new Map<string, number>();
  const familyNode = new Map<string, number>();
  const metricNode = new Map<string, number>();

  for (const c of ordered) {
    if (!playerNode.has(c.playerKey)) {
      const p = graph.node();
      playerNode.set(c.playerKey, p);
      for (let slot = 0; slot < perPlayer; slot++) graph.edge(S, p, 1, -(perPlayer - slot));
    }
    const fk = `${c.playerKey}\u0000${c.family}`;
    if (!familyNode.has(fk)) {
      const f = graph.node();
      familyNode.set(fk, f);
      graph.edge(playerNode.get(c.playerKey)!, f, 1, 0);
    }
    if (!metricNode.has(c.metricId)) {
      const m = graph.node();
      metricNode.set(c.metricId, m);
      graph.edge(m, T, 1, 0);
    }
  }
  const candidateEdge = ordered.map((c) => graph.edge(familyNode.get(`${c.playerKey}\u0000${c.family}`)!, metricNode.get(c.metricId)!, 1, -c.score));

  graph.minCostFlow(S, T);
  return ordered.filter((_, i) => graph.flowOn(candidateEdge[i]!) > 0);
}

/** Small residual-graph min-cost flow (successive shortest paths, Bellman-Ford). */
class FlowGraph {
  private to: number[] = [];
  private cap: number[] = [];
  private cost: number[] = [];
  private adj: number[][] = [];

  node(): number {
    this.adj.push([]);
    return this.adj.length - 1;
  }

  /** Returns the forward edge index. */
  edge(u: number, v: number, capacity: number, cost: number): number {
    const e = this.to.length;
    this.to.push(v, u);
    this.cap.push(capacity, 0);
    this.cost.push(cost, -cost);
    this.adj[u]!.push(e);
    this.adj[v]!.push(e + 1);
    return e;
  }

  flowOn(e: number): number {
    return this.cap[e ^ 1]!;
  }

  minCostFlow(s: number, t: number): void {
    const n = this.adj.length;
    for (;;) {
      const dist = new Array<number>(n).fill(Infinity);
      const prevEdge = new Array<number>(n).fill(-1);
      dist[s] = 0;
      for (let iter = 0; iter < n; iter++) {
        let changed = false;
        for (let u = 0; u < n; u++) {
          if (dist[u] === Infinity) continue;
          for (const e of this.adj[u]!) {
            if (this.cap[e]! <= 0) continue;
            const v = this.to[e]!;
            const nd = dist[u]! + this.cost[e]!;
            if (nd < dist[v]! - 1e-12) {
              dist[v] = nd;
              prevEdge[v] = e;
              changed = true;
            }
          }
        }
        if (!changed) break;
      }
      if (dist[t] === Infinity || dist[t]! >= -1e-12) return;
      // Every capacity here is 1, so each augmentation pushes one unit.
      for (let v = t; v !== s; v = this.to[prevEdge[v]! ^ 1]!) {
        const e = prevEdge[v]!;
        this.cap[e]!--;
        this.cap[e ^ 1]!++;
      }
    }
  }
}
