/***/ "./src/rendering/shaders/blur/blurVertical.js":
/*!****************************************************!*\
  !*** ./src/rendering/shaders/blur/blurVertical.js ***!
  \****************************************************/
/*! exports provided: default */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "default", function() { return BlurVertical; });
/* harmony import */ var _shaderUtils__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../shaderUtils */ "./src/rendering/shaders/shaderUtils.js");
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }



var BlurVertical =
/*#__PURE__*/
function () {
  function BlurVertical(gl, blurLevel) {
    _classCallCheck(this, BlurVertical);

    this.gl = gl;
    this.blurLevel = blurLevel;
    var w = [4.0, 3.8, 3.5, 2.9, 1.9, 1.2, 0.7, 0.3];
    var w1V = w[0] + w[1] + w[2] + w[3];
    var w2V = w[4] + w[5] + w[6] + w[7];
    var d1V = 0 + 2 * ((w[2] + w[3]) / w1V);
    var d2V = 2 + 2 * ((w[6] + w[7]) / w2V);
    this.wds = new Float32Array([w1V, w2V, d1V, d2V]);
    this.wDiv = 1.0 / ((w1V + w2V) * 2);
    this.positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    this.vertexBuf = this.gl.createBuffer();
    this.floatPrecision = _shaderUtils__WEBPACK_IMPORTED_MODULE_0__["default"].getFragmentFloatPrecision(this.gl);
    this.createShader();
  }

  _createClass(BlurVertical, [{
    key: "createShader",
    value: function createShader() {
      this.shaderProgram = this.gl.createProgram();
      var vertShader = this.gl.createShader(this.gl.VERTEX_SHADER);
      this.gl.shaderSource(vertShader, "#version 300 es\n                                      const vec2 halfmad = vec2(0.5);\n                                      in vec2 aPos;\n                                      out vec2 uv;\n                                      void main(void) {\n                                        gl_Position = vec4(aPos, 0.0, 1.0);\n                                        uv = aPos * halfmad + halfmad;\n                                      }");
      this.gl.compileShader(vertShader);
      var fragShader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
      this.gl.shaderSource(fragShader, "#version 300 es\n       precision ".concat(this.floatPrecision, " float;\n       precision highp int;\n       precision mediump sampler2D;\n\n       in vec2 uv;\n       out vec4 fragColor;\n       uniform sampler2D uTexture;\n       uniform vec4 texsize;\n       uniform float ed1;\n       uniform float ed2;\n       uniform float ed3;\n       uniform vec4 wds;\n       uniform float wdiv;\n\n       void main(void) {\n         float w1 = wds[0];\n         float w2 = wds[1];\n         float d1 = wds[2];\n         float d2 = wds[3];\n\n         vec2 uv2 = uv.xy;\n\n         vec3 blur =\n           ( texture(uTexture, uv2 + vec2(0.0, d1 * texsize.w) ).xyz\n           + texture(uTexture, uv2 + vec2(0.0,-d1 * texsize.w) ).xyz) * w1 +\n           ( texture(uTexture, uv2 + vec2(0.0, d2 * texsize.w) ).xyz\n           + texture(uTexture, uv2 + vec2(0.0,-d2 * texsize.w) ).xyz) * w2;\n\n         blur.xyz *= wdiv;\n\n         float t = min(min(uv.x, uv.y), 1.0 - max(uv.x, uv.y));\n         t = sqrt(t);\n         t = ed1 + ed2 * clamp(t * ed3, 0.0, 1.0);\n         blur.xyz *= t;\n\n         fragColor = vec4(blur, 1.0);\n       }"));
      this.gl.compileShader(fragShader);
      this.gl.attachShader(this.shaderProgram, vertShader);
      this.gl.attachShader(this.shaderProgram, fragShader);
      this.gl.linkProgram(this.shaderProgram);
      this.positionLocation = this.gl.getAttribLocation(this.shaderProgram, 'aPos');
      this.textureLoc = this.gl.getUniformLocation(this.shaderProgram, 'uTexture');
      this.texsizeLocation = this.gl.getUniformLocation(this.shaderProgram, 'texsize');
      this.ed1Loc = this.gl.getUniformLocation(this.shaderProgram, 'ed1');
      this.ed2Loc = this.gl.getUniformLocation(this.shaderProgram, 'ed2');
      this.ed3Loc = this.gl.getUniformLocation(this.shaderProgram, 'ed3');
      this.wdsLocation = this.gl.getUniformLocation(this.shaderProgram, 'wds');
      this.wdivLoc = this.gl.getUniformLocation(this.shaderProgram, 'wdiv');
    }
  }, {
    key: "renderQuadTexture",
    value: function renderQuadTexture(texture, mdVSFrame, srcTexsize) {
      this.gl.useProgram(this.shaderProgram);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuf);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.positions, this.gl.STATIC_DRAW);
      this.gl.vertexAttribPointer(this.positionLocation, 2, this.gl.FLOAT, false, 0, 0);
      this.gl.enableVertexAttribArray(this.positionLocation);
      this.gl.activeTexture(this.gl.TEXTURE0);
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.uniform1i(this.textureLoc, 0);
      var b1ed = this.blurLevel === 0 ? mdVSFrame.b1ed : 0.0;
      this.gl.uniform4fv(this.texsizeLocation, [srcTexsize[0], srcTexsize[1], 1.0 / srcTexsize[0], 1.0 / srcTexsize[1]]);
      this.gl.uniform1f(this.ed1Loc, 1.0 - b1ed);
      this.gl.uniform1f(this.ed2Loc, b1ed);
      this.gl.uniform1f(this.ed3Loc, 5.0);
      this.gl.uniform4fv(this.wdsLocation, this.wds);
      this.gl.uniform1f(this.wdivLoc, this.wDiv);
      this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    }
  }]);

  return BlurVertical;
}();



/***/ }),

