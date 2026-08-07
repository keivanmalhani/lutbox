/**
 * WebGL2 renderer.
 *
 * The whole point of this file is the 3D texture. A .cube 3D LUT is a lattice
 * of output colours; applying it means finding where the input colour lands
 * inside that lattice and blending the eight surrounding entries. Uploading
 * the table as a GL_TEXTURE_3D with LINEAR filtering makes the hardware do
 * exactly that trilinear blend in one instruction, at full resolution, for
 * free. See the README for what goes wrong without it.
 */

import type { CubeLut } from './cube';

export const MAX_SLOTS = 4;

export type RenderMode = 'graded' | 'original' | 'split' | 'sidebyside';

const MODE_CODE: Record<RenderMode, number> = {
  graded: 0,
  original: 1,
  split: 2,
  sidebyside: 3,
};

export interface GpuSlot {
  lut: CubeLut;
  strength: number;
  enabled: boolean;
}

export class GlError extends Error {}

export const VERTEX_SOURCE = `#version 300 es
out vec2 vUv;
void main() {
  // One oversized triangle covering the viewport. No vertex buffer needed.
  vec2 p = vec2(
    gl_VertexID == 1 ? 3.0 : -1.0,
    gl_VertexID == 2 ? 3.0 : -1.0
  );
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

export function fragmentSource(slots: number): string {
  const head = `#version 300 es
precision highp float;
precision highp sampler2D;
precision highp sampler3D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;
uniform int uMode;
uniform float uSplit;
`;

  let uniforms = '';
  for (let i = 0; i < slots; i++) {
    uniforms += `
uniform int uType${i};
uniform float uStrength${i};
uniform float uSize${i};
uniform vec3 uDomainMin${i};
uniform vec3 uDomainMax${i};
uniform sampler3D uLut3d${i};
uniform sampler2D uLut1d${i};
`;
  }

  const helpers = `
// Map a normalised colour onto texel centres. Without the half texel offset
// and the (size - 1) scale the first and last lattice entries sit half a texel
// outside the texture and the whole table is shifted.
vec3 lookup3d(sampler3D tex, vec3 c, float size) {
  vec3 coord = (c * (size - 1.0) + 0.5) / size;
  return texture(tex, coord).rgb;
}

// A 1D table holds three independent curves, so each channel is looked up on
// its own axis.
vec3 lookup1d(sampler2D tex, vec3 c, float size) {
  float s = size;
  vec3 o;
  o.r = texture(tex, vec2((c.r * (s - 1.0) + 0.5) / s, 0.5)).r;
  o.g = texture(tex, vec2((c.g * (s - 1.0) + 0.5) / s, 0.5)).g;
  o.b = texture(tex, vec2((c.b * (s - 1.0) + 0.5) / s, 0.5)).b;
  return o;
}

vec3 toDomain(vec3 c, vec3 lo, vec3 hi) {
  return clamp((c - lo) / max(hi - lo, vec3(1e-6)), 0.0, 1.0);
}
`;

  let apply = `
vec3 applyStack(vec3 color) {
`;
  for (let i = 0; i < slots; i++) {
    apply += `
  if (uType${i} == 1) {
    vec3 d${i} = toDomain(color, uDomainMin${i}, uDomainMax${i});
    color = mix(color, lookup3d(uLut3d${i}, d${i}, uSize${i}), uStrength${i});
  } else if (uType${i} == 2) {
    vec3 d${i} = toDomain(color, uDomainMin${i}, uDomainMax${i});
    color = mix(color, lookup1d(uLut1d${i}, d${i}, uSize${i}), uStrength${i});
  }
`;
  }
  apply += `  return color;
}
`;

  const main = `
void main() {
  vec2 uv = vUv;
  bool graded = true;

  if (uMode == 1) {
    graded = false;
  } else if (uMode == 2) {
    graded = uv.x >= uSplit;
  } else if (uMode == 3) {
    // Two full copies of the frame across a canvas of double width.
    graded = uv.x >= 0.5;
    uv.x = graded ? (uv.x - 0.5) * 2.0 : uv.x * 2.0;
  }

  vec3 color = texture(uImage, uv).rgb;
  if (graded) color = applyStack(color);
  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

  return head + uniforms + helpers + apply + main;
}

// ---------------------------------------------------------------------------
// Half float packing, used when the driver will not filter 32 bit textures.
// ---------------------------------------------------------------------------

const HALF_F32 = new Float32Array(1);
const HALF_I32 = new Int32Array(HALF_F32.buffer);

function toHalf(value: number): number {
  HALF_F32[0] = value;
  const x = HALF_I32[0];
  const sign = (x >> 16) & 0x8000;
  let mantissa = x & 0x007fffff;
  const exponent = (x >> 23) & 0xff;

  if (exponent === 0xff) {
    // Infinity or not a number.
    return sign | 0x7c00 | (mantissa ? 0x0200 : 0);
  }
  const unbiased = exponent - 127 + 15;
  if (unbiased >= 0x1f) return sign | 0x7c00;
  if (unbiased <= 0) {
    if (unbiased < -10) return sign;
    mantissa |= 0x00800000;
    const shift = 14 - unbiased;
    return sign | (mantissa >> shift);
  }
  return sign | (unbiased << 10) | (mantissa >> 13);
}

interface SlotUniforms {
  type: WebGLUniformLocation | null;
  strength: WebGLUniformLocation | null;
  size: WebGLUniformLocation | null;
  domainMin: WebGLUniformLocation | null;
  domainMax: WebGLUniformLocation | null;
  lut3d: WebGLUniformLocation | null;
  lut1d: WebGLUniformLocation | null;
}

interface SlotTextures {
  texture3d: WebGLTexture | null;
  texture2d: WebGLTexture | null;
  type: number;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  strength: number;
}

export interface RendererInfo {
  /** Whether the driver can filter 32 bit float textures directly. */
  floatLinear: boolean;
  maxTextureSize: number;
  max3dTextureSize: number;
  renderer: string;
}

export class Renderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private uImage: WebGLUniformLocation | null;
  private uMode: WebGLUniformLocation | null;
  private uSplit: WebGLUniformLocation | null;
  private slotUniforms: SlotUniforms[] = [];
  private slots: SlotTextures[] = [];
  private imageTexture: WebGLTexture | null = null;
  private dummy3d: WebGLTexture;
  private dummy2d: WebGLTexture;
  private vao: WebGLVertexArrayObject | null;
  readonly info: RendererInfo;

  imageWidth = 0;
  imageHeight = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      throw new GlError(
        'This browser did not give us a WebGL2 context. lutbox needs WebGL2 for ' +
          'the 3D lookup texture that makes the grade correct.',
      );
    }
    this.gl = gl;

    const floatLinear = gl.getExtension('OES_texture_float_linear') !== null;
    let rendererName = 'unknown';
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      rendererName = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
    }
    this.info = {
      floatLinear,
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      max3dTextureSize: gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) as number,
      renderer: rendererName,
    };

    this.program = this.buildProgram();
    gl.useProgram(this.program);

    this.uImage = gl.getUniformLocation(this.program, 'uImage');
    this.uMode = gl.getUniformLocation(this.program, 'uMode');
    this.uSplit = gl.getUniformLocation(this.program, 'uSplit');
    gl.uniform1i(this.uImage, 0);

    for (let i = 0; i < MAX_SLOTS; i++) {
      this.slotUniforms.push({
        type: gl.getUniformLocation(this.program, 'uType' + i),
        strength: gl.getUniformLocation(this.program, 'uStrength' + i),
        size: gl.getUniformLocation(this.program, 'uSize' + i),
        domainMin: gl.getUniformLocation(this.program, 'uDomainMin' + i),
        domainMax: gl.getUniformLocation(this.program, 'uDomainMax' + i),
        lut3d: gl.getUniformLocation(this.program, 'uLut3d' + i),
        lut1d: gl.getUniformLocation(this.program, 'uLut1d' + i),
      });
      // Every sampler needs its own texture unit even when the slot is unused,
      // because a 2D and a 3D sampler may not share one.
      gl.uniform1i(this.slotUniforms[i].lut3d, 1 + i * 2);
      gl.uniform1i(this.slotUniforms[i].lut1d, 2 + i * 2);
      this.slots.push({
        texture3d: null,
        texture2d: null,
        type: 0,
        size: 2,
        domainMin: [0, 0, 0],
        domainMax: [1, 1, 1],
        strength: 1,
      });
    }

    this.dummy3d = this.makeDummy3d();
    this.dummy2d = this.makeDummy2d();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
  }

  private buildProgram(): WebGLProgram {
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, VERTEX_SOURCE);
    const fs = this.compile(gl.FRAGMENT_SHADER, fragmentSource(MAX_SLOTS));
    const program = gl.createProgram();
    if (!program) throw new GlError('Could not create a GL program.');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? 'no log';
      throw new GlError('Shader link failed: ' + log);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return program;
  }

  private compile(kind: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(kind);
    if (!shader) throw new GlError('Could not create a shader.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'no log';
      gl.deleteShader(shader);
      throw new GlError('Shader compile failed: ' + log);
    }
    return shader;
  }

  private makeDummy3d(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGBA8,
      1,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return tex;
  }

  private makeDummy2d(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return tex;
  }

  /** Upload the source frame. Returns the size actually used. */
  setImage(source: TexImageSource, width: number, height: number): { width: number; height: number } {
    const gl = this.gl;
    if (this.imageTexture) gl.deleteTexture(this.imageTexture);
    const tex = gl.createTexture() as WebGLTexture;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.imageTexture = tex;
    this.imageWidth = width;
    this.imageHeight = height;
    return { width, height };
  }

  /** Push one LUT into a slot as a filterable texture. */
  setSlot(index: number, slot: GpuSlot | null): void {
    const gl = this.gl;
    const target = this.slots[index];
    if (target.texture3d) {
      gl.deleteTexture(target.texture3d);
      target.texture3d = null;
    }
    if (target.texture2d) {
      gl.deleteTexture(target.texture2d);
      target.texture2d = null;
    }
    if (!slot || !slot.enabled) {
      target.type = 0;
      return;
    }

    const { lut } = slot;
    target.size = lut.size;
    target.domainMin = lut.domainMin;
    target.domainMax = lut.domainMax;
    target.strength = slot.strength;

    if (lut.type === '3D') {
      target.type = 1;
      target.texture3d = this.upload3d(lut);
    } else {
      target.type = 2;
      target.texture2d = this.upload1d(lut);
    }
  }

  /** Pack RGB triples into RGBA and hand them to the driver. */
  private packRgba(data: Float32Array, entries: number): { data: ArrayBufferView; type: number; internal: number } {
    const gl = this.gl;
    if (this.info.floatLinear) {
      const out = new Float32Array(entries * 4);
      for (let i = 0; i < entries; i++) {
        out[i * 4] = data[i * 3];
        out[i * 4 + 1] = data[i * 3 + 1];
        out[i * 4 + 2] = data[i * 3 + 2];
        out[i * 4 + 3] = 1;
      }
      return { data: out, type: gl.FLOAT, internal: gl.RGBA32F };
    }
    // Half float is filterable everywhere WebGL2 is, and keeps far more
    // precision than the 8 bit textures a naive implementation would use.
    const out = new Uint16Array(entries * 4);
    const one = toHalf(1);
    for (let i = 0; i < entries; i++) {
      out[i * 4] = toHalf(data[i * 3]);
      out[i * 4 + 1] = toHalf(data[i * 3 + 1]);
      out[i * 4 + 2] = toHalf(data[i * 3 + 2]);
      out[i * 4 + 3] = one;
    }
    return { data: out, type: gl.HALF_FLOAT, internal: gl.RGBA16F };
  }

  private upload3d(lut: CubeLut): WebGLTexture {
    const gl = this.gl;
    const n = lut.size;
    const packed = this.packRgba(lut.data, n * n * n);
    const tex = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      packed.internal,
      n,
      n,
      n,
      0,
      gl.RGBA,
      packed.type,
      packed.data,
    );
    // LINEAR on a 3D texture is trilinear interpolation in hardware.
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private upload1d(lut: CubeLut): WebGLTexture {
    const gl = this.gl;
    const n = lut.size;
    const packed = this.packRgba(lut.data, n);
    const tex = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, packed.internal, n, 1, 0, gl.RGBA, packed.type, packed.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** Change the blend amount without re-uploading the table. */
  setStrength(index: number, strength: number): void {
    this.slots[index].strength = strength;
  }

  /** The canvas size a given mode needs. */
  sizeFor(mode: RenderMode): { width: number; height: number } {
    const w = this.imageWidth;
    const h = this.imageHeight;
    return mode === 'sidebyside' ? { width: w * 2, height: h } : { width: w, height: h };
  }

  render(mode: RenderMode, split: number): void {
    const gl = this.gl;
    if (!this.imageTexture) return;

    const size = this.sizeFor(mode);
    if (this.canvas.width !== size.width || this.canvas.height !== size.height) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
    }
    gl.viewport(0, 0, size.width, size.height);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);

    for (let i = 0; i < MAX_SLOTS; i++) {
      const slot = this.slots[i];
      const u = this.slotUniforms[i];
      gl.uniform1i(u.type, slot.type);
      gl.uniform1f(u.strength, slot.strength);
      gl.uniform1f(u.size, slot.size);
      gl.uniform3fv(u.domainMin, slot.domainMin);
      gl.uniform3fv(u.domainMax, slot.domainMax);

      gl.activeTexture(gl.TEXTURE1 + i * 2);
      gl.bindTexture(gl.TEXTURE_3D, slot.texture3d ?? this.dummy3d);
      gl.activeTexture(gl.TEXTURE2 + i * 2);
      gl.bindTexture(gl.TEXTURE_2D, slot.texture2d ?? this.dummy2d);
    }

    gl.uniform1i(this.uMode, MODE_CODE[mode]);
    gl.uniform1f(this.uSplit, split);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    const gl = this.gl;
    for (const slot of this.slots) {
      if (slot.texture3d) gl.deleteTexture(slot.texture3d);
      if (slot.texture2d) gl.deleteTexture(slot.texture2d);
    }
    if (this.imageTexture) gl.deleteTexture(this.imageTexture);
    gl.deleteTexture(this.dummy3d);
    gl.deleteTexture(this.dummy2d);
    gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }
}

/** True when this browser can do what lutbox needs. */
export function webgl2Available(): boolean {
  try {
    const probe = document.createElement('canvas');
    return probe.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}
