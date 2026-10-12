/** Blason d'une tribu, tiré de son identifiant : couleur du champ, partition et métal changent d'une tribu à l'autre. */
const FIELDS = ['#7a1f1f', '#1f3f7a', '#2f5a2a', '#5b2a6e', '#7a4a12', '#1c5560', '#6e1f45', '#3a3a46'];
const METALS = ['#e8c25a', '#e9e4d4'];
const PARTITIONS = ['chevron', 'fess', 'pale', 'bend', 'cross', 'plain'] as const;

const SHIELD = 'M6 4h52v22c0 17-11 28-26 34C17 54 6 43 6 26Z';

export function crestColors(id: number) {
  return { field: FIELDS[id % FIELDS.length], metal: METALS[Math.floor(id / FIELDS.length) % METALS.length] };
}

export default function TribeCrest({ id, tag, size = 56, ally = false }: { id: number; tag: string; size?: number; ally?: boolean }) {
  const { field, metal } = crestColors(id);
  const part = PARTITIONS[Math.floor(id / 3) % PARTITIONS.length];
  const clip = `crest-${id}-${size}`;
  const label = tag.slice(0, 4);
  return (
    <svg className={`crest${ally ? ' ally' : ''}`} width={size} height={size * 1.0} viewBox="0 0 64 64" role="img" aria-label={`Blason de [${tag}]`}>
      <defs>
        <clipPath id={clip}>
          <path d={SHIELD} />
        </clipPath>
        <linearGradient id={`${clip}-shine`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.25" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="64" height="64" fill={field} />
        {part === 'chevron' && <path d="M0 50 32 22 64 50v12L32 34 0 62Z" fill={metal} opacity="0.9" />}
        {part === 'fess' && <rect y="24" width="64" height="12" fill={metal} opacity="0.9" />}
        {part === 'pale' && <rect x="26" width="12" height="64" fill={metal} opacity="0.9" />}
        {part === 'bend' && <path d="M-4 8 8-4l60 60-12 12Z" fill={metal} opacity="0.9" />}
        {part === 'cross' && <path d="M27 0h10v64H27zM0 22h64v10H0z" fill={metal} opacity="0.9" />}
        <rect width="64" height="64" fill={`url(#${clip}-shine)`} />
      </g>
      <path d={SHIELD} fill="none" stroke={ally ? '#62c8ff' : metal} strokeWidth="3" />
      <path d={SHIELD} fill="none" stroke="#000" strokeOpacity="0.45" strokeWidth="1" transform="translate(32 32) scale(0.86) translate(-32 -32)" />
      <text
        x="32"
        y="33"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="Cinzel, 'Times New Roman', serif"
        fontWeight="700"
        fontSize={label.length > 3 ? 13 : 16}
        fill="#fff"
        stroke="#000"
        strokeOpacity="0.55"
        strokeWidth="2.5"
        paintOrder="stroke"
      >
        {label}
      </text>
    </svg>
  );
}
