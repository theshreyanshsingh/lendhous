// LendHous's line drawings: one house for each loan program, in the brand's sage, for placeholders, empty states and the
// programs. They draw in currentColor on the card's own color, so they work on light and dark screens alike.
import type { Product } from "@/lib/engine";

const LINE = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const PLANE = { fill: "var(--card)", stroke: "currentColor", strokeWidth: 1.6, strokeLinejoin: "round" } as const;

function Ground() {
  return <path {...LINE} d="M16 170 H304" />;
}

/** A house with a door and two windows, the part every drawing shares. */
function House({ x, w, y = 100 }: { x: number; w: number; y?: number }) {
  const mid = x + w / 2;
  return (
    <g>
      <rect {...PLANE} x={x} y={y} width={w} height={170 - y} />
      <path {...LINE} d={`M${x - 10} ${y + 3} L${mid} ${y - 46} L${x + w + 10} ${y + 3}`} />
      <rect {...LINE} x={mid - 11} y={128} width={22} height={42} />
      <rect {...LINE} x={x + 14} y={y + 14} width={26} height={22} />
      <path {...LINE} d={`M${x + 27} ${y + 14} V${y + 36} M${x + 14} ${y + 25} H${x + 40}`} />
      <rect {...LINE} x={x + w - 40} y={y + 14} width={26} height={22} />
      <path {...LINE} d={`M${x + w - 27} ${y + 14} V${y + 36} M${x + w - 40} ${y + 25} H${x + w - 14}`} />
    </g>
  );
}

function Palm({ x, top = 88 }: { x: number; top?: number }) {
  return (
    <g {...LINE}>
      <path d={`M${x} 170 C ${x + 3} 140, ${x - 5} ${top + 28}, ${x + 5} ${top}`} />
      <path d={`M${x + 5} ${top} C ${x - 9} ${top - 10}, ${x - 23} ${top - 8}, ${x - 33} ${top + 2}`} />
      <path d={`M${x + 5} ${top} C ${x + 17} ${top - 12}, ${x + 33} ${top - 10}, ${x + 43} ${top}`} />
      <path d={`M${x + 5} ${top} C ${x - 1} ${top - 18}, ${x - 13} ${top - 24}, ${x - 23} ${top - 22}`} />
      <path d={`M${x + 5} ${top} C ${x + 13} ${top - 20}, ${x + 25} ${top - 26}, ${x + 35} ${top - 24}`} />
    </g>
  );
}

function FixFlip() {
  const rungs = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9];
  return (
    <>
      <Ground />
      <House x={90} w={140} y={98} />
      <path {...LINE} d="M200 74 V60 H214 V86" />
      <g {...LINE}>
        <path d="M250 170 L224 92 M264 170 L238 92" />
        {rungs.map((t) => <path key={t} d={`M${250 - 26 * t} ${170 - 78 * t} H${264 - 26 * t}`} />)}
      </g>
      <path {...PLANE} d="M272 170 V156 H288 V170" />
      <path {...LINE} d="M270 156 H290 M58 170 V150 H82 V170 M58 158 H82" />
    </>
  );
}

function Rental() {
  return (
    <>
      <Ground />
      <circle {...LINE} cx={62} cy={52} r={14} />
      <House x={74} w={124} y={102} />
      <Palm x={248} />
      <path {...LINE} d="M214 170 V146 M206 132 H226 V146 H206 Z" />
    </>
  );
}

function Bridge() {
  return (
    <>
      <Ground />
      <House x={150} w={124} y={102} />
      <path {...LINE} strokeDasharray="5 6" d="M30 168 Q 72 84, 136 128" />
      <path {...LINE} d="M126 120 L138 129 L124 134" />
      <circle {...LINE} cx={30} cy={168} r={3} />
    </>
  );
}

function GroundUp() {
  return (
    <>
      <Ground />
      <g {...LINE}>
        <path d="M96 170 V112 H224 V170" />
        {[111, 126, 141, 156, 171, 186, 201].map((x) => <path key={x} d={`M${x + 4} 170 V112`} />)}
        <path d="M90 113 L160 72 L230 113 M160 72 V112 M125 92 L139 112 M195 92 L181 112" />
        <path d="M262 170 V44 M274 170 V44 M262 160 L274 146 L262 132 L274 118 L262 104 L274 90 L262 76 L274 62 L262 48" />
        <path d="M206 44 H304 M206 44 L262 30 L304 44 M224 44 V80 M219 80 H229 M224 80 V86" />
      </g>
    </>
  );
}

const DRAWINGS: Record<Product, () => React.ReactElement> = { fix_flip: FixFlip, dscr: Rental, bridge: Bridge, ground_up: GroundUp };

/** One program's drawing. Decorative unless given a label. */
export function HouseArt({ product, className = "", label }: { product: Product; className?: string; label?: string }) {
  const Drawing = DRAWINGS[product] ?? FixFlip;
  return (
    <svg viewBox="0 0 320 200" className={`text-brand dark:text-[#93a993] ${className}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} data-testid="house-art">
      <Drawing />
    </svg>
  );
}

/** For empty lists: a small house, a little lighter than the drawings. */
export function EmptyArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="70 40 180 140" className={`text-brand/70 dark:text-[#93a993]/70 ${className}`} aria-hidden="true">
      <Ground />
      <House x={110} w={100} y={108} />
    </svg>
  );
}
