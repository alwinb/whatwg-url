"use strict";
const usm = require("./url-state-machine");
const urlencoded = require("./urlencoded");
const URLSearchParams = require("./URLSearchParams");
const log = console.log.bind (console)

exports.implementation = class URLImpl {
  constructor(globalObject, constructorArgs) {
    const url = constructorArgs[0];
    const base = constructorArgs[1];

    if (base == null)
      this._url = usm.parseAndResolveURL (url)

    else {
      const baseURL = usm.parseAndResolveURL (base)
      if (!baseURL.scheme) throw new TypeError (`Invalid base URL <${baseURL}>`)
      this._url = usm.parseAndResolveURL (url, baseURL)
    }

    const query = this._url.query !== null ? this._url.query : "";
    // We cannot invoke the "new URLSearchParams object" algorithm without going through the constructor, which strips
    // question mark by default. Therefore the doNotStripQMark hack is used.
    this._query = URLSearchParams.createImpl(globalObject, [query], { doNotStripQMark: true });
    this._query._url = this;
  }

  get href() {
    return usm.serializeURL(this._url);
  }

  set href(v) {
    const parsedURL = usm.basicURLParse(v);
    if (parsedURL === null) {
      throw new TypeError(`Invalid URL: ${v}`);
    }

    this._url = parsedURL;

    this._query._list.splice(0);
    const { query } = parsedURL;
    if (query !== null) {
      this._query._list = urlencoded.parseUrlencodedString(query);
    }
  }

  get origin() {
    return usm.serializeURLOrigin(this._url);
  }

  get protocol() {
    return this._url.scheme + ":";
  }

  set protocol(v) {
    usm.setTheScheme(this._url, v + ":");
  }

  get username() {
    if (this._url.username === null) {
      return "";
    }

    return this._url.username;
  }

  set username(v) {
    usm.setTheUsername(this._url, v);
  }

  get password() {
    if (this._url.password === null) {
      return "";
    }

    return this._url.password;
  }

  set password(v) {
    usm.setThePassword(this._url, v);
  }

  get host() {
    const url = this._url;

    if (url.host === null) {
      return "";
    }

    if (url.port === null) {
      return usm.serializeHost(url.host);
    }

    return usm.serializeHost(url.host) + ":" + usm.serializeInteger(url.port);
  }

  set host(v) {
    usm.setTheHost(this._url, v);
  }

  get hostname() {
    if (this._url.host === null) {
      return "";
    }

    return usm.serializeHost(this._url.host);
  }

  set hostname(v) {
    usm.setTheHostName(this._url, v);
  }

  get port() {
    if (this._url.port === null) {
      return "";
    }

    return usm.serializeInteger(this._url.port);
  }

  set port(v) {
    usm.setThePort (this._url, v);
  }

  get pathname() {
    return usm.serializePath(this._url);
  }

  set pathname(v) {
    if (this._url.cannotBeABaseURL) {
      return;
    }

    this._url.path = [];
    usm.setThePathName(this._url, v);
  }

  get search() {
    if (this._url.query === null || this._url.query === "") {
      return "";
    }

    return "?" + this._url.query;
  }

  set search(v) {
    const url = this._url;

    if (v === "") {
      url.query = null;
      this._query._list = [];
      return;
    }

    const input = v[0] === "?" ? v.substring(1) : v;
    url.query = "";
    usm.setTheQuery(this._url, input);
    this._query._list = urlencoded.parseUrlencodedString(input);
  }

  get searchParams() {
    return this._query;
  }

  get hash() {
    if (this._url.fragment === null || this._url.fragment === "") {
      return "";
    }

    return "#" + this._url.fragment;
  }

  set hash(v) {
    if (v === "") {
      this._url.fragment = null;
      return;
    }

    const input = v[0] === "#" ? v.substring(1) : v;
    this._url.fragment = "";
    usm.setTheFragment(this._url, input);
  }

  toJSON() {
    return this.href;
  }
};
