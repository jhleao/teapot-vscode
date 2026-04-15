import type { BranchNode, HostToWebview, StackState, WebviewToHost } from '../types';

declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewToHost): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
};

const vscode = acquireVsCodeApi();

const SWIMLANE_WIDTH = 14;
const SWIMLANE_HEIGHT = 22;
const CIRCLE_RADIUS = 4;
const CIRCLE_STROKE_WIDTH = 2;
const CURVE_RADIUS = 5;
const SVG_NS = 'http://www.w3.org/2000/svg';

const root = document.getElementById('root')!;

function send(msg: WebviewToHost) {
  vscode.postMessage(msg);
}

window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
  const msg = event.data;
  if (msg.type === 'stack') render(msg.state);
});

send({ type: 'ready' });

// ─── Stack ordering & lane assignment ────────────────────────────────────

interface RowModel {
  kind: 'branch-header' | 'commit';
  branchName: string;
  lane: number;
  laneColor: string;
  /** Lanes occupied through this row (vertical lines passing through). */
  passThrough: Array<{ lane: number; color: string }>;
  /** When this row is a branch-header, the parent branch's lane (for the curve). */
  parentLane?: number;
  parentColor?: string;
  commit?: { sha: string; subject: string; author: string };
  isCurrent: boolean;
  isBranchTip: boolean;
  isTrunk: boolean;
}

/**
 * Layout: walk each root (trunk) top-down, then recurse into children.
 * Each branch gets a persistent lane index; children nest into new lanes.
 * Output is an ordered list of rows from newest (top) to oldest (bottom).
 * We emit: branch header row, then its commits top-down. Children are emitted
 * ABOVE their parent branch (newer on top), so the visual stack reads top = tip.
 */
function layout(state: StackState): RowModel[] {
  const byName = new Map<string, BranchNode>();
  for (const b of state.branches) byName.set(b.name, b);

  const lanes = new Map<string, number>();
  const laneColors = [
    'var(--lane-color-1)',
    'var(--lane-color-2)',
    'var(--lane-color-3)',
    'var(--lane-color-4)',
    'var(--lane-color-5)',
  ];

  const colorOf = (name: string): string => {
    if (byName.get(name)?.isTrunk) return 'var(--base-color)';
    const lane = lanes.get(name) ?? 0;
    return laneColors[lane % laneColors.length];
  };

  const rows: RowModel[] = [];

  // Roots: trunk(s) and any branch with no parent
  const roots: string[] = [];
  for (const b of state.branches) {
    if (!b.parent) roots.push(b.name);
  }
  // Prefer trunk last (it will be at the bottom of the stack visually)
  roots.sort((a, b) => {
    const at = byName.get(a)?.isTrunk ? 1 : 0;
    const bt = byName.get(b)?.isTrunk ? 1 : 0;
    return at - bt;
  });

  /**
   * Recursively emit rows so that children appear ABOVE the parent branch.
   * Returns the set of lanes that must "pass through" any rows emitted below
   * this branch's header (because this branch continues upward past that point).
   */
  const emitBranch = (name: string, lane: number): void => {
    const node = byName.get(name);
    if (!node) return;
    lanes.set(name, lane);

    // First, emit all children (they sit above this branch)
    const children = node.children.slice();
    // Stable ordering: by name for determinism
    children.sort();
    let childLaneCursor = lane + 1;
    const childLaneAssignments: Array<{ name: string; lane: number }> = [];
    for (const childName of children) {
      const childLane = childLaneCursor++;
      childLaneAssignments.push({ name: childName, lane: childLane });
    }
    // Emit each child subtree in order (children higher up = last emitted first
    // so they land on top). Actually: we want siblings stacked in order, top = first.
    for (const { name: cn, lane: cl } of childLaneAssignments) {
      emitBranch(cn, cl);
    }

    // Now emit this branch's own rows (header + commits) — children's rows
    // have already been pushed (they sit above).
    const laneColor = colorOf(name);

    // Pass-through lanes: any ancestor branches whose lane is < our lane and
    // still "active" at this level. Also, while we're emitting our own rows,
    // siblings' lanes are no longer active (they ended above), but our parent
    // and earlier-emitted uncle chains pass through.
    // For simplicity, track pass-through as every active ancestor lane < our lane.
    // Compute ancestors of this node.
    const ancestorLanes: Array<{ lane: number; color: string }> = [];
    let p = node.parent;
    while (p) {
      const pl = lanes.get(p);
      if (pl !== undefined) ancestorLanes.push({ lane: pl, color: colorOf(p) });
      p = byName.get(p)?.parent ?? null;
    }

    // Branch header row (sits just above the first commit of this branch)
    const commits = node.commits;
    const parentName = node.parent;
    const parentLane = parentName ? lanes.get(parentName) : undefined;
    const parentColor = parentName ? colorOf(parentName) : undefined;

    // Emit commits top-to-bottom (newest first, matching git log order)
    for (let i = 0; i < commits.length; i++) {
      const c = commits[i];
      const isTip = i === 0;
      rows.push({
        kind: 'commit',
        branchName: name,
        lane,
        laneColor,
        passThrough: ancestorLanes,
        commit: { sha: c.sha, subject: c.subject, author: c.author },
        isCurrent: isTip && node.isCurrent,
        isBranchTip: isTip,
        isTrunk: !!node.isTrunk,
      });
    }

    // If this is NOT trunk, emit a divergence row: shows the parent-branch curve
    // joining its parent's lane. This sits below the last commit of this branch.
    if (parentName && parentLane !== undefined) {
      rows.push({
        kind: 'branch-header',
        branchName: name,
        lane,
        laneColor,
        passThrough: ancestorLanes,
        parentLane,
        parentColor,
        isCurrent: false,
        isBranchTip: false,
        isTrunk: false,
      });
    }
  };

  let laneCursor = 0;
  for (const r of roots) {
    emitBranch(r, laneCursor++);
  }

  return rows;
}

// ─── SVG drawing ─────────────────────────────────────────────────────────

function createPath(color: string, strokeWidth = 1.5): SVGPathElement {
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke-width', String(strokeWidth));
  p.setAttribute('stroke-linecap', 'round');
  p.style.stroke = color;
  return p;
}

function drawCircle(cx: number, cy: number, r: number, color?: string, strokeWidth = CIRCLE_STROKE_WIDTH): SVGCircleElement {
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('cx', String(cx));
  c.setAttribute('cy', String(cy));
  c.setAttribute('r', String(r));
  c.setAttribute('stroke-width', String(strokeWidth));
  if (color) c.style.fill = color;
  return c;
}

function buildRowSvg(row: RowModel, laneCount: number): SVGSVGElement {
  const width = SWIMLANE_WIDTH * (laneCount + 1);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'graph');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(SWIMLANE_HEIGHT));
  svg.setAttribute('viewBox', `0 0 ${width} ${SWIMLANE_HEIGHT}`);

  const laneX = (lane: number) => SWIMLANE_WIDTH * (lane + 1);
  const mid = SWIMLANE_HEIGHT / 2;

  // Vertical lines for every pass-through lane (ancestors) and this row's own lane.
  const verticals = new Map<number, string>();
  for (const a of row.passThrough) verticals.set(a.lane, a.color);
  verticals.set(row.lane, row.laneColor);

  if (row.kind === 'commit') {
    for (const [lane, color] of verticals) {
      const p = createPath(color, 1.5);
      p.setAttribute('d', `M ${laneX(lane)} 0 V ${SWIMLANE_HEIGHT}`);
      svg.append(p);
    }
    // Commit circle on this row's lane
    const x = laneX(row.lane);
    // Outer ring
    const outer = drawCircle(x, mid, CIRCLE_RADIUS + 1, row.laneColor, CIRCLE_STROKE_WIDTH);
    svg.append(outer);
    if (row.isCurrent) {
      // Hollow: second circle filled with background (current-branch tip)
      const inner = drawCircle(x, mid, CIRCLE_RADIUS - 1, row.laneColor);
      svg.append(inner);
    }
  } else if (row.kind === 'branch-header') {
    // This row represents the divergence: our lane curves down-left into parent's lane.
    // Pass-through verticals (ancestors) draw full verticals.
    for (const [lane, color] of verticals) {
      if (lane === row.lane) continue; // we draw a partial + curve instead
      const p = createPath(color, 1.5);
      p.setAttribute('d', `M ${laneX(lane)} 0 V ${SWIMLANE_HEIGHT}`);
      svg.append(p);
    }
    // Our lane: half vertical (top) then curve over to parent lane.
    const p = createPath(row.laneColor, 1.5);
    const ourX = laneX(row.lane);
    const parentX = laneX(row.parentLane ?? 0);
    if (row.parentLane !== undefined && row.parentLane < row.lane) {
      // Curve going down-left
      const d: string[] = [];
      d.push(`M ${ourX} 0`);
      d.push(`V ${mid - CURVE_RADIUS}`);
      d.push(`A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 1 ${ourX - CURVE_RADIUS} ${mid}`);
      d.push(`H ${parentX + CURVE_RADIUS}`);
      d.push(`A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 0 ${parentX} ${mid + CURVE_RADIUS}`);
      d.push(`V ${SWIMLANE_HEIGHT}`);
      p.setAttribute('d', d.join(' '));
      svg.append(p);
    } else {
      p.setAttribute('d', `M ${ourX} 0 V ${SWIMLANE_HEIGHT}`);
      svg.append(p);
    }
  }

  return svg;
}

// ─── DOM rendering ───────────────────────────────────────────────────────

function render(state: StackState) {
  root.innerHTML = '';

  if (state.error) {
    const e = document.createElement('div');
    e.className = 'empty error';
    e.textContent = state.error;
    root.appendChild(e);
    return;
  }

  if (!state.branches.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'No local branches found.';
    root.appendChild(e);
    return;
  }

  const rows = layout(state);
  const laneCount = rows.reduce((m, r) => Math.max(m, r.lane + 1, ...r.passThrough.map((p) => p.lane + 1)), 1);

  for (const row of rows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'row';
    if (row.isCurrent) rowEl.classList.add('current');
    if (row.kind === 'branch-header') rowEl.classList.add('branch-header');
    rowEl.style.setProperty('--lane-color', row.laneColor);

    const graphContainer = document.createElement('div');
    graphContainer.className = 'graph-container';
    if (row.isCurrent) graphContainer.classList.add('current');
    graphContainer.appendChild(buildRowSvg(row, laneCount));
    rowEl.appendChild(graphContainer);

    if (row.kind === 'commit' && row.isBranchTip) {
      const labels = document.createElement('div');
      labels.className = 'label-container';
      const branchLabel = document.createElement('span');
      branchLabel.className = 'label branch';
      if (row.isCurrent) branchLabel.classList.add('current');
      const icon = document.createElement('span');
      icon.className = 'codicon codicon-git-branch';
      branchLabel.appendChild(icon);
      const labelText = document.createElement('span');
      labelText.textContent = row.branchName;
      branchLabel.appendChild(labelText);
      labels.appendChild(branchLabel);
      rowEl.appendChild(labels);
    }

    const subject = document.createElement('span');
    subject.className = 'subject';
    if (row.kind === 'commit' && row.commit) {
      subject.textContent = row.commit.subject;
      subject.title = `${row.commit.sha.slice(0, 7)}  ${row.commit.subject}\n${row.commit.author}`;
    } else if (row.kind === 'branch-header') {
      subject.textContent = '';
    }
    rowEl.appendChild(subject);

    root.appendChild(rowEl);
  }
}
