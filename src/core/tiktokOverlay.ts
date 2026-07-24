// ============================================================================
// core/tiktokOverlay.ts — editor-only TikTok UI and safe-area preview.
//
// This module deliberately sits outside renderPanel: the overlay is transient
// editor chrome and must never appear in thumbnails, saved projects, or export.
// Reference measurements use a 1080×1920 frame and scale proportionally to
// other project sizes. TikTok's live UI varies by device and app revision, so
// the template is a conservative placement guide rather than a pixel contract.
// ============================================================================

export type OverlayRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TikTokOverlayLayout = {
  safeArea: OverlayRect;
  topRisk: OverlayRect;
  rightRisk: OverlayRect;
  bottomRisk: OverlayRect;
};

const REFERENCE_WIDTH = 1080;
const REFERENCE_HEIGHT = 1920;

export function tiktokOverlayLayout(width: number, height: number): TikTokOverlayLayout {
  const sx = width / REFERENCE_WIDTH;
  const sy = height / REFERENCE_HEIGHT;
  return {
    safeArea: { x: 44 * sx, y: 130 * sy, width: 896 * sx, height: 1306 * sy },
    topRisk: { x: 0, y: 0, width, height: 130 * sy },
    rightRisk: { x: 940 * sx, y: 130 * sy, width: 140 * sx, height: 1306 * sy },
    bottomRisk: { x: 0, y: 1436 * sy, width, height: 484 * sy },
  };
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.38);
  ctx.bezierCurveTo(
    x - size * 0.7, y - size * 0.08,
    x - size * 0.44, y - size * 0.72,
    x, y - size * 0.32
  );
  ctx.bezierCurveTo(
    x + size * 0.44, y - size * 0.72,
    x + size * 0.7, y - size * 0.08,
    x, y + size * 0.38
  );
  ctx.closePath();
  ctx.fill();
}

function drawComment(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.beginPath();
  ctx.arc(x, y, size * 0.52, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - size * 0.18, y + size * 0.38);
  ctx.lineTo(x - size * 0.38, y + size * 0.7);
  ctx.lineTo(x + size * 0.08, y + size * 0.47);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,.55)";
  for (const offset of [-0.2, 0, 0.2]) {
    ctx.beginPath();
    ctx.arc(x + size * offset, y, size * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBookmark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.beginPath();
  ctx.moveTo(x - size * 0.38, y - size * 0.56);
  ctx.lineTo(x + size * 0.38, y - size * 0.56);
  ctx.lineTo(x + size * 0.38, y + size * 0.58);
  ctx.lineTo(x, y + size * 0.32);
  ctx.lineTo(x - size * 0.38, y + size * 0.58);
  ctx.closePath();
  ctx.fill();
}

function drawShare(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.beginPath();
  ctx.moveTo(x - size * 0.58, y + size * 0.46);
  ctx.quadraticCurveTo(x - size * 0.3, y - size * 0.18, x + size * 0.27, y - size * 0.16);
  ctx.lineTo(x + size * 0.27, y - size * 0.52);
  ctx.lineTo(x + size * 0.65, y);
  ctx.lineTo(x + size * 0.27, y + size * 0.5);
  ctx.lineTo(x + size * 0.27, y + size * 0.14);
  ctx.quadraticCurveTo(x - size * 0.2, y + size * 0.08, x - size * 0.58, y + size * 0.46);
  ctx.closePath();
  ctx.fill();
}

export function drawTikTokOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  if (width <= 0 || height <= 0) return;

  const sx = width / REFERENCE_WIDTH;
  const sy = height / REFERENCE_HEIGHT;
  const scale = Math.min(sx, sy);
  const x = (value: number) => value * sx;
  const y = (value: number) => value * sy;
  const u = (value: number) => value * scale;
  const layout = tiktokOverlayLayout(width, height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  // Conservative UI-risk regions.
  ctx.fillStyle = "rgba(8, 10, 14, .18)";
  for (const zone of [layout.topRisk, layout.rightRisk, layout.bottomRisk]) {
    ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
  }

  // Content-safe guide.
  ctx.strokeStyle = "rgba(37, 244, 211, .95)";
  ctx.lineWidth = u(3);
  ctx.setLineDash([u(14), u(10)]);
  ctx.strokeRect(
    layout.safeArea.x,
    layout.safeArea.y,
    layout.safeArea.width,
    layout.safeArea.height
  );
  ctx.setLineDash([]);
  roundedRect(ctx, x(58), y(150), u(188), u(42), u(21));
  ctx.fillStyle = "rgba(6, 20, 22, .82)";
  ctx.fill();
  ctx.fillStyle = "#7fffe9";
  ctx.font = `700 ${u(20)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("SAFE CONTENT", x(152), y(171));

  // Top navigation/search chrome.
  ctx.fillStyle = "rgba(255,255,255,.98)";
  ctx.shadowColor = "rgba(0,0,0,.55)";
  ctx.shadowBlur = u(5);
  ctx.font = `700 ${u(28)}px system-ui, sans-serif`;
  ctx.fillText("Following", x(430), y(76));
  ctx.fillText("For You", x(616), y(76));
  ctx.fillRect(x(564), y(104), x(104), u(4));
  ctx.lineWidth = u(5);
  ctx.strokeStyle = "rgba(255,255,255,.98)";
  ctx.beginPath();
  ctx.arc(x(1010), y(76), u(18), 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x(1023), y(90));
  ctx.lineTo(x(1040), y(107));
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Right-side creator and engagement stack.
  const actionX = x(997);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.textAlign = "center";
  ctx.lineWidth = u(4);
  ctx.beginPath();
  ctx.arc(actionX, y(770), u(42), 0, Math.PI * 2);
  ctx.fillStyle = "rgba(35,35,40,.92)";
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(actionX, y(758), u(13), 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(actionX, y(792), u(24), Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(actionX, y(817), u(14), 0, Math.PI * 2);
  ctx.fillStyle = "#fe2c55";
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `800 ${u(22)}px system-ui, sans-serif`;
  ctx.fillText("+", actionX, y(815));

  const actionItems = [
    { cy: 940, count: "24.8K", draw: drawHeart },
    { cy: 1110, count: "326", draw: drawComment },
    { cy: 1280, count: "1,204", draw: drawBookmark },
    { cy: 1450, count: "Share", draw: drawShare },
  ];
  for (const item of actionItems) {
    ctx.fillStyle = "rgba(255,255,255,.98)";
    item.draw(ctx, actionX, y(item.cy), u(50));
    ctx.shadowColor = "rgba(0,0,0,.8)";
    ctx.shadowBlur = u(4);
    ctx.fillStyle = "#fff";
    ctx.font = `650 ${u(21)}px system-ui, sans-serif`;
    ctx.fillText(item.count, actionX, y(item.cy + 72));
    ctx.shadowBlur = 0;
  }

  // Caption, description, and sound attribution.
  ctx.textAlign = "left";
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,.75)";
  ctx.shadowBlur = u(5);
  ctx.font = `750 ${u(25)}px system-ui, sans-serif`;
  ctx.fillText("@yourname", x(52), y(1540));
  ctx.font = `500 ${u(23)}px system-ui, sans-serif`;
  ctx.fillText("Your description will appear here…", x(52), y(1590));
  ctx.font = `700 ${u(22)}px system-ui, sans-serif`;
  ctx.fillText("#animation  #art", x(52), y(1632));
  ctx.font = `600 ${u(21)}px system-ui, sans-serif`;
  ctx.fillText("♪  Original sound · yourname", x(86), y(1696));
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = u(3);
  ctx.beginPath();
  ctx.arc(x(62), y(1690), u(13), 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x(72), y(1681));
  ctx.lineTo(x(72), y(1657));
  ctx.stroke();

  // Bottom navigation and create control.
  ctx.fillStyle = "rgba(0,0,0,.58)";
  ctx.fillRect(0, y(1770), width, height - y(1770));
  const navItems = [
    { cx: 92, label: "Home" },
    { cx: 292, label: "Friends" },
    { cx: 788, label: "Inbox" },
    { cx: 982, label: "Profile" },
  ];
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.font = `600 ${u(19)}px system-ui, sans-serif`;
  for (const item of navItems) {
    ctx.beginPath();
    ctx.arc(x(item.cx), y(1828), u(17), 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,.95)";
    ctx.lineWidth = u(4);
    ctx.stroke();
    ctx.fillText(item.label, x(item.cx), y(1872));
  }
  roundedRect(ctx, x(486), y(1802), x(108), y(52), u(12));
  ctx.fillStyle = "#25f4ee";
  ctx.fill();
  roundedRect(ctx, x(500), y(1802), x(108), y(52), u(12));
  ctx.fillStyle = "#fe2c55";
  ctx.fill();
  roundedRect(ctx, x(493), y(1802), x(108), y(52), u(12));
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.fillStyle = "#111";
  ctx.font = `700 ${u(36)}px system-ui, sans-serif`;
  ctx.fillText("+", x(547), y(1827));

  ctx.restore();
}
