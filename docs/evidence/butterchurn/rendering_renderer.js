/***/ "./src/rendering/renderer.js":
/*!***********************************!*\
  !*** ./src/rendering/renderer.js ***!
  \***********************************/
/*! exports provided: default */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "default", function() { return Renderer; });
/* harmony import */ var _audio_audioLevels__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../audio/audioLevels */ "./src/audio/audioLevels.js");
/* harmony import */ var _blankPreset__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../blankPreset */ "./src/blankPreset.js");
/* harmony import */ var _blankPreset__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_blankPreset__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _equations_presetEquationRunner__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../equations/presetEquationRunner */ "./src/equations/presetEquationRunner.js");
/* harmony import */ var _waves_basicWaveform__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./waves/basicWaveform */ "./src/rendering/waves/basicWaveform.js");
/* harmony import */ var _waves_customWaveform__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./waves/customWaveform */ "./src/rendering/waves/customWaveform.js");
/* harmony import */ var _shapes_customShape__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./shapes/customShape */ "./src/rendering/shapes/customShape.js");
/* harmony import */ var _sprites_border__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./sprites/border */ "./src/rendering/sprites/border.js");
/* harmony import */ var _sprites_darkenCenter__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./sprites/darkenCenter */ "./src/rendering/sprites/darkenCenter.js");
/* harmony import */ var _motionVectors_motionVectors__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./motionVectors/motionVectors */ "./src/rendering/motionVectors/motionVectors.js");
/* harmony import */ var _shaders_warp__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ./shaders/warp */ "./src/rendering/shaders/warp.js");
/* harmony import */ var _shaders_comp__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! ./shaders/comp */ "./src/rendering/shaders/comp.js");
/* harmony import */ var _shaders_output__WEBPACK_IMPORTED_MODULE_11__ = __webpack_require__(/*! ./shaders/output */ "./src/rendering/shaders/output.js");
/* harmony import */ var _shaders_resample__WEBPACK_IMPORTED_MODULE_12__ = __webpack_require__(/*! ./shaders/resample */ "./src/rendering/shaders/resample.js");
/* harmony import */ var _shaders_blur_blur__WEBPACK_IMPORTED_MODULE_13__ = __webpack_require__(/*! ./shaders/blur/blur */ "./src/rendering/shaders/blur/blur.js");
/* harmony import */ var _noise_noise__WEBPACK_IMPORTED_MODULE_14__ = __webpack_require__(/*! ../noise/noise */ "./src/noise/noise.js");
/* harmony import */ var _image_imageTextures__WEBPACK_IMPORTED_MODULE_15__ = __webpack_require__(/*! ../image/imageTextures */ "./src/image/imageTextures.js");
/* harmony import */ var _text_titleText__WEBPACK_IMPORTED_MODULE_16__ = __webpack_require__(/*! ./text/titleText */ "./src/rendering/text/titleText.js");
/* harmony import */ var _blendPattern__WEBPACK_IMPORTED_MODULE_17__ = __webpack_require__(/*! ./blendPattern */ "./src/rendering/blendPattern.js");
/* harmony import */ var _utils__WEBPACK_IMPORTED_MODULE_18__ = __webpack_require__(/*! ../utils */ "./src/utils.js");
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }





















var Renderer =
/*#__PURE__*/
function () {
  function Renderer(gl, audio, opts) {
    _classCallCheck(this, Renderer);

    this.gl = gl;
    this.audio = audio;
    this.frameNum = 0;
    this.fps = 30;
    this.time = 0;
    this.presetTime = 0;
    this.lastTime = performance.now();
    this.timeHist = [0];
    this.timeHistMax = 120;
    this.blending = false;
    this.blendStartTime = 0;
    this.blendProgress = 0;
    this.blendDuration = 0;
    this.width = opts.width || 1200;
    this.height = opts.height || 900;
    this.mesh_width = opts.meshWidth || 48;
    this.mesh_height = opts.meshHeight || 36;
    this.pixelRatio = opts.pixelRatio || window.devicePixelRatio || 1;
    this.textureRatio = opts.textureRatio || 1;
    this.outputFXAA = opts.outputFXAA || false;
    this.texsizeX = this.width * this.pixelRatio * this.textureRatio;
    this.texsizeY = this.height * this.pixelRatio * this.textureRatio;
    this.aspectx = this.texsizeY > this.texsizeX ? this.texsizeX / this.texsizeY : 1;
    this.aspecty = this.texsizeX > this.texsizeY ? this.texsizeY / this.texsizeX : 1;
    this.invAspectx = 1.0 / this.aspectx;
    this.invAspecty = 1.0 / this.aspecty;
    this.qs = _utils__WEBPACK_IMPORTED_MODULE_18__["default"].range(1, 33).map(function (x) {
      return "q".concat(x);
    });
    this.ts = _utils__WEBPACK_IMPORTED_MODULE_18__["default"].range(1, 9).map(function (x) {
      return "t".concat(x);
    });
    this.regs = _utils__WEBPACK_IMPORTED_MODULE_18__["default"].range(0, 100).map(function (x) {
      if (x < 10) {
        return "reg0".concat(x);
      }

      return "reg".concat(x);
    });
    this.blurRatios = [[0.5, 0.25], [0.125, 0.125], [0.0625, 0.0625]];
    this.audioLevels = new _audio_audioLevels__WEBPACK_IMPORTED_MODULE_0__["default"](this.audio);
    this.prevFrameBuffer = this.gl.createFramebuffer();
    this.targetFrameBuffer = this.gl.createFramebuffer();
    this.prevTexture = this.gl.createTexture();
    this.targetTexture = this.gl.createTexture();
    this.compFrameBuffer = this.gl.createFramebuffer();
    this.compTexture = this.gl.createTexture();
    this.anisoExt = this.gl.getExtension('EXT_texture_filter_anisotropic') || this.gl.getExtension('MOZ_EXT_texture_filter_anisotropic') || this.gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    this.bindFrameBufferTexture(this.prevFrameBuffer, this.prevTexture);
    this.bindFrameBufferTexture(this.targetFrameBuffer, this.targetTexture);
    this.bindFrameBufferTexture(this.compFrameBuffer, this.compTexture);
    var params = {
      pixelRatio: this.pixelRatio,
      textureRatio: this.textureRatio,
      texsizeX: this.texsizeX,
      texsizeY: this.texsizeY,
      mesh_width: this.mesh_width,
      mesh_height: this.mesh_height,
      aspectx: this.aspectx,
      aspecty: this.aspecty
    };
    this.noise = new _noise_noise__WEBPACK_IMPORTED_MODULE_14__["default"](gl);
    this.image = new _image_imageTextures__WEBPACK_IMPORTED_MODULE_15__["default"](gl);
    this.warpShader = new _shaders_warp__WEBPACK_IMPORTED_MODULE_9__["default"](gl, this.noise, this.image, params);
    this.compShader = new _shaders_comp__WEBPACK_IMPORTED_MODULE_10__["default"](gl, this.noise, this.image, params);
    this.outputShader = new _shaders_output__WEBPACK_IMPORTED_MODULE_11__["default"](gl, params);
    this.prevWarpShader = new _shaders_warp__WEBPACK_IMPORTED_MODULE_9__["default"](gl, this.noise, this.image, params);
    this.prevCompShader = new _shaders_comp__WEBPACK_IMPORTED_MODULE_10__["default"](gl, this.noise, this.image, params);
    this.numBlurPasses = 0;
    this.blurShader1 = new _shaders_blur_blur__WEBPACK_IMPORTED_MODULE_13__["default"](0, this.blurRatios, gl, params);
    this.blurShader2 = new _shaders_blur_blur__WEBPACK_IMPORTED_MODULE_13__["default"](1, this.blurRatios, gl, params);
    this.blurShader3 = new _shaders_blur_blur__WEBPACK_IMPORTED_MODULE_13__["default"](2, this.blurRatios, gl, params);
    this.blurTexture1 = this.blurShader1.blurVerticalTexture;
    this.blurTexture2 = this.blurShader2.blurVerticalTexture;
    this.blurTexture3 = this.blurShader3.blurVerticalTexture;
    this.basicWaveform = new _waves_basicWaveform__WEBPACK_IMPORTED_MODULE_3__["default"](gl, params);
    this.customWaveforms = _utils__WEBPACK_IMPORTED_MODULE_18__["default"].range(4).map(function (i) {
      return new _waves_customWaveform__WEBPACK_IMPORTED_MODULE_4__["default"](i, gl, params);
    });
    this.customShapes = _utils__WEBPACK_IMPORTED_MODULE_18__["default"].range(4).map(function (i) {
      return new _shapes_customShape__WEBPACK_IMPORTED_MODULE_5__["default"](i, gl, params);
    });
    this.prevCustomWaveforms = _utils__WEBPACK_IMPORTED_MODULE_18__["default"].range(4).map(function (i) {
      return new _waves_customWaveform__WEBPACK_IMPORTED_MODULE_4__["default"](i, gl, params);
    });
    this.prevCustomShapes = _utils__WEBPACK_IMPORTED_MODULE_18__["default"].range(4).map(function (i) {
      return new _shapes_customShape__WEBPACK_IMPORTED_MODULE_5__["default"](i, gl, params);
    });
    this.darkenCenter = new _sprites_darkenCenter__WEBPACK_IMPORTED_MODULE_7__["default"](gl, params);
    this.innerBorder = new _sprites_border__WEBPACK_IMPORTED_MODULE_6__["default"](gl, params);
    this.outerBorder = new _sprites_border__WEBPACK_IMPORTED_MODULE_6__["default"](gl, params);
    this.motionVectors = new _motionVectors_motionVectors__WEBPACK_IMPORTED_MODULE_8__["default"](gl, params);
    this.titleText = new _text_titleText__WEBPACK_IMPORTED_MODULE_16__["default"](gl, params);
    this.blendPattern = new _blendPattern__WEBPACK_IMPORTED_MODULE_17__["default"](params);
    this.resampleShader = new _shaders_resample__WEBPACK_IMPORTED_MODULE_12__["default"](gl);
    this.supertext = {
      startTime: -1
    };
    this.warpUVs = new Float32Array((this.mesh_width + 1) * (this.mesh_height + 1) * 2);
    this.warpColor = new Float32Array((this.mesh_width + 1) * (this.mesh_height + 1) * 4);
    this.gl.clearColor(0, 0, 0, 1);
    this.blankPreset = _blankPreset__WEBPACK_IMPORTED_MODULE_1___default.a;
    var globalVars = {
      frame: 0,
      time: 0,
      fps: 45,
      bass: 1,
      bass_att: 1,
      mid: 1,
      mid_att: 1,
      treb: 1,
      treb_att: 1
    };
    this.preset = _blankPreset__WEBPACK_IMPORTED_MODULE_1___default.a;
    this.prevPreset = this.preset;
    this.presetEquationRunner = new _equations_presetEquationRunner__WEBPACK_IMPORTED_MODULE_2__["default"](this.preset, globalVars, params);
    this.prevPresetEquationRunner = new _equations_presetEquationRunner__WEBPACK_IMPORTED_MODULE_2__["default"](this.prevPreset, globalVars, params);
    this.regVars = this.presetEquationRunner.mdVSRegs;
  }

  _createClass(Renderer, [{
    key: "loadPreset",
    value: function loadPreset(preset, blendTime) {
      this.blendPattern.createBlendPattern();
      this.blending = true;
      this.blendStartTime = this.time;
      this.blendDuration = blendTime;
      this.blendProgress = 0;
      this.prevPresetEquationRunner = this.presetEquationRunner;
      this.prevPreset = this.preset;
      this.preset = preset;
      this.preset.baseVals.old_wave_mode = this.prevPreset.baseVals.wave_mode;
      this.presetTime = this.time;
      var globalVars = {
        frame: this.frameNum,
        time: this.time,
        fps: this.fps,
        bass: this.audioLevels.bass,
        bass_att: this.audioLevels.bass_att,
        mid: this.audioLevels.mid,
        mid_att: this.audioLevels.mid_att,
        treb: this.audioLevels.treb,
        treb_att: this.audioLevels.treb_att
      };
      var params = {
        pixelRatio: this.pixelRatio,
        textureRatio: this.textureRatio,
        texsizeX: this.texsizeX,
        texsizeY: this.texsizeY,
        mesh_width: this.mesh_width,
        mesh_height: this.mesh_height,
        aspectx: this.aspectx,
        aspecty: this.aspecty
      };
      this.presetEquationRunner = new _equations_presetEquationRunner__WEBPACK_IMPORTED_MODULE_2__["default"](this.preset, globalVars, params);
      this.regVars = this.presetEquationRunner.mdVSRegs;
      var tmpWarpShader = this.prevWarpShader;
      this.prevWarpShader = this.warpShader;
      this.warpShader = tmpWarpShader;
      var tmpCompShader = this.prevCompShader;
      this.prevCompShader = this.compShader;
      this.compShader = tmpCompShader;
      var warpText = this.preset.warp.trim();
      var compText = this.preset.comp.trim();
      this.warpShader.updateShader(warpText);
      this.compShader.updateShader(compText);

      if (warpText.length === 0) {
        this.numBlurPasses = 0;
      } else {
        this.numBlurPasses = Renderer.getHighestBlur(warpText);
      }

      if (compText.length !== 0) {
        this.numBlurPasses = Math.max(this.numBlurPasses, Renderer.getHighestBlur(compText));
      }
    }
  }, {
    key: "loadExtraImages",
    value: function loadExtraImages(imageData) {
      this.image.loadExtraImages(imageData);
    }
  }, {
    key: "setRendererSize",
    value: function setRendererSize(width, height, opts) {
      var oldTexsizeX = this.texsizeX;
      var oldTexsizeY = this.texsizeY;
      this.width = width;
      this.height = height;
      this.mesh_width = opts.meshWidth || this.mesh_width;
      this.mesh_height = opts.meshHeight || this.mesh_height;
      this.pixelRatio = opts.pixelRatio || this.pixelRatio;
      this.textureRatio = opts.textureRatio || this.textureRatio;
      this.texsizeX = width * this.pixelRatio * this.textureRatio;
      this.texsizeY = height * this.pixelRatio * this.textureRatio;
      this.aspectx = this.texsizeY > this.texsizeX ? this.texsizeX / this.texsizeY : 1;
      this.aspecty = this.texsizeX > this.texsizeY ? this.texsizeY / this.texsizeX : 1;

      if (this.texsizeX !== oldTexsizeX || this.texsizeY !== oldTexsizeY) {
        // copy target texture, because we flip prev/target at start of render
        var targetTextureNew = this.gl.createTexture();
        this.bindFrameBufferTexture(this.targetFrameBuffer, targetTextureNew);
        this.bindFrambufferAndSetViewport(this.targetFrameBuffer, this.texsizeX, this.texsizeY);
        this.resampleShader.renderQuadTexture(this.targetTexture);
        this.targetTexture = targetTextureNew;
        this.bindFrameBufferTexture(this.prevFrameBuffer, this.prevTexture);
        this.bindFrameBufferTexture(this.compFrameBuffer, this.compTexture);
      }

      this.updateGlobals(); // rerender current frame at new size

      if (this.frameNum > 0) {
        this.renderToScreen();
      }
    }
  }, {
    key: "setInternalMeshSize",
    value: function setInternalMeshSize(width, height) {
      this.mesh_width = width;
      this.mesh_height = height;
      this.updateGlobals();
    }
  }, {
    key: "setOutputAA",
    value: function setOutputAA(useAA) {
      this.outputFXAA = useAA;
    }
  }, {
    key: "updateGlobals",
    value: function updateGlobals() {
      var params = {
        pixelRatio: this.pixelRatio,
        textureRatio: this.textureRatio,
        texsizeX: this.texsizeX,
        texsizeY: this.texsizeY,
        mesh_width: this.mesh_width,
        mesh_height: this.mesh_height,
        aspectx: this.aspectx,
        aspecty: this.aspecty
      };
      this.presetEquationRunner.updateGlobals(params);
      this.prevPresetEquationRunner.updateGlobals(params);
      this.warpShader.updateGlobals(params);
      this.prevWarpShader.updateGlobals(params);
      this.compShader.updateGlobals(params);
      this.prevCompShader.updateGlobals(params);
      this.outputShader.updateGlobals(params);
      this.blurShader1.updateGlobals(params);
      this.blurShader2.updateGlobals(params);
      this.blurShader3.updateGlobals(params);
      this.basicWaveform.updateGlobals(params);
      this.customWaveforms.forEach(function (wave) {
        return wave.updateGlobals(params);
      });
      this.customShapes.forEach(function (shape) {
        return shape.updateGlobals(params);
      });
      this.prevCustomWaveforms.forEach(function (wave) {
        return wave.updateGlobals(params);
      });
      this.prevCustomShapes.forEach(function (shape) {
        return shape.updateGlobals(params);
      });
      this.darkenCenter.updateGlobals(params);
      this.innerBorder.updateGlobals(params);
      this.outerBorder.updateGlobals(params);
      this.motionVectors.updateGlobals(params);
      this.titleText.updateGlobals(params);
      this.blendPattern.updateGlobals(params);
      this.warpUVs = new Float32Array((this.mesh_width + 1) * (this.mesh_height + 1) * 2);
      this.warpColor = new Float32Array((this.mesh_width + 1) * (this.mesh_height + 1) * 4);
    }
  }, {
    key: "calcTimeAndFPS",
    value: function calcTimeAndFPS(elapsedTime) {
      var elapsed;

      if (elapsedTime) {
        elapsed = elapsedTime;
      } else {
        var newTime = performance.now();
        elapsed = (newTime - this.lastTime) / 1000.0;

        if (elapsed > 1.0 || elapsed < 0.0 || this.frame < 2) {
          elapsed = 1.0 / 30.0;
        }

        this.lastTime = newTime;
      }

      this.time += 1.0 / this.fps;

      if (this.blending) {
        this.blendProgress = (this.time - this.blendStartTime) / this.blendDuration;

        if (this.blendProgress > 1.0) {
          this.blending = false;
        }
      }

      var newHistTime = this.timeHist[this.timeHist.length - 1] + elapsed;
      this.timeHist.push(newHistTime);

      if (this.timeHist.length > this.timeHistMax) {
        this.timeHist.shift();
      }

      var newFPS = this.timeHist.length / (newHistTime - this.timeHist[0]);

      if (Math.abs(newFPS - this.fps) > 3.0 && this.frame > this.timeHistMax) {
        this.fps = newFPS;
      } else {
        var damping = 0.93;
        this.fps = damping * this.fps + (1.0 - damping) * newFPS;
      }
    }
  }, {
    key: "runPixelEquations",
    value: function runPixelEquations(preset, mdVSFrame, runVertEQs, blending) {
      var gridX = this.mesh_width;
      var gridZ = this.mesh_height;
      var gridX1 = gridX + 1;
      var gridZ1 = gridZ + 1;
      var warpTimeV = this.time * mdVSFrame.warpanimspeed;
      var warpScaleInv = 1.0 / mdVSFrame.warpscale;
      var warpf0 = 11.68 + 4.0 * Math.cos(warpTimeV * 1.413 + 10);
      var warpf1 = 8.77 + 3.0 * Math.cos(warpTimeV * 1.113 + 7);
      var warpf2 = 10.54 + 3.0 * Math.cos(warpTimeV * 1.233 + 3);
      var warpf3 = 11.49 + 4.0 * Math.cos(warpTimeV * 0.933 + 5);
      var texelOffsetX = 0.0 / this.texsizeX;
      var texelOffsetY = 0.0 / this.texsizeY;
      var aspectx = this.aspectx;
      var aspecty = this.aspecty;
      var mdVSVertex = _utils__WEBPACK_IMPORTED_MODULE_18__["default"].cloneVars(mdVSFrame);
      var offset = 0;
      var offsetColor = 0;

      for (var iz = 0; iz < gridZ1; iz++) {
        for (var ix = 0; ix < gridX1; ix++) {
          var x = ix / gridX * 2.0 - 1.0;
          var y = iz / gridZ * 2.0 - 1.0;
          var rad = Math.sqrt(x * x * aspectx * aspectx + y * y * aspecty * aspecty);

          if (runVertEQs) {
            var ang = void 0;

            if (iz === gridZ / 2 && ix === gridX / 2) {
              ang = 0;
            } else {
              ang = _utils__WEBPACK_IMPORTED_MODULE_18__["default"].atan2(y * aspecty, x * aspectx);
            }

            mdVSVertex.x = x * 0.5 * aspectx + 0.5;
            mdVSVertex.y = y * -0.5 * aspecty + 0.5;
            mdVSVertex.rad = rad;
            mdVSVertex.ang = ang;
            mdVSVertex.zoom = mdVSFrame.zoom;
            mdVSVertex.zoomexp = mdVSFrame.zoomexp;
            mdVSVertex.rot = mdVSFrame.rot;
            mdVSVertex.warp = mdVSFrame.warp;
            mdVSVertex.cx = mdVSFrame.cx;
            mdVSVertex.cy = mdVSFrame.cy;
            mdVSVertex.dx = mdVSFrame.dx;
            mdVSVertex.dy = mdVSFrame.dy;
            mdVSVertex.sx = mdVSFrame.sx;
            mdVSVertex.sy = mdVSFrame.sy;
            mdVSVertex = preset.pixel_eqs(mdVSVertex);
          }

          var warp = mdVSVertex.warp;
          var zoom = mdVSVertex.zoom;
          var zoomExp = mdVSVertex.zoomexp;
          var cx = mdVSVertex.cx;
          var cy = mdVSVertex.cy;
          var sx = mdVSVertex.sx;
          var sy = mdVSVertex.sy;
          var dx = mdVSVertex.dx;
          var dy = mdVSVertex.dy;
          var rot = mdVSVertex.rot;
          var zoom2V = Math.pow(zoom, Math.pow(zoomExp, rad * 2.0 - 1.0));
          var zoom2Inv = 1.0 / zoom2V;
          var u = x * 0.5 * aspectx * zoom2Inv + 0.5;
          var v = -y * 0.5 * aspecty * zoom2Inv + 0.5;
          u = (u - cx) / sx + cx;
          v = (v - cy) / sy + cy;

          if (warp !== 0) {
            u += warp * 0.0035 * Math.sin(warpTimeV * 0.333 + warpScaleInv * (x * warpf0 - y * warpf3));
            v += warp * 0.0035 * Math.cos(warpTimeV * 0.375 - warpScaleInv * (x * warpf2 + y * warpf1));
            u += warp * 0.0035 * Math.cos(warpTimeV * 0.753 - warpScaleInv * (x * warpf1 - y * warpf2));
            v += warp * 0.0035 * Math.sin(warpTimeV * 0.825 + warpScaleInv * (x * warpf0 + y * warpf3));
          }

          var u2 = u - cx;
          var v2 = v - cy;
          var cosRot = Math.cos(rot);
          var sinRot = Math.sin(rot);
          u = u2 * cosRot - v2 * sinRot + cx;
          v = u2 * sinRot + v2 * cosRot + cy;
          u -= dx;
          v -= dy;
          u = (u - 0.5) / aspectx + 0.5;
          v = (v - 0.5) / aspecty + 0.5;
          u += texelOffsetX;
          v += texelOffsetY;

          if (!blending) {
            this.warpUVs[offset] = u;
            this.warpUVs[offset + 1] = v;
            this.warpColor[offsetColor + 0] = 1;
            this.warpColor[offsetColor + 1] = 1;
            this.warpColor[offsetColor + 2] = 1;
            this.warpColor[offsetColor + 3] = 1;
          } else {
            var mix2 = this.blendPattern.vertInfoA[offset / 2] * this.blendProgress + this.blendPattern.vertInfoC[offset / 2];
            mix2 = Math.clamp(mix2, 0, 1);
            this.warpUVs[offset] = this.warpUVs[offset] * mix2 + u * (1 - mix2);
            this.warpUVs[offset + 1] = this.warpUVs[offset + 1] * mix2 + v * (1 - mix2);
            this.warpColor[offsetColor + 0] = 1;
            this.warpColor[offsetColor + 1] = 1;
            this.warpColor[offsetColor + 2] = 1;
            this.warpColor[offsetColor + 3] = mix2;
          }

          offset += 2;
          offsetColor += 4;
        }
      }

      this.mdVSVertex = mdVSVertex;
    }
  }, {
    key: "bindFrambufferAndSetViewport",
    value: function bindFrambufferAndSetViewport(fb, width, height) {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fb);
      this.gl.viewport(0, 0, width, height);
    }
  }, {
    key: "bindFrameBufferTexture",
    value: function bindFrameBufferTexture(targetFrameBuffer, targetTexture) {
      this.gl.bindTexture(this.gl.TEXTURE_2D, targetTexture);
      this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.texsizeX, this.texsizeY, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, new Uint8Array(this.texsizeX * this.texsizeY * 4));
      this.gl.generateMipmap(this.gl.TEXTURE_2D);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR_MIPMAP_LINEAR);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

      if (this.anisoExt) {
        var max = this.gl.getParameter(this.anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
        this.gl.texParameterf(this.gl.TEXTURE_2D, this.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, max);
      }

      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, targetFrameBuffer);
      this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, targetTexture, 0);
    }
  }, {
    key: "render",
    value: function render() {
      var _this = this;

      var _ref = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
          audioLevels = _ref.audioLevels,
          elapsedTime = _ref.elapsedTime;

      this.calcTimeAndFPS(elapsedTime);
      this.frameNum += 1;

      if (audioLevels) {
        this.audio.updateAudio(audioLevels.timeByteArray, audioLevels.timeByteArrayL, audioLevels.timeByteArrayR);
      } else {
        this.audio.sampleAudio();
      }

      this.audioLevels.updateAudioLevels(this.fps, this.frameNum);
      var globalVars = {
        frame: this.frameNum,
        time: this.time,
        fps: this.fps,
        bass: this.audioLevels.bass,
        bass_att: this.audioLevels.bass_att,
        mid: this.audioLevels.mid,
        mid_att: this.audioLevels.mid_att,
        treb: this.audioLevels.treb,
        treb_att: this.audioLevels.treb_att,
        meshx: this.mesh_width,
        meshy: this.mesh_height,
        aspectx: this.invAspectx,
        aspecty: this.invAspecty,
        pixelsx: this.texsizeX,
        pixelsy: this.texsizeY
      };
      var prevGlobalVars = Object.assign({}, globalVars);
      prevGlobalVars.gmegabuf = this.prevPresetEquationRunner.gmegabuf;
      globalVars.gmegabuf = this.presetEquationRunner.gmegabuf;
      Object.assign(globalVars, this.regVars);
      this.presetEquationRunner.runFrameEquations(globalVars);
      var mdVSFrame = this.presetEquationRunner.mdVSFrame;
      this.runPixelEquations(this.presetEquationRunner.preset, mdVSFrame, this.presetEquationRunner.runVertEQs, false);
      Object.assign(this.regVars, _utils__WEBPACK_IMPORTED_MODULE_18__["default"].pick(this.mdVSVertex, this.regs));
      Object.assign(globalVars, this.regVars);
      var mdVSFrameMixed;

      if (this.blending) {
        this.prevPresetEquationRunner.runFrameEquations(prevGlobalVars);
        this.runPixelEquations(this.prevPresetEquationRunner.preset, this.prevPresetEquationRunner.mdVSFrame, this.prevPresetEquationRunner.runVertEQs, true);
        mdVSFrameMixed = Renderer.mixFrameEquations(this.blendProgress, mdVSFrame, this.prevPresetEquationRunner.mdVSFrame);
      } else {
        mdVSFrameMixed = mdVSFrame;
      }

      var swapTexture = this.targetTexture;
      this.targetTexture = this.prevTexture;
      this.prevTexture = swapTexture;
      var swapFrameBuffer = this.targetFrameBuffer;
      this.targetFrameBuffer = this.prevFrameBuffer;
      this.prevFrameBuffer = swapFrameBuffer;
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.prevTexture);
      this.gl.generateMipmap(this.gl.TEXTURE_2D);
      this.bindFrambufferAndSetViewport(this.targetFrameBuffer, this.texsizeX, this.texsizeY);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      this.gl.enable(this.gl.BLEND);
      this.gl.blendEquation(this.gl.FUNC_ADD);
      this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

      var _Renderer$getBlurValu = Renderer.getBlurValues(mdVSFrameMixed),
          blurMins = _Renderer$getBlurValu.blurMins,
          blurMaxs = _Renderer$getBlurValu.blurMaxs;

      if (!this.blending) {
        this.warpShader.renderQuadTexture(false, this.prevTexture, this.blurTexture1, this.blurTexture2, this.blurTexture3, blurMins, blurMaxs, mdVSFrame, this.warpUVs, this.warpColor);
      } else {
        this.prevWarpShader.renderQuadTexture(false, this.prevTexture, this.blurTexture1, this.blurTexture2, this.blurTexture3, blurMins, blurMaxs, this.prevPresetEquationRunner.mdVSFrame, this.warpUVs, this.warpColor);
        this.warpShader.renderQuadTexture(true, this.prevTexture, this.blurTexture1, this.blurTexture2, this.blurTexture3, blurMins, blurMaxs, mdVSFrameMixed, this.warpUVs, this.warpColor);
      }

      if (this.numBlurPasses > 0) {
        this.blurShader1.renderBlurTexture(this.targetTexture, mdVSFrame, blurMins, blurMaxs);

        if (this.numBlurPasses > 1) {
          this.blurShader2.renderBlurTexture(this.blurTexture1, mdVSFrame, blurMins, blurMaxs);

          if (this.numBlurPasses > 2) {
            this.blurShader3.renderBlurTexture(this.blurTexture2, mdVSFrame, blurMins, blurMaxs);
          }
        } // rebind target texture framebuffer


        this.bindFrambufferAndSetViewport(this.targetFrameBuffer, this.texsizeX, this.texsizeY);
      }

      this.motionVectors.drawMotionVectors(mdVSFrameMixed, this.warpUVs);

      if (this.preset.shapes && this.preset.shapes.length > 0) {
        this.customShapes.forEach(function (shape, i) {
          shape.drawCustomShape(_this.blending ? _this.blendProgress : 1, globalVars, _this.presetEquationRunner, _this.preset.shapes[i], _this.prevTexture);
        });
      }

      if (this.preset.waves && this.preset.waves.length > 0) {
        this.customWaveforms.forEach(function (waveform, i) {
          waveform.drawCustomWaveform(_this.blending ? _this.blendProgress : 1, _this.audio.timeArrayL, _this.audio.timeArrayR, _this.audio.freqArrayL, _this.audio.freqArrayR, globalVars, _this.presetEquationRunner, _this.preset.waves[i]);
        });
      }

      if (this.blending) {
        if (this.prevPreset.shapes && this.prevPreset.shapes.length > 0) {
          this.prevCustomShapes.forEach(function (shape, i) {
            shape.drawCustomShape(1.0 - _this.blendProgress, prevGlobalVars, _this.prevPresetEquationRunner, _this.prevPreset.shapes[i], _this.prevTexture);
          });
        }

        if (this.prevPreset.waves && this.prevPreset.waves.length > 0) {
          this.prevCustomWaveforms.forEach(function (waveform, i) {
            waveform.drawCustomWaveform(1.0 - _this.blendProgress, _this.audio.timeArrayL, _this.audio.timeArrayR, _this.audio.freqArrayL, _this.audio.freqArrayR, prevGlobalVars, _this.prevPresetEquationRunner, _this.prevPreset.waves[i]);
          });
        }
      }

      this.basicWaveform.drawBasicWaveform(this.blending, this.blendProgress, this.audio.timeArrayL, this.audio.timeArrayR, mdVSFrameMixed);
      this.darkenCenter.drawDarkenCenter(mdVSFrameMixed);
      var outerColor = [mdVSFrameMixed.ob_r, mdVSFrameMixed.ob_g, mdVSFrameMixed.ob_b, mdVSFrameMixed.ob_a];
      this.outerBorder.drawBorder(outerColor, mdVSFrameMixed.ob_size, 0);
      var innerColor = [mdVSFrameMixed.ib_r, mdVSFrameMixed.ib_g, mdVSFrameMixed.ib_b, mdVSFrameMixed.ib_a];
      this.innerBorder.drawBorder(innerColor, mdVSFrameMixed.ib_size, mdVSFrameMixed.ob_size);

      if (this.supertext.startTime >= 0) {
        var progress = (this.time - this.supertext.startTime) / this.supertext.duration;

        if (progress >= 1) {
          this.titleText.renderTitle(progress, true, globalVars);
        }
      } // Store variables in case we need to rerender


      this.globalVars = globalVars;
      this.mdVSFrame = mdVSFrame;
      this.mdVSFrameMixed = mdVSFrameMixed;
      this.renderToScreen();
    }
  }, {
    key: "renderToScreen",
    value: function renderToScreen() {
      if (this.outputFXAA) {
        this.bindFrambufferAndSetViewport(this.compFrameBuffer, this.texsizeX, this.texsizeY);
      } else {
        this.bindFrambufferAndSetViewport(null, this.width, this.height);
      }

      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      this.gl.enable(this.gl.BLEND);
      this.gl.blendEquation(this.gl.FUNC_ADD);
      this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

      var _Renderer$getBlurValu2 = Renderer.getBlurValues(this.mdVSFrameMixed),
          blurMins = _Renderer$getBlurValu2.blurMins,
          blurMaxs = _Renderer$getBlurValu2.blurMaxs;

      if (!this.blending) {
        this.compShader.renderQuadTexture(false, this.targetTexture, this.blurTexture1, this.blurTexture2, this.blurTexture3, blurMins, blurMaxs, this.mdVSFrame, this.warpColor);
      } else {
        this.prevCompShader.renderQuadTexture(false, this.targetTexture, this.blurTexture1, this.blurTexture2, this.blurTexture3, blurMins, blurMaxs, this.prevPresetEquationRunner.mdVSFrame, this.warpColor);
        this.compShader.renderQuadTexture(true, this.targetTexture, this.blurTexture1, this.blurTexture2, this.blurTexture3, blurMins, blurMaxs, this.mdVSFrameMixed, this.warpColor);
      }

      if (this.supertext.startTime >= 0) {
        var progress = (this.time - this.supertext.startTime) / this.supertext.duration;
        this.titleText.renderTitle(progress, false, this.globalVars);

        if (progress >= 1) {
          this.supertext.startTime = -1;
        }
      }

      if (this.outputFXAA) {
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.compTexture);
        this.gl.generateMipmap(this.gl.TEXTURE_2D);
        this.bindFrambufferAndSetViewport(null, this.width, this.height);
        this.outputShader.renderQuadTexture(this.compTexture);
      }
    }
  }, {
    key: "launchSongTitleAnim",
    value: function launchSongTitleAnim(text) {
      this.supertext = {
        startTime: this.time,
        duration: 1.7
      };
      this.titleText.generateTitleTexture(text);
    }
  }, {
    key: "toDataURL",
    value: function toDataURL() {
      var _this2 = this;

      var data = new Uint8Array(this.texsizeX * this.texsizeY * 4);
      var compFrameBuffer = this.gl.createFramebuffer();
      var compTexture = this.gl.createTexture();
      this.bindFrameBufferTexture(compFrameBuffer, compTexture);

      var _Renderer$getBlurValu3 = Renderer.getBlurValues(this.mdVSFrameMixed),
          blurMins = _Renderer$getBlurValu3.blurMins,
          blurMaxs = _Renderer$getBlurValu3.blurMaxs;

      this.compShader.renderQuadTexture(false, this.targetTexture, this.blurTexture1, this.blurTexture2, this.blurTexture3, blurMins, blurMaxs, this.mdVSFrame, this.warpColor);
      this.gl.readPixels(0, 0, this.texsizeX, this.texsizeY, this.gl.RGBA, this.gl.UNSIGNED_BYTE, data); // flip data

      Array.from({
        length: this.texsizeY
      }, function (val, i) {
        return data.slice(i * _this2.texsizeX * 4, (i + 1) * _this2.texsizeX * 4);
      }).forEach(function (val, i) {
        return data.set(val, (_this2.texsizeY - i - 1) * _this2.texsizeX * 4);
      });
      var canvas = document.createElement('canvas');
      canvas.width = this.texsizeX;
      canvas.height = this.texsizeY;
      var context = canvas.getContext('2d');
      var imageData = context.createImageData(this.texsizeX, this.texsizeY);
      imageData.data.set(data);
      context.putImageData(imageData, 0, 0);
      this.gl.deleteTexture(compTexture);
      this.gl.deleteFramebuffer(compFrameBuffer);
      return canvas.toDataURL();
    }
  }, {
    key: "warpBufferToDataURL",
    value: function warpBufferToDataURL() {
      var data = new Uint8Array(this.texsizeX * this.texsizeY * 4);
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.targetFrameBuffer);
      this.gl.readPixels(0, 0, this.texsizeX, this.texsizeY, this.gl.RGBA, this.gl.UNSIGNED_BYTE, data);
      var canvas = document.createElement('canvas');
      canvas.width = this.texsizeX;
      canvas.height = this.texsizeY;
      var context = canvas.getContext('2d');
      var imageData = context.createImageData(this.texsizeX, this.texsizeY);
      imageData.data.set(data);
      context.putImageData(imageData, 0, 0);
      return canvas.toDataURL();
    }
  }], [{
    key: "getHighestBlur",
    value: function getHighestBlur(t) {
      if (/sampler_blur3/.test(t)) {
        return 3;
      } else if (/sampler_blur2/.test(t)) {
        return 2;
      } else if (/sampler_blur1/.test(t)) {
        return 1;
      }

      return 0;
    }
  }, {
    key: "mixFrameEquations",
    value: function mixFrameEquations(blendProgress, mdVSFrame, mdVSFramePrev) {
      var mix = 0.5 - 0.5 * Math.cos(blendProgress * Math.PI);
      var mix2 = 1 - mix;
      var snapPoint = 0.5;
      var mixedFrame = _utils__WEBPACK_IMPORTED_MODULE_18__["default"].cloneVars(mdVSFrame);
      mixedFrame.decay = mix * mdVSFrame.decay + mix2 * mdVSFramePrev.decay;
      mixedFrame.wave_a = mix * mdVSFrame.wave_a + mix2 * mdVSFramePrev.wave_a;
      mixedFrame.wave_r = mix * mdVSFrame.wave_r + mix2 * mdVSFramePrev.wave_r;
      mixedFrame.wave_g = mix * mdVSFrame.wave_g + mix2 * mdVSFramePrev.wave_g;
      mixedFrame.wave_b = mix * mdVSFrame.wave_b + mix2 * mdVSFramePrev.wave_b;
      mixedFrame.wave_x = mix * mdVSFrame.wave_x + mix2 * mdVSFramePrev.wave_x;
      mixedFrame.wave_y = mix * mdVSFrame.wave_y + mix2 * mdVSFramePrev.wave_y;
      mixedFrame.wave_mystery = mix * mdVSFrame.wave_mystery + mix2 * mdVSFramePrev.wave_mystery;
      mixedFrame.ob_size = mix * mdVSFrame.ob_size + mix2 * mdVSFramePrev.ob_size;
      mixedFrame.ob_r = mix * mdVSFrame.ob_r + mix2 * mdVSFramePrev.ob_r;
      mixedFrame.ob_g = mix * mdVSFrame.ob_g + mix2 * mdVSFramePrev.ob_g;
      mixedFrame.ob_b = mix * mdVSFrame.ob_b + mix2 * mdVSFramePrev.ob_b;
      mixedFrame.ob_a = mix * mdVSFrame.ob_a + mix2 * mdVSFramePrev.ob_a;
      mixedFrame.ib_size = mix * mdVSFrame.ib_size + mix2 * mdVSFramePrev.ib_size;
      mixedFrame.ib_r = mix * mdVSFrame.ib_r + mix2 * mdVSFramePrev.ib_r;
      mixedFrame.ib_g = mix * mdVSFrame.ib_g + mix2 * mdVSFramePrev.ib_g;
      mixedFrame.ib_b = mix * mdVSFrame.ib_b + mix2 * mdVSFramePrev.ib_b;
      mixedFrame.ib_a = mix * mdVSFrame.ib_a + mix2 * mdVSFramePrev.ib_a;
      mixedFrame.mv_x = mix * mdVSFrame.mv_x + mix2 * mdVSFramePrev.mv_x;
      mixedFrame.mv_y = mix * mdVSFrame.mv_y + mix2 * mdVSFramePrev.mv_y;
      mixedFrame.mv_dx = mix * mdVSFrame.mv_dx + mix2 * mdVSFramePrev.mv_dx;
      mixedFrame.mv_dy = mix * mdVSFrame.mv_dy + mix2 * mdVSFramePrev.mv_dy;
      mixedFrame.mv_l = mix * mdVSFrame.mv_l + mix2 * mdVSFramePrev.mv_l;
      mixedFrame.mv_r = mix * mdVSFrame.mv_r + mix2 * mdVSFramePrev.mv_r;
      mixedFrame.mv_g = mix * mdVSFrame.mv_g + mix2 * mdVSFramePrev.mv_g;
      mixedFrame.mv_b = mix * mdVSFrame.mv_b + mix2 * mdVSFramePrev.mv_b;
      mixedFrame.mv_a = mix * mdVSFrame.mv_a + mix2 * mdVSFramePrev.mv_a;
      mixedFrame.echo_zoom = mix * mdVSFrame.echo_zoom + mix2 * mdVSFramePrev.echo_zoom;
      mixedFrame.echo_alpha = mix * mdVSFrame.echo_alpha + mix2 * mdVSFramePrev.echo_alpha;
      mixedFrame.echo_orient = mix * mdVSFrame.echo_orient + mix2 * mdVSFramePrev.echo_orient;
      mixedFrame.wave_dots = mix < snapPoint ? mdVSFramePrev.wave_dots : mdVSFrame.wave_dots;
      mixedFrame.wave_thick = mix < snapPoint ? mdVSFramePrev.wave_thick : mdVSFrame.wave_thick;
      mixedFrame.additivewave = mix < snapPoint ? mdVSFramePrev.additivewave : mdVSFrame.additivewave;
      mixedFrame.wave_brighten = mix < snapPoint ? mdVSFramePrev.wave_brighten : mdVSFrame.wave_brighten;
      mixedFrame.darken_center = mix < snapPoint ? mdVSFramePrev.darken_center : mdVSFrame.darken_center;
      mixedFrame.gammaadj = mix < snapPoint ? mdVSFramePrev.gammaadj : mdVSFrame.gammaadj;
      mixedFrame.wrap = mix < snapPoint ? mdVSFramePrev.wrap : mdVSFrame.wrap;
      mixedFrame.invert = mix < snapPoint ? mdVSFramePrev.invert : mdVSFrame.invert;
      mixedFrame.brighten = mix < snapPoint ? mdVSFramePrev.brighten : mdVSFrame.brighten;
      mixedFrame.darken = mix < snapPoint ? mdVSFramePrev.darken : mdVSFrame.darken;
      mixedFrame.solarize = mix < snapPoint ? mdVSFramePrev.brighten : mdVSFrame.solarize;
      mixedFrame.b1n = mix * mdVSFrame.b1n + mix2 * mdVSFramePrev.b1n;
      mixedFrame.b2n = mix * mdVSFrame.b2n + mix2 * mdVSFramePrev.b2n;
      mixedFrame.b3n = mix * mdVSFrame.b3n + mix2 * mdVSFramePrev.b3n;
      mixedFrame.b1x = mix * mdVSFrame.b1x + mix2 * mdVSFramePrev.b1x;
      mixedFrame.b2x = mix * mdVSFrame.b2x + mix2 * mdVSFramePrev.b2x;
      mixedFrame.b3x = mix * mdVSFrame.b3x + mix2 * mdVSFramePrev.b3x;
      mixedFrame.b1ed = mix * mdVSFrame.b1ed + mix2 * mdVSFramePrev.b1ed;
      return mixedFrame;
    }
  }, {
    key: "getBlurValues",
    value: function getBlurValues(mdVSFrame) {
      var blurMin1 = mdVSFrame.b1n;
      var blurMin2 = mdVSFrame.b2n;
      var blurMin3 = mdVSFrame.b3n;
      var blurMax1 = mdVSFrame.b1x;
      var blurMax2 = mdVSFrame.b2x;
      var blurMax3 = mdVSFrame.b3x;
      var fMinDist = 0.1;

      if (blurMax1 - blurMin1 < fMinDist) {
        var avg = (blurMin1 + blurMax1) * 0.5;
        blurMin1 = avg - fMinDist * 0.5;
        blurMax1 = avg - fMinDist * 0.5;
      }

      blurMax2 = Math.min(blurMax1, blurMax2);
      blurMin2 = Math.max(blurMin1, blurMin2);

      if (blurMax2 - blurMin2 < fMinDist) {
        var _avg = (blurMin2 + blurMax2) * 0.5;

        blurMin2 = _avg - fMinDist * 0.5;
        blurMax2 = _avg - fMinDist * 0.5;
      }

      blurMax3 = Math.min(blurMax2, blurMax3);
      blurMin3 = Math.max(blurMin2, blurMin3);

      if (blurMax3 - blurMin3 < fMinDist) {
        var _avg2 = (blurMin3 + blurMax3) * 0.5;

        blurMin3 = _avg2 - fMinDist * 0.5;
        blurMax3 = _avg2 - fMinDist * 0.5;
      }

      return {
        blurMins: [blurMin1, blurMin2, blurMin3],
        blurMaxs: [blurMax1, blurMax2, blurMax3]
      };
    }
  }]);

  return Renderer;
}();



/***/ }),

