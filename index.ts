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
      label: 'Target size (mm)',
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
      default: 2.5,
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
      default: 5,
      min: 3,
      max: 10,
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
      return Manifold.cube([25, 15, params.thickness], true);
    }

    const full = await makeCrossSection({
      imageFile: {
        dataUrl: params.image.dataUrl,
        fileType: params.image.fileType,
        fileName: params.image.fileName || 'sheet.png',
      },
      mode: params.mode,
      maxWidth: 110,
      despeckleSize: params.despeckle,
    });

    let pieces = [];
    try {
      pieces = full.decompose();
    } catch (e) {
      return Manifold.cube([20, 15, params.thickness], true);
    }

    if (!pieces || pieces.length === 0) {
      return Manifold.cube([20, 15, params.thickness], true);
    }

    const valid = [];
    let maxH = 0;

    for (let i = 0; i < pieces.length && valid.length < 18; i++) {
      try {
        const b = pieces[i].bounds();
        const w = b.max[0] - b.min[0];
        const h = b.max[1] - b.min[1];
        if (w < 5 || h < 5) continue;

        valid.push(pieces[i]);
        if (h > maxH) maxH = h;
      } catch (e) {
        continue;
      }
    }

    if (valid.length === 0 || maxH < 2) {
      return Manifold.cube([20, 15, params.thickness], true);
    }

    const scale = params.targetWidth / maxH;
    const results = [];
    const cell = params.targetWidth + params.pieceGap;
    const cols = Math.ceil(Math.sqrt(valid.length));

    const radius = (params.magnetDiameter + params.magnetClearance * 2) / 2;
    const pocketH = params.magnetDepth + 0.2;

    for (let i = 0; i < valid.length; i++) {
      try {
        let cs = valid[i].scale([scale, scale]);
        const b = cs.bounds();
        const cx = (b.min[0] + b.max[0]) / 2;
        const cy = (b.min[1] + b.max[1]) / 2;
        cs = cs.translate([-cx, -cy]);

        const width = b.max[0] - b.min[0];
        let body = cs.extrude(params.thickness);

        // Stricter safety-margin magnet placement
        const positions = [];
        const margin = params.edgeMargin;
        const halfWidth = width / 2;
        const maxOffset = halfWidth - margin - radius;

        if (maxOffset >= 8) {
          const offset = Math.min(6, maxOffset * 0.7);
          positions.push([-offset, 0], [offset, 0]);
        } else {
          positions.push([0, 0]);
        }

        for (let p = 0; p < positions.length; p++) {
          const pocket = Manifold.cylinder(pocketH, radius, radius, 24)
            .translate([
              positions[p][0],
              positions[p][1],
              -params.thickness / 2 + pocketH / 2 - 0.02
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
      return Manifold.cube([20, 15, params.thickness], true);
    }

    let combined = results[0];
    for (let i = 1; i < results.length; i++) {
      combined = combined.add(results[i]);
    }
    return combined;
  },
});