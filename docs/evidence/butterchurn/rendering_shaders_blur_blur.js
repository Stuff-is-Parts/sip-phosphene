/***/ "./src/rendering/shaders/blur/blur.js":
/*!********************************************!*\
  !*** ./src/rendering/shaders/blur/blur.js ***!
  \********************************************/
/*! exports provided: default */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "default", function() { return BlurShader; });
/* harmony import */ var _blurVertical__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./blurVertical */ "./src/rendering/shaders/blur/blurVertical.js");
/* harmony import */ var _blurHorizontal__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./blurHorizontal */ "./src/rendering/shaders/blur/blurHorizontal.js");
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }




var BlurShader =
/*#__PURE__*/
function () {
  function BlurShader(blurLevel, blurRatios, gl) {
    var opts = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : {};

    _classCallCheck(this, BlurShader);

    this.blurLevel = blurLevel;
    this.blurRatios = blurRatios;
    this.gl = gl;
    this.texsizeX = opts.texsizeX;
    this.texsizeY = opts.texsizeY;
    this.anisoExt = this.gl.getExtension('EXT_texture_filter_anisotropic') || this.gl.getExtension('MOZ_EXT_texture_filter_anisotropic') || this.gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    this.blurHorizontalFrameBuffer = this.gl.createFramebuffer();
    this.blurVerticalFrameBuffer = this.gl.createFramebuffer();
    this.blurHorizontalTexture = this.gl.createTexture();
    this.blurVerticalTexture = this.gl.createTexture();
    this.setupFrameBufferTextures();
    this.blurHorizontal = new _blurHorizontal__WEBPACK_IMPORTED_MODULE_1__["default"](gl, this.blurLevel, opts);
    this.blurVertical = new _blurVertical__WEBPACK_IMPORTED_MODULE_0__["default"](gl, this.blurLevel, opts);
  }

  _createClass(BlurShader, [{
    key: "updateGlobals",
    value: function updateGlobals(opts) {
      this.texsizeX = opts.texsizeX;
      this.texsizeY = opts.texsizeY;
      this.setupFrameBufferTextures();
    }
  }, {
    key: "getTextureSize",
    value: function getTextureSize(sizeRatio) {
      var sizeX = Math.max(this.texsizeX * sizeRatio, 16);
      sizeX = Math.floor((sizeX + 3) / 16) * 16;
      var sizeY = Math.max(this.texsizeY * sizeRatio, 16);
      sizeY = Math.floor((sizeY + 3) / 4) * 4;
      return [sizeX, sizeY];
    }
  }, {
    key: "setupFrameBufferTextures",
    value: function setupFrameBufferTextures() {
      var srcBlurRatios = this.blurLevel > 0 ? this.blurRatios[this.blurLevel - 1] : [1, 1];
      var dstBlurRatios = this.blurRatios[this.blurLevel];
      var srcTexsizeHorizontal = this.getTextureSize(srcBlurRatios[1]);
      var dstTexsizeHorizontal = this.getTextureSize(dstBlurRatios[0]);
      this.bindFrameBufferTexture(this.blurHorizontalFrameBuffer, this.blurHorizontalTexture, dstTexsizeHorizontal);
      var srcTexsizeVertical = dstTexsizeHorizontal;
      var dstTexsizeVertical = this.getTextureSize(dstBlurRatios[1]);
      this.bindFrameBufferTexture(this.blurVerticalFrameBuffer, this.blurVerticalTexture, dstTexsizeVertical);
      this.horizontalTexsizes = [srcTexsizeHorizontal, dstTexsizeHorizontal];
      this.verticalTexsizes = [srcTexsizeVertical, dstTexsizeVertical];
    }
  }, {
    key: "bindFrambufferAndSetViewport",
    value: function bindFrambufferAndSetViewport(fb, texsize) {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fb);
      this.gl.viewport(0, 0, texsize[0], texsize[1]);
    }
  }, {
    key: "bindFrameBufferTexture",
    value: function bindFrameBufferTexture(targetFrameBuffer, targetTexture, texsize) {
      this.gl.bindTexture(this.gl.TEXTURE_2D, targetTexture);
      this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, texsize[0], texsize[1], 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, new Uint8Array(texsize[0] * texsize[1] * 4));
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
    key: "renderBlurTexture",
    value: function renderBlurTexture(prevTexture, mdVSFrame, blurMins, blurMaxs) {
      this.bindFrambufferAndSetViewport(this.blurHorizontalFrameBuffer, this.horizontalTexsizes[1]);
      this.blurHorizontal.renderQuadTexture(prevTexture, mdVSFrame, blurMins, blurMaxs, this.horizontalTexsizes[0]);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.blurHorizontalTexture);
      this.gl.generateMipmap(this.gl.TEXTURE_2D);
      this.bindFrambufferAndSetViewport(this.blurVerticalFrameBuffer, this.verticalTexsizes[1]);
      this.blurVertical.renderQuadTexture(this.blurHorizontalTexture, mdVSFrame, this.verticalTexsizes[0]);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.blurVerticalTexture);
      this.gl.generateMipmap(this.gl.TEXTURE_2D);
    }
  }]);

  return BlurShader;
}();



/***/ }),

