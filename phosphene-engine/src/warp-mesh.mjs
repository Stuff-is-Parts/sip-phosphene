// The finite-mesh warp path — transcribed from MilkDrop2 @ Doormatty/MilkDrop2
// d0670a3. MilkDrop computes warped texture coordinates at (GridX+1)×(GridY+1)
// mesh vertices on the CPU (milkdropfs.cpp:1877-1926) and lets the rasterizer
// interpolate between them (WarpedBlit_NoShaders draw, :2085-2104). Evaluating
// the same formula per fragment is NOT equivalent for a nonlinear field, and at
// zoom=0 (this repo's scene one) the two are categorically different: the
// source's vertex UVs pass through 1/0 = Infinity and Infinity·0 = NaN in the
// rotation step, so every vertex UV is NaN and the rasterizer interpolates NaN
// across every triangle — the structure this module reproduces exactly.
// Arithmetic runs in doubles where the C runs float32 — the numerical-path
// difference the compatibility guideline permits. Orientation: grid y is up
// (plugin.cpp:2277); the draw-time y sign flip at milkdropfs.cpp:2097 maps to
// D3D's screen-y-down convention, which WebGPU's y-up NDC already matches
// without a flip.

export const GRID_X = 48, GRID_Y = 36; // grid defaults, plugin.cpp:952-953 (GridY = GridX*3/4, :1199)
export const VERT_COUNT = (GRID_X + 1) * (GRID_Y + 1);

// static NDC positions — x = i/GridX*2-1, y = j/GridY*2-1 (plugin.cpp:2276-2277)
export function meshPositions() {
  const out = new Float32Array(VERT_COUNT * 2);
  let n = 0;
  for (let j = 0; j <= GRID_Y; j++) {
    for (let i = 0; i <= GRID_X; i++) {
      out[n++] = i / GRID_X * 2 - 1;
      out[n++] = j / GRID_Y * 2 - 1;
    }
  }
  return out;
}

// triangle indices from the source's strip tables (plugin.cpp:2300-2324):
// four mirrored quadrants, GridY/2 slices each, zigzag strips of GridX+2
// points; each strip renders GridX triangles (milkdropfs.cpp:2104,
// D3DPT_TRIANGLESTRIP with GridX prims, cull off) — expanded here to a
// triangle list where strip point k≥2 closes the triangle (k-2, k-1, k)
export function buildStripIndices() {
  /** @type {number[][]} */
  const strips = [];
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    for (let slice = 0; slice < GRID_Y / 2; slice++) {
      /** @type {number[]} */
      const strip = [];
      for (let i = 0; i < GRID_X + 2; i++) {
        let xref = Math.floor(i / 2);            // plugin.cpp:2311
        let yref = (i % 2) + slice;              // :2312
        if (quadrant & 1) xref = GRID_X - xref;  // :2314-2315
        if (quadrant & 2) yref = GRID_Y - yref;  // :2316-2317
        strip.push(xref + yref * (GRID_X + 1));  // :2319
      }
      strips.push(strip);
    }
  }
  const out = new Uint16Array(strips.length * GRID_X * 3);
  let n = 0;
  for (const strip of strips) {
    for (let k = 2; k < strip.length; k++) {
      out[n++] = /** @type {number} */ (strip[k - 2]);
      out[n++] = /** @type {number} */ (strip[k - 1]);
      out[n++] = /** @type {number} */ (strip[k]);
    }
  }
  return out;
}

/**
 * Per-frame warped UVs — milkdropfs.cpp:1877-1926 verbatim, with the
 * per-vertex rad precompute from plugin.cpp:2281 and the half-texel offsets
 * from milkdropfs.cpp:2270-2271 (0.5/texSize).
 * @param {any} m renderState.motion (zoom, zoomExp, rot, warp, cx, cy, dx, dy,
 *   sx, sy, warpTime, warpScaleInv, f0..f3, aspectX, aspectY)
 * @param {number} texW @param {number} texH
 * @param {Float32Array} out interleaved [u,v] per vertex
 */
export function buildWarpUVs(m, texW, texH, out = new Float32Array(VERT_COUNT * 2)) {
  const aX = m.aspectX, aY = m.aspectY;
  const invAX = 1 / aX, invAY = 1 / aY;          // m_fInvAspect, plugin.cpp:2029-2030
  const toX = 0.5 / texW, toY = 0.5 / texH;      // texel offsets, milkdropfs.cpp:2270-2271
  const cr = Math.cos(m.rot), sr = Math.sin(m.rot);
  let n = 0;
  for (let j = 0; j <= GRID_Y; j++) {
    for (let i = 0; i <= GRID_X; i++) {
      const x = i / GRID_X * 2 - 1, y = j / GRID_Y * 2 - 1;
      const rad = Math.sqrt(x * x * aX * aX + y * y * aY * aY);        // plugin.cpp:2281
      const fZoom2 = Math.pow(m.zoom, Math.pow(m.zoomExp, rad * 2 - 1)); // milkdropfs.cpp:1877
      const fZoom2Inv = 1 / fZoom2;                                    // :1880
      let u = x * aX * 0.5 * fZoom2Inv + 0.5;                          // :1881
      let v = -y * aY * 0.5 * fZoom2Inv + 0.5;                         // :1882
      u = (u - m.cx) / m.sx + m.cx;                                    // :1889
      v = (v - m.cy) / m.sy + m.cy;                                    // :1890
      u += m.warp * 0.0035 * Math.sin(m.warpTime * 0.333 + m.warpScaleInv * (x * m.f0 - y * m.f3)); // :1895
      v += m.warp * 0.0035 * Math.cos(m.warpTime * 0.375 - m.warpScaleInv * (x * m.f2 + y * m.f1)); // :1896
      u += m.warp * 0.0035 * Math.cos(m.warpTime * 0.753 - m.warpScaleInv * (x * m.f1 - y * m.f2)); // :1897
      v += m.warp * 0.0035 * Math.sin(m.warpTime * 0.825 + m.warpScaleInv * (x * m.f0 + y * m.f3)); // :1898
      const u2 = u - m.cx, v2 = v - m.cy;                              // :1902-1903
      u = u2 * cr - v2 * sr + m.cx;                                    // :1907
      v = u2 * sr + v2 * cr + m.cy;                                    // :1908
      u -= m.dx; v -= m.dy;                                            // :1911-1912
      u = (u - 0.5) * invAX + 0.5;                                     // :1915
      v = (v - 0.5) * invAY + 0.5;                                     // :1916
      out[n++] = u + toX;                                              // :1919
      out[n++] = v + toY;                                              // :1920
    }
  }
  return out;
}
