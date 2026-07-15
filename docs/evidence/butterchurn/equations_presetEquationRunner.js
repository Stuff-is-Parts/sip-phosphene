/***/ "./src/equations/presetEquationRunner.js":
/*!***********************************************!*\
  !*** ./src/equations/presetEquationRunner.js ***!
  \***********************************************/
/*! exports provided: default */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "default", function() { return PresetEquationRunner; });
/* harmony import */ var _utils__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../utils */ "./src/utils.js");
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }



var PresetEquationRunner =
/*#__PURE__*/
function () {
  function PresetEquationRunner(preset, globalVars, opts) {
    _classCallCheck(this, PresetEquationRunner);

    this.preset = preset;
    this.texsizeX = opts.texsizeX;
    this.texsizeY = opts.texsizeY;
    this.mesh_width = opts.mesh_width;
    this.mesh_height = opts.mesh_height;
    this.aspectx = opts.aspectx;
    this.aspecty = opts.aspecty;
    this.invAspectx = 1.0 / this.aspectx;
    this.invAspecty = 1.0 / this.aspecty;
    this.qs = _utils__WEBPACK_IMPORTED_MODULE_0__["default"].range(1, 33).map(function (x) {
      return "q".concat(x);
    });
    this.ts = _utils__WEBPACK_IMPORTED_MODULE_0__["default"].range(1, 9).map(function (x) {
      return "t".concat(x);
    });
    this.regs = _utils__WEBPACK_IMPORTED_MODULE_0__["default"].range(100).map(function (x) {
      if (x < 10) {
        return "reg0".concat(x);
      }

      return "reg".concat(x);
    });
    this.initializeEquations(globalVars);
  }

  _createClass(PresetEquationRunner, [{
    key: "initializeEquations",
    value: function initializeEquations(globalVars) {
      this.runVertEQs = this.preset.pixel_eqs !== '';
      this.mdVSQInit = null;
      this.mdVSRegs = null;
      this.mdVSFrame = null;
      this.mdVSUserKeys = null;
      this.mdVSFrameMap = null;
      this.mdVSShapes = null;
      this.mdVSUserKeysShapes = null;
      this.mdVSFrameMapShapes = null;
      this.mdVSWaves = null;
      this.mdVSUserKeysWaves = null;
      this.mdVSFrameMapWaves = null;
      this.mdVSQAfterFrame = null;
      this.gmegabuf = new Array(1048576).fill(0);
      var mdVSBase = {
        frame: globalVars.frame,
        time: globalVars.time,
        fps: globalVars.fps,
        bass: globalVars.bass,
        bass_att: globalVars.bass_att,
        mid: globalVars.mid,
        mid_att: globalVars.mid_att,
        treb: globalVars.treb,
        treb_att: globalVars.treb_att,
        meshx: this.mesh_width,
        meshy: this.mesh_height,
        aspectx: this.invAspectx,
        aspecty: this.invAspecty,
        pixelsx: this.texsizeX,
        pixelsy: this.texsizeY,
        gmegabuf: this.gmegabuf
      };
      this.mdVS = Object.assign({}, this.preset.baseVals, mdVSBase);
      this.mdVS.megabuf = new Array(1048576).fill(0);
      this.mdVS.rand_start = new Float32Array([Math.random(), Math.random(), Math.random(), Math.random()]);
      this.mdVS.rand_preset = new Float32Array([Math.random(), Math.random(), Math.random(), Math.random()]);
      var nonUserKeys = this.qs.concat(this.regs, Object.keys(this.mdVS));
      var mdVSAfterInit = this.preset.init_eqs(_utils__WEBPACK_IMPORTED_MODULE_0__["default"].cloneVars(this.mdVS)); // qs need to be initialized to there init values every frame

      this.mdVSQInit = _utils__WEBPACK_IMPORTED_MODULE_0__["default"].pick(mdVSAfterInit, this.qs);
      this.mdVSRegs = _utils__WEBPACK_IMPORTED_MODULE_0__["default"].pick(mdVSAfterInit, this.regs);
      var initUserVars = _utils__WEBPACK_IMPORTED_MODULE_0__["default"].pick(mdVSAfterInit, Object.keys(_utils__WEBPACK_IMPORTED_MODULE_0__["default"].omit(mdVSAfterInit, nonUserKeys)));
      initUserVars.megabuf = mdVSAfterInit.megabuf;
      initUserVars.gmegabuf = mdVSAfterInit.gmegabuf;
      this.mdVSFrame = this.preset.frame_eqs(Object.assign({}, this.mdVS, this.mdVSQInit, this.mdVSRegs, initUserVars)); // user vars need to be copied between frames

      this.mdVSUserKeys = Object.keys(_utils__WEBPACK_IMPORTED_MODULE_0__["default"].omit(this.mdVSFrame, nonUserKeys)); // Determine vars to carry over between frames

      this.mdVSFrameMap = _utils__WEBPACK_IMPORTED_MODULE_0__["default"].pick(this.mdVSFrame, this.mdVSUserKeys); // qs for shapes

      this.mdVSQAfterFrame = _utils__WEBPACK_IMPORTED_MODULE_0__["default"].pick(this.mdVSFrame, this.qs);
      this.mdVSRegs = _utils__WEBPACK_IMPORTED_MODULE_0__["default"].pick(this.mdVSFrame, this.regs);
      this.mdVSWaves = [];
      this.mdVSTWaveInits = [];
      this.mdVSUserKeysWaves = [];
      this.mdVSFrameMapWaves = [];

      if (this.preset.waves && this.preset.waves.length > 0) {
        for (var i = 0; i < this.preset.waves.length; i++) {
          var wave = this.preset.waves[i];
          var baseVals = wave.baseVals;

          if (baseVals.enabled !== 0) {
            var mdVSWave = Object.assign({}, baseVals, mdVSBase);
            var nonUserWaveKeys = this.qs.concat(this.ts, this.regs, Object.keys(mdVSWave));
            Object.assign(mdVSWave, this.mdVSQAfterFrame, this.mdVSRegs);
            mdVSWave.megabuf = new Array(1048576).fill(0);

            if (wave.init_eqs) {
              mdVSWave = wave.init_eqs(mdVSWave);
              this.mdVSRegs = _utils__WEBPACK_IMPORTED_MODULE_0__["default"].pick(mdVSWave, this.regs); // base vals need to be reset

              Object.assign(mdVSWave, baseVals);
            }

            this.mdVSWaves.push(mdVSWave);
            this.mdVSTWaveInits.push(_utils__WEBPACK_IMPORTED_MODULE_0__["default"].pick(mdVSWave, this.ts));
            this.mdVSUserKeysWaves.push(Object.keys(_utils__WEBPACK_IMPORTED_MODULE_0__["default"].omit(mdVSWave, nonUserWaveKeys)));
            this.mdVSFrameMapWaves.push(_utils__WEBPACK_IMPORTED_MODULE_0__["default"].pick(mdVSWave, this.mdVSUserKeysWaves[i]));
          } else {
            this.mdVSWaves.push({});
            this.mdVSTWaveInits.push({});
            this.mdVSUserKeysWaves.push([]);
            this.mdVSFrameMapWaves.push({});
          }
        }
      }

      this.mdVSShapes = [];
      this.mdVSTShapeInits = [];
      this.mdVSUserKeysShapes = [];
      this.mdVSFrameMapShapes = [];

      if (this.preset.shapes && this.preset.shapes.length > 0) {
        for (var _i = 0; _i < this.preset.shapes.length; _i++) {
          var shape = this.preset.shapes[_i];
          var _baseVals = shape.baseVals;

          if (_baseVals.enabled !== 0) {
            var mdVSShape = Object.assign({}, _baseVals, mdVSBase);
            var nonUserShapeKeys = this.qs.concat(this.ts, this.regs, Object.keys(mdVSShape));
            Object.assign(mdVSShape, this.mdVSQAfterFrame, this.mdVSRegs);
            mdVSShape.megabuf = new Array(1048576).fill(0);

            if (shape.init_eqs) {
              mdVSShape = shape.init_eqs(mdVSShape);
              this.mdVSRegs = _utils__WEBPACK_IMPORTED_MODULE_0__["default"].pick(mdVSShape, this.regs); // base vals need to be reset

              Object.assign(mdVSShape, _baseVals);
            }

            this.mdVSShapes.push(mdVSShape);
            this.mdVSTShapeInits.push(_utils__WEBPACK_IMPORTED_MODULE_0__["default"].pick(mdVSShape, this.ts));
            this.mdVSUserKeysShapes.push(Object.keys(_utils__WEBPACK_IMPORTED_MODULE_0__["default"].omit(mdVSShape, nonUserShapeKeys)));
            this.mdVSFrameMapShapes.push(_utils__WEBPACK_IMPORTED_MODULE_0__["default"].pick(mdVSShape, this.mdVSUserKeysShapes[_i]));
          } else {
            this.mdVSShapes.push({});
            this.mdVSTShapeInits.push({});
            this.mdVSUserKeysShapes.push([]);
            this.mdVSFrameMapShapes.push({});
          }
        }
      }
    }
  }, {
    key: "updatePreset",
    value: function updatePreset(preset, globalVars) {
      this.preset = preset;
      this.initializeEquations(globalVars);
    }
  }, {
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
    key: "runFrameEquations",
    value: function runFrameEquations(globalVars) {
      this.mdVSFrame = Object.assign({}, this.mdVS, this.mdVSQInit, this.mdVSFrameMap, globalVars);
      this.mdVSFrame = this.preset.frame_eqs(this.mdVSFrame);
      this.mdVSFrameMap = _utils__WEBPACK_IMPORTED_MODULE_0__["default"].pick(this.mdVSFrame, this.mdVSUserKeys);
      this.mdVSQAfterFrame = _utils__WEBPACK_IMPORTED_MODULE_0__["default"].pick(this.mdVSFrame, this.qs);
    }
  }]);

  return PresetEquationRunner;
}();



/***/ }),

