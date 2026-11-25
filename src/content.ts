// Level layout and story content for the Ward B slice.
// One map tile = 2 m. Columns grow east (+x), rows grow south (+z).
//
//  #  wall          .  floor        S  player start
//  D  door (shut)   d  door (open)  J  barred door (opens from one side)
//  X  sealed exit   =  power-locked door (later areas)   P  breaker panel
//  B  bed   L  locker bank   K  desk   C  fuse cabinet   s  shelves
//  h  chairs   o  gurney   t  trolley   v  TV cabinet   I  column   m  table and chairs
//  x  evacuation barricade (beds and chairs piled across the way)
export const MAP: string[] = [
  '################################',
  '################################',
  '################################',
  '#=...x.....................x..=#',
  '#=...x.....................x..=#',
  '#######d#######..########D######',
  '##........LL..#..#...........###',
  '##B..........B#..#..I.......L###',
  '##....t.......#.o#....hh.....###',
  '##B...........#..#..........v###',
  '##...I..KK.I..D..D....hh.....###',
  '##B...........#..#..I........###',
  '##............#t.#..o.....m..###',
  '##B..........B#..#......L....###',
  '##..L.L.......#..###############',
  '#####D#########..###############',
  '###s...C.######..###############',
  '###s....L######..###############',
  '###s.ss..#............#.....####',
  '###......J.K.I....I...#.....####',
  '###......#.K......hh..D.....P###',
  '##########.K..........#.....####',
  '##########.....S..hh..#.....####',
  '##########............##########',
  '###############XX###############',
  '################################',
];

// Barred door: which neighbour side can unbar it (dx,dz from the door cell).
export const BARRED: Record<string, { dx: number; dz: number }> = { '9,19': { dx: -1, dz: 0 } };

// Enamel plates on the door leaves. front = the leaf face toward +z ('x' doors) or +x ('z' doors).
export const DOOR_PLATES: Record<string, { front?: [string, string?]; back?: [string, string?] }> = {
  '7,5': { back: ['PABELLÓN B', 'SALA SANTA CLARA'] },
  '25,5': { back: ['SALA DE ESTAR'] },
  '14,10': { front: ['PABELLÓN B', 'SALA SANTA CLARA'] },
  '17,10': { back: ['SALA DE ESTAR'] },
  '5,15': { back: ['LENCERÍA', 'SOLO PERSONAL'] },
  '9,19': { front: ['LENCERÍA'] },
  '22,20': { back: ['CUARTO ELÉCTRICO', 'PELIGRO 440 V'] },
};

// Free-standing furniture facing (radians; local +Z is the front).
export const FACING: Record<string, number> = {
  '22,8': Math.PI / 2, '23,8': Math.PI / 2, '22,10': Math.PI / 2, '23,10': Math.PI / 2,
  '18,20': -Math.PI / 2, '19,20': -Math.PI / 2, '18,22': -Math.PI / 2, '19,22': -Math.PI / 2,
  '16,8': 0, '20,12': Math.PI / 2, '6,8': 0.3, '15,12': -0.2,
};

export const BOTTLES: [number, number][] = [[13, 22], [16, 13], [7, 8], [19, 7], [27, 11], [4, 19]];

export const LAMPS = [
  { id: 'lamp_rec', cx: 11, cz: 19 },
  { id: 'lamp_ward', cx: 9, cz: 10 },
];

// Dead-circuit emergency lights (world metres).
export const EMERGENCY = [
  { x: 32, y: 2.7, z: 46.7 },
  { x: 32, y: 2.85, z: 21 },
  { x: 32, y: 2.85, z: 7.2 },
  { x: 51, y: 2.85, z: 37.4 },
];

// Fear emitters swell the unease layer as you approach (world metres).
export const FEAR = [
  { x: 4.6, z: 8 }, { x: 59.3, z: 8 }, { x: 12, z: 36 }, { x: 5, z: 27 },
];

// broken glass across the north corridor before the dayroom door: the short way there is the loud one
export const GLASS: [number, number][] = [[22, 4], [23, 3], [24, 4]];

// Where the roof leaks (world metres). Each one is a stain on the ceiling, a puddle under it (s = its size), the
// wall beside it wet from the ceiling down if there is one, and a drip at the ones marked.
export const LEAKS: { x: number; z: number; s: number; drip?: boolean }[] = [
  { x: 32.5, z: 18.6, s: 1.4, drip: true }, { x: 31, z: 30, s: 1.1 }, { x: 26.3, z: 42.2, s: 1.6, drip: true }, { x: 13.2, z: 22.6, s: 1.3, drip: true },
  { x: 7.6, z: 13.3, s: 1.0 }, { x: 40, z: 8, s: 1.7 }, { x: 13.4, z: 6.9, s: 1.2 }, { x: 50, z: 20, s: 1.3, drip: true }, { x: 12, z: 36.5, s: 0.9 },
  { x: 52, z: 39, s: 1.0 }, { x: 56.6, z: 25, s: 1.0 },
];

export const PATROL: [number, number][] = [
  [7, 3], [12, 4], [20, 3], [25, 4], [22, 7], [26, 11], [19, 11],
  [7, 7], [11, 12], [5, 12], [15, 7], [16, 14],
];

export interface Area { id: string; name: string; sub: string; x0: number; x1: number; z0: number; z1: number }
export const AREAS: Area[] = [
  { id: 'reception', name: 'Recepción', sub: 'Admisiones · Primer piso', x0: 10, x1: 21, z0: 18, z1: 23 },
  { id: 'breaker', name: 'Cuarto eléctrico', sub: 'Planta y tableros', x0: 23, x1: 27, z0: 18, z1: 22 },
  { id: 'corridor', name: 'Pasillo principal', sub: 'Primer piso', x0: 15, x1: 16, z0: 5, z1: 17 },
  { id: 'north', name: 'Pasillo norte', sub: 'Cirugía · Escaleras', x0: 2, x1: 29, z0: 3, z1: 4 },
  { id: 'ward', name: 'Pabellón B', sub: 'Sala Santa Clara · Medicina interna', x0: 2, x1: 13, z0: 6, z1: 14 },
  { id: 'dayroom', name: 'Sala de estar', sub: 'Visitas', x0: 18, x1: 28, z0: 6, z1: 13 },
  { id: 'linen', name: 'Lencería', sub: 'Ropería', x0: 3, x1: 8, z0: 16, z1: 20 },
];

// Wall signs: face = side of the wall the sign faces (N = toward -z, S = +z, W = -x, E = +x).
export const SIGNS = [
  { text: 'PABELLÓN B', sub: 'SALA SANTA CLARA', x: 30, z: 21, y: 2.6, face: 'E' },
  { text: 'PABELLÓN B', sub: 'SALA SANTA CLARA', x: 15, z: 10, y: 2.6, face: 'N' },
  { text: 'SALA DE ESTAR', sub: 'VISITAS HASTA LAS 8 P. M.', x: 34, z: 21, y: 2.6, face: 'W' },
  { text: 'SALA DE ESTAR', sub: 'VISITAS HASTA LAS 8 P. M.', x: 51, z: 10, y: 2.6, face: 'N' },
  { text: 'LENCERÍA', sub: 'ROPERÍA · SOLO PERSONAL', x: 11, z: 30, y: 2.6, face: 'N' },
  { text: 'CUARTO ELÉCTRICO', sub: 'PELIGRO · ALTO VOLTAJE', x: 44, z: 41, y: 2.6, face: 'W' },
  { text: 'CIRUGÍA', sub: 'SIN ENERGÍA · NO PASAR', x: 60, z: 8, y: 2.62, face: 'W' },
  { text: 'ESCALERAS · SÓTANO', sub: 'ANFITEATRO', x: 4, z: 8, y: 2.62, face: 'E' },
  { text: 'SILENCIO', sub: 'HOSPITAL', x: 30, z: 25, y: 2.25, face: 'E' },
  { text: 'SALIDA', sub: 'EMERGENCIA', x: 32, z: 48, y: 2.62, face: 'N', green: true },
  { text: 'CUARTO ELÉCTRICO  →', sub: 'PLANTA Y TABLEROS · SOLO PERSONAL', x: 38.6, z: 36, y: 2.42, face: 'S' },
  { text: 'URGENCIAS', sub: '←  CERRADO POR OBRAS', x: 20, z: 42.6, y: 2.42, face: 'E' },
  { text: 'PROHIBIDO FUMAR', sub: 'SECRETARÍA DE SALUD DE RISARALDA', x: 47, z: 12, y: 2.3, face: 'S' },
  { text: 'CAPILLA', sub: '←  POR LAS ESCALERAS', x: 46, z: 6, y: 2.5, face: 'S' },
];

export type NoteKind = 'log' | 'record' | 'chart' | 'scrawl';
export interface NoteDef {
  id: string; title: string; kind: NoteKind; record?: number; body: string;
  place: { cx: number; cz: number; surface: 'desk' | 'gurney' | 'wall'; face?: 'N' | 'S' | 'E' | 'W'; ox?: number; oz?: number };
}

export const NOTES: NoteDef[] = [
  {
    id: 'log', title: 'Recepción · Libro de turno', kind: 'log',
    body: `02:10  Otra vez el racionamiento. La planta no arranca. Los pabellones quedan con las luces de emergencia.
02:35  Orden de la madre superiora: desocupar el Pabellón B apenas amanezca.
02:50  La hermana K. no quiere. Dice que a la paciente de la cama 3 no se la puede mover a oscuras.
03:15  Se fue la luz del todo. No hay línea en los teléfonos.
03:20  Los camilleros sacaron los cuatro fusibles principales y los escondieron en los pabellones. Dicen que mientras no haya luz, las puertas de Cirugía no abren. Que así es mejor. El tablero está en el cuarto al oriente de esta recepción.
03:31  El doctor de turno sigue en Cirugía. No contesta. Por las ventanitas de la puerta se ve una luz de colores.
03:40  Alguien está tarareando en el pasillo.
                                     J. Ospina, camillero`,
    place: { cx: 11, cz: 20, surface: 'desk', oz: -0.2 },
  },
  {
    id: 'ronda', title: 'Hoja de ronda · Pabellón B', kind: 'log',
    body: `RONDA DE NOCHE. Cada media hora, en este orden:
  1. Sala Santa Clara, cama por cama.
  2. Estación de enfermería: anotar.
  3. Pasillo norte, hasta la sala de estar.
  4. Sala de estar: apagar el televisor.
  5. Pasillo principal, y de vuelta al pabellón.
La ronda siguiente se hace al revés.
                                Hna. K.

(a lápiz, otra letra)
Mientras tararea, está en la ronda.
Si se calla, te está buscando.
Si se calla cerca, no salgas: a veces vuelve.
Y si te llevas algo de su pabellón, la ronda llega hasta acá.`,
    place: { cx: 11, cz: 21, surface: 'desk', oz: 0.1 },
  },
  {
    id: 'porter', title: 'Garabateado junto al tablero', kind: 'scrawl',
    body: `¿Se te muere la linterna? Dale manivela.
DESPACIO.
Nunca cerca de ella.
Ella lo oye todo.`,
    place: { cx: 28, cz: 21, surface: 'wall', face: 'W' },
  },
  {
    id: 'k1', title: 'Pabellón B · Notas del turno', kind: 'record', record: 1,
    body: `La de la cama 3 me volvió a pedir el arrullo. Se lo tarareo hasta que respira despacito.

La madre superiora dice que nos vamos al amanecer. Le dije que yo me voy cuando ellos estén dormidos.

Siempre están dormidos cuando se va la luz.
Es cuando están más seguros.

                                K.`,
    place: { cx: 8, cz: 10, surface: 'desk', ox: 0.2 },
  },
  {
    id: 'k2', title: 'Clavado dentro de la lencería', kind: 'record', record: 2,
    body: `Si está fuera de la cama, no es un paciente.

Si no es un paciente, es una visita.

Las visitas eran hasta las ocho.

                                K.`,
    place: { cx: 6, cz: 15, surface: 'wall', face: 'S' },
  },
  {
    id: 'k3', title: 'Clavado junto a la barricada · Pasillo norte', kind: 'record', record: 3,
    body: `No dejen que vuelva la luz.

Sin luz, la puerta de Cirugía no abre.
Y mientras yo haga la ronda, el doctor no se lleva a ninguno de los míos.

Cuando sale, empuja una camilla tapada, como si llevara a una paciente.
No es una paciente. Es la otra.
Trae los colores en una jeringa.

Si oyen las ruedas, escóndanse.
Y no miren los colores.

                                K.`,
    place: { cx: 26, cz: 5, surface: 'wall', face: 'N' },
  },
  {
    id: 'chart', title: 'Historia clínica · Cama 5', kind: 'chart',
    body: `MOTIVO       Refiere oír a una enfermera tarareando en el pasillo todas las noches.
NOTA         No hay hermanas de turno después de las 03:00.
INDICACIÓN   Permanecer en cama después de que se vaya la luz.
DESENLACE    La paciente no permaneció en cama.`,
    place: { cx: 20, cz: 12, surface: 'gurney' },
  },
];

export const RECORDS_TOTAL = 6;
