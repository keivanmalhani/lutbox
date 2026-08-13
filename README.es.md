# lutbox

[![CI](https://github.com/keivanmalhani/lutbox/actions/workflows/ci.yml/badge.svg)](https://github.com/keivanmalhani/lutbox/actions/workflows/ci.yml)
[![Licencia: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) | Espanol

En vivo en <https://keivanmalhani.github.io/lutbox/>

Suelta una foto y un LUT `.cube` sobre la pagina. El grade se aplica a
resolucion completa, al instante, y la pagina tambien te muestra que le esta
haciendo el LUT a la imagen en vez de dejarte adivinar.

## Que hace

- Analiza archivos `.cube` de 1D y 3D: `LUT_1D_SIZE`, `LUT_3D_SIZE`,
  `DOMAIN_MIN`, `DOMAIN_MAX`, `TITLE`, comentarios, y triples separados por
  espacios o tabulaciones. Un archivo que no puede leer se rechaza con el
  numero de linea que esta mal.
- Aplica el LUT en un fragment shader de WebGL2 usando una textura 3D real con
  interpolacion trilineal.
- Recae en gradear en la CPU donde falta WebGL2, a un tamano de vista previa
  reducido y con la pagina diciendolo. Misma busqueda, misma respuesta, mas
  lento.
- Vista dividida con un tirador arrastrable, una vista lado a lado, y un
  cambio A/B con una tecla mantenida.
- Apila hasta cuatro LUTs, reordenables, cada uno con una intensidad de 0 a
  100 por ciento, para que puedas mirar la mitad de un grade.
- Muestra la respuesta del eje neutro, histogramas antes y despues, un
  grafico isometrico de cuanto se mueve cada esquina del espacio de color, y
  una frase en lenguaje llano que dice que hace el grade.
- Exporta la imagen gradeada como PNG o JPEG a resolucion completa, y el panel
  de analisis como una tarjeta PNG.
- Genera un `.cube` a partir de lift, gamma, gain, temperatura, tinte,
  saturacion y contraste, para que la pagina sea util sin tener un LUT a mano.

## El punto de privacidad, dicho claramente

Tu imagen nunca sale de la pestana. No hay subida, porque no hay servidor. El
sitio es una carpeta de archivos estaticos en GitHub Pages: un archivo HTML,
una hoja de estilos, un unico bundle de JavaScript, y `og.png`, que es la
imagen que muestra una app de chat cuando alguien pega el enlace y que la
pagina misma nunca solicita. Una vez cargados los tres primeros, la pagina no
hace ninguna peticion de red mas. Lee tus archivos con la File API del
navegador, los decodifica en la pestana, y entrega los pixeles a tu GPU.

Esto importa porque la alternativa es subir el trabajo aun no publicado de un
cliente a la maquina de otra persona para averiguar si un LUT le sienta bien.

No hay dependencias en tiempo de ejecucion, ni CDN, ni analiticas, ni fuentes
tipograficas cargadas desde ningun sitio, ni cookies ni almacenamiento local.
Puedes comprobarlo abriendo el panel de red, o leyendo `dist/` despues de una
build. Todo lo que la pagina necesita, incluyendo los tres LUTs de ejemplo y la
imagen de muestra, se genera en codigo al momento de cargar.

## Como funciona la interpolacion, y por que el enfoque ingenuo esta mal

Un LUT 3D es una red. Una tabla de 33 puntos contiene 33 x 33 x 33 colores de
salida, uno por cada combinacion de rojo, verde y azul de entrada en una
cuadricula. Eso son 35,937 entradas representando los 16.7 millones de colores
que puede contener una imagen de 8 bits, asi que casi cada pixel de tu
fotografia cae *entre* puntos de la red y la respuesta tiene que
interpolarse.

La interpolacion trilineal encuentra la celda de ocho puntos de red que rodean
al color de entrada y los mezcla segun cuan cerca este la entrada de cada
esquina. Si la entrada esta en la fraccion `tr`, `tg`, `tb` a lo largo de los
tres ejes de su celda, la esquina en `(0,0,0)` de esa celda se pondera
`(1-tr)(1-tg)(1-tb)`, la esquina en `(1,1,1)` se pondera `tr*tg*tb`, y asi para
las otras seis. Los pesos suman uno.

La implementacion ingenua redondea en su lugar. Toma el color de entrada,
encuentra el punto de red mas cercano, y devuelve esa entrada. Es facil de
escribir, es lo que obtienes si indexas la tabla con coordenadas redondeadas en
un bucle de canvas 2D, y esta mal de una forma que es obvia en el momento en
que miras un degradado: una tabla de 33 puntos solo tiene 33 valores distintos
por eje, asi que un cielo suave se convierte en 33 bandas planas con escalones
duros entre ellas. El error puede ser grande. Toma una tabla de 2 puntos que es
una identidad en todas partes excepto en la esquina blanca, a la que lleva a
negro. En gris medio la respuesta correcta es 0.375 en cada canal, el promedio
de las ocho esquinas. El vecino mas cercano redondea el gris medio hacia arriba
a la esquina blanca y devuelve 0. Esa es una diferencia de 96 niveles de 255 en
un unico pixel.

Hay una segunda cosa que las implementaciones ingenuas hacen mal incluso cuando
si interpolan: las coordenadas de textura. Un LUT de tamano `n` cargado como
una textura de `n` de ancho tiene su primera entrada en el centro de texel
`0.5/n`, no en `0`. Muestrear con el color normalizado sin ajustar desplaza
toda la tabla medio texel y sesga silenciosamente cada valor. lutbox mapea el
color a `(c * (n - 1) + 0.5) / n` para que la primera y ultima entradas de la
red caigan exactamente en los extremos del rango.

La razon para hacer todo esto en la GPU es que `GL_TEXTURE_3D` con filtrado
`GL_LINEAR` *es* interpolacion trilineal, implementada en la unidad de
textura. El shader hace una busqueda por LUT por pixel y el hardware hace la
mezcla de ocho esquinas gratis, que es por que un frame de 40 megapixeles se
regradea al instante mientras arrastras un control de intensidad. La tabla se
carga como float de 32 bits donde el driver la filtrara, y float de 16 bits en
caso contrario. Ambos conservan mucha mas precision que las texturas de 8 bits
a las que recurriria una implementacion mas simple.

La misma matematica esta escrita una segunda vez en TypeScript plano en
`src/analyze.ts`, porque las graficas de curvas y los histogramas la necesitan
en la CPU, y porque asi se puede probar contra valores calculados a mano sin
una GPU. Tambien es lo que corre en la vista previa donde no hay WebGL2, y lo
que dibuja la tarjeta de vista previa del enlace. `tests/cpu.test.ts` escribe
explicitamente el mapeo de centro de texel del shader y la regla de filtrado
de la unidad de textura y comprueba que ambos coinciden en cada punto de red
de una tabla y en un conjunto de puntos entre ellos, que es la unica forma de
mantener las dos implementaciones alineadas sin una GPU en el ejecutor de
pruebas.

## Que no va a hacer

- No es una aplicacion de grading. No hay ruedas, ni curvas que arrastrar, ni
  keyframes, ni nodos. Aplica LUTs y te informa sobre ellos.
- No hace gestion de color. Trata tu imagen como datos referidos a pantalla en
  cualquier espacio que entregue el navegador, e ignora los perfiles ICC
  incrustados. Si le das un clip en log te mostrara el clip en log,
  correctamente, luciendo plano.
- No lee `.3dl`, `.look`, `.icc`, `.vlt`, `.dat` ni ningun otro formato de LUT.
  Solo `.cube`.
- No abre archivos raw de camara. El navegador tiene que poder decodificar la
  imagen, asi que PNG, JPEG, WebP y similares.
- No hace video. Un fotograma fijo a la vez.
- No guarda tu sesion. Recarga y la pila queda vacia, porque nada se almacena
  en ningun sitio.
- No convierte entre formatos de LUT ni redimensiona la red de un LUT.
- El generador es deliberadamente pequeno: lift, gamma, gain, temperatura,
  tinte, saturacion y contraste en un orden fijo. Esta ahi para que la pagina
  haga algo sin un archivo LUT, no para reemplazar una suite de grading.

## Ejecutarlo

```
npm ci
npm run dev      # local server
npm test         # 253 tests
npm run build    # static files into dist/
```

No hay dependencias en tiempo de ejecucion. Las tres dependencias de
desarrollo son TypeScript, Vite y Vitest.

La imagen de vista previa del enlace no se construye con el sitio, porque
renderizarla necesita un canvas nativo y eso es un binario que cada clon
tendria que descargar de otro modo para producir un archivo que cambia mas o
menos una vez al ano:

```
npm install --no-save @napi-rs/canvas
node scripts/render-og.mjs      # writes public/og.png at 1200x630
```

Dibuja el frame de muestra dos veces, sin gradear y con uno de los presets
incluidos aplicado, a traves de la misma busqueda que usa la pagina.

## Disposicion

```
src/cube.ts       .cube parser and writer
src/gl.ts         WebGL2 renderer, 3D texture upload, split and A/B modes
src/cpu.ts        the canvas2d fallback for browsers with no WebGL2
src/analyze.ts    CPU reference lookup, curves, histogram, measurements, summary
src/generate.ts   LUT builder and the three bundled presets
src/sample.ts     the sample frame, drawn in code
src/ui/           DOM, charts as inline SVG, stage, panel, files, toasts
scripts/          the link preview card, rendered offline
tests/            parser, interpolation, analysis, blending, round trips
```

## Licencia

MIT. Ver [LICENSE](LICENSE).
