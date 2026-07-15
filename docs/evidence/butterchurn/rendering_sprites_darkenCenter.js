/***/ "./src/rendering/sprites/darkenCenter.js":
/*!***********************************************!*\
  !*** ./src/rendering/sprites/darkenCenter.js ***!
  \***********************************************/
/*! exports provided: default */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "default", function() { return CustomShape; });
/* harmony import */ var _shaders_shaderUtils__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../shaders/shaderUtils */ "./src/rendering/shaders/shaderUtils.js");
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }



var CustomShape =
/*#__PURE__*/
function () {
  function CustomShape(gl, opts) {
    _classCallCheck(this, CustomShape);

    this.gl = gl;
    this.aspectx = opts.aspectx;
    this.aspecty = opts.aspecty;
    this.invAspectx = 1.0 / this.aspectx;
    this.invAspecty = 1.0 / this.aspecty;
    this.generatePositions();
    this.colors = new Float32Array([0, 0, 0, 3 / 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    this.positionVertexBuf = this.gl.createBuffer();
    this.colorVertexBuf = this.gl.createBuffer();
    this.floatPrecision = _shaders_shaderUtils__WEBPACK_IMPORTED_MODULE_0__["default"].getFragmentFloatPrecision(this.gl);
    this.createShader();
  }

  _createClass(CustomShape, [{
    key: "updateGlobals",
    value: function updateGlobals(opts) {
      this.aspectx = opts.aspectx;
      this.aspecty = opts.aspecty;
      this.invAspectx = 1.0 / this.aspectx;
      this.invAspecty = 1.0 / this.aspecty;
      this.generatePositions();
    }
  }, {
    key: "generatePositions",
    value: function generatePositions() {
      var halfSize = 0.05;
      this.positions = new Float32Array([0, 0, 0, -halfSize * this.aspecty, 0, 0, 0, -halfSize, 0, halfSize * this.aspecty, 0, 0, 0, halfSize, 0, -halfSize * this.aspecty, 0, 0]);
    }
  }, {
    key: "createShader",
    value: function createShader() {
      this.shaderProgram = this.gl.createProgram();
      var vertShader = this.gl.createShader(this.gl.VERTEX_SHADER);
      this.gl.shaderSource(vertShader, "#version 300 es\n                                      in vec3 aPos;\n                                      in vec4 aColor;\n                                      out vec4 vColor;\n                                      void main(void) {\n                                        vColor = aColor;\n                                        gl_Position = vec4(aPos, 1.0);\n                                      }");
      this.gl.compileShader(vertShader);
      var fragShader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
      this.gl.shaderSource(fragShader, "#version 300 es\n                                      precision ".concat(this.floatPrecision, " float;\n                                      precision highp int;\n                                      precision mediump sampler2D;\n                                      in vec4 vColor;\n                                      out vec4 fragColor;\n                                      void main(void) {\n                                        fragColor = vColor;\n                                      }"));
      this.gl.compileShader(fragShader);
      this.gl.attachShader(this.shaderProgram, vertShader);
      this.gl.attachShader(this.shaderProgram, fragShader);
      this.gl.linkProgram(this.shaderProgram);
      this.aPosLocation = this.gl.getAttribLocation(this.shaderProgram, 'aPos');
      this.aColorLocation = this.gl.getAttribLocation(this.shaderProgram, 'aColor');
    }
  }, {
    key: "drawDarkenCenter",
    value: function drawDarkenCenter(mdVSFrame) {
      if (mdVSFrame.darken_center !== 0) {
        this.gl.useProgram(this.shaderProgram);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionVertexBuf);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, this.positions, this.gl.STATIC_DRAW);
        this.gl.vertexAttribPointer(this.aPosLocation, 3, this.gl.FLOAT, false, 0, 0);
        this.gl.enableVertexAttribArray(this.aPosLocation);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.colorVertexBuf);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, this.colors, this.gl.STATIC_DRAW);
        this.gl.vertexAttribPointer(this.aColorLocation, 4, this.gl.FLOAT, false, 0, 0);
        this.gl.enableVertexAttribArray(this.aColorLocation);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        this.gl.drawArrays(this.gl.TRIANGLE_FAN, 0, this.positions.length / 3);
      }
    }
  }]);

  return CustomShape;
}();



/***/ }),

