/***/ "./src/rendering/motionVectors/motionVectors.js":
/*!******************************************************!*\
  !*** ./src/rendering/motionVectors/motionVectors.js ***!
  \******************************************************/
/*! exports provided: default */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "default", function() { return MotionVectors; });
/* harmony import */ var _shaders_shaderUtils__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../shaders/shaderUtils */ "./src/rendering/shaders/shaderUtils.js");
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }



var MotionVectors =
/*#__PURE__*/
function () {
  function MotionVectors(gl, opts) {
    _classCallCheck(this, MotionVectors);

    this.gl = gl;
    this.maxX = 64;
    this.maxY = 48;
    this.positions = new Float32Array(this.maxX * this.maxY * 2 * 3);
    this.texsizeX = opts.texsizeX;
    this.texsizeY = opts.texsizeY;
    this.mesh_width = opts.mesh_width;
    this.mesh_height = opts.mesh_height;
    this.positionVertexBuf = this.gl.createBuffer();
    this.floatPrecision = _shaders_shaderUtils__WEBPACK_IMPORTED_MODULE_0__["default"].getFragmentFloatPrecision(this.gl);
    this.createShader();
  }

  _createClass(MotionVectors, [{
    key: "updateGlobals",
    value: function updateGlobals(opts) {
      this.texsizeX = opts.texsizeX;
      this.texsizeY = opts.texsizeY;
      this.mesh_width = opts.mesh_width;
      this.mesh_height = opts.mesh_height;
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
    key: "getMotionDir",
    value: function getMotionDir(warpUVs, fx, fy) {
      var y0 = Math.floor(fy * this.mesh_height);
      var dy = fy * this.mesh_height - y0;
      var x0 = Math.floor(fx * this.mesh_width);
      var dx = fx * this.mesh_width - x0;
      var x1 = x0 + 1;
      var y1 = y0 + 1;
      var gridX1 = this.mesh_width + 1;
      var fx2;
      var fy2;
      fx2 = warpUVs[(y0 * gridX1 + x0) * 2 + 0] * (1 - dx) * (1 - dy);
      fy2 = warpUVs[(y0 * gridX1 + x0) * 2 + 1] * (1 - dx) * (1 - dy);
      fx2 += warpUVs[(y0 * gridX1 + x1) * 2 + 0] * dx * (1 - dy);
      fy2 += warpUVs[(y0 * gridX1 + x1) * 2 + 1] * dx * (1 - dy);
      fx2 += warpUVs[(y1 * gridX1 + x0) * 2 + 0] * (1 - dx) * dy;
      fy2 += warpUVs[(y1 * gridX1 + x0) * 2 + 1] * (1 - dx) * dy;
      fx2 += warpUVs[(y1 * gridX1 + x1) * 2 + 0] * dx * dy;
      fy2 += warpUVs[(y1 * gridX1 + x1) * 2 + 1] * dx * dy;
      return [fx2, 1.0 - fy2];
    }
  }, {
    key: "generateMotionVectors",
    value: function generateMotionVectors(mdVSFrame, warpUVs) {
      var mvA = mdVSFrame.mv_a;
      var nX = Math.floor(mdVSFrame.mv_x);
      var nY = Math.floor(mdVSFrame.mv_y);

      if (mvA > 0.001 && nX > 0 && nY > 0) {
        var dx = mdVSFrame.mv_x - nX;
        var dy = mdVSFrame.mv_y - nY;

        if (nX > this.maxX) {
          nX = this.maxX;
          dx = 0;
        }

        if (nY > this.maxY) {
          nY = this.maxY;
          dy = 0;
        }

        var dx2 = mdVSFrame.mv_dx;
        var dy2 = mdVSFrame.mv_dy;
        var lenMult = mdVSFrame.mv_l;
        var minLen = 1.0 / this.texsizeX;
        this.numVecVerts = 0;

        for (var j = 0; j < nY; j++) {
          var fy = (j + 0.25) / (nY + dy + 0.25 - 1.0);
          fy -= dy2;

          if (fy > 0.0001 && fy < 0.9999) {
            for (var i = 0; i < nX; i++) {
              var fx = (i + 0.25) / (nX + dx + 0.25 - 1.0);
              fx += dx2;

              if (fx > 0.0001 && fx < 0.9999) {
                var fx2arr = this.getMotionDir(warpUVs, fx, fy);
                var fx2 = fx2arr[0];
                var fy2 = fx2arr[1];
                var dxi = fx2 - fx;
                var dyi = fy2 - fy;
                dxi *= lenMult;
                dyi *= lenMult;
                var fdist = Math.sqrt(dxi * dxi + dyi * dyi);

                if (fdist < minLen && fdist > 0.00000001) {
                  fdist = minLen / fdist;
                  dxi *= fdist;
                  dyi *= fdist;
                } else {
                  dxi = minLen;
                  dxi = minLen;
                }

                fx2 = fx + dxi;
                fy2 = fy + dyi;
                var vx1 = 2.0 * fx - 1.0;
                var vy1 = 2.0 * fy - 1.0;
                var vx2 = 2.0 * fx2 - 1.0;
                var vy2 = 2.0 * fy2 - 1.0;
                this.positions[this.numVecVerts * 3 + 0] = vx1;
                this.positions[this.numVecVerts * 3 + 1] = vy1;
                this.positions[this.numVecVerts * 3 + 2] = 0;
                this.positions[(this.numVecVerts + 1) * 3 + 0] = vx2;
                this.positions[(this.numVecVerts + 1) * 3 + 1] = vy2;
                this.positions[(this.numVecVerts + 1) * 3 + 2] = 0;
                this.numVecVerts += 2;
              }
            }
          }
        }

        if (this.numVecVerts > 0) {
          this.color = [mdVSFrame.mv_r, mdVSFrame.mv_g, mdVSFrame.mv_b, mvA];
          return true;
        }
      }

      return false;
    }
  }, {
    key: "drawMotionVectors",
    value: function drawMotionVectors(mdVSFrame, warpUVs) {
      if (this.generateMotionVectors(mdVSFrame, warpUVs)) {
        this.gl.useProgram(this.shaderProgram);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionVertexBuf);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, this.positions, this.gl.STATIC_DRAW);
        this.gl.vertexAttribPointer(this.aPosLoc, 3, this.gl.FLOAT, false, 0, 0);
        this.gl.enableVertexAttribArray(this.aPosLoc);
        this.gl.uniform4fv(this.colorLoc, this.color);
        this.gl.lineWidth(1);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        this.gl.drawArrays(this.gl.LINES, 0, this.numVecVerts);
      }
    }
  }]);

  return MotionVectors;
}();



/***/ }),

