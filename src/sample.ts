/**
 * The frame the page loads with.
 *
 * Drawn here in code rather than shipped as a photograph, because a photograph
 * has an author and a licence and this repository should have neither problem.
 * It is built to be worth grading: skin-like tones, a sky gradient, deep
 * shadow, a specular highlight, saturated chips and a neutral step wedge.
 */

export const SAMPLE_WIDTH = 1600;
export const SAMPLE_HEIGHT = 1000;

/** Deterministic noise so the sample is byte for byte the same every load. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const CHIPS = [
  '#7a5548',
  '#c39a80',
  '#5c7b9b',
  '#5f6b45',
  '#7f7ba6',
  '#6fb3a4',
  '#c07430',
  '#3f4d94',
  '#b24f57',
  '#5a3a6b',
  '#9fb84a',
  '#d39a2e',
];

export function drawSampleImage(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = SAMPLE_WIDTH;
  const h = SAMPLE_HEIGHT;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Sky, warm at the horizon and cool at the top.
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.68);
  sky.addColorStop(0, '#0d1a2b');
  sky.addColorStop(0.45, '#2d4a63');
  sky.addColorStop(0.8, '#8f7f6a');
  sky.addColorStop(1, '#c9a173');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.68);

  // A low sun behind the horizon, the brightest thing in frame.
  const sun = ctx.createRadialGradient(w * 0.72, h * 0.63, 0, w * 0.72, h * 0.63, h * 0.42);
  sun.addColorStop(0, 'rgba(255, 244, 224, 0.95)');
  sun.addColorStop(0.25, 'rgba(240, 190, 130, 0.45)');
  sun.addColorStop(1, 'rgba(240, 190, 130, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h * 0.72);

  // Ground.
  const ground = ctx.createLinearGradient(0, h * 0.68, 0, h);
  ground.addColorStop(0, '#41341f');
  ground.addColorStop(0.5, '#241d13');
  ground.addColorStop(1, '#0f0c08');
  ctx.fillStyle = ground;
  ctx.fillRect(0, h * 0.68, w, h * 0.32);

  // Distant ridge, near black, to give the shadows something to sit in.
  ctx.fillStyle = '#131a20';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.68);
  const ridge = makeRandom(7);
  for (let x = 0; x <= w; x += 40) {
    const y = h * 0.68 - (26 + Math.sin(x / 190) * 22 + ridge() * 14);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h * 0.68);
  ctx.closePath();
  ctx.fill();

  // The subject: a sphere in a skin-like tone with a hard specular.
  const cx = w * 0.3;
  const cy = h * 0.55;
  const radius = h * 0.24;

  // Contact shadow, so the sphere sits on the ground rather than floating.
  const contact = ctx.createRadialGradient(cx, cy + radius, 0, cx, cy + radius, radius * 1.1);
  contact.addColorStop(0, 'rgba(0,0,0,0.62)');
  contact.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.translate(cx, cy + radius * 0.98);
  ctx.scale(1, 0.22);
  ctx.translate(-cx, -(cy + radius * 0.98));
  ctx.fillStyle = contact;
  ctx.beginPath();
  ctx.arc(cx, cy + radius, radius * 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const body = ctx.createRadialGradient(
    cx - radius * 0.35,
    cy - radius * 0.4,
    radius * 0.05,
    cx,
    cy,
    radius,
  );
  body.addColorStop(0, '#f0cbaa');
  body.addColorStop(0.4, '#c99873');
  body.addColorStop(0.75, '#8d5f43');
  body.addColorStop(1, '#2f1d15');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  const spec = ctx.createRadialGradient(
    cx - radius * 0.42,
    cy - radius * 0.46,
    0,
    cx - radius * 0.42,
    cy - radius * 0.46,
    radius * 0.28,
  );
  spec.addColorStop(0, 'rgba(255,255,255,0.92)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spec;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  // A colour chart standing on the ground, so a cast is obvious. Real chips
  // rather than pure primaries, because that is what you judge a grade on.
  const chipW = w * 0.042;
  const chipH = chipW * 0.78;
  const gap = 7;
  const chipX = w * 0.525;
  const chipY = h * 0.715;
  const boardW = 6 * chipW + 5 * gap + gap * 2;
  const boardH = 2 * chipH + gap * 3;
  ctx.fillStyle = '#15120e';
  ctx.fillRect(chipX - gap, chipY - gap, boardW, boardH);
  for (let i = 0; i < CHIPS.length; i++) {
    const col = i % 6;
    const row = (i / 6) | 0;
    ctx.fillStyle = CHIPS[i];
    ctx.fillRect(chipX + col * (chipW + gap), chipY + row * (chipH + gap), chipW, chipH);
  }

  // Neutral step wedge across the bottom, for judging the tone curve.
  const steps = 16;
  const wedgeY = h * 0.9;
  const wedgeH = h * 0.075;
  const wedgeW = w * 0.86;
  const wedgeX = (w - wedgeW) / 2;
  for (let i = 0; i < steps; i++) {
    const v = Math.round((i / (steps - 1)) * 255);
    ctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
    ctx.fillRect(wedgeX + (i * wedgeW) / steps, wedgeY, wedgeW / steps + 1, wedgeH);
  }

  // Vignette.
  const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.95);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  addGrain(ctx, w, h);
  return canvas;
}

/** A little grain, so the histogram looks like a photograph and not a poster. */
function addGrain(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  const random = makeRandom(20260101);
  for (let i = 0; i < data.length; i += 4) {
    const n = (random() - 0.5) * 7;
    data[i] = clampByte(data[i] + n);
    data[i + 1] = clampByte(data[i + 1] + n);
    data[i + 2] = clampByte(data[i + 2] + n);
  }
  ctx.putImageData(image, 0, 0);
}

function clampByte(x: number): number {
  return x < 0 ? 0 : x > 255 ? 255 : x;
}
