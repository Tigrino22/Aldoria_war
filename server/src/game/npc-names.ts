// Noms des PNJ : ils se fondent parmi les joueurs, sans mention « PNJ ». Prénoms dans l'esprit du Seigneur des Anneaux et de La Roue du Temps,
// puis surnoms facultatifs pour départager les homonymes (plusieurs centaines de prénoms × des dizaines de surnoms).

export const NPC_FIRST_NAMES: string[] = [
  // Terre du Milieu : hommes, elfes, nains, hobbits
  'Aragorn', 'Boromir', 'Faramir', 'Denethor', 'Theoden', 'Eomer', 'Eowyn', 'Theodred', 'Hama', 'Gamling',
  'Elrond', 'Arwen', 'Galadriel', 'Celeborn', 'Legolas', 'Thranduil', 'Haldir', 'Glorfindel', 'Elladan', 'Elrohir',
  'Gimli', 'Gloin', 'Thorin', 'Balin', 'Dwalin', 'Dain', 'Bifur', 'Bofur', 'Bombur', 'Oin',
  'Kili', 'Fili', 'Nori', 'Dori', 'Ori', 'Thrain', 'Thror', 'Durin', 'Telchar', 'Narvi',
  'Bilbon', 'Frodon', 'Samsagace', 'Peregrin', 'Meriadoc', 'Rosie', 'Primevere', 'Belladone', 'Fredegar', 'Lotho',
  'Isildur', 'Anarion', 'Elendil', 'Gilgalad', 'Earendil', 'Elwing', 'Luthien', 'Beren', 'Turin', 'Hurin',
  'Finrod', 'Fingolfin', 'Feanor', 'Maedhros', 'Maglor', 'Celebrimbor', 'Cirdan', 'Thingol', 'Melian', 'Idril',
  'Tuor', 'Eluwing', 'Gwindor', 'Beleg', 'Mablung', 'Halbarad', 'Imrahil', 'Beregond', 'Bergil', 'Ioreth',
  'Eorl', 'Brego', 'Baldor', 'Helm', 'Fengel', 'Freawine', 'Grima', 'Wulf', 'Cirion', 'Hador',
  'Barahir', 'Bregolas', 'Argonui', 'Arathorn', 'Gilraen', 'Angbor', 'Targon', 'Halmir', 'Orophin', 'Rumil',
  'Radagast', 'Saruman', 'Gandalf', 'Alatar', 'Pallando', 'Tom', 'Gildor', 'Erestor', 'Lindir',
  'Bard', 'Girion', 'Beorn', 'Roac', 'Tauriel', 'Bolg', 'Azog',
  // La Roue du Temps : Rivières Jumelles, Tar Valon, Cairhien, Andor, Illian, Tear, Shienar, Saldaea, Arad Doman, Aiels
  'Rand', 'Mat', 'Perrin', 'Egwene', 'Nynaeve', 'Moiraine', 'Lan', 'Thom', 'Elayne', 'Aviendha',
  'Min', 'Siuan', 'Gawyn', 'Galad', 'Logain', 'Loial', 'Verin', 'Cadsuane', 'Alanna', 'Faile',
  'Birgitte', 'Morgase', 'Tigraine', 'Gareth', 'Bryne', 'Elaida', 'Leane', 'Sheriam', 'Amys', 'Rhuarc',
  'Bael', 'Couladin', 'Sevanna', 'Han', 'Ingtar', 'Uno', 'Masema', 'Berelain', 'Annoura',
  'Tuon', 'Mazrim', 'Taim', 'Narishma', 'Rafela', 'Aram', 'Tam', 'Abell', 'Kari', 'Bran',
  'Haral', 'Nisao', 'Myrelle', 'Merana', 'Pevara', 'Tarna', 'Romanda', 'Lelaine', 'Moghedien', 'Lanfear',
  'Elyas', 'Gaul', 'Davram', 'Artur', 'Hawkwing', 'Demandred', 'Rahvin', 'Sammael',
  'Ishamael', 'Asmodean', 'Mesaana', 'Graendal', 'Bors', 'Rodel', 'Ituralde', 'Agelmar', 'Bashere', 'Davian',
  'Kiruna', 'Seaine', 'Anaiya', 'Sarene', 'Beonin', 'Verine', 'Egeanin', 'Domon',
  'Bayle', 'Coiren', 'Alviarin', 'Ispan', 'Ethenielle', 'Pedron', 'Niall', 'Galina', 'Therava', 'Maira',
  'Lews-Therin', 'Ilyena', 'Tamlin', 'Tellaen', 'Tomas', 'Gitara',
  
  // Noms inventés dans le même esprit, pour allonger la liste
  'Arathal', 'Belegorn', 'Caladhon', 'Daeron', 'Elenwe', 'Faelivrin', 'Galdor', 'Joran',
  'Kelvar', 'Laurelin', 'Mithrandil', 'Nimrodel', 'Orodreth', 'Pelendur', 'Quenmir', 'Rilmir', 'Silmarien', 'Thalion',
  'Ulmo-Wen', 'Valandil', 'Wilwarin', 'Yavanna', 'Zirakzil', 'Aldaron', 'Brandir', 'Calenhad', 'Dagnir', 'Eldarion',
  'Findegil', 'Gorlim', 'Harathor', 'Iorlas', 'Kalimir', 'Lomion', 'Morwen', 'Nauglir', 'Orchaldor', 'Pharazon',
  'Saeros', 'Taurion', 'Uldor', 'Vorondil', 'Warrick', 'Ancalagon', 'Beldir', 'Caranthir', 'Dorlas',
  'Egalmoth', 'Forlong', 'Gethron', 'Hirluin', 'Ivorwen', 'Jorund', 'Kellan', 'Lorindol', 'Maeglin', 'Nenniach',
  'Ohtar', 'Penlod', 'Quillan', 'Ruvain', 'Sirion', 'Telperion', 'Uinen', 'Voronwe', 'Wystan', 'Yrchon',
  'Alvarion', 'Branwen', 'Corwin', 'Darian', 'Elowen', 'Fenwick', 'Gwydion', 'Heldric', 'Isolde', 'Jareth',
  'Kaelith', 'Lysander', 'Marwen', 'Niamh', 'Oswin', 'Perrin-Vale', 'Quinlan', 'Rhosyn', 'Soren', 'Tamsin',
  'Ulric-Vane', 'Vesper', 'Wynn', 'Xanthe', 'Ysolde', 'Zephyr', 'Ardal', 'Bevan', 'Cadoc', 'Deryn',
  'Emrys', 'Fionn', 'Garrick', 'Hywel', 'Iolo', 'Kenrick', 'Llewen', 'Maelor', 'Neirin', 'Owain',
  'Padarn', 'Rhydian', 'Seren', 'Taliesin', 'Urien', 'Vaughan', 'Wynfor', 'Ynyr', 'Aelfric', 'Beorhtric',
  'Cenred', 'Dunstan', 'Eadwig', 'Frithuwald', 'Godric', 'Hereward', 'Ingvar', 'Leofric', 'Osric', 'Wulfstan',
];

/** Surnoms ajoutés quand le prénom est déjà pris. */
export const NPC_EPITHETS: string[] = [
  'le Sage', 'le Sombre', 'le Juste', 'le Brave', 'le Rouge', 'le Blanc', 'le Gris', 'le Vieux', 'le Jeune', 'le Borgne',
  'le Roux', 'le Taciturne', 'le Fier', 'le Rusé', 'le Patient', 'le Veilleur', 'le Marcheur', 'le Voyageur', 'le Forgeron', 'le Chasseur',
  'du Nord', 'du Sud', 'de l\'Est', 'de l\'Ouest', 'des Collines', 'des Marais', 'des Cimes', 'du Bois-Noir', 'de la Rivière', 'du Gué',
  'de Fer', 'de Cendre', 'd\'Argent', 'd\'Or', 'de Pierre', 'de Brume', 'de Tempête', 'de l\'Aube', 'du Crépuscule', 'de la Lune',
  'Main-de-Fer', 'Coeur-Vaillant', 'Œil-d\'Aigle', 'Pied-Léger', 'Barbe-Grise', 'Dague-Noire', 'Lame-Claire', 'Bouclier-Ferme', 'Corne-Haute', 'Cape-Verte',
];

/** Tire un nom : le prénom seul, puis avec un surnom, puis avec un numéro en dernier recours. `taken` dit si un pseudo existe déjà. */
export async function pickNpcName(random: () => number, taken: (username: string) => Promise<boolean>): Promise<string> {
  const first = NPC_FIRST_NAMES[Math.floor(random() * NPC_FIRST_NAMES.length)];
  if (!(await taken(first))) return first;
  for (let i = 0; i < 12; i++) {
    const named = `${first} ${NPC_EPITHETS[Math.floor(random() * NPC_EPITHETS.length)]}`;
    if (!(await taken(named))) return named;
  }
  for (let n = 2; n < 1000; n++) {
    const numbered = `${first} ${n}`;
    if (!(await taken(numbered))) return numbered;
  }
  throw new Error('Plus de nom disponible pour un PNJ');
}
