/***/ "./src/rendering/waves/basicWaveform.js":
/*!**********************************************!*\
  !*** ./src/rendering/waves/basicWaveform.js ***!
  \**********************************************/
/*! exports provided: default */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "default", function() { return BasicWaveform; });
/* harmony import */ var _shaders_shaderUtils__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../shaders/shaderUtils */ "./src/rendering/shaders/shaderUtils.js");
/* harmony import */ var _waveUtils__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./waveUtils */ "./src/rendering/waves/waveUtils.js");
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }




var BasicWaveform =
/*#__PURE__*/
function () {
  function BasicWaveform(gl) {
    var opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    _classCallCheck(this, BasicWaveform);

    this.gl = gl;
    var numAudioSamples = 512;
    this.positions = new Float32Array(numAudioSamples * 3);
    this.positions2 = new Float32Array(numAudioSamples * 3);
    this.oldPositions = new Float32Array(numAudioSamples * 3);
    this.oldPositions2 = new Float32Array(numAudioSamples * 3);
    this.smoothedPositions = new Float32Array((numAudioSamples * 2 - 1) * 3);
    this.smoothedPositions2 = new Float32Array((numAudioSamples * 2 - 1) * 3);
    this.color = [0, 0, 0, 1];
    this.texsizeX = opts.texsizeX;
    this.texsizeY = opts.texsizeY;
    this.aspectx = opts.aspectx;
    this.aspecty = opts.aspecty;
    this.invAspectx = 1.0 / this.aspectx;
    this.invAspecty = 1.0 / this.aspecty;
    this.floatPrecision = _shaders_shaderUtils__WEBPACK_IMPORTED_MODULE_0__["default"].getFragmentFloatPrecision(this.gl);
    this.createShader();
    this.vertexBuf = this.gl.createBuffer();
  }

  _createClass(BasicWaveform, [{
    key: "updateGlobals",
    value: function updateGlobals(opts) {
      this.texsizeX = opts.texsizeX;
      this.texsizeY = opts.texsizeY;
      this.aspectx = opts.aspectx;
      this.aspecty = opts.aspecty;
      this.invAspectx = 1.0 / this.aspectx;
      this.invAspecty = 1.0 / this.aspecty;
    }
  }, {
    key: "createShader",
    value: function createShader() {
      this.shaderProgram = this.gl.createProgram();
      var vertShader = this.gl.createShader(this.gl.VERTEX_SHADER);
      this.gl.shaderSource(vertShader, "#version 300 es\n                                      in vec3 aPos;\n                                      uniform vec2 thickOffset;\n                                      void main(void) {\n                                        gl_Position = vec4(aPos + vec3(thickOffset, 0.0), 1.0);\n                                      }");
      this.gl.compileShader(vertShader);
      var fragShader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
      this.gl.shaderSource(fragShader, "#version 300 es\n                                      precision ".concat(this.floatPrecision, " float;\n                                      precision highp int;\n                                      precision mediump sampler2D;\n                                      out vec4 fragColor;\n                                      uniform vec4 u_color;\n                                      void main(void) {\n                                        fragColor = u_color;\n                                      }"));
      this.gl.compileShader(fragShader);
      this.gl.attachShader(this.shaderProgram, vertShader);
      this.gl.attachShader(this.shaderProgram, fragShader);
      this.gl.linkProgram(this.shaderProgram);
      this.aPosLoc = this.gl.getAttribLocation(this.shaderProgram, 'aPos');
      this.colorLoc = this.gl.getUniformLocation(this.shaderProgram, 'u_color');
      this.thickOffsetLoc = this.gl.getUniformLocation(this.shaderProgram, 'thickOffset');
    }
  }, {
    key: "generateWaveform",
    value: function generateWaveform(blending, blendProgress, timeArrayL, timeArrayR, mdVSFrame) {
      var alpha = mdVSFrame.wave_a;
      var vol = (mdVSFrame.bass + mdVSFrame.mid + mdVSFrame.treb) / 3.0;

      if (vol > -0.01 && alpha > 0.001 && timeArrayL.length > 0) {
        var waveL = BasicWaveform.processWaveform(timeArrayL, mdVSFrame);
        var waveR = BasicWaveform.processWaveform(timeArrayR, mdVSFrame);
        var newWaveMode = Math.floor(mdVSFrame.wave_mode) % 8;
        var oldWaveMode = Math.floor(mdVSFrame.old_wave_mode) % 8;
        var wavePosX = mdVSFrame.wave_x * 2.0 - 1.0;
        var wavePosY = mdVSFrame.wave_y * 2.0 - 1.0;
        this.numVert = 0;
        this.oldNumVert = 0;
        var its = blending && newWaveMode !== oldWaveMode ? 2 : 1;

        for (var it = 0; it < its; it++) {
          var waveMode = it === 0 ? newWaveMode : oldWaveMode;
          var fWaveParam2 = mdVSFrame.wave_mystery;

          if ((waveMode === 0 || waveMode === 1 || waveMode === 4) && (fWaveParam2 < -1 || fWaveParam2 > 1)) {
            fWaveParam2 = fWaveParam2 * 0.5 + 0.5;
            fWaveParam2 -= Math.floor(fWaveParam2);
            fWaveParam2 = Math.abs(fWaveParam2);
            fWaveParam2 = fWaveParam2 * 2 - 1;
          }

          var numVert = void 0;
          var positions = void 0;
          var positions2 = void 0;

          if (it === 0) {
            positions = this.positions;
            positions2 = this.positions2;
          } else {
            positions = this.oldPositions;
            positions2 = this.oldPositions2;
          }

          alpha = mdVSFrame.wave_a;

          if (waveMode === 0) {
            if (mdVSFrame.modwavealphabyvolume > 0) {
              var alphaDiff = mdVSFrame.modwavealphaend - mdVSFrame.modwavealphastart;
              alpha *= (vol - mdVSFrame.modwavealphastart) / alphaDiff;
            }

            alpha = Math.clamp(alpha, 0, 1);
            numVert = Math.floor(waveL.length / 2) + 1;
            var numVertInv = 1.0 / (numVert - 1);
            var sampleOffset = Math.floor((waveL.length - numVert) / 2);

            for (var i = 0; i < numVert - 1; i++) {
              var rad = 0.5 + 0.4 * waveR[i + sampleOffset] + fWaveParam2;
              var ang = i * numVertInv * 2 * Math.PI + mdVSFrame.time * 0.2;

              if (i < numVert / 10) {
                var _mix = i / (numVert * 0.1);

                _mix = 0.5 - 0.5 * Math.cos(_mix * Math.PI);
                var rad2 = 0.5 + 0.4 * waveR[i + numVert + sampleOffset] + fWaveParam2;
                rad = (1.0 - _mix) * rad2 + rad * _mix;
              }

              positions[i * 3 + 0] = rad * Math.cos(ang) * this.aspecty + wavePosX;
              positions[i * 3 + 1] = rad * Math.sin(ang) * this.aspectx + wavePosY;
              positions[i * 3 + 2] = 0;
            } // connect the loop


            positions[(numVert - 1) * 3 + 0] = positions[0];
            positions[(numVert - 1) * 3 + 1] = positions[1];
            positions[(numVert - 1) * 3 + 2] = 0;
          } else if (waveMode === 1) {
            alpha *= 1.25;

            if (mdVSFrame.modwavealphabyvolume > 0) {
              var _alphaDiff = mdVSFrame.modwavealphaend - mdVSFrame.modwavealphastart;

              alpha *= (vol - mdVSFrame.modwavealphastart) / _alphaDiff;
            }

            alpha = Math.clamp(alpha, 0, 1);
            numVert = Math.floor(waveL.length / 2);

            for (var _i = 0; _i < numVert; _i++) {
              var _rad = 0.53 + 0.43 * waveR[_i] + fWaveParam2;

              var _ang = waveL[_i + 32] * 0.5 * Math.PI + mdVSFrame.time * 2.3;

              positions[_i * 3 + 0] = _rad * Math.cos(_ang) * this.aspecty + wavePosX;
              positions[_i * 3 + 1] = _rad * Math.sin(_ang) * this.aspectx + wavePosY;
              positions[_i * 3 + 2] = 0;
            }
          } else if (waveMode === 2) {
            if (this.texsizeX < 1024) {
              alpha *= 0.09;
            } else if (this.texsizeX >= 1024 && this.texsizeX < 2048) {
              alpha *= 0.11;
            } else {
              alpha *= 0.13;
            }

            if (mdVSFrame.modwavealphabyvolume > 0) {
              var _alphaDiff2 = mdVSFrame.modwavealphaend - mdVSFrame.modwavealphastart;

              alpha *= (vol - mdVSFrame.modwavealphastart) / _alphaDiff2;
            }

            alpha = Math.clamp(alpha, 0, 1);
            numVert = waveL.length;

            for (var _i2 = 0; _i2 < waveL.length; _i2++) {
              positions[_i2 * 3 + 0] = waveR[_i2] * this.aspecty + wavePosX;
              positions[_i2 * 3 + 1] = waveL[(_i2 + 32) % waveL.length] * this.aspectx + wavePosY;
              positions[_i2 * 3 + 2] = 0;
            }
          } else if (waveMode === 3) {
            if (this.texsizeX < 1024) {
              alpha *= 0.15;
            } else if (this.texsizeX >= 1024 && this.texsizeX < 2048) {
              alpha *= 0.22;
            } else {
              alpha *= 0.33;
            }

            alpha *= 1.3;
            alpha *= mdVSFrame.treb * mdVSFrame.treb; // should be treb_imm

            if (mdVSFrame.modwavealphabyvolume > 0) {
              var _alphaDiff3 = mdVSFrame.modwavealphaend - mdVSFrame.modwavealphastart;

              alpha *= (vol - mdVSFrame.modwavealphastart) / _alphaDiff3;
            }

            alpha = Math.clamp(alpha, 0, 1);
            numVert = waveL.length;

            for (var _i3 = 0; _i3 < waveL.length; _i3++) {
              positions[_i3 * 3 + 0] = waveR[_i3] * this.aspecty + wavePosX;
              positions[_i3 * 3 + 1] = waveL[(_i3 + 32) % waveL.length] * this.aspectx + wavePosY;
              positions[_i3 * 3 + 2] = 0;
            }
          } else if (waveMode === 4) {
            if (mdVSFrame.modwavealphabyvolume > 0) {
              var _alphaDiff4 = mdVSFrame.modwavealphaend - mdVSFrame.modwavealphastart;

              alpha *= (vol - mdVSFrame.modwavealphastart) / _alphaDiff4;
            }

            alpha = Math.clamp(alpha, 0, 1);
            numVert = waveL.length;

            if (numVert > this.texsizeX / 3) {
              numVert = Math.floor(this.texsizeX / 3);
            }

            var _numVertInv = 1.0 / numVert;

            var _sampleOffset = Math.floor((waveL.length - numVert) / 2);

            var w1 = 0.45 + 0.5 * (fWaveParam2 * 0.5 + 0.5);
            var w2 = 1.0 - w1;

            for (var _i4 = 0; _i4 < numVert; _i4++) {
              var x = 2.0 * _i4 * _numVertInv + (wavePosX - 1) + waveR[(_i4 + 25 + _sampleOffset) % waveL.length] * 0.44;
              var y = waveL[_i4 + _sampleOffset] * 0.47 + wavePosY; // momentum

              if (_i4 > 1) {
                x = x * w2 + w1 * (positions[(_i4 - 1) * 3 + 0] * 2.0 - positions[(_i4 - 2) * 3 + 0]);
                y = y * w2 + w1 * (positions[(_i4 - 1) * 3 + 1] * 2.0 - positions[(_i4 - 2) * 3 + 1]);
              }

              positions[_i4 * 3 + 0] = x;
              positions[_i4 * 3 + 1] = y;
              positions[_i4 * 3 + 2] = 0;
            }
          } else if (waveMode === 5) {
            if (this.texsizeX < 1024) {
              alpha *= 0.09;
            } else if (this.texsizeX >= 1024 && this.texsizeX < 2048) {
              alpha *= 0.11;
            } else {
              alpha *= 0.13;
            }

            if (mdVSFrame.modwavealphabyvolume > 0) {
              var _alphaDiff5 = mdVSFrame.modwavealphaend - mdVSFrame.modwavealphastart;

              alpha *= (vol - mdVSFrame.modwavealphastart) / _alphaDiff5;
            }

            alpha = Math.clamp(alpha, 0, 1);
            var cosRot = Math.cos(mdVSFrame.time * 0.3);
            var sinRot = Math.sin(mdVSFrame.time * 0.3);
            numVert = waveL.length;

            for (var _i5 = 0; _i5 < waveL.length; _i5++) {
              var ioff = (_i5 + 32) % waveL.length;
              var x0 = waveR[_i5] * waveL[ioff] + waveL[_i5] * waveR[ioff];
              var y0 = waveR[_i5] * waveR[_i5] - waveL[ioff] * waveL[ioff];
              positions[_i5 * 3 + 0] = (x0 * cosRot - y0 * sinRot) * (this.aspecty + wavePosX);
              positions[_i5 * 3 + 1] = (x0 * sinRot + y0 * cosRot) * (this.aspectx + wavePosY);
              positions[_i5 * 3 + 2] = 0;
            }
          } else if (waveMode === 6 || waveMode === 7) {
            if (mdVSFrame.modwavealphabyvolume > 0) {
              var _alphaDiff6 = mdVSFrame.modwavealphaend - mdVSFrame.modwavealphastart;

              alpha *= (vol - mdVSFrame.modwavealphastart) / _alphaDiff6;
            }

            alpha = Math.clamp(alpha, 0, 1);
            numVert = Math.floor(waveL.length / 2);

            if (numVert > this.texsizeX / 3) {
              numVert = Math.floor(this.texsizeX / 3);
            }

            var _sampleOffset2 = Math.floor((waveL.length - numVert) / 2);

            var _ang2 = Math.PI * 0.5 * fWaveParam2;

            var dx = Math.cos(_ang2);
            var dy = Math.sin(_ang2);
            var edgex = [wavePosX * Math.cos(_ang2 + Math.PI * 0.5) - dx * 3.0, wavePosX * Math.cos(_ang2 + Math.PI * 0.5) + dx * 3.0];
            var edgey = [wavePosX * Math.sin(_ang2 + Math.PI * 0.5) - dy * 3.0, wavePosX * Math.sin(_ang2 + Math.PI * 0.5) + dy * 3.0];

            for (var _i6 = 0; _i6 < 2; _i6++) {
              for (var j = 0; j < 4; j++) {
                var t = void 0;
                var bClip = false;

                switch (j) {
                  case 0:
                    if (edgex[_i6] > 1.1) {
                      t = (1.1 - edgex[1 - _i6]) / (edgex[_i6] - edgex[1 - _i6]);
                      bClip = true;
                    }

                    break;

                  case 1:
                    if (edgex[_i6] < -1.1) {
                      t = (-1.1 - edgex[1 - _i6]) / (edgex[_i6] - edgex[1 - _i6]);
                      bClip = true;
                    }

                    break;

                  case 2:
                    if (edgey[_i6] > 1.1) {
                      t = (1.1 - edgey[1 - _i6]) / (edgey[_i6] - edgey[1 - _i6]);
                      bClip = true;
                    }

                    break;

                  case 3:
                    if (edgey[_i6] < -1.1) {
                      t = (-1.1 - edgey[1 - _i6]) / (edgey[_i6] - edgey[1 - _i6]);
                      bClip = true;
                    }

                    break;

                  default:
                }

                if (bClip) {
                  var dxi = edgex[_i6] - edgex[1 - _i6];
                  var dyi = edgey[_i6] - edgey[1 - _i6];
                  edgex[_i6] = edgex[1 - _i6] + dxi * t;
                  edgey[_i6] = edgey[1 - _i6] + dyi * t;
                }
              }
            }

            dx = (edgex[1] - edgex[0]) / numVert;
            dy = (edgey[1] - edgey[0]) / numVert;
            var ang2 = Math.atan2(dy, dx);
            var perpDx = Math.cos(ang2 + Math.PI * 0.5);
            var perpDy = Math.sin(ang2 + Math.PI * 0.5);

            if (waveMode === 6) {
              for (var _i7 = 0; _i7 < numVert; _i7++) {
                var sample = waveL[_i7 + _sampleOffset2];
                positions[_i7 * 3 + 0] = edgex[0] + dx * _i7 + perpDx * 0.25 * sample;
                positions[_i7 * 3 + 1] = edgey[0] + dy * _i7 + perpDy * 0.25 * sample;
                positions[_i7 * 3 + 2] = 0;
              }
            } else if (waveMode === 7) {
              var sep = Math.pow(wavePosY * 0.5 + 0.5, 2);

              for (var _i8 = 0; _i8 < numVert; _i8++) {
                var _sample = waveL[_i8 + _sampleOffset2];
                positions[_i8 * 3 + 0] = edgex[0] + dx * _i8 + perpDx * (0.25 * _sample + sep);
                positions[_i8 * 3 + 1] = edgey[0] + dy * _i8 + perpDy * (0.25 * _sample + sep);
                positions[_i8 * 3 + 2] = 0;
              }

              for (var _i9 = 0; _i9 < numVert; _i9++) {
                var _sample2 = waveR[_i9 + _sampleOffset2];
                positions2[_i9 * 3 + 0] = edgex[0] + dx * _i9 + perpDx * (0.25 * _sample2 - sep);
                positions2[_i9 * 3 + 1] = edgey[0] + dy * _i9 + perpDy * (0.25 * _sample2 - sep);
                positions2[_i9 * 3 + 2] = 0;
              }
            }
          }

          if (it === 0) {
            this.positions = positions;
            this.positions2 = positions2;
            this.numVert = numVert;
            this.alpha = alpha;
          } else {
            this.oldPositions = positions;
            this.oldPositions2 = positions2;
            this.oldNumVert = numVert;
            this.oldAlpha = alpha;
          }
        }

        var mix = 0.5 - 0.5 * Math.cos(blendProgress * Math.PI);
        var mix2 = 1 - mix;

        if (this.oldNumVert > 0) {
          alpha = mix * this.alpha + mix2 * this.oldAlpha;
        }

        var r = Math.clamp(mdVSFrame.wave_r, 0, 1);
        var g = Math.clamp(mdVSFrame.wave_g, 0, 1);
        var b = Math.clamp(mdVSFrame.wave_b, 0, 1);

        if (mdVSFrame.wave_brighten !== 0) {
          var maxc = Math.max(r, g, b);

          if (maxc > 0.01) {
            r /= maxc;
            g /= maxc;
            b /= maxc;
          }
        }

        this.color = [r, g, b, alpha];

        if (this.oldNumVert > 0) {
          if (newWaveMode === 7) {
            var m = (this.oldNumVert - 1) / (this.numVert * 2);

            for (var _i10 = 0; _i10 < this.numVert; _i10++) {
              var fIdx = _i10 * m;
              var nIdx = Math.floor(fIdx);

              var _t = fIdx - nIdx;

              var _x = this.oldPositions[nIdx * 3 + 0] * (1 - _t) + this.oldPositions[(nIdx + 1) * 3 + 0] * _t;

              var _y = this.oldPositions[nIdx * 3 + 1] * (1 - _t) + this.oldPositions[(nIdx + 1) * 3 + 1] * _t;

              this.positions[_i10 * 3 + 0] = this.positions[_i10 * 3 + 0] * mix + _x * mix2;
              this.positions[_i10 * 3 + 1] = this.positions[_i10 * 3 + 1] * mix + _y * mix2;
              this.positions[_i10 * 3 + 2] = 0;
            }

            for (var _i11 = 0; _i11 < this.numVert; _i11++) {
              var _fIdx = (_i11 + this.numVert) * m;

              var _nIdx = Math.floor(_fIdx);

              var _t2 = _fIdx - _nIdx;

              var _x2 = this.oldPositions[_nIdx * 3 + 0] * (1 - _t2) + this.oldPositions[(_nIdx + 1) * 3 + 0] * _t2;

              var _y2 = this.oldPositions[_nIdx * 3 + 1] * (1 - _t2) + this.oldPositions[(_nIdx + 1) * 3 + 1] * _t2;

              this.positions2[_i11 * 3 + 0] = this.positions2[_i11 * 3 + 0] * mix + _x2 * mix2;
              this.positions2[_i11 * 3 + 1] = this.positions2[_i11 * 3 + 1] * mix + _y2 * mix2;
              this.positions2[_i11 * 3 + 2] = 0;
            }
          } else if (oldWaveMode === 7) {
            var halfNumVert = this.numVert / 2;

            var _m = (this.oldNumVert - 1) / halfNumVert;

            for (var _i12 = 0; _i12 < halfNumVert; _i12++) {
              var _fIdx2 = _i12 * _m;

              var _nIdx2 = Math.floor(_fIdx2);

              var _t3 = _fIdx2 - _nIdx2;

              var _x3 = this.oldPositions[_nIdx2 * 3 + 0] * (1 - _t3) + this.oldPositions[(_nIdx2 + 1) * 3 + 0] * _t3;

              var _y3 = this.oldPositions[_nIdx2 * 3 + 1] * (1 - _t3) + this.oldPositions[(_nIdx2 + 1) * 3 + 1] * _t3;

              this.positions[_i12 * 3 + 0] = this.positions[_i12 * 3 + 0] * mix + _x3 * mix2;
              this.positions[_i12 * 3 + 1] = this.positions[_i12 * 3 + 1] * mix + _y3 * mix2;
              this.positions[_i12 * 3 + 2] = 0;
            }

            for (var _i13 = 0; _i13 < halfNumVert; _i13++) {
              var _fIdx3 = _i13 * _m;

              var _nIdx3 = Math.floor(_fIdx3);

              var _t4 = _fIdx3 - _nIdx3;

              var _x4 = this.oldPositions2[_nIdx3 * 3 + 0] * (1 - _t4) + this.oldPositions2[(_nIdx3 + 1) * 3 + 0] * _t4;

              var _y4 = this.oldPositions2[_nIdx3 * 3 + 1] * (1 - _t4) + this.oldPositions2[(_nIdx3 + 1) * 3 + 1] * _t4;

              this.positions2[_i13 * 3 + 0] = this.positions[(_i13 + halfNumVert) * 3 + 0] * mix + _x4 * mix2;
              this.positions2[_i13 * 3 + 1] = this.positions[(_i13 + halfNumVert) * 3 + 1] * mix + _y4 * mix2;
              this.positions2[_i13 * 3 + 2] = 0;
            }
          } else {
            var _m2 = (this.oldNumVert - 1) / this.numVert;

            for (var _i14 = 0; _i14 < this.numVert; _i14++) {
              var _fIdx4 = _i14 * _m2;

              var _nIdx4 = Math.floor(_fIdx4);

              var _t5 = _fIdx4 - _nIdx4;

              var _x5 = this.oldPositions[_nIdx4 * 3 + 0] * (1 - _t5) + this.oldPositions[(_nIdx4 + 1) * 3 + 0] * _t5;

              var _y5 = this.oldPositions[_nIdx4 * 3 + 1] * (1 - _t5) + this.oldPositions[(_nIdx4 + 1) * 3 + 1] * _t5;

              this.positions[_i14 * 3 + 0] = this.positions[_i14 * 3 + 0] * mix + _x5 * mix2;
              this.positions[_i14 * 3 + 1] = this.positions[_i14 * 3 + 1] * mix + _y5 * mix2;
              this.positions[_i14 * 3 + 2] = 0;
            }
          }
        }

        for (var _i15 = 0; _i15 < this.numVert; _i15++) {
          this.positions[_i15 * 3 + 1] = -this.positions[_i15 * 3 + 1];
        }

        this.smoothedNumVert = this.numVert * 2 - 1;
        _waveUtils__WEBPACK_IMPORTED_MODULE_1__["default"].smoothWave(this.positions, this.smoothedPositions, this.numVert);

        if (newWaveMode === 7 || oldWaveMode === 7) {
          for (var _i16 = 0; _i16 < this.numVert; _i16++) {
            this.positions2[_i16 * 3 + 1] = -this.positions2[_i16 * 3 + 1];
          }

          _waveUtils__WEBPACK_IMPORTED_MODULE_1__["default"].smoothWave(this.positions2, this.smoothedPositions2, this.numVert);
        }

        return true;
      }

      return false;
    }
  }, {
    key: "drawBasicWaveform",
    value: function drawBasicWaveform(blending, blendProgress, timeArrayL, timeArrayR, mdVSFrame) {
      if (this.generateWaveform(blending, blendProgress, timeArrayL, timeArrayR, mdVSFrame)) {
        this.gl.useProgram(this.shaderProgram);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuf);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, this.smoothedPositions, this.gl.STATIC_DRAW);
        this.gl.vertexAttribPointer(this.aPosLoc, 3, this.gl.FLOAT, false, 0, 0);
        this.gl.enableVertexAttribArray(this.aPosLoc);
        this.gl.uniform4fv(this.colorLoc, this.color);
        var instances = 1;

        if (mdVSFrame.wave_thick !== 0 || mdVSFrame.wave_dots !== 0) {
          instances = 4;
        }

        if (mdVSFrame.additivewave !== 0) {
          this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);
        } else {
          this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        }

        var drawMode = mdVSFrame.wave_dots !== 0 ? this.gl.POINTS : this.gl.LINE_STRIP; // TODO: use drawArraysInstanced

        for (var i = 0; i < instances; i++) {
          var offset = 2;

          if (i === 0) {
            this.gl.uniform2fv(this.thickOffsetLoc, [0, 0]);
          } else if (i === 1) {
            this.gl.uniform2fv(this.thickOffsetLoc, [offset / this.texsizeX, 0]);
          } else if (i === 2) {
            this.gl.uniform2fv(this.thickOffsetLoc, [0, offset / this.texsizeY]);
          } else if (i === 3) {
            this.gl.uniform2fv(this.thickOffsetLoc, [offset / this.texsizeX, offset / this.texsizeY]);
          }

          this.gl.drawArrays(drawMode, 0, this.smoothedNumVert);
        }

        var waveMode = Math.floor(mdVSFrame.wave_mode) % 8;

        if (waveMode === 7) {
          this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuf);
          this.gl.bufferData(this.gl.ARRAY_BUFFER, this.smoothedPositions2, this.gl.STATIC_DRAW);
          this.gl.vertexAttribPointer(this.aPosLoc, 3, this.gl.FLOAT, false, 0, 0);
          this.gl.enableVertexAttribArray(this.aPosLoc);

          for (var _i17 = 0; _i17 < instances; _i17++) {
            var _offset = 2;

            if (_i17 === 0) {
              this.gl.uniform2fv(this.thickOffsetLoc, [0, 0]);
            } else if (_i17 === 1) {
              this.gl.uniform2fv(this.thickOffsetLoc, [_offset / this.texsizeX, 0]);
            } else if (_i17 === 2) {
              this.gl.uniform2fv(this.thickOffsetLoc, [0, _offset / this.texsizeY]);
            } else if (_i17 === 3) {
              this.gl.uniform2fv(this.thickOffsetLoc, [_offset / this.texsizeX, _offset / this.texsizeY]);
            }

            this.gl.drawArrays(drawMode, 0, this.smoothedNumVert);
          }
        }
      }
    }
  }], [{
    key: "processWaveform",
    value: function processWaveform(timeArray, mdVSFrame) {
      var waveform = [];
      var scale = mdVSFrame.wave_scale / 128.0;
      var smooth = mdVSFrame.wave_smoothing;
      var smooth2 = scale * (1.0 - smooth);
      waveform.push(timeArray[0] * scale);

      for (var i = 1; i < timeArray.length; i++) {
        waveform.push(timeArray[i] * smooth2 + waveform[i - 1] * smooth);
      }

      return waveform;
    }
  }]);

  return BasicWaveform;
}();



/***/ }),

