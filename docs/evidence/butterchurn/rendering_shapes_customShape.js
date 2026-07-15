/***/ "./src/rendering/shapes/customShape.js":
/*!*********************************************!*\
  !*** ./src/rendering/shapes/customShape.js ***!
  \*********************************************/
/*! exports provided: default */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "default", function() { return CustomShape; });
/* harmony import */ var _utils__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../utils */ "./src/utils.js");
/* harmony import */ var _shaders_shaderUtils__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../shaders/shaderUtils */ "./src/rendering/shaders/shaderUtils.js");
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }




var CustomShape =
/*#__PURE__*/
function () {
  function CustomShape(index, gl, opts) {
    _classCallCheck(this, CustomShape);

    this.index = index;
    this.gl = gl;
    var maxSides = 101;
    this.positions = new Float32Array((maxSides + 2) * 3);
    this.colors = new Float32Array((maxSides + 2) * 4);
    this.uvs = new Float32Array((maxSides + 2) * 2);
    this.borderPositions = new Float32Array((maxSides + 1) * 3);
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
    this.uvVertexBuf = this.gl.createBuffer();
    this.borderPositionVertexBuf = this.gl.createBuffer();
    this.floatPrecision = _shaders_shaderUtils__WEBPACK_IMPORTED_MODULE_1__["default"].getFragmentFloatPrecision(this.gl);
    this.createShader();
    this.createBorderShader();
    this.mainSampler = this.gl.createSampler();
    gl.samplerParameteri(this.mainSampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.samplerParameteri(this.mainSampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.mainSampler, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.samplerParameteri(this.mainSampler, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  _createClass(CustomShape, [{
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
      this.gl.shaderSource(vertShader, "#version 300 es\n                                      in vec3 aPos;\n                                      in vec4 aColor;\n                                      in vec2 aUv;\n                                      out vec4 vColor;\n                                      out vec2 vUv;\n                                      void main(void) {\n                                        vColor = aColor;\n                                        vUv = aUv;\n                                        gl_Position = vec4(aPos, 1.0);\n                                      }");
      this.gl.compileShader(vertShader);
      var fragShader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
      this.gl.shaderSource(fragShader, "#version 300 es\n                                      precision ".concat(this.floatPrecision, " float;\n                                      precision highp int;\n                                      precision mediump sampler2D;\n                                      uniform sampler2D uTexture;\n                                      uniform float uTextured;\n                                      in vec4 vColor;\n                                      in vec2 vUv;\n                                      out vec4 fragColor;\n                                      void main(void) {\n                                        if (uTextured != 0.0) {\n                                          fragColor = texture(uTexture, vUv) * vColor;\n                                        } else {\n                                          fragColor = vColor;\n                                        }\n                                      }"));
      this.gl.compileShader(fragShader);
      this.gl.attachShader(this.shaderProgram, vertShader);
      this.gl.attachShader(this.shaderProgram, fragShader);
      this.gl.linkProgram(this.shaderProgram);
      this.aPosLocation = this.gl.getAttribLocation(this.shaderProgram, 'aPos');
      this.aColorLocation = this.gl.getAttribLocation(this.shaderProgram, 'aColor');
      this.aUvLocation = this.gl.getAttribLocation(this.shaderProgram, 'aUv');
      this.texturedLoc = this.gl.getUniformLocation(this.shaderProgram, 'uTextured');
      this.textureLoc = this.gl.getUniformLocation(this.shaderProgram, 'uTexture');
    }
  }, {
    key: "createBorderShader",
    value: function createBorderShader() {
      this.borderShaderProgram = this.gl.createProgram();
      var vertShader = this.gl.createShader(this.gl.VERTEX_SHADER);
      this.gl.shaderSource(vertShader, "#version 300 es\n                                      in vec3 aBorderPos;\n                                      uniform vec2 thickOffset;\n                                      void main(void) {\n                                        gl_Position = vec4(aBorderPos +\n                                                           vec3(thickOffset, 0.0), 1.0);\n                                      }");
      this.gl.compileShader(vertShader);
      var fragShader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
      this.gl.shaderSource(fragShader, "#version 300 es\n                                      precision ".concat(this.floatPrecision, " float;\n                                      precision highp int;\n                                      precision mediump sampler2D;\n                                      out vec4 fragColor;\n                                      uniform vec4 uBorderColor;\n                                      void main(void) {\n                                        fragColor = uBorderColor;\n                                      }"));
      this.gl.compileShader(fragShader);
      this.gl.attachShader(this.borderShaderProgram, vertShader);
      this.gl.attachShader(this.borderShaderProgram, fragShader);
      this.gl.linkProgram(this.borderShaderProgram);
      this.aBorderPosLoc = this.gl.getAttribLocation(this.borderShaderProgram, 'aBorderPos');
      this.uBorderColorLoc = this.gl.getUniformLocation(this.borderShaderProgram, 'uBorderColor');
      this.thickOffsetLoc = this.gl.getUniformLocation(this.shaderProgram, 'thickOffset');
    }
  }, {
    key: "drawCustomShape",
    value: function drawCustomShape(blendProgress, globalVars, presetEquationRunner, shapeEqs, prevTexture) {
      if (shapeEqs.baseVals.enabled !== 0) {
        this.setupShapeBuffers(presetEquationRunner.mdVSFrame);
        var mdVSShape = Object.assign({}, presetEquationRunner.mdVSShapes[this.index], presetEquationRunner.mdVSFrameMapShapes[this.index], presetEquationRunner.mdVSQAfterFrame, presetEquationRunner.mdVSTShapeInits[this.index], globalVars);
        var mdVSShapeBaseVals = _utils__WEBPACK_IMPORTED_MODULE_0__["default"].cloneVars(mdVSShape);
        var numInst = Math.clamp(mdVSShape.num_inst, 1, 1024);

        for (var j = 0; j < numInst; j++) {
          mdVSShape.instance = j;
          mdVSShape.x = mdVSShapeBaseVals.x;
          mdVSShape.y = mdVSShapeBaseVals.y;
          mdVSShape.rad = mdVSShapeBaseVals.rad;
          mdVSShape.ang = mdVSShapeBaseVals.ang;
          mdVSShape.r = mdVSShapeBaseVals.r;
          mdVSShape.g = mdVSShapeBaseVals.g;
          mdVSShape.b = mdVSShapeBaseVals.b;
          mdVSShape.a = mdVSShapeBaseVals.a;
          mdVSShape.r2 = mdVSShapeBaseVals.r2;
          mdVSShape.g2 = mdVSShapeBaseVals.g2;
          mdVSShape.b2 = mdVSShapeBaseVals.b2;
          mdVSShape.a2 = mdVSShapeBaseVals.a2;
          mdVSShape.border_r = mdVSShapeBaseVals.border_r;
          mdVSShape.border_g = mdVSShapeBaseVals.border_g;
          mdVSShape.border_b = mdVSShapeBaseVals.border_b;
          mdVSShape.border_a = mdVSShapeBaseVals.border_a;
          mdVSShape.thickoutline = mdVSShapeBaseVals.thickoutline;
          mdVSShape.textured = mdVSShapeBaseVals.textured;
          mdVSShape.tex_zoom = mdVSShapeBaseVals.tex_zoom;
          mdVSShape.tex_ang = mdVSShapeBaseVals.tex_ang;
          mdVSShape.additive = mdVSShapeBaseVals.additive;
          var mdVSShapeFrame = shapeEqs.frame_eqs(mdVSShape);
          var sides = mdVSShapeFrame.sides;
          sides = Math.clamp(sides, 3, 100);
          sides = Math.floor(sides);
          var rad = mdVSShapeFrame.rad;
          var ang = mdVSShapeFrame.ang;
          var x = mdVSShapeFrame.x * 2 - 1;
          var y = mdVSShapeFrame.y * -2 + 1;
          var r = mdVSShapeFrame.r;
          var g = mdVSShapeFrame.g;
          var b = mdVSShapeFrame.b;
          var a = mdVSShapeFrame.a;
          var r2 = mdVSShapeFrame.r2;
          var g2 = mdVSShapeFrame.g2;
          var b2 = mdVSShapeFrame.b2;
          var a2 = mdVSShapeFrame.a2;
          var borderR = mdVSShapeFrame.border_r;
          var borderG = mdVSShapeFrame.border_g;
          var borderB = mdVSShapeFrame.border_b;
          var borderA = mdVSShapeFrame.border_a;
          this.borderColor = [borderR, borderG, borderB, borderA * blendProgress];
          var thickoutline = mdVSShapeFrame.thickoutline;
          var textured = mdVSShapeFrame.textured;
          var texZoom = mdVSShapeFrame.tex_zoom;
          var texAng = mdVSShapeFrame.tex_ang;
          var additive = mdVSShapeFrame.additive;
          var hasBorder = this.borderColor[3] > 0;
          var isTextured = Math.abs(textured) >= 1;
          var isBorderThick = Math.abs(thickoutline) >= 1;
          var isAdditive = Math.abs(additive) >= 1;
          this.positions[0] = x;
          this.positions[1] = y;
          this.positions[2] = 0;
          this.colors[0] = r;
          this.colors[1] = g;
          this.colors[2] = b;
          this.colors[3] = a * blendProgress;

          if (isTextured) {
            this.uvs[0] = 0.5;
            this.uvs[1] = 0.5;
          }

          var quarterPi = Math.PI * 0.25;

          for (var k = 1; k <= sides + 1; k++) {
            var p = (k - 1) / sides;
            var pTwoPi = p * 2 * Math.PI;
            var angSum = pTwoPi + ang + quarterPi;
            this.positions[k * 3 + 0] = x + rad * Math.cos(angSum) * this.aspecty;
            this.positions[k * 3 + 1] = y + rad * Math.sin(angSum);
            this.positions[k * 3 + 2] = 0;
            this.colors[k * 4 + 0] = r2;
            this.colors[k * 4 + 1] = g2;
            this.colors[k * 4 + 2] = b2;
            this.colors[k * 4 + 3] = a2 * blendProgress;

            if (isTextured) {
              var texAngSum = pTwoPi + texAng + quarterPi;
              this.uvs[k * 2 + 0] = 0.5 + 0.5 * Math.cos(texAngSum) / texZoom * this.aspecty;
              this.uvs[k * 2 + 1] = 0.5 + 0.5 * Math.sin(texAngSum) / texZoom;
            }

            if (hasBorder) {
              this.borderPositions[(k - 1) * 3 + 0] = this.positions[k * 3 + 0];
              this.borderPositions[(k - 1) * 3 + 1] = this.positions[k * 3 + 1];
              this.borderPositions[(k - 1) * 3 + 2] = this.positions[k * 3 + 2];
            }
          }

          this.mdVSShapeFrame = mdVSShapeFrame;
          this.drawCustomShapeInstance(prevTexture, sides, isTextured, hasBorder, isBorderThick, isAdditive);
        }

        var mdVSUserKeysShape = presetEquationRunner.mdVSUserKeysShapes[this.index];
        var mdVSNewFrameMapShape = _utils__WEBPACK_IMPORTED_MODULE_0__["default"].pick(this.mdVSShapeFrame, mdVSUserKeysShape); // eslint-disable-next-line no-param-reassign

        presetEquationRunner.mdVSFrameMapShapes[this.index] = mdVSNewFrameMapShape;
      }
    }
  }, {
    key: "setupShapeBuffers",
    value: function setupShapeBuffers(mdVSFrame) {
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionVertexBuf);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.positions, this.gl.DYNAMIC_DRAW);
      this.gl.vertexAttribPointer(this.aPosLocation, 3, this.gl.FLOAT, false, 0, 0);
      this.gl.enableVertexAttribArray(this.aPosLocation);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.colorVertexBuf);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.colors, this.gl.DYNAMIC_DRAW);
      this.gl.vertexAttribPointer(this.aColorLocation, 4, this.gl.FLOAT, false, 0, 0);
      this.gl.enableVertexAttribArray(this.aColorLocation);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.uvVertexBuf);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.uvs, this.gl.DYNAMIC_DRAW);
      this.gl.vertexAttribPointer(this.aUvLocation, 2, this.gl.FLOAT, false, 0, 0);
      this.gl.enableVertexAttribArray(this.aUvLocation);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.borderPositionVertexBuf);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.borderPositions, this.gl.DYNAMIC_DRAW);
      this.gl.vertexAttribPointer(this.aBorderPosLoc, 3, this.gl.FLOAT, false, 0, 0);
      this.gl.enableVertexAttribArray(this.aBorderPosLoc);
      var wrapping = mdVSFrame.wrap !== 0 ? this.gl.REPEAT : this.gl.CLAMP_TO_EDGE;
      this.gl.samplerParameteri(this.mainSampler, this.gl.TEXTURE_WRAP_S, wrapping);
      this.gl.samplerParameteri(this.mainSampler, this.gl.TEXTURE_WRAP_T, wrapping);
    }
  }, {
    key: "drawCustomShapeInstance",
    value: function drawCustomShapeInstance(prevTexture, sides, isTextured, hasBorder, isBorderThick, isAdditive) {
      this.gl.useProgram(this.shaderProgram);
      var updatedPositions = new Float32Array(this.positions.buffer, 0, (sides + 2) * 3);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionVertexBuf);
      this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, updatedPositions);
      this.gl.vertexAttribPointer(this.aPosLocation, 3, this.gl.FLOAT, false, 0, 0);
      this.gl.enableVertexAttribArray(this.aPosLocation);
      var updatedColors = new Float32Array(this.colors.buffer, 0, (sides + 2) * 4);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.colorVertexBuf);
      this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, updatedColors);
      this.gl.vertexAttribPointer(this.aColorLocation, 4, this.gl.FLOAT, false, 0, 0);
      this.gl.enableVertexAttribArray(this.aColorLocation);

      if (isTextured) {
        var updatedUvs = new Float32Array(this.uvs.buffer, 0, (sides + 2) * 2);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.uvVertexBuf);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, updatedUvs);
        this.gl.vertexAttribPointer(this.aUvLocation, 2, this.gl.FLOAT, false, 0, 0);
        this.gl.enableVertexAttribArray(this.aUvLocation);
      }

      this.gl.uniform1f(this.texturedLoc, isTextured ? 1 : 0);
      this.gl.activeTexture(this.gl.TEXTURE0);
      this.gl.bindTexture(this.gl.TEXTURE_2D, prevTexture);
      this.gl.bindSampler(0, this.mainSampler);
      this.gl.uniform1i(this.textureLoc, 0);

      if (isAdditive) {
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);
      } else {
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
      }

      this.gl.drawArrays(this.gl.TRIANGLE_FAN, 0, sides + 2);

      if (hasBorder) {
        this.gl.useProgram(this.borderShaderProgram);
        var updatedBorderPos = new Float32Array(this.borderPositions.buffer, 0, (sides + 1) * 3);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.borderPositionVertexBuf);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, updatedBorderPos);
        this.gl.vertexAttribPointer(this.aBorderPosLoc, 3, this.gl.FLOAT, false, 0, 0);
        this.gl.enableVertexAttribArray(this.aBorderPosLoc);
        this.gl.uniform4fv(this.uBorderColorLoc, this.borderColor); // TODO: use drawArraysInstanced

        var instances = isBorderThick ? 4 : 1;

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

          this.gl.drawArrays(this.gl.LINE_STRIP, 0, sides + 1);
        }
      }
    }
  }]);

  return CustomShape;
}();



/***/ }),

