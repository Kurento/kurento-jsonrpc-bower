(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.RpcBuilder = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
function Mapper() {
  var sources = {};

  this.forEach = function (callback) {
    for (var key in sources) {
      var source = sources[key];

      for (var key2 in source)
        callback(source[key2]);
    };
  };

  this.get = function (id, source) {
    var ids = sources[source];
    if (ids == undefined)
      return undefined;

    return ids[id];
  };

  this.remove = function (id, source) {
    var ids = sources[source];
    if (ids == undefined)
      return;

    delete ids[id];

    // Check it's empty
    for (var i in ids) {
      return false
    }

    delete sources[source];
  };

  this.set = function (value, id, source) {
    if (value == undefined)
      return this.remove(id, source);

    var ids = sources[source];
    if (ids == undefined)
      sources[source] = ids = {};

    ids[id] = value;
  };
};

Mapper.prototype.pop = function (id, source) {
  var value = this.get(id, source);
  if (value == undefined)
    return undefined;

  this.remove(id, source);

  return value;
};

module.exports = Mapper;

},{}],2:[function(require,module,exports){
/*
 * (C) Copyright 2014 Kurento (http://kurento.org/)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

var JsonRpcClient = require('./jsonrpcclient');

exports.JsonRpcClient = JsonRpcClient;

},{"./jsonrpcclient":3}],3:[function(require,module,exports){
/*
 * (C) Copyright 2014 Kurento (http://kurento.org/)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

var RpcBuilder = require('../..');
var WebSocketWithReconnection = require(
  './transports/webSocketWithReconnection');

Date.now = Date.now || function () {
  return +new Date;
};

var PING_INTERVAL = 5000;

var RECONNECTING = 'RECONNECTING';
var CONNECTED = 'CONNECTED';
var DISCONNECTED = 'DISCONNECTED';

var Logger = console;

/**
 *
 * heartbeat: interval in ms for each heartbeat message,
 * sendCloseMessage : true / false, before closing the connection, it sends a closeSession message
 * <pre>
 * ws : {
 * 	uri : URI to conntect to,
 *  useSockJS : true (use SockJS) / false (use WebSocket) by default,
 * 	onconnected : callback method to invoke when connection is successful,
 * 	ondisconnect : callback method to invoke when the connection is lost,
 * 	onreconnecting : callback method to invoke when the client is reconnecting,
 * 	onreconnected : callback method to invoke when the client succesfully reconnects,
 * 	onerror : callback method to invoke when there is an error
 * },
 * rpc : {
 * 	requestTimeout : timeout for a request,
 * 	sessionStatusChanged: callback method for changes in session status,
 * 	mediaRenegotiation: mediaRenegotiation
 * }
 * </pre>
 */
function JsonRpcClient(configuration) {

  var self = this;

  var wsConfig = configuration.ws;

  var notReconnectIfNumLessThan = -1;

  var pingNextNum = 0;
  var enabledPings = true;
  var pingPongStarted = false;
  var pingInterval;

  var status = DISCONNECTED;

  var onreconnecting = wsConfig.onreconnecting;
  var onreconnected = wsConfig.onreconnected;
  var onconnected = wsConfig.onconnected;
  var onerror = wsConfig.onerror;

  configuration.rpc.pull = function (params, request) {
    request.reply(null, "push");
  }

  wsConfig.onreconnecting = function () {
    Logger.debug("--------- ONRECONNECTING -----------");
    if (status === RECONNECTING) {
      Logger.error(
        "Websocket already in RECONNECTING state when receiving a new ONRECONNECTING message. Ignoring it"
      );
      return;
    }

    status = RECONNECTING;
    if (onreconnecting) {
      onreconnecting();
    }
  }

  wsConfig.onreconnected = function () {
    Logger.debug("--------- ONRECONNECTED -----------");
    if (status === CONNECTED) {
      Logger.error(
        "Websocket already in CONNECTED state when receiving a new ONRECONNECTED message. Ignoring it"
      );
      return;
    }
    status = CONNECTED;

    enabledPings = true;
    updateNotReconnectIfLessThan();
    usePing();

    if (onreconnected) {
      onreconnected();
    }
  }

  wsConfig.onconnected = function () {
    Logger.debug("--------- ONCONNECTED -----------");
    if (status === CONNECTED) {
      Logger.error(
        "Websocket already in CONNECTED state when receiving a new ONCONNECTED message. Ignoring it"
      );
      return;
    }
    status = CONNECTED;

    enabledPings = true;
    usePing();

    if (onconnected) {
      onconnected();
    }
  }

  wsConfig.onerror = function (error) {
    Logger.debug("--------- ONERROR -----------");

    status = DISCONNECTED;

    if (onerror) {
      onerror(error);
    }
  }

  var ws = new WebSocketWithReconnection(wsConfig);

  Logger.debug('Connecting websocket to URI: ' + wsConfig.uri);

  var rpcBuilderOptions = {
    request_timeout: configuration.rpc.requestTimeout,
    ping_request_timeout: configuration.rpc.heartbeatRequestTimeout
  };

  var rpc = new RpcBuilder(RpcBuilder.packers.JsonRPC, rpcBuilderOptions, ws,
    function (request) {

      Logger.debug('Received request: ' + JSON.stringify(request));

      try {
        var func = configuration.rpc[request.method];

        if (func === undefined) {
          Logger.error("Method " + request.method +
            " not registered in client");
        } else {
          func(request.params, request);
        }
      } catch (err) {
        Logger.error('Exception processing request: ' + JSON.stringify(
          request));
        Logger.error(err);
      }
    });

  this.send = function (method, params, callback) {
    if (method !== 'ping') {
      Logger.debug('Request: method:' + method + " params:" + JSON.stringify(
        params));
    }

    var requestTime = Date.now();

    rpc.encode(method, params, function (error, result) {
      if (error) {
        try {
          Logger.error("ERROR:" + error.message + " in Request: method:" +
            method + " params:" + JSON.stringify(params) + " request:" +
            error.request);
          if (error.data) {
            Logger.error("ERROR DATA:" + JSON.stringify(error.data));
          }
        } catch (e) {}
        error.requestTime = requestTime;
      }
      if (callback) {
        if (result != undefined && result.value !== 'pong') {
          Logger.debug('Response: ' + JSON.stringify(result));
        }
        callback(error, result);
      }
    });
  }

  function updateNotReconnectIfLessThan() {
    Logger.debug("notReconnectIfNumLessThan = " + pingNextNum + ' (old=' +
      notReconnectIfNumLessThan + ')');
    notReconnectIfNumLessThan = pingNextNum;
  }

  function sendPing() {
    if (enabledPings) {
      var params = null;
      if (pingNextNum == 0 || pingNextNum == notReconnectIfNumLessThan) {
        params = {
          interval: configuration.heartbeat || PING_INTERVAL
        };
      }
      pingNextNum++;

      self.send('ping', params, (function (pingNum) {
        return function (error, result) {
          if (error) {
            Logger.debug("Error in ping request #" + pingNum + " (" +
              error.message + ")");
            if (pingNum > notReconnectIfNumLessThan) {
              enabledPings = false;
              updateNotReconnectIfLessThan();
              Logger.debug("Server did not respond to ping message #" +
                pingNum + ". Reconnecting... ");
              ws.reconnectWs();
            }
          }
        }
      })(pingNextNum));
    } else {
      Logger.debug("Trying to send ping, but ping is not enabled");
    }
  }

  /*
   * If configuration.hearbeat has any value, the ping-pong will work with the interval
   * of configuration.hearbeat
   */
  function usePing() {
    if (!pingPongStarted) {
      Logger.debug("Starting ping (if configured)")
      pingPongStarted = true;

      if (configuration.heartbeat != undefined) {
        pingInterval = setInterval(sendPing, configuration.heartbeat);
        sendPing();
      }
    }
  }

  this.close = function () {
    Logger.debug("Closing jsonRpcClient explicitly by client");

    if (pingInterval != undefined) {
      Logger.debug("Clearing ping interval");
      clearInterval(pingInterval);
    }
    pingPongStarted = false;
    enabledPings = false;

    if (configuration.sendCloseMessage) {
      Logger.debug("Sending close message")
      this.send('closeSession', null, function (error, result) {
        if (error) {
          Logger.error("Error sending close message: " + JSON.stringify(
            error));
        }
        ws.close();
      });
    } else {
      ws.close();
    }
  }

  // This method is only for testing
  this.forceClose = function (millis) {
    ws.forceClose(millis);
  }

  this.reconnect = function () {
    ws.reconnectWs();
  }
}

module.exports = JsonRpcClient;

},{"../..":6,"./transports/webSocketWithReconnection":5}],4:[function(require,module,exports){
/*
 * (C) Copyright 2014 Kurento (http://kurento.org/)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

var WebSocketWithReconnection = require('./webSocketWithReconnection');

exports.WebSocketWithReconnection = WebSocketWithReconnection;

},{"./webSocketWithReconnection":5}],5:[function(require,module,exports){
(function (global){
/*
 * (C) Copyright 2013-2015 Kurento (http://kurento.org/)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

"use strict";

var BrowserWebSocket = global.WebSocket || global.MozWebSocket;

var Logger = console;

/**
 * Get either the `WebSocket` or `MozWebSocket` globals
 * in the browser or try to resolve WebSocket-compatible
 * interface exposed by `ws` for Node-like environment.
 */

var WebSocket = BrowserWebSocket;
if (!WebSocket && typeof window === 'undefined') {
  try {
    WebSocket = require('ws');
  } catch (e) {}
}

//var SockJS = require('sockjs-client');

var MAX_RETRIES = 2000; // Forever...
var RETRY_TIME_MS = 3000; // FIXME: Implement exponential wait times...

var CONNECTING = 0;
var OPEN = 1;
var CLOSING = 2;
var CLOSED = 3;

/*
config = {
		uri : wsUri,
		useSockJS : true (use SockJS) / false (use WebSocket) by default,
		onconnected : callback method to invoke when connection is successful,
		ondisconnect : callback method to invoke when the connection is lost,
		onreconnecting : callback method to invoke when the client is reconnecting,
		onreconnected : callback method to invoke when the client succesfully reconnects,
	};
*/
function WebSocketWithReconnection(config) {

  var closing = false;
  var registerMessageHandler;
  var wsUri = config.uri;
  var useSockJS = config.useSockJS;
  var reconnecting = false;

  var forcingDisconnection = false;

  var ws;

  if (useSockJS) {
    ws = new SockJS(wsUri);
  } else {
    ws = new WebSocket(wsUri);
  }

  ws.onopen = function () {
    logConnected(ws, wsUri);
    if (config.onconnected) {
      config.onconnected();
    }
  };

  ws.onerror = function (error) {
    Logger.error("Could not connect to " + wsUri +
      " (invoking onerror if defined)", error);
    if (config.onerror) {
      config.onerror(error);
    }
  };

  function logConnected(ws, wsUri) {
    try {
      Logger.debug("WebSocket connected to " + wsUri);
    } catch (e) {
      Logger.error(e);
    }
  }

  var reconnectionOnClose = function () {
    if (ws.readyState === CLOSED) {
      if (closing) {
        Logger.debug("Connection closed by user");
      } else {
        Logger.debug("Connection closed unexpectecly. Reconnecting...");
        reconnectToSameUri(MAX_RETRIES, 1);
      }
    } else {
      Logger.debug("Close callback from previous websocket. Ignoring it");
    }
  };

  ws.onclose = reconnectionOnClose;

  function reconnectToSameUri(maxRetries, numRetries) {
    Logger.debug("reconnectToSameUri (attempt #" + numRetries + ", max=" +
      maxRetries + ")");

    if (numRetries === 1) {
      if (reconnecting) {
        Logger.warn(
          "Trying to reconnectToNewUri when reconnecting... Ignoring this reconnection."
        )
        return;
      } else {
        reconnecting = true;
      }

      if (config.onreconnecting) {
        config.onreconnecting();
      }
    }

    if (forcingDisconnection) {
      reconnectToNewUri(maxRetries, numRetries, wsUri);

    } else {
      if (config.newWsUriOnReconnection) {
        config.newWsUriOnReconnection(function (error, newWsUri) {

          if (error) {
            Logger.debug(error);
            setTimeout(function () {
              reconnectToSameUri(maxRetries, numRetries + 1);
            }, RETRY_TIME_MS);
          } else {
            reconnectToNewUri(maxRetries, numRetries, newWsUri);
          }
        })
      } else {
        reconnectToNewUri(maxRetries, numRetries, wsUri);
      }
    }
  }

  // TODO Test retries. How to force not connection?
  function reconnectToNewUri(maxRetries, numRetries, reconnectWsUri) {
    Logger.debug("Reconnection attempt #" + numRetries);

    ws.close();

    wsUri = reconnectWsUri || wsUri;

    var newWs;
    if (useSockJS) {
      newWs = new SockJS(wsUri);
    } else {
      newWs = new WebSocket(wsUri);
    }

    newWs.onopen = function () {
      Logger.debug("Reconnected after " + numRetries + " attempts...");
      logConnected(newWs, wsUri);
      reconnecting = false;
      registerMessageHandler();
      if (config.onreconnected()) {
        config.onreconnected();
      }

      newWs.onclose = reconnectionOnClose;
    };

    var onErrorOrClose = function (error) {
      Logger.warn("Reconnection error: ", error);

      if (numRetries === maxRetries) {
        if (config.ondisconnect) {
          config.ondisconnect();
        }
      } else {
        setTimeout(function () {
          reconnectToSameUri(maxRetries, numRetries + 1);
        }, RETRY_TIME_MS);
      }
    };

    newWs.onerror = onErrorOrClose;

    ws = newWs;
  }

  this.close = function () {
    closing = true;
    ws.close();
  };

  // This method is only for testing
  this.forceClose = function (millis) {
    Logger.debug("Testing: Force WebSocket close");

    if (millis) {
      Logger.debug("Testing: Change wsUri for " + millis +
        " millis to simulate net failure");
      var goodWsUri = wsUri;
      wsUri = "wss://21.234.12.34.4:443/";

      forcingDisconnection = true;

      setTimeout(function () {
        Logger.debug("Testing: Recover good wsUri " + goodWsUri);
        wsUri = goodWsUri;

        forcingDisconnection = false;

      }, millis);
    }

    ws.close();
  };

  this.reconnectWs = function () {
    Logger.debug("reconnectWs");
    reconnectToSameUri(MAX_RETRIES, 1, wsUri);
  };

  this.send = function (message) {
    ws.send(message);
  };

  this.addEventListener = function (type, callback) {
    registerMessageHandler = function () {
      ws.addEventListener(type, callback);
    };

    registerMessageHandler();
  };
}

module.exports = WebSocketWithReconnection;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"ws":undefined}],6:[function(require,module,exports){
/*
 * (C) Copyright 2014 Kurento (http://kurento.org/)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

var defineProperty_IE8 = false
if (Object.defineProperty) {
  try {
    Object.defineProperty({}, "x", {});
  } catch (e) {
    defineProperty_IE8 = true
  }
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/bind
if (!Function.prototype.bind) {
  Function.prototype.bind = function (oThis) {
    if (typeof this !== 'function') {
      // closest thing possible to the ECMAScript 5
      // internal IsCallable function
      throw new TypeError(
        'Function.prototype.bind - what is trying to be bound is not callable'
      );
    }

    var aArgs = Array.prototype.slice.call(arguments, 1),
      fToBind = this,
      fNOP = function () {},
      fBound = function () {
        return fToBind.apply(this instanceof fNOP && oThis ?
          this :
          oThis,
          aArgs.concat(Array.prototype.slice.call(arguments)));
      };

    fNOP.prototype = this.prototype;
    fBound.prototype = new fNOP();

    return fBound;
  };
}

var EventEmitter = require('events').EventEmitter;

var inherits = require('inherits');

var packers = require('./packers');
var Mapper = require('./Mapper');

var BASE_TIMEOUT = 5000;

function unifyResponseMethods(responseMethods) {
  if (!responseMethods) return {};

  for (var key in responseMethods) {
    var value = responseMethods[key];

    if (typeof value == 'string')
      responseMethods[key] = {
        response: value
      }
  };

  return responseMethods;
};

function unifyTransport(transport) {
  if (!transport) return;

  // Transport as a function
  if (transport instanceof Function)
    return {
      send: transport
    };

  // WebSocket & DataChannel
  if (transport.send instanceof Function)
    return transport;

  // Message API (Inter-window & WebWorker)
  if (transport.postMessage instanceof Function) {
    transport.send = transport.postMessage;
    return transport;
  }

  // Stream API
  if (transport.write instanceof Function) {
    transport.send = transport.write;
    return transport;
  }

  // Transports that only can receive messages, but not send
  if (transport.onmessage !== undefined) return;
  if (transport.pause instanceof Function) return;

  throw new SyntaxError("Transport is not a function nor a valid object");
};

/**
 * Representation of a RPC notification
 *
 * @class
 *
 * @constructor
 *
 * @param {String} method -method of the notification
 * @param params - parameters of the notification
 */
function RpcNotification(method, params) {
  if (defineProperty_IE8) {
    this.method = method
    this.params = params
  } else {
    Object.defineProperty(this, 'method', {
      value: method,
      enumerable: true
    });
    Object.defineProperty(this, 'params', {
      value: params,
      enumerable: true
    });
  }
};

/**
 * @class
 *
 * @constructor
 *
 * @param {object} packer
 *
 * @param {object} [options]
 *
 * @param {object} [transport]
 *
 * @param {Function} [onRequest]
 */
function RpcBuilder(packer, options, transport, onRequest) {
  var self = this;

  if (!packer)
    throw new SyntaxError('Packer is not defined');

  if (!packer.pack || !packer.unpack)
    throw new SyntaxError('Packer is invalid');

  var responseMethods = unifyResponseMethods(packer.responseMethods);

  if (options instanceof Function) {
    if (transport != undefined)
      throw new SyntaxError("There can't be parameters after onRequest");

    onRequest = options;
    transport = undefined;
    options = undefined;
  };

  if (options && options.send instanceof Function) {
    if (transport && !(transport instanceof Function))
      throw new SyntaxError("Only a function can be after transport");

    onRequest = transport;
    transport = options;
    options = undefined;
  };

  if (transport instanceof Function) {
    if (onRequest != undefined)
      throw new SyntaxError("There can't be parameters after onRequest");

    onRequest = transport;
    transport = undefined;
  };

  if (transport && transport.send instanceof Function)
    if (onRequest && !(onRequest instanceof Function))
      throw new SyntaxError("Only a function can be after transport");

  options = options || {};

  EventEmitter.call(this);

  if (onRequest)
    this.on('request', onRequest);

  if (defineProperty_IE8)
    this.peerID = options.peerID
  else
    Object.defineProperty(this, 'peerID', {
      value: options.peerID
    });

  var max_retries = options.max_retries || 0;

  function transportMessage(event) {
    self.decode(event.data || event);
  };

  this.getTransport = function () {
    return transport;
  }
  this.setTransport = function (value) {
    // Remove listener from old transport
    if (transport) {
      // W3C transports
      if (transport.removeEventListener)
        transport.removeEventListener('message', transportMessage);

      // Node.js Streams API
      else if (transport.removeListener)
        transport.removeListener('data', transportMessage);
    };

    // Set listener on new transport
    if (value) {
      // W3C transports
      if (value.addEventListener)
        value.addEventListener('message', transportMessage);

      // Node.js Streams API
      else if (value.addListener)
        value.addListener('data', transportMessage);
    };

    transport = unifyTransport(value);
  }

  if (!defineProperty_IE8)
    Object.defineProperty(this, 'transport', {
      get: this.getTransport.bind(this),
      set: this.setTransport.bind(this)
    })

  this.setTransport(transport);

  var request_timeout = options.request_timeout || BASE_TIMEOUT;
  var ping_request_timeout = options.ping_request_timeout || request_timeout;
  var response_timeout = options.response_timeout || BASE_TIMEOUT;
  var duplicates_timeout = options.duplicates_timeout || BASE_TIMEOUT;

  var requestID = 0;

  var requests = new Mapper();
  var responses = new Mapper();
  var processedResponses = new Mapper();

  var message2Key = {};

  /**
   * Store the response to prevent to process duplicate request later
   */
  function storeResponse(message, id, dest) {
    var response = {
      message: message,
      /** Timeout to auto-clean old responses */
      timeout: setTimeout(function () {
          responses.remove(id, dest);
        },
        response_timeout)
    };

    responses.set(response, id, dest);
  };

  /**
   * Store the response to ignore duplicated messages later
   */
  function storeProcessedResponse(ack, from) {
    var timeout = setTimeout(function () {
        processedResponses.remove(ack, from);
      },
      duplicates_timeout);

    processedResponses.set(timeout, ack, from);
  };

  /**
   * Representation of a RPC request
   *
   * @class
   * @extends RpcNotification
   *
   * @constructor
   *
   * @param {String} method -method of the notification
   * @param params - parameters of the notification
   * @param {Integer} id - identifier of the request
   * @param [from] - source of the notification
   */
  function RpcRequest(method, params, id, from, transport) {
    RpcNotification.call(this, method, params);

    this.getTransport = function () {
      return transport;
    }
    this.setTransport = function (value) {
      transport = unifyTransport(value);
    }

    if (!defineProperty_IE8)
      Object.defineProperty(this, 'transport', {
        get: this.getTransport.bind(this),
        set: this.setTransport.bind(this)
      })

    var response = responses.get(id, from);

    /**
     * @constant {Boolean} duplicated
     */
    if (!(transport || self.getTransport())) {
      if (defineProperty_IE8)
        this.duplicated = Boolean(response)
      else
        Object.defineProperty(this, 'duplicated', {
          value: Boolean(response)
        });
    }

    var responseMethod = responseMethods[method];

    this.pack = packer.pack.bind(packer, this, id)

    /**
     * Generate a response to this request
     *
     * @param {Error} [error]
     * @param {*} [result]
     *
     * @returns {string}
     */
    this.reply = function (error, result, transport) {
      // Fix optional parameters
      if (error instanceof Function || error && error
        .send instanceof Function) {
        if (result != undefined)
          throw new SyntaxError("There can't be parameters after callback");

        transport = error;
        result = null;
        error = undefined;
      } else if (result instanceof Function ||
        result && result.send instanceof Function) {
        if (transport != undefined)
          throw new SyntaxError("There can't be parameters after callback");

        transport = result;
        result = null;
      };

      transport = unifyTransport(transport);

      // Duplicated request, remove old response timeout
      if (response)
        clearTimeout(response.timeout);

      if (from != undefined) {
        if (error)
          error.dest = from;

        if (result)
          result.dest = from;
      };

      var message;

      // New request or overriden one, create new response with provided data
      if (error || result != undefined) {
        if (self.peerID != undefined) {
          if (error)
            error.from = self.peerID;
          else
            result.from = self.peerID;
        }

        // Protocol indicates that responses has own request methods
        if (responseMethod) {
          if (responseMethod.error == undefined && error)
            message = {
              error: error
            };

          else {
            var method = error ?
              responseMethod.error :
              responseMethod.response;

            message = {
              method: method,
              params: error || result
            };
          }
        } else
          message = {
            error: error,
            result: result
          };

        message = packer.pack(message, id);
      }

      // Duplicate & not-overriden request, re-send old response
      else if (response)
        message = response.message;

      // New empty reply, response null value
      else
        message = packer.pack({
          result: null
        }, id);

      // Store the response to prevent to process a duplicated request later
      storeResponse(message, id, from);

      // Return the stored response so it can be directly send back
      transport = transport || this.getTransport() || self.getTransport();

      if (transport)
        return transport.send(message);

      return message;
    }
  };
  inherits(RpcRequest, RpcNotification);

  function cancel(message) {
    var key = message2Key[message];
    if (!key) return;

    delete message2Key[message];

    var request = requests.pop(key.id, key.dest);
    if (!request) return;

    clearTimeout(request.timeout);

    // Start duplicated responses timeout
    storeProcessedResponse(key.id, key.dest);
  };

  /**
   * Allow to cancel a request and don't wait for a response
   *
   * If `message` is not given, cancel all the request
   */
  this.cancel = function (message) {
    if (message) return cancel(message);

    for (var message in message2Key)
      cancel(message);
  };

  this.close = function () {
    // Prevent to receive new messages
    var transport = this.getTransport();
    if (transport && transport.close)
      transport.close();

    // Request & processed responses
    this.cancel();

    processedResponses.forEach(clearTimeout);

    // Responses
    responses.forEach(function (response) {
      clearTimeout(response.timeout);
    });
  };

  /**
   * Generates and encode a JsonRPC 2.0 message
   *
   * @param {String} method -method of the notification
   * @param params - parameters of the notification
   * @param [dest] - destination of the notification
   * @param {object} [transport] - transport where to send the message
   * @param [callback] - function called when a response to this request is
   *   received. If not defined, a notification will be send instead
   *
   * @returns {string} A raw JsonRPC 2.0 request or notification string
   */
  this.encode = function (method, params, dest, transport, callback) {
    // Fix optional parameters
    if (params instanceof Function) {
      if (dest != undefined)
        throw new SyntaxError("There can't be parameters after callback");

      callback = params;
      transport = undefined;
      dest = undefined;
      params = undefined;
    } else if (dest instanceof Function) {
      if (transport != undefined)
        throw new SyntaxError("There can't be parameters after callback");

      callback = dest;
      transport = undefined;
      dest = undefined;
    } else if (transport instanceof Function) {
      if (callback != undefined)
        throw new SyntaxError("There can't be parameters after callback");

      callback = transport;
      transport = undefined;
    };

    if (self.peerID != undefined) {
      params = params || {};

      params.from = self.peerID;
    };

    if (dest != undefined) {
      params = params || {};

      params.dest = dest;
    };

    // Encode message
    var message = {
      method: method,
      params: params
    };

    if (callback) {
      var id = requestID++;
      var retried = 0;

      message = packer.pack(message, id);

      function dispatchCallback(error, result) {
        self.cancel(message);

        callback(error, result);
      };

      var request = {
        message: message,
        callback: dispatchCallback,
        responseMethods: responseMethods[method] || {}
      };

      var encode_transport = unifyTransport(transport);

      function sendRequest(transport) {
        var rt = (method === 'ping' ? ping_request_timeout : request_timeout);
        request.timeout = setTimeout(timeout, rt * Math.pow(2, retried++));
        message2Key[message] = {
          id: id,
          dest: dest
        };
        requests.set(request, id, dest);

        transport = transport || encode_transport || self.getTransport();
        if (transport)
          return transport.send(message);

        return message;
      };

      function retry(transport) {
        transport = unifyTransport(transport);

        console.warn(retried + ' retry for request message:', message);

        var timeout = processedResponses.pop(id, dest);
        clearTimeout(timeout);

        return sendRequest(transport);
      };

      function timeout() {
        if (retried < max_retries)
          return retry(transport);

        var error = new Error('Request has timed out');
        error.request = message;

        error.retry = retry;

        dispatchCallback(error)
      };

      return sendRequest(transport);
    };

    // Return the packed message
    message = packer.pack(message);

    transport = transport || this.getTransport();
    if (transport)
      return transport.send(message);

    return message;
  };

  /**
   * Decode and process a JsonRPC 2.0 message
   *
   * @param {string} message - string with the content of the message
   *
   * @returns {RpcNotification|RpcRequest|undefined} - the representation of the
   *   notification or the request. If a response was processed, it will return
   *   `undefined` to notify that it was processed
   *
   * @throws {TypeError} - Message is not defined
   */
  this.decode = function (message, transport) {
    if (!message)
      throw new TypeError("Message is not defined");

    try {
      message = packer.unpack(message);
    } catch (e) {
      // Ignore invalid messages
      return console.debug(e, message);
    };

    var id = message.id;
    var ack = message.ack;
    var method = message.method;
    var params = message.params || {};

    var from = params.from;
    var dest = params.dest;

    // Ignore messages send by us
    if (self.peerID != undefined && from == self.peerID) return;

    // Notification
    if (id == undefined && ack == undefined) {
      var notification = new RpcNotification(method, params);

      if (self.emit('request', notification)) return;
      return notification;
    };

    function processRequest() {
      // If we have a transport and it's a duplicated request, reply inmediatly
      transport = unifyTransport(transport) || self.getTransport();
      if (transport) {
        var response = responses.get(id, from);
        if (response)
          return transport.send(response.message);
      };

      var idAck = (id != undefined) ? id : ack;
      var request = new RpcRequest(method, params, idAck, from, transport);

      if (self.emit('request', request)) return;
      return request;
    };

    function processResponse(request, error, result) {
      request.callback(error, result);
    };

    function duplicatedResponse(timeout) {
      console.warn("Response already processed", message);

      // Update duplicated responses timeout
      clearTimeout(timeout);
      storeProcessedResponse(ack, from);
    };

    // Request, or response with own method
    if (method) {
      // Check if it's a response with own method
      if (dest == undefined || dest == self.peerID) {
        var request = requests.get(ack, from);
        if (request) {
          var responseMethods = request.responseMethods;

          if (method == responseMethods.error)
            return processResponse(request, params);

          if (method == responseMethods.response)
            return processResponse(request, null, params);

          return processRequest();
        }

        var processed = processedResponses.get(ack, from);
        if (processed)
          return duplicatedResponse(processed);
      }

      // Request
      return processRequest();
    };

    var error = message.error;
    var result = message.result;

    // Ignore responses not send to us
    if (error && error.dest && error.dest != self.peerID) return;
    if (result && result.dest && result.dest != self.peerID) return;

    // Response
    var request = requests.get(ack, from);
    if (!request) {
      var processed = processedResponses.get(ack, from);
      if (processed)
        return duplicatedResponse(processed);

      return console.warn("No callback was defined for this message",
        message);
    };

    // Process response
    processResponse(request, error, result);
  };
};
inherits(RpcBuilder, EventEmitter);

RpcBuilder.RpcNotification = RpcNotification;

module.exports = RpcBuilder;

var clients = require('./clients');
var transports = require('./clients/transports');

RpcBuilder.clients = clients;
RpcBuilder.clients.transports = transports;
RpcBuilder.packers = packers;

},{"./Mapper":1,"./clients":2,"./clients/transports":4,"./packers":9,"events":10,"inherits":11}],7:[function(require,module,exports){
/**
 * JsonRPC 2.0 packer
 */

/**
 * Pack a JsonRPC 2.0 message
 *
 * @param {Object} message - object to be packaged. It requires to have all the
 *   fields needed by the JsonRPC 2.0 message that it's going to be generated
 *
 * @return {String} - the stringified JsonRPC 2.0 message
 */
function pack(message, id) {
  var result = {
    jsonrpc: "2.0"
  };

  // Request
  if (message.method) {
    result.method = message.method;

    if (message.params)
      result.params = message.params;

    // Request is a notification
    if (id != undefined)
      result.id = id;
  }

  // Response
  else if (id != undefined) {
    if (message.error) {
      if (message.result !== undefined)
        throw new TypeError("Both result and error are defined");

      result.error = message.error;
    } else if (message.result !== undefined)
      result.result = message.result;
    else
      throw new TypeError("No result or error is defined");

    result.id = id;
  };

  return JSON.stringify(result);
};

/**
 * Unpack a JsonRPC 2.0 message
 *
 * @param {String} message - string with the content of the JsonRPC 2.0 message
 *
 * @throws {TypeError} - Invalid JsonRPC version
 *
 * @return {Object} - object filled with the JsonRPC 2.0 message content
 */
function unpack(message) {
  var result = message;

  if (typeof message === 'string' || message instanceof String) {
    result = JSON.parse(message);
  }

  // Check if it's a valid message

  var version = result.jsonrpc;
  if (version !== '2.0')
    throw new TypeError("Invalid JsonRPC version '" + version + "': " +
      message);

  // Response
  if (result.method == undefined) {
    if (result.id == undefined)
      throw new TypeError("Invalid message: " + message);

    var result_defined = result.result !== undefined;
    var error_defined = result.error !== undefined;

    // Check only result or error is defined, not both or none
    if (result_defined && error_defined)
      throw new TypeError("Both result and error are defined: " + message);

    if (!result_defined && !error_defined)
      throw new TypeError("No result or error is defined: " + message);

    result.ack = result.id;
    delete result.id;
  }

  // Return unpacked message
  return result;
};

exports.pack = pack;
exports.unpack = unpack;

},{}],8:[function(require,module,exports){
function pack(message) {
  throw new TypeError("Not yet implemented");
};

function unpack(message) {
  throw new TypeError("Not yet implemented");
};

exports.pack = pack;
exports.unpack = unpack;

},{}],9:[function(require,module,exports){
var JsonRPC = require('./JsonRPC');
var XmlRPC = require('./XmlRPC');

exports.JsonRPC = JsonRPC;
exports.XmlRPC = XmlRPC;

},{"./JsonRPC":7,"./XmlRPC":8}],10:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var objectCreate = Object.create || objectCreatePolyfill
var objectKeys = Object.keys || objectKeysPolyfill
var bind = Function.prototype.bind || functionBindPolyfill

function EventEmitter() {
  if (!this._events || !Object.prototype.hasOwnProperty.call(this, '_events')) {
    this._events = objectCreate(null);
    this._eventsCount = 0;
  }

  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
var defaultMaxListeners = 10;

var hasDefineProperty;
try {
  var o = {};
  if (Object.defineProperty) Object.defineProperty(o, 'x', { value: 0 });
  hasDefineProperty = o.x === 0;
} catch (err) { hasDefineProperty = false }
if (hasDefineProperty) {
  Object.defineProperty(EventEmitter, 'defaultMaxListeners', {
    enumerable: true,
    get: function() {
      return defaultMaxListeners;
    },
    set: function(arg) {
      // check whether the input is a positive number (whose value is zero or
      // greater and not a NaN).
      if (typeof arg !== 'number' || arg < 0 || arg !== arg)
        throw new TypeError('"defaultMaxListeners" must be a positive number');
      defaultMaxListeners = arg;
    }
  });
} else {
  EventEmitter.defaultMaxListeners = defaultMaxListeners;
}

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
  if (typeof n !== 'number' || n < 0 || isNaN(n))
    throw new TypeError('"n" argument must be a positive number');
  this._maxListeners = n;
  return this;
};

function $getMaxListeners(that) {
  if (that._maxListeners === undefined)
    return EventEmitter.defaultMaxListeners;
  return that._maxListeners;
}

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
  return $getMaxListeners(this);
};

// These standalone emit* functions are used to optimize calling of event
// handlers for fast cases because emit() itself often has a variable number of
// arguments and can be deoptimized because of that. These functions always have
// the same number of arguments and thus do not get deoptimized, so the code
// inside them can execute faster.
function emitNone(handler, isFn, self) {
  if (isFn)
    handler.call(self);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self);
  }
}
function emitOne(handler, isFn, self, arg1) {
  if (isFn)
    handler.call(self, arg1);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1);
  }
}
function emitTwo(handler, isFn, self, arg1, arg2) {
  if (isFn)
    handler.call(self, arg1, arg2);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2);
  }
}
function emitThree(handler, isFn, self, arg1, arg2, arg3) {
  if (isFn)
    handler.call(self, arg1, arg2, arg3);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].call(self, arg1, arg2, arg3);
  }
}

function emitMany(handler, isFn, self, args) {
  if (isFn)
    handler.apply(self, args);
  else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      listeners[i].apply(self, args);
  }
}

EventEmitter.prototype.emit = function emit(type) {
  var er, handler, len, args, i, events;
  var doError = (type === 'error');

  events = this._events;
  if (events)
    doError = (doError && events.error == null);
  else if (!doError)
    return false;

  // If there is no 'error' event listener then throw.
  if (doError) {
    if (arguments.length > 1)
      er = arguments[1];
    if (er instanceof Error) {
      throw er; // Unhandled 'error' event
    } else {
      // At least give some kind of context to the user
      var err = new Error('Unhandled "error" event. (' + er + ')');
      err.context = er;
      throw err;
    }
    return false;
  }

  handler = events[type];

  if (!handler)
    return false;

  var isFn = typeof handler === 'function';
  len = arguments.length;
  switch (len) {
      // fast cases
    case 1:
      emitNone(handler, isFn, this);
      break;
    case 2:
      emitOne(handler, isFn, this, arguments[1]);
      break;
    case 3:
      emitTwo(handler, isFn, this, arguments[1], arguments[2]);
      break;
    case 4:
      emitThree(handler, isFn, this, arguments[1], arguments[2], arguments[3]);
      break;
      // slower
    default:
      args = new Array(len - 1);
      for (i = 1; i < len; i++)
        args[i - 1] = arguments[i];
      emitMany(handler, isFn, this, args);
  }

  return true;
};

function _addListener(target, type, listener, prepend) {
  var m;
  var events;
  var existing;

  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');

  events = target._events;
  if (!events) {
    events = target._events = objectCreate(null);
    target._eventsCount = 0;
  } else {
    // To avoid recursion in the case that type === "newListener"! Before
    // adding it to the listeners, first emit "newListener".
    if (events.newListener) {
      target.emit('newListener', type,
          listener.listener ? listener.listener : listener);

      // Re-assign `events` because a newListener handler could have caused the
      // this._events to be assigned to a new object
      events = target._events;
    }
    existing = events[type];
  }

  if (!existing) {
    // Optimize the case of one listener. Don't need the extra array object.
    existing = events[type] = listener;
    ++target._eventsCount;
  } else {
    if (typeof existing === 'function') {
      // Adding the second element, need to change to array.
      existing = events[type] =
          prepend ? [listener, existing] : [existing, listener];
    } else {
      // If we've already got an array, just append.
      if (prepend) {
        existing.unshift(listener);
      } else {
        existing.push(listener);
      }
    }

    // Check for listener leak
    if (!existing.warned) {
      m = $getMaxListeners(target);
      if (m && m > 0 && existing.length > m) {
        existing.warned = true;
        var w = new Error('Possible EventEmitter memory leak detected. ' +
            existing.length + ' "' + String(type) + '" listeners ' +
            'added. Use emitter.setMaxListeners() to ' +
            'increase limit.');
        w.name = 'MaxListenersExceededWarning';
        w.emitter = target;
        w.type = type;
        w.count = existing.length;
        if (typeof console === 'object' && console.warn) {
          console.warn('%s: %s', w.name, w.message);
        }
      }
    }
  }

  return target;
}

EventEmitter.prototype.addListener = function addListener(type, listener) {
  return _addListener(this, type, listener, false);
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener =
    function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };

function onceWrapper() {
  if (!this.fired) {
    this.target.removeListener(this.type, this.wrapFn);
    this.fired = true;
    switch (arguments.length) {
      case 0:
        return this.listener.call(this.target);
      case 1:
        return this.listener.call(this.target, arguments[0]);
      case 2:
        return this.listener.call(this.target, arguments[0], arguments[1]);
      case 3:
        return this.listener.call(this.target, arguments[0], arguments[1],
            arguments[2]);
      default:
        var args = new Array(arguments.length);
        for (var i = 0; i < args.length; ++i)
          args[i] = arguments[i];
        this.listener.apply(this.target, args);
    }
  }
}

function _onceWrap(target, type, listener) {
  var state = { fired: false, wrapFn: undefined, target: target, type: type, listener: listener };
  var wrapped = bind.call(onceWrapper, state);
  wrapped.listener = listener;
  state.wrapFn = wrapped;
  return wrapped;
}

EventEmitter.prototype.once = function once(type, listener) {
  if (typeof listener !== 'function')
    throw new TypeError('"listener" argument must be a function');
  this.on(type, _onceWrap(this, type, listener));
  return this;
};

EventEmitter.prototype.prependOnceListener =
    function prependOnceListener(type, listener) {
      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };

// Emits a 'removeListener' event if and only if the listener was removed.
EventEmitter.prototype.removeListener =
    function removeListener(type, listener) {
      var list, events, position, i, originalListener;

      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');

      events = this._events;
      if (!events)
        return this;

      list = events[type];
      if (!list)
        return this;

      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0)
          this._events = objectCreate(null);
        else {
          delete events[type];
          if (events.removeListener)
            this.emit('removeListener', type, list.listener || listener);
        }
      } else if (typeof list !== 'function') {
        position = -1;

        for (i = list.length - 1; i >= 0; i--) {
          if (list[i] === listener || list[i].listener === listener) {
            originalListener = list[i].listener;
            position = i;
            break;
          }
        }

        if (position < 0)
          return this;

        if (position === 0)
          list.shift();
        else
          spliceOne(list, position);

        if (list.length === 1)
          events[type] = list[0];

        if (events.removeListener)
          this.emit('removeListener', type, originalListener || listener);
      }

      return this;
    };

EventEmitter.prototype.removeAllListeners =
    function removeAllListeners(type) {
      var listeners, events, i;

      events = this._events;
      if (!events)
        return this;

      // not listening for removeListener, no need to emit
      if (!events.removeListener) {
        if (arguments.length === 0) {
          this._events = objectCreate(null);
          this._eventsCount = 0;
        } else if (events[type]) {
          if (--this._eventsCount === 0)
            this._events = objectCreate(null);
          else
            delete events[type];
        }
        return this;
      }

      // emit removeListener for all listeners on all events
      if (arguments.length === 0) {
        var keys = objectKeys(events);
        var key;
        for (i = 0; i < keys.length; ++i) {
          key = keys[i];
          if (key === 'removeListener') continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners('removeListener');
        this._events = objectCreate(null);
        this._eventsCount = 0;
        return this;
      }

      listeners = events[type];

      if (typeof listeners === 'function') {
        this.removeListener(type, listeners);
      } else if (listeners) {
        // LIFO order
        for (i = listeners.length - 1; i >= 0; i--) {
          this.removeListener(type, listeners[i]);
        }
      }

      return this;
    };

function _listeners(target, type, unwrap) {
  var events = target._events;

  if (!events)
    return [];

  var evlistener = events[type];
  if (!evlistener)
    return [];

  if (typeof evlistener === 'function')
    return unwrap ? [evlistener.listener || evlistener] : [evlistener];

  return unwrap ? unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
}

EventEmitter.prototype.listeners = function listeners(type) {
  return _listeners(this, type, true);
};

EventEmitter.prototype.rawListeners = function rawListeners(type) {
  return _listeners(this, type, false);
};

EventEmitter.listenerCount = function(emitter, type) {
  if (typeof emitter.listenerCount === 'function') {
    return emitter.listenerCount(type);
  } else {
    return listenerCount.call(emitter, type);
  }
};

EventEmitter.prototype.listenerCount = listenerCount;
function listenerCount(type) {
  var events = this._events;

  if (events) {
    var evlistener = events[type];

    if (typeof evlistener === 'function') {
      return 1;
    } else if (evlistener) {
      return evlistener.length;
    }
  }

  return 0;
}

EventEmitter.prototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
};

// About 1.5x faster than the two-arg version of Array#splice().
function spliceOne(list, index) {
  for (var i = index, k = i + 1, n = list.length; k < n; i += 1, k += 1)
    list[i] = list[k];
  list.pop();
}

function arrayClone(arr, n) {
  var copy = new Array(n);
  for (var i = 0; i < n; ++i)
    copy[i] = arr[i];
  return copy;
}

function unwrapListeners(arr) {
  var ret = new Array(arr.length);
  for (var i = 0; i < ret.length; ++i) {
    ret[i] = arr[i].listener || arr[i];
  }
  return ret;
}

function objectCreatePolyfill(proto) {
  var F = function() {};
  F.prototype = proto;
  return new F;
}
function objectKeysPolyfill(obj) {
  var keys = [];
  for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) {
    keys.push(k);
  }
  return k;
}
function functionBindPolyfill(context) {
  var fn = this;
  return function () {
    return fn.apply(context, arguments);
  };
}

},{}],11:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    if (superCtor) {
      ctor.super_ = superCtor
      ctor.prototype = Object.create(superCtor.prototype, {
        constructor: {
          value: ctor,
          enumerable: false,
          writable: true,
          configurable: true
        }
      })
    }
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    if (superCtor) {
      ctor.super_ = superCtor
      var TempCtor = function () {}
      TempCtor.prototype = superCtor.prototype
      ctor.prototype = new TempCtor()
      ctor.prototype.constructor = ctor
    }
  }
}

},{}]},{},[6])(6)
});

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJsaWIvTWFwcGVyLmpzIiwibGliL2NsaWVudHMvaW5kZXguanMiLCJsaWIvY2xpZW50cy9qc29ucnBjY2xpZW50LmpzIiwibGliL2NsaWVudHMvdHJhbnNwb3J0cy9pbmRleC5qcyIsImxpYi9jbGllbnRzL3RyYW5zcG9ydHMvd2ViU29ja2V0V2l0aFJlY29ubmVjdGlvbi5qcyIsImxpYi9pbmRleC5qcyIsImxpYi9wYWNrZXJzL0pzb25SUEMuanMiLCJsaWIvcGFja2Vycy9YbWxSUEMuanMiLCJsaWIvcGFja2Vycy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9ncnVudC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9ldmVudHMvZXZlbnRzLmpzIiwibm9kZV9tb2R1bGVzL2luaGVyaXRzL2luaGVyaXRzX2Jyb3dzZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOVJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDcEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDdFBBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqdUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzZ0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24oKXtmdW5jdGlvbiByKGUsbix0KXtmdW5jdGlvbiBvKGksZil7aWYoIW5baV0pe2lmKCFlW2ldKXt2YXIgYz1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlO2lmKCFmJiZjKXJldHVybiBjKGksITApO2lmKHUpcmV0dXJuIHUoaSwhMCk7dmFyIGE9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitpK1wiJ1wiKTt0aHJvdyBhLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsYX12YXIgcD1uW2ldPXtleHBvcnRzOnt9fTtlW2ldWzBdLmNhbGwocC5leHBvcnRzLGZ1bmN0aW9uKHIpe3ZhciBuPWVbaV1bMV1bcl07cmV0dXJuIG8obnx8cil9LHAscC5leHBvcnRzLHIsZSxuLHQpfXJldHVybiBuW2ldLmV4cG9ydHN9Zm9yKHZhciB1PVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmUsaT0wO2k8dC5sZW5ndGg7aSsrKW8odFtpXSk7cmV0dXJuIG99cmV0dXJuIHJ9KSgpIiwiZnVuY3Rpb24gTWFwcGVyKCkge1xuICB2YXIgc291cmNlcyA9IHt9O1xuXG4gIHRoaXMuZm9yRWFjaCA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgIGZvciAodmFyIGtleSBpbiBzb3VyY2VzKSB7XG4gICAgICB2YXIgc291cmNlID0gc291cmNlc1trZXldO1xuXG4gICAgICBmb3IgKHZhciBrZXkyIGluIHNvdXJjZSlcbiAgICAgICAgY2FsbGJhY2soc291cmNlW2tleTJdKTtcbiAgICB9O1xuICB9O1xuXG4gIHRoaXMuZ2V0ID0gZnVuY3Rpb24gKGlkLCBzb3VyY2UpIHtcbiAgICB2YXIgaWRzID0gc291cmNlc1tzb3VyY2VdO1xuICAgIGlmIChpZHMgPT0gdW5kZWZpbmVkKVxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIHJldHVybiBpZHNbaWRdO1xuICB9O1xuXG4gIHRoaXMucmVtb3ZlID0gZnVuY3Rpb24gKGlkLCBzb3VyY2UpIHtcbiAgICB2YXIgaWRzID0gc291cmNlc1tzb3VyY2VdO1xuICAgIGlmIChpZHMgPT0gdW5kZWZpbmVkKVxuICAgICAgcmV0dXJuO1xuXG4gICAgZGVsZXRlIGlkc1tpZF07XG5cbiAgICAvLyBDaGVjayBpdCdzIGVtcHR5XG4gICAgZm9yICh2YXIgaSBpbiBpZHMpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGRlbGV0ZSBzb3VyY2VzW3NvdXJjZV07XG4gIH07XG5cbiAgdGhpcy5zZXQgPSBmdW5jdGlvbiAodmFsdWUsIGlkLCBzb3VyY2UpIHtcbiAgICBpZiAodmFsdWUgPT0gdW5kZWZpbmVkKVxuICAgICAgcmV0dXJuIHRoaXMucmVtb3ZlKGlkLCBzb3VyY2UpO1xuXG4gICAgdmFyIGlkcyA9IHNvdXJjZXNbc291cmNlXTtcbiAgICBpZiAoaWRzID09IHVuZGVmaW5lZClcbiAgICAgIHNvdXJjZXNbc291cmNlXSA9IGlkcyA9IHt9O1xuXG4gICAgaWRzW2lkXSA9IHZhbHVlO1xuICB9O1xufTtcblxuTWFwcGVyLnByb3RvdHlwZS5wb3AgPSBmdW5jdGlvbiAoaWQsIHNvdXJjZSkge1xuICB2YXIgdmFsdWUgPSB0aGlzLmdldChpZCwgc291cmNlKTtcbiAgaWYgKHZhbHVlID09IHVuZGVmaW5lZClcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuXG4gIHRoaXMucmVtb3ZlKGlkLCBzb3VyY2UpO1xuXG4gIHJldHVybiB2YWx1ZTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gTWFwcGVyO1xuIiwiLypcbiAqIChDKSBDb3B5cmlnaHQgMjAxNCBLdXJlbnRvIChodHRwOi8va3VyZW50by5vcmcvKVxuICpcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqXG4gKiAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKlxuICovXG5cbnZhciBKc29uUnBjQ2xpZW50ID0gcmVxdWlyZSgnLi9qc29ucnBjY2xpZW50Jyk7XG5cbmV4cG9ydHMuSnNvblJwY0NsaWVudCA9IEpzb25ScGNDbGllbnQ7XG4iLCIvKlxuICogKEMpIENvcHlyaWdodCAyMDE0IEt1cmVudG8gKGh0dHA6Ly9rdXJlbnRvLm9yZy8pXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4gKlxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuICogV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cbiAqXG4gKi9cblxudmFyIFJwY0J1aWxkZXIgPSByZXF1aXJlKCcuLi8uLicpO1xudmFyIFdlYlNvY2tldFdpdGhSZWNvbm5lY3Rpb24gPSByZXF1aXJlKFxuICAnLi90cmFuc3BvcnRzL3dlYlNvY2tldFdpdGhSZWNvbm5lY3Rpb24nKTtcblxuRGF0ZS5ub3cgPSBEYXRlLm5vdyB8fCBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiArbmV3IERhdGU7XG59O1xuXG52YXIgUElOR19JTlRFUlZBTCA9IDUwMDA7XG5cbnZhciBSRUNPTk5FQ1RJTkcgPSAnUkVDT05ORUNUSU5HJztcbnZhciBDT05ORUNURUQgPSAnQ09OTkVDVEVEJztcbnZhciBESVNDT05ORUNURUQgPSAnRElTQ09OTkVDVEVEJztcblxudmFyIExvZ2dlciA9IGNvbnNvbGU7XG5cbi8qKlxuICpcbiAqIGhlYXJ0YmVhdDogaW50ZXJ2YWwgaW4gbXMgZm9yIGVhY2ggaGVhcnRiZWF0IG1lc3NhZ2UsXG4gKiBzZW5kQ2xvc2VNZXNzYWdlIDogdHJ1ZSAvIGZhbHNlLCBiZWZvcmUgY2xvc2luZyB0aGUgY29ubmVjdGlvbiwgaXQgc2VuZHMgYSBjbG9zZVNlc3Npb24gbWVzc2FnZVxuICogPHByZT5cbiAqIHdzIDoge1xuICogXHR1cmkgOiBVUkkgdG8gY29ubnRlY3QgdG8sXG4gKiAgdXNlU29ja0pTIDogdHJ1ZSAodXNlIFNvY2tKUykgLyBmYWxzZSAodXNlIFdlYlNvY2tldCkgYnkgZGVmYXVsdCxcbiAqIFx0b25jb25uZWN0ZWQgOiBjYWxsYmFjayBtZXRob2QgdG8gaW52b2tlIHdoZW4gY29ubmVjdGlvbiBpcyBzdWNjZXNzZnVsLFxuICogXHRvbmRpc2Nvbm5lY3QgOiBjYWxsYmFjayBtZXRob2QgdG8gaW52b2tlIHdoZW4gdGhlIGNvbm5lY3Rpb24gaXMgbG9zdCxcbiAqIFx0b25yZWNvbm5lY3RpbmcgOiBjYWxsYmFjayBtZXRob2QgdG8gaW52b2tlIHdoZW4gdGhlIGNsaWVudCBpcyByZWNvbm5lY3RpbmcsXG4gKiBcdG9ucmVjb25uZWN0ZWQgOiBjYWxsYmFjayBtZXRob2QgdG8gaW52b2tlIHdoZW4gdGhlIGNsaWVudCBzdWNjZXNmdWxseSByZWNvbm5lY3RzLFxuICogXHRvbmVycm9yIDogY2FsbGJhY2sgbWV0aG9kIHRvIGludm9rZSB3aGVuIHRoZXJlIGlzIGFuIGVycm9yXG4gKiB9LFxuICogcnBjIDoge1xuICogXHRyZXF1ZXN0VGltZW91dCA6IHRpbWVvdXQgZm9yIGEgcmVxdWVzdCxcbiAqIFx0c2Vzc2lvblN0YXR1c0NoYW5nZWQ6IGNhbGxiYWNrIG1ldGhvZCBmb3IgY2hhbmdlcyBpbiBzZXNzaW9uIHN0YXR1cyxcbiAqIFx0bWVkaWFSZW5lZ290aWF0aW9uOiBtZWRpYVJlbmVnb3RpYXRpb25cbiAqIH1cbiAqIDwvcHJlPlxuICovXG5mdW5jdGlvbiBKc29uUnBjQ2xpZW50KGNvbmZpZ3VyYXRpb24pIHtcblxuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgdmFyIHdzQ29uZmlnID0gY29uZmlndXJhdGlvbi53cztcblxuICB2YXIgbm90UmVjb25uZWN0SWZOdW1MZXNzVGhhbiA9IC0xO1xuXG4gIHZhciBwaW5nTmV4dE51bSA9IDA7XG4gIHZhciBlbmFibGVkUGluZ3MgPSB0cnVlO1xuICB2YXIgcGluZ1BvbmdTdGFydGVkID0gZmFsc2U7XG4gIHZhciBwaW5nSW50ZXJ2YWw7XG5cbiAgdmFyIHN0YXR1cyA9IERJU0NPTk5FQ1RFRDtcblxuICB2YXIgb25yZWNvbm5lY3RpbmcgPSB3c0NvbmZpZy5vbnJlY29ubmVjdGluZztcbiAgdmFyIG9ucmVjb25uZWN0ZWQgPSB3c0NvbmZpZy5vbnJlY29ubmVjdGVkO1xuICB2YXIgb25jb25uZWN0ZWQgPSB3c0NvbmZpZy5vbmNvbm5lY3RlZDtcbiAgdmFyIG9uZXJyb3IgPSB3c0NvbmZpZy5vbmVycm9yO1xuXG4gIGNvbmZpZ3VyYXRpb24ucnBjLnB1bGwgPSBmdW5jdGlvbiAocGFyYW1zLCByZXF1ZXN0KSB7XG4gICAgcmVxdWVzdC5yZXBseShudWxsLCBcInB1c2hcIik7XG4gIH1cblxuICB3c0NvbmZpZy5vbnJlY29ubmVjdGluZyA9IGZ1bmN0aW9uICgpIHtcbiAgICBMb2dnZXIuZGVidWcoXCItLS0tLS0tLS0gT05SRUNPTk5FQ1RJTkcgLS0tLS0tLS0tLS1cIik7XG4gICAgaWYgKHN0YXR1cyA9PT0gUkVDT05ORUNUSU5HKSB7XG4gICAgICBMb2dnZXIuZXJyb3IoXG4gICAgICAgIFwiV2Vic29ja2V0IGFscmVhZHkgaW4gUkVDT05ORUNUSU5HIHN0YXRlIHdoZW4gcmVjZWl2aW5nIGEgbmV3IE9OUkVDT05ORUNUSU5HIG1lc3NhZ2UuIElnbm9yaW5nIGl0XCJcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgc3RhdHVzID0gUkVDT05ORUNUSU5HO1xuICAgIGlmIChvbnJlY29ubmVjdGluZykge1xuICAgICAgb25yZWNvbm5lY3RpbmcoKTtcbiAgICB9XG4gIH1cblxuICB3c0NvbmZpZy5vbnJlY29ubmVjdGVkID0gZnVuY3Rpb24gKCkge1xuICAgIExvZ2dlci5kZWJ1ZyhcIi0tLS0tLS0tLSBPTlJFQ09OTkVDVEVEIC0tLS0tLS0tLS0tXCIpO1xuICAgIGlmIChzdGF0dXMgPT09IENPTk5FQ1RFRCkge1xuICAgICAgTG9nZ2VyLmVycm9yKFxuICAgICAgICBcIldlYnNvY2tldCBhbHJlYWR5IGluIENPTk5FQ1RFRCBzdGF0ZSB3aGVuIHJlY2VpdmluZyBhIG5ldyBPTlJFQ09OTkVDVEVEIG1lc3NhZ2UuIElnbm9yaW5nIGl0XCJcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHN0YXR1cyA9IENPTk5FQ1RFRDtcblxuICAgIGVuYWJsZWRQaW5ncyA9IHRydWU7XG4gICAgdXBkYXRlTm90UmVjb25uZWN0SWZMZXNzVGhhbigpO1xuICAgIHVzZVBpbmcoKTtcblxuICAgIGlmIChvbnJlY29ubmVjdGVkKSB7XG4gICAgICBvbnJlY29ubmVjdGVkKCk7XG4gICAgfVxuICB9XG5cbiAgd3NDb25maWcub25jb25uZWN0ZWQgPSBmdW5jdGlvbiAoKSB7XG4gICAgTG9nZ2VyLmRlYnVnKFwiLS0tLS0tLS0tIE9OQ09OTkVDVEVEIC0tLS0tLS0tLS0tXCIpO1xuICAgIGlmIChzdGF0dXMgPT09IENPTk5FQ1RFRCkge1xuICAgICAgTG9nZ2VyLmVycm9yKFxuICAgICAgICBcIldlYnNvY2tldCBhbHJlYWR5IGluIENPTk5FQ1RFRCBzdGF0ZSB3aGVuIHJlY2VpdmluZyBhIG5ldyBPTkNPTk5FQ1RFRCBtZXNzYWdlLiBJZ25vcmluZyBpdFwiXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBzdGF0dXMgPSBDT05ORUNURUQ7XG5cbiAgICBlbmFibGVkUGluZ3MgPSB0cnVlO1xuICAgIHVzZVBpbmcoKTtcblxuICAgIGlmIChvbmNvbm5lY3RlZCkge1xuICAgICAgb25jb25uZWN0ZWQoKTtcbiAgICB9XG4gIH1cblxuICB3c0NvbmZpZy5vbmVycm9yID0gZnVuY3Rpb24gKGVycm9yKSB7XG4gICAgTG9nZ2VyLmRlYnVnKFwiLS0tLS0tLS0tIE9ORVJST1IgLS0tLS0tLS0tLS1cIik7XG5cbiAgICBzdGF0dXMgPSBESVNDT05ORUNURUQ7XG5cbiAgICBpZiAob25lcnJvcikge1xuICAgICAgb25lcnJvcihlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgdmFyIHdzID0gbmV3IFdlYlNvY2tldFdpdGhSZWNvbm5lY3Rpb24od3NDb25maWcpO1xuXG4gIExvZ2dlci5kZWJ1ZygnQ29ubmVjdGluZyB3ZWJzb2NrZXQgdG8gVVJJOiAnICsgd3NDb25maWcudXJpKTtcblxuICB2YXIgcnBjQnVpbGRlck9wdGlvbnMgPSB7XG4gICAgcmVxdWVzdF90aW1lb3V0OiBjb25maWd1cmF0aW9uLnJwYy5yZXF1ZXN0VGltZW91dCxcbiAgICBwaW5nX3JlcXVlc3RfdGltZW91dDogY29uZmlndXJhdGlvbi5ycGMuaGVhcnRiZWF0UmVxdWVzdFRpbWVvdXRcbiAgfTtcblxuICB2YXIgcnBjID0gbmV3IFJwY0J1aWxkZXIoUnBjQnVpbGRlci5wYWNrZXJzLkpzb25SUEMsIHJwY0J1aWxkZXJPcHRpb25zLCB3cyxcbiAgICBmdW5jdGlvbiAocmVxdWVzdCkge1xuXG4gICAgICBMb2dnZXIuZGVidWcoJ1JlY2VpdmVkIHJlcXVlc3Q6ICcgKyBKU09OLnN0cmluZ2lmeShyZXF1ZXN0KSk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHZhciBmdW5jID0gY29uZmlndXJhdGlvbi5ycGNbcmVxdWVzdC5tZXRob2RdO1xuXG4gICAgICAgIGlmIChmdW5jID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBMb2dnZXIuZXJyb3IoXCJNZXRob2QgXCIgKyByZXF1ZXN0Lm1ldGhvZCArXG4gICAgICAgICAgICBcIiBub3QgcmVnaXN0ZXJlZCBpbiBjbGllbnRcIik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZnVuYyhyZXF1ZXN0LnBhcmFtcywgcmVxdWVzdCk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBMb2dnZXIuZXJyb3IoJ0V4Y2VwdGlvbiBwcm9jZXNzaW5nIHJlcXVlc3Q6ICcgKyBKU09OLnN0cmluZ2lmeShcbiAgICAgICAgICByZXF1ZXN0KSk7XG4gICAgICAgIExvZ2dlci5lcnJvcihlcnIpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gIHRoaXMuc2VuZCA9IGZ1bmN0aW9uIChtZXRob2QsIHBhcmFtcywgY2FsbGJhY2spIHtcbiAgICBpZiAobWV0aG9kICE9PSAncGluZycpIHtcbiAgICAgIExvZ2dlci5kZWJ1ZygnUmVxdWVzdDogbWV0aG9kOicgKyBtZXRob2QgKyBcIiBwYXJhbXM6XCIgKyBKU09OLnN0cmluZ2lmeShcbiAgICAgICAgcGFyYW1zKSk7XG4gICAgfVxuXG4gICAgdmFyIHJlcXVlc3RUaW1lID0gRGF0ZS5ub3coKTtcblxuICAgIHJwYy5lbmNvZGUobWV0aG9kLCBwYXJhbXMsIGZ1bmN0aW9uIChlcnJvciwgcmVzdWx0KSB7XG4gICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBMb2dnZXIuZXJyb3IoXCJFUlJPUjpcIiArIGVycm9yLm1lc3NhZ2UgKyBcIiBpbiBSZXF1ZXN0OiBtZXRob2Q6XCIgK1xuICAgICAgICAgICAgbWV0aG9kICsgXCIgcGFyYW1zOlwiICsgSlNPTi5zdHJpbmdpZnkocGFyYW1zKSArIFwiIHJlcXVlc3Q6XCIgK1xuICAgICAgICAgICAgZXJyb3IucmVxdWVzdCk7XG4gICAgICAgICAgaWYgKGVycm9yLmRhdGEpIHtcbiAgICAgICAgICAgIExvZ2dlci5lcnJvcihcIkVSUk9SIERBVEE6XCIgKyBKU09OLnN0cmluZ2lmeShlcnJvci5kYXRhKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlKSB7fVxuICAgICAgICBlcnJvci5yZXF1ZXN0VGltZSA9IHJlcXVlc3RUaW1lO1xuICAgICAgfVxuICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgIGlmIChyZXN1bHQgIT0gdW5kZWZpbmVkICYmIHJlc3VsdC52YWx1ZSAhPT0gJ3BvbmcnKSB7XG4gICAgICAgICAgTG9nZ2VyLmRlYnVnKCdSZXNwb25zZTogJyArIEpTT04uc3RyaW5naWZ5KHJlc3VsdCkpO1xuICAgICAgICB9XG4gICAgICAgIGNhbGxiYWNrKGVycm9yLCByZXN1bHQpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gdXBkYXRlTm90UmVjb25uZWN0SWZMZXNzVGhhbigpIHtcbiAgICBMb2dnZXIuZGVidWcoXCJub3RSZWNvbm5lY3RJZk51bUxlc3NUaGFuID0gXCIgKyBwaW5nTmV4dE51bSArICcgKG9sZD0nICtcbiAgICAgIG5vdFJlY29ubmVjdElmTnVtTGVzc1RoYW4gKyAnKScpO1xuICAgIG5vdFJlY29ubmVjdElmTnVtTGVzc1RoYW4gPSBwaW5nTmV4dE51bTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHNlbmRQaW5nKCkge1xuICAgIGlmIChlbmFibGVkUGluZ3MpIHtcbiAgICAgIHZhciBwYXJhbXMgPSBudWxsO1xuICAgICAgaWYgKHBpbmdOZXh0TnVtID09IDAgfHwgcGluZ05leHROdW0gPT0gbm90UmVjb25uZWN0SWZOdW1MZXNzVGhhbikge1xuICAgICAgICBwYXJhbXMgPSB7XG4gICAgICAgICAgaW50ZXJ2YWw6IGNvbmZpZ3VyYXRpb24uaGVhcnRiZWF0IHx8IFBJTkdfSU5URVJWQUxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIHBpbmdOZXh0TnVtKys7XG5cbiAgICAgIHNlbGYuc2VuZCgncGluZycsIHBhcmFtcywgKGZ1bmN0aW9uIChwaW5nTnVtKSB7XG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoZXJyb3IsIHJlc3VsdCkge1xuICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKFwiRXJyb3IgaW4gcGluZyByZXF1ZXN0ICNcIiArIHBpbmdOdW0gKyBcIiAoXCIgK1xuICAgICAgICAgICAgICBlcnJvci5tZXNzYWdlICsgXCIpXCIpO1xuICAgICAgICAgICAgaWYgKHBpbmdOdW0gPiBub3RSZWNvbm5lY3RJZk51bUxlc3NUaGFuKSB7XG4gICAgICAgICAgICAgIGVuYWJsZWRQaW5ncyA9IGZhbHNlO1xuICAgICAgICAgICAgICB1cGRhdGVOb3RSZWNvbm5lY3RJZkxlc3NUaGFuKCk7XG4gICAgICAgICAgICAgIExvZ2dlci5kZWJ1ZyhcIlNlcnZlciBkaWQgbm90IHJlc3BvbmQgdG8gcGluZyBtZXNzYWdlICNcIiArXG4gICAgICAgICAgICAgICAgcGluZ051bSArIFwiLiBSZWNvbm5lY3RpbmcuLi4gXCIpO1xuICAgICAgICAgICAgICB3cy5yZWNvbm5lY3RXcygpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSkocGluZ05leHROdW0pKTtcbiAgICB9IGVsc2Uge1xuICAgICAgTG9nZ2VyLmRlYnVnKFwiVHJ5aW5nIHRvIHNlbmQgcGluZywgYnV0IHBpbmcgaXMgbm90IGVuYWJsZWRcIik7XG4gICAgfVxuICB9XG5cbiAgLypcbiAgICogSWYgY29uZmlndXJhdGlvbi5oZWFyYmVhdCBoYXMgYW55IHZhbHVlLCB0aGUgcGluZy1wb25nIHdpbGwgd29yayB3aXRoIHRoZSBpbnRlcnZhbFxuICAgKiBvZiBjb25maWd1cmF0aW9uLmhlYXJiZWF0XG4gICAqL1xuICBmdW5jdGlvbiB1c2VQaW5nKCkge1xuICAgIGlmICghcGluZ1BvbmdTdGFydGVkKSB7XG4gICAgICBMb2dnZXIuZGVidWcoXCJTdGFydGluZyBwaW5nIChpZiBjb25maWd1cmVkKVwiKVxuICAgICAgcGluZ1BvbmdTdGFydGVkID0gdHJ1ZTtcblxuICAgICAgaWYgKGNvbmZpZ3VyYXRpb24uaGVhcnRiZWF0ICE9IHVuZGVmaW5lZCkge1xuICAgICAgICBwaW5nSW50ZXJ2YWwgPSBzZXRJbnRlcnZhbChzZW5kUGluZywgY29uZmlndXJhdGlvbi5oZWFydGJlYXQpO1xuICAgICAgICBzZW5kUGluZygpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHRoaXMuY2xvc2UgPSBmdW5jdGlvbiAoKSB7XG4gICAgTG9nZ2VyLmRlYnVnKFwiQ2xvc2luZyBqc29uUnBjQ2xpZW50IGV4cGxpY2l0bHkgYnkgY2xpZW50XCIpO1xuXG4gICAgaWYgKHBpbmdJbnRlcnZhbCAhPSB1bmRlZmluZWQpIHtcbiAgICAgIExvZ2dlci5kZWJ1ZyhcIkNsZWFyaW5nIHBpbmcgaW50ZXJ2YWxcIik7XG4gICAgICBjbGVhckludGVydmFsKHBpbmdJbnRlcnZhbCk7XG4gICAgfVxuICAgIHBpbmdQb25nU3RhcnRlZCA9IGZhbHNlO1xuICAgIGVuYWJsZWRQaW5ncyA9IGZhbHNlO1xuXG4gICAgaWYgKGNvbmZpZ3VyYXRpb24uc2VuZENsb3NlTWVzc2FnZSkge1xuICAgICAgTG9nZ2VyLmRlYnVnKFwiU2VuZGluZyBjbG9zZSBtZXNzYWdlXCIpXG4gICAgICB0aGlzLnNlbmQoJ2Nsb3NlU2Vzc2lvbicsIG51bGwsIGZ1bmN0aW9uIChlcnJvciwgcmVzdWx0KSB7XG4gICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgIExvZ2dlci5lcnJvcihcIkVycm9yIHNlbmRpbmcgY2xvc2UgbWVzc2FnZTogXCIgKyBKU09OLnN0cmluZ2lmeShcbiAgICAgICAgICAgIGVycm9yKSk7XG4gICAgICAgIH1cbiAgICAgICAgd3MuY2xvc2UoKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICB3cy5jbG9zZSgpO1xuICAgIH1cbiAgfVxuXG4gIC8vIFRoaXMgbWV0aG9kIGlzIG9ubHkgZm9yIHRlc3RpbmdcbiAgdGhpcy5mb3JjZUNsb3NlID0gZnVuY3Rpb24gKG1pbGxpcykge1xuICAgIHdzLmZvcmNlQ2xvc2UobWlsbGlzKTtcbiAgfVxuXG4gIHRoaXMucmVjb25uZWN0ID0gZnVuY3Rpb24gKCkge1xuICAgIHdzLnJlY29ubmVjdFdzKCk7XG4gIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBKc29uUnBjQ2xpZW50O1xuIiwiLypcbiAqIChDKSBDb3B5cmlnaHQgMjAxNCBLdXJlbnRvIChodHRwOi8va3VyZW50by5vcmcvKVxuICpcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqXG4gKiAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKlxuICovXG5cbnZhciBXZWJTb2NrZXRXaXRoUmVjb25uZWN0aW9uID0gcmVxdWlyZSgnLi93ZWJTb2NrZXRXaXRoUmVjb25uZWN0aW9uJyk7XG5cbmV4cG9ydHMuV2ViU29ja2V0V2l0aFJlY29ubmVjdGlvbiA9IFdlYlNvY2tldFdpdGhSZWNvbm5lY3Rpb247XG4iLCIvKlxuICogKEMpIENvcHlyaWdodCAyMDEzLTIwMTUgS3VyZW50byAoaHR0cDovL2t1cmVudG8ub3JnLylcbiAqXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuICogeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4gKlxuICogICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICovXG5cblwidXNlIHN0cmljdFwiO1xuXG52YXIgQnJvd3NlcldlYlNvY2tldCA9IGdsb2JhbC5XZWJTb2NrZXQgfHwgZ2xvYmFsLk1veldlYlNvY2tldDtcblxudmFyIExvZ2dlciA9IGNvbnNvbGU7XG5cbi8qKlxuICogR2V0IGVpdGhlciB0aGUgYFdlYlNvY2tldGAgb3IgYE1veldlYlNvY2tldGAgZ2xvYmFsc1xuICogaW4gdGhlIGJyb3dzZXIgb3IgdHJ5IHRvIHJlc29sdmUgV2ViU29ja2V0LWNvbXBhdGlibGVcbiAqIGludGVyZmFjZSBleHBvc2VkIGJ5IGB3c2AgZm9yIE5vZGUtbGlrZSBlbnZpcm9ubWVudC5cbiAqL1xuXG52YXIgV2ViU29ja2V0ID0gQnJvd3NlcldlYlNvY2tldDtcbmlmICghV2ViU29ja2V0ICYmIHR5cGVvZiB3aW5kb3cgPT09ICd1bmRlZmluZWQnKSB7XG4gIHRyeSB7XG4gICAgV2ViU29ja2V0ID0gcmVxdWlyZSgnd3MnKTtcbiAgfSBjYXRjaCAoZSkge31cbn1cblxuLy92YXIgU29ja0pTID0gcmVxdWlyZSgnc29ja2pzLWNsaWVudCcpO1xuXG52YXIgTUFYX1JFVFJJRVMgPSAyMDAwOyAvLyBGb3JldmVyLi4uXG52YXIgUkVUUllfVElNRV9NUyA9IDMwMDA7IC8vIEZJWE1FOiBJbXBsZW1lbnQgZXhwb25lbnRpYWwgd2FpdCB0aW1lcy4uLlxuXG52YXIgQ09OTkVDVElORyA9IDA7XG52YXIgT1BFTiA9IDE7XG52YXIgQ0xPU0lORyA9IDI7XG52YXIgQ0xPU0VEID0gMztcblxuLypcbmNvbmZpZyA9IHtcblx0XHR1cmkgOiB3c1VyaSxcblx0XHR1c2VTb2NrSlMgOiB0cnVlICh1c2UgU29ja0pTKSAvIGZhbHNlICh1c2UgV2ViU29ja2V0KSBieSBkZWZhdWx0LFxuXHRcdG9uY29ubmVjdGVkIDogY2FsbGJhY2sgbWV0aG9kIHRvIGludm9rZSB3aGVuIGNvbm5lY3Rpb24gaXMgc3VjY2Vzc2Z1bCxcblx0XHRvbmRpc2Nvbm5lY3QgOiBjYWxsYmFjayBtZXRob2QgdG8gaW52b2tlIHdoZW4gdGhlIGNvbm5lY3Rpb24gaXMgbG9zdCxcblx0XHRvbnJlY29ubmVjdGluZyA6IGNhbGxiYWNrIG1ldGhvZCB0byBpbnZva2Ugd2hlbiB0aGUgY2xpZW50IGlzIHJlY29ubmVjdGluZyxcblx0XHRvbnJlY29ubmVjdGVkIDogY2FsbGJhY2sgbWV0aG9kIHRvIGludm9rZSB3aGVuIHRoZSBjbGllbnQgc3VjY2VzZnVsbHkgcmVjb25uZWN0cyxcblx0fTtcbiovXG5mdW5jdGlvbiBXZWJTb2NrZXRXaXRoUmVjb25uZWN0aW9uKGNvbmZpZykge1xuXG4gIHZhciBjbG9zaW5nID0gZmFsc2U7XG4gIHZhciByZWdpc3Rlck1lc3NhZ2VIYW5kbGVyO1xuICB2YXIgd3NVcmkgPSBjb25maWcudXJpO1xuICB2YXIgdXNlU29ja0pTID0gY29uZmlnLnVzZVNvY2tKUztcbiAgdmFyIHJlY29ubmVjdGluZyA9IGZhbHNlO1xuXG4gIHZhciBmb3JjaW5nRGlzY29ubmVjdGlvbiA9IGZhbHNlO1xuXG4gIHZhciB3cztcblxuICBpZiAodXNlU29ja0pTKSB7XG4gICAgd3MgPSBuZXcgU29ja0pTKHdzVXJpKTtcbiAgfSBlbHNlIHtcbiAgICB3cyA9IG5ldyBXZWJTb2NrZXQod3NVcmkpO1xuICB9XG5cbiAgd3Mub25vcGVuID0gZnVuY3Rpb24gKCkge1xuICAgIGxvZ0Nvbm5lY3RlZCh3cywgd3NVcmkpO1xuICAgIGlmIChjb25maWcub25jb25uZWN0ZWQpIHtcbiAgICAgIGNvbmZpZy5vbmNvbm5lY3RlZCgpO1xuICAgIH1cbiAgfTtcblxuICB3cy5vbmVycm9yID0gZnVuY3Rpb24gKGVycm9yKSB7XG4gICAgTG9nZ2VyLmVycm9yKFwiQ291bGQgbm90IGNvbm5lY3QgdG8gXCIgKyB3c1VyaSArXG4gICAgICBcIiAoaW52b2tpbmcgb25lcnJvciBpZiBkZWZpbmVkKVwiLCBlcnJvcik7XG4gICAgaWYgKGNvbmZpZy5vbmVycm9yKSB7XG4gICAgICBjb25maWcub25lcnJvcihlcnJvcik7XG4gICAgfVxuICB9O1xuXG4gIGZ1bmN0aW9uIGxvZ0Nvbm5lY3RlZCh3cywgd3NVcmkpIHtcbiAgICB0cnkge1xuICAgICAgTG9nZ2VyLmRlYnVnKFwiV2ViU29ja2V0IGNvbm5lY3RlZCB0byBcIiArIHdzVXJpKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBMb2dnZXIuZXJyb3IoZSk7XG4gICAgfVxuICB9XG5cbiAgdmFyIHJlY29ubmVjdGlvbk9uQ2xvc2UgPSBmdW5jdGlvbiAoKSB7XG4gICAgaWYgKHdzLnJlYWR5U3RhdGUgPT09IENMT1NFRCkge1xuICAgICAgaWYgKGNsb3NpbmcpIHtcbiAgICAgICAgTG9nZ2VyLmRlYnVnKFwiQ29ubmVjdGlvbiBjbG9zZWQgYnkgdXNlclwiKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIExvZ2dlci5kZWJ1ZyhcIkNvbm5lY3Rpb24gY2xvc2VkIHVuZXhwZWN0ZWNseS4gUmVjb25uZWN0aW5nLi4uXCIpO1xuICAgICAgICByZWNvbm5lY3RUb1NhbWVVcmkoTUFYX1JFVFJJRVMsIDEpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBMb2dnZXIuZGVidWcoXCJDbG9zZSBjYWxsYmFjayBmcm9tIHByZXZpb3VzIHdlYnNvY2tldC4gSWdub3JpbmcgaXRcIik7XG4gICAgfVxuICB9O1xuXG4gIHdzLm9uY2xvc2UgPSByZWNvbm5lY3Rpb25PbkNsb3NlO1xuXG4gIGZ1bmN0aW9uIHJlY29ubmVjdFRvU2FtZVVyaShtYXhSZXRyaWVzLCBudW1SZXRyaWVzKSB7XG4gICAgTG9nZ2VyLmRlYnVnKFwicmVjb25uZWN0VG9TYW1lVXJpIChhdHRlbXB0ICNcIiArIG51bVJldHJpZXMgKyBcIiwgbWF4PVwiICtcbiAgICAgIG1heFJldHJpZXMgKyBcIilcIik7XG5cbiAgICBpZiAobnVtUmV0cmllcyA9PT0gMSkge1xuICAgICAgaWYgKHJlY29ubmVjdGluZykge1xuICAgICAgICBMb2dnZXIud2FybihcbiAgICAgICAgICBcIlRyeWluZyB0byByZWNvbm5lY3RUb05ld1VyaSB3aGVuIHJlY29ubmVjdGluZy4uLiBJZ25vcmluZyB0aGlzIHJlY29ubmVjdGlvbi5cIlxuICAgICAgICApXG4gICAgICAgIHJldHVybjtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlY29ubmVjdGluZyA9IHRydWU7XG4gICAgICB9XG5cbiAgICAgIGlmIChjb25maWcub25yZWNvbm5lY3RpbmcpIHtcbiAgICAgICAgY29uZmlnLm9ucmVjb25uZWN0aW5nKCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGZvcmNpbmdEaXNjb25uZWN0aW9uKSB7XG4gICAgICByZWNvbm5lY3RUb05ld1VyaShtYXhSZXRyaWVzLCBudW1SZXRyaWVzLCB3c1VyaSk7XG5cbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKGNvbmZpZy5uZXdXc1VyaU9uUmVjb25uZWN0aW9uKSB7XG4gICAgICAgIGNvbmZpZy5uZXdXc1VyaU9uUmVjb25uZWN0aW9uKGZ1bmN0aW9uIChlcnJvciwgbmV3V3NVcmkpIHtcblxuICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKGVycm9yKTtcbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICByZWNvbm5lY3RUb1NhbWVVcmkobWF4UmV0cmllcywgbnVtUmV0cmllcyArIDEpO1xuICAgICAgICAgICAgfSwgUkVUUllfVElNRV9NUyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlY29ubmVjdFRvTmV3VXJpKG1heFJldHJpZXMsIG51bVJldHJpZXMsIG5ld1dzVXJpKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZWNvbm5lY3RUb05ld1VyaShtYXhSZXRyaWVzLCBudW1SZXRyaWVzLCB3c1VyaSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gVE9ETyBUZXN0IHJldHJpZXMuIEhvdyB0byBmb3JjZSBub3QgY29ubmVjdGlvbj9cbiAgZnVuY3Rpb24gcmVjb25uZWN0VG9OZXdVcmkobWF4UmV0cmllcywgbnVtUmV0cmllcywgcmVjb25uZWN0V3NVcmkpIHtcbiAgICBMb2dnZXIuZGVidWcoXCJSZWNvbm5lY3Rpb24gYXR0ZW1wdCAjXCIgKyBudW1SZXRyaWVzKTtcblxuICAgIHdzLmNsb3NlKCk7XG5cbiAgICB3c1VyaSA9IHJlY29ubmVjdFdzVXJpIHx8IHdzVXJpO1xuXG4gICAgdmFyIG5ld1dzO1xuICAgIGlmICh1c2VTb2NrSlMpIHtcbiAgICAgIG5ld1dzID0gbmV3IFNvY2tKUyh3c1VyaSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5ld1dzID0gbmV3IFdlYlNvY2tldCh3c1VyaSk7XG4gICAgfVxuXG4gICAgbmV3V3Mub25vcGVuID0gZnVuY3Rpb24gKCkge1xuICAgICAgTG9nZ2VyLmRlYnVnKFwiUmVjb25uZWN0ZWQgYWZ0ZXIgXCIgKyBudW1SZXRyaWVzICsgXCIgYXR0ZW1wdHMuLi5cIik7XG4gICAgICBsb2dDb25uZWN0ZWQobmV3V3MsIHdzVXJpKTtcbiAgICAgIHJlY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgcmVnaXN0ZXJNZXNzYWdlSGFuZGxlcigpO1xuICAgICAgaWYgKGNvbmZpZy5vbnJlY29ubmVjdGVkKCkpIHtcbiAgICAgICAgY29uZmlnLm9ucmVjb25uZWN0ZWQoKTtcbiAgICAgIH1cblxuICAgICAgbmV3V3Mub25jbG9zZSA9IHJlY29ubmVjdGlvbk9uQ2xvc2U7XG4gICAgfTtcblxuICAgIHZhciBvbkVycm9yT3JDbG9zZSA9IGZ1bmN0aW9uIChlcnJvcikge1xuICAgICAgTG9nZ2VyLndhcm4oXCJSZWNvbm5lY3Rpb24gZXJyb3I6IFwiLCBlcnJvcik7XG5cbiAgICAgIGlmIChudW1SZXRyaWVzID09PSBtYXhSZXRyaWVzKSB7XG4gICAgICAgIGlmIChjb25maWcub25kaXNjb25uZWN0KSB7XG4gICAgICAgICAgY29uZmlnLm9uZGlzY29ubmVjdCgpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICByZWNvbm5lY3RUb1NhbWVVcmkobWF4UmV0cmllcywgbnVtUmV0cmllcyArIDEpO1xuICAgICAgICB9LCBSRVRSWV9USU1FX01TKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgbmV3V3Mub25lcnJvciA9IG9uRXJyb3JPckNsb3NlO1xuXG4gICAgd3MgPSBuZXdXcztcbiAgfVxuXG4gIHRoaXMuY2xvc2UgPSBmdW5jdGlvbiAoKSB7XG4gICAgY2xvc2luZyA9IHRydWU7XG4gICAgd3MuY2xvc2UoKTtcbiAgfTtcblxuICAvLyBUaGlzIG1ldGhvZCBpcyBvbmx5IGZvciB0ZXN0aW5nXG4gIHRoaXMuZm9yY2VDbG9zZSA9IGZ1bmN0aW9uIChtaWxsaXMpIHtcbiAgICBMb2dnZXIuZGVidWcoXCJUZXN0aW5nOiBGb3JjZSBXZWJTb2NrZXQgY2xvc2VcIik7XG5cbiAgICBpZiAobWlsbGlzKSB7XG4gICAgICBMb2dnZXIuZGVidWcoXCJUZXN0aW5nOiBDaGFuZ2Ugd3NVcmkgZm9yIFwiICsgbWlsbGlzICtcbiAgICAgICAgXCIgbWlsbGlzIHRvIHNpbXVsYXRlIG5ldCBmYWlsdXJlXCIpO1xuICAgICAgdmFyIGdvb2RXc1VyaSA9IHdzVXJpO1xuICAgICAgd3NVcmkgPSBcIndzczovLzIxLjIzNC4xMi4zNC40OjQ0My9cIjtcblxuICAgICAgZm9yY2luZ0Rpc2Nvbm5lY3Rpb24gPSB0cnVlO1xuXG4gICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgTG9nZ2VyLmRlYnVnKFwiVGVzdGluZzogUmVjb3ZlciBnb29kIHdzVXJpIFwiICsgZ29vZFdzVXJpKTtcbiAgICAgICAgd3NVcmkgPSBnb29kV3NVcmk7XG5cbiAgICAgICAgZm9yY2luZ0Rpc2Nvbm5lY3Rpb24gPSBmYWxzZTtcblxuICAgICAgfSwgbWlsbGlzKTtcbiAgICB9XG5cbiAgICB3cy5jbG9zZSgpO1xuICB9O1xuXG4gIHRoaXMucmVjb25uZWN0V3MgPSBmdW5jdGlvbiAoKSB7XG4gICAgTG9nZ2VyLmRlYnVnKFwicmVjb25uZWN0V3NcIik7XG4gICAgcmVjb25uZWN0VG9TYW1lVXJpKE1BWF9SRVRSSUVTLCAxLCB3c1VyaSk7XG4gIH07XG5cbiAgdGhpcy5zZW5kID0gZnVuY3Rpb24gKG1lc3NhZ2UpIHtcbiAgICB3cy5zZW5kKG1lc3NhZ2UpO1xuICB9O1xuXG4gIHRoaXMuYWRkRXZlbnRMaXN0ZW5lciA9IGZ1bmN0aW9uICh0eXBlLCBjYWxsYmFjaykge1xuICAgIHJlZ2lzdGVyTWVzc2FnZUhhbmRsZXIgPSBmdW5jdGlvbiAoKSB7XG4gICAgICB3cy5hZGRFdmVudExpc3RlbmVyKHR5cGUsIGNhbGxiYWNrKTtcbiAgICB9O1xuXG4gICAgcmVnaXN0ZXJNZXNzYWdlSGFuZGxlcigpO1xuICB9O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IFdlYlNvY2tldFdpdGhSZWNvbm5lY3Rpb247XG4iLCIvKlxuICogKEMpIENvcHlyaWdodCAyMDE0IEt1cmVudG8gKGh0dHA6Ly9rdXJlbnRvLm9yZy8pXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4gKlxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuICogV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cbiAqXG4gKi9cblxudmFyIGRlZmluZVByb3BlcnR5X0lFOCA9IGZhbHNlXG5pZiAoT2JqZWN0LmRlZmluZVByb3BlcnR5KSB7XG4gIHRyeSB7XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHt9LCBcInhcIiwge30pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgZGVmaW5lUHJvcGVydHlfSUU4ID0gdHJ1ZVxuICB9XG59XG5cbi8vIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0phdmFTY3JpcHQvUmVmZXJlbmNlL0dsb2JhbF9PYmplY3RzL0Z1bmN0aW9uL2JpbmRcbmlmICghRnVuY3Rpb24ucHJvdG90eXBlLmJpbmQpIHtcbiAgRnVuY3Rpb24ucHJvdG90eXBlLmJpbmQgPSBmdW5jdGlvbiAob1RoaXMpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIC8vIGNsb3Nlc3QgdGhpbmcgcG9zc2libGUgdG8gdGhlIEVDTUFTY3JpcHQgNVxuICAgICAgLy8gaW50ZXJuYWwgSXNDYWxsYWJsZSBmdW5jdGlvblxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgJ0Z1bmN0aW9uLnByb3RvdHlwZS5iaW5kIC0gd2hhdCBpcyB0cnlpbmcgdG8gYmUgYm91bmQgaXMgbm90IGNhbGxhYmxlJ1xuICAgICAgKTtcbiAgICB9XG5cbiAgICB2YXIgYUFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpLFxuICAgICAgZlRvQmluZCA9IHRoaXMsXG4gICAgICBmTk9QID0gZnVuY3Rpb24gKCkge30sXG4gICAgICBmQm91bmQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiBmVG9CaW5kLmFwcGx5KHRoaXMgaW5zdGFuY2VvZiBmTk9QICYmIG9UaGlzID9cbiAgICAgICAgICB0aGlzIDpcbiAgICAgICAgICBvVGhpcyxcbiAgICAgICAgICBhQXJncy5jb25jYXQoQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKSkpO1xuICAgICAgfTtcblxuICAgIGZOT1AucHJvdG90eXBlID0gdGhpcy5wcm90b3R5cGU7XG4gICAgZkJvdW5kLnByb3RvdHlwZSA9IG5ldyBmTk9QKCk7XG5cbiAgICByZXR1cm4gZkJvdW5kO1xuICB9O1xufVxuXG52YXIgRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyO1xuXG52YXIgaW5oZXJpdHMgPSByZXF1aXJlKCdpbmhlcml0cycpO1xuXG52YXIgcGFja2VycyA9IHJlcXVpcmUoJy4vcGFja2VycycpO1xudmFyIE1hcHBlciA9IHJlcXVpcmUoJy4vTWFwcGVyJyk7XG5cbnZhciBCQVNFX1RJTUVPVVQgPSA1MDAwO1xuXG5mdW5jdGlvbiB1bmlmeVJlc3BvbnNlTWV0aG9kcyhyZXNwb25zZU1ldGhvZHMpIHtcbiAgaWYgKCFyZXNwb25zZU1ldGhvZHMpIHJldHVybiB7fTtcblxuICBmb3IgKHZhciBrZXkgaW4gcmVzcG9uc2VNZXRob2RzKSB7XG4gICAgdmFyIHZhbHVlID0gcmVzcG9uc2VNZXRob2RzW2tleV07XG5cbiAgICBpZiAodHlwZW9mIHZhbHVlID09ICdzdHJpbmcnKVxuICAgICAgcmVzcG9uc2VNZXRob2RzW2tleV0gPSB7XG4gICAgICAgIHJlc3BvbnNlOiB2YWx1ZVxuICAgICAgfVxuICB9O1xuXG4gIHJldHVybiByZXNwb25zZU1ldGhvZHM7XG59O1xuXG5mdW5jdGlvbiB1bmlmeVRyYW5zcG9ydCh0cmFuc3BvcnQpIHtcbiAgaWYgKCF0cmFuc3BvcnQpIHJldHVybjtcblxuICAvLyBUcmFuc3BvcnQgYXMgYSBmdW5jdGlvblxuICBpZiAodHJhbnNwb3J0IGluc3RhbmNlb2YgRnVuY3Rpb24pXG4gICAgcmV0dXJuIHtcbiAgICAgIHNlbmQ6IHRyYW5zcG9ydFxuICAgIH07XG5cbiAgLy8gV2ViU29ja2V0ICYgRGF0YUNoYW5uZWxcbiAgaWYgKHRyYW5zcG9ydC5zZW5kIGluc3RhbmNlb2YgRnVuY3Rpb24pXG4gICAgcmV0dXJuIHRyYW5zcG9ydDtcblxuICAvLyBNZXNzYWdlIEFQSSAoSW50ZXItd2luZG93ICYgV2ViV29ya2VyKVxuICBpZiAodHJhbnNwb3J0LnBvc3RNZXNzYWdlIGluc3RhbmNlb2YgRnVuY3Rpb24pIHtcbiAgICB0cmFuc3BvcnQuc2VuZCA9IHRyYW5zcG9ydC5wb3N0TWVzc2FnZTtcbiAgICByZXR1cm4gdHJhbnNwb3J0O1xuICB9XG5cbiAgLy8gU3RyZWFtIEFQSVxuICBpZiAodHJhbnNwb3J0LndyaXRlIGluc3RhbmNlb2YgRnVuY3Rpb24pIHtcbiAgICB0cmFuc3BvcnQuc2VuZCA9IHRyYW5zcG9ydC53cml0ZTtcbiAgICByZXR1cm4gdHJhbnNwb3J0O1xuICB9XG5cbiAgLy8gVHJhbnNwb3J0cyB0aGF0IG9ubHkgY2FuIHJlY2VpdmUgbWVzc2FnZXMsIGJ1dCBub3Qgc2VuZFxuICBpZiAodHJhbnNwb3J0Lm9ubWVzc2FnZSAhPT0gdW5kZWZpbmVkKSByZXR1cm47XG4gIGlmICh0cmFuc3BvcnQucGF1c2UgaW5zdGFuY2VvZiBGdW5jdGlvbikgcmV0dXJuO1xuXG4gIHRocm93IG5ldyBTeW50YXhFcnJvcihcIlRyYW5zcG9ydCBpcyBub3QgYSBmdW5jdGlvbiBub3IgYSB2YWxpZCBvYmplY3RcIik7XG59O1xuXG4vKipcbiAqIFJlcHJlc2VudGF0aW9uIG9mIGEgUlBDIG5vdGlmaWNhdGlvblxuICpcbiAqIEBjbGFzc1xuICpcbiAqIEBjb25zdHJ1Y3RvclxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBtZXRob2QgLW1ldGhvZCBvZiB0aGUgbm90aWZpY2F0aW9uXG4gKiBAcGFyYW0gcGFyYW1zIC0gcGFyYW1ldGVycyBvZiB0aGUgbm90aWZpY2F0aW9uXG4gKi9cbmZ1bmN0aW9uIFJwY05vdGlmaWNhdGlvbihtZXRob2QsIHBhcmFtcykge1xuICBpZiAoZGVmaW5lUHJvcGVydHlfSUU4KSB7XG4gICAgdGhpcy5tZXRob2QgPSBtZXRob2RcbiAgICB0aGlzLnBhcmFtcyA9IHBhcmFtc1xuICB9IGVsc2Uge1xuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0aGlzLCAnbWV0aG9kJywge1xuICAgICAgdmFsdWU6IG1ldGhvZCxcbiAgICAgIGVudW1lcmFibGU6IHRydWVcbiAgICB9KTtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ3BhcmFtcycsIHtcbiAgICAgIHZhbHVlOiBwYXJhbXMsXG4gICAgICBlbnVtZXJhYmxlOiB0cnVlXG4gICAgfSk7XG4gIH1cbn07XG5cbi8qKlxuICogQGNsYXNzXG4gKlxuICogQGNvbnN0cnVjdG9yXG4gKlxuICogQHBhcmFtIHtvYmplY3R9IHBhY2tlclxuICpcbiAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc11cbiAqXG4gKiBAcGFyYW0ge29iamVjdH0gW3RyYW5zcG9ydF1cbiAqXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbb25SZXF1ZXN0XVxuICovXG5mdW5jdGlvbiBScGNCdWlsZGVyKHBhY2tlciwgb3B0aW9ucywgdHJhbnNwb3J0LCBvblJlcXVlc3QpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIGlmICghcGFja2VyKVxuICAgIHRocm93IG5ldyBTeW50YXhFcnJvcignUGFja2VyIGlzIG5vdCBkZWZpbmVkJyk7XG5cbiAgaWYgKCFwYWNrZXIucGFjayB8fCAhcGFja2VyLnVucGFjaylcbiAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoJ1BhY2tlciBpcyBpbnZhbGlkJyk7XG5cbiAgdmFyIHJlc3BvbnNlTWV0aG9kcyA9IHVuaWZ5UmVzcG9uc2VNZXRob2RzKHBhY2tlci5yZXNwb25zZU1ldGhvZHMpO1xuXG4gIGlmIChvcHRpb25zIGluc3RhbmNlb2YgRnVuY3Rpb24pIHtcbiAgICBpZiAodHJhbnNwb3J0ICE9IHVuZGVmaW5lZClcbiAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihcIlRoZXJlIGNhbid0IGJlIHBhcmFtZXRlcnMgYWZ0ZXIgb25SZXF1ZXN0XCIpO1xuXG4gICAgb25SZXF1ZXN0ID0gb3B0aW9ucztcbiAgICB0cmFuc3BvcnQgPSB1bmRlZmluZWQ7XG4gICAgb3B0aW9ucyA9IHVuZGVmaW5lZDtcbiAgfTtcblxuICBpZiAob3B0aW9ucyAmJiBvcHRpb25zLnNlbmQgaW5zdGFuY2VvZiBGdW5jdGlvbikge1xuICAgIGlmICh0cmFuc3BvcnQgJiYgISh0cmFuc3BvcnQgaW5zdGFuY2VvZiBGdW5jdGlvbikpXG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJPbmx5IGEgZnVuY3Rpb24gY2FuIGJlIGFmdGVyIHRyYW5zcG9ydFwiKTtcblxuICAgIG9uUmVxdWVzdCA9IHRyYW5zcG9ydDtcbiAgICB0cmFuc3BvcnQgPSBvcHRpb25zO1xuICAgIG9wdGlvbnMgPSB1bmRlZmluZWQ7XG4gIH07XG5cbiAgaWYgKHRyYW5zcG9ydCBpbnN0YW5jZW9mIEZ1bmN0aW9uKSB7XG4gICAgaWYgKG9uUmVxdWVzdCAhPSB1bmRlZmluZWQpXG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJUaGVyZSBjYW4ndCBiZSBwYXJhbWV0ZXJzIGFmdGVyIG9uUmVxdWVzdFwiKTtcblxuICAgIG9uUmVxdWVzdCA9IHRyYW5zcG9ydDtcbiAgICB0cmFuc3BvcnQgPSB1bmRlZmluZWQ7XG4gIH07XG5cbiAgaWYgKHRyYW5zcG9ydCAmJiB0cmFuc3BvcnQuc2VuZCBpbnN0YW5jZW9mIEZ1bmN0aW9uKVxuICAgIGlmIChvblJlcXVlc3QgJiYgIShvblJlcXVlc3QgaW5zdGFuY2VvZiBGdW5jdGlvbikpXG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJPbmx5IGEgZnVuY3Rpb24gY2FuIGJlIGFmdGVyIHRyYW5zcG9ydFwiKTtcblxuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuICBFdmVudEVtaXR0ZXIuY2FsbCh0aGlzKTtcblxuICBpZiAob25SZXF1ZXN0KVxuICAgIHRoaXMub24oJ3JlcXVlc3QnLCBvblJlcXVlc3QpO1xuXG4gIGlmIChkZWZpbmVQcm9wZXJ0eV9JRTgpXG4gICAgdGhpcy5wZWVySUQgPSBvcHRpb25zLnBlZXJJRFxuICBlbHNlXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsICdwZWVySUQnLCB7XG4gICAgICB2YWx1ZTogb3B0aW9ucy5wZWVySURcbiAgICB9KTtcblxuICB2YXIgbWF4X3JldHJpZXMgPSBvcHRpb25zLm1heF9yZXRyaWVzIHx8IDA7XG5cbiAgZnVuY3Rpb24gdHJhbnNwb3J0TWVzc2FnZShldmVudCkge1xuICAgIHNlbGYuZGVjb2RlKGV2ZW50LmRhdGEgfHwgZXZlbnQpO1xuICB9O1xuXG4gIHRoaXMuZ2V0VHJhbnNwb3J0ID0gZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiB0cmFuc3BvcnQ7XG4gIH1cbiAgdGhpcy5zZXRUcmFuc3BvcnQgPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAvLyBSZW1vdmUgbGlzdGVuZXIgZnJvbSBvbGQgdHJhbnNwb3J0XG4gICAgaWYgKHRyYW5zcG9ydCkge1xuICAgICAgLy8gVzNDIHRyYW5zcG9ydHNcbiAgICAgIGlmICh0cmFuc3BvcnQucmVtb3ZlRXZlbnRMaXN0ZW5lcilcbiAgICAgICAgdHJhbnNwb3J0LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCB0cmFuc3BvcnRNZXNzYWdlKTtcblxuICAgICAgLy8gTm9kZS5qcyBTdHJlYW1zIEFQSVxuICAgICAgZWxzZSBpZiAodHJhbnNwb3J0LnJlbW92ZUxpc3RlbmVyKVxuICAgICAgICB0cmFuc3BvcnQucmVtb3ZlTGlzdGVuZXIoJ2RhdGEnLCB0cmFuc3BvcnRNZXNzYWdlKTtcbiAgICB9O1xuXG4gICAgLy8gU2V0IGxpc3RlbmVyIG9uIG5ldyB0cmFuc3BvcnRcbiAgICBpZiAodmFsdWUpIHtcbiAgICAgIC8vIFczQyB0cmFuc3BvcnRzXG4gICAgICBpZiAodmFsdWUuYWRkRXZlbnRMaXN0ZW5lcilcbiAgICAgICAgdmFsdWUuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIHRyYW5zcG9ydE1lc3NhZ2UpO1xuXG4gICAgICAvLyBOb2RlLmpzIFN0cmVhbXMgQVBJXG4gICAgICBlbHNlIGlmICh2YWx1ZS5hZGRMaXN0ZW5lcilcbiAgICAgICAgdmFsdWUuYWRkTGlzdGVuZXIoJ2RhdGEnLCB0cmFuc3BvcnRNZXNzYWdlKTtcbiAgICB9O1xuXG4gICAgdHJhbnNwb3J0ID0gdW5pZnlUcmFuc3BvcnQodmFsdWUpO1xuICB9XG5cbiAgaWYgKCFkZWZpbmVQcm9wZXJ0eV9JRTgpXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsICd0cmFuc3BvcnQnLCB7XG4gICAgICBnZXQ6IHRoaXMuZ2V0VHJhbnNwb3J0LmJpbmQodGhpcyksXG4gICAgICBzZXQ6IHRoaXMuc2V0VHJhbnNwb3J0LmJpbmQodGhpcylcbiAgICB9KVxuXG4gIHRoaXMuc2V0VHJhbnNwb3J0KHRyYW5zcG9ydCk7XG5cbiAgdmFyIHJlcXVlc3RfdGltZW91dCA9IG9wdGlvbnMucmVxdWVzdF90aW1lb3V0IHx8IEJBU0VfVElNRU9VVDtcbiAgdmFyIHBpbmdfcmVxdWVzdF90aW1lb3V0ID0gb3B0aW9ucy5waW5nX3JlcXVlc3RfdGltZW91dCB8fCByZXF1ZXN0X3RpbWVvdXQ7XG4gIHZhciByZXNwb25zZV90aW1lb3V0ID0gb3B0aW9ucy5yZXNwb25zZV90aW1lb3V0IHx8IEJBU0VfVElNRU9VVDtcbiAgdmFyIGR1cGxpY2F0ZXNfdGltZW91dCA9IG9wdGlvbnMuZHVwbGljYXRlc190aW1lb3V0IHx8IEJBU0VfVElNRU9VVDtcblxuICB2YXIgcmVxdWVzdElEID0gMDtcblxuICB2YXIgcmVxdWVzdHMgPSBuZXcgTWFwcGVyKCk7XG4gIHZhciByZXNwb25zZXMgPSBuZXcgTWFwcGVyKCk7XG4gIHZhciBwcm9jZXNzZWRSZXNwb25zZXMgPSBuZXcgTWFwcGVyKCk7XG5cbiAgdmFyIG1lc3NhZ2UyS2V5ID0ge307XG5cbiAgLyoqXG4gICAqIFN0b3JlIHRoZSByZXNwb25zZSB0byBwcmV2ZW50IHRvIHByb2Nlc3MgZHVwbGljYXRlIHJlcXVlc3QgbGF0ZXJcbiAgICovXG4gIGZ1bmN0aW9uIHN0b3JlUmVzcG9uc2UobWVzc2FnZSwgaWQsIGRlc3QpIHtcbiAgICB2YXIgcmVzcG9uc2UgPSB7XG4gICAgICBtZXNzYWdlOiBtZXNzYWdlLFxuICAgICAgLyoqIFRpbWVvdXQgdG8gYXV0by1jbGVhbiBvbGQgcmVzcG9uc2VzICovXG4gICAgICB0aW1lb3V0OiBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICByZXNwb25zZXMucmVtb3ZlKGlkLCBkZXN0KTtcbiAgICAgICAgfSxcbiAgICAgICAgcmVzcG9uc2VfdGltZW91dClcbiAgICB9O1xuXG4gICAgcmVzcG9uc2VzLnNldChyZXNwb25zZSwgaWQsIGRlc3QpO1xuICB9O1xuXG4gIC8qKlxuICAgKiBTdG9yZSB0aGUgcmVzcG9uc2UgdG8gaWdub3JlIGR1cGxpY2F0ZWQgbWVzc2FnZXMgbGF0ZXJcbiAgICovXG4gIGZ1bmN0aW9uIHN0b3JlUHJvY2Vzc2VkUmVzcG9uc2UoYWNrLCBmcm9tKSB7XG4gICAgdmFyIHRpbWVvdXQgPSBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcHJvY2Vzc2VkUmVzcG9uc2VzLnJlbW92ZShhY2ssIGZyb20pO1xuICAgICAgfSxcbiAgICAgIGR1cGxpY2F0ZXNfdGltZW91dCk7XG5cbiAgICBwcm9jZXNzZWRSZXNwb25zZXMuc2V0KHRpbWVvdXQsIGFjaywgZnJvbSk7XG4gIH07XG5cbiAgLyoqXG4gICAqIFJlcHJlc2VudGF0aW9uIG9mIGEgUlBDIHJlcXVlc3RcbiAgICpcbiAgICogQGNsYXNzXG4gICAqIEBleHRlbmRzIFJwY05vdGlmaWNhdGlvblxuICAgKlxuICAgKiBAY29uc3RydWN0b3JcbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1ldGhvZCAtbWV0aG9kIG9mIHRoZSBub3RpZmljYXRpb25cbiAgICogQHBhcmFtIHBhcmFtcyAtIHBhcmFtZXRlcnMgb2YgdGhlIG5vdGlmaWNhdGlvblxuICAgKiBAcGFyYW0ge0ludGVnZXJ9IGlkIC0gaWRlbnRpZmllciBvZiB0aGUgcmVxdWVzdFxuICAgKiBAcGFyYW0gW2Zyb21dIC0gc291cmNlIG9mIHRoZSBub3RpZmljYXRpb25cbiAgICovXG4gIGZ1bmN0aW9uIFJwY1JlcXVlc3QobWV0aG9kLCBwYXJhbXMsIGlkLCBmcm9tLCB0cmFuc3BvcnQpIHtcbiAgICBScGNOb3RpZmljYXRpb24uY2FsbCh0aGlzLCBtZXRob2QsIHBhcmFtcyk7XG5cbiAgICB0aGlzLmdldFRyYW5zcG9ydCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgIHJldHVybiB0cmFuc3BvcnQ7XG4gICAgfVxuICAgIHRoaXMuc2V0VHJhbnNwb3J0ID0gZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICB0cmFuc3BvcnQgPSB1bmlmeVRyYW5zcG9ydCh2YWx1ZSk7XG4gICAgfVxuXG4gICAgaWYgKCFkZWZpbmVQcm9wZXJ0eV9JRTgpXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ3RyYW5zcG9ydCcsIHtcbiAgICAgICAgZ2V0OiB0aGlzLmdldFRyYW5zcG9ydC5iaW5kKHRoaXMpLFxuICAgICAgICBzZXQ6IHRoaXMuc2V0VHJhbnNwb3J0LmJpbmQodGhpcylcbiAgICAgIH0pXG5cbiAgICB2YXIgcmVzcG9uc2UgPSByZXNwb25zZXMuZ2V0KGlkLCBmcm9tKTtcblxuICAgIC8qKlxuICAgICAqIEBjb25zdGFudCB7Qm9vbGVhbn0gZHVwbGljYXRlZFxuICAgICAqL1xuICAgIGlmICghKHRyYW5zcG9ydCB8fCBzZWxmLmdldFRyYW5zcG9ydCgpKSkge1xuICAgICAgaWYgKGRlZmluZVByb3BlcnR5X0lFOClcbiAgICAgICAgdGhpcy5kdXBsaWNhdGVkID0gQm9vbGVhbihyZXNwb25zZSlcbiAgICAgIGVsc2VcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsICdkdXBsaWNhdGVkJywge1xuICAgICAgICAgIHZhbHVlOiBCb29sZWFuKHJlc3BvbnNlKVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICB2YXIgcmVzcG9uc2VNZXRob2QgPSByZXNwb25zZU1ldGhvZHNbbWV0aG9kXTtcblxuICAgIHRoaXMucGFjayA9IHBhY2tlci5wYWNrLmJpbmQocGFja2VyLCB0aGlzLCBpZClcblxuICAgIC8qKlxuICAgICAqIEdlbmVyYXRlIGEgcmVzcG9uc2UgdG8gdGhpcyByZXF1ZXN0XG4gICAgICpcbiAgICAgKiBAcGFyYW0ge0Vycm9yfSBbZXJyb3JdXG4gICAgICogQHBhcmFtIHsqfSBbcmVzdWx0XVxuICAgICAqXG4gICAgICogQHJldHVybnMge3N0cmluZ31cbiAgICAgKi9cbiAgICB0aGlzLnJlcGx5ID0gZnVuY3Rpb24gKGVycm9yLCByZXN1bHQsIHRyYW5zcG9ydCkge1xuICAgICAgLy8gRml4IG9wdGlvbmFsIHBhcmFtZXRlcnNcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEZ1bmN0aW9uIHx8IGVycm9yICYmIGVycm9yXG4gICAgICAgIC5zZW5kIGluc3RhbmNlb2YgRnVuY3Rpb24pIHtcbiAgICAgICAgaWYgKHJlc3VsdCAhPSB1bmRlZmluZWQpXG4gICAgICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiVGhlcmUgY2FuJ3QgYmUgcGFyYW1ldGVycyBhZnRlciBjYWxsYmFja1wiKTtcblxuICAgICAgICB0cmFuc3BvcnQgPSBlcnJvcjtcbiAgICAgICAgcmVzdWx0ID0gbnVsbDtcbiAgICAgICAgZXJyb3IgPSB1bmRlZmluZWQ7XG4gICAgICB9IGVsc2UgaWYgKHJlc3VsdCBpbnN0YW5jZW9mIEZ1bmN0aW9uIHx8XG4gICAgICAgIHJlc3VsdCAmJiByZXN1bHQuc2VuZCBpbnN0YW5jZW9mIEZ1bmN0aW9uKSB7XG4gICAgICAgIGlmICh0cmFuc3BvcnQgIT0gdW5kZWZpbmVkKVxuICAgICAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihcIlRoZXJlIGNhbid0IGJlIHBhcmFtZXRlcnMgYWZ0ZXIgY2FsbGJhY2tcIik7XG5cbiAgICAgICAgdHJhbnNwb3J0ID0gcmVzdWx0O1xuICAgICAgICByZXN1bHQgPSBudWxsO1xuICAgICAgfTtcblxuICAgICAgdHJhbnNwb3J0ID0gdW5pZnlUcmFuc3BvcnQodHJhbnNwb3J0KTtcblxuICAgICAgLy8gRHVwbGljYXRlZCByZXF1ZXN0LCByZW1vdmUgb2xkIHJlc3BvbnNlIHRpbWVvdXRcbiAgICAgIGlmIChyZXNwb25zZSlcbiAgICAgICAgY2xlYXJUaW1lb3V0KHJlc3BvbnNlLnRpbWVvdXQpO1xuXG4gICAgICBpZiAoZnJvbSAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgaWYgKGVycm9yKVxuICAgICAgICAgIGVycm9yLmRlc3QgPSBmcm9tO1xuXG4gICAgICAgIGlmIChyZXN1bHQpXG4gICAgICAgICAgcmVzdWx0LmRlc3QgPSBmcm9tO1xuICAgICAgfTtcblxuICAgICAgdmFyIG1lc3NhZ2U7XG5cbiAgICAgIC8vIE5ldyByZXF1ZXN0IG9yIG92ZXJyaWRlbiBvbmUsIGNyZWF0ZSBuZXcgcmVzcG9uc2Ugd2l0aCBwcm92aWRlZCBkYXRhXG4gICAgICBpZiAoZXJyb3IgfHwgcmVzdWx0ICE9IHVuZGVmaW5lZCkge1xuICAgICAgICBpZiAoc2VsZi5wZWVySUQgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgaWYgKGVycm9yKVxuICAgICAgICAgICAgZXJyb3IuZnJvbSA9IHNlbGYucGVlcklEO1xuICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgIHJlc3VsdC5mcm9tID0gc2VsZi5wZWVySUQ7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBQcm90b2NvbCBpbmRpY2F0ZXMgdGhhdCByZXNwb25zZXMgaGFzIG93biByZXF1ZXN0IG1ldGhvZHNcbiAgICAgICAgaWYgKHJlc3BvbnNlTWV0aG9kKSB7XG4gICAgICAgICAgaWYgKHJlc3BvbnNlTWV0aG9kLmVycm9yID09IHVuZGVmaW5lZCAmJiBlcnJvcilcbiAgICAgICAgICAgIG1lc3NhZ2UgPSB7XG4gICAgICAgICAgICAgIGVycm9yOiBlcnJvclxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgdmFyIG1ldGhvZCA9IGVycm9yID9cbiAgICAgICAgICAgICAgcmVzcG9uc2VNZXRob2QuZXJyb3IgOlxuICAgICAgICAgICAgICByZXNwb25zZU1ldGhvZC5yZXNwb25zZTtcblxuICAgICAgICAgICAgbWVzc2FnZSA9IHtcbiAgICAgICAgICAgICAgbWV0aG9kOiBtZXRob2QsXG4gICAgICAgICAgICAgIHBhcmFtczogZXJyb3IgfHwgcmVzdWx0XG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlXG4gICAgICAgICAgbWVzc2FnZSA9IHtcbiAgICAgICAgICAgIGVycm9yOiBlcnJvcixcbiAgICAgICAgICAgIHJlc3VsdDogcmVzdWx0XG4gICAgICAgICAgfTtcblxuICAgICAgICBtZXNzYWdlID0gcGFja2VyLnBhY2sobWVzc2FnZSwgaWQpO1xuICAgICAgfVxuXG4gICAgICAvLyBEdXBsaWNhdGUgJiBub3Qtb3ZlcnJpZGVuIHJlcXVlc3QsIHJlLXNlbmQgb2xkIHJlc3BvbnNlXG4gICAgICBlbHNlIGlmIChyZXNwb25zZSlcbiAgICAgICAgbWVzc2FnZSA9IHJlc3BvbnNlLm1lc3NhZ2U7XG5cbiAgICAgIC8vIE5ldyBlbXB0eSByZXBseSwgcmVzcG9uc2UgbnVsbCB2YWx1ZVxuICAgICAgZWxzZVxuICAgICAgICBtZXNzYWdlID0gcGFja2VyLnBhY2soe1xuICAgICAgICAgIHJlc3VsdDogbnVsbFxuICAgICAgICB9LCBpZCk7XG5cbiAgICAgIC8vIFN0b3JlIHRoZSByZXNwb25zZSB0byBwcmV2ZW50IHRvIHByb2Nlc3MgYSBkdXBsaWNhdGVkIHJlcXVlc3QgbGF0ZXJcbiAgICAgIHN0b3JlUmVzcG9uc2UobWVzc2FnZSwgaWQsIGZyb20pO1xuXG4gICAgICAvLyBSZXR1cm4gdGhlIHN0b3JlZCByZXNwb25zZSBzbyBpdCBjYW4gYmUgZGlyZWN0bHkgc2VuZCBiYWNrXG4gICAgICB0cmFuc3BvcnQgPSB0cmFuc3BvcnQgfHwgdGhpcy5nZXRUcmFuc3BvcnQoKSB8fCBzZWxmLmdldFRyYW5zcG9ydCgpO1xuXG4gICAgICBpZiAodHJhbnNwb3J0KVxuICAgICAgICByZXR1cm4gdHJhbnNwb3J0LnNlbmQobWVzc2FnZSk7XG5cbiAgICAgIHJldHVybiBtZXNzYWdlO1xuICAgIH1cbiAgfTtcbiAgaW5oZXJpdHMoUnBjUmVxdWVzdCwgUnBjTm90aWZpY2F0aW9uKTtcblxuICBmdW5jdGlvbiBjYW5jZWwobWVzc2FnZSkge1xuICAgIHZhciBrZXkgPSBtZXNzYWdlMktleVttZXNzYWdlXTtcbiAgICBpZiAoIWtleSkgcmV0dXJuO1xuXG4gICAgZGVsZXRlIG1lc3NhZ2UyS2V5W21lc3NhZ2VdO1xuXG4gICAgdmFyIHJlcXVlc3QgPSByZXF1ZXN0cy5wb3Aoa2V5LmlkLCBrZXkuZGVzdCk7XG4gICAgaWYgKCFyZXF1ZXN0KSByZXR1cm47XG5cbiAgICBjbGVhclRpbWVvdXQocmVxdWVzdC50aW1lb3V0KTtcblxuICAgIC8vIFN0YXJ0IGR1cGxpY2F0ZWQgcmVzcG9uc2VzIHRpbWVvdXRcbiAgICBzdG9yZVByb2Nlc3NlZFJlc3BvbnNlKGtleS5pZCwga2V5LmRlc3QpO1xuICB9O1xuXG4gIC8qKlxuICAgKiBBbGxvdyB0byBjYW5jZWwgYSByZXF1ZXN0IGFuZCBkb24ndCB3YWl0IGZvciBhIHJlc3BvbnNlXG4gICAqXG4gICAqIElmIGBtZXNzYWdlYCBpcyBub3QgZ2l2ZW4sIGNhbmNlbCBhbGwgdGhlIHJlcXVlc3RcbiAgICovXG4gIHRoaXMuY2FuY2VsID0gZnVuY3Rpb24gKG1lc3NhZ2UpIHtcbiAgICBpZiAobWVzc2FnZSkgcmV0dXJuIGNhbmNlbChtZXNzYWdlKTtcblxuICAgIGZvciAodmFyIG1lc3NhZ2UgaW4gbWVzc2FnZTJLZXkpXG4gICAgICBjYW5jZWwobWVzc2FnZSk7XG4gIH07XG5cbiAgdGhpcy5jbG9zZSA9IGZ1bmN0aW9uICgpIHtcbiAgICAvLyBQcmV2ZW50IHRvIHJlY2VpdmUgbmV3IG1lc3NhZ2VzXG4gICAgdmFyIHRyYW5zcG9ydCA9IHRoaXMuZ2V0VHJhbnNwb3J0KCk7XG4gICAgaWYgKHRyYW5zcG9ydCAmJiB0cmFuc3BvcnQuY2xvc2UpXG4gICAgICB0cmFuc3BvcnQuY2xvc2UoKTtcblxuICAgIC8vIFJlcXVlc3QgJiBwcm9jZXNzZWQgcmVzcG9uc2VzXG4gICAgdGhpcy5jYW5jZWwoKTtcblxuICAgIHByb2Nlc3NlZFJlc3BvbnNlcy5mb3JFYWNoKGNsZWFyVGltZW91dCk7XG5cbiAgICAvLyBSZXNwb25zZXNcbiAgICByZXNwb25zZXMuZm9yRWFjaChmdW5jdGlvbiAocmVzcG9uc2UpIHtcbiAgICAgIGNsZWFyVGltZW91dChyZXNwb25zZS50aW1lb3V0KTtcbiAgICB9KTtcbiAgfTtcblxuICAvKipcbiAgICogR2VuZXJhdGVzIGFuZCBlbmNvZGUgYSBKc29uUlBDIDIuMCBtZXNzYWdlXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXRob2QgLW1ldGhvZCBvZiB0aGUgbm90aWZpY2F0aW9uXG4gICAqIEBwYXJhbSBwYXJhbXMgLSBwYXJhbWV0ZXJzIG9mIHRoZSBub3RpZmljYXRpb25cbiAgICogQHBhcmFtIFtkZXN0XSAtIGRlc3RpbmF0aW9uIG9mIHRoZSBub3RpZmljYXRpb25cbiAgICogQHBhcmFtIHtvYmplY3R9IFt0cmFuc3BvcnRdIC0gdHJhbnNwb3J0IHdoZXJlIHRvIHNlbmQgdGhlIG1lc3NhZ2VcbiAgICogQHBhcmFtIFtjYWxsYmFja10gLSBmdW5jdGlvbiBjYWxsZWQgd2hlbiBhIHJlc3BvbnNlIHRvIHRoaXMgcmVxdWVzdCBpc1xuICAgKiAgIHJlY2VpdmVkLiBJZiBub3QgZGVmaW5lZCwgYSBub3RpZmljYXRpb24gd2lsbCBiZSBzZW5kIGluc3RlYWRcbiAgICpcbiAgICogQHJldHVybnMge3N0cmluZ30gQSByYXcgSnNvblJQQyAyLjAgcmVxdWVzdCBvciBub3RpZmljYXRpb24gc3RyaW5nXG4gICAqL1xuICB0aGlzLmVuY29kZSA9IGZ1bmN0aW9uIChtZXRob2QsIHBhcmFtcywgZGVzdCwgdHJhbnNwb3J0LCBjYWxsYmFjaykge1xuICAgIC8vIEZpeCBvcHRpb25hbCBwYXJhbWV0ZXJzXG4gICAgaWYgKHBhcmFtcyBpbnN0YW5jZW9mIEZ1bmN0aW9uKSB7XG4gICAgICBpZiAoZGVzdCAhPSB1bmRlZmluZWQpXG4gICAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihcIlRoZXJlIGNhbid0IGJlIHBhcmFtZXRlcnMgYWZ0ZXIgY2FsbGJhY2tcIik7XG5cbiAgICAgIGNhbGxiYWNrID0gcGFyYW1zO1xuICAgICAgdHJhbnNwb3J0ID0gdW5kZWZpbmVkO1xuICAgICAgZGVzdCA9IHVuZGVmaW5lZDtcbiAgICAgIHBhcmFtcyA9IHVuZGVmaW5lZDtcbiAgICB9IGVsc2UgaWYgKGRlc3QgaW5zdGFuY2VvZiBGdW5jdGlvbikge1xuICAgICAgaWYgKHRyYW5zcG9ydCAhPSB1bmRlZmluZWQpXG4gICAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihcIlRoZXJlIGNhbid0IGJlIHBhcmFtZXRlcnMgYWZ0ZXIgY2FsbGJhY2tcIik7XG5cbiAgICAgIGNhbGxiYWNrID0gZGVzdDtcbiAgICAgIHRyYW5zcG9ydCA9IHVuZGVmaW5lZDtcbiAgICAgIGRlc3QgPSB1bmRlZmluZWQ7XG4gICAgfSBlbHNlIGlmICh0cmFuc3BvcnQgaW5zdGFuY2VvZiBGdW5jdGlvbikge1xuICAgICAgaWYgKGNhbGxiYWNrICE9IHVuZGVmaW5lZClcbiAgICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiVGhlcmUgY2FuJ3QgYmUgcGFyYW1ldGVycyBhZnRlciBjYWxsYmFja1wiKTtcblxuICAgICAgY2FsbGJhY2sgPSB0cmFuc3BvcnQ7XG4gICAgICB0cmFuc3BvcnQgPSB1bmRlZmluZWQ7XG4gICAgfTtcblxuICAgIGlmIChzZWxmLnBlZXJJRCAhPSB1bmRlZmluZWQpIHtcbiAgICAgIHBhcmFtcyA9IHBhcmFtcyB8fCB7fTtcblxuICAgICAgcGFyYW1zLmZyb20gPSBzZWxmLnBlZXJJRDtcbiAgICB9O1xuXG4gICAgaWYgKGRlc3QgIT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYXJhbXMgPSBwYXJhbXMgfHwge307XG5cbiAgICAgIHBhcmFtcy5kZXN0ID0gZGVzdDtcbiAgICB9O1xuXG4gICAgLy8gRW5jb2RlIG1lc3NhZ2VcbiAgICB2YXIgbWVzc2FnZSA9IHtcbiAgICAgIG1ldGhvZDogbWV0aG9kLFxuICAgICAgcGFyYW1zOiBwYXJhbXNcbiAgICB9O1xuXG4gICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICB2YXIgaWQgPSByZXF1ZXN0SUQrKztcbiAgICAgIHZhciByZXRyaWVkID0gMDtcblxuICAgICAgbWVzc2FnZSA9IHBhY2tlci5wYWNrKG1lc3NhZ2UsIGlkKTtcblxuICAgICAgZnVuY3Rpb24gZGlzcGF0Y2hDYWxsYmFjayhlcnJvciwgcmVzdWx0KSB7XG4gICAgICAgIHNlbGYuY2FuY2VsKG1lc3NhZ2UpO1xuXG4gICAgICAgIGNhbGxiYWNrKGVycm9yLCByZXN1bHQpO1xuICAgICAgfTtcblxuICAgICAgdmFyIHJlcXVlc3QgPSB7XG4gICAgICAgIG1lc3NhZ2U6IG1lc3NhZ2UsXG4gICAgICAgIGNhbGxiYWNrOiBkaXNwYXRjaENhbGxiYWNrLFxuICAgICAgICByZXNwb25zZU1ldGhvZHM6IHJlc3BvbnNlTWV0aG9kc1ttZXRob2RdIHx8IHt9XG4gICAgICB9O1xuXG4gICAgICB2YXIgZW5jb2RlX3RyYW5zcG9ydCA9IHVuaWZ5VHJhbnNwb3J0KHRyYW5zcG9ydCk7XG5cbiAgICAgIGZ1bmN0aW9uIHNlbmRSZXF1ZXN0KHRyYW5zcG9ydCkge1xuICAgICAgICB2YXIgcnQgPSAobWV0aG9kID09PSAncGluZycgPyBwaW5nX3JlcXVlc3RfdGltZW91dCA6IHJlcXVlc3RfdGltZW91dCk7XG4gICAgICAgIHJlcXVlc3QudGltZW91dCA9IHNldFRpbWVvdXQodGltZW91dCwgcnQgKiBNYXRoLnBvdygyLCByZXRyaWVkKyspKTtcbiAgICAgICAgbWVzc2FnZTJLZXlbbWVzc2FnZV0gPSB7XG4gICAgICAgICAgaWQ6IGlkLFxuICAgICAgICAgIGRlc3Q6IGRlc3RcbiAgICAgICAgfTtcbiAgICAgICAgcmVxdWVzdHMuc2V0KHJlcXVlc3QsIGlkLCBkZXN0KTtcblxuICAgICAgICB0cmFuc3BvcnQgPSB0cmFuc3BvcnQgfHwgZW5jb2RlX3RyYW5zcG9ydCB8fCBzZWxmLmdldFRyYW5zcG9ydCgpO1xuICAgICAgICBpZiAodHJhbnNwb3J0KVxuICAgICAgICAgIHJldHVybiB0cmFuc3BvcnQuc2VuZChtZXNzYWdlKTtcblxuICAgICAgICByZXR1cm4gbWVzc2FnZTtcbiAgICAgIH07XG5cbiAgICAgIGZ1bmN0aW9uIHJldHJ5KHRyYW5zcG9ydCkge1xuICAgICAgICB0cmFuc3BvcnQgPSB1bmlmeVRyYW5zcG9ydCh0cmFuc3BvcnQpO1xuXG4gICAgICAgIGNvbnNvbGUud2FybihyZXRyaWVkICsgJyByZXRyeSBmb3IgcmVxdWVzdCBtZXNzYWdlOicsIG1lc3NhZ2UpO1xuXG4gICAgICAgIHZhciB0aW1lb3V0ID0gcHJvY2Vzc2VkUmVzcG9uc2VzLnBvcChpZCwgZGVzdCk7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcblxuICAgICAgICByZXR1cm4gc2VuZFJlcXVlc3QodHJhbnNwb3J0KTtcbiAgICAgIH07XG5cbiAgICAgIGZ1bmN0aW9uIHRpbWVvdXQoKSB7XG4gICAgICAgIGlmIChyZXRyaWVkIDwgbWF4X3JldHJpZXMpXG4gICAgICAgICAgcmV0dXJuIHJldHJ5KHRyYW5zcG9ydCk7XG5cbiAgICAgICAgdmFyIGVycm9yID0gbmV3IEVycm9yKCdSZXF1ZXN0IGhhcyB0aW1lZCBvdXQnKTtcbiAgICAgICAgZXJyb3IucmVxdWVzdCA9IG1lc3NhZ2U7XG5cbiAgICAgICAgZXJyb3IucmV0cnkgPSByZXRyeTtcblxuICAgICAgICBkaXNwYXRjaENhbGxiYWNrKGVycm9yKVxuICAgICAgfTtcblxuICAgICAgcmV0dXJuIHNlbmRSZXF1ZXN0KHRyYW5zcG9ydCk7XG4gICAgfTtcblxuICAgIC8vIFJldHVybiB0aGUgcGFja2VkIG1lc3NhZ2VcbiAgICBtZXNzYWdlID0gcGFja2VyLnBhY2sobWVzc2FnZSk7XG5cbiAgICB0cmFuc3BvcnQgPSB0cmFuc3BvcnQgfHwgdGhpcy5nZXRUcmFuc3BvcnQoKTtcbiAgICBpZiAodHJhbnNwb3J0KVxuICAgICAgcmV0dXJuIHRyYW5zcG9ydC5zZW5kKG1lc3NhZ2UpO1xuXG4gICAgcmV0dXJuIG1lc3NhZ2U7XG4gIH07XG5cbiAgLyoqXG4gICAqIERlY29kZSBhbmQgcHJvY2VzcyBhIEpzb25SUEMgMi4wIG1lc3NhZ2VcbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBzdHJpbmcgd2l0aCB0aGUgY29udGVudCBvZiB0aGUgbWVzc2FnZVxuICAgKlxuICAgKiBAcmV0dXJucyB7UnBjTm90aWZpY2F0aW9ufFJwY1JlcXVlc3R8dW5kZWZpbmVkfSAtIHRoZSByZXByZXNlbnRhdGlvbiBvZiB0aGVcbiAgICogICBub3RpZmljYXRpb24gb3IgdGhlIHJlcXVlc3QuIElmIGEgcmVzcG9uc2Ugd2FzIHByb2Nlc3NlZCwgaXQgd2lsbCByZXR1cm5cbiAgICogICBgdW5kZWZpbmVkYCB0byBub3RpZnkgdGhhdCBpdCB3YXMgcHJvY2Vzc2VkXG4gICAqXG4gICAqIEB0aHJvd3Mge1R5cGVFcnJvcn0gLSBNZXNzYWdlIGlzIG5vdCBkZWZpbmVkXG4gICAqL1xuICB0aGlzLmRlY29kZSA9IGZ1bmN0aW9uIChtZXNzYWdlLCB0cmFuc3BvcnQpIHtcbiAgICBpZiAoIW1lc3NhZ2UpXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiTWVzc2FnZSBpcyBub3QgZGVmaW5lZFwiKTtcblxuICAgIHRyeSB7XG4gICAgICBtZXNzYWdlID0gcGFja2VyLnVucGFjayhtZXNzYWdlKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAvLyBJZ25vcmUgaW52YWxpZCBtZXNzYWdlc1xuICAgICAgcmV0dXJuIGNvbnNvbGUuZGVidWcoZSwgbWVzc2FnZSk7XG4gICAgfTtcblxuICAgIHZhciBpZCA9IG1lc3NhZ2UuaWQ7XG4gICAgdmFyIGFjayA9IG1lc3NhZ2UuYWNrO1xuICAgIHZhciBtZXRob2QgPSBtZXNzYWdlLm1ldGhvZDtcbiAgICB2YXIgcGFyYW1zID0gbWVzc2FnZS5wYXJhbXMgfHwge307XG5cbiAgICB2YXIgZnJvbSA9IHBhcmFtcy5mcm9tO1xuICAgIHZhciBkZXN0ID0gcGFyYW1zLmRlc3Q7XG5cbiAgICAvLyBJZ25vcmUgbWVzc2FnZXMgc2VuZCBieSB1c1xuICAgIGlmIChzZWxmLnBlZXJJRCAhPSB1bmRlZmluZWQgJiYgZnJvbSA9PSBzZWxmLnBlZXJJRCkgcmV0dXJuO1xuXG4gICAgLy8gTm90aWZpY2F0aW9uXG4gICAgaWYgKGlkID09IHVuZGVmaW5lZCAmJiBhY2sgPT0gdW5kZWZpbmVkKSB7XG4gICAgICB2YXIgbm90aWZpY2F0aW9uID0gbmV3IFJwY05vdGlmaWNhdGlvbihtZXRob2QsIHBhcmFtcyk7XG5cbiAgICAgIGlmIChzZWxmLmVtaXQoJ3JlcXVlc3QnLCBub3RpZmljYXRpb24pKSByZXR1cm47XG4gICAgICByZXR1cm4gbm90aWZpY2F0aW9uO1xuICAgIH07XG5cbiAgICBmdW5jdGlvbiBwcm9jZXNzUmVxdWVzdCgpIHtcbiAgICAgIC8vIElmIHdlIGhhdmUgYSB0cmFuc3BvcnQgYW5kIGl0J3MgYSBkdXBsaWNhdGVkIHJlcXVlc3QsIHJlcGx5IGlubWVkaWF0bHlcbiAgICAgIHRyYW5zcG9ydCA9IHVuaWZ5VHJhbnNwb3J0KHRyYW5zcG9ydCkgfHwgc2VsZi5nZXRUcmFuc3BvcnQoKTtcbiAgICAgIGlmICh0cmFuc3BvcnQpIHtcbiAgICAgICAgdmFyIHJlc3BvbnNlID0gcmVzcG9uc2VzLmdldChpZCwgZnJvbSk7XG4gICAgICAgIGlmIChyZXNwb25zZSlcbiAgICAgICAgICByZXR1cm4gdHJhbnNwb3J0LnNlbmQocmVzcG9uc2UubWVzc2FnZSk7XG4gICAgICB9O1xuXG4gICAgICB2YXIgaWRBY2sgPSAoaWQgIT0gdW5kZWZpbmVkKSA/IGlkIDogYWNrO1xuICAgICAgdmFyIHJlcXVlc3QgPSBuZXcgUnBjUmVxdWVzdChtZXRob2QsIHBhcmFtcywgaWRBY2ssIGZyb20sIHRyYW5zcG9ydCk7XG5cbiAgICAgIGlmIChzZWxmLmVtaXQoJ3JlcXVlc3QnLCByZXF1ZXN0KSkgcmV0dXJuO1xuICAgICAgcmV0dXJuIHJlcXVlc3Q7XG4gICAgfTtcblxuICAgIGZ1bmN0aW9uIHByb2Nlc3NSZXNwb25zZShyZXF1ZXN0LCBlcnJvciwgcmVzdWx0KSB7XG4gICAgICByZXF1ZXN0LmNhbGxiYWNrKGVycm9yLCByZXN1bHQpO1xuICAgIH07XG5cbiAgICBmdW5jdGlvbiBkdXBsaWNhdGVkUmVzcG9uc2UodGltZW91dCkge1xuICAgICAgY29uc29sZS53YXJuKFwiUmVzcG9uc2UgYWxyZWFkeSBwcm9jZXNzZWRcIiwgbWVzc2FnZSk7XG5cbiAgICAgIC8vIFVwZGF0ZSBkdXBsaWNhdGVkIHJlc3BvbnNlcyB0aW1lb3V0XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICBzdG9yZVByb2Nlc3NlZFJlc3BvbnNlKGFjaywgZnJvbSk7XG4gICAgfTtcblxuICAgIC8vIFJlcXVlc3QsIG9yIHJlc3BvbnNlIHdpdGggb3duIG1ldGhvZFxuICAgIGlmIChtZXRob2QpIHtcbiAgICAgIC8vIENoZWNrIGlmIGl0J3MgYSByZXNwb25zZSB3aXRoIG93biBtZXRob2RcbiAgICAgIGlmIChkZXN0ID09IHVuZGVmaW5lZCB8fCBkZXN0ID09IHNlbGYucGVlcklEKSB7XG4gICAgICAgIHZhciByZXF1ZXN0ID0gcmVxdWVzdHMuZ2V0KGFjaywgZnJvbSk7XG4gICAgICAgIGlmIChyZXF1ZXN0KSB7XG4gICAgICAgICAgdmFyIHJlc3BvbnNlTWV0aG9kcyA9IHJlcXVlc3QucmVzcG9uc2VNZXRob2RzO1xuXG4gICAgICAgICAgaWYgKG1ldGhvZCA9PSByZXNwb25zZU1ldGhvZHMuZXJyb3IpXG4gICAgICAgICAgICByZXR1cm4gcHJvY2Vzc1Jlc3BvbnNlKHJlcXVlc3QsIHBhcmFtcyk7XG5cbiAgICAgICAgICBpZiAobWV0aG9kID09IHJlc3BvbnNlTWV0aG9kcy5yZXNwb25zZSlcbiAgICAgICAgICAgIHJldHVybiBwcm9jZXNzUmVzcG9uc2UocmVxdWVzdCwgbnVsbCwgcGFyYW1zKTtcblxuICAgICAgICAgIHJldHVybiBwcm9jZXNzUmVxdWVzdCgpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHByb2Nlc3NlZCA9IHByb2Nlc3NlZFJlc3BvbnNlcy5nZXQoYWNrLCBmcm9tKTtcbiAgICAgICAgaWYgKHByb2Nlc3NlZClcbiAgICAgICAgICByZXR1cm4gZHVwbGljYXRlZFJlc3BvbnNlKHByb2Nlc3NlZCk7XG4gICAgICB9XG5cbiAgICAgIC8vIFJlcXVlc3RcbiAgICAgIHJldHVybiBwcm9jZXNzUmVxdWVzdCgpO1xuICAgIH07XG5cbiAgICB2YXIgZXJyb3IgPSBtZXNzYWdlLmVycm9yO1xuICAgIHZhciByZXN1bHQgPSBtZXNzYWdlLnJlc3VsdDtcblxuICAgIC8vIElnbm9yZSByZXNwb25zZXMgbm90IHNlbmQgdG8gdXNcbiAgICBpZiAoZXJyb3IgJiYgZXJyb3IuZGVzdCAmJiBlcnJvci5kZXN0ICE9IHNlbGYucGVlcklEKSByZXR1cm47XG4gICAgaWYgKHJlc3VsdCAmJiByZXN1bHQuZGVzdCAmJiByZXN1bHQuZGVzdCAhPSBzZWxmLnBlZXJJRCkgcmV0dXJuO1xuXG4gICAgLy8gUmVzcG9uc2VcbiAgICB2YXIgcmVxdWVzdCA9IHJlcXVlc3RzLmdldChhY2ssIGZyb20pO1xuICAgIGlmICghcmVxdWVzdCkge1xuICAgICAgdmFyIHByb2Nlc3NlZCA9IHByb2Nlc3NlZFJlc3BvbnNlcy5nZXQoYWNrLCBmcm9tKTtcbiAgICAgIGlmIChwcm9jZXNzZWQpXG4gICAgICAgIHJldHVybiBkdXBsaWNhdGVkUmVzcG9uc2UocHJvY2Vzc2VkKTtcblxuICAgICAgcmV0dXJuIGNvbnNvbGUud2FybihcIk5vIGNhbGxiYWNrIHdhcyBkZWZpbmVkIGZvciB0aGlzIG1lc3NhZ2VcIixcbiAgICAgICAgbWVzc2FnZSk7XG4gICAgfTtcblxuICAgIC8vIFByb2Nlc3MgcmVzcG9uc2VcbiAgICBwcm9jZXNzUmVzcG9uc2UocmVxdWVzdCwgZXJyb3IsIHJlc3VsdCk7XG4gIH07XG59O1xuaW5oZXJpdHMoUnBjQnVpbGRlciwgRXZlbnRFbWl0dGVyKTtcblxuUnBjQnVpbGRlci5ScGNOb3RpZmljYXRpb24gPSBScGNOb3RpZmljYXRpb247XG5cbm1vZHVsZS5leHBvcnRzID0gUnBjQnVpbGRlcjtcblxudmFyIGNsaWVudHMgPSByZXF1aXJlKCcuL2NsaWVudHMnKTtcbnZhciB0cmFuc3BvcnRzID0gcmVxdWlyZSgnLi9jbGllbnRzL3RyYW5zcG9ydHMnKTtcblxuUnBjQnVpbGRlci5jbGllbnRzID0gY2xpZW50cztcblJwY0J1aWxkZXIuY2xpZW50cy50cmFuc3BvcnRzID0gdHJhbnNwb3J0cztcblJwY0J1aWxkZXIucGFja2VycyA9IHBhY2tlcnM7XG4iLCIvKipcbiAqIEpzb25SUEMgMi4wIHBhY2tlclxuICovXG5cbi8qKlxuICogUGFjayBhIEpzb25SUEMgMi4wIG1lc3NhZ2VcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gbWVzc2FnZSAtIG9iamVjdCB0byBiZSBwYWNrYWdlZC4gSXQgcmVxdWlyZXMgdG8gaGF2ZSBhbGwgdGhlXG4gKiAgIGZpZWxkcyBuZWVkZWQgYnkgdGhlIEpzb25SUEMgMi4wIG1lc3NhZ2UgdGhhdCBpdCdzIGdvaW5nIHRvIGJlIGdlbmVyYXRlZFxuICpcbiAqIEByZXR1cm4ge1N0cmluZ30gLSB0aGUgc3RyaW5naWZpZWQgSnNvblJQQyAyLjAgbWVzc2FnZVxuICovXG5mdW5jdGlvbiBwYWNrKG1lc3NhZ2UsIGlkKSB7XG4gIHZhciByZXN1bHQgPSB7XG4gICAganNvbnJwYzogXCIyLjBcIlxuICB9O1xuXG4gIC8vIFJlcXVlc3RcbiAgaWYgKG1lc3NhZ2UubWV0aG9kKSB7XG4gICAgcmVzdWx0Lm1ldGhvZCA9IG1lc3NhZ2UubWV0aG9kO1xuXG4gICAgaWYgKG1lc3NhZ2UucGFyYW1zKVxuICAgICAgcmVzdWx0LnBhcmFtcyA9IG1lc3NhZ2UucGFyYW1zO1xuXG4gICAgLy8gUmVxdWVzdCBpcyBhIG5vdGlmaWNhdGlvblxuICAgIGlmIChpZCAhPSB1bmRlZmluZWQpXG4gICAgICByZXN1bHQuaWQgPSBpZDtcbiAgfVxuXG4gIC8vIFJlc3BvbnNlXG4gIGVsc2UgaWYgKGlkICE9IHVuZGVmaW5lZCkge1xuICAgIGlmIChtZXNzYWdlLmVycm9yKSB7XG4gICAgICBpZiAobWVzc2FnZS5yZXN1bHQgIT09IHVuZGVmaW5lZClcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkJvdGggcmVzdWx0IGFuZCBlcnJvciBhcmUgZGVmaW5lZFwiKTtcblxuICAgICAgcmVzdWx0LmVycm9yID0gbWVzc2FnZS5lcnJvcjtcbiAgICB9IGVsc2UgaWYgKG1lc3NhZ2UucmVzdWx0ICE9PSB1bmRlZmluZWQpXG4gICAgICByZXN1bHQucmVzdWx0ID0gbWVzc2FnZS5yZXN1bHQ7XG4gICAgZWxzZVxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk5vIHJlc3VsdCBvciBlcnJvciBpcyBkZWZpbmVkXCIpO1xuXG4gICAgcmVzdWx0LmlkID0gaWQ7XG4gIH07XG5cbiAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHJlc3VsdCk7XG59O1xuXG4vKipcbiAqIFVucGFjayBhIEpzb25SUEMgMi4wIG1lc3NhZ2VcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZSAtIHN0cmluZyB3aXRoIHRoZSBjb250ZW50IG9mIHRoZSBKc29uUlBDIDIuMCBtZXNzYWdlXG4gKlxuICogQHRocm93cyB7VHlwZUVycm9yfSAtIEludmFsaWQgSnNvblJQQyB2ZXJzaW9uXG4gKlxuICogQHJldHVybiB7T2JqZWN0fSAtIG9iamVjdCBmaWxsZWQgd2l0aCB0aGUgSnNvblJQQyAyLjAgbWVzc2FnZSBjb250ZW50XG4gKi9cbmZ1bmN0aW9uIHVucGFjayhtZXNzYWdlKSB7XG4gIHZhciByZXN1bHQgPSBtZXNzYWdlO1xuXG4gIGlmICh0eXBlb2YgbWVzc2FnZSA9PT0gJ3N0cmluZycgfHwgbWVzc2FnZSBpbnN0YW5jZW9mIFN0cmluZykge1xuICAgIHJlc3VsdCA9IEpTT04ucGFyc2UobWVzc2FnZSk7XG4gIH1cblxuICAvLyBDaGVjayBpZiBpdCdzIGEgdmFsaWQgbWVzc2FnZVxuXG4gIHZhciB2ZXJzaW9uID0gcmVzdWx0Lmpzb25ycGM7XG4gIGlmICh2ZXJzaW9uICE9PSAnMi4wJylcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiSW52YWxpZCBKc29uUlBDIHZlcnNpb24gJ1wiICsgdmVyc2lvbiArIFwiJzogXCIgK1xuICAgICAgbWVzc2FnZSk7XG5cbiAgLy8gUmVzcG9uc2VcbiAgaWYgKHJlc3VsdC5tZXRob2QgPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKHJlc3VsdC5pZCA9PSB1bmRlZmluZWQpXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiSW52YWxpZCBtZXNzYWdlOiBcIiArIG1lc3NhZ2UpO1xuXG4gICAgdmFyIHJlc3VsdF9kZWZpbmVkID0gcmVzdWx0LnJlc3VsdCAhPT0gdW5kZWZpbmVkO1xuICAgIHZhciBlcnJvcl9kZWZpbmVkID0gcmVzdWx0LmVycm9yICE9PSB1bmRlZmluZWQ7XG5cbiAgICAvLyBDaGVjayBvbmx5IHJlc3VsdCBvciBlcnJvciBpcyBkZWZpbmVkLCBub3QgYm90aCBvciBub25lXG4gICAgaWYgKHJlc3VsdF9kZWZpbmVkICYmIGVycm9yX2RlZmluZWQpXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQm90aCByZXN1bHQgYW5kIGVycm9yIGFyZSBkZWZpbmVkOiBcIiArIG1lc3NhZ2UpO1xuXG4gICAgaWYgKCFyZXN1bHRfZGVmaW5lZCAmJiAhZXJyb3JfZGVmaW5lZClcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJObyByZXN1bHQgb3IgZXJyb3IgaXMgZGVmaW5lZDogXCIgKyBtZXNzYWdlKTtcblxuICAgIHJlc3VsdC5hY2sgPSByZXN1bHQuaWQ7XG4gICAgZGVsZXRlIHJlc3VsdC5pZDtcbiAgfVxuXG4gIC8vIFJldHVybiB1bnBhY2tlZCBtZXNzYWdlXG4gIHJldHVybiByZXN1bHQ7XG59O1xuXG5leHBvcnRzLnBhY2sgPSBwYWNrO1xuZXhwb3J0cy51bnBhY2sgPSB1bnBhY2s7XG4iLCJmdW5jdGlvbiBwYWNrKG1lc3NhZ2UpIHtcbiAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk5vdCB5ZXQgaW1wbGVtZW50ZWRcIik7XG59O1xuXG5mdW5jdGlvbiB1bnBhY2sobWVzc2FnZSkge1xuICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiTm90IHlldCBpbXBsZW1lbnRlZFwiKTtcbn07XG5cbmV4cG9ydHMucGFjayA9IHBhY2s7XG5leHBvcnRzLnVucGFjayA9IHVucGFjaztcbiIsInZhciBKc29uUlBDID0gcmVxdWlyZSgnLi9Kc29uUlBDJyk7XG52YXIgWG1sUlBDID0gcmVxdWlyZSgnLi9YbWxSUEMnKTtcblxuZXhwb3J0cy5Kc29uUlBDID0gSnNvblJQQztcbmV4cG9ydHMuWG1sUlBDID0gWG1sUlBDO1xuIiwiLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbnZhciBvYmplY3RDcmVhdGUgPSBPYmplY3QuY3JlYXRlIHx8IG9iamVjdENyZWF0ZVBvbHlmaWxsXG52YXIgb2JqZWN0S2V5cyA9IE9iamVjdC5rZXlzIHx8IG9iamVjdEtleXNQb2x5ZmlsbFxudmFyIGJpbmQgPSBGdW5jdGlvbi5wcm90b3R5cGUuYmluZCB8fCBmdW5jdGlvbkJpbmRQb2x5ZmlsbFxuXG5mdW5jdGlvbiBFdmVudEVtaXR0ZXIoKSB7XG4gIGlmICghdGhpcy5fZXZlbnRzIHx8ICFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwodGhpcywgJ19ldmVudHMnKSkge1xuICAgIHRoaXMuX2V2ZW50cyA9IG9iamVjdENyZWF0ZShudWxsKTtcbiAgICB0aGlzLl9ldmVudHNDb3VudCA9IDA7XG4gIH1cblxuICB0aGlzLl9tYXhMaXN0ZW5lcnMgPSB0aGlzLl9tYXhMaXN0ZW5lcnMgfHwgdW5kZWZpbmVkO1xufVxubW9kdWxlLmV4cG9ydHMgPSBFdmVudEVtaXR0ZXI7XG5cbi8vIEJhY2t3YXJkcy1jb21wYXQgd2l0aCBub2RlIDAuMTAueFxuRXZlbnRFbWl0dGVyLkV2ZW50RW1pdHRlciA9IEV2ZW50RW1pdHRlcjtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fZXZlbnRzID0gdW5kZWZpbmVkO1xuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fbWF4TGlzdGVuZXJzID0gdW5kZWZpbmVkO1xuXG4vLyBCeSBkZWZhdWx0IEV2ZW50RW1pdHRlcnMgd2lsbCBwcmludCBhIHdhcm5pbmcgaWYgbW9yZSB0aGFuIDEwIGxpc3RlbmVycyBhcmVcbi8vIGFkZGVkIHRvIGl0LiBUaGlzIGlzIGEgdXNlZnVsIGRlZmF1bHQgd2hpY2ggaGVscHMgZmluZGluZyBtZW1vcnkgbGVha3MuXG52YXIgZGVmYXVsdE1heExpc3RlbmVycyA9IDEwO1xuXG52YXIgaGFzRGVmaW5lUHJvcGVydHk7XG50cnkge1xuICB2YXIgbyA9IHt9O1xuICBpZiAoT2JqZWN0LmRlZmluZVByb3BlcnR5KSBPYmplY3QuZGVmaW5lUHJvcGVydHkobywgJ3gnLCB7IHZhbHVlOiAwIH0pO1xuICBoYXNEZWZpbmVQcm9wZXJ0eSA9IG8ueCA9PT0gMDtcbn0gY2F0Y2ggKGVycikgeyBoYXNEZWZpbmVQcm9wZXJ0eSA9IGZhbHNlIH1cbmlmIChoYXNEZWZpbmVQcm9wZXJ0eSkge1xuICBPYmplY3QuZGVmaW5lUHJvcGVydHkoRXZlbnRFbWl0dGVyLCAnZGVmYXVsdE1heExpc3RlbmVycycsIHtcbiAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gZGVmYXVsdE1heExpc3RlbmVycztcbiAgICB9LFxuICAgIHNldDogZnVuY3Rpb24oYXJnKSB7XG4gICAgICAvLyBjaGVjayB3aGV0aGVyIHRoZSBpbnB1dCBpcyBhIHBvc2l0aXZlIG51bWJlciAod2hvc2UgdmFsdWUgaXMgemVybyBvclxuICAgICAgLy8gZ3JlYXRlciBhbmQgbm90IGEgTmFOKS5cbiAgICAgIGlmICh0eXBlb2YgYXJnICE9PSAnbnVtYmVyJyB8fCBhcmcgPCAwIHx8IGFyZyAhPT0gYXJnKVxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdcImRlZmF1bHRNYXhMaXN0ZW5lcnNcIiBtdXN0IGJlIGEgcG9zaXRpdmUgbnVtYmVyJyk7XG4gICAgICBkZWZhdWx0TWF4TGlzdGVuZXJzID0gYXJnO1xuICAgIH1cbiAgfSk7XG59IGVsc2Uge1xuICBFdmVudEVtaXR0ZXIuZGVmYXVsdE1heExpc3RlbmVycyA9IGRlZmF1bHRNYXhMaXN0ZW5lcnM7XG59XG5cbi8vIE9idmlvdXNseSBub3QgYWxsIEVtaXR0ZXJzIHNob3VsZCBiZSBsaW1pdGVkIHRvIDEwLiBUaGlzIGZ1bmN0aW9uIGFsbG93c1xuLy8gdGhhdCB0byBiZSBpbmNyZWFzZWQuIFNldCB0byB6ZXJvIGZvciB1bmxpbWl0ZWQuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnNldE1heExpc3RlbmVycyA9IGZ1bmN0aW9uIHNldE1heExpc3RlbmVycyhuKSB7XG4gIGlmICh0eXBlb2YgbiAhPT0gJ251bWJlcicgfHwgbiA8IDAgfHwgaXNOYU4obikpXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignXCJuXCIgYXJndW1lbnQgbXVzdCBiZSBhIHBvc2l0aXZlIG51bWJlcicpO1xuICB0aGlzLl9tYXhMaXN0ZW5lcnMgPSBuO1xuICByZXR1cm4gdGhpcztcbn07XG5cbmZ1bmN0aW9uICRnZXRNYXhMaXN0ZW5lcnModGhhdCkge1xuICBpZiAodGhhdC5fbWF4TGlzdGVuZXJzID09PSB1bmRlZmluZWQpXG4gICAgcmV0dXJuIEV2ZW50RW1pdHRlci5kZWZhdWx0TWF4TGlzdGVuZXJzO1xuICByZXR1cm4gdGhhdC5fbWF4TGlzdGVuZXJzO1xufVxuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmdldE1heExpc3RlbmVycyA9IGZ1bmN0aW9uIGdldE1heExpc3RlbmVycygpIHtcbiAgcmV0dXJuICRnZXRNYXhMaXN0ZW5lcnModGhpcyk7XG59O1xuXG4vLyBUaGVzZSBzdGFuZGFsb25lIGVtaXQqIGZ1bmN0aW9ucyBhcmUgdXNlZCB0byBvcHRpbWl6ZSBjYWxsaW5nIG9mIGV2ZW50XG4vLyBoYW5kbGVycyBmb3IgZmFzdCBjYXNlcyBiZWNhdXNlIGVtaXQoKSBpdHNlbGYgb2Z0ZW4gaGFzIGEgdmFyaWFibGUgbnVtYmVyIG9mXG4vLyBhcmd1bWVudHMgYW5kIGNhbiBiZSBkZW9wdGltaXplZCBiZWNhdXNlIG9mIHRoYXQuIFRoZXNlIGZ1bmN0aW9ucyBhbHdheXMgaGF2ZVxuLy8gdGhlIHNhbWUgbnVtYmVyIG9mIGFyZ3VtZW50cyBhbmQgdGh1cyBkbyBub3QgZ2V0IGRlb3B0aW1pemVkLCBzbyB0aGUgY29kZVxuLy8gaW5zaWRlIHRoZW0gY2FuIGV4ZWN1dGUgZmFzdGVyLlxuZnVuY3Rpb24gZW1pdE5vbmUoaGFuZGxlciwgaXNGbiwgc2VsZikge1xuICBpZiAoaXNGbilcbiAgICBoYW5kbGVyLmNhbGwoc2VsZik7XG4gIGVsc2Uge1xuICAgIHZhciBsZW4gPSBoYW5kbGVyLmxlbmd0aDtcbiAgICB2YXIgbGlzdGVuZXJzID0gYXJyYXlDbG9uZShoYW5kbGVyLCBsZW4pO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyArK2kpXG4gICAgICBsaXN0ZW5lcnNbaV0uY2FsbChzZWxmKTtcbiAgfVxufVxuZnVuY3Rpb24gZW1pdE9uZShoYW5kbGVyLCBpc0ZuLCBzZWxmLCBhcmcxKSB7XG4gIGlmIChpc0ZuKVxuICAgIGhhbmRsZXIuY2FsbChzZWxmLCBhcmcxKTtcbiAgZWxzZSB7XG4gICAgdmFyIGxlbiA9IGhhbmRsZXIubGVuZ3RoO1xuICAgIHZhciBsaXN0ZW5lcnMgPSBhcnJheUNsb25lKGhhbmRsZXIsIGxlbik7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47ICsraSlcbiAgICAgIGxpc3RlbmVyc1tpXS5jYWxsKHNlbGYsIGFyZzEpO1xuICB9XG59XG5mdW5jdGlvbiBlbWl0VHdvKGhhbmRsZXIsIGlzRm4sIHNlbGYsIGFyZzEsIGFyZzIpIHtcbiAgaWYgKGlzRm4pXG4gICAgaGFuZGxlci5jYWxsKHNlbGYsIGFyZzEsIGFyZzIpO1xuICBlbHNlIHtcbiAgICB2YXIgbGVuID0gaGFuZGxlci5sZW5ndGg7XG4gICAgdmFyIGxpc3RlbmVycyA9IGFycmF5Q2xvbmUoaGFuZGxlciwgbGVuKTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgKytpKVxuICAgICAgbGlzdGVuZXJzW2ldLmNhbGwoc2VsZiwgYXJnMSwgYXJnMik7XG4gIH1cbn1cbmZ1bmN0aW9uIGVtaXRUaHJlZShoYW5kbGVyLCBpc0ZuLCBzZWxmLCBhcmcxLCBhcmcyLCBhcmczKSB7XG4gIGlmIChpc0ZuKVxuICAgIGhhbmRsZXIuY2FsbChzZWxmLCBhcmcxLCBhcmcyLCBhcmczKTtcbiAgZWxzZSB7XG4gICAgdmFyIGxlbiA9IGhhbmRsZXIubGVuZ3RoO1xuICAgIHZhciBsaXN0ZW5lcnMgPSBhcnJheUNsb25lKGhhbmRsZXIsIGxlbik7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47ICsraSlcbiAgICAgIGxpc3RlbmVyc1tpXS5jYWxsKHNlbGYsIGFyZzEsIGFyZzIsIGFyZzMpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGVtaXRNYW55KGhhbmRsZXIsIGlzRm4sIHNlbGYsIGFyZ3MpIHtcbiAgaWYgKGlzRm4pXG4gICAgaGFuZGxlci5hcHBseShzZWxmLCBhcmdzKTtcbiAgZWxzZSB7XG4gICAgdmFyIGxlbiA9IGhhbmRsZXIubGVuZ3RoO1xuICAgIHZhciBsaXN0ZW5lcnMgPSBhcnJheUNsb25lKGhhbmRsZXIsIGxlbik7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47ICsraSlcbiAgICAgIGxpc3RlbmVyc1tpXS5hcHBseShzZWxmLCBhcmdzKTtcbiAgfVxufVxuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbiBlbWl0KHR5cGUpIHtcbiAgdmFyIGVyLCBoYW5kbGVyLCBsZW4sIGFyZ3MsIGksIGV2ZW50cztcbiAgdmFyIGRvRXJyb3IgPSAodHlwZSA9PT0gJ2Vycm9yJyk7XG5cbiAgZXZlbnRzID0gdGhpcy5fZXZlbnRzO1xuICBpZiAoZXZlbnRzKVxuICAgIGRvRXJyb3IgPSAoZG9FcnJvciAmJiBldmVudHMuZXJyb3IgPT0gbnVsbCk7XG4gIGVsc2UgaWYgKCFkb0Vycm9yKVxuICAgIHJldHVybiBmYWxzZTtcblxuICAvLyBJZiB0aGVyZSBpcyBubyAnZXJyb3InIGV2ZW50IGxpc3RlbmVyIHRoZW4gdGhyb3cuXG4gIGlmIChkb0Vycm9yKSB7XG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxKVxuICAgICAgZXIgPSBhcmd1bWVudHNbMV07XG4gICAgaWYgKGVyIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgIHRocm93IGVyOyAvLyBVbmhhbmRsZWQgJ2Vycm9yJyBldmVudFxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBBdCBsZWFzdCBnaXZlIHNvbWUga2luZCBvZiBjb250ZXh0IHRvIHRoZSB1c2VyXG4gICAgICB2YXIgZXJyID0gbmV3IEVycm9yKCdVbmhhbmRsZWQgXCJlcnJvclwiIGV2ZW50LiAoJyArIGVyICsgJyknKTtcbiAgICAgIGVyci5jb250ZXh0ID0gZXI7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGhhbmRsZXIgPSBldmVudHNbdHlwZV07XG5cbiAgaWYgKCFoYW5kbGVyKVxuICAgIHJldHVybiBmYWxzZTtcblxuICB2YXIgaXNGbiA9IHR5cGVvZiBoYW5kbGVyID09PSAnZnVuY3Rpb24nO1xuICBsZW4gPSBhcmd1bWVudHMubGVuZ3RoO1xuICBzd2l0Y2ggKGxlbikge1xuICAgICAgLy8gZmFzdCBjYXNlc1xuICAgIGNhc2UgMTpcbiAgICAgIGVtaXROb25lKGhhbmRsZXIsIGlzRm4sIHRoaXMpO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAyOlxuICAgICAgZW1pdE9uZShoYW5kbGVyLCBpc0ZuLCB0aGlzLCBhcmd1bWVudHNbMV0pO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAzOlxuICAgICAgZW1pdFR3byhoYW5kbGVyLCBpc0ZuLCB0aGlzLCBhcmd1bWVudHNbMV0sIGFyZ3VtZW50c1syXSk7XG4gICAgICBicmVhaztcbiAgICBjYXNlIDQ6XG4gICAgICBlbWl0VGhyZWUoaGFuZGxlciwgaXNGbiwgdGhpcywgYXJndW1lbnRzWzFdLCBhcmd1bWVudHNbMl0sIGFyZ3VtZW50c1szXSk7XG4gICAgICBicmVhaztcbiAgICAgIC8vIHNsb3dlclxuICAgIGRlZmF1bHQ6XG4gICAgICBhcmdzID0gbmV3IEFycmF5KGxlbiAtIDEpO1xuICAgICAgZm9yIChpID0gMTsgaSA8IGxlbjsgaSsrKVxuICAgICAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgIGVtaXRNYW55KGhhbmRsZXIsIGlzRm4sIHRoaXMsIGFyZ3MpO1xuICB9XG5cbiAgcmV0dXJuIHRydWU7XG59O1xuXG5mdW5jdGlvbiBfYWRkTGlzdGVuZXIodGFyZ2V0LCB0eXBlLCBsaXN0ZW5lciwgcHJlcGVuZCkge1xuICB2YXIgbTtcbiAgdmFyIGV2ZW50cztcbiAgdmFyIGV4aXN0aW5nO1xuXG4gIGlmICh0eXBlb2YgbGlzdGVuZXIgIT09ICdmdW5jdGlvbicpXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignXCJsaXN0ZW5lclwiIGFyZ3VtZW50IG11c3QgYmUgYSBmdW5jdGlvbicpO1xuXG4gIGV2ZW50cyA9IHRhcmdldC5fZXZlbnRzO1xuICBpZiAoIWV2ZW50cykge1xuICAgIGV2ZW50cyA9IHRhcmdldC5fZXZlbnRzID0gb2JqZWN0Q3JlYXRlKG51bGwpO1xuICAgIHRhcmdldC5fZXZlbnRzQ291bnQgPSAwO1xuICB9IGVsc2Uge1xuICAgIC8vIFRvIGF2b2lkIHJlY3Vyc2lvbiBpbiB0aGUgY2FzZSB0aGF0IHR5cGUgPT09IFwibmV3TGlzdGVuZXJcIiEgQmVmb3JlXG4gICAgLy8gYWRkaW5nIGl0IHRvIHRoZSBsaXN0ZW5lcnMsIGZpcnN0IGVtaXQgXCJuZXdMaXN0ZW5lclwiLlxuICAgIGlmIChldmVudHMubmV3TGlzdGVuZXIpIHtcbiAgICAgIHRhcmdldC5lbWl0KCduZXdMaXN0ZW5lcicsIHR5cGUsXG4gICAgICAgICAgbGlzdGVuZXIubGlzdGVuZXIgPyBsaXN0ZW5lci5saXN0ZW5lciA6IGxpc3RlbmVyKTtcblxuICAgICAgLy8gUmUtYXNzaWduIGBldmVudHNgIGJlY2F1c2UgYSBuZXdMaXN0ZW5lciBoYW5kbGVyIGNvdWxkIGhhdmUgY2F1c2VkIHRoZVxuICAgICAgLy8gdGhpcy5fZXZlbnRzIHRvIGJlIGFzc2lnbmVkIHRvIGEgbmV3IG9iamVjdFxuICAgICAgZXZlbnRzID0gdGFyZ2V0Ll9ldmVudHM7XG4gICAgfVxuICAgIGV4aXN0aW5nID0gZXZlbnRzW3R5cGVdO1xuICB9XG5cbiAgaWYgKCFleGlzdGluZykge1xuICAgIC8vIE9wdGltaXplIHRoZSBjYXNlIG9mIG9uZSBsaXN0ZW5lci4gRG9uJ3QgbmVlZCB0aGUgZXh0cmEgYXJyYXkgb2JqZWN0LlxuICAgIGV4aXN0aW5nID0gZXZlbnRzW3R5cGVdID0gbGlzdGVuZXI7XG4gICAgKyt0YXJnZXQuX2V2ZW50c0NvdW50O1xuICB9IGVsc2Uge1xuICAgIGlmICh0eXBlb2YgZXhpc3RpbmcgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIC8vIEFkZGluZyB0aGUgc2Vjb25kIGVsZW1lbnQsIG5lZWQgdG8gY2hhbmdlIHRvIGFycmF5LlxuICAgICAgZXhpc3RpbmcgPSBldmVudHNbdHlwZV0gPVxuICAgICAgICAgIHByZXBlbmQgPyBbbGlzdGVuZXIsIGV4aXN0aW5nXSA6IFtleGlzdGluZywgbGlzdGVuZXJdO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJZiB3ZSd2ZSBhbHJlYWR5IGdvdCBhbiBhcnJheSwganVzdCBhcHBlbmQuXG4gICAgICBpZiAocHJlcGVuZCkge1xuICAgICAgICBleGlzdGluZy51bnNoaWZ0KGxpc3RlbmVyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGV4aXN0aW5nLnB1c2gobGlzdGVuZXIpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIENoZWNrIGZvciBsaXN0ZW5lciBsZWFrXG4gICAgaWYgKCFleGlzdGluZy53YXJuZWQpIHtcbiAgICAgIG0gPSAkZ2V0TWF4TGlzdGVuZXJzKHRhcmdldCk7XG4gICAgICBpZiAobSAmJiBtID4gMCAmJiBleGlzdGluZy5sZW5ndGggPiBtKSB7XG4gICAgICAgIGV4aXN0aW5nLndhcm5lZCA9IHRydWU7XG4gICAgICAgIHZhciB3ID0gbmV3IEVycm9yKCdQb3NzaWJsZSBFdmVudEVtaXR0ZXIgbWVtb3J5IGxlYWsgZGV0ZWN0ZWQuICcgK1xuICAgICAgICAgICAgZXhpc3RpbmcubGVuZ3RoICsgJyBcIicgKyBTdHJpbmcodHlwZSkgKyAnXCIgbGlzdGVuZXJzICcgK1xuICAgICAgICAgICAgJ2FkZGVkLiBVc2UgZW1pdHRlci5zZXRNYXhMaXN0ZW5lcnMoKSB0byAnICtcbiAgICAgICAgICAgICdpbmNyZWFzZSBsaW1pdC4nKTtcbiAgICAgICAgdy5uYW1lID0gJ01heExpc3RlbmVyc0V4Y2VlZGVkV2FybmluZyc7XG4gICAgICAgIHcuZW1pdHRlciA9IHRhcmdldDtcbiAgICAgICAgdy50eXBlID0gdHlwZTtcbiAgICAgICAgdy5jb3VudCA9IGV4aXN0aW5nLmxlbmd0aDtcbiAgICAgICAgaWYgKHR5cGVvZiBjb25zb2xlID09PSAnb2JqZWN0JyAmJiBjb25zb2xlLndhcm4pIHtcbiAgICAgICAgICBjb25zb2xlLndhcm4oJyVzOiAlcycsIHcubmFtZSwgdy5tZXNzYWdlKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0YXJnZXQ7XG59XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuYWRkTGlzdGVuZXIgPSBmdW5jdGlvbiBhZGRMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcikge1xuICByZXR1cm4gX2FkZExpc3RlbmVyKHRoaXMsIHR5cGUsIGxpc3RlbmVyLCBmYWxzZSk7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLm9uID0gRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5hZGRMaXN0ZW5lcjtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5wcmVwZW5kTGlzdGVuZXIgPVxuICAgIGZ1bmN0aW9uIHByZXBlbmRMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcikge1xuICAgICAgcmV0dXJuIF9hZGRMaXN0ZW5lcih0aGlzLCB0eXBlLCBsaXN0ZW5lciwgdHJ1ZSk7XG4gICAgfTtcblxuZnVuY3Rpb24gb25jZVdyYXBwZXIoKSB7XG4gIGlmICghdGhpcy5maXJlZCkge1xuICAgIHRoaXMudGFyZ2V0LnJlbW92ZUxpc3RlbmVyKHRoaXMudHlwZSwgdGhpcy53cmFwRm4pO1xuICAgIHRoaXMuZmlyZWQgPSB0cnVlO1xuICAgIHN3aXRjaCAoYXJndW1lbnRzLmxlbmd0aCkge1xuICAgICAgY2FzZSAwOlxuICAgICAgICByZXR1cm4gdGhpcy5saXN0ZW5lci5jYWxsKHRoaXMudGFyZ2V0KTtcbiAgICAgIGNhc2UgMTpcbiAgICAgICAgcmV0dXJuIHRoaXMubGlzdGVuZXIuY2FsbCh0aGlzLnRhcmdldCwgYXJndW1lbnRzWzBdKTtcbiAgICAgIGNhc2UgMjpcbiAgICAgICAgcmV0dXJuIHRoaXMubGlzdGVuZXIuY2FsbCh0aGlzLnRhcmdldCwgYXJndW1lbnRzWzBdLCBhcmd1bWVudHNbMV0pO1xuICAgICAgY2FzZSAzOlxuICAgICAgICByZXR1cm4gdGhpcy5saXN0ZW5lci5jYWxsKHRoaXMudGFyZ2V0LCBhcmd1bWVudHNbMF0sIGFyZ3VtZW50c1sxXSxcbiAgICAgICAgICAgIGFyZ3VtZW50c1syXSk7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB2YXIgYXJncyA9IG5ldyBBcnJheShhcmd1bWVudHMubGVuZ3RoKTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcmdzLmxlbmd0aDsgKytpKVxuICAgICAgICAgIGFyZ3NbaV0gPSBhcmd1bWVudHNbaV07XG4gICAgICAgIHRoaXMubGlzdGVuZXIuYXBwbHkodGhpcy50YXJnZXQsIGFyZ3MpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBfb25jZVdyYXAodGFyZ2V0LCB0eXBlLCBsaXN0ZW5lcikge1xuICB2YXIgc3RhdGUgPSB7IGZpcmVkOiBmYWxzZSwgd3JhcEZuOiB1bmRlZmluZWQsIHRhcmdldDogdGFyZ2V0LCB0eXBlOiB0eXBlLCBsaXN0ZW5lcjogbGlzdGVuZXIgfTtcbiAgdmFyIHdyYXBwZWQgPSBiaW5kLmNhbGwob25jZVdyYXBwZXIsIHN0YXRlKTtcbiAgd3JhcHBlZC5saXN0ZW5lciA9IGxpc3RlbmVyO1xuICBzdGF0ZS53cmFwRm4gPSB3cmFwcGVkO1xuICByZXR1cm4gd3JhcHBlZDtcbn1cblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5vbmNlID0gZnVuY3Rpb24gb25jZSh0eXBlLCBsaXN0ZW5lcikge1xuICBpZiAodHlwZW9mIGxpc3RlbmVyICE9PSAnZnVuY3Rpb24nKVxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1wibGlzdGVuZXJcIiBhcmd1bWVudCBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgdGhpcy5vbih0eXBlLCBfb25jZVdyYXAodGhpcywgdHlwZSwgbGlzdGVuZXIpKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnByZXBlbmRPbmNlTGlzdGVuZXIgPVxuICAgIGZ1bmN0aW9uIHByZXBlbmRPbmNlTGlzdGVuZXIodHlwZSwgbGlzdGVuZXIpIHtcbiAgICAgIGlmICh0eXBlb2YgbGlzdGVuZXIgIT09ICdmdW5jdGlvbicpXG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1wibGlzdGVuZXJcIiBhcmd1bWVudCBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgICAgIHRoaXMucHJlcGVuZExpc3RlbmVyKHR5cGUsIF9vbmNlV3JhcCh0aGlzLCB0eXBlLCBsaXN0ZW5lcikpO1xuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfTtcblxuLy8gRW1pdHMgYSAncmVtb3ZlTGlzdGVuZXInIGV2ZW50IGlmIGFuZCBvbmx5IGlmIHRoZSBsaXN0ZW5lciB3YXMgcmVtb3ZlZC5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUucmVtb3ZlTGlzdGVuZXIgPVxuICAgIGZ1bmN0aW9uIHJlbW92ZUxpc3RlbmVyKHR5cGUsIGxpc3RlbmVyKSB7XG4gICAgICB2YXIgbGlzdCwgZXZlbnRzLCBwb3NpdGlvbiwgaSwgb3JpZ2luYWxMaXN0ZW5lcjtcblxuICAgICAgaWYgKHR5cGVvZiBsaXN0ZW5lciAhPT0gJ2Z1bmN0aW9uJylcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignXCJsaXN0ZW5lclwiIGFyZ3VtZW50IG11c3QgYmUgYSBmdW5jdGlvbicpO1xuXG4gICAgICBldmVudHMgPSB0aGlzLl9ldmVudHM7XG4gICAgICBpZiAoIWV2ZW50cylcbiAgICAgICAgcmV0dXJuIHRoaXM7XG5cbiAgICAgIGxpc3QgPSBldmVudHNbdHlwZV07XG4gICAgICBpZiAoIWxpc3QpXG4gICAgICAgIHJldHVybiB0aGlzO1xuXG4gICAgICBpZiAobGlzdCA9PT0gbGlzdGVuZXIgfHwgbGlzdC5saXN0ZW5lciA9PT0gbGlzdGVuZXIpIHtcbiAgICAgICAgaWYgKC0tdGhpcy5fZXZlbnRzQ291bnQgPT09IDApXG4gICAgICAgICAgdGhpcy5fZXZlbnRzID0gb2JqZWN0Q3JlYXRlKG51bGwpO1xuICAgICAgICBlbHNlIHtcbiAgICAgICAgICBkZWxldGUgZXZlbnRzW3R5cGVdO1xuICAgICAgICAgIGlmIChldmVudHMucmVtb3ZlTGlzdGVuZXIpXG4gICAgICAgICAgICB0aGlzLmVtaXQoJ3JlbW92ZUxpc3RlbmVyJywgdHlwZSwgbGlzdC5saXN0ZW5lciB8fCBsaXN0ZW5lcik7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGxpc3QgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgcG9zaXRpb24gPSAtMTtcblxuICAgICAgICBmb3IgKGkgPSBsaXN0Lmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICAgICAgaWYgKGxpc3RbaV0gPT09IGxpc3RlbmVyIHx8IGxpc3RbaV0ubGlzdGVuZXIgPT09IGxpc3RlbmVyKSB7XG4gICAgICAgICAgICBvcmlnaW5hbExpc3RlbmVyID0gbGlzdFtpXS5saXN0ZW5lcjtcbiAgICAgICAgICAgIHBvc2l0aW9uID0gaTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChwb3NpdGlvbiA8IDApXG4gICAgICAgICAgcmV0dXJuIHRoaXM7XG5cbiAgICAgICAgaWYgKHBvc2l0aW9uID09PSAwKVxuICAgICAgICAgIGxpc3Quc2hpZnQoKTtcbiAgICAgICAgZWxzZVxuICAgICAgICAgIHNwbGljZU9uZShsaXN0LCBwb3NpdGlvbik7XG5cbiAgICAgICAgaWYgKGxpc3QubGVuZ3RoID09PSAxKVxuICAgICAgICAgIGV2ZW50c1t0eXBlXSA9IGxpc3RbMF07XG5cbiAgICAgICAgaWYgKGV2ZW50cy5yZW1vdmVMaXN0ZW5lcilcbiAgICAgICAgICB0aGlzLmVtaXQoJ3JlbW92ZUxpc3RlbmVyJywgdHlwZSwgb3JpZ2luYWxMaXN0ZW5lciB8fCBsaXN0ZW5lcik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUucmVtb3ZlQWxsTGlzdGVuZXJzID1cbiAgICBmdW5jdGlvbiByZW1vdmVBbGxMaXN0ZW5lcnModHlwZSkge1xuICAgICAgdmFyIGxpc3RlbmVycywgZXZlbnRzLCBpO1xuXG4gICAgICBldmVudHMgPSB0aGlzLl9ldmVudHM7XG4gICAgICBpZiAoIWV2ZW50cylcbiAgICAgICAgcmV0dXJuIHRoaXM7XG5cbiAgICAgIC8vIG5vdCBsaXN0ZW5pbmcgZm9yIHJlbW92ZUxpc3RlbmVyLCBubyBuZWVkIHRvIGVtaXRcbiAgICAgIGlmICghZXZlbnRzLnJlbW92ZUxpc3RlbmVyKSB7XG4gICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgdGhpcy5fZXZlbnRzID0gb2JqZWN0Q3JlYXRlKG51bGwpO1xuICAgICAgICAgIHRoaXMuX2V2ZW50c0NvdW50ID0gMDtcbiAgICAgICAgfSBlbHNlIGlmIChldmVudHNbdHlwZV0pIHtcbiAgICAgICAgICBpZiAoLS10aGlzLl9ldmVudHNDb3VudCA9PT0gMClcbiAgICAgICAgICAgIHRoaXMuX2V2ZW50cyA9IG9iamVjdENyZWF0ZShudWxsKTtcbiAgICAgICAgICBlbHNlXG4gICAgICAgICAgICBkZWxldGUgZXZlbnRzW3R5cGVdO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgfVxuXG4gICAgICAvLyBlbWl0IHJlbW92ZUxpc3RlbmVyIGZvciBhbGwgbGlzdGVuZXJzIG9uIGFsbCBldmVudHNcbiAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHZhciBrZXlzID0gb2JqZWN0S2V5cyhldmVudHMpO1xuICAgICAgICB2YXIga2V5O1xuICAgICAgICBmb3IgKGkgPSAwOyBpIDwga2V5cy5sZW5ndGg7ICsraSkge1xuICAgICAgICAgIGtleSA9IGtleXNbaV07XG4gICAgICAgICAgaWYgKGtleSA9PT0gJ3JlbW92ZUxpc3RlbmVyJykgY29udGludWU7XG4gICAgICAgICAgdGhpcy5yZW1vdmVBbGxMaXN0ZW5lcnMoa2V5KTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnJlbW92ZUFsbExpc3RlbmVycygncmVtb3ZlTGlzdGVuZXInKTtcbiAgICAgICAgdGhpcy5fZXZlbnRzID0gb2JqZWN0Q3JlYXRlKG51bGwpO1xuICAgICAgICB0aGlzLl9ldmVudHNDb3VudCA9IDA7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgfVxuXG4gICAgICBsaXN0ZW5lcnMgPSBldmVudHNbdHlwZV07XG5cbiAgICAgIGlmICh0eXBlb2YgbGlzdGVuZXJzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHRoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSwgbGlzdGVuZXJzKTtcbiAgICAgIH0gZWxzZSBpZiAobGlzdGVuZXJzKSB7XG4gICAgICAgIC8vIExJRk8gb3JkZXJcbiAgICAgICAgZm9yIChpID0gbGlzdGVuZXJzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICAgICAgdGhpcy5yZW1vdmVMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcnNbaV0pO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH07XG5cbmZ1bmN0aW9uIF9saXN0ZW5lcnModGFyZ2V0LCB0eXBlLCB1bndyYXApIHtcbiAgdmFyIGV2ZW50cyA9IHRhcmdldC5fZXZlbnRzO1xuXG4gIGlmICghZXZlbnRzKVxuICAgIHJldHVybiBbXTtcblxuICB2YXIgZXZsaXN0ZW5lciA9IGV2ZW50c1t0eXBlXTtcbiAgaWYgKCFldmxpc3RlbmVyKVxuICAgIHJldHVybiBbXTtcblxuICBpZiAodHlwZW9mIGV2bGlzdGVuZXIgPT09ICdmdW5jdGlvbicpXG4gICAgcmV0dXJuIHVud3JhcCA/IFtldmxpc3RlbmVyLmxpc3RlbmVyIHx8IGV2bGlzdGVuZXJdIDogW2V2bGlzdGVuZXJdO1xuXG4gIHJldHVybiB1bndyYXAgPyB1bndyYXBMaXN0ZW5lcnMoZXZsaXN0ZW5lcikgOiBhcnJheUNsb25lKGV2bGlzdGVuZXIsIGV2bGlzdGVuZXIubGVuZ3RoKTtcbn1cblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5saXN0ZW5lcnMgPSBmdW5jdGlvbiBsaXN0ZW5lcnModHlwZSkge1xuICByZXR1cm4gX2xpc3RlbmVycyh0aGlzLCB0eXBlLCB0cnVlKTtcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUucmF3TGlzdGVuZXJzID0gZnVuY3Rpb24gcmF3TGlzdGVuZXJzKHR5cGUpIHtcbiAgcmV0dXJuIF9saXN0ZW5lcnModGhpcywgdHlwZSwgZmFsc2UpO1xufTtcblxuRXZlbnRFbWl0dGVyLmxpc3RlbmVyQ291bnQgPSBmdW5jdGlvbihlbWl0dGVyLCB0eXBlKSB7XG4gIGlmICh0eXBlb2YgZW1pdHRlci5saXN0ZW5lckNvdW50ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIGVtaXR0ZXIubGlzdGVuZXJDb3VudCh0eXBlKTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gbGlzdGVuZXJDb3VudC5jYWxsKGVtaXR0ZXIsIHR5cGUpO1xuICB9XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmxpc3RlbmVyQ291bnQgPSBsaXN0ZW5lckNvdW50O1xuZnVuY3Rpb24gbGlzdGVuZXJDb3VudCh0eXBlKSB7XG4gIHZhciBldmVudHMgPSB0aGlzLl9ldmVudHM7XG5cbiAgaWYgKGV2ZW50cykge1xuICAgIHZhciBldmxpc3RlbmVyID0gZXZlbnRzW3R5cGVdO1xuXG4gICAgaWYgKHR5cGVvZiBldmxpc3RlbmVyID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gMTtcbiAgICB9IGVsc2UgaWYgKGV2bGlzdGVuZXIpIHtcbiAgICAgIHJldHVybiBldmxpc3RlbmVyLmxlbmd0aDtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gMDtcbn1cblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5ldmVudE5hbWVzID0gZnVuY3Rpb24gZXZlbnROYW1lcygpIHtcbiAgcmV0dXJuIHRoaXMuX2V2ZW50c0NvdW50ID4gMCA/IFJlZmxlY3Qub3duS2V5cyh0aGlzLl9ldmVudHMpIDogW107XG59O1xuXG4vLyBBYm91dCAxLjV4IGZhc3RlciB0aGFuIHRoZSB0d28tYXJnIHZlcnNpb24gb2YgQXJyYXkjc3BsaWNlKCkuXG5mdW5jdGlvbiBzcGxpY2VPbmUobGlzdCwgaW5kZXgpIHtcbiAgZm9yICh2YXIgaSA9IGluZGV4LCBrID0gaSArIDEsIG4gPSBsaXN0Lmxlbmd0aDsgayA8IG47IGkgKz0gMSwgayArPSAxKVxuICAgIGxpc3RbaV0gPSBsaXN0W2tdO1xuICBsaXN0LnBvcCgpO1xufVxuXG5mdW5jdGlvbiBhcnJheUNsb25lKGFyciwgbikge1xuICB2YXIgY29weSA9IG5ldyBBcnJheShuKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBuOyArK2kpXG4gICAgY29weVtpXSA9IGFycltpXTtcbiAgcmV0dXJuIGNvcHk7XG59XG5cbmZ1bmN0aW9uIHVud3JhcExpc3RlbmVycyhhcnIpIHtcbiAgdmFyIHJldCA9IG5ldyBBcnJheShhcnIubGVuZ3RoKTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCByZXQubGVuZ3RoOyArK2kpIHtcbiAgICByZXRbaV0gPSBhcnJbaV0ubGlzdGVuZXIgfHwgYXJyW2ldO1xuICB9XG4gIHJldHVybiByZXQ7XG59XG5cbmZ1bmN0aW9uIG9iamVjdENyZWF0ZVBvbHlmaWxsKHByb3RvKSB7XG4gIHZhciBGID0gZnVuY3Rpb24oKSB7fTtcbiAgRi5wcm90b3R5cGUgPSBwcm90bztcbiAgcmV0dXJuIG5ldyBGO1xufVxuZnVuY3Rpb24gb2JqZWN0S2V5c1BvbHlmaWxsKG9iaikge1xuICB2YXIga2V5cyA9IFtdO1xuICBmb3IgKHZhciBrIGluIG9iaikgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmosIGspKSB7XG4gICAga2V5cy5wdXNoKGspO1xuICB9XG4gIHJldHVybiBrO1xufVxuZnVuY3Rpb24gZnVuY3Rpb25CaW5kUG9seWZpbGwoY29udGV4dCkge1xuICB2YXIgZm4gPSB0aGlzO1xuICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBmbi5hcHBseShjb250ZXh0LCBhcmd1bWVudHMpO1xuICB9O1xufVxuIiwiaWYgKHR5cGVvZiBPYmplY3QuY3JlYXRlID09PSAnZnVuY3Rpb24nKSB7XG4gIC8vIGltcGxlbWVudGF0aW9uIGZyb20gc3RhbmRhcmQgbm9kZS5qcyAndXRpbCcgbW9kdWxlXG4gIG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gaW5oZXJpdHMoY3Rvciwgc3VwZXJDdG9yKSB7XG4gICAgaWYgKHN1cGVyQ3Rvcikge1xuICAgICAgY3Rvci5zdXBlcl8gPSBzdXBlckN0b3JcbiAgICAgIGN0b3IucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShzdXBlckN0b3IucHJvdG90eXBlLCB7XG4gICAgICAgIGNvbnN0cnVjdG9yOiB7XG4gICAgICAgICAgdmFsdWU6IGN0b3IsXG4gICAgICAgICAgZW51bWVyYWJsZTogZmFsc2UsXG4gICAgICAgICAgd3JpdGFibGU6IHRydWUsXG4gICAgICAgICAgY29uZmlndXJhYmxlOiB0cnVlXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfVxuICB9O1xufSBlbHNlIHtcbiAgLy8gb2xkIHNjaG9vbCBzaGltIGZvciBvbGQgYnJvd3NlcnNcbiAgbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBpbmhlcml0cyhjdG9yLCBzdXBlckN0b3IpIHtcbiAgICBpZiAoc3VwZXJDdG9yKSB7XG4gICAgICBjdG9yLnN1cGVyXyA9IHN1cGVyQ3RvclxuICAgICAgdmFyIFRlbXBDdG9yID0gZnVuY3Rpb24gKCkge31cbiAgICAgIFRlbXBDdG9yLnByb3RvdHlwZSA9IHN1cGVyQ3Rvci5wcm90b3R5cGVcbiAgICAgIGN0b3IucHJvdG90eXBlID0gbmV3IFRlbXBDdG9yKClcbiAgICAgIGN0b3IucHJvdG90eXBlLmNvbnN0cnVjdG9yID0gY3RvclxuICAgIH1cbiAgfVxufVxuIl19
