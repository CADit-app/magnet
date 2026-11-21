import { defineParams } from '@cadit-app/script-params';
import { Manifold, CrossSection } from 'manifold-3d/manifoldCAD';
import { makeCrossSection } from '@cadit-app/image-extrude';

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
      label: 'Target size (mm) - based on tallest character',
    },
    despeckle: {
      type: 'slider',
      default: 3,
      min: 1,
      max: 8,
      step: 1,
      label: 'Despeckle',
    },
    thickness: {
      type: 'slider',
      default: 1.5,
      min: 1.3,
      max: 4,
      step: 0.1,
      label: 'Thickness (mm)',
    },

    // ----- Magnets -----
    magnetDiameter: {
      type: 'slider',
      default: 4,
      min: 1.8,
      max: 6,
      step: 0.1,
      label: 'Magnet diameter (mm)',
    },
    magnetScale: {
      type: 'slider',
      default: 1.0,
      min: 0.8,
      max: 1.5,
      step: 0.05,
      label: 'Magnet size multiplier',
    },
    magnetDepth: {
      type: 'slider',
      default: 2,
      min: 0.9,
      max: 4.0,
      step: 0.05,
      label: 'Magnet depth (mm) - same on all characters',
    },
    magnetClearance: {
      type: 'number',
      default: 0.18,
      min: 0.1,
      max: 0.3,
      step: 0.02,
      label: 'Clearance (mm)',
    },
    magnetSpacing: {
      type: 'slider',
      default: 12,
      min: 6,
      max: 25,
      step: 1,
      label: 'Spacing between magnets when 2 are used (mm)',
    },
    autoMagnetThreshold: {
      type: 'slider',
      default: 40,
      min: 25,
      max: 60,
      step: 1,
      label: 'Add 2nd magnet when wider than (mm)',
    },

    pieceGap: {
      type: 'slider',
      default: 8,
      min: 2,
      max: 20,
      step: 1,
      label: 'Gap between characters (mm)',
    },
  },

  main: async (params) => {
    if (!params.image?.dataUrl) {
      return Manifold.cube([30, 20, params.thickness], true);
    }

    // 1. Trace the whole image
    let full = await makeCrossSection({
      imageFile: {
        dataUrl: params.image.dataUrl,
        fileType: params.image.fileType,
        fileName: params.image.fileName || 'sheet.png',
      },
      mode: params.mode as 'sample' | 'trace',
      maxWidth: 200,
      // @ts-ignore
      despeckleSize: params.despeckle,
    });

    // 2. Split into individual characters
    const pieces = full.decompose();
    if (!pieces.length) {
      return Manifold.cube([20, 20, params.thickness], true);
    }

    // 3. First pass – collect valid pieces + find tallest
    const validPieces: CrossSection[] = [];
    let maxHeight = 0;

    for (const piece of pieces) {
      const b = piece.bounds();
      const w = b.max[0] - b.min[0];
      const h = b.max[1] - b.min[1];
      if (w < 3 || h < 3) continue;

      validPieces.push(piece);
      if (h > maxHeight) maxHeight = h;
    }

    if (validPieces.length === 0) {
      return Manifold.cube([20, 20, params.thickness], true);
    }

    // 4. One global scale (keeps relative sizes correct)
    const globalScale = params.targetWidth / maxHeight;

    const results: Manifold[] = [];
    const cellSize = params.targetWidth + params.pieceGap;
    const cols = Math.ceil(Math.sqrt(validPieces.length));
    let index = 0;

    // Shared magnet values (uniform across all characters)
    const dia = params.magnetDiameter * params.magnetScale;
    const radius = (dia + params.magnetClearance * 2) / 2;
    const pocketH = params.magnetDepth + 0.2;

    // 5. Process every character
    for (const piece of validPieces) {
      let cs = piece.scale([globalScale, globalScale]);

      // Center it
      const nb = cs.bounds();
      const cx = (nb.min[0] + nb.max[0]) / 2;
      const cy = (nb.min[1] + nb.max[1]) / 2;
      cs = cs.translate([-cx, -cy]);

      // Actual width of this character after scaling
      const charWidth = nb.max[0] - nb.min[0];

      let body = cs.extrude(params.thickness);

      // ----- Automatic magnet decision -----
      const positions: [number, number][] = [];
      const half = params.magnetSpacing / 2;

      if (charWidth > params.autoMagnetThreshold) {
        // Wide character → 2 magnets horizontal
        positions.push([-half, 0], [half, 0]);
      } else {
        // Narrow character → 1 magnet in center
        positions.push([0, 0]);
      }

      // Cut the pockets (same depth on every character)
      for (const [x, y] of positions) {
        const pocket = Manifold.cylinder(pocketH, radius, radius, 48)
          .translate([
            x,
            y,
            -params.thickness / 2 + pocketH / 2 - 0.02,
          ]);
        body = body.subtract(pocket);
      }

      // Place in grid
      const col = index % cols;
      const row = Math.floor(index / cols);
      body = body.translate([col * cellSize, -row * cellSize, 0]);

      results.push(body);
      index++;
    }

    // 6. Combine
    let combined = results[0];
    for (let i = 1; i < results.length; i++) {
      combined = combined.add(results[i]);
    }
    return combined;
  },
});