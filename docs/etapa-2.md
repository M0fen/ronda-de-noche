# Etapa 2 · HOMERIS

Plan de la segunda etapa de *Ronda de noche*. La primera termina con la escena que ya está en el juego (`src/finale.ts`): prendes la luz, eso abre Cirugía, el médico llega con la camilla, la otra enfermera te inyecta y el viaje te deja frente al **Hospital Mental Universitario de Risaralda (HOMERIS)**, en la Avenida 30 de Agosto. Te entran por la puerta principal. Esta etapa empieza adentro.

## La idea en una línea

La dosis no es una mecánica: es el viaje. Te sacó del San Jorge y te dejó en HOMERIS. Tienes que encontrar el **fusible 2 de 4** y salir antes de que el médico te «atienda», en un hospital que por fuera es el de verdad y por dentro nadie conoce.

## El lugar

**Por fuera, como se ve hoy** (ya está en `src/exterior.ts`): el frente blanco de dos pisos con las franjas turquesa y el letrero grande «HOMERIS» con su redondel, la banda «Hospital Mental Universitario de Risaralda» a lo largo del ala, la torre de escaleras turquesa, la puerta de vidrio con su marquesina, el parqueadero, la caseta del vigilante con el televisor prendido, los samanes sobre la franja verde y la avenida con su separador. Es lo que la gente de Pereira reconoce.

**Por dentro, inventado.** Casi nadie lo conoce, así que lo diseñamos libre, con el aire de lo que el hospital cuenta de su propia historia (sin nombrar a nadie real):

- El terreno fue el **pabellón de tuberculosos del San Jorge** (1951–1967). Después, «hogar del mendigo y centro de salud mental» (1968–1980). Al San Jorge lo une un traslado de verdad: después del terremoto de 1979 mandaron de vuelta para allá a los pacientes de la unidad de salud mental del San Jorge. Por eso la escena no es un salto arbitrario: el traslado ya pasó una vez.
- De la época del manicomio (1968–1981) el propio hospital menciona cuartos de encierro, comedores de cemento, platos metálicos, cocina de leña y baños con manguera junto al aljibe.
- En fotos de los años 70 y 80 hay pabellones bajos con corredores de teja alrededor de un patio, un patio central con un busto y techos de lámina sobre los pasillos, rejas verdes en las puertas de Urgencias y escaleras encerradas en reja.

Con eso, el interior de la etapa:

| Zona | Qué hay |
|---|---|
| El hall | Donde te dejan: la camilla vacía, el mostrador, la luz que no se va nunca (el médico lo dijo en la puerta) |
| Patio central | Corredores techados alrededor de un patio con un busto; la ruta que une todo y donde más te ven |
| Pabellón viejo (el de tuberculosos) | Camas de hierro, ventanas altas; la parte más antigua y la que el médico usa |
| Cuartos de encierro | Puertas con ventanilla, pasillo angosto; esconderse aquí es una apuesta |
| Comedor de cemento y cocina de leña | Mesas fijas, platos metálicos que suenan si los tocas |
| El aljibe y los lavaderos | Afuera, atrás; agua, mangueras, la loma hacia la quebrada |
| La reja de Urgencias | La puerta verde de barrotes que separa el hall del resto; el fusible abre su cerradura |

## Los personajes

**El médico.** Empuja la camilla a todas partes; por el chirrido sabes dónde está. Siempre cortés. Su espejo frontal es su ojo: si tu linterna le da en el espejo, te ve. Si te alcanza, te acuesta en la camilla y despiertas de nuevo en el hall (el «atrapado» de esta etapa).

**La otra (Hna. Iris).** Rápida, sonriente detrás del tapabocas, con la jeringa de colores. Ronda sin camilla y oye bien; tararea la canción de la Jefa, más lenta. Si te toca, un pinchazo: la imagen vuelve a irse a colores un momento y pierdes tiempo.

**La Jefa.** Se quedó en el San Jorge («Ella se queda. Ella no viene.»). Se puede oír su tarareo en la radio de la caseta del vigilante o por el teléfono del hall: el único rastro de la primera parte.

## Ritmo

1. **El hall.** Despiertas en la camilla. La puerta de vidrio por la que entraste ya no abre; afuera se ve el parqueadero de verdad y la caseta del vigilante con su televisor.
2. **La regla.** El chirrido de la camilla se acerca por el corredor: esconderse detrás del mostrador. *Las ruedas te dicen dónde está; su espejo, si te ve.*
3. **El patio.** Cruzarlo es el primer riesgo; Iris pasa por los corredores.
4. **El pabellón viejo.** La primera nota de K. en este hospital; el registro 4.
5. **Cocina y comedor.** Ruido fácil (platos); el registro 5.
6. **El fusible.** En la caja de la reja de Urgencias. Sacarlo apaga la luz que «no se va nunca»: el médico deja la camilla y camina hacia ti, por primera vez sin ella.
7. **La salida.** Por atrás, el aljibe y la loma. Fin de la etapa.

## Lo técnico

- **Exterior:** ya existe (`Exterior` en `src/exterior.ts`); la etapa puede empezar con un plano de la fachada desde la avenida.
- **Mapa:** un `content` por etapa con su propio mapa, áreas, notas y puntos de control; `Level` ya admite cualquier mapa.
- **El médico y Iris:** clases nuevas sobre el `Actor` de `finale.ts` (esqueleto, clips, capa de poses y mirada); la camilla y la jeringa ya existen.
- **El pinchazo de Iris:** reusa el posproceso del viaje (`post.trip` y los uniformes de color) con poca intensidad y pocos segundos.
- **Estado entre etapas:** una marca en `localStorage` al terminar la etapa 1; en el título, «Etapa 2» cuando esté desbloqueada.
- **Presupuesto:** máximo tres personajes con esqueleto en pantalla; 30 cuadros en un celular de gama media.

## Recursos

- **Modelo del médico:** hoy es una copia vestida del de la Jefa; conviene uno propio, de hombre alto, con el mismo contrato de huesos.
- **Voces:** más líneas del médico (corteses) e Iris en susurro.
- **Sonido:** chirrido de la camilla en bucle, grillos y avenida afuera, tubos, platos metálicos, agua del aljibe.
- **Referencias:** la reseña fotográfica y la historia de 50 años publicadas por el hospital (homeris.gov.co), las fotos de Google Maps del lugar y de Street View. Solo como referencia: nada fotográfico va dentro del juego.

## Decisiones abiertas

- ¿El interior sigue la época de manicomio (más miedo) o se parece a un hospital de hoy?
- ¿La Jefa aparece en esta etapa de algún modo, o solo se oye?
- ¿Cuatro etapas, una por fusible (San Jorge, HOMERIS, …)? ¿Cuáles serían los otros dos lugares reales de Pereira?
