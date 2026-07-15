/***/ "./src/rendering/shaders/blur/blurHorizontal.js":
/*!******************************************************!*\
  !*** ./src/rendering/shaders/blur/blurHorizontal.js ***!
  \******************************************************/
/*! exports provided: default */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "default", function() { return BlurHorizontal; });
/* harmony import */ var _shaderUtils__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../shaderUtils */ "./src/rendering/shaders/shaderUtils.js");
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }



var BlurHorizontal =
/*#__PURE__*/
function () {
  function BlurHorizontal(gl, blurLevel) {
    _classCallCheck(this, BlurHorizontal);

    this.gl = gl;
    this.blurLevel = blurLevel;
    var w = [4.0, 3.8, 3.5, 2.9, 1.9, 1.2, 0.7, 0.3];
    var w1H = w[0] + w[1];
    var w2H = w[2] + w[3];
    var w3H = w[4] + w[5];
    var w4H = w[6] + w[7];
    var d1H = 0 + 2 * w[1] / w1H;
    var d2H = 2 + 2 * w[3] / w2H;
    var d3H = 4 + 2 * w[5] / w3H;
    var d4H = 6 + 2 * w[7] / w4H;
    this.ws = new Float32Array([w1H, w2H, w3H, w4H]);
    this.ds = new Float32Array([d1H, d2H, d3H, d4H]);
    this.wDiv = 0.5 / (w1H + w2H + w3H + w4H);
    this.positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    this.vertexBuf = this.gl.createBuffer();
    this.floatPrecision = _shaderUtils__WEBPACK_IMPORTED_MODULE_0__["default"].getFragmentFloatPrecision(this.gl);
    this.createShader();
  }

  _createClass(BlurHorizontal, [{
    key: "createShader",
    value: function createShader() {
      this.shaderProgram = this.gl.createProgram();
      var vertShader = this.gl.createShader(this.gl.VERTEX_SHADER);
      this.gl.shaderSource(vertShader, "#version 300 es\n                                      const vec2 halfmad = vec2(0.5);\n                                      in vec2 aPos;\n                                      out vec2 uv;\n                                      void main(void) {\n                                        gl_Position = vec4(aPos, 0.0, 1.0);\n                                        uv = aPos * halfmad + halfmad;\n                                      }");
      this.gl.compileShader(vertShader);
      var fragShader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
      this.gl.shaderSource(fragShader, "#version 300 es\n       precision ".concat(this.floatPrecision, " float;\n       precision highp int;\n       precision mediump sampler2D;\n\n       in vec2 uv;\n       out vec4 fragColor;\n       uniform sampler2D uTexture;\n       uniform vec4 texsize;\n       uniform float scale;\n       uniform float bias;\n       uniform vec4 ws;\n       uniform vec4 ds;\n       uniform float wdiv;\n\n       void main(void) {\n         float w1 = ws[0];\n         float w2 = ws[1];\n         float w3 = ws[2];\n         float w4 = ws[3];\n         float d1 = ds[0];\n         float d2 = ds[1];\n         float d3 = ds[2];\n         float d4 = ds[3];\n\n         vec2 uv2 = uv.xy;\n\n         vec3 blur =\n           ( texture(uTexture, uv2 + vec2( d1 * texsize.z,0.0) ).xyz\n           + texture(uTexture, uv2 + vec2(-d1 * texsize.z,0.0) ).xyz) * w1 +\n           ( texture(uTexture, uv2 + vec2( d2 * texsize.z,0.0) ).xyz\n           + texture(uTexture, uv2 + vec2(-d2 * texsize.z,0.0) ).xyz) * w2 +\n           ( texture(uTexture, uv2 + vec2( d3 * texsize.z,0.0) ).xyz\n           + texture(uTexture, uv2 + vec2(-d3 * texsize.z,0.0) ).xyz) * w3 +\n           ( texture(uTexture, uv2 + vec2( d4 * texsize.z,0.0) ).xyz\n           + texture(uTexture, uv2 + vec2(-d4 * texsize.z,0.0) ).xyz) * w4;\n\n         blur.xyz *= wdiv;\n         blur.xyz = blur.xyz * scale + bias;\n\n         fragColor = vec4(blur, 1.0);\n       }"));
      this.gl.compileShader(fragShader);
      this.gl.attachShader(this.shaderProgram, vertShader);
      this.gl.attachShader(this.shaderProgram, fragShader);
      this.gl.linkProgram(this.shaderProgram);
      this.positionLocation = this.gl.getAttribLocation(this.shaderProgram, 'aPos');
      this.textureLoc = this.gl.getUniformLocation(this.shaderProgram, 'uTexture');
      this.texsizeLocation = this.gl.getUniformLocation(this.shaderProgram, 'texsize');
      this.scaleLoc = this.gl.getUniformLocation(this.shaderProgram, 'scale');
      this.biasLoc = this.gl.getUniformLocation(this.shaderProgram, 'bias');
      this.wsLoc = this.gl.getUniformLocation(this.shaderProgram, 'ws');
      this.dsLocation = this.gl.getUniformLocation(this.shaderProgram, 'ds');
      this.wdivLoc = this.gl.getUniformLocation(this.shaderProgram, 'wdiv');
    }
  }, {
    key: "getScaleAndBias",
    value: function getScaleAndBias(blurMins, blurMaxs) {
      var scale = [1, 1, 1];
      var bias = [0, 0, 0];
      var tempMin;
      var tempMax;
      scale[0] = 1.0 / (blurMaxs[0] - blurMins[0]);
      bias[0] = -blurMins[0] * scale[0];
      tempMin = (blurMins[1] - blurMins[0]) / (blurMaxs[0] - blurMins[0]);
      tempMax = (blurMaxs[1] - blurMins[0]) / (blurMaxs[0] - blurMins[0]);
      scale[1] = 1.0 / (tempMax - tempMin);
      bias[1] = -tempMin * scale[1];
      tempMin = (blurMins[2] - blurMins[1]) / (blurMaxs[1] - blurMins[1]);
      tempMax = (blurMaxs[2] - blurMins[1]) / (blurMaxs[1] - blurMins[1]);
      scale[2] = 1.0 / (tempMax - tempMin);
      bias[2] = -tempMin * scale[2];
      return {
        scale: scale[this.blurLevel],
        bias: bias[this.blurLevel]
      };
    }
  }, {
    key: "renderQuadTexture",
    value: function renderQuadTexture(texture, mdVSFrame, blurMins, blurMaxs, srcTexsize) {
      this.gl.useProgram(this.shaderProgram);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuf);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.positions, this.gl.STATIC_DRAW);
      this.gl.vertexAttribPointer(this.positionLocation, 2, this.gl.FLOAT, false, 0, 0);
      this.gl.enableVertexAttribArray(this.positionLocation);
      this.gl.activeTexture(this.gl.TEXTURE0);
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.uniform1i(this.textureLoc, 0);

      var _this$getScaleAndBias = this.getScaleAndBias(blurMins, blurMaxs),
          scale = _this$getScaleAndBias.scale,
          bias = _this$getScaleAndBias.bias;

      this.gl.uniform4fv(this.texsizeLocation, [srcTexsize[0], srcTexsize[1], 1.0 / srcTexsize[0], 1.0 / srcTexsize[1]]);
      this.gl.uniform1f(this.scaleLoc, scale);
      this.gl.uniform1f(this.biasLoc, bias);
      this.gl.uniform4fv(this.wsLoc, this.ws);
      this.gl.uniform4fv(this.dsLocation, this.ds);
      this.gl.uniform1f(this.wdivLoc, this.wDiv);
      this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    }
  }]);

  return BlurHorizontal;
}();



/***/ }),

