"use strict";

const { URL, URLSearchParams } = require("./webidl2js-wrapper");
const urlStateMachine = require("./dist/url-state-machine");
const { percentDecodeBytes } = require("./dist/percent-encoding");

const sharedGlobalObject = {};
URL.install(sharedGlobalObject, ["Window"]);
URLSearchParams.install(sharedGlobalObject, ["Window"]);

module.exports = Object.assign (urlStateMachine, { 
  percentDecodeBytes,
  URL:sharedGlobalObject.URL,
  URLSearchParams:sharedGlobalObject.URLSearchParams
})
