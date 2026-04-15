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
  commit?: { sha: string; message: string; author: string };
  isCurrent: boolean;
  isBranchTip: boolean;
  isTrunk: boolean;
  /** Whether the row's own lane has a connector reaching up to the row above. */
  hasTop: boolean;
  /** Whether the row's own lane has a connector reaching down to the row below. */
  hasBottom: boolean;
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
  for (const b of state.branches) byName.set(b.ref, b);

  // Teapot-style: muted gray for trunk + branches. Current branch gets accent.
  // Pulled from --vscode-descriptionForeground to match the commit subject text
  // color for visual consistency.
  const GRAPH_COLOR = 'var(--vscode-descriptionForeground, #858585)';
  const TRUNK_COLOR = 'var(--vscode-descriptionForeground, #858585)';
  const CURRENT_COLOR = 'var(--vscode-focusBorder, var(--vscode-button-background, #007fd4))';

  // Lane 0 = trunk, lane 1 = all branches (siblings share the lane; they never
  // overlap in output since each branch's subtree is fully emitted before the
  // next sibling starts).
  const laneOf = (name: string): number => (byName.get(name)?.isTrunk ? 0 : 1);
  const colorOf = (name: string): string => {
    const b = byName.get(name);
    if (b?.isCurrent) return CURRENT_COLOR;
    return b?.isTrunk ? TRUNK_COLOR : GRAPH_COLOR;
  };

  // Walk from the current branch up to root and collect the ancestor chain.
  // Children that contain current/ancestors are sorted first so that the
  // current branch ends up at the TOP of the rendered output.
  const currentChain = new Set<string>();
  if (state.current) {
    let p: string | null = state.current;
    while (p) {
      currentChain.add(p);
      p = byName.get(p)?.parent ?? null;
    }
  }
  const subtreeContainsCurrent = new Map<string, boolean>();
  const containsCurrent = (name: string): boolean => {
    if (subtreeContainsCurrent.has(name)) return subtreeContainsCurrent.get(name)!;
    if (currentChain.has(name)) {
      subtreeContainsCurrent.set(name, true);
      return true;
    }
    const node = byName.get(name);
    const has = node ? node.children.some(containsCurrent) : false;
    subtreeContainsCurrent.set(name, has);
    return has;
  };

  const rows: RowModel[] = [];

  const roots: string[] = state.branches.filter((b) => !b.parent).map((b) => b.ref);
  // Trunk last so it renders at the bottom of the stack visually.
  roots.sort((a, b) => {
    const at = byName.get(a)?.isTrunk ? 1 : 0;
    const bt = byName.get(b)?.isTrunk ? 1 : 0;
    return at - bt;
  });

  const emitBranch = (name: string): void => {
    const node = byName.get(name);
    if (!node) return;

    // Emission order: first-emitted children land at the top of the rendered
    // output (we push children before self; FIFO order = top-down). So sort
    // the subtree containing the current branch FIRST so it appears at top.
    const children = node.children.slice().sort((a, b) => {
      const ac = containsCurrent(a) ? 0 : 1;
      const bc = containsCurrent(b) ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return a.localeCompare(b);
    });
    for (const childName of children) emitBranch(childName);

    const lane = laneOf(name);
    const laneColor = colorOf(name);
    const parentName = node.parent;
    const parentLane = parentName ? laneOf(parentName) : undefined;
    const parentColor = parentName ? colorOf(parentName) : undefined;

    // Pass-through: only trunk (lane 0) passes through non-trunk rows, because
    // all branches share lane 1. No deeper pass-through.
    const ancestorLanes: Array<{ lane: number; color: string }> =
      node.isTrunk ? [] : [{ lane: 0, color: TRUNK_COLOR }];

    // Top connection on the tip commit: true only if this branch has children
    // that were emitted above it. Otherwise the tip is "stack top" — the
    // vertical line ends at the circle (teapot-style).
    const hasChildrenAbove = node.children.length > 0;

    // Bottom connection on the last commit: true if something connects below
    // (either a branch-header row we'll emit, or — for trunk — more commits).
    const willEmitHeader = !!parentName && parentLane !== undefined && parentLane !== lane;

    const commits = node.commits;
    if (commits.length === 0) {
      rows.push({
        kind: 'commit', branchName: name, lane, laneColor,
        passThrough: ancestorLanes, commit: undefined,
        isCurrent: node.isCurrent, isBranchTip: true, isTrunk: !!node.isTrunk,
        hasTop: hasChildrenAbove,
        hasBottom: willEmitHeader || !!parentName,
      });
    } else {
      for (let i = 0; i < commits.length; i++) {
        const c = commits[i];
        const isTip = i === 0;
        const isLast = i === commits.length - 1;
        rows.push({
          kind: 'commit', branchName: name, lane, laneColor,
          passThrough: ancestorLanes,
          commit: { sha: c.sha, message: c.message, author: c.author },
          isCurrent: isTip && node.isCurrent,
          isBranchTip: isTip, isTrunk: !!node.isTrunk,
          hasTop: isTip ? hasChildrenAbove : true,
          hasBottom: isLast ? (willEmitHeader || !!parentName) : true,
        });
      }
    }

    if (willEmitHeader) {
      rows.push({
        kind: 'branch-header', branchName: name, lane, laneColor,
        passThrough: ancestorLanes, parentLane, parentColor,
        isCurrent: false, isBranchTip: false, isTrunk: false,
        hasTop: true, hasBottom: true,
      });
    }
  };

  for (const r of roots) emitBranch(r);

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

function buildRowSvg(row: RowModel, _laneCount: number): SVGSVGElement {
  // Per-row width: only as wide as this row's own lane needs.
  // Ancestor pass-through lanes are always < row.lane, so they fit in this width.
  const maxLaneInRow = Math.max(
    row.lane,
    ...row.passThrough.map((p) => p.lane),
    row.parentLane ?? 0
  );
  const width = SWIMLANE_WIDTH * (maxLaneInRow + 2);
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
    // Pass-through lanes: always full-height verticals (they're continuation
    // lines of OTHER lanes that don't terminate at this row's circle).
    for (const [lane, color] of verticals) {
      if (lane === row.lane) continue;
      const p = createPath(color, 1.5);
      p.setAttribute('d', `M ${laneX(lane)} 0 V ${SWIMLANE_HEIGHT}`);
      svg.append(p);
    }
    // Our own lane: draw only the segments that connect to neighbors above/below
    // the circle. A stack-tip commit has no top connection → line stops at circle.
    const x = laneX(row.lane);
    if (row.hasTop) {
      const p = createPath(row.laneColor, 1.5);
      p.setAttribute('d', `M ${x} 0 V ${mid}`);
      svg.append(p);
    }
    if (row.hasBottom) {
      const p = createPath(row.laneColor, 1.5);
      p.setAttribute('d', `M ${x} ${mid} V ${SWIMLANE_HEIGHT}`);
      svg.append(p);
    }
    // Circle
    const outer = drawCircle(x, mid, CIRCLE_RADIUS + 1, row.laneColor, CIRCLE_STROKE_WIDTH);
    svg.append(outer);
    if (row.isCurrent) {
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

const BUILD_TAG = 'v0.0.9 build-' + Date.now().toString(36);

function pickReadableTextColor(hex: string): string {
  // Strip '#', compute luminance, return dark text on light bg and vice versa.
  const h = hex.replace('#', '');
  if (h.length !== 6) return '#000';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? '#0b0b0b' : '#fafafa';
}

function render(state: StackState) {
  root.innerHTML = '';

  const tag = document.createElement('div');
  tag.style.cssText = 'position:sticky;top:0;padding:2px 8px;font-size:10px;color:var(--vscode-descriptionForeground);background:var(--vscode-sideBar-background);z-index:10;opacity:0.7;';
  tag.textContent = BUILD_TAG;
  root.appendChild(tag);

  const debugLine = document.createElement('div');
  debugLine.style.cssText = 'padding:2px 8px;font-size:10px;color:#0f0;background:#002200;z-index:10;';
  root.appendChild(debugLine);
  let labelsRendered = 0;

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
      labelsRendered++;
      const labels = document.createElement('div');
      labels.className = 'label-container';
      labels.style.cssText = 'display:flex;flex-shrink:0;margin-left:6px;gap:4px;';
      const branchLabel = document.createElement('span');
      branchLabel.className = 'label branch';
      const isCurrent = row.isCurrent;
      if (isCurrent) branchLabel.classList.add('current');
      // Teapot-style: neutral outlined pill for all, solid accent for current.
      const style = isCurrent
        ? `
            background:var(--vscode-button-background, #0e639c);
            color:var(--vscode-button-foreground, #ffffff);
            border:1px solid var(--vscode-button-background, #0e639c);
            font-weight:600;
          `
        : `
            background:var(--vscode-button-secondaryBackground, #3a3d41);
            color:var(--vscode-button-secondaryForeground, #e0e0e0);
            border:1px solid var(--vscode-button-secondaryBackground, #3a3d41);
            font-weight:400;
          `;
      branchLabel.style.cssText = `
        display:inline-flex;align-items:center;gap:4px;
        padding:0 6px;height:16px;line-height:14px;border-radius:4px;
        font-size:11px;
        max-width:260px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;
        ${style}
      `;
      const labelText = document.createElement('span');
      labelText.textContent = row.branchName;
      labelText.style.overflow = 'hidden';
      labelText.style.textOverflow = 'ellipsis';
      branchLabel.appendChild(labelText);
      labels.appendChild(branchLabel);
      rowEl.appendChild(labels);
    }

    const subject = document.createElement('span');
    subject.className = 'subject';
    if (row.kind === 'commit' && row.commit) {
      subject.textContent = row.commit.message;
      subject.title = `${row.commit.sha.slice(0, 7)}  ${row.commit.message}\n${row.commit.author}`;
    } else if (row.kind === 'branch-header') {
      subject.textContent = '';
    }
    rowEl.appendChild(subject);

    root.appendChild(rowEl);
  }

  debugLine.textContent = `DEBUG: branches=${state.branches.length} rows=${rows.length} lanes=${laneCount} labels=${labelsRendered}`;
}
