// ============================================================================
// core/colorTriangle.ts — HSV hue-wheel + saturation/value triangle picker.
//
// Painting-app classic: ring picks hue, inscribed triangle picks S/V. Pure UI
// — no render-path randomness. Emits normalized #rrggbb hex on change.
// ============================================================================

export type Rgb = { r: number; g: number; b: number };
export type Hsv = { h: number; s: number; v: number };

export function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
  return null;
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => clampByte(c).toString(16).padStart(2, "0")).join("")}`;
}

export function hexToRgb(hex: string): Rgb | null {
  const n = normalizeHex(hex);
  if (!n) return null;
  return {
    r: parseInt(n.slice(1, 3), 16),
    g: parseInt(n.slice(3, 5), 16),
    b: parseInt(n.slice(5, 7), 16),
  };
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 1e-8) {
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
    else if (max === gn) h = ((bn - rn) / d + 2) * 60;
    else h = ((rn - gn) / d + 4) * 60;
  }
  return { h, s: max <= 1e-8 ? 0 : d / max, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const hh = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  let rp = 0, gp = 0, bp = 0;
  if (hh < 60) { rp = c; gp = x; }
  else if (hh < 120) { rp = x; gp = c; }
  else if (hh < 180) { gp = c; bp = x; }
  else if (hh < 240) { gp = x; bp = c; }
  else if (hh < 300) { rp = x; bp = c; }
  else { rp = c; bp = x; }
  return {
    r: clampByte((rp + m) * 255),
    g: clampByte((gp + m) * 255),
    b: clampByte((bp + m) * 255),
  };
}

type Pt = { x: number; y: number };

function barycentric(p: Pt, a: Pt, b: Pt, c: Pt): { u: number; v: number; w: number } | null {
  const v0x = b.x - a.x, v0y = b.y - a.y;
  const v1x = c.x - a.x, v1y = c.y - a.y;
  const v2x = p.x - a.x, v2y = p.y - a.y;
  const den = v0x * v1y - v1x * v0y;
  if (Math.abs(den) < 1e-8) return null;
  const v = (v2x * v1y - v1x * v2y) / den;
  const w = (v0x * v2y - v2x * v0y) / den;
  const u = 1 - v - w;
  return { u, v, w };
}

function clampToTriangle(p: Pt, a: Pt, b: Pt, c: Pt): Pt {
  const bary = barycentric(p, a, b, c);
  if (bary && bary.u >= 0 && bary.v >= 0 && bary.w >= 0) return p;
  // Project onto nearest edge.
  const edges: [Pt, Pt][] = [[a, b], [b, c], [c, a]];
  let best = a, bestD = Infinity;
  for (const [p0, p1] of edges) {
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - p0.x) * dx + (p.y - p0.y) * dy) / len2));
    const q = { x: p0.x + dx * t, y: p0.y + dy * t };
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}

export type ColorTriangleHandle = {
  root: HTMLElement;
  setColor: (hex: string) => void;
  getColor: () => string;
  destroy: () => void;
};

export type ColorTriangleOptions = {
  color?: string;
  size?: number;
  onChange?: (hex: string) => void;
};

/**
 * Mount a hue-wheel + SV-triangle picker into `host`. Returns a small handle
 * for syncing from outside (swatch clicks, etc.).
 */
export function mountColorTriangle(
  host: HTMLElement,
  opts: ColorTriangleOptions = {},
): ColorTriangleHandle {
  const size = Math.max(140, Math.min(240, opts.size ?? 188));
  const root = document.createElement("div");
  root.className = "color-triangle";

  const canvas = document.createElement("canvas");
  canvas.className = "color-triangle-canvas";
  canvas.width = size;
  canvas.height = size;
  canvas.setAttribute("role", "slider");
  canvas.setAttribute("aria-label", "Color triangle");
  canvas.tabIndex = 0;

  const meta = document.createElement("div");
  meta.className = "color-triangle-meta";

  const preview = document.createElement("div");
  preview.className = "color-triangle-preview";
  preview.title = "Current color";

  const hexInput = document.createElement("input");
  hexInput.type = "text";
  hexInput.className = "color-triangle-hex chip";
  hexInput.spellcheck = false;
  hexInput.setAttribute("aria-label", "Hex color");

  const rgbRow = document.createElement("div");
  rgbRow.className = "color-triangle-rgb";
  const mkChan = (label: string) => {
    const wrap = document.createElement("label");
    wrap.className = "color-triangle-chan";
    const tag = document.createElement("span");
    tag.textContent = label;
    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = "0";
    inp.max = "255";
    inp.step = "1";
    inp.className = "chip";
    inp.setAttribute("aria-label", label);
    wrap.append(tag, inp);
    return { wrap, inp };
  };
  const rChan = mkChan("R");
  const gChan = mkChan("G");
  const bChan = mkChan("B");
  rgbRow.append(rChan.wrap, gChan.wrap, bChan.wrap);

  meta.append(preview, hexInput, rgbRow);
  root.append(canvas, meta);
  host.appendChild(root);

  const ctx = canvas.getContext("2d")!;
  const dpr = Math.min(2.5, typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.48;
  const innerR = size * 0.34;
  const triR = size * 0.30;
  const edgeAA = 1.15; // CSS-px soft edge width

  let hsv: Hsv = { h: 20, s: 0.75, v: 0.9 };
  const initial = hexToRgb(opts.color ?? "#e4572e");
  if (initial) hsv = rgbToHsv(initial.r, initial.g, initial.b);

  let drag: "hue" | "sv" | null = null;
  let suppressEmit = false;
  /** Cached hue ring at device resolution (independent of S/V). */
  let ringCache: HTMLCanvasElement | null = null;

  const triVerts = () => {
    // Top = pure hue, bottom-left = white, bottom-right = black.
    const a = { x: cx, y: cy - triR };
    const b = { x: cx - triR * 0.866, y: cy + triR * 0.5 };
    const c = { x: cx + triR * 0.866, y: cy + triR * 0.5 };
    return { a, b, c };
  };

  const currentHex = () => {
    const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  };

  const emit = () => {
    if (suppressEmit) return;
    opts.onChange?.(currentHex());
  };

  const syncFields = () => {
    const hex = currentHex();
    const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
    preview.style.background = hex;
    if (document.activeElement !== hexInput) hexInput.value = hex;
    if (document.activeElement !== rChan.inp) rChan.inp.value = String(rgb.r);
    if (document.activeElement !== gChan.inp) gChan.inp.value = String(rgb.g);
    if (document.activeElement !== bChan.inp) bChan.inp.value = String(rgb.b);
    canvas.setAttribute("aria-valuetext", hex);
  };

  const svFromPoint = (p: Pt): { s: number; v: number } => {
    const { a, b, c } = triVerts();
    const q = clampToTriangle(p, a, b, c);
    const bary = barycentric(q, a, b, c)!;
    // a=hue (u), b=white (v), c=black (w)
    const sumUV = bary.u + bary.v;
    const v = Math.max(0, Math.min(1, 1 - bary.w));
    const s = sumUV <= 1e-6 ? 0 : Math.max(0, Math.min(1, bary.u / sumUV));
    return { s, v };
  };

  const pointFromSv = (s: number, v: number): Pt => {
    const { a, b, c } = triVerts();
    // Inverse of svFromPoint mapping.
    const w = 1 - v;
    const u = s * (1 - w);
    const vv = (1 - s) * (1 - w);
    return {
      x: a.x * u + b.x * vv + c.x * w,
      y: a.y * u + b.y * vv + c.y * w,
    };
  };

  const drawCursor = (x: number, y: number, fill: string) => {
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(28,25,22,.55)";
    ctx.stroke();
  };

  const ensureRingCache = () => {
    // Ring color stops are hue-independent in the wheel itself; rebuild only
    // when DPR/size change (cache key via canvas dims). Hue cursor is drawn later.
    if (ringCache) return ringCache;
    const off = document.createElement("canvas");
    off.width = canvas.width;
    off.height = canvas.height;
    const octx = off.getContext("2d")!;
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";

    // Browser-AA'd conic wheel with a punched hole — no stair-step ring edges.
    const grad = octx.createConicGradient(-Math.PI / 2, cx, cy);
    const stops = 72;
    for (let i = 0; i <= stops; i++) {
      const h = (i / stops) * 360;
      const rgb = hsvToRgb(h, 1, 1);
      grad.addColorStop(i / stops, `rgb(${rgb.r},${rgb.g},${rgb.b})`);
    }
    octx.fillStyle = grad;
    octx.beginPath();
    octx.arc(cx, cy, outerR, 0, Math.PI * 2);
    octx.arc(cx, cy, innerR, 0, Math.PI * 2, true);
    octx.fill("evenodd");

    octx.beginPath();
    octx.arc(cx, cy, outerR, 0, Math.PI * 2);
    octx.strokeStyle = "rgba(40,32,24,.10)";
    octx.lineWidth = 1;
    octx.stroke();
    octx.beginPath();
    octx.arc(cx, cy, innerR, 0, Math.PI * 2);
    octx.strokeStyle = "rgba(40,32,24,.08)";
    octx.stroke();

    ringCache = off;
    return off;
  };

  const paintTriangle = () => {
    const { a, b, c } = triVerts();
    // Pad for AA fringe in CSS pixels, then sample at device resolution.
    const pad = edgeAA + 1;
    const minX = Math.min(a.x, b.x, c.x) - pad;
    const maxX = Math.max(a.x, b.x, c.x) + pad;
    const minY = Math.min(a.y, b.y, c.y) - pad;
    const maxY = Math.max(a.y, b.y, c.y) + pad;
    const cssW = Math.max(1, maxX - minX);
    const cssH = Math.max(1, maxY - minY);
    const pxW = Math.max(1, Math.ceil(cssW * dpr));
    const pxH = Math.max(1, Math.ceil(cssH * dpr));

    const img = ctx.createImageData(pxW, pxH);
    const data = img.data;
    // Rough conversion from barycentric weight → CSS pixels (triangle altitude).
    const altitude = triR * 1.5;
    const aaBary = edgeAA / Math.max(altitude, 1);

    for (let py = 0; py < pxH; py++) {
      for (let px = 0; px < pxW; px++) {
        const x = minX + (px + 0.5) / dpr;
        const y = minY + (py + 0.5) / dpr;
        const bary = barycentric({ x, y }, a, b, c);
        if (!bary) continue;
        const m = Math.min(bary.u, bary.v, bary.w);
        // Soft coverage outside/near edges instead of hard reject.
        let cover = 1;
        if (m < 0) cover = Math.max(0, 1 + m / aaBary);
        else if (m < aaBary) cover = 0.55 + 0.45 * (m / aaBary);
        if (cover <= 0.001) continue;

        const u = Math.max(bary.u, 0);
        const v = Math.max(bary.v, 0);
        const w = Math.max(bary.w, 0);
        const sum = u + v + w || 1;
        const nu = u / sum, nv = v / sum, nw = w / sum;
        const sumUV = nu + nv;
        const vv = Math.max(0, Math.min(1, 1 - nw));
        const ss = sumUV <= 1e-6 ? 0 : Math.max(0, Math.min(1, nu / sumUV));
        const rgb = hsvToRgb(hsv.h, ss, vv);
        const i = (py * pxW + px) * 4;
        data[i] = rgb.r;
        data[i + 1] = rgb.g;
        data[i + 2] = rgb.b;
        data[i + 3] = Math.round(255 * Math.min(1, cover));
      }
    }

    const off = document.createElement("canvas");
    off.width = pxW;
    off.height = pxH;
    off.getContext("2d")!.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, minX, minY, cssW, cssH);
  };

  const paint = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(ensureRingCache(), 0, 0, size, size);
    paintTriangle();

    // Hue cursor on ring
    const hueRad = ((hsv.h - 90) * Math.PI) / 180;
    const ringMid = (innerR + outerR) / 2;
    drawCursor(cx + Math.cos(hueRad) * ringMid, cy + Math.sin(hueRad) * ringMid, currentHex());

    // SV cursor
    const sv = pointFromSv(hsv.s, hsv.v);
    drawCursor(sv.x, sv.y, currentHex());
  };

  const applyHex = (hex: string, fromOutside = false) => {
    const rgb = hexToRgb(hex);
    if (!rgb) return;
    hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    paint();
    syncFields();
    if (!fromOutside) emit();
  };

  const localPoint = (event: PointerEvent): Pt => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = size / rect.width;
    const scaleY = size / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  };

  const hitZone = (p: Pt): "hue" | "sv" | null => {
    const dist = Math.hypot(p.x - cx, p.y - cy);
    if (dist >= innerR - 1 && dist <= outerR + 1) return "hue";
    const { a, b, c } = triVerts();
    const bary = barycentric(p, a, b, c);
    if (bary && bary.u >= -0.02 && bary.v >= -0.02 && bary.w >= -0.02) return "sv";
    return null;
  };

  const onPointer = (event: PointerEvent) => {
    const p = localPoint(event);
    if (drag === "hue" || (!drag && hitZone(p) === "hue")) {
      const angle = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI;
      hsv.h = (angle + 360 + 90) % 360;
      paint();
      syncFields();
      emit();
      return;
    }
    if (drag === "sv" || (!drag && hitZone(p) === "sv")) {
      const sv = svFromPoint(p);
      hsv.s = sv.s;
      hsv.v = sv.v;
      paint();
      syncFields();
      emit();
    }
  };

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const zone = hitZone(localPoint(event));
    if (!zone) return;
    drag = zone;
    onPointer(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    onPointer(event);
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  hexInput.addEventListener("change", () => {
    const n = normalizeHex(hexInput.value);
    if (!n) { syncFields(); return; }
    applyHex(n);
  });
  hexInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") hexInput.blur();
  });

  const onRgbChange = () => {
    applyHex(rgbToHex(+rChan.inp.value || 0, +gChan.inp.value || 0, +bChan.inp.value || 0));
  };
  for (const inp of [rChan.inp, gChan.inp, bChan.inp]) {
    inp.addEventListener("change", onRgbChange);
    inp.addEventListener("input", onRgbChange);
  }

  paint();
  syncFields();

  return {
    root,
    getColor: currentHex,
    setColor: (hex: string) => {
      const n = normalizeHex(hex);
      if (!n || n === currentHex()) {
        syncFields();
        return;
      }
      suppressEmit = true;
      applyHex(n, true);
      suppressEmit = false;
    },
    destroy: () => {
      root.remove();
    },
  };
}
