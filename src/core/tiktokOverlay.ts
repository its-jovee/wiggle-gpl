// ============================================================================
// core/tiktokOverlay.ts — editor-only TikTok UI visibility preview.
//
// This module deliberately sits outside renderPanel: the overlay is transient
// editor chrome and must never appear in thumbnails, saved projects, or export.
// Reference measurements use a 1080×1920 frame and scale proportionally to
// other project sizes. TikTok's live UI varies by device, caption length, post
// type, and app revision, so this is a conservative organic-feed visibility
// guide rather than a crop boundary or pixel contract.
//
// Layout (1080×1920 reference) — content-covering FYP chrome only:
//   topRisk    130px  Following / For You / search
//   rightRisk  140px  avatar + like / comment / bookmark / share
//   bottomRisk 340px  username, caption, and sound ticker
//   safeArea   880×1450 at (60, 130)
//
// The Home / Friends / + / Inbox / Profile tab bar is deliberately not drawn
// as though TikTok removes that slice from the exported video. It is app chrome,
// not evidence of an export crop. Likewise, the system home indicator is not an
// extra export margin. The shaded lower band is retained because captions and
// sound attribution can cover important text.
// See docs/research/tiktok-safe-area.md for sources and rationale.
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

/** Conservative organic-feed top UI risk band. */
const TOP_RISK = 130;
/** Conservative caption/sound UI risk band; not an export crop. */
const BOTTOM_RISK = 340;
const LEFT_PAD = 60;
const RIGHT_RISK = 140;
const SAFE_HEIGHT = REFERENCE_HEIGHT - TOP_RISK - BOTTOM_RISK; // 1450
const SAFE_WIDTH = REFERENCE_WIDTH - LEFT_PAD - RIGHT_RISK; // 880

export function tiktokOverlayLayout(width: number, height: number): TikTokOverlayLayout {
  const sx = width / REFERENCE_WIDTH;
  const sy = height / REFERENCE_HEIGHT;
  return {
    safeArea: {
      x: LEFT_PAD * sx,
      y: TOP_RISK * sy,
      width: SAFE_WIDTH * sx,
      height: SAFE_HEIGHT * sy,
    },
    topRisk: { x: 0, y: 0, width, height: TOP_RISK * sy },
    rightRisk: {
      x: (REFERENCE_WIDTH - RIGHT_RISK) * sx,
      y: TOP_RISK * sy,
      width: RIGHT_RISK * sx,
      height: SAFE_HEIGHT * sy,
    },
    bottomRisk: {
      x: 0,
      y: (REFERENCE_HEIGHT - BOTTOM_RISK) * sy,
      width,
      height: BOTTOM_RISK * sy,
    },
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

  // Conservative UI-occlusion regions. These do not represent export crops.
  ctx.fillStyle = "rgba(8, 10, 14, .18)";
  for (const zone of [layout.topRisk, layout.rightRisk, layout.bottomRisk]) {
    ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
  }

  // UI-safe text guide.
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
  roundedRect(ctx, x(74), y(150), u(188), u(42), u(21));
  ctx.fillStyle = "rgba(6, 20, 22, .82)";
  ctx.fill();
  ctx.fillStyle = "#7fffe9";
  ctx.font = `700 ${u(20)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("UI-SAFE TEXT", x(168), y(171));

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
  ctx.arc(actionX, y(970), u(42), 0, Math.PI * 2);
  ctx.fillStyle = "rgba(35,35,40,.92)";
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(actionX, y(958), u(13), 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(actionX, y(992), u(24), Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(actionX, y(1017), u(14), 0, Math.PI * 2);
  ctx.fillStyle = "#fe2c55";
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `800 ${u(22)}px system-ui, sans-serif`;
  ctx.fillText("+", actionX, y(1015));

  const actionItems = [
    { cy: 1140, count: "24.8K", draw: drawHeart },
    { cy: 1310, count: "326", draw: drawComment },
    { cy: 1480, count: "1,204", draw: drawBookmark },
    { cy: 1650, count: "Share", draw: drawShare },
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

  // Caption, description, and sound attribution (real FYP overlays).
  ctx.textAlign = "left";
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,.75)";
  ctx.shadowBlur = u(5);
  ctx.font = `750 ${u(25)}px system-ui, sans-serif`;
  ctx.fillText("@yourname", x(52), y(1660));
  ctx.font = `500 ${u(23)}px system-ui, sans-serif`;
  ctx.fillText("Your description will appear here…", x(52), y(1710));
  ctx.font = `700 ${u(22)}px system-ui, sans-serif`;
  ctx.fillText("#animation  #art", x(52), y(1752));
  ctx.font = `600 ${u(21)}px system-ui, sans-serif`;
  ctx.fillText("♪  Original sound · yourname", x(86), y(1816));
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = u(3);
  ctx.beginPath();
  ctx.arc(x(62), y(1810), u(13), 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x(72), y(1801));
  ctx.lineTo(x(72), y(1777));
  ctx.stroke();

  ctx.restore();
}
