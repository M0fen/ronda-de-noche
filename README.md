# Ronda de noche

Tramo jugable de un survival horror en primera persona: recepción, Pabellón B, el primer fusible y la escena que abre la etapa 2 en el Hospital San Jorge, un hospital público colombiano (ficticio) una noche de racionamiento de 1992. Three.js + TypeScript + Vite. Todo el arte, el sonido y la música se generan por código.

```bash
npm install
npm run dev            # desarrollo
npm run build          # dist/ para Vercel
npm run build:single   # dist-single/index.html, un solo archivo
```

Modo de depuración: abre la página con `#debug` (minimapa, estado de la IA, conos de visión, ruidos).
Teclas: 1–5 teletransporte, G fantasma, N congelar a la Enfermera, M ocultar el mapa.

## Controles

| Acción | Teclado y mouse | Control | Celular |
|---|---|---|---|
| Moverse · mirar | WASD · mouse | Stick izq. · stick der. (zona muerta radial, giro que acelera a fondo) | Pulgar izquierdo · arrastrar a la derecha (con aceleración) |
| Correr | Shift | L3 | Correr (un toque alterna; se apaga al quedarte quieto), o empujar el stick al tope hacia adelante |
| Agacharse | C: un toque alterna, mantener es momentáneo | B (igual) | Agachar (igual) |
| Usar · esconderse · examinar | E | A | Usar, o un toque rápido cerca del centro de la pantalla |
| Linterna · ancho del haz | F · rueda o Q | Y · cruceta | Luz · Haz |
| Manivela | Mantener R | Mantener X | Mantener Manivela |
| Apuntar · lanzar botella | Mantener clic der. · clic izq. | Mantener LT · RT | Mantener Lanzar y soltar |
| Aguantar la respiración | Mantener Espacio | Mantener RB | Mantener Aliento |
| Diario · plano · pausa | Tab · M · Esc | View · cruceta → · Start | Íconos arriba a la derecha (el plano, desde el diario) |

El plano de evacuación muestra todo el piso tenue, entinta las salas que ya recorriste con su nombre y sus escondites, marca el objetivo con un círculo y a ti con una flecha. Cada ruido que haces dibuja un anillo alrededor de la mira (más grande cuanto más lejos se oye; rojo si ella estaba lo bastante cerca para oírlo) y un ojo arriba se abre a medida que ella te nota.

Al caminar contra una puerta cerrada, se abre sola, siempre hacia el lado contrario a quien la empuja (de golpe si vas corriendo: hace ruido). El haz de la linterna converge en lo que tienes en la mira y se ajusta a la distancia, para que lo que examinas de cerca no se queme.

En celular los botones son redondos, en arco alrededor del pulgar derecho: el grande es Usar (se ilumina cuando hay algo que usar). El stick tiene zona muerta y llega a la velocidad completa antes del borde; el giro con el dedo da la misma vuelta a cualquier cantidad de cuadros por segundo (un barrido rápido gira más que uno lento) y mientras sostienes Manivela, Lanzar o Aliento puedes deslizar ese mismo pulgar para seguir girando. La pantalla del celular está repartida por zonas para que nada se monte: arriba a la izquierda el objetivo (una versión corta, de dos líneas; el Diario guarda la frase completa), arriba al centro la lección (el nombre del botón y dos líneas como mucho), arriba a la derecha Diario y Pausa con el aviso de punto de control debajo; el centro queda libre para la vista (el ojo de alerta y el nombre del lugar encima de la mira, la acción debajo); los pensamientos y las frases de ella, abajo entre los dos pulgares. Mientras hay un pensamiento en pantalla, el aviso de Usar se aparta (el botón Usar encendido ya lo dice). La energía para correr y el aliento en el casillero se ven como un anillo alrededor de Correr y de Aliento. Los botones cambian según el momento: Aliento solo en el casillero, Lanzar solo con botellas, la Manivela parpadea con la batería baja. Al abrir cualquier pantalla (pausa, nota, diario, plano) el HUD y los botones se apartan; las notas se cierran también tocando fuera del papel, la intro se salta con un toque, y en pantallas bajas los menús se acomodan en dos columnas con el botón de salida siempre a la vista (todo control mide al menos 44 px). El plano se dibuja al tamaño en que se ve y, en un celular, encuadra lo que has recorrido, dónde estás y a dónde vas. En Ajustes → Pantalla táctil se elige el tamaño de los botones y el modo zurdo. Si lo agregas a la pantalla de inicio (Compartir → Agregar a inicio en iPhone, o Instalar en Android) se abre a pantalla completa, en horizontal y sin las barras del navegador.

## Al empezar

Antes de entrar hay una escena corta afuera (`src/intro.ts`), en lugares reales de Pereira como se ven hoy: el **Parque Gaitán** de noche, en el apagón, con el busto de Gaitán en su columna de ladrillo y detrás, al otro lado de la Carrera 4, el **Hospital Universitario San Jorge** (el bloque ocre con la fachada de vidrio, la franja de piedra verde y el letrero redondo; el bloque amarillo; Urgencias con su marquesina y una ambulancia girando rojo). Con el primer relámpago se ve a alguien con una vela en una ventana del tercer piso; con el segundo ya no está. Luego caminas por el parque, pasas junto al busto (otro relámpago le alumbra la cara), cruzas la calle y empujas la puerta de vidrio del vestíbulo, que solo tiene la luz roja de una lámpara de batería. Llueve; se oye la planta eléctrica de Urgencias y perros a lo lejos. Se salta manteniendo Esc, Espacio o Enter.

Las puertas se cierran a tu espalda, el personaje prende la linterna solo y la mirada se va a la luz ámbar que respira sobre la puerta del cuarto eléctrico (desde ahí se oye zumbar el tablero); un letrero en la pared norte apunta hacia allá. Si a los 30 segundos no has llegado, el personaje vuelve a señalar el camino; al minuto, saca el plano. Lo mismo para ir al Pabellón B después del tablero.

## Su ronda (y cómo aprenderla)

La Jefa no deambula: hace una ronda fija, la de la *Hoja de ronda* que está sobre el mostrador de la recepción. Pasillo principal, la Sala Santa Clara cama por cama (mira cada almohada; si estás debajo y respiras o tienes la linterna prendida, se agacha), la estación de enfermería, el pasillo norte, la sala de estar y su televisor, y de vuelta; la ronda siguiente la hace al revés. Cuando te llevas el fusible, la ronda cambia: llega a la lencería y a la recepción, por donde tienes que volver.

La regla que se puede aprender: **mientras tararea, está en la ronda; si se calla, te está buscando**. El personaje lo dice la primera vez que la ve, y en la hoja de ronda alguien lo anotó a lápiz.

Lo que hace que se note lista:
- **Ve como se ve en la oscuridad**: de frente, lejos si estás iluminado; de reojo solo te nota si corres o llevas luz; quieto y agachado a oscuras, casi nada.
- **Nota lo que está fuera de lugar**: la mancha de tu linterna en una pared frente a ella (aunque tú estés detrás de la esquina), una puerta que no está como la dejó, una cortina del pabellón que sigue meciéndose. Las cortinas te tapan, pero se mueven cuando pasas.
- **Cuando te pierde, va a donde ibas**, no a donde estabas: sigue tu rumbo hasta la siguiente pared y, si corres, te sigue por el ruido.
- **Busca con método**: primero el punto donde te perdió, luego los escondites cercanos en orden (los que quedan hacia donde ibas, los que ya usaste y el tipo de escondite que prefieres), con una o dos esquinas para mirar.
- **Aprende tus mañas**: cada vez que te escondes cerca de ella, o que casi te encuentra, ese escondite y ese tipo de escondite pasan al frente de su lista. No lo olvida aunque te atrape y vuelvas al punto de control.
- **A veces finge que se va**: se aleja tarareando como si siguiera la ronda, se para en seco donde no la ves, espera en silencio mirando hacia donde te perdió y vuelve a mirar una vez más. Por eso: si deja de tararear cerca, no salgas.

El Director sigue ahí, pero empuja menos: deja que la ronda sea una ronda al principio (le sugiere tu zona cada minuto o minuto y medio) y aprieta cuando llevas el fusible.

## Un hospital más apretado

Las salas eran cajas grandes y vacías. Ahora el pasillo norte termina en barricadas de evacuación (camas de canto, colchones y sillas, con cinta de NO PASAR) a los dos lados de las puertas que se usan; la recepción, el pabellón y la sala de estar tienen columnas que parten la vista y dan dónde cubrirse; el pabellón tiene su eje (columna, estación de enfermería, columna); la lencería, estanterías en medio que hacen pasillos; la sala de estar, una mesa con un juego de cartas a medias. El vidrio roto quedó en el pasillo norte antes de la sala de estar: el camino corto hasta allá es el ruidoso.

## Lo que se anuncia

Desde el principio, el juego deja ver que hay algo peor que ella detrás de las puertas de Cirugía. El libro de turno de la recepción dice que los camilleros escondieron los fusibles porque sin luz Cirugía no abre («que así es mejor») y que del doctor de turno solo se ve una luz de colores por las ventanitas. Esas dos ventanas redondas brillan de verdad, cambiando de color, detrás de la barricada del pasillo norte: a oscuras parecen dos ojos. La primera vez que llegas a la barricada se oyen ruedas de camilla adentro; al sacar el fusible algo golpea esas puertas desde lejos, y al volver, una vez, unos ojos se asoman a la ventana. Junto a la barricada está el **registro 3** de K.: *No dejen que vuelva la luz… Cuando sale, empuja una camilla tapada… No es una paciente. Es la otra. Trae los colores en una jeringa*. Ella, la que te persigue, era la que los mantenía adentro.

## El final de la primera parte (la escena)

Al instalar el fusible empieza una escena de un minuto, en primera persona y en el motor (`src/finale.ts`), con barras de cine y subtítulos propios; se salta manteniendo Esc, Espacio o Enter (en el celular, manteniendo el botón de arriba a la derecha) y se puede volver a ver desde la pantalla final.

1. **La luz.** Golpe del interruptor general, un parpadeo, el zumbido de 60 Hz subiendo por el piso; el tubo del cuarto eléctrico arranca (tic, tic-tic) y te das vuelta hacia él; prenden los de la recepción. Apagas la linterna: *Luz. Por fin.*
2. **La puerta.** Lejos, al norte, se suelta una cerradura eléctrica y se abren dos puertas: *Cirugía. Se abrió Cirugía.* Ruedas de camilla y pasos de hombre que se acercan; los tubos de la recepción se apagan a medida que pasa debajo.
3. **La visita.** Entra por la puerta del cuarto un médico de dos metros, con gorro y tapabocas de cirugía, delantal de caucho manchado y un espejo frontal que devuelve la luz, empujando una camilla con alguien tapado con una sábana (por debajo se ve un brillo de colores). El tubo parpadea y cada vez que vuelve está más cerca. Estaciona la camilla a tu lado, ladea la cabeza como ella y habla: *Buenas noches. Gracias por la luz. Ahora sí lo podemos atender.*
4. **La otra.** Bajo la sábana algo respira; él la arranca. Es otra enfermera, con la jeringa de colores en las manos sobre el pecho. Gira la cabeza hacia ti, se sienta de golpe, se gira, se baja a un brazo de distancia y te pone la jeringa entre las caras: *Shhh… no duele. Es de colores.* La aguja entra por la izquierda del cuello.
5. **Los colores.** Un viaje entre hongos y LSD hecho en el posproceso: los colores entran desde la aguja como una mancha que fluye, el matiz gira (más donde hay más luz, así los degradados se vuelven bandas), la saturación sube, bordes de neón, paredes que respiran, estelas de cada cosa que se mueve, un velo fractal (el conjunto de Kali) y un caleidoscopio. Se te doblan las rodillas, caes y los dos se inclinan sobre tu cara.
6. **La camilla.** Despiertas acostado en la camilla, bajo la sábana, mirando pasar los tubos del techo con sus estelas; él empuja por detrás, cabeza abajo en tu vista; ella camina al lado con la jeringa en alto y te habla bajito. Al pasar, ella —la Jefa— se queda bajo su luz roja, mirándote ir.
7. **HOMERIS.** El viaje se asienta y estás afuera, de noche, acostado en la camilla bajo un samán: es el **Hospital Mental Universitario de Risaralda**, en la Avenida 30 de Agosto, como se ve hoy (el frente blanco de dos pisos con las franjas turquesa y el letrero grande, la torre de escaleras, el parqueadero, la caseta del vigilante con el televisor prendido). Levantas la cabeza hacia el letrero. Plano general desde el otro lado de la vía: pasa un carro por detrás, el médico empuja la camilla hasta la puerta de vidrio (*Bienvenido a HOMERIS. Aquí la luz no se va nunca.*), voltea a mirar hacia la cámara, entran, las puertas se cierran y adentro todo se vuelve color. Corte a negro: **ETAPA 2 · HOMERIS**. El traslado tiene base real: ese terreno fue el pabellón de tuberculosos del San Jorge y, después del terremoto de 1979, para allá devolvieron a los pacientes de la unidad de salud mental del San Jorge.

Por dentro: el médico y la otra son copias del esqueleto de ella (con sus propios clips y la misma capa de poses), vestidas por código (el médico más alto y ancho de hombros, con delantal, pantalón y espejo; la otra con el uniforme azul pálido y el pelo oscuro). La escena no agrega luces a la escena —eso recompilaría todos los sombreadores a mitad de camino—: toma prestadas las que ya existen (la de emergencia del cuarto, la ámbar de la puerta, dos del pasillo, el rebote de la linterna) y las devuelve al terminar. El viaje es una pasada más del posproceso: el cuadro va a un búfer, las estelas se hacen a media resolución con el cuadro anterior un poco ampliado, girado y con otro matiz, y se mezclan encima; fuera de la escena no cuesta nada. Con «sustos reducidos», no hay parpadeo estroboscópico ni destello en la aguja y todo el viaje va a un tercio. El plan de lo que sigue está en [`docs/etapa-2.md`](docs/etapa-2.md).

Los dos exteriores (`src/exterior.ts`) están hechos por código a partir de fotos de referencia (las del propio hospital, Google Maps y Street View); dentro del juego no va ninguna foto. Cada uno vive lejos del mapa del hospital y, mientras dura su escena, toma prestadas las luces que ya existen (las dos lámparas de mesa, las de emergencia, las de la tormenta, la vela, la linterna como luna o como reflector) y las devuelve al terminar, así que no se recompila nada. La lluvia son trazos alrededor de la cámara que solo se ven donde hay luz.

## Examinar

Al examinar algo, la mirada se queda en eso mientras lees (más tiempo cuanto más larga la frase): la vista se acerca, el campo se estrecha, los bordes se suavizan y el resto del HUD se apaga. Si caminas o miras para otro lado con decisión, la suelta. Lo mismo pasa la primera vez que la ves, y cuando ella habla cerca sin que la veas la cabeza se te va un poco hacia su voz. Casi todo tiene una segunda frase, local y con humor negro (pereirano: el tinto, la hora Gaviria, El Diario del Otún, el jabón Rey, Sábados Felices…), y varias le hablan a quien juega: le dicen la hora real de su ciudad, la fecha de hoy, su nombre (si lo escribió) en el dibujo de Mariana, la batería que le queda al celular (donde el navegador la da), le piden cerrar los ojos tres segundos —y algo susurra detrás—; al pausar, al volver de un agarrón, a altas horas o si deja el juego quieto, el personaje también lo nota. La primera vez que pasan ciertas cosas el personaje lo comenta («¡Corra, mijo, corra!»). Los cuadros cambian a tus espaldas: el fundador pierde el esparadrapo y no tiene ojos, el paisaje cafetero anochece con un recolector sin cara en cada surco, a las frutas del bodegón les salen ojos, la lámina volteada aparece de frente y en la promoción de 1974 aparece una hermana con la cabeza caída sobre el hombro.

Casi todo se puede mirar de cerca con Usar: cuadros, camas, manos y escritos en las paredes, afiches, el reloj, el teléfono, la cajita de música, el radio, el televisor, las ventanas, las puertas del fondo. Cada cosa tiene varias frases (la segunda mirada no dice lo mismo) y algunas cambian cuando no las estás mirando: la foto de la promoción de 1974, el cuadro de la sabana, San Jorge. Otras hacen ruido y la atraen: el timbre de la recepción, la cajita de música, el radio y el teléfono, que suena cuando cruzas la recepción con el fusible. Con *Sustos reducidos* se quitan los sustos visuales (el reflejo en el televisor, las velas que se apagan, los ojos en la ventanilla de cirugía).

## Tormenta y canción

Afuera llueve sobre una ciudad apagada por el racionamiento. Los relámpagos (varias descargas, un rayo dibujado en el cielo de las ventanas) iluminan los cuartos con ventanas y el trueno llega con el retraso que toca; mientras retumba, tus pasos y la manivela se oyen la mitad. En el título ella nunca se mueve mientras la ves: tu linterna está fallando y cada vez que se apaga, al volver la luz la Jefa está más cerca —en la oscuridad solo le brillan los ojos—, hasta quedar a un brazo de distancia; la siguiente vez el pabellón está vacío y el haz la busca, y algún relámpago la muestra donde no debería estar. Si pasas el cursor por «Empezar la noche», ladea la cabeza. El agua escurre por los vidrios (gotas que bajan, se detienen y siguen) y, si están los archivos, la lluvia y los truenos son grabados. La canción del título (`src/sfx/theme.mp3`, compuesta y renderizada por código) es la misma melodía que ella tararea —transcrita de su grabación— en una cajita de música; en la segunda vuelta entra su voz. El primer toque o clic en la pantalla de entrada desbloquea el sonido.

## Contrato del modelo de la Enfermera

La Enfermera es la Jefa: altísima (1,93 m), uniforme almidonado de los 70, cofia con cruz roja, tapabocas de tela y moño. Se armó en Blender con MPFB (cuerpo, ropa y rig GameEngine) más cofia, pelo y tapabocas modelados por código; el proyecto está en `Escritorio\3d\enfermera_ronda\enfermera_v002.blend` (v001 queda como estaba). El juego empaqueta `src/assets/nurse.glb` (en la versión de un solo archivo va dentro del HTML); si no está, busca `assets/nurse.glb` junto a la página y, si tampoco, usa la Enfermera provisional, que cumple el mismo contrato.

- **Formato:** glTF 2.0 binario (`.glb`). Compresión meshopt opcional.
- **Escala y ejes:** metros, Y arriba, origen en los pies, mirando hacia +Z. Si la altura sale fuera de 1,2–2,4 m, el juego la reescala a 1,75 m.
- **Malla:** un personaje humanoide con piel (skinned), idealmente menos de 60 000 triángulos.
- **Texturas:** PBR, máximo 2048 px (el juego baja a 1024 en celular). En MPFB2, usar el material **Game Engine**.
- **Pelo:** tarjetas con *Alpha Clip* (glTF `MASK`), nunca transparencia mezclada.
- **Rig:** en MPFB2, el rig **GameEngine**.
- **Animaciones** (nombres exactos, en minúscula): `idle`, `walk`, `walk_search`, `run`, `listen`, `turn_head`, `peek_locker`, `open_locker`, `grab`, `twitch`, y opcional `scratch`. Si falta alguna, el juego usa una cercana (por ejemplo `walk` para `walk_search`). `idle` (Breathing Idle), `walk`/`walk_search` (Iv Pole Walking: empuja el portasueros con la mano derecha), `run` (Running), `turn_head` (Look Around), `grab` (Zombie Attack) y `scratch` (Zombie Scratch Idle) son capturas de movimiento de Mixamo, bajadas sobre el muñeco de Mixamo y pasadas al rig GameEngine en Blender (rotaciones en espacio de mundo, alineando la pose de reposo A con la T de Mixamo). Las demás son procedurales.
- **Capa procedural** (`POSES` en `src/nurse.ts`): sobre cualquier clip, poses en el espacio de ella: rascarse el cuello, ladear la cabeza, arrodillarse a mirar bajo una cama, y la cabeza que te sigue cuando te ve. Funciona con el rig GameEngine y con uno de Mixamo (`mixamorig:*`).
- **Shape keys → morph targets** (opcionales): `blink`, `eyes_wide`, `mouth_open`, `scream`.
- **Brillo de los ojos:** dos empties llamados `glint_L` y `glint_R` en las pupilas. Si no están, el juego los calcula desde el hueso de la cabeza.

## Sonidos grabados (opcionales)

Todo el audio se sintetiza, pero cualquier archivo `src/sfx/<nombre>.mp3` se empaqueta (dentro del HTML en la versión de un solo archivo) y reemplaza o refuerza su versión sintética. Si falta, suena el sintetizador.

| Nombre | Dónde suena |
|---|---|
| `heartbeat` | Latido (velocidad según el miedo) |
| `impact` | Golpe grave de los sustos grandes |
| `hum` | Tarareo de ella, en bucle mientras tararea |
| `whisper` | Alguien te sopla en la nuca |
| `wh_0` … `wh_8` | Susurros que nunca se entienden (la mitad, al revés): aparecen alrededor de ti cada tanto, más seguido con miedo |
| `wh_crowd` | Las camas del Pabellón B murmurando entre ellas (bucle hecho con doce susurros superpuestos y apagados; se calla cuando ella está cerca) |
| `thunder_near`, `thunder_far`, `thunder_far2` | Truenos grabados, más oscuros cuanto más lejos cae el rayo |
| `rain_in` | Lluvia contra el vidrio, oída desde adentro (bucle estéreo; sube junto a las ventanas) |
| `door_creak` | Puertas que se abren |
| `locker` | Casilleros |
| `squeak` | Rueda del portasueros |
| `nurse_step` | Pasos de ella |
| `scream` | Su grito cuando te atrapa (no suena con sustos reducidos) |
| `screech` | La puerta del gabinete del fusible al arrancarla |
| `breath` | Jadeo al soltar el aliento |
| `sheet` | La sábana al atraparte |
| `ambience` | Fondo del hospital, en bucle |
| `ui_select`, `ui_write`, `paper_open`, `paper_close`, `map_open`, `map_close` | Interfaz: elegir en un menú, el lápiz al cambiar el objetivo, abrir y dejar notas y el diario, desdoblar y doblar el plano (el tic al pasar por los menús y el sello del punto de control son sintéticos) |
| `bottle_pick`, `torch_die`, `bed_in`, `bed_out`, `keys` | Recoger una botella, la linterna que se apaga o avisa con poca carga, meterse y salir de debajo de la cama, el llavero de ella cuando se asoma a un casillero |
| `theme` | Canción del título (bucle de 55,94 s con la cola superpuesta) |
| `vx_cama` … `vx_aquiesta` | La capa espectral de cada línea de ella, horneada aparte (susurros dobles con la fase revuelta, una octava abajo, un brillo inarmónico arriba, copias con desplazamiento de frecuencia que baten contra la voz, la última sílaba repitiéndose más grave y una cola oscura): suena dentro de tu cabeza mientras la voz seca viene de donde está ella |
| `v_cama`, `v_visitas`, `v_dormir`, `v_ahi`, `v_quieto`, `v_aquiesta` | Su voz: «Shhh… ¿Qué haces fuera de la cama?», «Las visitas eran hasta las ocho», «Ya es hora de dormir», «Yo sé que estás ahí», «No te muevas…», «Ahí estás». Suenan desde donde está ella (con cadena espectral: doble fantasma, respiración en reversa y eco en tu cabeza), con subtítulo |
| `v_doctor`, `v_doctor2`, `v_iris`, `v_iris2` | La escena final: el médico («Buenas noches. Gracias por la luz. Ahora sí lo podemos atender», desde donde está, un poco más grave; y en la puerta de HOMERIS, «Bienvenido a HOMERIS. Aquí la luz no se va nunca») y la otra en susurro, al oído («Shhh… no duele. Es de colores», «Respire hondo, mijo… y mire los colores») |
| `v_mijito`, `v_teoi`, `v_cuento`, `v_rezo`, `v_frio`, `v_ojitos` | Más de ella, clonada de las anteriores: «¿Mijito? ¿Dónde te metiste?» y «Vuelve a la cama, que te vas a resfriar» cuando te busca, «Te oí. No te hagas el dormido» cuando oye un ruido tuyo, «Cama uno, dormido…» y el avemaría mientras hace la ronda, «Cierra los ojitos. No duele» en la rejilla. Lo que suena dentro de tu cabeza crece cuanto más cerca está; de lejos, la sala la envuelve en eco. Sus pasos llevan el taconeo de un zapato de enfermera y, a pocos pasos y callada, se le oye respirar detrás del tapabocas |

Mono, 44,1 kHz, MP3 a 96 kbps es suficiente. Los efectos vienen de la librería de Splice de Carlos; la voz es ElevenLabs (voz «Isabella») generada en Higgsfield, y las seis líneas nuevas, Seed Audio clonando esa misma voz; los de interfaz son Mirelo (Higgsfield), recortados y limpiados. El médico es Seed Audio (voz «Juan»), con las pausas acortadas; la otra, Seed Audio (voz «Marisol») vuelta susurro: un vocoder de ruido sobre la envolvente de su propia voz, mezclado debajo de la voz para que se entienda.

## Demo en Vercel y registro de partidas

`npm run build` deja en `dist/` el juego (`index.html`) y el registro (`registro.html`); `api/` son las funciones de Vercel. Para publicarlo:

1. Importa el repositorio en Vercel (**Add New → Project**). Detecta Vite; `vercel.json` fija el build y las URLs limpias.
2. En el proyecto: **Storage → Create Database → Neon** (plan gratis) → **Connect**. Eso pone `DATABASE_URL`; las tablas se crean solas en la primera partida.
3. En **Settings → Environment Variables** crea `REPORT_KEY` con una clave tuya (el repositorio es público: la clave no está en el código). Después, **Redeploy**.

**Qué se guarda** (solo en la versión publicada en un dominio propio; en claude.ai no se pide nombre ni se manda nada): el nombre o apodo que el jugador escribe en la portada (opcional: sin nombre queda como «Anónimo»); cada acción con su segundo (entra, objetivos, notas, fusible, se esconde y en qué, ella revisa el escondite, lo persigue, lo pierde, lo atrapa, reintenta, botellas, aliento, pausa, sale de la página); el recorrido —él y ella, dos veces por segundo, y si estaba escondido—; y el progreso (hasta dónde llegó, tiempo, veces atrapado, escondites, notas, si terminó). Se manda en lotes cada 8 s y al cerrar la pestaña (`sendBeacon`). La portada avisa que se guarda.

**Ver el registro:** `https://TU-PROYECTO.vercel.app/registro?k=TU_REPORT_KEY` — totales, la tabla de partidas y, al tocar una, su recorrido sobre el plano del hospital (repetible a 4×) y la lista de lo que hizo.

| Archivo | Qué hace |
|---|---|
| `src/telemetry.ts` | Sesión, eventos, recorrido y progreso; lotes a `/api/track` |
| `api/track.ts` | Guarda un lote (Postgres: `rn_sessions`, `rn_events`, `rn_track`) |
| `api/report.ts` | Lee el registro con la clave |
| `registro.html`, `src/registro.ts` | El tablero del registro |

## Estructura

| Archivo | Qué hace |
|---|---|
| `src/content.ts` | Mapa del hospital (ASCII, con columnas `I`, mesas `m` y barricadas `x`), notas (la hoja de ronda), letreros, áreas |
| `src/level.ts` | Geometría, colisiones, línea de visión, oclusión del sonido, A*. Cada parte del edificio tiene su acabado, y el desgaste va en espacio de mundo (shader): manchas que nunca se repiten, mugre en zócalos y esquinas, chorreones, y las goteras (`LEAKS` en `content.ts`) que manchan techo, pared y piso en el mismo sitio |
| `src/sigil.ts` | El sigilo bordado en la cofia (donde iba la cruz) y en el pecho: calcomanías recortadas de la propia malla de la ropa, con sus pesos de piel |
| `src/props.ts` | Muebles, escondites (casilleros con rejillas reales y el hueco bajo las camas), lámparas, luces de emergencia, tablero, fusible, ambientación (ventanas, cortinas con física de resortes, charcos, goteras, escombros) |
| `src/decor.ts` | Arte dibujado por código: manos, rasguños, escritos, manchas, afiches, hojas de puerta, cuadros y sus versiones cambiadas |
| `src/dressing.ts` | Dónde va cada marca y cada objeto, y lo que pasa al examinarlos |
| `src/examine.ts` | Sistema de examinar: frases por etapas, cosas que cambian cuando no las miras |
| `src/storm.ts` | Relámpagos, trueno, lluvia |
| `src/merge.ts` | Une la utilería estática en pocas mallas (menos llamadas de dibujo) |
| `src/nurse.ts` | Enfermera (GLB o provisional), su ronda, su memoria (puertas, escondites, tus mañas), la búsqueda con plan, la falsa salida y el Director. El GLB incrustado se decodifica a mano y sus texturas desde sus bytes: la página publicada no deja usar `fetch` con URLs `data:`/`blob:` |
| `src/player.ts` | Movimiento, linterna con manivela, botellas, escondites (casillero y bajo la cama), respiración |
| `src/audio.ts` | Sonido sintetizado más capa grabada: tarareo, portasueros, música adaptativa, su voz espectral, susurros, tormenta |
| `src/post.ts` | Render a baja resolución, bloom, haz de la linterna en el aire (volumétrico), tramado, grano (medido: ~2/255 en medios tonos, <1 en negros; un píxel, 24 fps, después del tramado), viñeta, rejilla, sábana, polvo en el haz, y el viaje de la escena final (caleidoscopio, matiz, neón, fractal, estelas) |
| `src/story.ts` | Objetivos, tutorial, eventos, puntos de control, alucinaciones, lo que anuncia Cirugía |
| `src/finale.ts` | La escena del final de la primera parte: actores copiados del esqueleto de ella, camilla, sábana, jeringa, tubos, la puesta en escena por tiempos, la cámara de mano y el viaje |
| `src/exterior.ts` | Los dos lugares de afuera, como se ven hoy: Carrera 4, San Jorge y Parque Gaitán; HOMERIS y la Avenida 30 de Agosto. Fachadas pintadas por código, árboles, carros, cielo, cerros y lluvia; el préstamo de luces |
| `src/intro.ts` | La escena de entrada: el parque, el busto, la calle, la puerta |
| `docs/etapa-2.md` | El plan de la etapa 2 (HOMERIS) |
| `src/ui.ts`, `index.html`, `src/style.css` | Menús, HUD (anillo de ruido, ojo de alerta), notas, diario, plano de evacuación, ajustes |
