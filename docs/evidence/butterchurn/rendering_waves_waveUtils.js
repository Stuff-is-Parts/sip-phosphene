/***/ "./src/rendering/waves/waveUtils.js":
/*!******************************************!*\
  !*** ./src/rendering/waves/waveUtils.js ***!
  \******************************************/
/*! exports provided: default */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "default", function() { return WaveUtils; });
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

var WaveUtils =
/*#__PURE__*/
function () {
  function WaveUtils() {
    _classCallCheck(this, WaveUtils);
  }

  _createClass(WaveUtils, null, [{
    key: "smoothWave",

    /* eslint-disable no-param-reassign */
    value: function smoothWave(positions, positionsSmoothed, nVertsIn) {
      var zCoord = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;
      var c1 = -0.15;
      var c2 = 1.15;
      var c3 = 1.15;
      var c4 = -0.15;
      var invSum = 1.0 / (c1 + c2 + c3 + c4);
      var j = 0;
      var iBelow = 0;
      var iAbove;
      var iAbove2 = 1;

      for (var i = 0; i < nVertsIn - 1; i++) {
        iAbove = iAbove2;
        iAbove2 = Math.min(nVertsIn - 1, i + 2);

        for (var k = 0; k < 3; k++) {
          positionsSmoothed[j * 3 + k] = positions[i * 3 + k];
        }

        if (zCoord) {
          for (var _k = 0; _k < 3; _k++) {
            positionsSmoothed[(j + 1) * 3 + _k] = (c1 * positions[iBelow * 3 + _k] + c2 * positions[i * 3 + _k] + c3 * positions[iAbove * 3 + _k] + c4 * positions[iAbove2 * 3 + _k]) * invSum;
          }
        } else {
          for (var _k2 = 0; _k2 < 2; _k2++) {
            positionsSmoothed[(j + 1) * 3 + _k2] = (c1 * positions[iBelow * 3 + _k2] + c2 * positions[i * 3 + _k2] + c3 * positions[iAbove * 3 + _k2] + c4 * positions[iAbove2 * 3 + _k2]) * invSum;
          }

          positionsSmoothed[(j + 1) * 3 + 2] = 0;
        }

        iBelow = i;
        j += 2;
      }

      for (var _k3 = 0; _k3 < 3; _k3++) {
        positionsSmoothed[j * 3 + _k3] = positions[(nVertsIn - 1) * 3 + _k3];
      }
    }
  }, {
    key: "smoothWaveAndColor",
    value: function smoothWaveAndColor(positions, colors, positionsSmoothed, colorsSmoothed, nVertsIn) {
      var zCoord = arguments.length > 5 && arguments[5] !== undefined ? arguments[5] : false;
      var c1 = -0.15;
      var c2 = 1.15;
      var c3 = 1.15;
      var c4 = -0.15;
      var invSum = 1.0 / (c1 + c2 + c3 + c4);
      var j = 0;
      var iBelow = 0;
      var iAbove;
      var iAbove2 = 1;

      for (var i = 0; i < nVertsIn - 1; i++) {
        iAbove = iAbove2;
        iAbove2 = Math.min(nVertsIn - 1, i + 2);

        for (var k = 0; k < 3; k++) {
          positionsSmoothed[j * 3 + k] = positions[i * 3 + k];
        }

        if (zCoord) {
          for (var _k4 = 0; _k4 < 3; _k4++) {
            positionsSmoothed[(j + 1) * 3 + _k4] = (c1 * positions[iBelow * 3 + _k4] + c2 * positions[i * 3 + _k4] + c3 * positions[iAbove * 3 + _k4] + c4 * positions[iAbove2 * 3 + _k4]) * invSum;
          }
        } else {
          for (var _k5 = 0; _k5 < 2; _k5++) {
            positionsSmoothed[(j + 1) * 3 + _k5] = (c1 * positions[iBelow * 3 + _k5] + c2 * positions[i * 3 + _k5] + c3 * positions[iAbove * 3 + _k5] + c4 * positions[iAbove2 * 3 + _k5]) * invSum;
          }

          positionsSmoothed[(j + 1) * 3 + 2] = 0;
        }

        for (var _k6 = 0; _k6 < 4; _k6++) {
          colorsSmoothed[j * 4 + _k6] = colors[i * 4 + _k6];
          colorsSmoothed[(j + 1) * 4 + _k6] = colors[i * 4 + _k6];
        }

        iBelow = i;
        j += 2;
      }

      for (var _k7 = 0; _k7 < 3; _k7++) {
        positionsSmoothed[j * 3 + _k7] = positions[(nVertsIn - 1) * 3 + _k7];
      }

      for (var _k8 = 0; _k8 < 4; _k8++) {
        colorsSmoothed[j * 4 + _k8] = colors[(nVertsIn - 1) * 4 + _k8];
      }
    }
    /* eslint-enable no-param-reassign */

  }]);

  return WaveUtils;
}();



/***/ }),

