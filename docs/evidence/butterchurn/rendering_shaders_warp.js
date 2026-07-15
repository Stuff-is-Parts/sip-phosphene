/***/ "./src/rendering/shaders/warp.js":
/*!***************************************!*\
  !*** ./src/rendering/shaders/warp.js ***!
  \***************************************/
/*! exports provided: default */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "default", function() { return WarpShader; });
/* harmony import */ var _shaderUtils__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./shaderUtils */ "./src/rendering/shaders/shaderUtils.js");
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }



var WarpShader =
/*#__PURE__*/
function () {
  function WarpShader(gl, noise, image) {
    var opts = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : {};

    _classCallCheck(this, WarpShader);

    this.gl = gl;
    this.noise = noise;
    this.image = image;
    this.texsizeX = opts.texsizeX;
    this.texsizeY = opts.texsizeY;
    this.mesh_width = opts.mesh_width;
    this.mesh_height = opts.mesh_height;
    this.aspectx = opts.aspectx;
    this.aspecty = opts.aspecty;
    this.invAspectx = 1.0 / this.aspectx;
    this.invAspecty = 1.0 / this.aspecty;
    this.buildPositions();
    this.indexBuf = gl.createBuffer();
    this.positionVertexBuf = this.gl.createBuffer();
    this.warpUvVertexBuf = this.gl.createBuffer();
    this.warpColorVertexBuf = this.gl.createBuffer();
    this.floatPrecision = _shaderUtils__WEBPACK_IMPORTED_MODULE_0__["default"].getFragmentFloatPrecision(this.gl);
    this.createShader();
    this.mainSampler = this.gl.createSampler();
    this.mainSamplerFW = this.gl.createSampler();
    this.mainSamplerFC = this.gl.createSampler();
    this.mainSamplerPW = this.gl.createSampler();
    this.mainSamplerPC = this.gl.createSampler();
    gl.samplerParameteri(this.mainSampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.samplerParameteri(this.mainSampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.mainSampler, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.samplerParameteri(this.mainSampler, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.samplerParameteri(this.mainSamplerFW, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.samplerParameteri(this.mainSamplerFW, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.mainSamplerFW, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.samplerParameteri(this.mainSamplerFW, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.samplerParameteri(this.mainSamplerFC, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.samplerParameteri(this.mainSamplerFC, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.mainSamplerFC, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this.mainSamplerFC, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this.mainSamplerPW, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
    gl.samplerParameteri(this.mainSamplerPW, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.samplerParameteri(this.mainSamplerPW, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.samplerParameteri(this.mainSamplerPW, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.samplerParameteri(this.mainSamplerPC, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
    gl.samplerParameteri(this.mainSamplerPC, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.samplerParameteri(this.mainSamplerPC, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this.mainSamplerPC, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  } // based on https://github.com/mrdoob/three.js/blob/master/src/geometries/PlaneGeometry.js


  _createClass(WarpShader, [{
    key: "buildPositions",
    value: function buildPositions() {
      var width = 2;
      var height = 2;
      var widthHalf = width / 2;
      var heightHalf = height / 2;
      var gridX = this.mesh_width;
      var gridY = this.mesh_height;
      var gridX1 = gridX + 1;
      var gridY1 = gridY + 1;
      var segmentWidth = width / gridX;
      var segmentHeight = height / gridY;
      var vertices = [];

      for (var iy = 0; iy < gridY1; iy++) {
        var y = iy * segmentHeight - heightHalf;

        for (var ix = 0; ix < gridX1; ix++) {
          var x = ix * segmentWidth - widthHalf;
          vertices.push(x, -y, 0);
        }
      }

      var indices = [];

      for (var _iy = 0; _iy < gridY; _iy++) {
        for (var _ix = 0; _ix < gridX; _ix++) {
          var a = _ix + gridX1 * _iy;
          var b = _ix + gridX1 * (_iy + 1);
          var c = _ix + 1 + gridX1 * (_iy + 1);
          var d = _ix + 1 + gridX1 * _iy;
          indices.push(a, b, d);
          indices.push(b, c, d);
        }
      }

      this.vertices = new Float32Array(vertices);
      this.indices = new Uint16Array(indices);
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
      this.buildPositions();
    }
  }, {
    key: "createShader",
    value: function createShader() {
      var shaderText = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
      var fragShaderText;
      var fragShaderHeaderText;

      if (shaderText.length === 0) {
        fragShaderText = 'ret = texture(sampler_main, uv).rgb * decay;';
        fragShaderHeaderText = '';
      } else {
        var shaderParts = _shaderUtils__WEBPACK_IMPORTED_MODULE_0__["default"].getShaderParts(shaderText);
        fragShaderHeaderText = shaderParts[0];
        fragShaderText = shaderParts[1];
      }

      fragShaderText = fragShaderText.replace(/texture2D/g, 'texture');
      fragShaderText = fragShaderText.replace(/texture3D/g, 'texture');
      this.userTextures = _shaderUtils__WEBPACK_IMPORTED_MODULE_0__["default"].getUserSamplers(fragShaderHeaderText);
      this.shaderProgram = this.gl.createProgram();
      var vertShader = this.gl.createShader(this.gl.VERTEX_SHADER);
      this.gl.shaderSource(vertShader, "#version 300 es\n                                      precision ".concat(this.floatPrecision, " float;\n                                      const vec2 halfmad = vec2(0.5);\n                                      in vec2 aPos;\n                                      in vec2 aWarpUv;\n                                      in vec4 aWarpColor;\n                                      out vec2 uv;\n                                      out vec2 uv_orig;\n                                      out vec4 vColor;\n                                      void main(void) {\n                                        gl_Position = vec4(aPos, 0.0, 1.0);\n                                        uv_orig = aPos * halfmad + halfmad;\n                                        uv = aWarpUv;\n                                        vColor = aWarpColor;\n                                      }"));
      this.gl.compileShader(vertShader);
      var fragShader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
      this.gl.shaderSource(fragShader, "#version 300 es\n                                      precision ".concat(this.floatPrecision, " float;\n                                      precision highp int;\n                                      precision mediump sampler2D;\n                                      precision mediump sampler3D;\n\n                                      in vec2 uv;\n                                      in vec2 uv_orig;\n                                      in vec4 vColor;\n                                      out vec4 fragColor;\n                                      uniform sampler2D sampler_main;\n                                      uniform sampler2D sampler_fw_main;\n                                      uniform sampler2D sampler_fc_main;\n                                      uniform sampler2D sampler_pw_main;\n                                      uniform sampler2D sampler_pc_main;\n                                      uniform sampler2D sampler_blur1;\n                                      uniform sampler2D sampler_blur2;\n                                      uniform sampler2D sampler_blur3;\n                                      uniform sampler2D sampler_noise_lq;\n                                      uniform sampler2D sampler_noise_lq_lite;\n                                      uniform sampler2D sampler_noise_mq;\n                                      uniform sampler2D sampler_noise_hq;\n                                      uniform sampler2D sampler_pw_noise_lq;\n                                      uniform sampler3D sampler_noisevol_lq;\n                                      uniform sampler3D sampler_noisevol_hq;\n                                      uniform float time;\n                                      uniform float decay;\n                                      uniform vec2 resolution;\n                                      uniform vec4 aspect;\n                                      uniform vec4 texsize;\n                                      uniform vec4 texsize_noise_lq;\n                                      uniform vec4 texsize_noise_mq;\n                                      uniform vec4 texsize_noise_hq;\n                                      uniform vec4 texsize_noise_lq_lite;\n                                      uniform vec4 texsize_noisevol_lq;\n                                      uniform vec4 texsize_noisevol_hq;\n\n                                      uniform float bass;\n                                      uniform float mid;\n                                      uniform float treb;\n                                      uniform float vol;\n                                      uniform float bass_att;\n                                      uniform float mid_att;\n                                      uniform float treb_att;\n                                      uniform float vol_att;\n\n                                      uniform float frame;\n                                      uniform float fps;\n\n                                      uniform vec4 _qa;\n                                      uniform vec4 _qb;\n                                      uniform vec4 _qc;\n                                      uniform vec4 _qd;\n                                      uniform vec4 _qe;\n                                      uniform vec4 _qf;\n                                      uniform vec4 _qg;\n                                      uniform vec4 _qh;\n\n                                      #define q1 _qa.x\n                                      #define q2 _qa.y\n                                      #define q3 _qa.z\n                                      #define q4 _qa.w\n                                      #define q5 _qb.x\n                                      #define q6 _qb.y\n                                      #define q7 _qb.z\n                                      #define q8 _qb.w\n                                      #define q9 _qc.x\n                                      #define q10 _qc.y\n                                      #define q11 _qc.z\n                                      #define q12 _qc.w\n                                      #define q13 _qd.x\n                                      #define q14 _qd.y\n                                      #define q15 _qd.z\n                                      #define q16 _qd.w\n                                      #define q17 _qe.x\n                                      #define q18 _qe.y\n                                      #define q19 _qe.z\n                                      #define q20 _qe.w\n                                      #define q21 _qf.x\n                                      #define q22 _qf.y\n                                      #define q23 _qf.z\n                                      #define q24 _qf.w\n                                      #define q25 _qg.x\n                                      #define q26 _qg.y\n                                      #define q27 _qg.z\n                                      #define q28 _qg.w\n                                      #define q29 _qh.x\n                                      #define q30 _qh.y\n                                      #define q31 _qh.z\n                                      #define q32 _qh.w\n\n                                      uniform vec4 slow_roam_cos;\n                                      uniform vec4 roam_cos;\n                                      uniform vec4 slow_roam_sin;\n                                      uniform vec4 roam_sin;\n\n                                      uniform float blur1_min;\n                                      uniform float blur1_max;\n                                      uniform float blur2_min;\n                                      uniform float blur2_max;\n                                      uniform float blur3_min;\n                                      uniform float blur3_max;\n\n                                      uniform float scale1;\n                                      uniform float scale2;\n                                      uniform float scale3;\n                                      uniform float bias1;\n                                      uniform float bias2;\n                                      uniform float bias3;\n\n                                      uniform vec4 rand_frame;\n                                      uniform vec4 rand_preset;\n\n                                      float PI = ").concat(Math.PI, ";\n\n                                      ").concat(fragShaderHeaderText, "\n\n                                      void main(void) {\n                                        vec3 ret;\n                                        float rad = length(uv_orig - 0.5);\n                                        float ang = atan(uv_orig.x - 0.5, uv_orig.y - 0.5);\n\n                                        ").concat(fragShaderText, "\n\n                                        fragColor = vec4(ret, 1.0) * vColor;\n                                      }"));
      this.gl.compileShader(fragShader);
      this.gl.attachShader(this.shaderProgram, vertShader);
      this.gl.attachShader(this.shaderProgram, fragShader);
      this.gl.linkProgram(this.shaderProgram);
      this.positionLocation = this.gl.getAttribLocation(this.shaderProgram, 'aPos');
      this.warpUvLocation = this.gl.getAttribLocation(this.shaderProgram, 'aWarpUv');
      this.warpColorLocation = this.gl.getAttribLocation(this.shaderProgram, 'aWarpColor');
      this.textureLoc = this.gl.getUniformLocation(this.shaderProgram, 'sampler_main');
      this.textureFWLoc = this.gl.getUniformLocation(this.shaderProgram, 'sampler_fw_main');
      this.textureFCLoc = this.gl.getUniformLocation(this.shaderProgram, 'sampler_fc_main');
      this.texturePWLoc = this.gl.getUniformLocation(this.shaderProgram, 'sampler_pw_main');
      this.texturePCLoc = this.gl.getUniformLocation(this.shaderProgram, 'sampler_pc_main');
      this.blurTexture1Loc = this.gl.getUniformLocation(this.shaderProgram, 'sampler_blur1');
      this.blurTexture2Loc = this.gl.getUniformLocation(this.shaderProgram, 'sampler_blur2');
      this.blurTexture3Loc = this.gl.getUniformLocation(this.shaderProgram, 'sampler_blur3');
      this.noiseLQLoc = this.gl.getUniformLocation(this.shaderProgram, 'sampler_noise_lq');
      this.noiseMQLoc = this.gl.getUniformLocation(this.shaderProgram, 'sampler_noise_mq');
      this.noiseHQLoc = this.gl.getUniformLocation(this.shaderProgram, 'sampler_noise_hq');
      this.noiseLQLiteLoc = this.gl.getUniformLocation(this.shaderProgram, 'sampler_noise_lq_lite');
      this.noisePointLQLoc = this.gl.getUniformLocation(this.shaderProgram, 'sampler_pw_noise_lq');
      this.noiseVolLQLoc = this.gl.getUniformLocation(this.shaderProgram, 'sampler_noisevol_lq');
      this.noiseVolHQLoc = this.gl.getUniformLocation(this.shaderProgram, 'sampler_noisevol_hq');
      this.decayLoc = this.gl.getUniformLocation(this.shaderProgram, 'decay');
      this.texsizeLoc = this.gl.getUniformLocation(this.shaderProgram, 'texsize');
      this.texsizeNoiseLQLoc = this.gl.getUniformLocation(this.shaderProgram, 'texsize_noise_lq');
      this.texsizeNoiseMQLoc = this.gl.getUniformLocation(this.shaderProgram, 'texsize_noise_mq');
      this.texsizeNoiseHQLoc = this.gl.getUniformLocation(this.shaderProgram, 'texsize_noise_hq');
      this.texsizeNoiseLQLiteLoc = this.gl.getUniformLocation(this.shaderProgram, 'texsize_noise_lq_lite');
      this.texsizeNoiseVolLQLoc = this.gl.getUniformLocation(this.shaderProgram, 'texsize_noisevol_lq');
      this.texsizeNoiseVolHQLoc = this.gl.getUniformLocation(this.shaderProgram, 'texsize_noisevol_hq');
      this.resolutionLoc = this.gl.getUniformLocation(this.shaderProgram, 'resolution');
      this.aspectLoc = this.gl.getUniformLocation(this.shaderProgram, 'aspect');
      this.bassLoc = this.gl.getUniformLocation(this.shaderProgram, 'bass');
      this.midLoc = this.gl.getUniformLocation(this.shaderProgram, 'mid');
      this.trebLoc = this.gl.getUniformLocation(this.shaderProgram, 'treb');
      this.volLoc = this.gl.getUniformLocation(this.shaderProgram, 'vol');
      this.bassAttLoc = this.gl.getUniformLocation(this.shaderProgram, 'bass_att');
      this.midAttLoc = this.gl.getUniformLocation(this.shaderProgram, 'mid_att');
      this.trebAttLoc = this.gl.getUniformLocation(this.shaderProgram, 'treb_att');
      this.volAttLoc = this.gl.getUniformLocation(this.shaderProgram, 'vol_att');
      this.timeLoc = this.gl.getUniformLocation(this.shaderProgram, 'time');
      this.frameLoc = this.gl.getUniformLocation(this.shaderProgram, 'frame');
      this.fpsLoc = this.gl.getUniformLocation(this.shaderProgram, 'fps');
      this.blur1MinLoc = this.gl.getUniformLocation(this.shaderProgram, 'blur1_min');
      this.blur1MaxLoc = this.gl.getUniformLocation(this.shaderProgram, 'blur1_max');
      this.blur2MinLoc = this.gl.getUniformLocation(this.shaderProgram, 'blur2_min');
      this.blur2MaxLoc = this.gl.getUniformLocation(this.shaderProgram, 'blur2_max');
      this.blur3MinLoc = this.gl.getUniformLocation(this.shaderProgram, 'blur3_min');
      this.blur3MaxLoc = this.gl.getUniformLocation(this.shaderProgram, 'blur3_max');
      this.scale1Loc = this.gl.getUniformLocation(this.shaderProgram, 'scale1');
      this.scale2Loc = this.gl.getUniformLocation(this.shaderProgram, 'scale2');
      this.scale3Loc = this.gl.getUniformLocation(this.shaderProgram, 'scale3');
      this.bias1Loc = this.gl.getUniformLocation(this.shaderProgram, 'bias1');
      this.bias2Loc = this.gl.getUniformLocation(this.shaderProgram, 'bias2');
      this.bias3Loc = this.gl.getUniformLocation(this.shaderProgram, 'bias3');
      this.randPresetLoc = this.gl.getUniformLocation(this.shaderProgram, 'rand_preset');
      this.randFrameLoc = this.gl.getUniformLocation(this.shaderProgram, 'rand_frame');
      this.qaLoc = this.gl.getUniformLocation(this.shaderProgram, '_qa');
      this.qbLoc = this.gl.getUniformLocation(this.shaderProgram, '_qb');
      this.qcLoc = this.gl.getUniformLocation(this.shaderProgram, '_qc');
      this.qdLoc = this.gl.getUniformLocation(this.shaderProgram, '_qd');
      this.qeLoc = this.gl.getUniformLocation(this.shaderProgram, '_qe');
      this.qfLoc = this.gl.getUniformLocation(this.shaderProgram, '_qf');
      this.qgLoc = this.gl.getUniformLocation(this.shaderProgram, '_qg');
      this.qhLoc = this.gl.getUniformLocation(this.shaderProgram, '_qh');
      this.slowRoamCosLoc = this.gl.getUniformLocation(this.shaderProgram, 'slow_roam_cos');
      this.roamCosLoc = this.gl.getUniformLocation(this.shaderProgram, 'roam_cos');
      this.slowRoamSinLoc = this.gl.getUniformLocation(this.shaderProgram, 'slow_roam_sin');
      this.roamSinLoc = this.gl.getUniformLocation(this.shaderProgram, 'roam_sin');

      for (var i = 0; i < this.userTextures.length; i++) {
        var userTexture = this.userTextures[i];
        userTexture.textureLoc = this.gl.getUniformLocation(this.shaderProgram, "sampler_".concat(userTexture.sampler));
      }
    }
  }, {
    key: "updateShader",
    value: function updateShader(shaderText) {
      this.createShader(shaderText);
    }
  }, {
    key: "bindBlurVals",
    value: function bindBlurVals(blurMins, blurMaxs) {
      var blurMin1 = blurMins[0];
      var blurMin2 = blurMins[1];
      var blurMin3 = blurMins[2];
      var blurMax1 = blurMaxs[0];
      var blurMax2 = blurMaxs[1];
      var blurMax3 = blurMaxs[2];
      var scale1 = blurMax1 - blurMin1;
      var bias1 = blurMin1;
      var scale2 = blurMax2 - blurMin2;
      var bias2 = blurMin2;
      var scale3 = blurMax3 - blurMin3;
      var bias3 = blurMin3;
      this.gl.uniform1f(this.blur1MinLoc, blurMin1);
      this.gl.uniform1f(this.blur1MaxLoc, blurMax1);
      this.gl.uniform1f(this.blur2MinLoc, blurMin2);
      this.gl.uniform1f(this.blur2MaxLoc, blurMax2);
      this.gl.uniform1f(this.blur3MinLoc, blurMin3);
      this.gl.uniform1f(this.blur3MaxLoc, blurMax3);
      this.gl.uniform1f(this.scale1Loc, scale1);
      this.gl.uniform1f(this.scale2Loc, scale2);
      this.gl.uniform1f(this.scale3Loc, scale3);
      this.gl.uniform1f(this.bias1Loc, bias1);
      this.gl.uniform1f(this.bias2Loc, bias2);
      this.gl.uniform1f(this.bias3Loc, bias3);
    }
  }, {
    key: "renderQuadTexture",
    value: function renderQuadTexture(blending, texture, blurTexture1, blurTexture2, blurTexture3, blurMins, blurMaxs, mdVSFrame, warpUVs, warpColor) {
      this.gl.useProgram(this.shaderProgram);
      this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuf);
      this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, this.indices, this.gl.STATIC_DRAW);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionVertexBuf);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.vertices, this.gl.STATIC_DRAW);
      this.gl.vertexAttribPointer(this.positionLocation, 3, this.gl.FLOAT, false, 0, 0);
      this.gl.enableVertexAttribArray(this.positionLocation);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.warpUvVertexBuf);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, warpUVs, this.gl.STATIC_DRAW);
      this.gl.vertexAttribPointer(this.warpUvLocation, 2, this.gl.FLOAT, false, 0, 0);
      this.gl.enableVertexAttribArray(this.warpUvLocation);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.warpColorVertexBuf);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, warpColor, this.gl.STATIC_DRAW);
      this.gl.vertexAttribPointer(this.warpColorLocation, 4, this.gl.FLOAT, false, 0, 0);
      this.gl.enableVertexAttribArray(this.warpColorLocation);
      var wrapping = mdVSFrame.wrap !== 0 ? this.gl.REPEAT : this.gl.CLAMP_TO_EDGE;
      this.gl.samplerParameteri(this.mainSampler, this.gl.TEXTURE_WRAP_S, wrapping);
      this.gl.samplerParameteri(this.mainSampler, this.gl.TEXTURE_WRAP_T, wrapping);
      this.gl.activeTexture(this.gl.TEXTURE0);
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.bindSampler(0, this.mainSampler);
      this.gl.uniform1i(this.textureLoc, 0);
      this.gl.activeTexture(this.gl.TEXTURE1);
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.bindSampler(1, this.mainSamplerFW);
      this.gl.uniform1i(this.textureFWLoc, 1);
      this.gl.activeTexture(this.gl.TEXTURE2);
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.bindSampler(2, this.mainSamplerFC);
      this.gl.uniform1i(this.textureFCLoc, 2);
      this.gl.activeTexture(this.gl.TEXTURE3);
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.bindSampler(3, this.mainSamplerPW);
      this.gl.uniform1i(this.texturePWLoc, 3);
      this.gl.activeTexture(this.gl.TEXTURE4);
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.bindSampler(4, this.mainSamplerPC);
      this.gl.uniform1i(this.texturePCLoc, 4);
      this.gl.activeTexture(this.gl.TEXTURE5);
      this.gl.bindTexture(this.gl.TEXTURE_2D, blurTexture1);
      this.gl.uniform1i(this.blurTexture1Loc, 5);
      this.gl.activeTexture(this.gl.TEXTURE6);
      this.gl.bindTexture(this.gl.TEXTURE_2D, blurTexture2);
      this.gl.uniform1i(this.blurTexture2Loc, 6);
      this.gl.activeTexture(this.gl.TEXTURE7);
      this.gl.bindTexture(this.gl.TEXTURE_2D, blurTexture3);
      this.gl.uniform1i(this.blurTexture3Loc, 7);
      this.gl.activeTexture(this.gl.TEXTURE8);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.noise.noiseTexLQ);
      this.gl.uniform1i(this.noiseLQLoc, 8);
      this.gl.activeTexture(this.gl.TEXTURE9);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.noise.noiseTexMQ);
      this.gl.uniform1i(this.noiseMQLoc, 9);
      this.gl.activeTexture(this.gl.TEXTURE10);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.noise.noiseTexHQ);
      this.gl.uniform1i(this.noiseHQLoc, 10);
      this.gl.activeTexture(this.gl.TEXTURE11);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.noise.noiseTexLQLite);
      this.gl.uniform1i(this.noiseLQLiteLoc, 11);
      this.gl.activeTexture(this.gl.TEXTURE12);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.noise.noiseTexLQ);
      this.gl.bindSampler(12, this.noise.noiseTexPointLQ);
      this.gl.uniform1i(this.noisePointLQLoc, 12);
      this.gl.activeTexture(this.gl.TEXTURE13);
      this.gl.bindTexture(this.gl.TEXTURE_3D, this.noise.noiseTexVolLQ);
      this.gl.uniform1i(this.noiseVolLQLoc, 13);
      this.gl.activeTexture(this.gl.TEXTURE14);
      this.gl.bindTexture(this.gl.TEXTURE_3D, this.noise.noiseTexVolHQ);
      this.gl.uniform1i(this.noiseVolHQLoc, 14);

      for (var i = 0; i < this.userTextures.length; i++) {
        var userTexture = this.userTextures[i];
        this.gl.activeTexture(this.gl.TEXTURE15 + i);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.image.getTexture(userTexture.sampler));
        this.gl.uniform1i(userTexture.textureLoc, 15 + i);
      }

      this.gl.uniform1f(this.decayLoc, mdVSFrame.decay);
      this.gl.uniform2fv(this.resolutionLoc, [this.texsizeX, this.texsizeY]);
      this.gl.uniform4fv(this.aspectLoc, [this.aspectx, this.aspecty, this.invAspectx, this.invAspecty]);
      this.gl.uniform4fv(this.texsizeLoc, [this.texsizeX, this.texsizeY, 1.0 / this.texsizeX, 1.0 / this.texsizeY]);
      this.gl.uniform4fv(this.texsizeNoiseLQLoc, [256, 256, 1 / 256, 1 / 256]);
      this.gl.uniform4fv(this.texsizeNoiseMQLoc, [256, 256, 1 / 256, 1 / 256]);
      this.gl.uniform4fv(this.texsizeNoiseHQLoc, [256, 256, 1 / 256, 1 / 256]);
      this.gl.uniform4fv(this.texsizeNoiseLQLiteLoc, [32, 32, 1 / 32, 1 / 32]);
      this.gl.uniform4fv(this.texsizeNoiseVolLQLoc, [32, 32, 1 / 32, 1 / 32]);
      this.gl.uniform4fv(this.texsizeNoiseVolHQLoc, [32, 32, 1 / 32, 1 / 32]);
      this.gl.uniform1f(this.bassLoc, mdVSFrame.bass);
      this.gl.uniform1f(this.midLoc, mdVSFrame.mid);
      this.gl.uniform1f(this.trebLoc, mdVSFrame.treb);
      this.gl.uniform1f(this.volLoc, (mdVSFrame.bass + mdVSFrame.mid + mdVSFrame.treb) / 3);
      this.gl.uniform1f(this.bassAttLoc, mdVSFrame.bass_att);
      this.gl.uniform1f(this.midAttLoc, mdVSFrame.mid_att);
      this.gl.uniform1f(this.trebAttLoc, mdVSFrame.treb_att);
      this.gl.uniform1f(this.volAttLoc, (mdVSFrame.bass_att + mdVSFrame.mid_att + mdVSFrame.treb_att) / 3);
      this.gl.uniform1f(this.timeLoc, mdVSFrame.time);
      this.gl.uniform1f(this.frameLoc, mdVSFrame.frame);
      this.gl.uniform1f(this.fpsLoc, mdVSFrame.fps);
      this.gl.uniform4fv(this.randPresetLoc, mdVSFrame.rand_preset);
      this.gl.uniform4fv(this.randFrameLoc, new Float32Array([Math.random(), Math.random(), Math.random(), Math.random()]));
      this.gl.uniform4fv(this.qaLoc, new Float32Array([mdVSFrame.q1 || 0, mdVSFrame.q2 || 0, mdVSFrame.q3 || 0, mdVSFrame.q4 || 0]));
      this.gl.uniform4fv(this.qbLoc, new Float32Array([mdVSFrame.q5 || 0, mdVSFrame.q6 || 0, mdVSFrame.q7 || 0, mdVSFrame.q8 || 0]));
      this.gl.uniform4fv(this.qcLoc, new Float32Array([mdVSFrame.q9 || 0, mdVSFrame.q10 || 0, mdVSFrame.q11 || 0, mdVSFrame.q12 || 0]));
      this.gl.uniform4fv(this.qdLoc, new Float32Array([mdVSFrame.q13 || 0, mdVSFrame.q14 || 0, mdVSFrame.q15 || 0, mdVSFrame.q16 || 0]));
      this.gl.uniform4fv(this.qeLoc, new Float32Array([mdVSFrame.q17 || 0, mdVSFrame.q18 || 0, mdVSFrame.q19 || 0, mdVSFrame.q20 || 0]));
      this.gl.uniform4fv(this.qfLoc, new Float32Array([mdVSFrame.q21 || 0, mdVSFrame.q22 || 0, mdVSFrame.q23 || 0, mdVSFrame.q24 || 0]));
      this.gl.uniform4fv(this.qgLoc, new Float32Array([mdVSFrame.q25 || 0, mdVSFrame.q26 || 0, mdVSFrame.q27 || 0, mdVSFrame.q28 || 0]));
      this.gl.uniform4fv(this.qhLoc, new Float32Array([mdVSFrame.q29 || 0, mdVSFrame.q30 || 0, mdVSFrame.q31 || 0, mdVSFrame.q32 || 0]));
      this.gl.uniform4fv(this.slowRoamCosLoc, [0.5 + 0.5 * Math.cos(mdVSFrame.time * 0.005), 0.5 + 0.5 * Math.cos(mdVSFrame.time * 0.008), 0.5 + 0.5 * Math.cos(mdVSFrame.time * 0.013), 0.5 + 0.5 * Math.cos(mdVSFrame.time * 0.022)]);
      this.gl.uniform4fv(this.roamCosLoc, [0.5 + 0.5 * Math.cos(mdVSFrame.time * 0.3), 0.5 + 0.5 * Math.cos(mdVSFrame.time * 1.3), 0.5 + 0.5 * Math.cos(mdVSFrame.time * 5.0), 0.5 + 0.5 * Math.cos(mdVSFrame.time * 20.0)]);
      this.gl.uniform4fv(this.slowRoamSinLoc, [0.5 + 0.5 * Math.sin(mdVSFrame.time * 0.005), 0.5 + 0.5 * Math.sin(mdVSFrame.time * 0.008), 0.5 + 0.5 * Math.sin(mdVSFrame.time * 0.013), 0.5 + 0.5 * Math.sin(mdVSFrame.time * 0.022)]);
      this.gl.uniform4fv(this.roamSinLoc, [0.5 + 0.5 * Math.sin(mdVSFrame.time * 0.3), 0.5 + 0.5 * Math.sin(mdVSFrame.time * 1.3), 0.5 + 0.5 * Math.sin(mdVSFrame.time * 5.0), 0.5 + 0.5 * Math.sin(mdVSFrame.time * 20.0)]);
      this.bindBlurVals(blurMins, blurMaxs);

      if (blending) {
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
      } else {
        this.gl.disable(this.gl.BLEND);
      }

      this.gl.drawElements(this.gl.TRIANGLES, this.indices.length, this.gl.UNSIGNED_SHORT, 0);

      if (!blending) {
        this.gl.enable(this.gl.BLEND);
      }
    }
  }]);

  return WarpShader;
}();



/***/ }),

