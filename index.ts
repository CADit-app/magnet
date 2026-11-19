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
      max: 80,
      step: 1,
      label: 'Target width per character (mm)',
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
    magnetCount: {
      type: 'choice',
      default: '1',
      options: [
        { value: '1', label: '1 magnet' },
        { value: '2h', label: '2 horizontal' },
        { value: '2v', label: '2 vertical' },
      ],
      label: 'Magnets per character',
    },
    magnetDiameter: {
      type: 'slider',
      default: 2.2,
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
      default: 1.15,
      min: 0.9,
      max: 2.0,
      step: 0.05,
      label: 'Magnet depth (mm)',
    },
    magnetClearance: {
      type: 'number',
      default: 0.18,
      min: 0.1,
      max: 0.3,
      step: 0.02,
      label: 'Clearance (mm)',
    },
    spacing: {
      type: 'slider',
      default: 12,
      min: 6,
      max: 25,
      step: 1,
      label: 'Magnet spacing (mm)',
    },
    // New: how far apart the characters are placed
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

    const pieces = full.decompose();
    if (!pieces.length) return Manifold.cube([20, 20, params.thickness], true);

    const results: Manifold[] = [];
    const cellSize = params.targetWidth + params.pieceGap; // space each character takes
    let index = 0;

    // Arrange in a roughly square grid
    const cols = Math.ceil(Math.sqrt(pieces.length));

    for (const piece of pieces) {
      const b = piece.bounds();
      const w = b.max[0] - b.min[0];
      const h = b.max[1] - b.min[1];
      if (w < 3 || h < 3) continue;

      // Scale to target width
      const scale = params.targetWidth / w;
      let cs = piece.scale([scale, scale]);

      // Center the character on itself
      const nb = cs.bounds();
      const cx = (nb.min[0] + nb.max[0]) / 2;
      const cy = (nb.min[1] + nb.max[1]) / 2;
      cs = cs.translate([-cx, -cy]);

      let body = cs.extrude(params.thickness);

      // Add magnets
      const positions: [number, number][] = [];
      const half = params.spacing / 2;

      if (params.magnetCount === '1') positions.push([0, 0]);
      else if (params.magnetCount === '2h') positions.push([-half, 0], [half, 0]);
      else if (params.magnetCount === '2v') positions.push([0, -half], [0, half]);

      const dia = params.magnetDiameter * params.magnetScale;
      const radius = (dia + params.magnetClearance * 2) / 2;
      const pocketH = params.magnetDepth + 0.2;

      for (const [x, y] of positions) {
        const pocket = Manifold.cylinder(pocketH, radius, radius, 48)
          .translate([
            x,
            y,
            -params.thickness / 2 + pocketH / 2 - 0.02,
          ]);
        body = body.subtract(pocket);
      }

      // Place this character in the grid
      const col = index % cols;
      const row = Math.floor(index / cols);
      const xPos = col * cellSize;
      const yPos = -row * cellSize; // negative so they go downward

      body = body.translate([xPos, yPos, 0]);
      results.push(body);
      index++;
    }

    if (!results.length) return Manifold.cube([20, 20, params.thickness], true);

    // Combine everything
    let combined = results[0];
    for (let i = 1; i < results.length; i++) {
      combined = combined.add(results[i]);
    }
    return combined;
  },
});