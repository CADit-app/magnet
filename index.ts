// ---------- After decomposing the pieces ----------

const validPieces: CrossSection[] = [];
let maxHeight = 0;

// First pass: collect valid pieces and find the tallest one
for (const piece of pieces) {
  const b = piece.bounds();
  const w = b.max[0] - b.min[0];
  const h = b.max[1] - b.min[1];
  if (w < 3 || h < 3) continue;          // skip tiny noise

  validPieces.push(piece);
  if (h > maxHeight) maxHeight = h;
}

if (validPieces.length === 0) {
  return Manifold.cube([20, 20, params.thickness], true);
}

// One global scale so the tallest character becomes targetWidth
// (you can change this to targetHeight later if you prefer)
const globalScale = params.targetWidth / maxHeight;

const results: Manifold[] = [];
const cellSize = params.targetWidth + params.pieceGap;
const cols = Math.ceil(Math.sqrt(validPieces.length));
let index = 0;

for (const piece of validPieces) {
  // Apply the SAME scale to every character
  let cs = piece.scale([globalScale, globalScale]);

  // Center it
  const nb = cs.bounds();
  const cx = (nb.min[0] + nb.max[0]) / 2;
  const cy = (nb.min[1] + nb.max[1]) / 2;
  cs = cs.translate([-cx, -cy]);

  let body = cs.extrude(params.thickness);

  // ----- magnet code stays the same -----
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
      .translate([x, y, -params.thickness / 2 + pocketH / 2 - 0.02]);
    body = body.subtract(pocket);
  }

  // Place in grid
  const col = index % cols;
  const row = Math.floor(index / cols);
  body = body.translate([col * cellSize, -row * cellSize, 0]);

  results.push(body);
  index++;
}