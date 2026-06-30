const BOOST_FLAG = "pmHeatmapColorBoost";

const OVERVIEW_COLORS = {
  up: [74, 222, 128],
  down: [248, 113, 113],
};

let scheduled = false;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rgba([r, g, b], alpha) {
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

function parseFirstRgbAlpha(value) {
  const match = String(value || "").match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/i);
  if (!match) return null;
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    alpha: match[4] == null ? 1 : Number(match[4]),
  };
}

function overviewDirection(background) {
  const text = String(background || "").toLowerCase();
  if (text.includes("74, 222, 128") || text.includes("rgb(74 222 128")) return null;
  if (text.includes("248, 113, 113") || text.includes("rgb(248 113 113")) return null;
  if (text.includes("#22c55e") || text.includes("34, 197, 94") || text.includes("rgb(34 197 94")) return "up";
  if (text.includes("#ef4444") || text.includes("239, 68, 68") || text.includes("rgb(239 68 68")) return "down";
  return null;
}

function boostOverviewTile(button) {
  const background = button.style.background || button.style.backgroundImage || "";
  if (!String(background).includes("linear-gradient")) return;
  const direction = overviewDirection(background);
  if (!direction) return;

  const parsed = parseFirstRgbAlpha(background);
  const baseAlpha = parsed && Number.isFinite(parsed.alpha) ? parsed.alpha : 0.16;
  const alpha = clamp(baseAlpha * 1.25 + 0.045, 0.13, 0.42);
  const color = OVERVIEW_COLORS[direction];
  const signature = `${direction}:${alpha.toFixed(3)}`;
  if (button.dataset[BOOST_FLAG] === signature) return;

  button.dataset[BOOST_FLAG] = signature;
  button.style.background = `linear-gradient(135deg, ${rgba(color, alpha)}, rgba(10, 18, 30, 0.80))`;
  button.style.borderColor = rgba(color, 0.58);
  button.style.boxShadow = `inset 0 0 0 1px ${rgba(color, 0.07)}`;
}

function boostSectorRect(rect) {
  const fill = rect.getAttribute("fill") || "";
  const match = fill.match(/^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i);
  if (!match) return;

  const hue = Number(match[1]);
  const saturation = Number(match[2]);
  const boostedAlready = hue === 142 || hue === 356;
  if (boostedAlready || !Number.isFinite(hue) || !Number.isFinite(saturation)) return;

  if (Math.abs(hue - 145) < 8) {
    const intensity = clamp((saturation - 62) / 22, 0, 1);
    rect.setAttribute("fill", `hsl(142, ${Math.round(72 + intensity * 20)}%, ${Math.round(39 + intensity * 8)}%)`);
    rect.setAttribute("stroke", rgba(OVERVIEW_COLORS.up, 0.28));
    return;
  }

  if (Math.abs(hue - 352) < 8) {
    const intensity = clamp((saturation - 68) / 22, 0, 1);
    rect.setAttribute("fill", `hsl(356, ${Math.round(76 + intensity * 18)}%, ${Math.round(39 + intensity * 7)}%)`);
    rect.setAttribute("stroke", rgba(OVERVIEW_COLORS.down, 0.3));
  }
}

function boostHeatmaps() {
  document.querySelectorAll("button").forEach(boostOverviewTile);
  document.querySelectorAll("svg rect[fill^='hsl(']").forEach(boostSectorRect);
}

function scheduleBoost() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    boostHeatmaps();
  });
}

function start() {
  boostHeatmaps();
  const root = document.getElementById("root");
  if (root) {
    new MutationObserver(scheduleBoost).observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "fill"],
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
