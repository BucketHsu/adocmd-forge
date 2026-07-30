'use strict';

// @asciidoctor/core 3.x 的 ESM 入口與新版 glob 匯出不相容。
// 由 CommonJS require condition 載入官方 Node.js CJS bundle，確保 glob.sync 可用。
module.exports = require('@asciidoctor/core');
