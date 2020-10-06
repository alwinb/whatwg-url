"use strict";
const punycode = require("punycode");
const tr46 = require("tr46");
const log = console.log.bind (console)

const infra = require("./infra");
const { isASCIIAlpha:isAlpha, isASCIIDigit:isDigit } = infra
const { utf8DecodeWithoutBOM } = require("./encoding");
const { percentDecodeString, utf8PercentEncodeCodePoint, utf8PercentEncodeString, isC0ControlPercentEncode,
  isFragmentPercentEncode, isQueryPercentEncode, isSpecialQueryPercentEncode, isPathPercentEncode,
  isUserinfoPercentEncode, isPathPartPercentEncode } = require("./percent-encoding");

function p(char) {
  return char.codePointAt(0);
}

const failure = Symbol("failure");

function at(input, idx) {
  const c = input[idx];
  return isNaN(c) ? undefined : String.fromCodePoint(c);
}

function isSingleDot(buffer) {
  return buffer === "." || buffer.toLowerCase() === "%2e";
}

function isDoubleDot(buffer) {
  buffer = buffer.toLowerCase();
  return buffer === ".." || buffer === "%2e." || buffer === ".%2e" || buffer === "%2e%2e";
}

function isWindowsDriveLetterString(string) {
  return string.length === 2 && infra.isASCIIAlpha(string.codePointAt(0)) && (string[1] === ":" || string[1] === "|");
}

function containsForbiddenHostCodePoint(string) {
  return string.search(/\u0000|\u0009|\u000A|\u000D|\u0020|#|%|\/|:|<|>|\?|@|\[|\\|\]|\^/) !== -1;
}

function containsForbiddenHostCodePointExcludingPercent(string) {
  return string.search(/\u0000|\u0009|\u000A|\u000D|\u0020|#|\/|:|<|>|\?|@|\[|\\|\]|\^/) !== -1;
}

function isSpecialScheme(scheme) {
  return specialSchemes[scheme] !== undefined;
}

function isSpecial(url) {
  return isSpecialScheme(url.scheme);
}

function isNotSpecial(url) {
  return !isSpecialScheme(url.scheme);
}

function defaultPort(scheme) {
  return specialSchemes[scheme];
}

function parseIPv4Number(input) {
  let R = 10;

  if (input.length >= 2 && input.charAt(0) === "0" && input.charAt(1).toLowerCase() === "x") {
    input = input.substring(2);
    R = 16;
  } else if (input.length >= 2 && input.charAt(0) === "0") {
    input = input.substring(1);
    R = 8;
  }

  if (input === "") {
    return 0;
  }

  let regex = /[^0-7]/;
  if (R === 10) {
    regex = /[^0-9]/;
  }
  if (R === 16) {
    regex = /[^0-9A-Fa-f]/;
  }

  if (regex.test(input)) {
    return failure;
  }

  return parseInt(input, R);
}

function parseIPv4(input) {
  const parts = input.split(".");
  if (parts[parts.length - 1] === "") {
    if (parts.length > 1) {
      parts.pop();
    }
  }

  if (parts.length > 4) {
    return input;
  }

  const numbers = [];
  for (const part of parts) {
    if (part === "") {
      return input;
    }
    const n = parseIPv4Number(part);
    if (n === failure) {
      return input;
    }

    numbers.push(n);
  }

  for (let i = 0; i < numbers.length - 1; ++i) {
    if (numbers[i] > 255) {
      return failure;
    }
  }
  if (numbers[numbers.length - 1] >= Math.pow(256, 5 - numbers.length)) {
    return failure;
  }

  let ipv4 = numbers.pop();
  let counter = 0;

  for (const n of numbers) {
    ipv4 += n * Math.pow(256, 3 - counter);
    ++counter;
  }

  return ipv4;
}

function serializeIPv4(address) {
  let output = "";
  let n = address;

  for (let i = 1; i <= 4; ++i) {
    output = String(n % 256) + output;
    if (i !== 4) {
      output = "." + output;
    }
    n = Math.floor(n / 256);
  }

  return output;
}

function parseIPv6(input) {
  const address = [0, 0, 0, 0, 0, 0, 0, 0];
  let pieceIndex = 0;
  let compress = null;
  let pointer = 0;

  input = punycode.ucs2.decode(input);

  if (input[pointer] === p(":")) {
    if (input[pointer + 1] !== p(":")) {
      return failure;
    }

    pointer += 2;
    ++pieceIndex;
    compress = pieceIndex;
  }

  while (pointer < input.length) {
    if (pieceIndex === 8) {
      return failure;
    }

    if (input[pointer] === p(":")) {
      if (compress !== null) {
        return failure;
      }
      ++pointer;
      ++pieceIndex;
      compress = pieceIndex;
      continue;
    }

    let value = 0;
    let length = 0;

    while (length < 4 && infra.isASCIIHex(input[pointer])) {
      value = value * 0x10 + parseInt(at(input, pointer), 16);
      ++pointer;
      ++length;
    }

    if (input[pointer] === p(".")) {
      if (length === 0) {
        return failure;
      }

      pointer -= length;

      if (pieceIndex > 6) {
        return failure;
      }

      let numbersSeen = 0;

      while (input[pointer] !== undefined) {
        let ipv4Piece = null;

        if (numbersSeen > 0) {
          if (input[pointer] === p(".") && numbersSeen < 4) {
            ++pointer;
          } else {
            return failure;
          }
        }

        if (!infra.isASCIIDigit(input[pointer])) {
          return failure;
        }

        while (infra.isASCIIDigit(input[pointer])) {
          const number = parseInt(at(input, pointer));
          if (ipv4Piece === null) {
            ipv4Piece = number;
          } else if (ipv4Piece === 0) {
            return failure;
          } else {
            ipv4Piece = ipv4Piece * 10 + number;
          }
          if (ipv4Piece > 255) {
            return failure;
          }
          ++pointer;
        }

        address[pieceIndex] = address[pieceIndex] * 0x100 + ipv4Piece;

        ++numbersSeen;

        if (numbersSeen === 2 || numbersSeen === 4) {
          ++pieceIndex;
        }
      }

      if (numbersSeen !== 4) {
        return failure;
      }

      break;
    } else if (input[pointer] === p(":")) {
      ++pointer;
      if (input[pointer] === undefined) {
        return failure;
      }
    } else if (input[pointer] !== undefined) {
      return failure;
    }

    address[pieceIndex] = value;
    ++pieceIndex;
  }

  if (compress !== null) {
    let swaps = pieceIndex - compress;
    pieceIndex = 7;
    while (pieceIndex !== 0 && swaps > 0) {
      const temp = address[compress + swaps - 1];
      address[compress + swaps - 1] = address[pieceIndex];
      address[pieceIndex] = temp;
      --pieceIndex;
      --swaps;
    }
  } else if (compress === null && pieceIndex !== 8) {
    return failure;
  }

  return address;
}

function serializeIPv6(address) {
  let output = "";
  const compress = findLongestZeroSequence(address);
  let ignore0 = false;

  for (let pieceIndex = 0; pieceIndex <= 7; ++pieceIndex) {
    if (ignore0 && address[pieceIndex] === 0) {
      continue;
    } else if (ignore0) {
      ignore0 = false;
    }

    if (compress === pieceIndex) {
      const separator = pieceIndex === 0 ? "::" : ":";
      output += separator;
      ignore0 = true;
      continue;
    }

    output += address[pieceIndex].toString(16);

    if (pieceIndex !== 7) {
      output += ":";
    }
  }

  return output;
}

function parseHost(input, isNotSpecialArg = false) {
  if (input[0] === "[") {
    if (input[input.length - 1] !== "]") {
      return failure;
    }

    return parseIPv6(input.substring(1, input.length - 1));
  }

  if (isNotSpecialArg) {
    return parseOpaqueHost(input);
  }

  const domain = utf8DecodeWithoutBOM(percentDecodeString(input));
  const asciiDomain = domainToASCII(domain);
  if (asciiDomain === failure) {
    return failure;
  }

  if (containsForbiddenHostCodePoint(asciiDomain)) {
    return failure;
  }

  const ipv4Host = parseIPv4(asciiDomain);
  if (typeof ipv4Host === "number" || ipv4Host === failure) {
    return ipv4Host;
  }

  return asciiDomain;
}

function parseOpaqueHost(input) {
  if (containsForbiddenHostCodePointExcludingPercent(input)) {
    return failure;
  }

  return utf8PercentEncodeString(input, isC0ControlPercentEncode);
}

function findLongestZeroSequence(arr) {
  let maxIdx = null;
  let maxLen = 1; // only find elements > 1
  let currStart = null;
  let currLen = 0;

  for (let i = 0; i < arr.length; ++i) {
    if (arr[i] !== 0) {
      if (currLen > maxLen) {
        maxIdx = currStart;
        maxLen = currLen;
      }

      currStart = null;
      currLen = 0;
    } else {
      if (currStart === null) {
        currStart = i;
      }
      ++currLen;
    }
  }

  // if trailing zeros
  if (currLen > maxLen) {
    return currStart;
  }

  return maxIdx;
}

function serializeHost(host) {
  if (typeof host === "number") {
    return serializeIPv4(host);
  }

  // IPv6 serializer
  if (host instanceof Array) {
    return "[" + serializeIPv6(host) + "]";
  }

  return host;
}

function domainToASCII(domain, beStrict = false) {
  const result = tr46.toASCII(domain, {
    checkBidi: true,
    checkHyphens: false,
    checkJoiners: true,
    useSTD3ASCIIRules: beStrict,
    verifyDNSLength: beStrict
  });
  if (result === null || result === "") {
    return failure;
  }
  return result;
}

function trimControlChars(url) {
  return url.replace(/^[\u0000-\u001F\u0020]+|[\u0000-\u001F\u0020]+$/g, "");
}

function trimTabAndNewline(url) {
  return url.replace(/\u0009|\u000A|\u000D/g, "");
}

function includesCredentials(url){
  return url.username !== "" || url.password !== ""; // REVIEW
}

function cannotHaveAUsernamePasswordPort(url) {
  return url.host === null || url.host === "" || url.cannotBeABaseURL || url.scheme === "file";
}

function isNormalizedWindowsDriveLetter(string) {
  return /^[A-Za-z]:$/.test(string);
}


// URL Model
// ---------

// parserModes are needed for parsing relative URLs
// They specify the scheme-dependent behaviour to use when parsing scheme-less URL-strings. 

const specialSchemes =
  { ftp: 21, file: null, http: 80, https: 443, ws: 80, wss: 443 };

const parserModes = 
  { file: Symbol('file'), web: Symbol('web'), nonSpecial: Symbol('nonSpecial') }

function parserModeFor (url) {
  return url == null || url._scheme == null ? parserModes.web
    : url._scheme === 'file' ? parserModes.file
    : url._scheme in specialSchemes ? parserModes.web
    : parserModes.nonSpecial
}

// PercentCoding modes are only used internally, they are derived from the 
// UrlRecord's scheme and/or structure to select different encode-sets. 

const percentCodingModes =
  { R: Symbol('regular'), S:Symbol('special'), B:Symbol('nonbase') }

function percentCodingModeFor (url) {
  return isSpecial(url) ? percentCodingModes.S : 
    url.cannotBeBase () ? percentCodingModes.B :
    percentCodingModes.R
}

// tokenTypes are used internally  by the resolve/ goto operations. 

const tokenTypes =
  { scheme:1, auth:2, drive:3, pathRoot:4, dir:5, file:6, query:7, fragment:8 }

class UrlRecord {

  constructor () {
    this.scheme = null
    this.username = null
    this.password = null
    this.host = null
    this.port = null
    this.drive = null
    this.pathRoot = null
    this.dirs = []
    this.file = null
    this.query = null
    this.fragment = null
  }

  fromString (input, mode) {
    return parseURL (input, mode)
  }

  toString () {
    return serializeURL (this)
  }

  get href () {
    return this.toString ()
  }

  get _scheme () { // lowercase scheme - for scheme comparisons
    return this.scheme == null ? null : this.scheme.toLowerCase ()
  }

  _setAuthFromString (str) {
    Object.assign (this, parseAuthority (str))
    if (this.host) {
      const _host = parseHost (this.host, !isSpecial(this))
      if (_host === failure)
        throw new TypeError (`Invalid hostname <${this.host}> in <${this}>`)
      this.host = _host
    }
  }

  // ### Predicates

  hasSubstantialAuth () {
    // This is equivalent to the authority-string being nonempty. 
    return this.host != null && this.host !== '' ||
      this.username != null || this.password != null || this.port != null
  }

  cannotBeBase () {
    const { scheme, host, drive, pathRoot, file } = this
    return host == null && !pathRoot && scheme && !(scheme in specialSchemes)
  }

  get cannotBeABaseURL () {
    return this.cannotBeBase () // Compat
  }

  isAFragmentOnlyURL () {
    return this.getFirstTokenType () === tokenTypes.fragment && this.fragment != null
  }

  has (key) {
    return key === 'dir' ? this.dirs.length > 0
      : key === 'auth' ? this.host != null
      : this[key] != null
  }

  getFirstTokenType ({ ignoringScheme = null } = { }) {
    for (let k in tokenTypes) if (this.has (k))
      if (k !== 'scheme' || ignoringScheme !== this._scheme)
        return tokenTypes[k]
    return tokenTypes.fragment
  }


  // ### Validation

  assertConstraints () {
    // TODO also check root?
    const specialHasHost = isSpecial (this) && this._scheme !== 'file' ? this.host !== '' : true
    const passHasUser = this.password != null ? this.username != null : true
    const fileSimpleAuth = this._scheme === 'file' ? this.username == null && this.port == null : true
    const userPortHaveHost = this.username != null || this.port != null ? this.host != null && this.host !== '' : true
    let portIsValid = true // just a moment,

    if (this.port != null) {
      // REVIEW should we allow storing numbers as strings? and throw here?
      let port = this.port
      let validIfString = true
      if (typeof port === 'string') {
        validIfString = /^[0-9]*$/.test (port)
        port = +port
      }
      portIsValid = this.port === '' || validIfString && 0 <= port && port < 2**16
    }
    //log ({specialHasHost , passHasUser , fileSimpleAuth , userPortHaveHost , portIsValid})
    if (specialHasHost && passHasUser && fileSimpleAuth && userPortHaveHost && portIsValid)
      return this

    else
      throw new TypeError (`Invalid URL <${this}>`)
  }


  // ### Operations
  
  goto (url2) { // Returns a new UrlRecord
    const url = new UrlRecord ()
    const t2 = url2.getFirstTokenType ({ ignoringScheme: this._scheme })
    for (let k in tokenTypes) {
      const t = tokenTypes[k]
      if (t === tokenTypes.dir) {
        if (t < t2) url.dirs = this.dirs.slice ()
        else if (t === t2) url.dirs = this.dirs.concat (url2.dirs)
        else url.dirs = url2.dirs.slice ()
      }
      else if (t === tokenTypes.auth) {
        const { username, password, host, port } = t < t2 ? this : url2
        Object.assign (url, { username, password, host, port })
      }
      else {
        url[k] = t < t2 ? this[k] : url2[k]
      }
    }
    // Set implicit pathRoot
    if (!this.pathRoot && (this.host != null || this.drive) && (this.dirs.length || this.file))
      this.pathRoot = '/'
    return url
  }

  force () { // NB Mutates
    if (isSpecial (this)) {

      if (!this.drive && !this.pathRoot)
        this.pathRoot = '/'

      if (this.hasSubstantialAuth ())
        return this

      if (this._scheme === 'file') {
        this.host = ''
        return this
      } 

      // Steal the authString from the first nonempty path segment
      let i = 0, l = this.dirs.length
      for (; i < l && this.dirs[i] === ''; i++);
      if (i < l && this.dirs[i] !== '') {
        const authString = this.dirs[i]
        this.pathRoot = '/'
        this.dirs = this.dirs.slice (i+1)
        this._setAuthFromString (authString)
        return this
      }
      if (this.host == null && this.file) {
        const authString = this.file
        this.dirs = []
        this.file = null
        this._setAuthFromString (authString)
        return this
      }
      throw new TypeError (`Cannot convert <${this}> to a base URL`)
      }
    return this
  }

  normalize () { // Mutates
    this.scheme = this._scheme
    this.normalizeAuthority ()
    this.normalizePath ()
    return this
  }

  normalizeAuthority () { // Mutates
    let { username, password, host, port } = this
    if (password === '') password = null
    if (username === '' && password === null) username = null
    // NB note the string comparison; since we allow storing strings as well at the moment. 
    if (port === '' || port+'' === defaultPort (this._scheme)+'') port = null 
    if (this._scheme === 'file' && typeof host === 'string' && host.toLowerCase () === 'localhost')
      host = ''
    return Object.assign (this, { username, password, host, port })
  }

  normalizePath () { // Mutates
    let { drive, pathRoot, dirs, file } = this
    if (drive) drive = drive[0] + ':'
    if (pathRoot) pathRoot = '/'

    const normalizedDirs = []
    for (let dir of dirs)
      if (isDoubleDot (dir)) normalizedDirs.pop ()
      else if (!isSingleDot (dir)) normalizedDirs.push (dir)

    if (file) {
      if (isDoubleDot(file)) {
        normalizedDirs.pop ()
        file = null
      }
      else if (isSingleDot (file))
        file = null
    }

    // This should possibly be part of something else, alike, assertConstraints
    if (!pathRoot && (this.host != null || drive) && (dirs.length || file)) {
      pathRoot = '/'
    }

    return Object.assign (this, { drive, pathRoot, dirs:normalizedDirs, file })
  }

  percentEncode () { // Mutates
    const mode = isSpecial(this) ? percentCodingModes.S : this.cannotBeBase () ? percentCodingModes.B : percentCodingModes.R
    for (let k in _encodedProperties) if (this.has (k)) {
      if (k === 'dir')
        this.dirs = this.dirs.map (_ => _encode ('dir', _, mode))
      else if (typeof this[k] === 'string') // Hack to prevent escaping parsed host
        this[k] = _encode (k, this[k], mode)
    }
    return this
  }
  
}


// ### Percent coding

const _encodedProperties =
  { username:12, password:12, /*host:9,*/ dir:6, file:6, query:3, fragment:0 }

const _encode = (key, str, mode = percentCodingModes.R) =>
  utf8PercentEncodeString (str, getPercentEncodePredicate (key, mode))

function getPercentEncodePredicate (key, mode = percentCodingModes.R) {
  if (key === 'username' || key === 'password')
    return isUserinfoPercentEncode

  if (key === 'dir' || key === 'file')
    return mode === percentCodingModes.B ? isC0ControlPercentEncode
      : isPathPartPercentEncode

  if (key === 'query')
    return mode === percentCodingModes.S ? isSpecialQueryPercentEncode
      : isQueryPercentEncode

  if (key === 'fragment')
    return isFragmentPercentEncode

}


// URL parser
// ----------

const isDotOrSign = c =>
  c === 0x2E || c === 0x2B || c === 0x2D;

const isSchemeCtd = c =>
  isAlpha (c) || isDigit (c) || isDotOrSign (c);

const isStrictNonSep = c =>
  !(c === p ('/') || c === p ('#') || c === p ('?'))

const isSpecialNonSep = c =>
  !(c === p ('/') || c === p ('\\') || c === p ('#') || c === p ('?'))

const isStrictSlash = c => 
  c === p ('/')

const isSpecialSlash = c =>
  c === p ('/') || c === p ('\\')

function inputToString (input, from, to = input.length) {
  return String.fromCodePoint (...input.slice (from, to))
}

// The new URL parser that supports relative URLs.
// input is a list of codepoints.

function URLParser (input, mode) {
  const url = new UrlRecord // result
  let _scheme = null        // lowerCased scheme
  let pointer = 0           // current position
  let c = input[pointer]    // invariant: c === input[pointer]
  let isSlash, isNonSep     // scheme dependent codepoint predicates.

  configure ()
  this.parse = parse
  this.parsePath = parsePath
  this.parseScheme = parseScheme

  function configure () {
    [isSlash, isNonSep] = (_scheme in specialSchemes) || mode !== parserModes.nonSpecial
      ? [isSpecialSlash, isSpecialNonSep]
      : [isStrictSlash,  isStrictNonSep];
  }

  function parse () { // parse a relative (or absolute) URL

    // Scheme -- possibly
    parseScheme ()

    // Reconfigure mode
    if (url.scheme) {
      mode = parserModeFor (url)
      configure ()
    }

    // AuthString -- if input starts with //
    if (isSlash (c) && isSlash (input[pointer+1])) {
      const tokenStart = pointer + 2
      pointer++
      do c = input[++pointer]
      while (c != null && isNonSep (c))
      url.authString = inputToString (input, tokenStart, pointer)
    }

    // Root, Dirs, File
    parsePath (false)

    // Query
    if (c === p ('?'))
      parseQuery ()

    // Fragment
    if (c === p ('#'))
      url.fragment = inputToString (input, pointer+1, input.length)
    
    // Detect drive letters
    if (_scheme === 'file' || _scheme == null && mode === parserModes.file)
      _detectDrive (url)

    // Parse the opaque authString
    if (url.authString != null) {
      Object.assign (url, parseAuthority (url.authString))
      delete url.authString
      if (url.host) {
        const host = parseHost (url.host, mode === parserModes.nonSpecial)
        if (host === failure)
          throw new TypeError (`Invalid hostname: ${url.host}`)
        else url.host = host
      }
    }
    return url
  }
  

  function parseScheme () {
    if (isAlpha (c)) {
      do c = input[++pointer]
      while (isSchemeCtd (c))
      if (c === p(':')) {
        url.scheme = inputToString (input, 0, pointer)
        _scheme = url.scheme.toLowerCase ()
        c = input[++pointer]
      }
      else c = input[pointer = 0]
    }
    return url
  }

  function parsePath (standAlone = true) {
    if (isSlash (c)) { // pathRoot
      url.pathRoot = inputToString (input, pointer, pointer + 1)
      c = input[++pointer]
    }
    if (c != null) { // dirs and file
      let tokenStart = pointer
      while (c != null && (standAlone || c !== p('?') && c !== p('#'))) {
        if (isSlash (c)) {
          url.dirs.push (inputToString (input, tokenStart, pointer))
          tokenStart = pointer+1
        }
        c = input[++pointer]
      }
      if (tokenStart-pointer)
        url.file = inputToString (input, tokenStart, pointer)
    }
    return url
  }

  function parseQuery () {
    const tokenStart = pointer+1
    do c = input[++pointer]
    while (c != null && c !== p('#'))
    url.query = inputToString (input, tokenStart, pointer)
    return url
  }

}

// parseUrlFromCodePoints uses _detectDrive. 
// _detectDrive applies drive letter detection and mutates url. 

const isDrive = str => str != null && isWindowsDriveLetterString (str)
function _detectDrive (url) {
  if (isDrive (url.authString))
    [url.authString, url.drive] = ['', url.authString]
  else if (url.dirs.length && isDrive (url.dirs[0]))
    [url.pathRoot, url.drive] = ['/', url.dirs.shift()]
  else if (!url.dirs.length && isDrive (url.file))
    [url.pathRoot, url.drive, url.file] = [null, url.file, null]
  return url
}


// ### Authority parser
// Notes:
// - The last @ is the nameinfo-host separator
// - The first : before the last @ is the username-password separator
// - The first : after the last @ is the host-port separator
// - username cannot contain : but may contain @
// - pass may contain both : and @ 
// - host cannot contain : nor @ (except, : within brackets)
// - port cannot contain @

function parseAuthority (string) {
  let [last_at, port_col, first_col, bracks] = [-1, -1, -1, false]

  for (let i=0, l=string.length; i<l; i++) {
    const c = string [i]
    if (c === '@') {
      last_at = i
      bracks = false
    }
    else if (c === ':') {
      if (first_col < 0) first_col = i
      if (port_col <= last_at && !bracks) port_col = i
    }
    else if (c === '[') bracks = true
    else if (c === ']') bracks = false
  }

  let username = null, password = null, host = null, port = null

  if (last_at >= 0) { // has credentials
    if (0 <= first_col && first_col < last_at) { // has password
      username = string.substring (0, first_col)
      password = string.substring (first_col + 1, last_at)
    }
    else
      username = string.substring (0, last_at)
  }

  if (port_col > last_at) { // has port
    host = string.substring (last_at + 1, port_col)
    port = string.substr (port_col + 1)
    if (/^[0-9]+$/.test (port)) port = parseInt (port, 10)
    // Port is parsed as a number (or empty string) if valid, or as a string otherwise
  }

  else
    host = string.substr (last_at + 1)

  return { username, password, host, port }
}


// ### Wrapping it all up

function prepareInput (str) {
  str = trimTabAndNewline(str);
  str = trimControlChars(str);
  return punycode.ucs2.decode (str);
}

function parseURL (str, mode) {
  return new URLParser (prepareInput (str), mode) .parse ();
}

function parseAndResolveURL (urlString, baseURL = null) {
  let resolvedURL
  if (baseURL != null) {
    const inputURL = parseURL (urlString, parserModeFor (baseURL))
    if (!baseURL.cannotBeABaseURL || inputURL.isAFragmentOnlyURL ())
      resolvedURL = baseURL.goto (inputURL)
    else
      resolvedURL = inputURL
  }
  else {
    resolvedURL = parseURL (urlString, parserModeFor (null))
  }

  if (!resolvedURL.scheme || resolvedURL.isAFragmentOnlyURL ())
    throw new TypeError (`parseAndResolveURL called on relative URL string <${urlString}>`)

  return resolvedURL.force () .assertConstraints () .normalize () .percentEncode ()
}


// URL printer
// -----------

function serializeURL (url, excludeFragment) {
  let output = '', hasAuth = false 
  // REVIEW (hasAuth) Disambiguate dirs starting with ['']
  // TODO disambiguate dirs[0] if drive-letter like as well (file issue). 
  if (url.scheme != null) output += url.scheme + ':'
  if (url.host  != null) {
    output += '//' + serializeAuthority (url)
    hasAuth = true
  }
  if (url.drive != null) output += '/' + url.drive
  if (url.pathRoot != null) output += '/'
  if (!hasAuth && url.dirs.length && url.dirs[0] === '') output += './'
  for (let dir of url.dirs) output += dir + '/'
  if (url.file  != null) output += url.file
  if (url.query != null) output += "?" + url.query
  if (url.fragment != null && !excludeFragment) output += '#' + url.fragment
  return output
}

function serializeAuthority ({ username, password, host, port }) {
  let output = '';
  if (username != null) output += username;
  if (password != null) output += ':' + password;
  if (output != '') output += '@';
  output += serializeHost(host);
  if (port != null) output += ':' + port;
  return output;
}

function serializeOrigin ({ scheme, host, port }) {
  let result = scheme + "://";
  result += serializeHost (host);
  if (port !== null) result += ":" + port
  return result;
}

function serializePath ({ drive, pathRoot, dirs, file }) {
  let output = '';
  if (drive) output += '/'+drive;
  if (pathRoot) output += '/';
  if (dirs.length) output += dirs.join ('/') + '/';
  if (file) output += file;
  return output;
}


// Setters
// -------
// These implement the setters for the legacy URL class. 
// To be honest, these have such strange behaviour that they should not
// be part of the core API but implemented as a compat-wrapper. 

function _assign (url, patch) {
  // Ann unpleasant trick, to pre-validate, NB mutates patch
  Object.setPrototypeOf (patch, url)
  try {
    patch.assertConstraints ()
    Object.assign (url, patch) .normalizeAuthority ()
  }
  catch (e) { }
}

function setTheScheme (url, str) {
  const patch = new URLParser (prepareInput(str)) .parseScheme ()
  if (patch.scheme && (parserModeFor (url) === parserModeFor (patch)))
    _assign (url, { scheme:patch._scheme })
  return url
}

function setTheUsername (url, username) {
  username = utf8PercentEncodeString(username, isUserinfoPercentEncode);
  _assign (url, { username });
  return url;
}

function setThePassword (url, password) {
  const username = url.username == null ? '' : url.username
  password = utf8PercentEncodeString(password, isUserinfoPercentEncode);
  _assign (url, { username, password });
  return url;
}

function setTheHost (url, str) {
  if (!url.cannotBeBase ()) {
    str = '//' + trimTabAndNewline (str) + '/'
    try {
      let { username, host, port } = parseURL (str, parserModeFor (url))
      if (username == null) {
        if (!(port && (port = parsePort (port)) !== failure)) port = url.port // don't update port
        _assign (url, { host, port })
      }
    } catch (e) {}
  }
  return url
}

// Apparently the host and hostname setter both take a non-standard
// authority string as input, but if it constains credentials then the 
// entire string is ignored. There's also strange rules for the presence of a port. 

function setTheHostName (url, str) {
  if (!url.cannotBeBase ()) {
    str = trimTabAndNewline (str)
    str = '//' + trimTabAndNewline (str) + '/'
    try {
      let { username, host, port } = parseURL (str, parserModeFor (url))
      if (username == null && (port == null || url._scheme !== 'file'))
        _assign (url, { host })
    } catch (e) { }
  }
  return url
}

// a port parser used in the _setters_ only
function parsePort (str) {
  if (str === '') return ''
  str = /^([0-9]*)/.exec (str) [1]
  const port = +str
  return (str.length && 0 <= port && port < 2**16) ? port : failure
}

function setThePort (url, portString) {
  let port = parsePort (trimTabAndNewline (portString))
  _assign (url, { port })
  return url
}

function setThePathName (url, str) {
  const input = punycode.ucs2.decode (trimTabAndNewline (str))
  const { pathRoot:_root, drive, dirs, file } = new URLParser (input, parserModeFor (url)) .parsePath () .percentEncode ()
  const pathRoot = url.pathRoot || _root // Setting a relative path does not unset a pathRoot if present
  Object.assign (url, { pathRoot, drive, dirs, file }) .normalizePath () // set possible implicit pathRoot
  return url
}

function setTheQuery (url, str) {
  const mode = percentCodingModeFor (url)
  str = _encode ('query', trimTabAndNewline (str), mode)
  url.query = str
  return url
}

function setTheFragment (url, str) {
  const mode = percentCodingModeFor (url)
  str = _encode ('fragment', trimTabAndNewline (str), mode)
  url.fragment = str
  return url
}


//////

function serializeURLOrigin (url) {
  // https://url.spec.whatwg.org/#concept-url-origin
  switch (url.scheme) {
    case "blob":
      try {
        return serializeURLOrigin(parseURL(url.path[0]));
      } catch (e) {
        // serializing an opaque origin returns "null"
        return "null";
      }
    case "ftp":
    case "http":
    case "https":
    case "ws":
    case "wss":
      return serializeOrigin({
        scheme: url.scheme,
        host: url.host,
        port: url.port
      });
    case "file":
      // The spec says:
      // > Unfortunate as it is, this is left as an exercise to the reader. When in doubt, return a new opaque origin.
      // Browsers tested so far:
      // - Chrome says "file://", but treats file: URLs as cross-origin for most (all?) purposes; see e.g.
      //   https://bugs.chromium.org/p/chromium/issues/detail?id=37586
      // - Firefox says "null", but treats file: URLs as same-origin sometimes based on directory stuff; see
      //   https://developer.mozilla.org/en-US/docs/Archive/Misc_top_level/Same-origin_policy_for_file:_URIs
      return "null";
    default:
      // serializing an opaque origin returns "null"
      return "null";
  }
};

function serializeInteger (integer) {
  return String(integer);
}

// function parseURL (input, options) {
//   if (options === undefined) {
//     options = {};
//   }
//
//   // We don't handle blobs, so this just delegates:
//   return parseAndResolveURL (input, options.baseURL)
// }

module.exports = {
  UrlRecord,
  setTheScheme, setTheUsername, setThePassword, setTheHost, setTheHostName, setThePort, setThePathName, setTheQuery, setTheFragment,
  serializeURL, serializeURLOrigin, serializeHost, serializeInteger, serializePath, 
  parserModes, parseAndResolveURL, parseURL, parseHost, 
}
