import type { RowModel } from './layout';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SWIMLANE_WIDTH = 14;
const SWIMLANE_HEIGHT = 22;
const CIRCLE_RADIUS = 4;
const CIRCLE_STROKE_WIDTH = 2;
const CURVE_RADIUS = 5;

export function renderRowGraph(row: RowModel): SVGSVGElement {
  const maxLane = Math.max(row.lane, row.parentLane ?? 0, ...row.passThrough.map(({ lane }) => lane));
  const width = SWIMLANE_WIDTH * (maxLane + 2);
  const svg = document.createElementNS(SVG_NS, 'svg');

  svg.setAttribute('class', 'graph');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(SWIMLANE_HEIGHT));
  svg.setAttribute('viewBox', `0 0 ${width} ${SWIMLANE_HEIGHT}`);

  const laneX = (lane: number): number => SWIMLANE_WIDTH * (lane + 1);
  const midY = SWIMLANE_HEIGHT / 2;
  const verticalLines = new Map<number, string>(row.passThrough.map(({ lane, color }) => [lane, color]));

  verticalLines.set(row.lane, row.laneColor);

  if (row.kind === 'commit') {
    for (const [lane, color] of verticalLines) {
      if (lane === row.lane) {
        continue;
      }

      svg.append(createVerticalPath(laneX(lane), color, 0, SWIMLANE_HEIGHT));
    }

    const currentLaneX = laneX(row.lane);
    if (row.hasTop) {
      svg.append(createVerticalPath(currentLaneX, row.laneColor, 0, midY));
    }
    if (row.hasBottom) {
      svg.append(createVerticalPath(currentLaneX, row.laneColor, midY, SWIMLANE_HEIGHT));
    }

    svg.append(createCircle(currentLaneX, midY, CIRCLE_RADIUS + 1, row.laneColor, CIRCLE_STROKE_WIDTH));

    if (row.isCurrent) {
      svg.append(createCircle(currentLaneX, midY, CIRCLE_RADIUS - 1, row.laneColor));
    }
  } else {
    for (const [lane, color] of verticalLines) {
      if (lane === row.lane) {
        continue;
      }

      svg.append(createVerticalPath(laneX(lane), color, 0, SWIMLANE_HEIGHT));
    }

    const currentLaneX = laneX(row.lane);
    const parentLaneX = laneX(row.parentLane ?? 0);
    const path = createPath(row.laneColor);

    if (row.parentLane !== undefined && row.parentLane < row.lane) {
      path.setAttribute(
        'd',
        [
          `M ${currentLaneX} 0`,
          `V ${midY - CURVE_RADIUS}`,
          `A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 1 ${currentLaneX - CURVE_RADIUS} ${midY}`,
          `H ${parentLaneX + CURVE_RADIUS}`,
          `A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 0 ${parentLaneX} ${midY + CURVE_RADIUS}`,
          `V ${SWIMLANE_HEIGHT}`,
        ].join(' ')
      );
    } else {
      path.setAttribute('d', `M ${currentLaneX} 0 V ${SWIMLANE_HEIGHT}`);
    }

    svg.append(path);
  }

  return svg;
}

function createVerticalPath(x: number, color: string, fromY: number, toY: number): SVGPathElement {
  const path = createPath(color);
  path.setAttribute('d', `M ${x} ${fromY} V ${toY}`);
  return path;
}

function createPath(color: string, strokeWidth = 1.5): SVGPathElement {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-width', String(strokeWidth));
  path.setAttribute('stroke-linecap', 'round');
  path.style.stroke = color;
  return path;
}

function createCircle(
  cx: number,
  cy: number,
  radius: number,
  fill?: string,
  strokeWidth = 0
): SVGCircleElement {
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', String(cx));
  circle.setAttribute('cy', String(cy));
  circle.setAttribute('r', String(radius));
  circle.setAttribute('stroke-width', String(strokeWidth));

  if (fill) {
    circle.style.fill = fill;
  }

  return circle;
}
