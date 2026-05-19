import { useEffect, useMemo } from 'react';
import type { StateMachineNode, State, StateTransition } from '@diagram/parser';

type Props = {
  machine: StateMachineNode | null;
  onClose: () => void;
};

type LaidOutState = {
  state: State;
  depth: number;
  col: number;
  x: number;
  y: number;
};

const NODE_W = 160;
const NODE_H = 44;
const COL_GAP = 80;
const ROW_GAP = 100;
const TOP_PAD = 30;
const LEFT_PAD = 30;
const RIGHT_PAD = 30;
const SIDE_LANE_GAP = 18;
const BACK_LANE_GAP = 30;
const LABEL_CHAR_W = 6.6;
const LABEL_PAD_X = 6;
const LABEL_H = 16;

type EdgeKind = 'forward' | 'sideways' | 'back';

type RawEdge = {
  from: LaidOutState;
  to: LaidOutState;
  trigger: StateTransition;
  kind: EdgeKind;
};

type Route = RawEdge & {
  path: string;
  labelX: number;
  labelY: number;
};

function layout(machine: StateMachineNode): { laid: Map<string, LaidOutState>; width: number; height: number; maxX: number; maxY: number } {
  const byName = new Map(machine.states.map(s => [s.name, s] as const));
  const depths = new Map<string, number>();
  const initial = machine.states.find(s => s.initial);
  const queue: string[] = [];
  if (initial) {
    depths.set(initial.name, 0);
    queue.push(initial.name);
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = depths.get(cur)!;
    const s = byName.get(cur);
    if (!s) continue;
    for (const tr of s.transitions) {
      if (!byName.has(tr.target)) continue;
      if (!depths.has(tr.target)) {
        depths.set(tr.target, d + 1);
        queue.push(tr.target);
      }
    }
  }
  let maxDepth = -1;
  for (const d of depths.values()) maxDepth = Math.max(maxDepth, d);
  const unreachableDepth = maxDepth + 1;
  for (const s of machine.states) {
    if (!depths.has(s.name)) depths.set(s.name, unreachableDepth);
  }

  const byDepth = new Map<number, State[]>();
  for (const s of machine.states) {
    const d = depths.get(s.name)!;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(s);
  }

  const laid = new Map<string, LaidOutState>();
  let maxCols = 0;
  const sortedDepths = [...byDepth.keys()].sort((a, b) => a - b);
  for (const d of sortedDepths) {
    const states = byDepth.get(d)!;
    maxCols = Math.max(maxCols, states.length);
    states.forEach((s, col) => {
      laid.set(s.name, {
        state: s,
        depth: d,
        col,
        x: LEFT_PAD + col * (NODE_W + COL_GAP),
        y: TOP_PAD + d * (NODE_H + ROW_GAP),
      });
    });
  }
  const maxX = LEFT_PAD + (maxCols - 1) * (NODE_W + COL_GAP) + NODE_W;
  const maxY = TOP_PAD + (sortedDepths.length - 1) * (NODE_H + ROW_GAP) + NODE_H;
  return { laid, width: maxX, height: maxY, maxX, maxY };
}

function bezierPoint(
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  t: number,
): { x: number; y: number } {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
    y: mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3,
  };
}

function buildRoutes(machine: StateMachineNode, laid: Map<string, LaidOutState>): { routes: Route[]; extraRight: number; extraBottom: number } {
  const raw: RawEdge[] = [];
  for (const s of machine.states) {
    const from = laid.get(s.name);
    if (!from) continue;
    for (const tr of s.transitions) {
      const to = laid.get(tr.target);
      if (!to) continue;
      let kind: EdgeKind;
      if (to.depth > from.depth) kind = 'forward';
      else if (to.depth === from.depth) kind = 'sideways';
      else kind = 'back';
      raw.push({ from, to, trigger: tr, kind });
    }
  }

  const forwardBySource = new Map<string, RawEdge[]>();
  const forwardByTarget = new Map<string, RawEdge[]>();
  for (const e of raw) {
    if (e.kind !== 'forward') continue;
    if (!forwardBySource.has(e.from.state.name)) forwardBySource.set(e.from.state.name, []);
    forwardBySource.get(e.from.state.name)!.push(e);
    if (!forwardByTarget.has(e.to.state.name)) forwardByTarget.set(e.to.state.name, []);
    forwardByTarget.get(e.to.state.name)!.push(e);
  }
  const srcPort = new Map<RawEdge, { i: number; n: number }>();
  for (const group of forwardBySource.values()) {
    group.sort((a, b) => a.to.col - b.to.col);
    group.forEach((e, i) => srcPort.set(e, { i, n: group.length }));
  }
  const tgtPort = new Map<RawEdge, { i: number; n: number }>();
  for (const group of forwardByTarget.values()) {
    group.sort((a, b) => a.from.col - b.from.col);
    group.forEach((e, i) => tgtPort.set(e, { i, n: group.length }));
  }

  const sidewaysBySource = new Map<string, RawEdge[]>();
  for (const e of raw) {
    if (e.kind !== 'sideways') continue;
    if (!sidewaysBySource.has(e.from.state.name)) sidewaysBySource.set(e.from.state.name, []);
    sidewaysBySource.get(e.from.state.name)!.push(e);
  }
  const sideLane = new Map<RawEdge, number>();
  for (const group of sidewaysBySource.values()) {
    // Deeper lane for longer arcs so they don't intersect shorter ones at apex.
    group.sort((a, b) => Math.abs(b.to.col - b.from.col) - Math.abs(a.to.col - a.from.col));
    group.forEach((e, i) => sideLane.set(e, i));
  }

  const backEdges = raw.filter(e => e.kind === 'back');
  const backLane = new Map<RawEdge, number>();
  backEdges.forEach((e, i) => backLane.set(e, i));

  const routes: Route[] = [];
  let extraRight = 0;
  let extraBottom = 0;

  for (const e of raw) {
    if (e.kind === 'forward') {
      const sp = srcPort.get(e)!;
      const tp = tgtPort.get(e)!;
      const exitX = e.from.x + (NODE_W * (sp.i + 1)) / (sp.n + 1);
      const exitY = e.from.y + NODE_H;
      const entryX = e.to.x + (NODE_W * (tp.i + 1)) / (tp.n + 1);
      const entryY = e.to.y;
      const dy = (entryY - exitY) * 0.55;
      const c1x = exitX;
      const c1y = exitY + dy;
      const c2x = entryX;
      const c2y = entryY - dy;
      const path = `M ${exitX} ${exitY} C ${c1x} ${c1y} ${c2x} ${c2y} ${entryX} ${entryY}`;
      const t = sp.n > 1 ? 0.25 : tp.n > 1 ? 0.75 : 0.5;
      const pt = bezierPoint(exitX, exitY, c1x, c1y, c2x, c2y, entryX, entryY, t);
      routes.push({ ...e, path, labelX: pt.x, labelY: pt.y });
    } else if (e.kind === 'sideways') {
      const lane = sideLane.get(e) ?? 0;
      const goingRight = e.to.col > e.from.col;
      const fromX = goingRight ? e.from.x + NODE_W : e.from.x;
      const toX = goingRight ? e.to.x : e.to.x + NODE_W;
      const fromY = e.from.y + NODE_H / 2;
      const toY = e.to.y + NODE_H / 2;
      const dipY = e.from.y + NODE_H + 16 + lane * SIDE_LANE_GAP;
      extraBottom = Math.max(extraBottom, dipY - (e.from.y + NODE_H) + 24);
      const c1x = fromX + (goingRight ? 24 : -24);
      const c2x = toX + (goingRight ? -24 : 24);
      const path = `M ${fromX} ${fromY} C ${c1x} ${dipY} ${c2x} ${dipY} ${toX} ${toY}`;
      const pt = bezierPoint(fromX, fromY, c1x, dipY, c2x, dipY, toX, toY, 0.5);
      routes.push({ ...e, path, labelX: pt.x, labelY: pt.y });
    } else {
      const lane = backLane.get(e) ?? 0;
      const fromX = e.from.x + NODE_W;
      const fromY = e.from.y + NODE_H / 2;
      const toX = e.to.x + NODE_W;
      const toY = e.to.y + NODE_H / 2;
      const bend = Math.max(fromX, toX) + 40 + lane * BACK_LANE_GAP;
      extraRight = Math.max(extraRight, bend - Math.max(fromX, toX) + 30);
      const path = `M ${fromX} ${fromY} C ${bend} ${fromY} ${bend} ${toY} ${toX} ${toY}`;
      const pt = bezierPoint(fromX, fromY, bend, fromY, bend, toY, toX, toY, 0.5);
      routes.push({ ...e, path, labelX: pt.x, labelY: pt.y });
    }
  }
  return { routes, extraRight, extraBottom };
}

function uniqueTriggers(machine: StateMachineNode): { trigger: string; comment?: string }[] {
  const seen = new Map<string, { trigger: string; comment?: string }>();
  for (const s of machine.states) {
    for (const tr of s.transitions) {
      const existing = seen.get(tr.trigger);
      if (!existing) {
        seen.set(tr.trigger, { trigger: tr.trigger, comment: tr.comment });
      } else if (!existing.comment && tr.comment) {
        existing.comment = tr.comment;
      }
    }
  }
  return [...seen.values()];
}

export function StateMachineModal({ machine, onClose }: Props) {
  useEffect(() => {
    if (!machine) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [machine, onClose]);

  const computed = useMemo(() => {
    if (!machine) return null;
    const lay = layout(machine);
    const { routes, extraRight, extraBottom } = buildRoutes(machine, lay.laid);
    const width = lay.maxX + RIGHT_PAD + extraRight;
    const height = lay.maxY + 24 + extraBottom;
    return { laid: lay.laid, routes, width, height };
  }, [machine]);

  const triggers = useMemo(() => (machine ? uniqueTriggers(machine) : []), [machine]);

  if (!machine || !computed) return null;

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.headerTitle}>
            {machine.name} <span style={styles.headerSubtitle}>(drill-down)</span>
          </div>
          <button style={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>
        {machine.comment && <div style={styles.machineComment}>{machine.comment}</div>}
        <div style={styles.body}>
          <div style={styles.graphPane}>
            <svg width={computed.width} height={computed.height} style={{ display: 'block' }}>
              <defs>
                <marker id="sm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#7aa6d4" />
                </marker>
              </defs>

              {computed.routes.map((r, i) => (
                <path
                  key={`p-${i}`}
                  d={r.path}
                  stroke="#7aa6d4"
                  strokeWidth={1.4}
                  fill="none"
                  markerEnd="url(#sm-arrow)"
                />
              ))}

              {[...computed.laid.values()].map(({ state, x, y }) => {
                const initial = state.initial;
                const terminal = state.transitions.length === 0;
                const fill = initial ? '#274d6e' : terminal ? '#3a3a3a' : '#1f3a55';
                const stroke = initial ? '#5aa0d4' : terminal ? '#888' : '#3d6f9d';
                return (
                  <g key={`s-${state.name}`}>
                    <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={6} fill={fill} stroke={stroke} strokeWidth={1.5} />
                    <text
                      x={x + NODE_W / 2}
                      y={y + NODE_H / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={12}
                      fontFamily="monospace"
                      fontWeight={600}
                      fill="#e6edf3"
                    >
                      {state.name}
                    </text>
                  </g>
                );
              })}

              {computed.routes.map((r, i) => {
                const w = r.trigger.trigger.length * LABEL_CHAR_W + LABEL_PAD_X * 2;
                return (
                  <g key={`l-${i}`}>
                    <rect
                      x={r.labelX - w / 2}
                      y={r.labelY - LABEL_H / 2}
                      width={w}
                      height={LABEL_H}
                      rx={3}
                      fill="#0d1117"
                      stroke="#30363d"
                      strokeWidth={0.5}
                    />
                    <text
                      x={r.labelX}
                      y={r.labelY + 1}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={11}
                      fontFamily="monospace"
                      fill="#cfe2f3"
                    >
                      {r.trigger.trigger}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div style={styles.triggerPane}>
            <div style={styles.triggerPaneTitle}>Transition triggers</div>
            <div style={styles.triggerList}>
              {triggers.map(t => (
                <div key={t.trigger} style={styles.triggerItem}>
                  <div style={styles.triggerName}>{t.trigger}</div>
                  {t.comment && <div style={styles.triggerComment}>{t.comment}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 8,
    minWidth: 720,
    maxWidth: '90vw',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    color: '#e6edf3',
    fontFamily: 'monospace',
    boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px',
    borderBottom: '1px solid #30363d',
  },
  headerTitle: { fontSize: 15, fontWeight: 700, color: '#c9d1d9' },
  headerSubtitle: { fontSize: 12, fontWeight: 400, color: '#8b949e', marginLeft: 6 },
  closeBtn: {
    background: 'transparent',
    color: '#c9d1d9',
    border: 'none',
    fontSize: 22,
    cursor: 'pointer',
    padding: '0 6px',
    lineHeight: 1,
  },
  machineComment: {
    padding: '8px 16px',
    fontSize: 12,
    fontStyle: 'italic',
    color: '#8b949e',
    borderBottom: '1px solid #30363d',
    whiteSpace: 'pre-wrap',
  },
  body: {
    display: 'flex',
    flexDirection: 'row',
    minHeight: 0,
    overflow: 'hidden',
  },
  graphPane: {
    flex: 1,
    minWidth: 0,
    padding: 12,
    overflow: 'auto',
    background: '#0d1117',
  },
  triggerPane: {
    width: 240,
    padding: 12,
    borderLeft: '1px solid #30363d',
    overflowY: 'auto',
    background: '#0d1117',
  },
  triggerPaneTitle: {
    fontSize: 11,
    color: '#8b949e',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  triggerList: { display: 'flex', flexDirection: 'column', gap: 10 },
  triggerItem: { display: 'flex', flexDirection: 'column', gap: 2 },
  triggerName: { fontSize: 12, fontWeight: 700, color: '#c9d1d9' },
  triggerComment: { fontSize: 11, color: '#8b949e', whiteSpace: 'pre-wrap' },
};
