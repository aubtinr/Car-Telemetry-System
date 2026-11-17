// Seven-segment digits drawn in SVG, like an old LCD/VFD dash: unlit segments
// stay faintly visible ("ghost 8s"). No web font needed, so it works offline.

// Segments a–g: a top, b top-right, c bottom-right, d bottom, e bottom-left,
// f top-left, g middle.
const MAP: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgedc",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
  "-": "g",
  " ": "",
};

const T = 5; // half segment thickness
function h(y: number, x0: number, x1: number) {
  return `${x0},${y} ${x0 + T},${y - T} ${x1 - T},${y - T} ${x1},${y} ${x1 - T},${y + T} ${x0 + T},${y + T}`;
}
function v(x: number, y0: number, y1: number) {
  return `${x},${y0} ${x + T},${y0 + T} ${x + T},${y1 - T} ${x},${y1} ${x - T},${y1 - T} ${x - T},${y0 + T}`;
}
const SEGS: Record<string, string> = {
  a: h(6, 10, 50),
  g: h(50, 10, 50),
  d: h(94, 10, 50),
  f: v(6, 9, 47),
  b: v(54, 9, 47),
  e: v(6, 53, 91),
  c: v(54, 53, 91),
};
const CELL = 66;
const SKEW = 14; // px the italic slant shifts the bottom row left

interface Cell {
  ch: string;
  dp: boolean;
}

function toCells(value: string, digits: number): Cell[] {
  // "1,234" → "1234"; anything without a digit ("—", "N/A") → dashes.
  const clean = value.replace(/,/g, "");
  if (!/[0-9]/.test(clean)) return Array.from({ length: digits }, () => ({ ch: "-", dp: false }));
  const cells: Cell[] = [];
  for (const ch of clean) {
    if (ch === "." && cells.length) cells[cells.length - 1].dp = true;
    else if (MAP[ch] !== undefined) cells.push({ ch, dp: false });
  }
  while (cells.length < digits) cells.unshift({ ch: " ", dp: false });
  return cells.slice(-digits);
}

export function SevenSeg({
  value,
  digits,
  className = "",
  label,
  box,
}: {
  value: string;
  digits: number;
  className?: string;
  label?: string;
  box?: { x: number; y: number; width: number; height: number }; // when nested in another SVG
}) {
  const cells = toCells(value, digits);
  const w = digits * CELL + SKEW;
  return (
    <svg
      className={`sevenseg ${className}`}
      viewBox={`0 0 ${w} 100`}
      role="img"
      aria-label={label ?? value}
      {...(box ?? {})}
    >
      <g transform={`translate(${SKEW} 0) skewX(-8)`}>
        {cells.map((c, i) => {
          const on = MAP[c.ch] ?? "";
          return (
            <g key={i} transform={`translate(${i * CELL} 0)`}>
              {Object.entries(SEGS).map(([k, pts]) => (
                <polygon key={k} points={pts} className={on.includes(k) ? "ss-on" : "ss-off"} />
              ))}
              <circle cx={63} cy={94} r={4.5} className={c.dp ? "ss-on" : "ss-off ss-dp"} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
