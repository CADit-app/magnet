import { defineParams } from '@cadit-app/script-params';
import { Manifold, CrossSection } from 'manifold-3d/manifoldCAD';
import { makeCrossSection } from '@cadit-app/image-extrude';

/**
 * Extract top-level character CrossSections while keeping inner holes (e.g., O, A, B, P, R, 8)
 * attached to their parent outer boundary.
 */
function extractCharacterCrossSections(fullCrossSection) {
  const rawParts = fullCrossSection.decompose();
  if (!rawParts || rawParts.length === 0) return [];

  const items = rawParts
    .map((cs) => {
      const b = cs.bounds();
      const w = b.max[0] - b.min[0];
      const h = b.max[1] - b.min[1];
      const area = Math.abs(cs.area());
      return { cs, b, w, h, area };
    })
    .filter((it) => it.w >= 2 && it.h >= 2 && it.area > 0.5);

  if (items.length === 0) return [];

  items.sort((a, b) => b.area - a.area);

  const outerSolids = [];

  for (const item of items) {
    let isHoleInsideExisting = false;

    for (const outer of outerSolids) {
      const strictlyInsideBounds =
        item.b.min[0] > outer.b.min[0] &&
        item.b.max[0] < outer.b.max[0] &&
        item.b.min[1] > outer.b.min[1] &&
        item.b.max[1] < outer.b.max[1];

      if (!strictlyInsideBounds) continue;

      const centerX = (item.b.min[0] + item.b.max[0]) / 2;
      const centerY = (item.b.min[1] + item.b.max[1]) / 2;
      const withinOuter =
        centerX > outer.b.min[0] &&
        centerX < outer.b.max[0] &&
        centerY > outer.b.min[1] &&
        centerY < outer.b.max[1];

      if (withinOuter && item.area < outer.area * 0.65) {
        outer.cs = outer.cs.subtract(item.cs);
        isHoleInsideExisting = true;
        break;
      }
    }

    if (!isHoleInsideExisting) {
      outerSolids.push({ ...item, cs: item.cs });
    }
  }

  return outerSolids.map((o) => o.cs);
}

/**
 * Evaluates a candidate pocket at (x, y) on the 2D character CrossSection.
 * Strictly rejects pockets that overhang the character edge or sit mostly in empty space.
 */
function evaluateCircle2D(cs, x, y, radius, margin) {
  const circle = CrossSection.circle(radius, 28).translate([x, y]);
  const circleArea = Math.PI * radius * radius;
  if (circleArea <= 0) return { valid: false, strictMargin: false, score: 0 };

  const insideArea = Math.abs(cs.intersect(circle).area());
  const fillRatio = insideArea / circleArea;

  // Pocket itself must sit almost completely inside solid plastic (no hanging off edges)
  if (fillRatio < 0.97) {
    return { valid: false, strictMargin: false, score: 0 };
  }

  const ringRadius = radius + Math.max(0.25, margin);
  const ring = CrossSection.circle(ringRadius, 28).translate([x, y]);
  const ringArea = Math.PI * ringRadius * ringRadius;
  const ringRatio = ringArea > 0 ? Math.abs(cs.intersect(ring).area()) / ringArea : 0;

  const strictMargin = ringRatio >= 0.95;
  const score = fillRatio * 0.55 + ringRatio * 0.45;

  return { valid: true, strictMargin, score };
}

/**
 * Generates candidate Y values using a percentage offset down from the top of the character.
 * topOffsetPercent = 10 means 10% down from top (90% up from bottom).
 */
function getPercentageYList(sb, topOffsetPercent, radius) {
  const height = sb.max[1] - sb.min[1];
  const minSafeY = sb.min[1] + radius;
  const maxSafeY = sb.max[1] - radius;
  if (height <= 0 || maxSafeY < minSafeY) return [];

  const offsetDeltas = [0, 4, -4, 8, -8, 14, -14, 22, -22, 32, -32];
  const seen = new Set();
  const ys = [];

  for (let i = 0; i < offsetDeltas.length; i++) {
    const pctFromTop = Math.max(0, Math.min(100, topOffsetPercent + offsetDeltas[i]));
    const heightFractionFromBottom = 1 - pctFromTop / 100;
    const rawY = sb.min[1] + height * heightFractionFromBottom;
    const y = Math.max(minSafeY, Math.min(maxSafeY, rawY));

    const key = y.toFixed(2);
    if (seen.has(key)) continue;
    seen.add(key);

    const proximityBonus = 1 - Math.min(1, Math.abs(offsetDeltas[i]) / 40);
    ys.push({ y, proximityBonus });
  }

  return ys;
}

/**
 * Finds a horizontal pair [[ -dx, y ], [ dx, y ]] at the same Y near the
 * requested top percentage if 2 magnets fit cleanly with safe spacing and no overhang.
 */
function findHorizontalPair(cs, sb, topOffsetPercent, radius, margin) {
  const width = sb.max[0] - sb.min[0];
  const minCenterDist = Math.max(radius * 2.4, radius * 2 + Math.max(0.8, margin * 0.7));
  const minDx = minCenterDist / 2;
  const maxDx = width / 2 - radius;

  if (maxDx < minDx) return null;

  const yList = getPercentageYList(sb, topOffsetPercent, radius);
  const steps = 6;

  let bestStrictPair = null;
  let bestStrictScore = -Infinity;
  let bestAnyPair = null;
  let bestAnyScore = -Infinity;

  for (const { y, proximityBonus } of yList) {
    for (let s = steps; s >= 0; s--) {
      const t = steps === 0 ? 1 : s / steps;
      const dx = minDx + (maxDx - minDx) * t;

      const left = evaluateCircle2D(cs, -dx, y, radius, margin);
      const right = evaluateCircle2D(cs, dx, y, radius, margin);

      if (left.valid && right.valid) {
        const spreadBonus = (dx / Math.max(1, width / 2)) * 0.1;
        const score = (left.score + right.score) / 2 + proximityBonus * 0.3 + spreadBonus;

        if (left.strictMargin && right.strictMargin) {
          if (score > bestStrictScore) {
            bestStrictScore = score;
            bestStrictPair = [
              [-dx, y],
              [dx, y],
            ];
          }
        } else if (score > bestAnyScore) {
          bestAnyScore = score;
          bestAnyPair = [
            [-dx, y],
            [dx, y],
          ];
        }
      }
    }
  }

  return bestStrictPair || bestAnyPair;
}

/**
 * Finds the best single magnet position [[x, y]] near the requested top percentage
 * that does not overhang the character edge.
 */
function findSingleMagnet(cs, sb, topOffsetPercent, radius, margin) {
  const width = sb.max[0] - sb.min[0];
  const yList = getPercentageYList(sb, topOffsetPercent, radius);
  const maxXOffset = Math.max(0, width / 2 - radius);
  const xOffsets = [
    0,
    -maxXOffset * 0.3,
    maxXOffset * 0.3,
    -maxXOffset * 0.6,
    maxXOffset * 0.6,
    -maxXOffset * 0.85,
    maxXOffset * 0.85,
  ];

  let bestStrict = null;
  let bestStrictScore = -Infinity;
  let bestAny = null;
  let bestAnyScore = -Infinity;

  for (const { y, proximityBonus } of yList) {
    for (const x of xOffsets) {
      const res = evaluateCircle2D(cs, x, y, radius, margin);
      if (!res.valid) continue;

      const centerBonus = (1 - Math.min(1, Math.abs(x) / Math.max(1, width / 2))) * 0.05;
      const score = res.score + proximityBonus * 0.3 + centerBonus;

      if (res.strictMargin) {
        if (score > bestStrictScore) {
          bestStrictScore = score;
          bestStrict = [x, y];
        }
      } else if (score > bestAnyScore) {
        bestAnyScore = score;
        bestAny = [x, y];
      }
    }
  }

  const chosen = bestStrict || bestAny;
  return chosen ? [chosen] : [];
}

export default defineParams({
  params: {
    image: {
      type: 'image',
      default: null,
      label: 'Upload black & white sheet',
    },
    mode: {
      type: 'choice',
      default: 'trace',
      options: [
        { value: 'trace', label: 'Trace (screenshots)' },
        { value: 'sample', label: 'Sample (SVG only)' },
      ],
      label: 'Mode',
    },
    targetWidth: {
      type: 'slider',
      default: 45,
      min: 20,
      max: 200,
      step: 1,
      label: 'Target size (mm)',
    },
    topOffsetPercent: {
      type: 'slider',
      default: 10,
      min: 5,
      max: 85,
      step: 1,
      label: 'Top offset (%)',
    },
    despeckle: {
      type: 'slider',
      default: 5,
      min: 2,
      max: 12,
      step: 1,
      label: 'Despeckle',
    },
    thickness: {
      type: 'slider',
      default: 1.5,
      min: 1.3,
      max: 3.5,
      step: 0.1,
      label: 'Thickness (mm)',
    },
    magnetDiameter: {
      type: 'slider',
      default: 4.0,
      min: 2.5,
      max: 7,
      step: 0.1,
      label: 'Magnet diameter (mm)',
    },
    magnetDepth: {
      type: 'slider',
      default: 2.0,
      min: 1.2,
      max: 2.8,
      step: 0.1,
      label: 'Magnet depth (mm)',
    },
    magnetClearance: {
      type: 'number',
      default: 0.2,
      min: 0.1,
      max: 0.35,
      step: 0.05,
      label: 'Clearance (mm)',
    },
    edgeMargin: {
      type: 'slider',
      default: 2,
      min: 1,
      max: 8,
      step: 0.5,
      label: 'Edge safety margin (mm)',
    },
    pieceGap: {
      type: 'slider',
      default: 6,
      min: 2,
      max: 15,
      step: 1,
      label: 'Gap between characters (mm)',
    },
  },

  main: async (params) => {
    if (!params.image || !params.image.dataUrl) {
      return Manifold.cube([25, 15, params.thickness], false);
    }

    const full = await makeCrossSection({
      imageFile: {
        dataUrl: params.image.dataUrl,
        fileType: params.image.fileType,
        fileName: params.image.fileName || 'sheet.png',
      },
      mode: params.mode,
      maxWidth: 240,
      despeckleSize: params.despeckle,
    });

    const valid = extractCharacterCrossSections(full).slice(0, 18);
    if (valid.length === 0) {
      return Manifold.cube([20, 15, params.thickness], false);
    }

    let maxH = 0;
    for (const cs of valid) {
      const b = cs.bounds();
      const h = b.max[1] - b.min[1];
      if (h > maxH) maxH = h;
    }

    if (maxH < 1) {
      return Manifold.cube([20, 15, params.thickness], false);
    }

    const scale = params.targetWidth / maxH;
    const results = [];
    const cell = params.targetWidth + params.pieceGap;
    const cols = Math.ceil(Math.sqrt(valid.length));

    const radius = (params.magnetDiameter + params.magnetClearance * 2) / 2;
    const pocketH = Math.min(params.magnetDepth + 0.2, Math.max(0.4, params.thickness - 0.25));
    const margin = params.edgeMargin;

    for (let i = 0; i < valid.length; i++) {
      try {
        let cs = valid[i].scale([scale, scale]);
        const b = cs.bounds();
        const cx = (b.min[0] + b.max[0]) / 2;
        const cy = (b.min[1] + b.max[1]) / 2;
        cs = cs.translate([-cx, -cy]);

        const sb = cs.bounds();

        // Re-evaluate 1 vs 2 horizontal magnets near topOffsetPercent on the scaled profile
        const positions =
          findHorizontalPair(cs, sb, params.topOffsetPercent, radius, margin) ||
          findSingleMagnet(cs, sb, params.topOffsetPercent, radius, margin);

        let body = cs.extrude(params.thickness);

        for (const [px, py] of positions) {
          const pocket = Manifold.cylinder(pocketH, radius, radius, 24).translate([
            px,
            py,
            -0.05 + pocketH / 2,
          ]);
          body = body.subtract(pocket);
        }

        const col = i % cols;
        const row = Math.floor(i / cols);
        body = body.translate([col * cell, -row * cell, 0]);
        results.push(body);
      } catch (e) {
        continue;
      }
    }

    if (results.length === 0) {
      return Manifold.cube([20, 15, params.thickness], false);
    }

    let combined = results[0];
    for (let i = 1; i < results.length; i++) {
      combined = combined.add(results[i]);
    }
    return combined;
  },
});