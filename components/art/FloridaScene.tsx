// The public site's hero until LendHous chooses a photograph (PLACEHOLDER): a South Florida house on the water, drawn
// in the brand's line style. The site is always light, so it uses the site's own colors.
const SAGE = "#677d67";
const INK = "#202b28";
const CREAM = "#fafbf8";
const WASH = "#e4e9e1";

const line = { fill: "none", stroke: SAGE, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Palm({ base, top, lean }: { base: [number, number]; top: [number, number]; lean: number }) {
  const [bx, by] = base; const [tx, ty] = top;
  const fronds = [[-78, 6], [-64, -26], [-30, -46], [12, -50], [50, -34], [76, -6], [62, 20], [-52, 26]];
  return (
    <g>
      <path {...line} strokeWidth={3} d={`M${bx} ${by} C ${bx + lean} ${by - 80}, ${tx - lean} ${ty + 80}, ${tx} ${ty}`} />
      {[0.2, 0.35, 0.5, 0.65, 0.8].map((t) => {
        const x = bx + (tx - bx) * t + Math.sin(t * Math.PI) * lean * 0.6; const y = by + (ty - by) * t;
        return <path key={t} {...line} strokeWidth={1.4} d={`M${x - 6} ${y} q6 -4 12 0`} />;
      })}
      {fronds.map(([dx, dy]) => <path key={`${dx}${dy}`} {...line} d={`M${tx} ${ty} Q ${tx + dx * 0.5} ${ty + dy - 18}, ${tx + dx} ${ty + dy}`} />)}
      <circle cx={tx - 4} cy={ty + 6} r={4} fill={SAGE} />
      <circle cx={tx + 5} cy={ty + 7} r={4} fill={SAGE} />
    </g>
  );
}

export function FloridaScene() {
  return (
    <svg viewBox="0 -100 600 560" preserveAspectRatio="xMidYMax slice" role="img" aria-label="A drawing of a South Florida house on the water, between two palm trees" data-testid="hero-art" style={{ width: "100%", height: "100%", display: "block", background: CREAM }}>
      {/* the drawing's shapes are one picture, named by the label above; cropped to the frame on narrow screens */}
      <g aria-hidden="true">
      <rect x={0} y={-100} width={600} height={560} fill={CREAM} />
      <circle cx={438} cy={118} r={58} fill={WASH} />
      <circle {...line} cx={438} cy={118} r={58} />
      <path {...line} strokeWidth={1.4} d="M120 92 q8 -8 16 0 q8 -8 16 0 M178 64 q6 -6 12 0 q6 -6 12 0" />
      {/* the water in front */}
      <rect x={0} y={362} width={600} height={98} fill={WASH} />
      <path {...line} d="M0 362 H600" />
      {[384, 404, 424, 444].map((y, row) => <path key={y} {...line} strokeWidth={1.4} strokeDasharray={`${40 - row * 6} ${18 + row * 4}`} strokeDashoffset={row * 23} d={`M${18 + row * 12} ${y} H${582 - row * 12}`} />)}
      {/* the house: low, flat roof with a deep overhang */}
      <rect x={150} y={258} width={306} height={104} fill={CREAM} stroke={SAGE} strokeWidth={2} />
      <path d="M118 252 H492 V262 H118 Z" fill={INK} />
      <path {...line} d="M180 236 H420 V252 M180 236 V252" />
      <rect x={176} y={282} width={92} height={62} fill={WASH} stroke={SAGE} strokeWidth={2} />
      <path {...line} d="M206 282 V344 M237 282 V344" />
      <rect x={290} y={278} width={36} height={84} fill={CREAM} stroke={SAGE} strokeWidth={2} />
      <circle cx={319} cy={322} r={2.5} fill={SAGE} />
      <rect x={348} y={282} width={86} height={62} fill={WASH} stroke={SAGE} strokeWidth={2} />
      <path {...line} d="M391 282 V344" />
      <path {...line} d="M150 362 H456" />
      <path {...line} strokeWidth={1.4} d="M160 362 q10 -18 20 0 q10 -18 20 0 M410 362 q10 -18 20 0 q10 -18 20 0" />
      <Palm base={[96, 362]} top={[118, 168]} lean={-18} />
      <Palm base={[508, 362]} top={[490, 198]} lean={16} />
      </g>
    </svg>
  );
}
