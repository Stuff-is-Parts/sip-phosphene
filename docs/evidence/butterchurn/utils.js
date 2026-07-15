/***/ "./src/utils.js":
/*!**********************!*\
  !*** ./src/utils.js ***!
  \**********************/
/*! exports provided: default */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "default", function() { return Utils; });
function _toConsumableArray(arr) { return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _nonIterableSpread(); }

function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance"); }

function _iterableToArray(iter) { if (Symbol.iterator in Object(iter) || Object.prototype.toString.call(iter) === "[object Arguments]") return Array.from(iter); }

function _arrayWithoutHoles(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = new Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

var Utils =
/*#__PURE__*/
function () {
  function Utils() {
    _classCallCheck(this, Utils);
  }

  _createClass(Utils, null, [{
    key: "atan2",
    value: function atan2(x, y) {
      var a = Math.atan2(x, y);

      if (a < 0) {
        a += 2 * Math.PI;
      }

      return a;
    }
  }, {
    key: "cloneVars",
    value: function cloneVars(vars) {
      return Object.assign({}, vars);
    }
  }, {
    key: "range",
    value: function range(start, end) {
      if (end === undefined) {
        return _toConsumableArray(Array(start).keys());
      }

      return Array.from({
        length: end - start
      }, function (_, i) {
        return i + start;
      });
    }
  }, {
    key: "pick",
    value: function pick(obj, keys) {
      var newObj = {};

      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        newObj[key] = obj[key];
      }

      return newObj;
    }
  }, {
    key: "omit",
    value: function omit(obj, keys) {
      var newObj = Object.assign({}, obj);

      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        delete newObj[key];
      }

      return newObj;
    }
  }]);

  return Utils;
}();



/***/ }),

