/***/ "./src/rendering/shaders/output.js":
/*!*****************************************!*\
  !*** ./src/rendering/shaders/output.js ***!
  \*****************************************/
/*! exports provided: default */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "default", function() { return OutputShader; });
/* harmony import */ var _shaderUtils__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./shaderUtils */ "./src/rendering/shaders/shaderUtils.js");
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }



var OutputShader =
/*#__PURE__*/
function () {
  function OutputShader(gl, opts) {
    _classCallCheck(this, OutputShader);

    this.gl = gl;
    this.textureRatio = opts.textureRatio;
    this.texsizeX = opts.texsizeX;
    this.texsizeY = opts.texsizeY;
    this.positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    this.vertexBuf = this.gl.createBuffer();
    this.floatPrecision = _shaderUtils__WEBPACK_IMPORTED_MODULE_0__["default"].getFragmentFloatPrecision(this.gl);

    if (this.useFXAA()) {
      this.createFXAAShader();
    } else {
      this.createShader();
    }
  }

  _createClass(OutputShader, [{
    key: "useFXAA",
    value: function useFXAA() {
      return this.textureRatio <= 1;
    }
  }, {
    key: "updateGlobals",
    value: function updateGlobals(opts) {
      this.textureRatio = opts.textureRatio;
      this.texsizeX = opts.texsizeX;
      this.texsizeY = opts.texsizeY;
      this.gl.deleteProgram(this.shaderProgram);

      if (this.useFXAA()) {
        this.createFXAAShader();
      } else {
        this.createShader();
      }
    } // based on https://github.com/mattdesl/glsl-fxaa

  }, {
    key: "createFXAAShader",
    value: function createFXAAShader() {
      this.shaderProgram = this.gl.createProgram();
      var vertShader = this.gl.createShader(this.gl.VERTEX_SHADER);
      this.gl.shaderSource(vertShader, "#version 300 es\n       const vec2 halfmad = vec2(0.5);\n       in vec2 aPos;\n       out vec2 v_rgbM;\n       out vec2 v_rgbNW;\n       out vec2 v_rgbNE;\n       out vec2 v_rgbSW;\n       out vec2 v_rgbSE;\n       uniform vec4 texsize;\n       void main(void) {\n         gl_Position = vec4(aPos, 0.0, 1.0);\n\n         v_rgbM = aPos * halfmad + halfmad;\n         v_rgbNW = v_rgbM + (vec2(-1.0, -1.0) * texsize.zx);\n         v_rgbNE = v_rgbM + (vec2(1.0, -1.0) * texsize.zx);\n         v_rgbSW = v_rgbM + (vec2(-1.0, 1.0) * texsize.zx);\n         v_rgbSE = v_rgbM + (vec2(1.0, 1.0) * texsize.zx);\n       }");
      this.gl.compileShader(vertShader);
      var fragShader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
      this.gl.shaderSource(fragShader, "#version 300 es\n       precision ".concat(this.floatPrecision, " float;\n       precision highp int;\n       precision mediump sampler2D;\n\n       in vec2 v_rgbM;\n       in vec2 v_rgbNW;\n       in vec2 v_rgbNE;\n       in vec2 v_rgbSW;\n       in vec2 v_rgbSE;\n       out vec4 fragColor;\n       uniform vec4 texsize;\n       uniform sampler2D uTexture;\n\n       #ifndef FXAA_REDUCE_MIN\n         #define FXAA_REDUCE_MIN   (1.0/ 128.0)\n       #endif\n       #ifndef FXAA_REDUCE_MUL\n         #define FXAA_REDUCE_MUL   (1.0 / 8.0)\n       #endif\n       #ifndef FXAA_SPAN_MAX\n         #define FXAA_SPAN_MAX     8.0\n       #endif\n\n       void main(void) {\n         vec4 color;\n         vec3 rgbNW = textureLod(uTexture, v_rgbNW, 0.0).xyz;\n         vec3 rgbNE = textureLod(uTexture, v_rgbNE, 0.0).xyz;\n         vec3 rgbSW = textureLod(uTexture, v_rgbSW, 0.0).xyz;\n         vec3 rgbSE = textureLod(uTexture, v_rgbSE, 0.0).xyz;\n         vec3 rgbM  = textureLod(uTexture, v_rgbM, 0.0).xyz;\n         vec3 luma = vec3(0.299, 0.587, 0.114);\n         float lumaNW = dot(rgbNW, luma);\n         float lumaNE = dot(rgbNE, luma);\n         float lumaSW = dot(rgbSW, luma);\n         float lumaSE = dot(rgbSE, luma);\n         float lumaM  = dot(rgbM,  luma);\n         float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));\n         float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));\n\n         mediump vec2 dir;\n         dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));\n         dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));\n\n         float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) *\n                               (0.25 * FXAA_REDUCE_MUL), FXAA_REDUCE_MIN);\n\n         float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);\n         dir = min(vec2(FXAA_SPAN_MAX, FXAA_SPAN_MAX),\n                   max(vec2(-FXAA_SPAN_MAX, -FXAA_SPAN_MAX),\n                   dir * rcpDirMin)) * texsize.zw;\n\n         vec3 rgbA = 0.5 * (\n             textureLod(uTexture, v_rgbM + dir * (1.0 / 3.0 - 0.5), 0.0).xyz +\n             textureLod(uTexture, v_rgbM + dir * (2.0 / 3.0 - 0.5), 0.0).xyz);\n         vec3 rgbB = rgbA * 0.5 + 0.25 * (\n             textureLod(uTexture, v_rgbM + dir * -0.5, 0.0).xyz +\n             textureLod(uTexture, v_rgbM + dir * 0.5, 0.0).xyz);\n\n         float lumaB = dot(rgbB, luma);\n         if ((lumaB < lumaMin) || (lumaB > lumaMax))\n           color = vec4(rgbA, 1.0);\n         else\n           color = vec4(rgbB, 1.0);\n\n         fragColor = color;\n       }"));
      this.gl.compileShader(fragShader);
      this.gl.attachShader(this.shaderProgram, vertShader);
      this.gl.attachShader(this.shaderProgram, fragShader);
      this.gl.linkProgram(this.shaderProgram);
      this.positionLocation = this.gl.getAttribLocation(this.shaderProgram, 'aPos');
      this.textureLoc = this.gl.getUniformLocation(this.shaderProgram, 'uTexture');
      this.texsizeLoc = this.gl.getUniformLocation(this.shaderProgram, 'texsize');
    }
  }, {
    key: "createShader",
    value: function createShader() {
      this.shaderProgram = this.gl.createProgram();
      var vertShader = this.gl.createShader(this.gl.VERTEX_SHADER);
      this.gl.shaderSource(vertShader, "#version 300 es\n       const vec2 halfmad = vec2(0.5);\n       in vec2 aPos;\n       out vec2 uv;\n       void main(void) {\n         gl_Position = vec4(aPos, 0.0, 1.0);\n         uv = aPos * halfmad + halfmad;\n       }");
      this.gl.compileShader(vertShader);
      var fragShader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
      this.gl.shaderSource(fragShader, "#version 300 es\n       precision ".concat(this.floatPrecision, " float;\n       precision highp int;\n       precision mediump sampler2D;\n\n       in vec2 uv;\n       out vec4 fragColor;\n       uniform sampler2D uTexture;\n\n       void main(void) {\n         fragColor = vec4(texture(uTexture, uv).rgb, 1.0);\n       }"));
      this.gl.compileShader(fragShader);
      this.gl.attachShader(this.shaderProgram, vertShader);
      this.gl.attachShader(this.shaderProgram, fragShader);
      this.gl.linkProgram(this.shaderProgram);
      this.positionLocation = this.gl.getAttribLocation(this.shaderProgram, 'aPos');
      this.textureLoc = this.gl.getUniformLocation(this.shaderProgram, 'uTexture');
    }
  }, {
    key: "renderQuadTexture",
    value: function renderQuadTexture(texture) {
      this.gl.useProgram(this.shaderProgram);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuf);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.positions, this.gl.STATIC_DRAW);
      this.gl.vertexAttribPointer(this.positionLocation, 2, this.gl.FLOAT, false, 0, 0);
      this.gl.enableVertexAttribArray(this.positionLocation);
      this.gl.activeTexture(this.gl.TEXTURE0);
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.uniform1i(this.textureLoc, 0);

      if (this.useFXAA()) {
        this.gl.uniform4fv(this.texsizeLoc, new Float32Array([this.texsizeX, this.texsizeY, 1.0 / this.texsizeX, 1.0 / this.texsizeY]));
      }

      this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    }
  }]);

  return OutputShader;
}();



/***/ }),

