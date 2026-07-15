/***/ "./src/rendering/shaders/shaderUtils.js":
/*!**********************************************!*\
  !*** ./src/rendering/shaders/shaderUtils.js ***!
  \**********************************************/
/*! exports provided: default */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "default", function() { return ShaderUtils; });
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

var lineMatcher = /uniform sampler2D sampler_(?:.+?);/g;
var samplerMatcher = /uniform sampler2D sampler_(.+?);/;

var ShaderUtils =
/*#__PURE__*/
function () {
  function ShaderUtils() {
    _classCallCheck(this, ShaderUtils);
  }

  _createClass(ShaderUtils, null, [{
    key: "getShaderParts",
    value: function getShaderParts(t) {
      var sbIndex = t.indexOf('shader_body');

      if (t && sbIndex > -1) {
        var beforeShaderBody = t.substring(0, sbIndex);
        var afterShaderBody = t.substring(sbIndex);
        var firstCurly = afterShaderBody.indexOf('{');
        var lastCurly = afterShaderBody.lastIndexOf('}');
        var shaderBody = afterShaderBody.substring(firstCurly + 1, lastCurly);
        return [beforeShaderBody, shaderBody];
      }

      return ['', t];
    }
  }, {
    key: "getFragmentFloatPrecision",
    value: function getFragmentFloatPrecision(gl) {
      if (gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision > 0) {
        return 'highp';
      } else if (gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT).precision > 0) {
        return 'mediump';
      }

      return 'lowp';
    }
  }, {
    key: "getUserSamplers",
    value: function getUserSamplers(text) {
      var samplers = [];
      var lineMatches = text.match(lineMatcher);

      if (lineMatches && lineMatches.length > 0) {
        for (var i = 0; i < lineMatches.length; i++) {
          var samplerMatches = lineMatches[i].match(samplerMatcher);

          if (samplerMatches && samplerMatches.length > 0) {
            var sampler = samplerMatches[1];
            samplers.push({
              sampler: sampler
            });
          }
        }
      }

      return samplers;
    }
  }]);

  return ShaderUtils;
}();



/***/ }),

