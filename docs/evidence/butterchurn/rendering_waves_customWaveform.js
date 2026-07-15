/***/ "./src/rendering/waves/customWaveform.js":
/*!***********************************************!*\
  !*** ./src/rendering/waves/customWaveform.js ***!
  \***********************************************/
/*! exports provided: default */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "default", function() { return CustomWaveform; });
/* harmony import */ var _utils__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../utils */ "./src/utils.js");
/* harmony import */ var _shaders_shaderUtils__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../shaders/shaderUtils */ "./src/rendering/shaders/shaderUtils.js");
/* harmony import */ var _waveUtils__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./waveUtils */ "./src/rendering/waves/waveUtils.js");
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }





var CustomWaveform =
/*#__PURE__*/
function () {
  function CustomWaveform(index, gl, opts) {
    _classCallCheck(this, CustomWaveform);

    this.index = index;
    this.gl = gl;
    var maxSamples = 512;
    this.pointsData = [new Float32Array(maxSamples), new Float32Array(maxSamples)];
    this.positions = new Float32Array(maxSamples * 3);
    this.colors = new Float32Array(maxSamples * 4);
    this.smoothedPositions = new Float32Array((maxSamples * 2 - 1) * 3);
    this.smoothedColors = new Float32Array((maxSamples * 2 - 1) * 4);
    this.texsizeX = opts.texsizeX;
    this.texsizeY = opts.texsizeY;
    this.mesh_width = opts.mesh_width;
    this.mesh_height = opts.mesh_height;
    this.aspectx = opts.aspectx;
    this.aspecty = opts.aspecty;
    this.invAspectx = 1.0 / this.aspectx;
    this.invAspecty = 1.0 / this.aspecty;
    this.positionVertexBuf = this.gl.createBuffer();
    this.colorVertexBuf = this.gl.createBuffer();
    this.floatPrecision = _shaders_shaderUtils__WEBPACK_IMPORTED_MODULE_1__["default"].getFragmentFloatPrecision(this.gl);
    this.createShader();
  }

  _createClass(CustomWaveform, [{
    key: "updateGlobals",
    value: function updateGlobals(opts) {
      this.texsizeX = opts.texsizeX;
      this.texsizeY = opts.texsizeY;
      this.mesh_width = opts.mesh_width;
      this.mesh_height = opts.mesh_height;
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
      this.gl.shaderSource(vertShader, "#version 300 es\n                                      uniform float uSize;\n                                      uniform vec2 thickOffset;\n                                      in vec3 aPos;\n                                      in vec4 aColor;\n                                      out vec4 vColor;\n                                      void main(void) {\n                                        vColor = aColor;\n                                        gl_PointSize = uSize;\n                                        gl_Position = vec4(aPos + vec3(thickOffset, 0.0), 1.0);\n                                      }");
      this.gl.compileShader(vertShader);
      var fragShader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
      this.gl.shaderSource(fragShader, "#version 300 es\n                                      precision ".concat(this.floatPrecision, " float;\n                                      precision highp int;\n                                      precision mediump sampler2D;\n                                      in vec4 vColor;\n                                      out vec4 fragColor;\n                                      void main(void) {\n                                        fragColor = vColor;\n                                      }"));
      this.gl.compileShader(fragShader);
      this.gl.attachShader(this.shaderProgram, vertShader);
      this.gl.attachShader(this.shaderProgram, fragShader);
      this.gl.linkProgram(this.shaderProgram);
      this.aPosLocation = this.gl.getAttribLocation(this.shaderProgram, 'aPos');
      this.aColorLocation = this.gl.getAttribLocation(this.shaderProgram, 'aColor');
      this.sizeLoc = this.gl.getUniformLocation(this.shaderProgram, 'uSize');
      this.thickOffsetLoc = this.gl.getUniformLocation(this.shaderProgram, 'thickOffset');
    }
  }, {
    key: "generateWaveform",
    value: function generateWaveform(timeArrayL, timeArrayR, freqArrayL, freqArrayR, globalVars, presetEquationRunner, waveEqs, alphaMult) {
      if (waveEqs.baseVals.enabled !== 0 && timeArrayL.length > 0) {
        var mdVSWave = Object.assign({}, presetEquationRunner.mdVSWaves[this.index], presetEquationRunner.mdVSFrameMapWaves[this.index], presetEquationRunner.mdVSQAfterFrame, presetEquationRunner.mdVSTWaveInits[this.index], globalVars);
        var mdVSWaveFrame = waveEqs.frame_eqs(mdVSWave);
        var maxSamples = 512;

        if (Object.prototype.hasOwnProperty.call(mdVSWaveFrame, 'samples')) {
          this.samples = mdVSWaveFrame.samples;
        } else {
          this.samples = maxSamples;
        }

        if (this.samples > maxSamples) {
          this.samples = maxSamples;
        }

        this.samples = Math.floor(this.samples);
        var sep = Math.floor(mdVSWaveFrame.sep);
        var scaling = mdVSWaveFrame.scaling;
        var spectrum = mdVSWaveFrame.spectrum;
        var smoothing = mdVSWaveFrame.smoothing;
        var usedots = mdVSWaveFrame.usedots;
        var frameR = mdVSWaveFrame.r;
        var frameG = mdVSWaveFrame.g;
        var frameB = mdVSWaveFrame.b;
        var frameA = mdVSWaveFrame.a;
        var waveScale = presetEquationRunner.mdVS.wave_scale;
        this.samples -= sep;

        if (this.samples >= 2 || usedots !== 0 && this.samples >= 1) {
          var useSpectrum = spectrum !== 0;
          var scale = (useSpectrum ? 0.15 : 0.004) * scaling * waveScale;
          var pointsLeft = useSpectrum ? freqArrayL : timeArrayL;
          var pointsRight = useSpectrum ? freqArrayR : timeArrayR;
          var j0 = useSpectrum ? 0 : Math.floor((maxSamples - this.samples) / 2 - sep / 2);
          var j1 = useSpectrum ? 0 : Math.floor((maxSamples - this.samples) / 2 + sep / 2);
          var t = useSpectrum ? (maxSamples - sep) / this.samples : 1;
          var mix1 = Math.pow(smoothing * 0.98, 0.5);
          var mix2 = 1 - mix1; // Milkdrop smooths waveform forward, backward and then scales

          this.pointsData[0][0] = pointsLeft[j0];
          this.pointsData[1][0] = pointsRight[j1];

          for (var j = 1; j < this.samples; j++) {
            var left = pointsLeft[Math.floor(j * t + j0)];
            var right = pointsRight[Math.floor(j * t + j1)];
            this.pointsData[0][j] = left * mix2 + this.pointsData[0][j - 1] * mix1;
            this.pointsData[1][j] = right * mix2 + this.pointsData[1][j - 1] * mix1;
          }

          for (var _j = this.samples - 2; _j >= 0; _j--) {
            this.pointsData[0][_j] = this.pointsData[0][_j] * mix2 + this.pointsData[0][_j + 1] * mix1;
            this.pointsData[1][_j] = this.pointsData[1][_j] * mix2 + this.pointsData[1][_j + 1] * mix1;
          }

          for (var _j2 = 0; _j2 < this.samples; _j2++) {
            this.pointsData[0][_j2] *= scale;
            this.pointsData[1][_j2] *= scale;
          }

          for (var _j3 = 0; _j3 < this.samples; _j3++) {
            var value1 = this.pointsData[0][_j3];
            var value2 = this.pointsData[1][_j3];
            mdVSWaveFrame.sample = _j3 / (this.samples - 1);
            mdVSWaveFrame.value1 = value1;
            mdVSWaveFrame.value2 = value2;
            mdVSWaveFrame.x = 0.5 + value1;
            mdVSWaveFrame.y = 0.5 + value2;
            mdVSWaveFrame.r = frameR;
            mdVSWaveFrame.g = frameG;
            mdVSWaveFrame.b = frameB;
            mdVSWaveFrame.a = frameA;

            if (waveEqs.point_eqs !== '') {
              mdVSWaveFrame = waveEqs.point_eqs(mdVSWaveFrame);
            }

            var x = (mdVSWaveFrame.x * 2 - 1) * this.invAspectx;
            var y = (mdVSWaveFrame.y * -2 + 1) * this.invAspecty;
            var r = mdVSWaveFrame.r;
            var g = mdVSWaveFrame.g;
            var b = mdVSWaveFrame.b;
            var a = mdVSWaveFrame.a;
            this.positions[_j3 * 3 + 0] = x;
            this.positions[_j3 * 3 + 1] = y;
            this.positions[_j3 * 3 + 2] = 0;
            this.colors[_j3 * 4 + 0] = r;
            this.colors[_j3 * 4 + 1] = g;
            this.colors[_j3 * 4 + 2] = b;
            this.colors[_j3 * 4 + 3] = a * alphaMult;
          } // this needs to be after per point (check fishbrain - witchcraft)


          var mdvsUserKeysWave = presetEquationRunner.mdVSUserKeysWaves[this.index];
          var mdVSNewFrameMapWave = _utils__WEBPACK_IMPORTED_MODULE_0__["default"].pick(mdVSWaveFrame, mdvsUserKeysWave); // eslint-disable-next-line no-param-reassign

          presetEquationRunner.mdVSFrameMapWaves[this.index] = mdVSNewFrameMapWave;
          this.mdVSWaveFrame = mdVSWaveFrame;

          if (usedots === 0) {
            _waveUtils__WEBPACK_IMPORTED_MODULE_2__["default"].smoothWaveAndColor(this.positions, this.colors, this.smoothedPositions, this.smoothedColors, this.samples);
          }

          return true;
        }
      }

      return false;
    }
  }, {
    key: "drawCustomWaveform",
    value: function drawCustomWaveform(blendProgress, timeArrayL, timeArrayR, freqArrayL, freqArrayR, globalVars, presetEquationRunner, waveEqs) {
      if (waveEqs && this.generateWaveform(timeArrayL, timeArrayR, freqArrayL, freqArrayR, globalVars, presetEquationRunner, waveEqs, blendProgress)) {
        this.gl.useProgram(this.shaderProgram);
        var waveUseDots = this.mdVSWaveFrame.usedots !== 0;
        var waveThick = this.mdVSWaveFrame.thick !== 0;
        var waveAdditive = this.mdVSWaveFrame.additive !== 0;
        var positions;
        var colors;
        var numVerts;

        if (!waveUseDots) {
          positions = this.smoothedPositions;
          colors = this.smoothedColors;
          numVerts = this.samples * 2 - 1;
        } else {
          positions = this.positions;
          colors = this.colors;
          numVerts = this.samples;
        }

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionVertexBuf);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);
        this.gl.vertexAttribPointer(this.aPosLocation, 3, this.gl.FLOAT, false, 0, 0);
        this.gl.enableVertexAttribArray(this.aPosLocation);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.colorVertexBuf);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, colors, this.gl.STATIC_DRAW);
        this.gl.vertexAttribPointer(this.aColorLocation, 4, this.gl.FLOAT, false, 0, 0);
        this.gl.enableVertexAttribArray(this.aColorLocation);
        var instances = 1;

        if (waveUseDots) {
          if (waveThick) {
            this.gl.uniform1f(this.sizeLoc, 2 + (this.texsizeX >= 1024 ? 1 : 0));
          } else {
            this.gl.uniform1f(this.sizeLoc, 1 + (this.texsizeX >= 1024 ? 1 : 0));
          }
        } else {
          this.gl.uniform1f(this.sizeLoc, 1);

          if (waveThick) {
            instances = 4;
          }
        }

        if (waveAdditive) {
          this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);
        } else {
          this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        }

        var drawMode = waveUseDots ? this.gl.POINTS : this.gl.LINE_STRIP; // TODO: use drawArraysInstanced

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

          this.gl.drawArrays(drawMode, 0, numVerts);
        }
      }
    }
  }]);

  return CustomWaveform;
}();



/***/ }),

