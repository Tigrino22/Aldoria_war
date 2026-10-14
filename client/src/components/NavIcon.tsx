/**
 * Icônes du menu : un seul jeu de pictogrammes au trait, dessinés pour ce qu'ils représentent
 * (une tour pour l'hôtel de ville, une balance pour les offres, un sac de butin pour le pillage…).
 * Le trait prend la couleur du texte : or sur bois sombre, comme la carte et la page Tribu.
 */
const PATHS = {
  village: (
    <>
      <path d="M3 21h18" />
      <path d="M4 21v-8l5-4 5 4v8" />
      <path d="M14 21v-6l3.5-3 3.5 3v6" />
      <path d="M8 21v-4h2v4" />
    </>
  ),
  hotel: (
    <>
      <path d="M4 21h16" />
      <path d="M6 21V8h12v13" />
      <path d="M6 8V4h2.5v2h2V4h3v2h2V4H18v4" />
      <path d="M10.5 21v-4a1.5 1.5 0 0 1 3 0v4" />
      <path d="M12 11v2" />
    </>
  ),
  caserne: (
    <>
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
      <path d="m13 19 6-6" />
      <path d="m16 16 4 4" />
      <path d="m19 21 2-2" />
      <path d="M9.5 17.5 21 6V3h-3L6.5 14.5" />
      <path d="m11 19-6-6" />
      <path d="m8 16-4 4" />
      <path d="m5 21-2-2" />
    </>
  ),
  marche: (
    <>
      <path d="M3 9 4.5 4h15L21 9" />
      <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
      <path d="M5 11.5V21h14v-9.5" />
      <path d="M10 21v-5h4v5" />
    </>
  ),
  offres: (
    <>
      <path d="M12 3v18" />
      <path d="M8 21h8" />
      <path d="M5 7h14" />
      <path d="m5 7-3 7a3 3 0 0 0 6 0z" />
      <path d="m19 7-3 7a3 3 0 0 0 6 0z" />
    </>
  ),
  apercu: (
    <>
      <path d="M3 11.5 7 8l4 3.5V19H3z" />
      <path d="M6 19v-3h2v3" />
      <path d="M14 9h7" />
      <path d="M14 13h7" />
      <path d="M14 17h7" />
    </>
  ),
  gestionnaire: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  troupes: (
    <>
      <path d="M6 20v-9a6 6 0 0 1 12 0v9z" />
      <path d="M6 13h12" />
      <path d="M12 13v7" />
      <path d="M12 3V1.5" />
      <path d="M9 16.5h1M14 16.5h1" />
    </>
  ),
  ralliement: (
    <>
      <path d="M5 21V3" />
      <path d="M5 4h13l-3 4 3 4H5" />
      <path d="M2.5 21h5" />
    </>
  ),
  pillage: (
    <>
      <path d="M9 3h6l-1.5 4h-3z" />
      <path d="M10.5 7C6.5 9 4 12.5 4 16a5 5 0 0 0 5 5h6a5 5 0 0 0 5-5c0-3.5-2.5-7-6.5-9" />
      <path d="M14 12.5c-.5-.7-1.2-1-2-1-1.1 0-2 .6-2 1.5 0 2 4 1 4 3 0 .9-.9 1.5-2 1.5-.8 0-1.5-.3-2-1" />
      <path d="M12 10.5v1M12 17.5v1" />
    </>
  ),
  carte: (
    <>
      <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" />
      <path d="M9 3v15M15 6v15" />
    </>
  ),
  rapports: (
    <>
      <path d="M7 3h12v14a4 4 0 0 1-4 4H5" />
      <path d="M5 21a2 2 0 0 1-2-2v-2h12v2a2 2 0 0 0 2 2" />
      <path d="M7 3a2 2 0 0 0-2 2v12" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  messages: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
      <circle cx="12" cy="15" r="1.8" />
    </>
  ),
  tribu: (
    <>
      <path d="m12 3 8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="m8 10 4 3 4-3" />
      <path d="m8 14 4 3 4-3" />
    </>
  ),
  classement: (
    <>
      <path d="M3 21h18" />
      <path d="M9 21V10h6v11" />
      <path d="M3 21v-7h6M15 21v-5h6v5" />
      <path d="m12 2.5 1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z" />
    </>
  ),
  guerres: (
    <>
      <path d="M5 21h14" />
      <path d="M9 21v-3h6v3" />
      <path d="M12 18c-3 0-5-2-5-4.8 0-2.5 1.6-4 2.8-5.6.3 1.6 1.2 2.4 2.2 2.8.2-2.6 1.2-4.7 3-6.4.4 2.4 3 4.4 3 8.6 0 3-2.4 5.4-6 5.4z" />
    </>
  ),
  monde: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z" />
    </>
  ),
  wiki: (
    <>
      <path d="M12 6.5C10 5 7 4.5 3.5 4.5v14c3.5 0 6.5.5 8.5 2 2-1.5 5-2 8.5-2v-14c-3.5 0-6.5.5-8.5 2z" />
      <path d="M12 6.5v14" />
    </>
  ),
  compte: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  admin: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9M17 6l3 3M14.5 8.5l2 2" />
    </>
  ),
  // Croisades : la Citadelle et sa bannière, puis les pictogrammes de sa page (chronique, récompenses).
  croisade: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21v-9h3v2h2v-2h4v2h2v-2h3v9" />
      <path d="M10 21v-3a2 2 0 0 1 4 0v3" />
      <path d="M12 12V3" />
      <path d="M12 3.5h5l-1.5 2 1.5 2h-5" />
    </>
  ),
  // Provinces : un territoire découpé, avec la bannière plantée sur l'une d'elles.
  province: (
    <>
      <path d="M3 6.5 8.5 4l6 2.5L21 4v13.5L14.5 20l-6-2.5L3 20z" />
      <path d="M8.5 4v13.5M14.5 6.5V20" />
      <path d="M11.5 14V8.2" />
      <path d="M11.5 8.5h3l-.9 1.2.9 1.2h-3" />
    </>
  ),
  muraille: (
    <>
      <path d="M3 6h18v14H3z" />
      <path d="M3 10.7h18M3 15.3h18" />
      <path d="M8 6v4.7M15 6v4.7M11.5 10.7v4.6M5.5 15.3V20M17.5 15.3V20" />
    </>
  ),
  banniere: (
    <>
      <path d="M5 21V3" />
      <path d="M5 4h13l-3 4 3 4H5" />
    </>
  ),
  porte: (
    <>
      <path d="M5 21V9a7 7 0 0 1 14 0v12" />
      <path d="M3 21h18" />
      <path d="M9 21v-9M12 21v-10M15 21v-9M7.5 14h9M7.5 17.5h9" />
    </>
  ),
  couronne: (
    <>
      <path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z" />
      <path d="M5 19h14" />
    </>
  ),
  relique: (
    <>
      <path d="M12 2.5l6 6-6 13-6-13z" />
      <path d="M6 8.5h12M9.5 8.5 12 21.5l2.5-13" />
    </>
  ),
  tresor: (
    <>
      <path d="M3 10h18v10H3z" />
      <path d="M3 10a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4" />
      <path d="M3 13.5h18" />
      <path d="M10.5 12h3v3h-3z" />
    </>
  ),
  medaille: (
    <>
      <path d="M8 3l2.5 6M16 3l-2.5 6" />
      <circle cx="12" cy="15" r="6" />
      <path d="m12 12 .9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z" />
    </>
  ),
  bouclier: (
    <>
      <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />
      <path d="M12 3v18" />
    </>
  ),
  quitter: (
    <>
      <path d="M14 3H6v18h8" />
      <path d="M10 12h11M18 9l3 3-3 3" />
    </>
  ),
};

export type NavIconName = keyof typeof PATHS;

export function NavIcon({ name, size = 22 }: { name: NavIconName; size?: number }) {
  return (
    <svg
      className="nav-svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
