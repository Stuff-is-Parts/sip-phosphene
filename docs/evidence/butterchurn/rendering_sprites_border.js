/***/ "./src/rendering/sprites/border.js":
/*!*****************************************!*\
  !*** ./src/rendering/sprites/border.js ***!
  \*****************************************/
/*! exports provided: default */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "default", function() { return Border; });
/* harmony import */ var _shaders_shaderUtils__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../shaders/shaderUtils */ "./src/rendering/shaders/shaderUtils.js");
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }



var Border =
/*#__PURE__*/
function () {
  function Border(gl) {
    var opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    _classCallCheck(this, Border);

    this.gl = gl;
    this.positions = new Float32Array(72);
    this.aspectx = opts.aspectx;
    this.aspecty = opts.aspecty;
    this.invAspectx = 1.0 / this.aspectx;
    this.invAspecty = 1.0 / this.aspecty;
    this.floatPrecision = _shaders_shaderUtils__WEBPACK_IMPORTED_MODULE_0__["default"].getFragmentFloatPrecision(this.gl);
    this.createShader();
    this.vertexBuf = this.gl.createBuffer();
  }

  _createClass(Border, [{
    key: "updateGlobals",
    value: function updateGlobals(opts) {
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
      this.gl.shaderSource(vertShader, "#version 300 es\n                                      in vec3 aPos;\n                                      void main(void) {\n                                        gl_Position = vec4(aPos, 1.0);\n                                      }");
      this.gl.compileShader(vertShader);
      var fragShader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
      this.gl.shaderSource(fragShader, "#version 300 es\n                                      precision ".concat(this.floatPrecision, " float;\n                                      precision highp int;\n                                      precision mediump sampler2D;\n                                      out vec4 fragColor;\n                                      uniform vec4 u_color;\n                                      void main(void) {\n                                        fragColor = u_color;\n                                      }"));
      this.gl.compileShader(fragShader);
      this.gl.attachShader(this.shaderProgram, vertShader);
      this.gl.attachShader(this.shaderProgram, fragShader);
      this.gl.linkProgram(this.shaderProgram);
      this.aPosLoc = this.gl.getAttribLocation(this.shaderProgram, 'aPos');
      this.colorLoc = this.gl.getUniformLocation(this.shaderProgram, 'u_color');
    }
  }, {
    key: "addTriangle",
    value: function addTriangle(offset, point1, point2, point3) {
      this.positions[offset + 0] = point1[0];
      this.positions[offset + 1] = point1[1];
      this.positions[offset + 2] = point1[2];
      this.positions[offset + 3] = point2[0];
      this.positions[offset + 4] = point2[1];
      this.positions[offset + 5] = point2[2];
      this.positions[offset + 6] = point3[0];
      this.positions[offset + 7] = point3[1];
      this.positions[offset + 8] = point3[2];
    } // based on https://github.com/mrdoob/three.js/blob/master/src/geometries/PlaneGeometry.js

  }, {
    key: "generateBorder",
    value: function generateBorder(borderColor, borderSize, prevBorderSize) {
      if (borderSize > 0 && borderColor[3] > 0) {
        var width = 2;
        var height = 2;
        var widthHalf = width / 2;
        var heightHalf = height / 2;
        var prevBorderWidth = prevBorderSize / 2;
        var borderWidth = borderSize / 2 + prevBorderWidth;
        var prevBorderWidthWidth = prevBorderWidth * width;
        var prevBorderWidthHeight = prevBorderWidth * height;
        var borderWidthWidth = borderWidth * width;
        var borderWidthHeight = borderWidth * height; // 1st side

        var point1 = [-widthHalf + prevBorderWidthWidth, -heightHalf + borderWidthHeight, 0];
        var point2 = [-widthHalf + prevBorderWidthWidth, heightHalf - borderWidthHeight, 0];
        var point3 = [-widthHalf + borderWidthWidth, heightHalf - borderWidthHeight, 0];
        var point4 = [-widthHalf + borderWidthWidth, -heightHalf + borderWidthHeight, 0];
        this.addTriangle(0, point4, point2, point1);
        this.addTriangle(9, point4, point3, point2); // 2nd side

        point1 = [widthHalf - prevBorderWidthWidth, -heightHalf + borderWidthHeight, 0];
        point2 = [widthHalf - prevBorderWidthWidth, heightHalf - borderWidthHeight, 0];
        point3 = [widthHalf - borderWidthWidth, heightHalf - borderWidthHeight, 0];
        point4 = [widthHalf - borderWidthWidth, -heightHalf + borderWidthHeight, 0];
        this.addTriangle(18, point1, point2, point4);
        this.addTriangle(27, point2, point3, point4); // Top

        point1 = [-widthHalf + prevBorderWidthWidth, -heightHalf + prevBorderWidthHeight, 0];
        point2 = [-widthHalf + prevBorderWidthWidth, borderWidthHeight - heightHalf, 0];
        point3 = [widthHalf - prevBorderWidthWidth, borderWidthHeight - heightHalf, 0];
        point4 = [widthHalf - prevBorderWidthWidth, -heightHalf + prevBorderWidthHeight, 0];
        this.addTriangle(36, point4, point2, point1);
        this.addTriangle(45, point4, point3, point2); // Bottom

        point1 = [-widthHalf + prevBorderWidthWidth, heightHalf - prevBorderWidthHeight, 0];
        point2 = [-widthHalf + prevBorderWidthWidth, heightHalf - borderWidthHeight, 0];
        point3 = [widthHalf - prevBorderWidthWidth, heightHalf - borderWidthHeight, 0];
        point4 = [widthHalf - prevBorderWidthWidth, heightHalf - prevBorderWidthHeight, 0];
        this.addTriangle(54, point1, point2, point4);
        this.addTriangle(63, point2, point3, point4);
        return true;
      }

      return false;
    }
  }, {
    key: "drawBorder",
    value: function drawBorder(borderColor, borderSize, prevBorderSize) {
      if (this.generateBorder(borderColor, borderSize, prevBorderSize)) {
        this.gl.useProgram(this.shaderProgram);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuf);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, this.positions, this.gl.STATIC_DRAW);
        this.gl.vertexAttribPointer(this.aPosLoc, 3, this.gl.FLOAT, false, 0, 0);
        this.gl.enableVertexAttribArray(this.aPosLoc);
        this.gl.uniform4fv(this.colorLoc, borderColor);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, this.positions.length / 3);
      }
    }
  }]);

  return Border;
}();



/***/ }),

