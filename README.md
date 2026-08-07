# lutbox

[![CI](https://github.com/keivanmalhani/lutbox/actions/workflows/ci.yml/badge.svg)](https://github.com/keivanmalhani/lutbox/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Live at <https://keivanmalhani.github.io/lutbox/>

Drop a photo and a `.cube` LUT onto the page. The grade is applied at full
resolution, straight away, and the page also shows you what the LUT is doing to
the image rather than leaving you to guess.

## What it does

- Parses 1D and 3D `.cube` files: `LUT_1D_SIZE`, `LUT_3D_SIZE`, `DOMAIN_MIN`,
  `DOMAIN_MAX`, `TITLE`, comments, and triples separated by spaces or tabs. A
  file it cannot read is rejected with the line number that is wrong.
- Applies the LUT in a WebGL2 fragment shader using a real 3D texture with
  trilinear interpolation.
- Split view with a draggable handle, a side by side view, and an A/B flip on a
  held key.
- Stacks up to four LUTs, reorderable, each with a strength from 0 to 100
  percent, so you can look at half a grade.
- Shows the neutral axis response, before and after histograms, an isometric
  plot of how far each corner of colour space moves, and one sentence in plain
  English saying what the grade does.
- Exports the graded image as PNG or JPEG at full resolution, and the analysis
  panel as a PNG card.
- Generates a `.cube` from lift, gamma, gain, temperature, tint, saturation and
  contrast, so the page is useful with no LUT to hand.

## The privacy point, stated plainly

Your image never leaves the tab. There is no upload, because there is no
server. The site is a folder of static files on GitHub Pages: an HTML file, a
stylesheet and one JavaScript bundle. Once those have loaded, the page makes no
network requests at all. It reads your files with the browser's File API,
decodes them in the tab, and hands the pixels to your GPU.

This matters because the alternative is uploading a client's unreleased work to
somebody else's machine to find out whether a LUT suits it.

There are no runtime dependencies, no CDN, no analytics, no fonts fetched from
anywhere, and no cookies or local storage. You can check by opening the network
panel, or by reading `dist/` after a build. Everything the page needs, including
the three example LUTs and the sample image, is generated in code at load time.

## How the interpolation works, and why the naive approach is wrong

A 3D LUT is a lattice. A 33-point table holds 33 x 33 x 33 output colours, one
for each combination of input red, green and blue on a grid. That is 35,937
entries standing in for the 16.7 million colours an 8-bit image can contain, so
almost every pixel in your photograph falls *between* lattice points and the
answer has to be interpolated.

Trilinear interpolation finds the cell of eight lattice points surrounding the
input colour and blends them by how close the input is to each corner. If the
input sits at fraction `tr`, `tg`, `tb` along the three axes of its cell, the
corner at `(0,0,0)` of that cell is weighted `(1-tr)(1-tg)(1-tb)`, the corner at
`(1,1,1)` is weighted `tr*tg*tb`, and so on for the other six. The weights sum
to one.

The naive implementation rounds instead. It takes the input colour, finds the
nearest lattice point, and returns that entry. It is easy to write, it is what
you get if you index into the table with rounded coordinates in a 2D canvas
loop, and it is wrong in a way that is obvious the moment you look at a
gradient: a 33-point table only has 33 distinct values per axis, so a smooth sky
becomes 33 flat bands with hard steps between them. The error can be large. Take
a 2-point table that is an identity everywhere except the white corner, which it
pulls to black. At mid grey the correct answer is 0.375 on each channel, the
average of the eight corners. Nearest neighbour rounds mid grey up to the white
corner and returns 0. That is a difference of 96 levels out of 255 on a single
pixel.

There is a second thing naive implementations get wrong even when they do
interpolate: the texture coordinates. A LUT of size `n` uploaded as an `n`-wide
texture has its first entry at texel centre `0.5/n`, not at `0`. Sampling with
the raw normalised colour shifts the whole table by half a texel and quietly
skews every value. lutbox maps the colour to `(c * (n - 1) + 0.5) / n` so the
first and last lattice entries land exactly on the ends of the range.

The reason to do all this on the GPU is that `GL_TEXTURE_3D` with
`GL_LINEAR` filtering *is* trilinear interpolation, implemented in the texture
unit. The shader does one lookup per LUT per pixel and the hardware does the
eight-corner blend for free, which is why a 40 megapixel frame regrades
instantly while you drag a strength slider. The table is uploaded as 32-bit
float where the driver will filter it, and 16-bit float otherwise. Both keep
far more precision than the 8-bit textures a simpler implementation would reach
for.

The same maths is written a second time in plain TypeScript in `src/analyze.ts`,
because the curve plots and the histograms need it on the CPU, and because it
can then be tested against hand-computed values without a GPU.

## What it will not do

- It is not a grading application. There are no wheels, no curves you can drag,
  no keyframes, no nodes. It applies LUTs and tells you about them.
- It does not do colour management. It treats your image as display-referred
  data in whatever space the browser hands over, and ignores embedded ICC
  profiles. If you feed it a log clip it will show you the log clip, correctly,
  looking flat.
- It does not read `.3dl`, `.look`, `.icc`, `.vlt`, `.dat` or any other LUT
  format. Only `.cube`.
- It does not open camera raw files. The browser has to be able to decode the
  image, so PNG, JPEG, WebP and friends.
- It does not do video. One still frame at a time.
- It does not save your session. Reload and the stack is empty, because nothing
  is stored anywhere.
- It does not convert between LUT formats or resize a LUT's lattice.
- The generator is deliberately small: lift, gamma, gain, temperature, tint,
  saturation and contrast in a fixed order. It is there so the page does
  something without a LUT file, not to replace a grading suite.

## Running it

```
npm ci
npm run dev      # local server
npm test         # 213 tests
npm run build    # static files into dist/
```

There are no runtime dependencies. The three development dependencies are
TypeScript, Vite and Vitest.

## Layout

```
src/cube.ts       .cube parser and writer
src/gl.ts         WebGL2 renderer, 3D texture upload, split and A/B modes
src/analyze.ts    CPU reference lookup, curves, histogram, measurements, summary
src/generate.ts   LUT builder and the three bundled presets
src/sample.ts     the sample frame, drawn in code
src/ui/           DOM, charts as inline SVG, stage, panel, files, toasts
tests/            parser, interpolation, analysis, blending, round trips
```

## Licence

MIT. See [LICENSE](LICENSE).
