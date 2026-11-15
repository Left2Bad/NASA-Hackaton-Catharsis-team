// Burn Calendar: 30-second pitch video for NASA Space Apps 2026 (team Catharsis).
// Every picture is a real screenshot of the live site (public/nasa/*.jpg, 3840x2160 = 1920x1080 at 2x).
// On top: a smooth camera (zoom/pan), highlight rings, a pointer with clicks, a before/after wipe,
// word-timed captions and an end card. Voice: ElevenLabs v3 (voice_nasa/voice.wav), muxed after the render.
import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, interpolate } from "remotion";
import { LINES } from "./words";

export const PITCH_FPS = 30;
export const PITCH_FRAMES = Math.round(29.5 * PITCH_FPS);

const W = 1920;
const H = 1080;
const ORANGE = "#ff6a00";
const BLUE = "#2f7fd8";
const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

// ---------- time helpers ----------
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoother = (x: number) => { const t = clamp01(x); return t * t * t * (t * (t * 6 - 15) + 10); };
const span = (t: number, a: number, b: number) => smoother((t - a) / (b - a));

type Cam = { t: number; x: number; y: number; z: number };
/** Camera at time t from keyframes: (x, y) is the page point (CSS px of the 1920x1080 view) at the screen centre. */
function camAt(keys: Cam[], t: number) {
  if (t <= keys[0].t) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t <= b.t) {
      const k = span(t, a.t, b.t);
      return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
    }
  }
  return keys[keys.length - 1];
}
/** Page point -> screen point for a camera; the view never shows past the page edges. */
function view(c: Cam) {
  const z = c.z;
  const x = Math.min(W - W / 2 / z, Math.max(W / 2 / z, c.x));
  const y = Math.min(H - H / 2 / z, Math.max(H / 2 / z, c.y));
  return { z, left: W / 2 - x * z, top: H / 2 - y * z };
}
type V = ReturnType<typeof view>;
const sx = (v: V, x: number) => v.left + x * v.z;
const sy = (v: V, y: number) => v.top + y * v.z;

// ---------- pieces ----------
const Shot: React.FC<{ src: string; v: V; opacity?: number; clip?: string }> = ({ src, v, opacity = 1, clip }) => (
  <Img
    src={staticFile(`nasa/${src}.jpg`)}
    style={{ position: "absolute", left: v.left, top: v.top, width: W * v.z, height: H * v.z, opacity, clipPath: clip }}
  />
);

type Box = { x: number; y: number; w: number; h: number };
/** A rounded ring around a page box that pops in at `at` and fades at `until`; dims the rest when `dim`. */
const Ring: React.FC<{ v: V; b: Box; t: number; at: number; until: number; color?: string; dim?: boolean; label?: string; labelSide?: "above" | "below" | "right" | "left" }> = ({ v, b, t, at, until, color = ORANGE, dim = false, label, labelSide = "above" }) => {
  const k = span(t, at, at + 0.35) * (1 - span(t, until - 0.3, until));
  if (k <= 0) return null;
  const pad = 8;
  const x = sx(v, b.x) - pad, y = sy(v, b.y) - pad, w = b.w * v.z + pad * 2, h = b.h * v.z + pad * 2;
  const grow = 1 + 0.08 * (1 - span(t, at, at + 0.35));
  const cx = x + w / 2, cy = y + h / 2;
  const lw = w * grow, lh = h * grow;
  const lx = { above: cx, below: cx, right: x + w + 18, left: x - 18 }[labelSide];
  const ly = { above: y - 16, below: y + h + 16, right: cy, left: cy }[labelSide];
  const tr = { above: "translate(-50%, -100%)", below: "translate(-50%, 0)", right: "translate(0, -50%)", left: "translate(-100%, -50%)" }[labelSide];
  return (
    <>
      {dim && (
        <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, opacity: 0.45 * k }}>
          <defs>
            <mask id={`m${at}`}>
              <rect width={W} height={H} fill="white" />
              <rect x={cx - lw / 2} y={cy - lh / 2} width={lw} height={lh} rx={14} fill="black" />
            </mask>
          </defs>
          <rect width={W} height={H} fill="#0b1220" mask={`url(#m${at})`} />
        </svg>
      )}
      <div style={{
        position: "absolute", left: cx - lw / 2, top: cy - lh / 2, width: lw, height: lh, borderRadius: 14,
        border: `5px solid ${color}`, boxShadow: `0 0 24px ${color}aa`, opacity: k,
      }} />
      {label && (
        <div style={{
          position: "absolute", left: lx, top: ly, transform: tr, opacity: k, background: color, color: "#fff",
          font: `700 34px ${FONT}`, padding: "8px 18px", borderRadius: 12, whiteSpace: "nowrap", boxShadow: "0 6px 18px #0005",
        }}>{label}</div>
      )}
    </>
  );
};

/** Big callout in screen coordinates. */
const Badge: React.FC<{ t: number; at: number; until: number; x: number; y: number; big: string; small: string; color: string }> = ({ t, at, until, x, y, big, small, color }) => {
  const k = span(t, at, at + 0.3) * (1 - span(t, until - 0.3, until));
  if (k <= 0) return null;
  const s = 0.85 + 0.15 * span(t, at, at + 0.3);
  return (
    <div style={{
      position: "absolute", left: x, top: y, transform: `translate(-50%, -50%) scale(${s})`, opacity: k,
      background: "#ffffffee", borderRadius: 22, padding: "18px 30px", boxShadow: "0 10px 40px #0006",
      border: `4px solid ${color}`, textAlign: "center", fontFamily: FONT,
    }}>
      <div style={{ font: `800 88px ${FONT}`, color, lineHeight: 1 }}>{big}</div>
      <div style={{ font: `600 30px ${FONT}`, color: "#1b2433", marginTop: 6, whiteSpace: "nowrap" }}>{small}</div>
    </div>
  );
};

type P = { t: number; x: number; y: number };
/** Pointer path in page coordinates; clicks at the given times. */
const Pointer: React.FC<{ v: V; t: number; path: P[]; clicks: number[]; from: number; to: number }> = ({ v, t, path, clicks, from, to }) => {
  if (t < from || t > to) return null;
  const k = span(t, from, from + 0.25) * (1 - span(t, to - 0.25, to));
  let p = path[0];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    if (t >= a.t && t <= b.t) { const e = span(t, a.t, b.t); p = { t, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }; break; }
    if (t > b.t) p = b;
  }
  const x = sx(v, p.x), y = sy(v, p.y);
  const press = clicks.some((c) => t >= c && t < c + 0.12) ? 0.85 : 1;
  return (
    <>
      {clicks.map((c) => {
        const r = clamp01((t - c) / 0.5);
        if (t < c || r >= 1) return null;
        return <div key={c} style={{
          position: "absolute", left: x - 10 - 40 * r, top: y - 10 - 40 * r, width: 20 + 80 * r, height: 20 + 80 * r,
          borderRadius: "50%", border: `4px solid ${ORANGE}`, opacity: 1 - r,
        }} />;
      })}
      <svg width={44} height={56} viewBox="0 0 22 28" style={{ position: "absolute", left: x - 3, top: y - 2, opacity: k, transform: `scale(${press})`, transformOrigin: "3px 2px", filter: "drop-shadow(0 3px 4px #0007)" }}>
        <path d="M2 1 L2 22 L7.5 17 L11 26 L14.5 24.5 L11 16 L18.5 16 Z" fill="#fff" stroke="#111" strokeWidth={1.6} strokeLinejoin="round" />
      </svg>
    </>
  );
};

/** One caption line at a time; the word being spoken is yellow. */
const Captions: React.FC<{ t: number; top?: boolean }> = ({ t, top = false }) => {
  const line = LINES.find((l) => t >= l.s - 0.05 && t <= l.e + 0.25);
  if (!line) return null;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, ...(top ? { top: 36 } : { bottom: 54 }), display: "flex", justifyContent: "center" }}>
      <div style={{ background: "#0b1220d9", borderRadius: 16, padding: "12px 28px", maxWidth: 1500, textAlign: "center", font: `700 44px ${FONT}`, color: "#fff", lineHeight: 1.25 }}>
        {line.words.map((w, i) => (
          <span key={i} style={{ color: t >= w.s - 0.02 && t < w.e + 0.08 ? "#ffd23f" : "#ffffff" }}>{w.w}{" "}</span>
        ))}
      </div>
    </div>
  );
};

// ---------- boxes (CSS px of the 1920x1080 page, from capture.mjs boxes.json and the screenshots) ----------
const B = {
  legendModis: { x: 930, y: 259, w: 192, h: 18 },
  legendViirs: { x: 609, y: 282, w: 260, h: 18 },
  gap: { x: 930, y: 345, w: 365, h: 140 },
  seamRow: { x: 612, y: 288, w: 700, h: 32 },
  seamNaive: { x: 1206, y: 288, w: 100, h: 32 },
  seamHarm: { x: 1108, y: 288, w: 90, h: 32 },
  seamStep: { x: 1105, y: 849, w: 590, h: 46 },
  modes: { x: 1061, y: 424, w: 302, h: 33 },
  totalsOld: { x: 1716, y: 872, w: 58, h: 130 },
  tools: { x: 12, y: 238, w: 298, h: 36 },
  years: { x: 818, y: 60, w: 204, h: 35 },
  grid: { x: 1105, y: 570, w: 790, h: 380 },
  anomTab: { x: 1155, y: 426, w: 81, h: 29 },
  anomLegend: { x: 1061, y: 470, w: 424, h: 72 },
  nowLevel: { x: 1062, y: 186, w: 516, h: 30 },
  dlButtons: { x: 1061, y: 718, w: 735, h: 80 },
  dlPoints: { x: 1219, y: 721, w: 125, h: 33 },
  dlDates: { x: 1061, y: 826, w: 448, h: 33 },
  chartVal: { x: 612, y: 248, w: 696, h: 205 },
  bias: { x: 788, y: 118, w: 70, h: 46 },
};

// ---------- the timeline (seconds; voice_nasa words with the 0.5 s pause after "The jump is gone.") ----------
const T = { s2: 3.25, s3: 7.42, s4: 10.5, s5: 12.12, s6: 15.8, s6b: 17.85, s7: 20.6, s8: 22.7, end: 26.25 };

export const Pitch: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / PITCH_FPS;
  // Each scene fades in over the one before it (no dip to the dark background).
  const fade = (a: number) => span(t, a - 0.12, a + 0.12);
  const inScene = (a: number, b: number) => t >= a - 0.15 && t < b + 0.15;
  const layers: React.ReactNode[] = [];

  // 1. Two sensors, two scales: MODIS (blue) far below VIIRS (purple) for the same fires.
  if (t < T.s2 + 0.15) {
    const v = view(camAt([{ t: 0, x: 960, y: 395, z: 1.85 }, { t: 3.3, x: 975, y: 390, z: 2.05 }], t));
    layers.push(
      <AbsoluteFill key="s1">
        <Shot src="08-method-harm" v={v} />
        <Ring v={v} b={B.legendModis} t={t} at={0.3} until={1.95} color={BLUE} label="MODIS, since 2000" labelSide="above" />
        <Ring v={v} b={B.legendViirs} t={t} at={1.0} until={1.95} color="#8a3fd1" label="VIIRS, since 2012" labelSide="below" />
        <Ring v={v} b={B.gap} t={t} at={1.8} until={3.4} dim label="same fires, ~4× apart" labelSide="above" />
      </AbsoluteFill>,
    );
  }

  // 2. Joined as they are: the worldwide step at the 2012 handover (the site's own seams table).
  if (inScene(T.s2, T.s3)) {
    const v = view(camAt([{ t: T.s2, x: 960, y: 300, z: 1.9 }, { t: T.s3, x: 990, y: 300, z: 2.1 }], t));
    layers.push(
      <AbsoluteFill key="s2" style={{ opacity: fade(T.s2) }}>
        <Shot src="10-method-seams" v={v} />
        <Ring v={v} b={B.seamRow} t={t} at={3.55} until={5.3} label="MODIS → VIIRS handover, 2012" labelSide="above" />
        <Ring v={v} b={B.seamNaive} t={t} at={5.35} until={7.5} dim label="raw records joined" labelSide="below" />
        <Badge t={t} at={5.45} until={7.5} x={1480} y={170} big="×3.8" small="fake jump, worldwide" color={ORANGE} />
      </AbsoluteFill>,
    );
  }

  // 3. The calendar as recorded, its 2012 step; one click and the MODIS years take the VIIRS scale,
  //    revealed from the bottom (2002) up, so the changing rows move first.
  if (inScene(T.s3, T.s4)) {
    const v = view(camAt([
      { t: T.s3, x: 1440, y: 700, z: 1.5 }, { t: 9.9, x: 1450, y: 740, z: 1.55 }, { t: 10.5, x: 1500, y: 800, z: 1.7 },
    ], t));
    const w = span(t, 8.45, 10.0);
    const edge = w <= 0 ? H + 10 : sy(v, 1090) + (sy(v, 410) - sy(v, 1090)) * w;
    layers.push(
      <AbsoluteFill key="s3" style={{ opacity: fade(T.s3) }}>
        <Shot src="02-raw" v={v} />
        <Shot src="03-harm" v={v} clip={`inset(${Math.max(0, edge)}px 0 0 0)`} />
        {w > 0 && w < 1 && <div style={{ position: "absolute", left: 0, top: edge - 3, width: W, height: 6, background: ORANGE, boxShadow: `0 0 30px ${ORANGE}` }} />}
        <Ring v={v} b={B.seamStep} t={t} at={7.5} until={8.4} dim label="2012: a sensor change, not more fire" labelSide="above" />
        <Pointer v={v} t={t} from={7.75} to={8.9} clicks={[8.35]} path={[{ t: 7.75, x: 1300, y: 640 }, { t: 8.25, x: 1108, y: 441 }, { t: 8.9, x: 1112, y: 446 }]} />
        <Ring v={v} b={B.totalsOld} t={t} at={9.6} until={10.6} label="MODIS years on the VIIRS scale" labelSide="left" />
      </AbsoluteFill>,
    );
  }

  // 4. The payoff: the same seams-table row, harmonized.
  if (inScene(T.s4, T.s5)) {
    const v = view(camAt([{ t: T.s4, x: 980, y: 300, z: 2.1 }, { t: T.s5, x: 980, y: 300, z: 2.2 }], t));
    layers.push(
      <AbsoluteFill key="s4" style={{ opacity: fade(T.s4) }}>
        <Shot src="10-method-seams" v={v} />
        <Ring v={v} b={B.seamHarm} t={t} at={10.6} until={12.2} color={BLUE} dim label="harmonized" labelSide="below" />
        <Badge t={t} at={10.75} until={12.2} x={1480} y={170} big="×0.97" small="no jump" color={BLUE} />
      </AbsoluteFill>,
    );
  }

  // 5. Any area, any years, every month.
  if (inScene(T.s5, T.s6)) {
    const v = view(camAt([
      { t: T.s5, x: 560, y: 230, z: 1.7 }, { t: 13.75, x: 640, y: 210, z: 1.65 }, { t: 14.65, x: 1440, y: 740, z: 1.45 }, { t: T.s6, x: 1450, y: 750, z: 1.5 },
    ], t));
    layers.push(
      <AbsoluteFill key="s5" style={{ opacity: fade(T.s5) }}>
        <Shot src="03-harm" v={v} />
        <Ring v={v} b={B.tools} t={t} at={12.2} until={13.3} label="draw any area" labelSide="right" />
        <Ring v={v} b={B.years} t={t} at={12.9} until={13.8} label="any years" labelSide="left" />
        <Pointer v={v} t={t} from={12.15} to={13.75} clicks={[]} path={[{ t: 12.15, x: 300, y: 420 }, { t: 12.6, x: 60, y: 256 }, { t: 13.1, x: 925, y: 78 }]} />
        <Ring v={v} b={B.grid} t={t} at={14.7} until={15.9} label="every month since 2000" labelSide="left" />
      </AbsoluteFill>,
    );
  }

  // 6a. Unusual months: the Anomaly mode of the same calendar.
  if (inScene(T.s6, T.s6b)) {
    const v = view(camAt([{ t: T.s6, x: 1450, y: 650, z: 1.55 }, { t: T.s6b, x: 1450, y: 650, z: 1.65 }], t));
    layers.push(
      <AbsoluteFill key="s6" style={{ opacity: fade(T.s6) }}>
        <Shot src="04-anomaly" v={v} />
        <Pointer v={v} t={t} from={15.8} to={17.0} clicks={[16.05]} path={[{ t: 15.8, x: 1300, y: 520 }, { t: 16.0, x: 1196, y: 441 }, { t: 17.0, x: 1198, y: 443 }]} />
        <Ring v={v} b={B.anomLegend} t={t} at={16.25} until={17.95} label="vs median of the same month · colour-blind safe" labelSide="below" />
      </AbsoluteFill>,
    );
  }

  // 6b. Today against the 25-year median.
  if (inScene(T.s6b, T.s7)) {
    const v = view(camAt([{ t: T.s6b, x: 1450, y: 330, z: 1.95 }, { t: T.s7, x: 1440, y: 335, z: 2.1 }], t));
    layers.push(
      <AbsoluteFill key="s6b" style={{ opacity: fade(T.s6b) }}>
        <Shot src="05-now" v={v} />
        <Ring v={v} b={B.nowLevel} t={t} at={17.95} until={20.7} dim label="+59 % vs 25-year median (Nov 1–13)" labelSide="below" />
      </AbsoluteFill>,
    );
  }

  // 7. Downloads: the hot spot CSV for any dates.
  if (inScene(T.s7, T.s8)) {
    const v = view(camAt([{ t: T.s7, x: 1430, y: 770, z: 1.95 }, { t: T.s8, x: 1430, y: 775, z: 2.1 }], t));
    layers.push(
      <AbsoluteFill key="s7" style={{ opacity: fade(T.s7) }}>
        <Shot src="07-downloads" v={v} />
        <Ring v={v} b={B.dlPoints} t={t} at={20.75} until={21.85} label="every hot spot, CSV" labelSide="above" />
        <Ring v={v} b={B.dlDates} t={t} at={21.85} until={22.8} label="any dates" labelSide="right" />
        <Pointer v={v} t={t} from={20.65} to={22.8} clicks={[21.35]} path={[{ t: 20.65, x: 1500, y: 860 }, { t: 21.25, x: 1281, y: 739 }, { t: 21.9, x: 1290, y: 745 }, { t: 22.5, x: 1200, y: 842 }]} />
      </AbsoluteFill>,
    );
  }

  // 8. The check on years the method never saw.
  if (inScene(T.s8, T.end)) {
    const v = view(camAt([{ t: T.s8, x: 960, y: 290, z: 1.8 }, { t: T.end, x: 960, y: 285, z: 1.95 }], t));
    layers.push(
      <AbsoluteFill key="s8" style={{ opacity: fade(T.s8) }}>
        <Shot src="09-method-val" v={v} />
        <Ring v={v} b={B.chartVal} t={t} at={22.8} until={24.2} color="#8a3fd1" label="fitted 2012–20, tested on 2021–25" labelSide="below" />
        <Ring v={v} b={B.bias} t={t} at={24.25} until={26.35} label="Northern California: total bias +4.2 % on unseen years" labelSide="below" />
      </AbsoluteFill>,
    );
  }

  // 9. End card.
  if (t >= T.end - 0.15) {
    const k = fade(T.end);
    const up = (a: number) => ({ opacity: span(t, a, a + 0.4), transform: `translateY(${(1 - span(t, a, a + 0.4)) * 24}px)` });
    const v = view({ t, x: 960, y: 540, z: 1.05 + 0.03 * span(t, T.end, 29.5) });
    layers.push(
      <AbsoluteFill key="end" style={{ opacity: k }}>
        <AbsoluteFill style={{ filter: "blur(10px) saturate(0.9)" }}><Shot src="03-harm" v={v} /></AbsoluteFill>
        <AbsoluteFill style={{ background: "linear-gradient(180deg, #0b1220e6, #0b1220f2)" }} />
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: FONT, color: "#fff", textAlign: "center", paddingBottom: 90 }}>
          <div style={{ ...up(26.3), font: `800 120px ${FONT}`, letterSpacing: -2 }}>Burn Calendar</div>
          <div style={{ ...up(26.45), font: `500 42px ${FONT}`, color: "#c9d4e6", marginTop: 12 }}>One fire record from MODIS and VIIRS, 2000 to today</div>
          <div style={{ ...up(26.9), font: `800 76px ${FONT}`, color: ORANGE, marginTop: 48 }}>nasa.pin-planet.org</div>
          <div style={{ ...up(26.75), font: `600 36px ${FONT}`, color: "#e8eef8", marginTop: 34 }}>Open source · Data: NASA FIRMS (MODIS and VIIRS 375 m hot spots)</div>
          <div style={{ ...up(26.6), font: `500 32px ${FONT}`, color: "#9fb0c9", marginTop: 14 }}>Team Catharsis · NASA Space Apps Challenge 2026</div>
        </AbsoluteFill>
      </AbsoluteFill>,
    );
  }

  return (
    <AbsoluteFill style={{ background: "#0b1220" }}>
      {layers}
      <Captions t={t} top={t >= T.s3 && t < T.s4} />
    </AbsoluteFill>
  );
};

export const PITCH_DEBUG = { interpolate };
