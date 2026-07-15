/***/ "./src/noise/noise.js":
/*!****************************!*\
  !*** ./src/noise/noise.js ***!
  \****************************/
/*! exports provided: default */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "default", function() { return Noise; });
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

var Noise =
/*#__PURE__*/
function () {
  function Noise(gl) {
    _classCallCheck(this, Noise);

    this.gl = gl;
    this.anisoExt = this.gl.getExtension('EXT_texture_filter_anisotropic') || this.gl.getExtension('MOZ_EXT_texture_filter_anisotropic') || this.gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    this.noiseTexLQ = this.gl.createTexture();
    this.noiseTexLQLite = this.gl.createTexture();
    this.noiseTexMQ = this.gl.createTexture();
    this.noiseTexHQ = this.gl.createTexture();
    this.noiseTexVolLQ = this.gl.createTexture();
    this.noiseTexVolHQ = this.gl.createTexture();
    this.nTexArrLQ = Noise.createNoiseTex(256, 1);
    this.nTexArrLQLite = Noise.createNoiseTex(32, 1);
    this.nTexArrMQ = Noise.createNoiseTex(256, 4);
    this.nTexArrHQ = Noise.createNoiseTex(256, 8);
    this.nTexArrVolLQ = Noise.createNoiseVolTex(32, 1);
    this.nTexArrVolHQ = Noise.createNoiseVolTex(32, 4);
    this.bindTexture(this.noiseTexLQ, this.nTexArrLQ, 256, 256);
    this.bindTexture(this.noiseTexLQLite, this.nTexArrLQLite, 32, 32);
    this.bindTexture(this.noiseTexMQ, this.nTexArrMQ, 256, 256);
    this.bindTexture(this.noiseTexHQ, this.nTexArrHQ, 256, 256);
    this.bindTexture3D(this.noiseTexVolLQ, this.nTexArrVolLQ, 32, 32, 32);
    this.bindTexture3D(this.noiseTexVolHQ, this.nTexArrVolHQ, 32, 32, 32);
    this.noiseTexPointLQ = this.gl.createSampler();
    gl.samplerParameteri(this.noiseTexPointLQ, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
    gl.samplerParameteri(this.noiseTexPointLQ, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.samplerParameteri(this.noiseTexPointLQ, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.samplerParameteri(this.noiseTexPointLQ, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  _createClass(Noise, [{
    key: "bindTexture",
    value: function bindTexture(texture, data, width, height) {
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, width, height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, data);
      this.gl.generateMipmap(this.gl.TEXTURE_2D);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.REPEAT);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.REPEAT);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR_MIPMAP_LINEAR);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

      if (this.anisoExt) {
        var max = this.gl.getParameter(this.anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
        this.gl.texParameterf(this.gl.TEXTURE_2D, this.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, max);
      }
    }
  }, {
    key: "bindTexture3D",
    value: function bindTexture3D(texture, data, width, height, depth) {
      this.gl.bindTexture(this.gl.TEXTURE_3D, texture);
      this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
      this.gl.texImage3D(this.gl.TEXTURE_3D, 0, this.gl.RGBA, width, height, depth, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, data);
      this.gl.generateMipmap(this.gl.TEXTURE_3D);
      this.gl.texParameteri(this.gl.TEXTURE_3D, this.gl.TEXTURE_WRAP_S, this.gl.REPEAT);
      this.gl.texParameteri(this.gl.TEXTURE_3D, this.gl.TEXTURE_WRAP_T, this.gl.REPEAT);
      this.gl.texParameteri(this.gl.TEXTURE_3D, this.gl.TEXTURE_WRAP_R, this.gl.REPEAT);
      this.gl.texParameteri(this.gl.TEXTURE_3D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR_MIPMAP_LINEAR);
      this.gl.texParameteri(this.gl.TEXTURE_3D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

      if (this.anisoExt) {
        var max = this.gl.getParameter(this.anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
        this.gl.texParameterf(this.gl.TEXTURE_3D, this.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, max);
      }
    }
  }], [{
    key: "fCubicInterpolate",
    value: function fCubicInterpolate(y0, y1, y2, y3, t) {
      var t2 = t * t;
      var t3 = t * t2;
      var a0 = y3 - y2 - y0 + y1;
      var a1 = y0 - y1 - a0;
      var a2 = y2 - y0;
      var a3 = y1;
      return a0 * t3 + a1 * t2 + a2 * t + a3;
    }
  }, {
    key: "dwCubicInterpolate",
    value: function dwCubicInterpolate(y0, y1, y2, y3, t) {
      var ret = [];

      for (var i = 0; i < 4; i++) {
        var f = Noise.fCubicInterpolate(y0[i] / 255.0, y1[i] / 255.0, y2[i] / 255.0, y3[i] / 255.0, t);
        f = Math.clamp(f, 0, 1);
        ret[i] = f * 255;
      }

      return ret;
    }
  }, {
    key: "createNoiseVolTex",
    value: function createNoiseVolTex(noiseSize, zoom) {
      var nsize = noiseSize * noiseSize * noiseSize;
      var texArr = new Uint8Array(nsize * 4);
      var texRange = zoom > 1 ? 216 : 256;
      var halfTexRange = texRange * 0.5;

      for (var i = 0; i < nsize; i++) {
        texArr[i * 4 + 0] = Math.floor(Math.random() * texRange + halfTexRange);
        texArr[i * 4 + 1] = Math.floor(Math.random() * texRange + halfTexRange);
        texArr[i * 4 + 2] = Math.floor(Math.random() * texRange + halfTexRange);
        texArr[i * 4 + 3] = Math.floor(Math.random() * texRange + halfTexRange);
      }

      var wordsPerSlice = noiseSize * noiseSize;
      var wordsPerLine = noiseSize;

      if (zoom > 1) {
        for (var z = 0; z < noiseSize; z += zoom) {
          for (var y = 0; y < noiseSize; y += zoom) {
            for (var x = 0; x < noiseSize; x++) {
              if (x % zoom !== 0) {
                var baseX = Math.floor(x / zoom) * zoom + noiseSize;
                var baseY = z * wordsPerSlice + y * wordsPerLine;
                var y0 = [];
                var y1 = [];
                var y2 = [];
                var y3 = [];

                for (var _i = 0; _i < 4; _i++) {
                  y0[_i] = texArr[baseY * 4 + (baseX - zoom) % noiseSize * 4 + _i];
                  y1[_i] = texArr[baseY * 4 + baseX % noiseSize * 4 + _i];
                  y2[_i] = texArr[baseY * 4 + (baseX + zoom) % noiseSize * 4 + _i];
                  y3[_i] = texArr[baseY * 4 + (baseX + zoom * 2) % noiseSize * 4 + _i];
                }

                var t = x % zoom / zoom;
                var result = Noise.dwCubicInterpolate(y0, y1, y2, y3, t);

                for (var _i2 = 0; _i2 < 4; _i2++) {
                  var offset = x * 4 + _i2;
                  texArr[z * wordsPerSlice * 4 + y * wordsPerLine * 4 + offset] = result[_i2];
                }
              }
            }
          }
        }

        for (var _z = 0; _z < noiseSize; _z += zoom) {
          for (var _x = 0; _x < noiseSize; _x++) {
            for (var _y = 0; _y < noiseSize; _y++) {
              if (_y % zoom !== 0) {
                var _baseY = Math.floor(_y / zoom) * zoom + noiseSize;

                var baseZ = _z * wordsPerSlice;
                var _y2 = [];
                var _y3 = [];
                var _y4 = [];
                var _y5 = [];

                for (var _i3 = 0; _i3 < 4; _i3++) {
                  var _offset = _x * 4 + baseZ * 4 + _i3;

                  _y2[_i3] = texArr[(_baseY - zoom) % noiseSize * wordsPerLine * 4 + _offset];
                  _y3[_i3] = texArr[_baseY % noiseSize * wordsPerLine * 4 + _offset];
                  _y4[_i3] = texArr[(_baseY + zoom) % noiseSize * wordsPerLine * 4 + _offset];
                  _y5[_i3] = texArr[(_baseY + zoom * 2) % noiseSize * wordsPerLine * 4 + _offset];
                }

                var _t = _y % zoom / zoom;

                var _result = Noise.dwCubicInterpolate(_y2, _y3, _y4, _y5, _t);

                for (var _i4 = 0; _i4 < 4; _i4++) {
                  var _offset2 = _x * 4 + baseZ * 4 + _i4;

                  texArr[_y * wordsPerLine * 4 + _offset2] = _result[_i4];
                }
              }
            }
          }
        }

        for (var _x2 = 0; _x2 < noiseSize; _x2++) {
          for (var _y6 = 0; _y6 < noiseSize; _y6++) {
            for (var _z2 = 0; _z2 < noiseSize; _z2++) {
              if (_z2 % zoom !== 0) {
                var _baseY2 = _y6 * wordsPerLine;

                var _baseZ = Math.floor(_z2 / zoom) * zoom + noiseSize;

                var _y7 = [];
                var _y8 = [];
                var _y9 = [];
                var _y10 = [];

                for (var _i5 = 0; _i5 < 4; _i5++) {
                  var _offset3 = _x2 * 4 + _baseY2 * 4 + _i5;

                  _y7[_i5] = texArr[(_baseZ - zoom) % noiseSize * wordsPerSlice * 4 + _offset3];
                  _y8[_i5] = texArr[_baseZ % noiseSize * wordsPerSlice * 4 + _offset3];
                  _y9[_i5] = texArr[(_baseZ + zoom) % noiseSize * wordsPerSlice * 4 + _offset3];
                  _y10[_i5] = texArr[(_baseZ + zoom * 2) % noiseSize * wordsPerSlice * 4 + _offset3];
                }

                var _t2 = _y6 % zoom / zoom;

                var _result2 = Noise.dwCubicInterpolate(_y7, _y8, _y9, _y10, _t2);

                for (var _i6 = 0; _i6 < 4; _i6++) {
                  var _offset4 = _x2 * 4 + _baseY2 * 4 + _i6;

                  texArr[_z2 * wordsPerSlice * 4 + _offset4] = _result2[_i6];
                }
              }
            }
          }
        }
      }

      return texArr;
    }
  }, {
    key: "createNoiseTex",
    value: function createNoiseTex(noiseSize, zoom) {
      var nsize = noiseSize * noiseSize;
      var texArr = new Uint8Array(nsize * 4);
      var texRange = zoom > 1 ? 216 : 256;
      var halfTexRange = texRange * 0.5;

      for (var i = 0; i < nsize; i++) {
        texArr[i * 4 + 0] = Math.floor(Math.random() * texRange + halfTexRange);
        texArr[i * 4 + 1] = Math.floor(Math.random() * texRange + halfTexRange);
        texArr[i * 4 + 2] = Math.floor(Math.random() * texRange + halfTexRange);
        texArr[i * 4 + 3] = Math.floor(Math.random() * texRange + halfTexRange);
      }

      if (zoom > 1) {
        for (var y = 0; y < noiseSize; y += zoom) {
          for (var x = 0; x < noiseSize; x++) {
            if (x % zoom !== 0) {
              var baseX = Math.floor(x / zoom) * zoom + noiseSize;
              var baseY = y * noiseSize;
              var y0 = [];
              var y1 = [];
              var y2 = [];
              var y3 = [];

              for (var z = 0; z < 4; z++) {
                y0[z] = texArr[baseY * 4 + (baseX - zoom) % noiseSize * 4 + z];
                y1[z] = texArr[baseY * 4 + baseX % noiseSize * 4 + z];
                y2[z] = texArr[baseY * 4 + (baseX + zoom) % noiseSize * 4 + z];
                y3[z] = texArr[baseY * 4 + (baseX + zoom * 2) % noiseSize * 4 + z];
              }

              var t = x % zoom / zoom;
              var result = Noise.dwCubicInterpolate(y0, y1, y2, y3, t);

              for (var _z3 = 0; _z3 < 4; _z3++) {
                texArr[y * noiseSize * 4 + x * 4 + _z3] = result[_z3];
              }
            }
          }
        }

        for (var _x3 = 0; _x3 < noiseSize; _x3++) {
          for (var _y11 = 0; _y11 < noiseSize; _y11++) {
            if (_y11 % zoom !== 0) {
              var _baseY3 = Math.floor(_y11 / zoom) * zoom + noiseSize;

              var _y12 = [];
              var _y13 = [];
              var _y14 = [];
              var _y15 = [];

              for (var _z4 = 0; _z4 < 4; _z4++) {
                _y12[_z4] = texArr[(_baseY3 - zoom) % noiseSize * noiseSize * 4 + _x3 * 4 + _z4];
                _y13[_z4] = texArr[_baseY3 % noiseSize * noiseSize * 4 + _x3 * 4 + _z4];
                _y14[_z4] = texArr[(_baseY3 + zoom) % noiseSize * noiseSize * 4 + _x3 * 4 + _z4];
                _y15[_z4] = texArr[(_baseY3 + zoom * 2) % noiseSize * noiseSize * 4 + _x3 * 4 + _z4];
              }

              var _t3 = _y11 % zoom / zoom;

              var _result3 = Noise.dwCubicInterpolate(_y12, _y13, _y14, _y15, _t3);

              for (var _z5 = 0; _z5 < 4; _z5++) {
                texArr[_y11 * noiseSize * 4 + _x3 * 4 + _z5] = _result3[_z5];
              }
            }
          }
        }
      }

      return texArr;
    }
  }]);

  return Noise;
}();



/***/ }),

