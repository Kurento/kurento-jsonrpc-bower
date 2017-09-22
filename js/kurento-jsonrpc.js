(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.RpcBuilder = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
function Mapper()
{
  var sources = {};


  this.forEach = function(callback)
  {
    for(var key in sources)
    {
      var source = sources[key];

      for(var key2 in source)
        callback(source[key2]);
    };
  };

  this.get = function(id, source)
  {
    var ids = sources[source];
    if(ids == undefined)
      return undefined;

    return ids[id];
  };

  this.remove = function(id, source)
  {
    var ids = sources[source];
    if(ids == undefined)
      return;

    delete ids[id];

    // Check it's empty
    for(var i in ids){return false}

    delete sources[source];
  };

  this.set = function(value, id, source)
  {
    if(value == undefined)
      return this.remove(id, source);

    var ids = sources[source];
    if(ids == undefined)
      sources[source] = ids = {};

    ids[id] = value;
  };
};


Mapper.prototype.pop = function(id, source)
{
  var value = this.get(id, source);
  if(value == undefined)
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

var JsonRpcClient  = require('./jsonrpcclient');


exports.JsonRpcClient  = JsonRpcClient;
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
var WebSocketWithReconnection = require('./transports/webSocketWithReconnection');

Date.now = Date.now || function() {
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

    configuration.rpc.pull = function(params, request) {
        request.reply(null, "push");
    }

    wsConfig.onreconnecting = function() {
        Logger.debug("--------- ONRECONNECTING -----------");
        if (status === RECONNECTING) {
            Logger.error("Websocket already in RECONNECTING state when receiving a new ONRECONNECTING message. Ignoring it");
            return;
        }

        status = RECONNECTING;
        if (onreconnecting) {
            onreconnecting();
        }
    }

    wsConfig.onreconnected = function() {
        Logger.debug("--------- ONRECONNECTED -----------");
        if (status === CONNECTED) {
            Logger.error("Websocket already in CONNECTED state when receiving a new ONRECONNECTED message. Ignoring it");
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

    wsConfig.onconnected = function() {
        Logger.debug("--------- ONCONNECTED -----------");
        if (status === CONNECTED) {
            Logger.error("Websocket already in CONNECTED state when receiving a new ONCONNECTED message. Ignoring it");
            return;
        }
        status = CONNECTED;

        enabledPings = true;
        usePing();

        if (onconnected) {
            onconnected();
        }
    }

    wsConfig.onerror = function(error) {
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
        function(request) {

            Logger.debug('Received request: ' + JSON.stringify(request));

            try {
                var func = configuration.rpc[request.method];

                if (func === undefined) {
                    Logger.error("Method " + request.method + " not registered in client");
                } else {
                    func(request.params, request);
                }
            } catch (err) {
                Logger.error('Exception processing request: ' + JSON.stringify(request));
                Logger.error(err);
            }
        });

    this.send = function(method, params, callback) {
        if (method !== 'ping') {
            Logger.debug('Request: method:' + method + " params:" + JSON.stringify(params));
        }

        var requestTime = Date.now();

        rpc.encode(method, params, function(error, result) {
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

            self.send('ping', params, (function(pingNum) {
                return function(error, result) {
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

    this.close = function() {
        Logger.debug("Closing jsonRpcClient explicitly by client");

        if (pingInterval != undefined) {
            Logger.debug("Clearing ping interval");
            clearInterval(pingInterval);
        }
        pingPongStarted = false;
        enabledPings = false;

        if (configuration.sendCloseMessage) {
            Logger.debug("Sending close message")
            this.send('closeSession', null, function(error, result) {
                if (error) {
                    Logger.error("Error sending close message: " + JSON.stringify(error));
                }
                ws.close();
            });
        } else {
			ws.close();
        }
    }

    // This method is only for testing
    this.forceClose = function(millis) {
        ws.forceClose(millis);
    }

    this.reconnect = function() {
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

var WebSocketWithReconnection  = require('./webSocketWithReconnection');


exports.WebSocketWithReconnection  = WebSocketWithReconnection;
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
    } catch (e) { }
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

    ws.onopen = function() {
        logConnected(ws, wsUri);
        if (config.onconnected) {
            config.onconnected();
        }
    };

    ws.onerror = function(error) {
        Logger.error("Could not connect to " + wsUri + " (invoking onerror if defined)", error);
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

    var reconnectionOnClose = function() {
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
        Logger.debug("reconnectToSameUri (attempt #" + numRetries + ", max=" + maxRetries + ")");

        if (numRetries === 1) {
            if (reconnecting) {
                Logger.warn("Trying to reconnectToNewUri when reconnecting... Ignoring this reconnection.")
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
                config.newWsUriOnReconnection(function(error, newWsUri) {

                    if (error) {
                        Logger.debug(error);
                        setTimeout(function() {
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

        newWs.onopen = function() {
            Logger.debug("Reconnected after " + numRetries + " attempts...");
            logConnected(newWs, wsUri);
            reconnecting = false;
            registerMessageHandler();
            if (config.onreconnected()) {
                config.onreconnected();
            }

            newWs.onclose = reconnectionOnClose;
        };

        var onErrorOrClose = function(error) {
            Logger.warn("Reconnection error: ", error);

            if (numRetries === maxRetries) {
                if (config.ondisconnect) {
                    config.ondisconnect();
                }
            } else {
                setTimeout(function() {
                    reconnectToSameUri(maxRetries, numRetries + 1);
                }, RETRY_TIME_MS);
            }
        };

        newWs.onerror = onErrorOrClose;

        ws = newWs;
    }

    this.close = function() {
        closing = true;
        ws.close();
    };


    // This method is only for testing
    this.forceClose = function(millis) {
        Logger.debug("Testing: Force WebSocket close");

        if (millis) {
            Logger.debug("Testing: Change wsUri for " + millis + " millis to simulate net failure");
            var goodWsUri = wsUri;
            wsUri = "wss://21.234.12.34.4:443/";

            forcingDisconnection = true;

            setTimeout(function() {
                Logger.debug("Testing: Recover good wsUri " + goodWsUri);
                wsUri = goodWsUri;

                forcingDisconnection = false;

            }, millis);
        }

        ws.close();
    };

    this.reconnectWs = function() {
        Logger.debug("reconnectWs");
        reconnectToSameUri(MAX_RETRIES, 1, wsUri);
    };

    this.send = function(message) {
        ws.send(message);
    };

    this.addEventListener = function(type, callback) {
        registerMessageHandler = function() {
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
if(Object.defineProperty)
{
  try
  {
    Object.defineProperty({}, "x", {});
  }
  catch(e)
  {
    defineProperty_IE8 = true
  }
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/bind
if (!Function.prototype.bind) {
  Function.prototype.bind = function(oThis) {
    if (typeof this !== 'function') {
      // closest thing possible to the ECMAScript 5
      // internal IsCallable function
      throw new TypeError('Function.prototype.bind - what is trying to be bound is not callable');
    }

    var aArgs   = Array.prototype.slice.call(arguments, 1),
        fToBind = this,
        fNOP    = function() {},
        fBound  = function() {
          return fToBind.apply(this instanceof fNOP && oThis
                 ? this
                 : oThis,
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


function unifyResponseMethods(responseMethods)
{
  if(!responseMethods) return {};

  for(var key in responseMethods)
  {
    var value = responseMethods[key];

    if(typeof value == 'string')
      responseMethods[key] =
      {
        response: value
      }
  };

  return responseMethods;
};

function unifyTransport(transport)
{
  if(!transport) return;

  // Transport as a function
  if(transport instanceof Function)
    return {send: transport};

  // WebSocket & DataChannel
  if(transport.send instanceof Function)
    return transport;

  // Message API (Inter-window & WebWorker)
  if(transport.postMessage instanceof Function)
  {
    transport.send = transport.postMessage;
    return transport;
  }

  // Stream API
  if(transport.write instanceof Function)
  {
    transport.send = transport.write;
    return transport;
  }

  // Transports that only can receive messages, but not send
  if(transport.onmessage !== undefined) return;
  if(transport.pause instanceof Function) return;

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
function RpcNotification(method, params)
{
  if(defineProperty_IE8)
  {
    this.method = method
    this.params = params
  }
  else
  {
    Object.defineProperty(this, 'method', {value: method, enumerable: true});
    Object.defineProperty(this, 'params', {value: params, enumerable: true});
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
function RpcBuilder(packer, options, transport, onRequest)
{
  var self = this;

  if(!packer)
    throw new SyntaxError('Packer is not defined');

  if(!packer.pack || !packer.unpack)
    throw new SyntaxError('Packer is invalid');

  var responseMethods = unifyResponseMethods(packer.responseMethods);


  if(options instanceof Function)
  {
    if(transport != undefined)
      throw new SyntaxError("There can't be parameters after onRequest");

    onRequest = options;
    transport = undefined;
    options   = undefined;
  };

  if(options && options.send instanceof Function)
  {
    if(transport && !(transport instanceof Function))
      throw new SyntaxError("Only a function can be after transport");

    onRequest = transport;
    transport = options;
    options   = undefined;
  };

  if(transport instanceof Function)
  {
    if(onRequest != undefined)
      throw new SyntaxError("There can't be parameters after onRequest");

    onRequest = transport;
    transport = undefined;
  };

  if(transport && transport.send instanceof Function)
    if(onRequest && !(onRequest instanceof Function))
      throw new SyntaxError("Only a function can be after transport");

  options = options || {};


  EventEmitter.call(this);

  if(onRequest)
    this.on('request', onRequest);


  if(defineProperty_IE8)
    this.peerID = options.peerID
  else
    Object.defineProperty(this, 'peerID', {value: options.peerID});

  var max_retries = options.max_retries || 0;


  function transportMessage(event)
  {
    self.decode(event.data || event);
  };

  this.getTransport = function()
  {
    return transport;
  }
  this.setTransport = function(value)
  {
    // Remove listener from old transport
    if(transport)
    {
      // W3C transports
      if(transport.removeEventListener)
        transport.removeEventListener('message', transportMessage);

      // Node.js Streams API
      else if(transport.removeListener)
        transport.removeListener('data', transportMessage);
    };

    // Set listener on new transport
    if(value)
    {
      // W3C transports
      if(value.addEventListener)
        value.addEventListener('message', transportMessage);

      // Node.js Streams API
      else if(value.addListener)
        value.addListener('data', transportMessage);
    };

    transport = unifyTransport(value);
  }

  if(!defineProperty_IE8)
    Object.defineProperty(this, 'transport',
    {
      get: this.getTransport.bind(this),
      set: this.setTransport.bind(this)
    })

  this.setTransport(transport);


  var request_timeout      = options.request_timeout      || BASE_TIMEOUT;
  var ping_request_timeout = options.ping_request_timeout || request_timeout;
  var response_timeout     = options.response_timeout     || BASE_TIMEOUT;
  var duplicates_timeout   = options.duplicates_timeout   || BASE_TIMEOUT;


  var requestID = 0;

  var requests  = new Mapper();
  var responses = new Mapper();
  var processedResponses = new Mapper();

  var message2Key = {};


  /**
   * Store the response to prevent to process duplicate request later
   */
  function storeResponse(message, id, dest)
  {
    var response =
    {
      message: message,
      /** Timeout to auto-clean old responses */
      timeout: setTimeout(function()
      {
        responses.remove(id, dest);
      },
      response_timeout)
    };

    responses.set(response, id, dest);
  };

  /**
   * Store the response to ignore duplicated messages later
   */
  function storeProcessedResponse(ack, from)
  {
    var timeout = setTimeout(function()
    {
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
  function RpcRequest(method, params, id, from, transport)
  {
    RpcNotification.call(this, method, params);

    this.getTransport = function()
    {
      return transport;
    }
    this.setTransport = function(value)
    {
      transport = unifyTransport(value);
    }

    if(!defineProperty_IE8)
      Object.defineProperty(this, 'transport',
      {
        get: this.getTransport.bind(this),
        set: this.setTransport.bind(this)
      })

    var response = responses.get(id, from);

    /**
     * @constant {Boolean} duplicated
     */
    if(!(transport || self.getTransport()))
    {
      if(defineProperty_IE8)
        this.duplicated = Boolean(response)
      else
        Object.defineProperty(this, 'duplicated',
        {
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
    this.reply = function(error, result, transport)
    {
      // Fix optional parameters
      if(error instanceof Function || error && error.send instanceof Function)
      {
        if(result != undefined)
          throw new SyntaxError("There can't be parameters after callback");

        transport = error;
        result = null;
        error = undefined;
      }

      else if(result instanceof Function
      || result && result.send instanceof Function)
      {
        if(transport != undefined)
          throw new SyntaxError("There can't be parameters after callback");

        transport = result;
        result = null;
      };

      transport = unifyTransport(transport);

      // Duplicated request, remove old response timeout
      if(response)
        clearTimeout(response.timeout);

      if(from != undefined)
      {
        if(error)
          error.dest = from;

        if(result)
          result.dest = from;
      };

      var message;

      // New request or overriden one, create new response with provided data
      if(error || result != undefined)
      {
        if(self.peerID != undefined)
        {
          if(error)
            error.from = self.peerID;
          else
            result.from = self.peerID;
        }

        // Protocol indicates that responses has own request methods
        if(responseMethod)
        {
          if(responseMethod.error == undefined && error)
            message =
            {
              error: error
            };

          else
          {
            var method = error
                       ? responseMethod.error
                       : responseMethod.response;

            message =
            {
              method: method,
              params: error || result
            };
          }
        }
        else
          message =
          {
            error:  error,
            result: result
          };

        message = packer.pack(message, id);
      }

      // Duplicate & not-overriden request, re-send old response
      else if(response)
        message = response.message;

      // New empty reply, response null value
      else
        message = packer.pack({result: null}, id);

      // Store the response to prevent to process a duplicated request later
      storeResponse(message, id, from);

      // Return the stored response so it can be directly send back
      transport = transport || this.getTransport() || self.getTransport();

      if(transport)
        return transport.send(message);

      return message;
    }
  };
  inherits(RpcRequest, RpcNotification);


  function cancel(message)
  {
    var key = message2Key[message];
    if(!key) return;

    delete message2Key[message];

    var request = requests.pop(key.id, key.dest);
    if(!request) return;

    clearTimeout(request.timeout);

    // Start duplicated responses timeout
    storeProcessedResponse(key.id, key.dest);
  };

  /**
   * Allow to cancel a request and don't wait for a response
   *
   * If `message` is not given, cancel all the request
   */
  this.cancel = function(message)
  {
    if(message) return cancel(message);

    for(var message in message2Key)
      cancel(message);
  };


  this.close = function()
  {
    // Prevent to receive new messages
    var transport = this.getTransport();
    if(transport && transport.close)
       transport.close();

    // Request & processed responses
    this.cancel();

    processedResponses.forEach(clearTimeout);

    // Responses
    responses.forEach(function(response)
    {
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
  this.encode = function(method, params, dest, transport, callback)
  {
    // Fix optional parameters
    if(params instanceof Function)
    {
      if(dest != undefined)
        throw new SyntaxError("There can't be parameters after callback");

      callback  = params;
      transport = undefined;
      dest      = undefined;
      params    = undefined;
    }

    else if(dest instanceof Function)
    {
      if(transport != undefined)
        throw new SyntaxError("There can't be parameters after callback");

      callback  = dest;
      transport = undefined;
      dest      = undefined;
    }

    else if(transport instanceof Function)
    {
      if(callback != undefined)
        throw new SyntaxError("There can't be parameters after callback");

      callback  = transport;
      transport = undefined;
    };

    if(self.peerID != undefined)
    {
      params = params || {};

      params.from = self.peerID;
    };

    if(dest != undefined)
    {
      params = params || {};

      params.dest = dest;
    };

    // Encode message
    var message =
    {
      method: method,
      params: params
    };

    if(callback)
    {
      var id = requestID++;
      var retried = 0;

      message = packer.pack(message, id);

      function dispatchCallback(error, result)
      {
        self.cancel(message);

        callback(error, result);
      };

      var request =
      {
        message:         message,
        callback:        dispatchCallback,
        responseMethods: responseMethods[method] || {}
      };

      var encode_transport = unifyTransport(transport);

      function sendRequest(transport)
      {
        var rt = (method === 'ping' ? ping_request_timeout : request_timeout);
        request.timeout = setTimeout(timeout, rt*Math.pow(2, retried++));
        message2Key[message] = {id: id, dest: dest};
        requests.set(request, id, dest);

        transport = transport || encode_transport || self.getTransport();
        if(transport)
          return transport.send(message);

        return message;
      };

      function retry(transport)
      {
        transport = unifyTransport(transport);

        console.warn(retried+' retry for request message:',message);

        var timeout = processedResponses.pop(id, dest);
        clearTimeout(timeout);

        return sendRequest(transport);
      };

      function timeout()
      {
        if(retried < max_retries)
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
    if(transport)
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
  this.decode = function(message, transport)
  {
    if(!message)
      throw new TypeError("Message is not defined");

    try
    {
      message = packer.unpack(message);
    }
    catch(e)
    {
      // Ignore invalid messages
      return console.debug(e, message);
    };

    var id     = message.id;
    var ack    = message.ack;
    var method = message.method;
    var params = message.params || {};

    var from = params.from;
    var dest = params.dest;

    // Ignore messages send by us
    if(self.peerID != undefined && from == self.peerID) return;

    // Notification
    if(id == undefined && ack == undefined)
    {
      var notification = new RpcNotification(method, params);

      if(self.emit('request', notification)) return;
      return notification;
    };


    function processRequest()
    {
      // If we have a transport and it's a duplicated request, reply inmediatly
      transport = unifyTransport(transport) || self.getTransport();
      if(transport)
      {
        var response = responses.get(id, from);
        if(response)
          return transport.send(response.message);
      };

      var idAck = (id != undefined) ? id : ack;
      var request = new RpcRequest(method, params, idAck, from, transport);

      if(self.emit('request', request)) return;
      return request;
    };

    function processResponse(request, error, result)
    {
      request.callback(error, result);
    };

    function duplicatedResponse(timeout)
    {
      console.warn("Response already processed", message);

      // Update duplicated responses timeout
      clearTimeout(timeout);
      storeProcessedResponse(ack, from);
    };


    // Request, or response with own method
    if(method)
    {
      // Check if it's a response with own method
      if(dest == undefined || dest == self.peerID)
      {
        var request = requests.get(ack, from);
        if(request)
        {
          var responseMethods = request.responseMethods;

          if(method == responseMethods.error)
            return processResponse(request, params);

          if(method == responseMethods.response)
            return processResponse(request, null, params);

          return processRequest();
        }

        var processed = processedResponses.get(ack, from);
        if(processed)
          return duplicatedResponse(processed);
      }

      // Request
      return processRequest();
    };

    var error  = message.error;
    var result = message.result;

    // Ignore responses not send to us
    if(error  && error.dest  && error.dest  != self.peerID) return;
    if(result && result.dest && result.dest != self.peerID) return;

    // Response
    var request = requests.get(ack, from);
    if(!request)
    {
      var processed = processedResponses.get(ack, from);
      if(processed)
        return duplicatedResponse(processed);

      return console.warn("No callback was defined for this message", message);
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
function pack(message, id)
{
  var result =
  {
    jsonrpc: "2.0"
  };

  // Request
  if(message.method)
  {
    result.method = message.method;

    if(message.params)
      result.params = message.params;

    // Request is a notification
    if(id != undefined)
      result.id = id;
  }

  // Response
  else if(id != undefined)
  {
    if(message.error)
    {
      if(message.result !== undefined)
        throw new TypeError("Both result and error are defined");

      result.error = message.error;
    }
    else if(message.result !== undefined)
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
function unpack(message)
{
  var result = message;

  if(typeof message === 'string' || message instanceof String) {
    result = JSON.parse(message);
  }

  // Check if it's a valid message

  var version = result.jsonrpc;
  if(version !== '2.0')
    throw new TypeError("Invalid JsonRPC version '" + version + "': " + message);

  // Response
  if(result.method == undefined)
  {
    if(result.id == undefined)
      throw new TypeError("Invalid message: "+message);

    var result_defined = result.result !== undefined;
    var error_defined  = result.error  !== undefined;

    // Check only result or error is defined, not both or none
    if(result_defined && error_defined)
      throw new TypeError("Both result and error are defined: "+message);

    if(!result_defined && !error_defined)
      throw new TypeError("No result or error is defined: "+message);

    result.ack = result.id;
    delete result.id;
  }

  // Return unpacked message
  return result;
};


exports.pack   = pack;
exports.unpack = unpack;

},{}],8:[function(require,module,exports){
function pack(message)
{
  throw new TypeError("Not yet implemented");
};

function unpack(message)
{
  throw new TypeError("Not yet implemented");
};


exports.pack   = pack;
exports.unpack = unpack;

},{}],9:[function(require,module,exports){
var JsonRPC = require('./JsonRPC');
var XmlRPC  = require('./XmlRPC');


exports.JsonRPC = JsonRPC;
exports.XmlRPC  = XmlRPC;

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

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      } else {
        // At least give some kind of context to the user
        var err = new Error('Uncaught, unspecified "error" event. (' + er + ')');
        err.context = er;
        throw err;
      }
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        args = Array.prototype.slice.call(arguments, 1);
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    args = Array.prototype.slice.call(arguments, 1);
    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else if (listeners) {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.prototype.listenerCount = function(type) {
  if (this._events) {
    var evlistener = this._events[type];

    if (isFunction(evlistener))
      return 1;
    else if (evlistener)
      return evlistener.length;
  }
  return 0;
};

EventEmitter.listenerCount = function(emitter, type) {
  return emitter.listenerCount(type);
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],11:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}]},{},[6])(6)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJsaWIvTWFwcGVyLmpzIiwibGliL2NsaWVudHMvaW5kZXguanMiLCJsaWIvY2xpZW50cy9qc29ucnBjY2xpZW50LmpzIiwibGliL2NsaWVudHMvdHJhbnNwb3J0cy9pbmRleC5qcyIsImxpYi9jbGllbnRzL3RyYW5zcG9ydHMvd2ViU29ja2V0V2l0aFJlY29ubmVjdGlvbi5qcyIsImxpYi9pbmRleC5qcyIsImxpYi9wYWNrZXJzL0pzb25SUEMuanMiLCJsaWIvcGFja2Vycy9YbWxSUEMuanMiLCJsaWIvcGFja2Vycy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9ldmVudHMvZXZlbnRzLmpzIiwibm9kZV9tb2R1bGVzL2luaGVyaXRzL2luaGVyaXRzX2Jyb3dzZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNwQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDbFBBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3R6QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2R0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNiQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOVNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJmdW5jdGlvbiBNYXBwZXIoKVxue1xuICB2YXIgc291cmNlcyA9IHt9O1xuXG5cbiAgdGhpcy5mb3JFYWNoID0gZnVuY3Rpb24oY2FsbGJhY2spXG4gIHtcbiAgICBmb3IodmFyIGtleSBpbiBzb3VyY2VzKVxuICAgIHtcbiAgICAgIHZhciBzb3VyY2UgPSBzb3VyY2VzW2tleV07XG5cbiAgICAgIGZvcih2YXIga2V5MiBpbiBzb3VyY2UpXG4gICAgICAgIGNhbGxiYWNrKHNvdXJjZVtrZXkyXSk7XG4gICAgfTtcbiAgfTtcblxuICB0aGlzLmdldCA9IGZ1bmN0aW9uKGlkLCBzb3VyY2UpXG4gIHtcbiAgICB2YXIgaWRzID0gc291cmNlc1tzb3VyY2VdO1xuICAgIGlmKGlkcyA9PSB1bmRlZmluZWQpXG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgcmV0dXJuIGlkc1tpZF07XG4gIH07XG5cbiAgdGhpcy5yZW1vdmUgPSBmdW5jdGlvbihpZCwgc291cmNlKVxuICB7XG4gICAgdmFyIGlkcyA9IHNvdXJjZXNbc291cmNlXTtcbiAgICBpZihpZHMgPT0gdW5kZWZpbmVkKVxuICAgICAgcmV0dXJuO1xuXG4gICAgZGVsZXRlIGlkc1tpZF07XG5cbiAgICAvLyBDaGVjayBpdCdzIGVtcHR5XG4gICAgZm9yKHZhciBpIGluIGlkcyl7cmV0dXJuIGZhbHNlfVxuXG4gICAgZGVsZXRlIHNvdXJjZXNbc291cmNlXTtcbiAgfTtcblxuICB0aGlzLnNldCA9IGZ1bmN0aW9uKHZhbHVlLCBpZCwgc291cmNlKVxuICB7XG4gICAgaWYodmFsdWUgPT0gdW5kZWZpbmVkKVxuICAgICAgcmV0dXJuIHRoaXMucmVtb3ZlKGlkLCBzb3VyY2UpO1xuXG4gICAgdmFyIGlkcyA9IHNvdXJjZXNbc291cmNlXTtcbiAgICBpZihpZHMgPT0gdW5kZWZpbmVkKVxuICAgICAgc291cmNlc1tzb3VyY2VdID0gaWRzID0ge307XG5cbiAgICBpZHNbaWRdID0gdmFsdWU7XG4gIH07XG59O1xuXG5cbk1hcHBlci5wcm90b3R5cGUucG9wID0gZnVuY3Rpb24oaWQsIHNvdXJjZSlcbntcbiAgdmFyIHZhbHVlID0gdGhpcy5nZXQoaWQsIHNvdXJjZSk7XG4gIGlmKHZhbHVlID09IHVuZGVmaW5lZClcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuXG4gIHRoaXMucmVtb3ZlKGlkLCBzb3VyY2UpO1xuXG4gIHJldHVybiB2YWx1ZTtcbn07XG5cblxubW9kdWxlLmV4cG9ydHMgPSBNYXBwZXI7XG4iLCIvKlxuICogKEMpIENvcHlyaWdodCAyMDE0IEt1cmVudG8gKGh0dHA6Ly9rdXJlbnRvLm9yZy8pXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4gKlxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuICogV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cbiAqXG4gKi9cblxudmFyIEpzb25ScGNDbGllbnQgID0gcmVxdWlyZSgnLi9qc29ucnBjY2xpZW50Jyk7XG5cblxuZXhwb3J0cy5Kc29uUnBjQ2xpZW50ICA9IEpzb25ScGNDbGllbnQ7IiwiLypcbiAqIChDKSBDb3B5cmlnaHQgMjAxNCBLdXJlbnRvIChodHRwOi8va3VyZW50by5vcmcvKVxuICpcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqXG4gKiAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKlxuICovXG5cbnZhciBScGNCdWlsZGVyID0gcmVxdWlyZSgnLi4vLi4nKTtcbnZhciBXZWJTb2NrZXRXaXRoUmVjb25uZWN0aW9uID0gcmVxdWlyZSgnLi90cmFuc3BvcnRzL3dlYlNvY2tldFdpdGhSZWNvbm5lY3Rpb24nKTtcblxuRGF0ZS5ub3cgPSBEYXRlLm5vdyB8fCBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gK25ldyBEYXRlO1xufTtcblxudmFyIFBJTkdfSU5URVJWQUwgPSA1MDAwO1xuXG52YXIgUkVDT05ORUNUSU5HID0gJ1JFQ09OTkVDVElORyc7XG52YXIgQ09OTkVDVEVEID0gJ0NPTk5FQ1RFRCc7XG52YXIgRElTQ09OTkVDVEVEID0gJ0RJU0NPTk5FQ1RFRCc7XG5cbnZhciBMb2dnZXIgPSBjb25zb2xlO1xuXG4vKipcbiAqXG4gKiBoZWFydGJlYXQ6IGludGVydmFsIGluIG1zIGZvciBlYWNoIGhlYXJ0YmVhdCBtZXNzYWdlLFxuICogc2VuZENsb3NlTWVzc2FnZSA6IHRydWUgLyBmYWxzZSwgYmVmb3JlIGNsb3NpbmcgdGhlIGNvbm5lY3Rpb24sIGl0IHNlbmRzIGEgY2xvc2VTZXNzaW9uIG1lc3NhZ2VcbiAqIDxwcmU+XG4gKiB3cyA6IHtcbiAqIFx0dXJpIDogVVJJIHRvIGNvbm50ZWN0IHRvLFxuICogIHVzZVNvY2tKUyA6IHRydWUgKHVzZSBTb2NrSlMpIC8gZmFsc2UgKHVzZSBXZWJTb2NrZXQpIGJ5IGRlZmF1bHQsXG4gKiBcdG9uY29ubmVjdGVkIDogY2FsbGJhY2sgbWV0aG9kIHRvIGludm9rZSB3aGVuIGNvbm5lY3Rpb24gaXMgc3VjY2Vzc2Z1bCxcbiAqIFx0b25kaXNjb25uZWN0IDogY2FsbGJhY2sgbWV0aG9kIHRvIGludm9rZSB3aGVuIHRoZSBjb25uZWN0aW9uIGlzIGxvc3QsXG4gKiBcdG9ucmVjb25uZWN0aW5nIDogY2FsbGJhY2sgbWV0aG9kIHRvIGludm9rZSB3aGVuIHRoZSBjbGllbnQgaXMgcmVjb25uZWN0aW5nLFxuICogXHRvbnJlY29ubmVjdGVkIDogY2FsbGJhY2sgbWV0aG9kIHRvIGludm9rZSB3aGVuIHRoZSBjbGllbnQgc3VjY2VzZnVsbHkgcmVjb25uZWN0cyxcbiAqIFx0b25lcnJvciA6IGNhbGxiYWNrIG1ldGhvZCB0byBpbnZva2Ugd2hlbiB0aGVyZSBpcyBhbiBlcnJvclxuICogfSxcbiAqIHJwYyA6IHtcbiAqIFx0cmVxdWVzdFRpbWVvdXQgOiB0aW1lb3V0IGZvciBhIHJlcXVlc3QsXG4gKiBcdHNlc3Npb25TdGF0dXNDaGFuZ2VkOiBjYWxsYmFjayBtZXRob2QgZm9yIGNoYW5nZXMgaW4gc2Vzc2lvbiBzdGF0dXMsXG4gKiBcdG1lZGlhUmVuZWdvdGlhdGlvbjogbWVkaWFSZW5lZ290aWF0aW9uXG4gKiB9XG4gKiA8L3ByZT5cbiAqL1xuZnVuY3Rpb24gSnNvblJwY0NsaWVudChjb25maWd1cmF0aW9uKSB7XG5cbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICB2YXIgd3NDb25maWcgPSBjb25maWd1cmF0aW9uLndzO1xuXG4gICAgdmFyIG5vdFJlY29ubmVjdElmTnVtTGVzc1RoYW4gPSAtMTtcblxuICAgIHZhciBwaW5nTmV4dE51bSA9IDA7XG4gICAgdmFyIGVuYWJsZWRQaW5ncyA9IHRydWU7XG4gICAgdmFyIHBpbmdQb25nU3RhcnRlZCA9IGZhbHNlO1xuICAgIHZhciBwaW5nSW50ZXJ2YWw7XG5cbiAgICB2YXIgc3RhdHVzID0gRElTQ09OTkVDVEVEO1xuXG4gICAgdmFyIG9ucmVjb25uZWN0aW5nID0gd3NDb25maWcub25yZWNvbm5lY3Rpbmc7XG4gICAgdmFyIG9ucmVjb25uZWN0ZWQgPSB3c0NvbmZpZy5vbnJlY29ubmVjdGVkO1xuICAgIHZhciBvbmNvbm5lY3RlZCA9IHdzQ29uZmlnLm9uY29ubmVjdGVkO1xuICAgIHZhciBvbmVycm9yID0gd3NDb25maWcub25lcnJvcjtcblxuICAgIGNvbmZpZ3VyYXRpb24ucnBjLnB1bGwgPSBmdW5jdGlvbihwYXJhbXMsIHJlcXVlc3QpIHtcbiAgICAgICAgcmVxdWVzdC5yZXBseShudWxsLCBcInB1c2hcIik7XG4gICAgfVxuXG4gICAgd3NDb25maWcub25yZWNvbm5lY3RpbmcgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgTG9nZ2VyLmRlYnVnKFwiLS0tLS0tLS0tIE9OUkVDT05ORUNUSU5HIC0tLS0tLS0tLS0tXCIpO1xuICAgICAgICBpZiAoc3RhdHVzID09PSBSRUNPTk5FQ1RJTkcpIHtcbiAgICAgICAgICAgIExvZ2dlci5lcnJvcihcIldlYnNvY2tldCBhbHJlYWR5IGluIFJFQ09OTkVDVElORyBzdGF0ZSB3aGVuIHJlY2VpdmluZyBhIG5ldyBPTlJFQ09OTkVDVElORyBtZXNzYWdlLiBJZ25vcmluZyBpdFwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHN0YXR1cyA9IFJFQ09OTkVDVElORztcbiAgICAgICAgaWYgKG9ucmVjb25uZWN0aW5nKSB7XG4gICAgICAgICAgICBvbnJlY29ubmVjdGluZygpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgd3NDb25maWcub25yZWNvbm5lY3RlZCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBMb2dnZXIuZGVidWcoXCItLS0tLS0tLS0gT05SRUNPTk5FQ1RFRCAtLS0tLS0tLS0tLVwiKTtcbiAgICAgICAgaWYgKHN0YXR1cyA9PT0gQ09OTkVDVEVEKSB7XG4gICAgICAgICAgICBMb2dnZXIuZXJyb3IoXCJXZWJzb2NrZXQgYWxyZWFkeSBpbiBDT05ORUNURUQgc3RhdGUgd2hlbiByZWNlaXZpbmcgYSBuZXcgT05SRUNPTk5FQ1RFRCBtZXNzYWdlLiBJZ25vcmluZyBpdFwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBzdGF0dXMgPSBDT05ORUNURUQ7XG5cbiAgICAgICAgZW5hYmxlZFBpbmdzID0gdHJ1ZTtcbiAgICAgICAgdXBkYXRlTm90UmVjb25uZWN0SWZMZXNzVGhhbigpO1xuICAgICAgICB1c2VQaW5nKCk7XG5cbiAgICAgICAgaWYgKG9ucmVjb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIG9ucmVjb25uZWN0ZWQoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHdzQ29uZmlnLm9uY29ubmVjdGVkID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIExvZ2dlci5kZWJ1ZyhcIi0tLS0tLS0tLSBPTkNPTk5FQ1RFRCAtLS0tLS0tLS0tLVwiKTtcbiAgICAgICAgaWYgKHN0YXR1cyA9PT0gQ09OTkVDVEVEKSB7XG4gICAgICAgICAgICBMb2dnZXIuZXJyb3IoXCJXZWJzb2NrZXQgYWxyZWFkeSBpbiBDT05ORUNURUQgc3RhdGUgd2hlbiByZWNlaXZpbmcgYSBuZXcgT05DT05ORUNURUQgbWVzc2FnZS4gSWdub3JpbmcgaXRcIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgc3RhdHVzID0gQ09OTkVDVEVEO1xuXG4gICAgICAgIGVuYWJsZWRQaW5ncyA9IHRydWU7XG4gICAgICAgIHVzZVBpbmcoKTtcblxuICAgICAgICBpZiAob25jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIG9uY29ubmVjdGVkKCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB3c0NvbmZpZy5vbmVycm9yID0gZnVuY3Rpb24oZXJyb3IpIHtcbiAgICAgICAgTG9nZ2VyLmRlYnVnKFwiLS0tLS0tLS0tIE9ORVJST1IgLS0tLS0tLS0tLS1cIik7XG5cbiAgICAgICAgc3RhdHVzID0gRElTQ09OTkVDVEVEO1xuXG4gICAgICAgIGlmIChvbmVycm9yKSB7XG4gICAgICAgICAgICBvbmVycm9yKGVycm9yKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHZhciB3cyA9IG5ldyBXZWJTb2NrZXRXaXRoUmVjb25uZWN0aW9uKHdzQ29uZmlnKTtcblxuICAgIExvZ2dlci5kZWJ1ZygnQ29ubmVjdGluZyB3ZWJzb2NrZXQgdG8gVVJJOiAnICsgd3NDb25maWcudXJpKTtcblxuICAgIHZhciBycGNCdWlsZGVyT3B0aW9ucyA9IHtcbiAgICAgICAgcmVxdWVzdF90aW1lb3V0OiBjb25maWd1cmF0aW9uLnJwYy5yZXF1ZXN0VGltZW91dCxcbiAgICAgICAgcGluZ19yZXF1ZXN0X3RpbWVvdXQ6IGNvbmZpZ3VyYXRpb24ucnBjLmhlYXJ0YmVhdFJlcXVlc3RUaW1lb3V0XG4gICAgfTtcblxuICAgIHZhciBycGMgPSBuZXcgUnBjQnVpbGRlcihScGNCdWlsZGVyLnBhY2tlcnMuSnNvblJQQywgcnBjQnVpbGRlck9wdGlvbnMsIHdzLFxuICAgICAgICBmdW5jdGlvbihyZXF1ZXN0KSB7XG5cbiAgICAgICAgICAgIExvZ2dlci5kZWJ1ZygnUmVjZWl2ZWQgcmVxdWVzdDogJyArIEpTT04uc3RyaW5naWZ5KHJlcXVlc3QpKTtcblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB2YXIgZnVuYyA9IGNvbmZpZ3VyYXRpb24ucnBjW3JlcXVlc3QubWV0aG9kXTtcblxuICAgICAgICAgICAgICAgIGlmIChmdW5jID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgTG9nZ2VyLmVycm9yKFwiTWV0aG9kIFwiICsgcmVxdWVzdC5tZXRob2QgKyBcIiBub3QgcmVnaXN0ZXJlZCBpbiBjbGllbnRcIik7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgZnVuYyhyZXF1ZXN0LnBhcmFtcywgcmVxdWVzdCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgTG9nZ2VyLmVycm9yKCdFeGNlcHRpb24gcHJvY2Vzc2luZyByZXF1ZXN0OiAnICsgSlNPTi5zdHJpbmdpZnkocmVxdWVzdCkpO1xuICAgICAgICAgICAgICAgIExvZ2dlci5lcnJvcihlcnIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgIHRoaXMuc2VuZCA9IGZ1bmN0aW9uKG1ldGhvZCwgcGFyYW1zLCBjYWxsYmFjaykge1xuICAgICAgICBpZiAobWV0aG9kICE9PSAncGluZycpIHtcbiAgICAgICAgICAgIExvZ2dlci5kZWJ1ZygnUmVxdWVzdDogbWV0aG9kOicgKyBtZXRob2QgKyBcIiBwYXJhbXM6XCIgKyBKU09OLnN0cmluZ2lmeShwYXJhbXMpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciByZXF1ZXN0VGltZSA9IERhdGUubm93KCk7XG5cbiAgICAgICAgcnBjLmVuY29kZShtZXRob2QsIHBhcmFtcywgZnVuY3Rpb24oZXJyb3IsIHJlc3VsdCkge1xuICAgICAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgTG9nZ2VyLmVycm9yKFwiRVJST1I6XCIgKyBlcnJvci5tZXNzYWdlICsgXCIgaW4gUmVxdWVzdDogbWV0aG9kOlwiICtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1ldGhvZCArIFwiIHBhcmFtczpcIiArIEpTT04uc3RyaW5naWZ5KHBhcmFtcykgKyBcIiByZXF1ZXN0OlwiICtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yLnJlcXVlc3QpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoZXJyb3IuZGF0YSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgTG9nZ2VyLmVycm9yKFwiRVJST1IgREFUQTpcIiArIEpTT04uc3RyaW5naWZ5KGVycm9yLmRhdGEpKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHt9XG4gICAgICAgICAgICAgICAgZXJyb3IucmVxdWVzdFRpbWUgPSByZXF1ZXN0VGltZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICAgICAgICAgIGlmIChyZXN1bHQgIT0gdW5kZWZpbmVkICYmIHJlc3VsdC52YWx1ZSAhPT0gJ3BvbmcnKSB7XG4gICAgICAgICAgICAgICAgICAgIExvZ2dlci5kZWJ1ZygnUmVzcG9uc2U6ICcgKyBKU09OLnN0cmluZ2lmeShyZXN1bHQpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY2FsbGJhY2soZXJyb3IsIHJlc3VsdCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHVwZGF0ZU5vdFJlY29ubmVjdElmTGVzc1RoYW4oKSB7XG4gICAgICAgIExvZ2dlci5kZWJ1ZyhcIm5vdFJlY29ubmVjdElmTnVtTGVzc1RoYW4gPSBcIiArIHBpbmdOZXh0TnVtICsgJyAob2xkPScgK1xuICAgICAgICAgICAgbm90UmVjb25uZWN0SWZOdW1MZXNzVGhhbiArICcpJyk7XG4gICAgICAgIG5vdFJlY29ubmVjdElmTnVtTGVzc1RoYW4gPSBwaW5nTmV4dE51bTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzZW5kUGluZygpIHtcbiAgICAgICAgaWYgKGVuYWJsZWRQaW5ncykge1xuICAgICAgICAgICAgdmFyIHBhcmFtcyA9IG51bGw7XG4gICAgICAgICAgICBpZiAocGluZ05leHROdW0gPT0gMCB8fCBwaW5nTmV4dE51bSA9PSBub3RSZWNvbm5lY3RJZk51bUxlc3NUaGFuKSB7XG4gICAgICAgICAgICAgICAgcGFyYW1zID0ge1xuICAgICAgICAgICAgICAgICAgICBpbnRlcnZhbDogY29uZmlndXJhdGlvbi5oZWFydGJlYXQgfHwgUElOR19JTlRFUlZBTFxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwaW5nTmV4dE51bSsrO1xuXG4gICAgICAgICAgICBzZWxmLnNlbmQoJ3BpbmcnLCBwYXJhbXMsIChmdW5jdGlvbihwaW5nTnVtKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uKGVycm9yLCByZXN1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBMb2dnZXIuZGVidWcoXCJFcnJvciBpbiBwaW5nIHJlcXVlc3QgI1wiICsgcGluZ051bSArIFwiIChcIiArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3IubWVzc2FnZSArIFwiKVwiKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwaW5nTnVtID4gbm90UmVjb25uZWN0SWZOdW1MZXNzVGhhbikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVuYWJsZWRQaW5ncyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVwZGF0ZU5vdFJlY29ubmVjdElmTGVzc1RoYW4oKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBMb2dnZXIuZGVidWcoXCJTZXJ2ZXIgZGlkIG5vdCByZXNwb25kIHRvIHBpbmcgbWVzc2FnZSAjXCIgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaW5nTnVtICsgXCIuIFJlY29ubmVjdGluZy4uLiBcIik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgd3MucmVjb25uZWN0V3MoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pKHBpbmdOZXh0TnVtKSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBMb2dnZXIuZGVidWcoXCJUcnlpbmcgdG8gc2VuZCBwaW5nLCBidXQgcGluZyBpcyBub3QgZW5hYmxlZFwiKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qXG4gICAgKiBJZiBjb25maWd1cmF0aW9uLmhlYXJiZWF0IGhhcyBhbnkgdmFsdWUsIHRoZSBwaW5nLXBvbmcgd2lsbCB3b3JrIHdpdGggdGhlIGludGVydmFsXG4gICAgKiBvZiBjb25maWd1cmF0aW9uLmhlYXJiZWF0XG4gICAgKi9cbiAgICBmdW5jdGlvbiB1c2VQaW5nKCkge1xuICAgICAgICBpZiAoIXBpbmdQb25nU3RhcnRlZCkge1xuICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKFwiU3RhcnRpbmcgcGluZyAoaWYgY29uZmlndXJlZClcIilcbiAgICAgICAgICAgIHBpbmdQb25nU3RhcnRlZCA9IHRydWU7XG5cbiAgICAgICAgICAgIGlmIChjb25maWd1cmF0aW9uLmhlYXJ0YmVhdCAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICBwaW5nSW50ZXJ2YWwgPSBzZXRJbnRlcnZhbChzZW5kUGluZywgY29uZmlndXJhdGlvbi5oZWFydGJlYXQpO1xuICAgICAgICAgICAgICAgIHNlbmRQaW5nKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmNsb3NlID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIExvZ2dlci5kZWJ1ZyhcIkNsb3NpbmcganNvblJwY0NsaWVudCBleHBsaWNpdGx5IGJ5IGNsaWVudFwiKTtcblxuICAgICAgICBpZiAocGluZ0ludGVydmFsICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKFwiQ2xlYXJpbmcgcGluZyBpbnRlcnZhbFwiKTtcbiAgICAgICAgICAgIGNsZWFySW50ZXJ2YWwocGluZ0ludGVydmFsKTtcbiAgICAgICAgfVxuICAgICAgICBwaW5nUG9uZ1N0YXJ0ZWQgPSBmYWxzZTtcbiAgICAgICAgZW5hYmxlZFBpbmdzID0gZmFsc2U7XG5cbiAgICAgICAgaWYgKGNvbmZpZ3VyYXRpb24uc2VuZENsb3NlTWVzc2FnZSkge1xuICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKFwiU2VuZGluZyBjbG9zZSBtZXNzYWdlXCIpXG4gICAgICAgICAgICB0aGlzLnNlbmQoJ2Nsb3NlU2Vzc2lvbicsIG51bGwsIGZ1bmN0aW9uKGVycm9yLCByZXN1bHQpIHtcbiAgICAgICAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgTG9nZ2VyLmVycm9yKFwiRXJyb3Igc2VuZGluZyBjbG9zZSBtZXNzYWdlOiBcIiArIEpTT04uc3RyaW5naWZ5KGVycm9yKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHdzLmNsb3NlKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcblx0XHRcdHdzLmNsb3NlKCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBUaGlzIG1ldGhvZCBpcyBvbmx5IGZvciB0ZXN0aW5nXG4gICAgdGhpcy5mb3JjZUNsb3NlID0gZnVuY3Rpb24obWlsbGlzKSB7XG4gICAgICAgIHdzLmZvcmNlQ2xvc2UobWlsbGlzKTtcbiAgICB9XG5cbiAgICB0aGlzLnJlY29ubmVjdCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB3cy5yZWNvbm5lY3RXcygpO1xuICAgIH1cbn1cblxuXG5tb2R1bGUuZXhwb3J0cyA9IEpzb25ScGNDbGllbnQ7XG4iLCIvKlxuICogKEMpIENvcHlyaWdodCAyMDE0IEt1cmVudG8gKGh0dHA6Ly9rdXJlbnRvLm9yZy8pXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4gKlxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuICogV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cbiAqXG4gKi9cblxudmFyIFdlYlNvY2tldFdpdGhSZWNvbm5lY3Rpb24gID0gcmVxdWlyZSgnLi93ZWJTb2NrZXRXaXRoUmVjb25uZWN0aW9uJyk7XG5cblxuZXhwb3J0cy5XZWJTb2NrZXRXaXRoUmVjb25uZWN0aW9uICA9IFdlYlNvY2tldFdpdGhSZWNvbm5lY3Rpb247IiwiLypcbiAqIChDKSBDb3B5cmlnaHQgMjAxMy0yMDE1IEt1cmVudG8gKGh0dHA6Ly9rdXJlbnRvLm9yZy8pXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4gKlxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuICogV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cbiAqL1xuXG5cInVzZSBzdHJpY3RcIjtcblxudmFyIEJyb3dzZXJXZWJTb2NrZXQgPSBnbG9iYWwuV2ViU29ja2V0IHx8IGdsb2JhbC5Nb3pXZWJTb2NrZXQ7XG5cbnZhciBMb2dnZXIgPSBjb25zb2xlO1xuXG4vKipcbiAqIEdldCBlaXRoZXIgdGhlIGBXZWJTb2NrZXRgIG9yIGBNb3pXZWJTb2NrZXRgIGdsb2JhbHNcbiAqIGluIHRoZSBicm93c2VyIG9yIHRyeSB0byByZXNvbHZlIFdlYlNvY2tldC1jb21wYXRpYmxlXG4gKiBpbnRlcmZhY2UgZXhwb3NlZCBieSBgd3NgIGZvciBOb2RlLWxpa2UgZW52aXJvbm1lbnQuXG4gKi9cblxudmFyIFdlYlNvY2tldCA9IEJyb3dzZXJXZWJTb2NrZXQ7XG5pZiAoIVdlYlNvY2tldCAmJiB0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJykge1xuICAgIHRyeSB7XG4gICAgICAgIFdlYlNvY2tldCA9IHJlcXVpcmUoJ3dzJyk7XG4gICAgfSBjYXRjaCAoZSkgeyB9XG59XG5cbi8vdmFyIFNvY2tKUyA9IHJlcXVpcmUoJ3NvY2tqcy1jbGllbnQnKTtcblxudmFyIE1BWF9SRVRSSUVTID0gMjAwMDsgLy8gRm9yZXZlci4uLlxudmFyIFJFVFJZX1RJTUVfTVMgPSAzMDAwOyAvLyBGSVhNRTogSW1wbGVtZW50IGV4cG9uZW50aWFsIHdhaXQgdGltZXMuLi5cblxudmFyIENPTk5FQ1RJTkcgPSAwO1xudmFyIE9QRU4gPSAxO1xudmFyIENMT1NJTkcgPSAyO1xudmFyIENMT1NFRCA9IDM7XG5cbi8qXG5jb25maWcgPSB7XG5cdFx0dXJpIDogd3NVcmksXG5cdFx0dXNlU29ja0pTIDogdHJ1ZSAodXNlIFNvY2tKUykgLyBmYWxzZSAodXNlIFdlYlNvY2tldCkgYnkgZGVmYXVsdCxcblx0XHRvbmNvbm5lY3RlZCA6IGNhbGxiYWNrIG1ldGhvZCB0byBpbnZva2Ugd2hlbiBjb25uZWN0aW9uIGlzIHN1Y2Nlc3NmdWwsXG5cdFx0b25kaXNjb25uZWN0IDogY2FsbGJhY2sgbWV0aG9kIHRvIGludm9rZSB3aGVuIHRoZSBjb25uZWN0aW9uIGlzIGxvc3QsXG5cdFx0b25yZWNvbm5lY3RpbmcgOiBjYWxsYmFjayBtZXRob2QgdG8gaW52b2tlIHdoZW4gdGhlIGNsaWVudCBpcyByZWNvbm5lY3RpbmcsXG5cdFx0b25yZWNvbm5lY3RlZCA6IGNhbGxiYWNrIG1ldGhvZCB0byBpbnZva2Ugd2hlbiB0aGUgY2xpZW50IHN1Y2Nlc2Z1bGx5IHJlY29ubmVjdHMsXG5cdH07XG4qL1xuZnVuY3Rpb24gV2ViU29ja2V0V2l0aFJlY29ubmVjdGlvbihjb25maWcpIHtcblxuICAgIHZhciBjbG9zaW5nID0gZmFsc2U7XG4gICAgdmFyIHJlZ2lzdGVyTWVzc2FnZUhhbmRsZXI7XG4gICAgdmFyIHdzVXJpID0gY29uZmlnLnVyaTtcbiAgICB2YXIgdXNlU29ja0pTID0gY29uZmlnLnVzZVNvY2tKUztcbiAgICB2YXIgcmVjb25uZWN0aW5nID0gZmFsc2U7XG5cbiAgICB2YXIgZm9yY2luZ0Rpc2Nvbm5lY3Rpb24gPSBmYWxzZTtcblxuICAgIHZhciB3cztcblxuICAgIGlmICh1c2VTb2NrSlMpIHtcbiAgICAgICAgd3MgPSBuZXcgU29ja0pTKHdzVXJpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICB3cyA9IG5ldyBXZWJTb2NrZXQod3NVcmkpO1xuICAgIH1cblxuICAgIHdzLm9ub3BlbiA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBsb2dDb25uZWN0ZWQod3MsIHdzVXJpKTtcbiAgICAgICAgaWYgKGNvbmZpZy5vbmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgY29uZmlnLm9uY29ubmVjdGVkKCk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgd3Mub25lcnJvciA9IGZ1bmN0aW9uKGVycm9yKSB7XG4gICAgICAgIExvZ2dlci5lcnJvcihcIkNvdWxkIG5vdCBjb25uZWN0IHRvIFwiICsgd3NVcmkgKyBcIiAoaW52b2tpbmcgb25lcnJvciBpZiBkZWZpbmVkKVwiLCBlcnJvcik7XG4gICAgICAgIGlmIChjb25maWcub25lcnJvcikge1xuICAgICAgICAgICAgY29uZmlnLm9uZXJyb3IoZXJyb3IpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIGZ1bmN0aW9uIGxvZ0Nvbm5lY3RlZCh3cywgd3NVcmkpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIExvZ2dlci5kZWJ1ZyhcIldlYlNvY2tldCBjb25uZWN0ZWQgdG8gXCIgKyB3c1VyaSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIExvZ2dlci5lcnJvcihlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHZhciByZWNvbm5lY3Rpb25PbkNsb3NlID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGlmICh3cy5yZWFkeVN0YXRlID09PSBDTE9TRUQpIHtcbiAgICAgICAgICAgIGlmIChjbG9zaW5nKSB7XG4gICAgICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKFwiQ29ubmVjdGlvbiBjbG9zZWQgYnkgdXNlclwiKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKFwiQ29ubmVjdGlvbiBjbG9zZWQgdW5leHBlY3RlY2x5LiBSZWNvbm5lY3RpbmcuLi5cIik7XG4gICAgICAgICAgICAgICAgcmVjb25uZWN0VG9TYW1lVXJpKE1BWF9SRVRSSUVTLCAxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIExvZ2dlci5kZWJ1ZyhcIkNsb3NlIGNhbGxiYWNrIGZyb20gcHJldmlvdXMgd2Vic29ja2V0LiBJZ25vcmluZyBpdFwiKTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICB3cy5vbmNsb3NlID0gcmVjb25uZWN0aW9uT25DbG9zZTtcblxuICAgIGZ1bmN0aW9uIHJlY29ubmVjdFRvU2FtZVVyaShtYXhSZXRyaWVzLCBudW1SZXRyaWVzKSB7XG4gICAgICAgIExvZ2dlci5kZWJ1ZyhcInJlY29ubmVjdFRvU2FtZVVyaSAoYXR0ZW1wdCAjXCIgKyBudW1SZXRyaWVzICsgXCIsIG1heD1cIiArIG1heFJldHJpZXMgKyBcIilcIik7XG5cbiAgICAgICAgaWYgKG51bVJldHJpZXMgPT09IDEpIHtcbiAgICAgICAgICAgIGlmIChyZWNvbm5lY3RpbmcpIHtcbiAgICAgICAgICAgICAgICBMb2dnZXIud2FybihcIlRyeWluZyB0byByZWNvbm5lY3RUb05ld1VyaSB3aGVuIHJlY29ubmVjdGluZy4uLiBJZ25vcmluZyB0aGlzIHJlY29ubmVjdGlvbi5cIilcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJlY29ubmVjdGluZyA9IHRydWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChjb25maWcub25yZWNvbm5lY3RpbmcpIHtcbiAgICAgICAgICAgICAgICBjb25maWcub25yZWNvbm5lY3RpbmcoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChmb3JjaW5nRGlzY29ubmVjdGlvbikge1xuICAgICAgICAgICAgcmVjb25uZWN0VG9OZXdVcmkobWF4UmV0cmllcywgbnVtUmV0cmllcywgd3NVcmkpO1xuXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpZiAoY29uZmlnLm5ld1dzVXJpT25SZWNvbm5lY3Rpb24pIHtcbiAgICAgICAgICAgICAgICBjb25maWcubmV3V3NVcmlPblJlY29ubmVjdGlvbihmdW5jdGlvbihlcnJvciwgbmV3V3NVcmkpIHtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIExvZ2dlci5kZWJ1ZyhlcnJvcik7XG4gICAgICAgICAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlY29ubmVjdFRvU2FtZVVyaShtYXhSZXRyaWVzLCBudW1SZXRyaWVzICsgMSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9LCBSRVRSWV9USU1FX01TKTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlY29ubmVjdFRvTmV3VXJpKG1heFJldHJpZXMsIG51bVJldHJpZXMsIG5ld1dzVXJpKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJlY29ubmVjdFRvTmV3VXJpKG1heFJldHJpZXMsIG51bVJldHJpZXMsIHdzVXJpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFRPRE8gVGVzdCByZXRyaWVzLiBIb3cgdG8gZm9yY2Ugbm90IGNvbm5lY3Rpb24/XG4gICAgZnVuY3Rpb24gcmVjb25uZWN0VG9OZXdVcmkobWF4UmV0cmllcywgbnVtUmV0cmllcywgcmVjb25uZWN0V3NVcmkpIHtcbiAgICAgICAgTG9nZ2VyLmRlYnVnKFwiUmVjb25uZWN0aW9uIGF0dGVtcHQgI1wiICsgbnVtUmV0cmllcyk7XG5cbiAgICAgICAgd3MuY2xvc2UoKTtcblxuICAgICAgICB3c1VyaSA9IHJlY29ubmVjdFdzVXJpIHx8IHdzVXJpO1xuXG4gICAgICAgIHZhciBuZXdXcztcbiAgICAgICAgaWYgKHVzZVNvY2tKUykge1xuICAgICAgICAgICAgbmV3V3MgPSBuZXcgU29ja0pTKHdzVXJpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG5ld1dzID0gbmV3IFdlYlNvY2tldCh3c1VyaSk7XG4gICAgICAgIH1cblxuICAgICAgICBuZXdXcy5vbm9wZW4gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIExvZ2dlci5kZWJ1ZyhcIlJlY29ubmVjdGVkIGFmdGVyIFwiICsgbnVtUmV0cmllcyArIFwiIGF0dGVtcHRzLi4uXCIpO1xuICAgICAgICAgICAgbG9nQ29ubmVjdGVkKG5ld1dzLCB3c1VyaSk7XG4gICAgICAgICAgICByZWNvbm5lY3RpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIHJlZ2lzdGVyTWVzc2FnZUhhbmRsZXIoKTtcbiAgICAgICAgICAgIGlmIChjb25maWcub25yZWNvbm5lY3RlZCgpKSB7XG4gICAgICAgICAgICAgICAgY29uZmlnLm9ucmVjb25uZWN0ZWQoKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgbmV3V3Mub25jbG9zZSA9IHJlY29ubmVjdGlvbk9uQ2xvc2U7XG4gICAgICAgIH07XG5cbiAgICAgICAgdmFyIG9uRXJyb3JPckNsb3NlID0gZnVuY3Rpb24oZXJyb3IpIHtcbiAgICAgICAgICAgIExvZ2dlci53YXJuKFwiUmVjb25uZWN0aW9uIGVycm9yOiBcIiwgZXJyb3IpO1xuXG4gICAgICAgICAgICBpZiAobnVtUmV0cmllcyA9PT0gbWF4UmV0cmllcykge1xuICAgICAgICAgICAgICAgIGlmIChjb25maWcub25kaXNjb25uZWN0KSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZy5vbmRpc2Nvbm5lY3QoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlY29ubmVjdFRvU2FtZVVyaShtYXhSZXRyaWVzLCBudW1SZXRyaWVzICsgMSk7XG4gICAgICAgICAgICAgICAgfSwgUkVUUllfVElNRV9NUyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgbmV3V3Mub25lcnJvciA9IG9uRXJyb3JPckNsb3NlO1xuXG4gICAgICAgIHdzID0gbmV3V3M7XG4gICAgfVxuXG4gICAgdGhpcy5jbG9zZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBjbG9zaW5nID0gdHJ1ZTtcbiAgICAgICAgd3MuY2xvc2UoKTtcbiAgICB9O1xuXG5cbiAgICAvLyBUaGlzIG1ldGhvZCBpcyBvbmx5IGZvciB0ZXN0aW5nXG4gICAgdGhpcy5mb3JjZUNsb3NlID0gZnVuY3Rpb24obWlsbGlzKSB7XG4gICAgICAgIExvZ2dlci5kZWJ1ZyhcIlRlc3Rpbmc6IEZvcmNlIFdlYlNvY2tldCBjbG9zZVwiKTtcblxuICAgICAgICBpZiAobWlsbGlzKSB7XG4gICAgICAgICAgICBMb2dnZXIuZGVidWcoXCJUZXN0aW5nOiBDaGFuZ2Ugd3NVcmkgZm9yIFwiICsgbWlsbGlzICsgXCIgbWlsbGlzIHRvIHNpbXVsYXRlIG5ldCBmYWlsdXJlXCIpO1xuICAgICAgICAgICAgdmFyIGdvb2RXc1VyaSA9IHdzVXJpO1xuICAgICAgICAgICAgd3NVcmkgPSBcIndzczovLzIxLjIzNC4xMi4zNC40OjQ0My9cIjtcblxuICAgICAgICAgICAgZm9yY2luZ0Rpc2Nvbm5lY3Rpb24gPSB0cnVlO1xuXG4gICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIExvZ2dlci5kZWJ1ZyhcIlRlc3Rpbmc6IFJlY292ZXIgZ29vZCB3c1VyaSBcIiArIGdvb2RXc1VyaSk7XG4gICAgICAgICAgICAgICAgd3NVcmkgPSBnb29kV3NVcmk7XG5cbiAgICAgICAgICAgICAgICBmb3JjaW5nRGlzY29ubmVjdGlvbiA9IGZhbHNlO1xuXG4gICAgICAgICAgICB9LCBtaWxsaXMpO1xuICAgICAgICB9XG5cbiAgICAgICAgd3MuY2xvc2UoKTtcbiAgICB9O1xuXG4gICAgdGhpcy5yZWNvbm5lY3RXcyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBMb2dnZXIuZGVidWcoXCJyZWNvbm5lY3RXc1wiKTtcbiAgICAgICAgcmVjb25uZWN0VG9TYW1lVXJpKE1BWF9SRVRSSUVTLCAxLCB3c1VyaSk7XG4gICAgfTtcblxuICAgIHRoaXMuc2VuZCA9IGZ1bmN0aW9uKG1lc3NhZ2UpIHtcbiAgICAgICAgd3Muc2VuZChtZXNzYWdlKTtcbiAgICB9O1xuXG4gICAgdGhpcy5hZGRFdmVudExpc3RlbmVyID0gZnVuY3Rpb24odHlwZSwgY2FsbGJhY2spIHtcbiAgICAgICAgcmVnaXN0ZXJNZXNzYWdlSGFuZGxlciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgd3MuYWRkRXZlbnRMaXN0ZW5lcih0eXBlLCBjYWxsYmFjayk7XG4gICAgICAgIH07XG5cbiAgICAgICAgcmVnaXN0ZXJNZXNzYWdlSGFuZGxlcigpO1xuICAgIH07XG59XG5cbm1vZHVsZS5leHBvcnRzID0gV2ViU29ja2V0V2l0aFJlY29ubmVjdGlvbjtcbiIsIi8qXG4gKiAoQykgQ29weXJpZ2h0IDIwMTQgS3VyZW50byAoaHR0cDovL2t1cmVudG8ub3JnLylcbiAqXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuICogeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4gKlxuICogICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICpcbiAqL1xuXG5cbnZhciBkZWZpbmVQcm9wZXJ0eV9JRTggPSBmYWxzZVxuaWYoT2JqZWN0LmRlZmluZVByb3BlcnR5KVxue1xuICB0cnlcbiAge1xuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh7fSwgXCJ4XCIsIHt9KTtcbiAgfVxuICBjYXRjaChlKVxuICB7XG4gICAgZGVmaW5lUHJvcGVydHlfSUU4ID0gdHJ1ZVxuICB9XG59XG5cbi8vIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0phdmFTY3JpcHQvUmVmZXJlbmNlL0dsb2JhbF9PYmplY3RzL0Z1bmN0aW9uL2JpbmRcbmlmICghRnVuY3Rpb24ucHJvdG90eXBlLmJpbmQpIHtcbiAgRnVuY3Rpb24ucHJvdG90eXBlLmJpbmQgPSBmdW5jdGlvbihvVGhpcykge1xuICAgIGlmICh0eXBlb2YgdGhpcyAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgLy8gY2xvc2VzdCB0aGluZyBwb3NzaWJsZSB0byB0aGUgRUNNQVNjcmlwdCA1XG4gICAgICAvLyBpbnRlcm5hbCBJc0NhbGxhYmxlIGZ1bmN0aW9uXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdGdW5jdGlvbi5wcm90b3R5cGUuYmluZCAtIHdoYXQgaXMgdHJ5aW5nIHRvIGJlIGJvdW5kIGlzIG5vdCBjYWxsYWJsZScpO1xuICAgIH1cblxuICAgIHZhciBhQXJncyAgID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKSxcbiAgICAgICAgZlRvQmluZCA9IHRoaXMsXG4gICAgICAgIGZOT1AgICAgPSBmdW5jdGlvbigpIHt9LFxuICAgICAgICBmQm91bmQgID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIGZUb0JpbmQuYXBwbHkodGhpcyBpbnN0YW5jZW9mIGZOT1AgJiYgb1RoaXNcbiAgICAgICAgICAgICAgICAgPyB0aGlzXG4gICAgICAgICAgICAgICAgIDogb1RoaXMsXG4gICAgICAgICAgICAgICAgIGFBcmdzLmNvbmNhdChBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpKSk7XG4gICAgICAgIH07XG5cbiAgICBmTk9QLnByb3RvdHlwZSA9IHRoaXMucHJvdG90eXBlO1xuICAgIGZCb3VuZC5wcm90b3R5cGUgPSBuZXcgZk5PUCgpO1xuXG4gICAgcmV0dXJuIGZCb3VuZDtcbiAgfTtcbn1cblxuXG52YXIgRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyO1xuXG52YXIgaW5oZXJpdHMgPSByZXF1aXJlKCdpbmhlcml0cycpO1xuXG52YXIgcGFja2VycyA9IHJlcXVpcmUoJy4vcGFja2VycycpO1xudmFyIE1hcHBlciA9IHJlcXVpcmUoJy4vTWFwcGVyJyk7XG5cblxudmFyIEJBU0VfVElNRU9VVCA9IDUwMDA7XG5cblxuZnVuY3Rpb24gdW5pZnlSZXNwb25zZU1ldGhvZHMocmVzcG9uc2VNZXRob2RzKVxue1xuICBpZighcmVzcG9uc2VNZXRob2RzKSByZXR1cm4ge307XG5cbiAgZm9yKHZhciBrZXkgaW4gcmVzcG9uc2VNZXRob2RzKVxuICB7XG4gICAgdmFyIHZhbHVlID0gcmVzcG9uc2VNZXRob2RzW2tleV07XG5cbiAgICBpZih0eXBlb2YgdmFsdWUgPT0gJ3N0cmluZycpXG4gICAgICByZXNwb25zZU1ldGhvZHNba2V5XSA9XG4gICAgICB7XG4gICAgICAgIHJlc3BvbnNlOiB2YWx1ZVxuICAgICAgfVxuICB9O1xuXG4gIHJldHVybiByZXNwb25zZU1ldGhvZHM7XG59O1xuXG5mdW5jdGlvbiB1bmlmeVRyYW5zcG9ydCh0cmFuc3BvcnQpXG57XG4gIGlmKCF0cmFuc3BvcnQpIHJldHVybjtcblxuICAvLyBUcmFuc3BvcnQgYXMgYSBmdW5jdGlvblxuICBpZih0cmFuc3BvcnQgaW5zdGFuY2VvZiBGdW5jdGlvbilcbiAgICByZXR1cm4ge3NlbmQ6IHRyYW5zcG9ydH07XG5cbiAgLy8gV2ViU29ja2V0ICYgRGF0YUNoYW5uZWxcbiAgaWYodHJhbnNwb3J0LnNlbmQgaW5zdGFuY2VvZiBGdW5jdGlvbilcbiAgICByZXR1cm4gdHJhbnNwb3J0O1xuXG4gIC8vIE1lc3NhZ2UgQVBJIChJbnRlci13aW5kb3cgJiBXZWJXb3JrZXIpXG4gIGlmKHRyYW5zcG9ydC5wb3N0TWVzc2FnZSBpbnN0YW5jZW9mIEZ1bmN0aW9uKVxuICB7XG4gICAgdHJhbnNwb3J0LnNlbmQgPSB0cmFuc3BvcnQucG9zdE1lc3NhZ2U7XG4gICAgcmV0dXJuIHRyYW5zcG9ydDtcbiAgfVxuXG4gIC8vIFN0cmVhbSBBUElcbiAgaWYodHJhbnNwb3J0LndyaXRlIGluc3RhbmNlb2YgRnVuY3Rpb24pXG4gIHtcbiAgICB0cmFuc3BvcnQuc2VuZCA9IHRyYW5zcG9ydC53cml0ZTtcbiAgICByZXR1cm4gdHJhbnNwb3J0O1xuICB9XG5cbiAgLy8gVHJhbnNwb3J0cyB0aGF0IG9ubHkgY2FuIHJlY2VpdmUgbWVzc2FnZXMsIGJ1dCBub3Qgc2VuZFxuICBpZih0cmFuc3BvcnQub25tZXNzYWdlICE9PSB1bmRlZmluZWQpIHJldHVybjtcbiAgaWYodHJhbnNwb3J0LnBhdXNlIGluc3RhbmNlb2YgRnVuY3Rpb24pIHJldHVybjtcblxuICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJUcmFuc3BvcnQgaXMgbm90IGEgZnVuY3Rpb24gbm9yIGEgdmFsaWQgb2JqZWN0XCIpO1xufTtcblxuXG4vKipcbiAqIFJlcHJlc2VudGF0aW9uIG9mIGEgUlBDIG5vdGlmaWNhdGlvblxuICpcbiAqIEBjbGFzc1xuICpcbiAqIEBjb25zdHJ1Y3RvclxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBtZXRob2QgLW1ldGhvZCBvZiB0aGUgbm90aWZpY2F0aW9uXG4gKiBAcGFyYW0gcGFyYW1zIC0gcGFyYW1ldGVycyBvZiB0aGUgbm90aWZpY2F0aW9uXG4gKi9cbmZ1bmN0aW9uIFJwY05vdGlmaWNhdGlvbihtZXRob2QsIHBhcmFtcylcbntcbiAgaWYoZGVmaW5lUHJvcGVydHlfSUU4KVxuICB7XG4gICAgdGhpcy5tZXRob2QgPSBtZXRob2RcbiAgICB0aGlzLnBhcmFtcyA9IHBhcmFtc1xuICB9XG4gIGVsc2VcbiAge1xuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0aGlzLCAnbWV0aG9kJywge3ZhbHVlOiBtZXRob2QsIGVudW1lcmFibGU6IHRydWV9KTtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ3BhcmFtcycsIHt2YWx1ZTogcGFyYW1zLCBlbnVtZXJhYmxlOiB0cnVlfSk7XG4gIH1cbn07XG5cblxuLyoqXG4gKiBAY2xhc3NcbiAqXG4gKiBAY29uc3RydWN0b3JcbiAqXG4gKiBAcGFyYW0ge29iamVjdH0gcGFja2VyXG4gKlxuICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXVxuICpcbiAqIEBwYXJhbSB7b2JqZWN0fSBbdHJhbnNwb3J0XVxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IFtvblJlcXVlc3RdXG4gKi9cbmZ1bmN0aW9uIFJwY0J1aWxkZXIocGFja2VyLCBvcHRpb25zLCB0cmFuc3BvcnQsIG9uUmVxdWVzdClcbntcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIGlmKCFwYWNrZXIpXG4gICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKCdQYWNrZXIgaXMgbm90IGRlZmluZWQnKTtcblxuICBpZighcGFja2VyLnBhY2sgfHwgIXBhY2tlci51bnBhY2spXG4gICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKCdQYWNrZXIgaXMgaW52YWxpZCcpO1xuXG4gIHZhciByZXNwb25zZU1ldGhvZHMgPSB1bmlmeVJlc3BvbnNlTWV0aG9kcyhwYWNrZXIucmVzcG9uc2VNZXRob2RzKTtcblxuXG4gIGlmKG9wdGlvbnMgaW5zdGFuY2VvZiBGdW5jdGlvbilcbiAge1xuICAgIGlmKHRyYW5zcG9ydCAhPSB1bmRlZmluZWQpXG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJUaGVyZSBjYW4ndCBiZSBwYXJhbWV0ZXJzIGFmdGVyIG9uUmVxdWVzdFwiKTtcblxuICAgIG9uUmVxdWVzdCA9IG9wdGlvbnM7XG4gICAgdHJhbnNwb3J0ID0gdW5kZWZpbmVkO1xuICAgIG9wdGlvbnMgICA9IHVuZGVmaW5lZDtcbiAgfTtcblxuICBpZihvcHRpb25zICYmIG9wdGlvbnMuc2VuZCBpbnN0YW5jZW9mIEZ1bmN0aW9uKVxuICB7XG4gICAgaWYodHJhbnNwb3J0ICYmICEodHJhbnNwb3J0IGluc3RhbmNlb2YgRnVuY3Rpb24pKVxuICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiT25seSBhIGZ1bmN0aW9uIGNhbiBiZSBhZnRlciB0cmFuc3BvcnRcIik7XG5cbiAgICBvblJlcXVlc3QgPSB0cmFuc3BvcnQ7XG4gICAgdHJhbnNwb3J0ID0gb3B0aW9ucztcbiAgICBvcHRpb25zICAgPSB1bmRlZmluZWQ7XG4gIH07XG5cbiAgaWYodHJhbnNwb3J0IGluc3RhbmNlb2YgRnVuY3Rpb24pXG4gIHtcbiAgICBpZihvblJlcXVlc3QgIT0gdW5kZWZpbmVkKVxuICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiVGhlcmUgY2FuJ3QgYmUgcGFyYW1ldGVycyBhZnRlciBvblJlcXVlc3RcIik7XG5cbiAgICBvblJlcXVlc3QgPSB0cmFuc3BvcnQ7XG4gICAgdHJhbnNwb3J0ID0gdW5kZWZpbmVkO1xuICB9O1xuXG4gIGlmKHRyYW5zcG9ydCAmJiB0cmFuc3BvcnQuc2VuZCBpbnN0YW5jZW9mIEZ1bmN0aW9uKVxuICAgIGlmKG9uUmVxdWVzdCAmJiAhKG9uUmVxdWVzdCBpbnN0YW5jZW9mIEZ1bmN0aW9uKSlcbiAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihcIk9ubHkgYSBmdW5jdGlvbiBjYW4gYmUgYWZ0ZXIgdHJhbnNwb3J0XCIpO1xuXG4gIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuXG5cbiAgRXZlbnRFbWl0dGVyLmNhbGwodGhpcyk7XG5cbiAgaWYob25SZXF1ZXN0KVxuICAgIHRoaXMub24oJ3JlcXVlc3QnLCBvblJlcXVlc3QpO1xuXG5cbiAgaWYoZGVmaW5lUHJvcGVydHlfSUU4KVxuICAgIHRoaXMucGVlcklEID0gb3B0aW9ucy5wZWVySURcbiAgZWxzZVxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0aGlzLCAncGVlcklEJywge3ZhbHVlOiBvcHRpb25zLnBlZXJJRH0pO1xuXG4gIHZhciBtYXhfcmV0cmllcyA9IG9wdGlvbnMubWF4X3JldHJpZXMgfHwgMDtcblxuXG4gIGZ1bmN0aW9uIHRyYW5zcG9ydE1lc3NhZ2UoZXZlbnQpXG4gIHtcbiAgICBzZWxmLmRlY29kZShldmVudC5kYXRhIHx8IGV2ZW50KTtcbiAgfTtcblxuICB0aGlzLmdldFRyYW5zcG9ydCA9IGZ1bmN0aW9uKClcbiAge1xuICAgIHJldHVybiB0cmFuc3BvcnQ7XG4gIH1cbiAgdGhpcy5zZXRUcmFuc3BvcnQgPSBmdW5jdGlvbih2YWx1ZSlcbiAge1xuICAgIC8vIFJlbW92ZSBsaXN0ZW5lciBmcm9tIG9sZCB0cmFuc3BvcnRcbiAgICBpZih0cmFuc3BvcnQpXG4gICAge1xuICAgICAgLy8gVzNDIHRyYW5zcG9ydHNcbiAgICAgIGlmKHRyYW5zcG9ydC5yZW1vdmVFdmVudExpc3RlbmVyKVxuICAgICAgICB0cmFuc3BvcnQucmVtb3ZlRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIHRyYW5zcG9ydE1lc3NhZ2UpO1xuXG4gICAgICAvLyBOb2RlLmpzIFN0cmVhbXMgQVBJXG4gICAgICBlbHNlIGlmKHRyYW5zcG9ydC5yZW1vdmVMaXN0ZW5lcilcbiAgICAgICAgdHJhbnNwb3J0LnJlbW92ZUxpc3RlbmVyKCdkYXRhJywgdHJhbnNwb3J0TWVzc2FnZSk7XG4gICAgfTtcblxuICAgIC8vIFNldCBsaXN0ZW5lciBvbiBuZXcgdHJhbnNwb3J0XG4gICAgaWYodmFsdWUpXG4gICAge1xuICAgICAgLy8gVzNDIHRyYW5zcG9ydHNcbiAgICAgIGlmKHZhbHVlLmFkZEV2ZW50TGlzdGVuZXIpXG4gICAgICAgIHZhbHVlLmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCB0cmFuc3BvcnRNZXNzYWdlKTtcblxuICAgICAgLy8gTm9kZS5qcyBTdHJlYW1zIEFQSVxuICAgICAgZWxzZSBpZih2YWx1ZS5hZGRMaXN0ZW5lcilcbiAgICAgICAgdmFsdWUuYWRkTGlzdGVuZXIoJ2RhdGEnLCB0cmFuc3BvcnRNZXNzYWdlKTtcbiAgICB9O1xuXG4gICAgdHJhbnNwb3J0ID0gdW5pZnlUcmFuc3BvcnQodmFsdWUpO1xuICB9XG5cbiAgaWYoIWRlZmluZVByb3BlcnR5X0lFOClcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ3RyYW5zcG9ydCcsXG4gICAge1xuICAgICAgZ2V0OiB0aGlzLmdldFRyYW5zcG9ydC5iaW5kKHRoaXMpLFxuICAgICAgc2V0OiB0aGlzLnNldFRyYW5zcG9ydC5iaW5kKHRoaXMpXG4gICAgfSlcblxuICB0aGlzLnNldFRyYW5zcG9ydCh0cmFuc3BvcnQpO1xuXG5cbiAgdmFyIHJlcXVlc3RfdGltZW91dCAgICAgID0gb3B0aW9ucy5yZXF1ZXN0X3RpbWVvdXQgICAgICB8fCBCQVNFX1RJTUVPVVQ7XG4gIHZhciBwaW5nX3JlcXVlc3RfdGltZW91dCA9IG9wdGlvbnMucGluZ19yZXF1ZXN0X3RpbWVvdXQgfHwgcmVxdWVzdF90aW1lb3V0O1xuICB2YXIgcmVzcG9uc2VfdGltZW91dCAgICAgPSBvcHRpb25zLnJlc3BvbnNlX3RpbWVvdXQgICAgIHx8IEJBU0VfVElNRU9VVDtcbiAgdmFyIGR1cGxpY2F0ZXNfdGltZW91dCAgID0gb3B0aW9ucy5kdXBsaWNhdGVzX3RpbWVvdXQgICB8fCBCQVNFX1RJTUVPVVQ7XG5cblxuICB2YXIgcmVxdWVzdElEID0gMDtcblxuICB2YXIgcmVxdWVzdHMgID0gbmV3IE1hcHBlcigpO1xuICB2YXIgcmVzcG9uc2VzID0gbmV3IE1hcHBlcigpO1xuICB2YXIgcHJvY2Vzc2VkUmVzcG9uc2VzID0gbmV3IE1hcHBlcigpO1xuXG4gIHZhciBtZXNzYWdlMktleSA9IHt9O1xuXG5cbiAgLyoqXG4gICAqIFN0b3JlIHRoZSByZXNwb25zZSB0byBwcmV2ZW50IHRvIHByb2Nlc3MgZHVwbGljYXRlIHJlcXVlc3QgbGF0ZXJcbiAgICovXG4gIGZ1bmN0aW9uIHN0b3JlUmVzcG9uc2UobWVzc2FnZSwgaWQsIGRlc3QpXG4gIHtcbiAgICB2YXIgcmVzcG9uc2UgPVxuICAgIHtcbiAgICAgIG1lc3NhZ2U6IG1lc3NhZ2UsXG4gICAgICAvKiogVGltZW91dCB0byBhdXRvLWNsZWFuIG9sZCByZXNwb25zZXMgKi9cbiAgICAgIHRpbWVvdXQ6IHNldFRpbWVvdXQoZnVuY3Rpb24oKVxuICAgICAge1xuICAgICAgICByZXNwb25zZXMucmVtb3ZlKGlkLCBkZXN0KTtcbiAgICAgIH0sXG4gICAgICByZXNwb25zZV90aW1lb3V0KVxuICAgIH07XG5cbiAgICByZXNwb25zZXMuc2V0KHJlc3BvbnNlLCBpZCwgZGVzdCk7XG4gIH07XG5cbiAgLyoqXG4gICAqIFN0b3JlIHRoZSByZXNwb25zZSB0byBpZ25vcmUgZHVwbGljYXRlZCBtZXNzYWdlcyBsYXRlclxuICAgKi9cbiAgZnVuY3Rpb24gc3RvcmVQcm9jZXNzZWRSZXNwb25zZShhY2ssIGZyb20pXG4gIHtcbiAgICB2YXIgdGltZW91dCA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKVxuICAgIHtcbiAgICAgIHByb2Nlc3NlZFJlc3BvbnNlcy5yZW1vdmUoYWNrLCBmcm9tKTtcbiAgICB9LFxuICAgIGR1cGxpY2F0ZXNfdGltZW91dCk7XG5cbiAgICBwcm9jZXNzZWRSZXNwb25zZXMuc2V0KHRpbWVvdXQsIGFjaywgZnJvbSk7XG4gIH07XG5cblxuICAvKipcbiAgICogUmVwcmVzZW50YXRpb24gb2YgYSBSUEMgcmVxdWVzdFxuICAgKlxuICAgKiBAY2xhc3NcbiAgICogQGV4dGVuZHMgUnBjTm90aWZpY2F0aW9uXG4gICAqXG4gICAqIEBjb25zdHJ1Y3RvclxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWV0aG9kIC1tZXRob2Qgb2YgdGhlIG5vdGlmaWNhdGlvblxuICAgKiBAcGFyYW0gcGFyYW1zIC0gcGFyYW1ldGVycyBvZiB0aGUgbm90aWZpY2F0aW9uXG4gICAqIEBwYXJhbSB7SW50ZWdlcn0gaWQgLSBpZGVudGlmaWVyIG9mIHRoZSByZXF1ZXN0XG4gICAqIEBwYXJhbSBbZnJvbV0gLSBzb3VyY2Ugb2YgdGhlIG5vdGlmaWNhdGlvblxuICAgKi9cbiAgZnVuY3Rpb24gUnBjUmVxdWVzdChtZXRob2QsIHBhcmFtcywgaWQsIGZyb20sIHRyYW5zcG9ydClcbiAge1xuICAgIFJwY05vdGlmaWNhdGlvbi5jYWxsKHRoaXMsIG1ldGhvZCwgcGFyYW1zKTtcblxuICAgIHRoaXMuZ2V0VHJhbnNwb3J0ID0gZnVuY3Rpb24oKVxuICAgIHtcbiAgICAgIHJldHVybiB0cmFuc3BvcnQ7XG4gICAgfVxuICAgIHRoaXMuc2V0VHJhbnNwb3J0ID0gZnVuY3Rpb24odmFsdWUpXG4gICAge1xuICAgICAgdHJhbnNwb3J0ID0gdW5pZnlUcmFuc3BvcnQodmFsdWUpO1xuICAgIH1cblxuICAgIGlmKCFkZWZpbmVQcm9wZXJ0eV9JRTgpXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ3RyYW5zcG9ydCcsXG4gICAgICB7XG4gICAgICAgIGdldDogdGhpcy5nZXRUcmFuc3BvcnQuYmluZCh0aGlzKSxcbiAgICAgICAgc2V0OiB0aGlzLnNldFRyYW5zcG9ydC5iaW5kKHRoaXMpXG4gICAgICB9KVxuXG4gICAgdmFyIHJlc3BvbnNlID0gcmVzcG9uc2VzLmdldChpZCwgZnJvbSk7XG5cbiAgICAvKipcbiAgICAgKiBAY29uc3RhbnQge0Jvb2xlYW59IGR1cGxpY2F0ZWRcbiAgICAgKi9cbiAgICBpZighKHRyYW5zcG9ydCB8fCBzZWxmLmdldFRyYW5zcG9ydCgpKSlcbiAgICB7XG4gICAgICBpZihkZWZpbmVQcm9wZXJ0eV9JRTgpXG4gICAgICAgIHRoaXMuZHVwbGljYXRlZCA9IEJvb2xlYW4ocmVzcG9uc2UpXG4gICAgICBlbHNlXG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0aGlzLCAnZHVwbGljYXRlZCcsXG4gICAgICAgIHtcbiAgICAgICAgICB2YWx1ZTogQm9vbGVhbihyZXNwb25zZSlcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgdmFyIHJlc3BvbnNlTWV0aG9kID0gcmVzcG9uc2VNZXRob2RzW21ldGhvZF07XG5cbiAgICB0aGlzLnBhY2sgPSBwYWNrZXIucGFjay5iaW5kKHBhY2tlciwgdGhpcywgaWQpXG5cbiAgICAvKipcbiAgICAgKiBHZW5lcmF0ZSBhIHJlc3BvbnNlIHRvIHRoaXMgcmVxdWVzdFxuICAgICAqXG4gICAgICogQHBhcmFtIHtFcnJvcn0gW2Vycm9yXVxuICAgICAqIEBwYXJhbSB7Kn0gW3Jlc3VsdF1cbiAgICAgKlxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9XG4gICAgICovXG4gICAgdGhpcy5yZXBseSA9IGZ1bmN0aW9uKGVycm9yLCByZXN1bHQsIHRyYW5zcG9ydClcbiAgICB7XG4gICAgICAvLyBGaXggb3B0aW9uYWwgcGFyYW1ldGVyc1xuICAgICAgaWYoZXJyb3IgaW5zdGFuY2VvZiBGdW5jdGlvbiB8fCBlcnJvciAmJiBlcnJvci5zZW5kIGluc3RhbmNlb2YgRnVuY3Rpb24pXG4gICAgICB7XG4gICAgICAgIGlmKHJlc3VsdCAhPSB1bmRlZmluZWQpXG4gICAgICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiVGhlcmUgY2FuJ3QgYmUgcGFyYW1ldGVycyBhZnRlciBjYWxsYmFja1wiKTtcblxuICAgICAgICB0cmFuc3BvcnQgPSBlcnJvcjtcbiAgICAgICAgcmVzdWx0ID0gbnVsbDtcbiAgICAgICAgZXJyb3IgPSB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGVsc2UgaWYocmVzdWx0IGluc3RhbmNlb2YgRnVuY3Rpb25cbiAgICAgIHx8IHJlc3VsdCAmJiByZXN1bHQuc2VuZCBpbnN0YW5jZW9mIEZ1bmN0aW9uKVxuICAgICAge1xuICAgICAgICBpZih0cmFuc3BvcnQgIT0gdW5kZWZpbmVkKVxuICAgICAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihcIlRoZXJlIGNhbid0IGJlIHBhcmFtZXRlcnMgYWZ0ZXIgY2FsbGJhY2tcIik7XG5cbiAgICAgICAgdHJhbnNwb3J0ID0gcmVzdWx0O1xuICAgICAgICByZXN1bHQgPSBudWxsO1xuICAgICAgfTtcblxuICAgICAgdHJhbnNwb3J0ID0gdW5pZnlUcmFuc3BvcnQodHJhbnNwb3J0KTtcblxuICAgICAgLy8gRHVwbGljYXRlZCByZXF1ZXN0LCByZW1vdmUgb2xkIHJlc3BvbnNlIHRpbWVvdXRcbiAgICAgIGlmKHJlc3BvbnNlKVxuICAgICAgICBjbGVhclRpbWVvdXQocmVzcG9uc2UudGltZW91dCk7XG5cbiAgICAgIGlmKGZyb20gIT0gdW5kZWZpbmVkKVxuICAgICAge1xuICAgICAgICBpZihlcnJvcilcbiAgICAgICAgICBlcnJvci5kZXN0ID0gZnJvbTtcblxuICAgICAgICBpZihyZXN1bHQpXG4gICAgICAgICAgcmVzdWx0LmRlc3QgPSBmcm9tO1xuICAgICAgfTtcblxuICAgICAgdmFyIG1lc3NhZ2U7XG5cbiAgICAgIC8vIE5ldyByZXF1ZXN0IG9yIG92ZXJyaWRlbiBvbmUsIGNyZWF0ZSBuZXcgcmVzcG9uc2Ugd2l0aCBwcm92aWRlZCBkYXRhXG4gICAgICBpZihlcnJvciB8fCByZXN1bHQgIT0gdW5kZWZpbmVkKVxuICAgICAge1xuICAgICAgICBpZihzZWxmLnBlZXJJRCAhPSB1bmRlZmluZWQpXG4gICAgICAgIHtcbiAgICAgICAgICBpZihlcnJvcilcbiAgICAgICAgICAgIGVycm9yLmZyb20gPSBzZWxmLnBlZXJJRDtcbiAgICAgICAgICBlbHNlXG4gICAgICAgICAgICByZXN1bHQuZnJvbSA9IHNlbGYucGVlcklEO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUHJvdG9jb2wgaW5kaWNhdGVzIHRoYXQgcmVzcG9uc2VzIGhhcyBvd24gcmVxdWVzdCBtZXRob2RzXG4gICAgICAgIGlmKHJlc3BvbnNlTWV0aG9kKVxuICAgICAgICB7XG4gICAgICAgICAgaWYocmVzcG9uc2VNZXRob2QuZXJyb3IgPT0gdW5kZWZpbmVkICYmIGVycm9yKVxuICAgICAgICAgICAgbWVzc2FnZSA9XG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGVycm9yOiBlcnJvclxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgIGVsc2VcbiAgICAgICAgICB7XG4gICAgICAgICAgICB2YXIgbWV0aG9kID0gZXJyb3JcbiAgICAgICAgICAgICAgICAgICAgICAgPyByZXNwb25zZU1ldGhvZC5lcnJvclxuICAgICAgICAgICAgICAgICAgICAgICA6IHJlc3BvbnNlTWV0aG9kLnJlc3BvbnNlO1xuXG4gICAgICAgICAgICBtZXNzYWdlID1cbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgbWV0aG9kOiBtZXRob2QsXG4gICAgICAgICAgICAgIHBhcmFtczogZXJyb3IgfHwgcmVzdWx0XG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBlbHNlXG4gICAgICAgICAgbWVzc2FnZSA9XG4gICAgICAgICAge1xuICAgICAgICAgICAgZXJyb3I6ICBlcnJvcixcbiAgICAgICAgICAgIHJlc3VsdDogcmVzdWx0XG4gICAgICAgICAgfTtcblxuICAgICAgICBtZXNzYWdlID0gcGFja2VyLnBhY2sobWVzc2FnZSwgaWQpO1xuICAgICAgfVxuXG4gICAgICAvLyBEdXBsaWNhdGUgJiBub3Qtb3ZlcnJpZGVuIHJlcXVlc3QsIHJlLXNlbmQgb2xkIHJlc3BvbnNlXG4gICAgICBlbHNlIGlmKHJlc3BvbnNlKVxuICAgICAgICBtZXNzYWdlID0gcmVzcG9uc2UubWVzc2FnZTtcblxuICAgICAgLy8gTmV3IGVtcHR5IHJlcGx5LCByZXNwb25zZSBudWxsIHZhbHVlXG4gICAgICBlbHNlXG4gICAgICAgIG1lc3NhZ2UgPSBwYWNrZXIucGFjayh7cmVzdWx0OiBudWxsfSwgaWQpO1xuXG4gICAgICAvLyBTdG9yZSB0aGUgcmVzcG9uc2UgdG8gcHJldmVudCB0byBwcm9jZXNzIGEgZHVwbGljYXRlZCByZXF1ZXN0IGxhdGVyXG4gICAgICBzdG9yZVJlc3BvbnNlKG1lc3NhZ2UsIGlkLCBmcm9tKTtcblxuICAgICAgLy8gUmV0dXJuIHRoZSBzdG9yZWQgcmVzcG9uc2Ugc28gaXQgY2FuIGJlIGRpcmVjdGx5IHNlbmQgYmFja1xuICAgICAgdHJhbnNwb3J0ID0gdHJhbnNwb3J0IHx8IHRoaXMuZ2V0VHJhbnNwb3J0KCkgfHwgc2VsZi5nZXRUcmFuc3BvcnQoKTtcblxuICAgICAgaWYodHJhbnNwb3J0KVxuICAgICAgICByZXR1cm4gdHJhbnNwb3J0LnNlbmQobWVzc2FnZSk7XG5cbiAgICAgIHJldHVybiBtZXNzYWdlO1xuICAgIH1cbiAgfTtcbiAgaW5oZXJpdHMoUnBjUmVxdWVzdCwgUnBjTm90aWZpY2F0aW9uKTtcblxuXG4gIGZ1bmN0aW9uIGNhbmNlbChtZXNzYWdlKVxuICB7XG4gICAgdmFyIGtleSA9IG1lc3NhZ2UyS2V5W21lc3NhZ2VdO1xuICAgIGlmKCFrZXkpIHJldHVybjtcblxuICAgIGRlbGV0ZSBtZXNzYWdlMktleVttZXNzYWdlXTtcblxuICAgIHZhciByZXF1ZXN0ID0gcmVxdWVzdHMucG9wKGtleS5pZCwga2V5LmRlc3QpO1xuICAgIGlmKCFyZXF1ZXN0KSByZXR1cm47XG5cbiAgICBjbGVhclRpbWVvdXQocmVxdWVzdC50aW1lb3V0KTtcblxuICAgIC8vIFN0YXJ0IGR1cGxpY2F0ZWQgcmVzcG9uc2VzIHRpbWVvdXRcbiAgICBzdG9yZVByb2Nlc3NlZFJlc3BvbnNlKGtleS5pZCwga2V5LmRlc3QpO1xuICB9O1xuXG4gIC8qKlxuICAgKiBBbGxvdyB0byBjYW5jZWwgYSByZXF1ZXN0IGFuZCBkb24ndCB3YWl0IGZvciBhIHJlc3BvbnNlXG4gICAqXG4gICAqIElmIGBtZXNzYWdlYCBpcyBub3QgZ2l2ZW4sIGNhbmNlbCBhbGwgdGhlIHJlcXVlc3RcbiAgICovXG4gIHRoaXMuY2FuY2VsID0gZnVuY3Rpb24obWVzc2FnZSlcbiAge1xuICAgIGlmKG1lc3NhZ2UpIHJldHVybiBjYW5jZWwobWVzc2FnZSk7XG5cbiAgICBmb3IodmFyIG1lc3NhZ2UgaW4gbWVzc2FnZTJLZXkpXG4gICAgICBjYW5jZWwobWVzc2FnZSk7XG4gIH07XG5cblxuICB0aGlzLmNsb3NlID0gZnVuY3Rpb24oKVxuICB7XG4gICAgLy8gUHJldmVudCB0byByZWNlaXZlIG5ldyBtZXNzYWdlc1xuICAgIHZhciB0cmFuc3BvcnQgPSB0aGlzLmdldFRyYW5zcG9ydCgpO1xuICAgIGlmKHRyYW5zcG9ydCAmJiB0cmFuc3BvcnQuY2xvc2UpXG4gICAgICAgdHJhbnNwb3J0LmNsb3NlKCk7XG5cbiAgICAvLyBSZXF1ZXN0ICYgcHJvY2Vzc2VkIHJlc3BvbnNlc1xuICAgIHRoaXMuY2FuY2VsKCk7XG5cbiAgICBwcm9jZXNzZWRSZXNwb25zZXMuZm9yRWFjaChjbGVhclRpbWVvdXQpO1xuXG4gICAgLy8gUmVzcG9uc2VzXG4gICAgcmVzcG9uc2VzLmZvckVhY2goZnVuY3Rpb24ocmVzcG9uc2UpXG4gICAge1xuICAgICAgY2xlYXJUaW1lb3V0KHJlc3BvbnNlLnRpbWVvdXQpO1xuICAgIH0pO1xuICB9O1xuXG5cbiAgLyoqXG4gICAqIEdlbmVyYXRlcyBhbmQgZW5jb2RlIGEgSnNvblJQQyAyLjAgbWVzc2FnZVxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gbWV0aG9kIC1tZXRob2Qgb2YgdGhlIG5vdGlmaWNhdGlvblxuICAgKiBAcGFyYW0gcGFyYW1zIC0gcGFyYW1ldGVycyBvZiB0aGUgbm90aWZpY2F0aW9uXG4gICAqIEBwYXJhbSBbZGVzdF0gLSBkZXN0aW5hdGlvbiBvZiB0aGUgbm90aWZpY2F0aW9uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbdHJhbnNwb3J0XSAtIHRyYW5zcG9ydCB3aGVyZSB0byBzZW5kIHRoZSBtZXNzYWdlXG4gICAqIEBwYXJhbSBbY2FsbGJhY2tdIC0gZnVuY3Rpb24gY2FsbGVkIHdoZW4gYSByZXNwb25zZSB0byB0aGlzIHJlcXVlc3QgaXNcbiAgICogICByZWNlaXZlZC4gSWYgbm90IGRlZmluZWQsIGEgbm90aWZpY2F0aW9uIHdpbGwgYmUgc2VuZCBpbnN0ZWFkXG4gICAqXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IEEgcmF3IEpzb25SUEMgMi4wIHJlcXVlc3Qgb3Igbm90aWZpY2F0aW9uIHN0cmluZ1xuICAgKi9cbiAgdGhpcy5lbmNvZGUgPSBmdW5jdGlvbihtZXRob2QsIHBhcmFtcywgZGVzdCwgdHJhbnNwb3J0LCBjYWxsYmFjaylcbiAge1xuICAgIC8vIEZpeCBvcHRpb25hbCBwYXJhbWV0ZXJzXG4gICAgaWYocGFyYW1zIGluc3RhbmNlb2YgRnVuY3Rpb24pXG4gICAge1xuICAgICAgaWYoZGVzdCAhPSB1bmRlZmluZWQpXG4gICAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihcIlRoZXJlIGNhbid0IGJlIHBhcmFtZXRlcnMgYWZ0ZXIgY2FsbGJhY2tcIik7XG5cbiAgICAgIGNhbGxiYWNrICA9IHBhcmFtcztcbiAgICAgIHRyYW5zcG9ydCA9IHVuZGVmaW5lZDtcbiAgICAgIGRlc3QgICAgICA9IHVuZGVmaW5lZDtcbiAgICAgIHBhcmFtcyAgICA9IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBlbHNlIGlmKGRlc3QgaW5zdGFuY2VvZiBGdW5jdGlvbilcbiAgICB7XG4gICAgICBpZih0cmFuc3BvcnQgIT0gdW5kZWZpbmVkKVxuICAgICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJUaGVyZSBjYW4ndCBiZSBwYXJhbWV0ZXJzIGFmdGVyIGNhbGxiYWNrXCIpO1xuXG4gICAgICBjYWxsYmFjayAgPSBkZXN0O1xuICAgICAgdHJhbnNwb3J0ID0gdW5kZWZpbmVkO1xuICAgICAgZGVzdCAgICAgID0gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIGVsc2UgaWYodHJhbnNwb3J0IGluc3RhbmNlb2YgRnVuY3Rpb24pXG4gICAge1xuICAgICAgaWYoY2FsbGJhY2sgIT0gdW5kZWZpbmVkKVxuICAgICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJUaGVyZSBjYW4ndCBiZSBwYXJhbWV0ZXJzIGFmdGVyIGNhbGxiYWNrXCIpO1xuXG4gICAgICBjYWxsYmFjayAgPSB0cmFuc3BvcnQ7XG4gICAgICB0cmFuc3BvcnQgPSB1bmRlZmluZWQ7XG4gICAgfTtcblxuICAgIGlmKHNlbGYucGVlcklEICE9IHVuZGVmaW5lZClcbiAgICB7XG4gICAgICBwYXJhbXMgPSBwYXJhbXMgfHwge307XG5cbiAgICAgIHBhcmFtcy5mcm9tID0gc2VsZi5wZWVySUQ7XG4gICAgfTtcblxuICAgIGlmKGRlc3QgIT0gdW5kZWZpbmVkKVxuICAgIHtcbiAgICAgIHBhcmFtcyA9IHBhcmFtcyB8fCB7fTtcblxuICAgICAgcGFyYW1zLmRlc3QgPSBkZXN0O1xuICAgIH07XG5cbiAgICAvLyBFbmNvZGUgbWVzc2FnZVxuICAgIHZhciBtZXNzYWdlID1cbiAgICB7XG4gICAgICBtZXRob2Q6IG1ldGhvZCxcbiAgICAgIHBhcmFtczogcGFyYW1zXG4gICAgfTtcblxuICAgIGlmKGNhbGxiYWNrKVxuICAgIHtcbiAgICAgIHZhciBpZCA9IHJlcXVlc3RJRCsrO1xuICAgICAgdmFyIHJldHJpZWQgPSAwO1xuXG4gICAgICBtZXNzYWdlID0gcGFja2VyLnBhY2sobWVzc2FnZSwgaWQpO1xuXG4gICAgICBmdW5jdGlvbiBkaXNwYXRjaENhbGxiYWNrKGVycm9yLCByZXN1bHQpXG4gICAgICB7XG4gICAgICAgIHNlbGYuY2FuY2VsKG1lc3NhZ2UpO1xuXG4gICAgICAgIGNhbGxiYWNrKGVycm9yLCByZXN1bHQpO1xuICAgICAgfTtcblxuICAgICAgdmFyIHJlcXVlc3QgPVxuICAgICAge1xuICAgICAgICBtZXNzYWdlOiAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgIGNhbGxiYWNrOiAgICAgICAgZGlzcGF0Y2hDYWxsYmFjayxcbiAgICAgICAgcmVzcG9uc2VNZXRob2RzOiByZXNwb25zZU1ldGhvZHNbbWV0aG9kXSB8fCB7fVxuICAgICAgfTtcblxuICAgICAgdmFyIGVuY29kZV90cmFuc3BvcnQgPSB1bmlmeVRyYW5zcG9ydCh0cmFuc3BvcnQpO1xuXG4gICAgICBmdW5jdGlvbiBzZW5kUmVxdWVzdCh0cmFuc3BvcnQpXG4gICAgICB7XG4gICAgICAgIHZhciBydCA9IChtZXRob2QgPT09ICdwaW5nJyA/IHBpbmdfcmVxdWVzdF90aW1lb3V0IDogcmVxdWVzdF90aW1lb3V0KTtcbiAgICAgICAgcmVxdWVzdC50aW1lb3V0ID0gc2V0VGltZW91dCh0aW1lb3V0LCBydCpNYXRoLnBvdygyLCByZXRyaWVkKyspKTtcbiAgICAgICAgbWVzc2FnZTJLZXlbbWVzc2FnZV0gPSB7aWQ6IGlkLCBkZXN0OiBkZXN0fTtcbiAgICAgICAgcmVxdWVzdHMuc2V0KHJlcXVlc3QsIGlkLCBkZXN0KTtcblxuICAgICAgICB0cmFuc3BvcnQgPSB0cmFuc3BvcnQgfHwgZW5jb2RlX3RyYW5zcG9ydCB8fCBzZWxmLmdldFRyYW5zcG9ydCgpO1xuICAgICAgICBpZih0cmFuc3BvcnQpXG4gICAgICAgICAgcmV0dXJuIHRyYW5zcG9ydC5zZW5kKG1lc3NhZ2UpO1xuXG4gICAgICAgIHJldHVybiBtZXNzYWdlO1xuICAgICAgfTtcblxuICAgICAgZnVuY3Rpb24gcmV0cnkodHJhbnNwb3J0KVxuICAgICAge1xuICAgICAgICB0cmFuc3BvcnQgPSB1bmlmeVRyYW5zcG9ydCh0cmFuc3BvcnQpO1xuXG4gICAgICAgIGNvbnNvbGUud2FybihyZXRyaWVkKycgcmV0cnkgZm9yIHJlcXVlc3QgbWVzc2FnZTonLG1lc3NhZ2UpO1xuXG4gICAgICAgIHZhciB0aW1lb3V0ID0gcHJvY2Vzc2VkUmVzcG9uc2VzLnBvcChpZCwgZGVzdCk7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcblxuICAgICAgICByZXR1cm4gc2VuZFJlcXVlc3QodHJhbnNwb3J0KTtcbiAgICAgIH07XG5cbiAgICAgIGZ1bmN0aW9uIHRpbWVvdXQoKVxuICAgICAge1xuICAgICAgICBpZihyZXRyaWVkIDwgbWF4X3JldHJpZXMpXG4gICAgICAgICAgcmV0dXJuIHJldHJ5KHRyYW5zcG9ydCk7XG5cbiAgICAgICAgdmFyIGVycm9yID0gbmV3IEVycm9yKCdSZXF1ZXN0IGhhcyB0aW1lZCBvdXQnKTtcbiAgICAgICAgICAgIGVycm9yLnJlcXVlc3QgPSBtZXNzYWdlO1xuXG4gICAgICAgIGVycm9yLnJldHJ5ID0gcmV0cnk7XG5cbiAgICAgICAgZGlzcGF0Y2hDYWxsYmFjayhlcnJvcilcbiAgICAgIH07XG5cbiAgICAgIHJldHVybiBzZW5kUmVxdWVzdCh0cmFuc3BvcnQpO1xuICAgIH07XG5cbiAgICAvLyBSZXR1cm4gdGhlIHBhY2tlZCBtZXNzYWdlXG4gICAgbWVzc2FnZSA9IHBhY2tlci5wYWNrKG1lc3NhZ2UpO1xuXG4gICAgdHJhbnNwb3J0ID0gdHJhbnNwb3J0IHx8IHRoaXMuZ2V0VHJhbnNwb3J0KCk7XG4gICAgaWYodHJhbnNwb3J0KVxuICAgICAgcmV0dXJuIHRyYW5zcG9ydC5zZW5kKG1lc3NhZ2UpO1xuXG4gICAgcmV0dXJuIG1lc3NhZ2U7XG4gIH07XG5cbiAgLyoqXG4gICAqIERlY29kZSBhbmQgcHJvY2VzcyBhIEpzb25SUEMgMi4wIG1lc3NhZ2VcbiAgICpcbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBzdHJpbmcgd2l0aCB0aGUgY29udGVudCBvZiB0aGUgbWVzc2FnZVxuICAgKlxuICAgKiBAcmV0dXJucyB7UnBjTm90aWZpY2F0aW9ufFJwY1JlcXVlc3R8dW5kZWZpbmVkfSAtIHRoZSByZXByZXNlbnRhdGlvbiBvZiB0aGVcbiAgICogICBub3RpZmljYXRpb24gb3IgdGhlIHJlcXVlc3QuIElmIGEgcmVzcG9uc2Ugd2FzIHByb2Nlc3NlZCwgaXQgd2lsbCByZXR1cm5cbiAgICogICBgdW5kZWZpbmVkYCB0byBub3RpZnkgdGhhdCBpdCB3YXMgcHJvY2Vzc2VkXG4gICAqXG4gICAqIEB0aHJvd3Mge1R5cGVFcnJvcn0gLSBNZXNzYWdlIGlzIG5vdCBkZWZpbmVkXG4gICAqL1xuICB0aGlzLmRlY29kZSA9IGZ1bmN0aW9uKG1lc3NhZ2UsIHRyYW5zcG9ydClcbiAge1xuICAgIGlmKCFtZXNzYWdlKVxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk1lc3NhZ2UgaXMgbm90IGRlZmluZWRcIik7XG5cbiAgICB0cnlcbiAgICB7XG4gICAgICBtZXNzYWdlID0gcGFja2VyLnVucGFjayhtZXNzYWdlKTtcbiAgICB9XG4gICAgY2F0Y2goZSlcbiAgICB7XG4gICAgICAvLyBJZ25vcmUgaW52YWxpZCBtZXNzYWdlc1xuICAgICAgcmV0dXJuIGNvbnNvbGUuZGVidWcoZSwgbWVzc2FnZSk7XG4gICAgfTtcblxuICAgIHZhciBpZCAgICAgPSBtZXNzYWdlLmlkO1xuICAgIHZhciBhY2sgICAgPSBtZXNzYWdlLmFjaztcbiAgICB2YXIgbWV0aG9kID0gbWVzc2FnZS5tZXRob2Q7XG4gICAgdmFyIHBhcmFtcyA9IG1lc3NhZ2UucGFyYW1zIHx8IHt9O1xuXG4gICAgdmFyIGZyb20gPSBwYXJhbXMuZnJvbTtcbiAgICB2YXIgZGVzdCA9IHBhcmFtcy5kZXN0O1xuXG4gICAgLy8gSWdub3JlIG1lc3NhZ2VzIHNlbmQgYnkgdXNcbiAgICBpZihzZWxmLnBlZXJJRCAhPSB1bmRlZmluZWQgJiYgZnJvbSA9PSBzZWxmLnBlZXJJRCkgcmV0dXJuO1xuXG4gICAgLy8gTm90aWZpY2F0aW9uXG4gICAgaWYoaWQgPT0gdW5kZWZpbmVkICYmIGFjayA9PSB1bmRlZmluZWQpXG4gICAge1xuICAgICAgdmFyIG5vdGlmaWNhdGlvbiA9IG5ldyBScGNOb3RpZmljYXRpb24obWV0aG9kLCBwYXJhbXMpO1xuXG4gICAgICBpZihzZWxmLmVtaXQoJ3JlcXVlc3QnLCBub3RpZmljYXRpb24pKSByZXR1cm47XG4gICAgICByZXR1cm4gbm90aWZpY2F0aW9uO1xuICAgIH07XG5cblxuICAgIGZ1bmN0aW9uIHByb2Nlc3NSZXF1ZXN0KClcbiAgICB7XG4gICAgICAvLyBJZiB3ZSBoYXZlIGEgdHJhbnNwb3J0IGFuZCBpdCdzIGEgZHVwbGljYXRlZCByZXF1ZXN0LCByZXBseSBpbm1lZGlhdGx5XG4gICAgICB0cmFuc3BvcnQgPSB1bmlmeVRyYW5zcG9ydCh0cmFuc3BvcnQpIHx8IHNlbGYuZ2V0VHJhbnNwb3J0KCk7XG4gICAgICBpZih0cmFuc3BvcnQpXG4gICAgICB7XG4gICAgICAgIHZhciByZXNwb25zZSA9IHJlc3BvbnNlcy5nZXQoaWQsIGZyb20pO1xuICAgICAgICBpZihyZXNwb25zZSlcbiAgICAgICAgICByZXR1cm4gdHJhbnNwb3J0LnNlbmQocmVzcG9uc2UubWVzc2FnZSk7XG4gICAgICB9O1xuXG4gICAgICB2YXIgaWRBY2sgPSAoaWQgIT0gdW5kZWZpbmVkKSA/IGlkIDogYWNrO1xuICAgICAgdmFyIHJlcXVlc3QgPSBuZXcgUnBjUmVxdWVzdChtZXRob2QsIHBhcmFtcywgaWRBY2ssIGZyb20sIHRyYW5zcG9ydCk7XG5cbiAgICAgIGlmKHNlbGYuZW1pdCgncmVxdWVzdCcsIHJlcXVlc3QpKSByZXR1cm47XG4gICAgICByZXR1cm4gcmVxdWVzdDtcbiAgICB9O1xuXG4gICAgZnVuY3Rpb24gcHJvY2Vzc1Jlc3BvbnNlKHJlcXVlc3QsIGVycm9yLCByZXN1bHQpXG4gICAge1xuICAgICAgcmVxdWVzdC5jYWxsYmFjayhlcnJvciwgcmVzdWx0KTtcbiAgICB9O1xuXG4gICAgZnVuY3Rpb24gZHVwbGljYXRlZFJlc3BvbnNlKHRpbWVvdXQpXG4gICAge1xuICAgICAgY29uc29sZS53YXJuKFwiUmVzcG9uc2UgYWxyZWFkeSBwcm9jZXNzZWRcIiwgbWVzc2FnZSk7XG5cbiAgICAgIC8vIFVwZGF0ZSBkdXBsaWNhdGVkIHJlc3BvbnNlcyB0aW1lb3V0XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICBzdG9yZVByb2Nlc3NlZFJlc3BvbnNlKGFjaywgZnJvbSk7XG4gICAgfTtcblxuXG4gICAgLy8gUmVxdWVzdCwgb3IgcmVzcG9uc2Ugd2l0aCBvd24gbWV0aG9kXG4gICAgaWYobWV0aG9kKVxuICAgIHtcbiAgICAgIC8vIENoZWNrIGlmIGl0J3MgYSByZXNwb25zZSB3aXRoIG93biBtZXRob2RcbiAgICAgIGlmKGRlc3QgPT0gdW5kZWZpbmVkIHx8IGRlc3QgPT0gc2VsZi5wZWVySUQpXG4gICAgICB7XG4gICAgICAgIHZhciByZXF1ZXN0ID0gcmVxdWVzdHMuZ2V0KGFjaywgZnJvbSk7XG4gICAgICAgIGlmKHJlcXVlc3QpXG4gICAgICAgIHtcbiAgICAgICAgICB2YXIgcmVzcG9uc2VNZXRob2RzID0gcmVxdWVzdC5yZXNwb25zZU1ldGhvZHM7XG5cbiAgICAgICAgICBpZihtZXRob2QgPT0gcmVzcG9uc2VNZXRob2RzLmVycm9yKVxuICAgICAgICAgICAgcmV0dXJuIHByb2Nlc3NSZXNwb25zZShyZXF1ZXN0LCBwYXJhbXMpO1xuXG4gICAgICAgICAgaWYobWV0aG9kID09IHJlc3BvbnNlTWV0aG9kcy5yZXNwb25zZSlcbiAgICAgICAgICAgIHJldHVybiBwcm9jZXNzUmVzcG9uc2UocmVxdWVzdCwgbnVsbCwgcGFyYW1zKTtcblxuICAgICAgICAgIHJldHVybiBwcm9jZXNzUmVxdWVzdCgpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHByb2Nlc3NlZCA9IHByb2Nlc3NlZFJlc3BvbnNlcy5nZXQoYWNrLCBmcm9tKTtcbiAgICAgICAgaWYocHJvY2Vzc2VkKVxuICAgICAgICAgIHJldHVybiBkdXBsaWNhdGVkUmVzcG9uc2UocHJvY2Vzc2VkKTtcbiAgICAgIH1cblxuICAgICAgLy8gUmVxdWVzdFxuICAgICAgcmV0dXJuIHByb2Nlc3NSZXF1ZXN0KCk7XG4gICAgfTtcblxuICAgIHZhciBlcnJvciAgPSBtZXNzYWdlLmVycm9yO1xuICAgIHZhciByZXN1bHQgPSBtZXNzYWdlLnJlc3VsdDtcblxuICAgIC8vIElnbm9yZSByZXNwb25zZXMgbm90IHNlbmQgdG8gdXNcbiAgICBpZihlcnJvciAgJiYgZXJyb3IuZGVzdCAgJiYgZXJyb3IuZGVzdCAgIT0gc2VsZi5wZWVySUQpIHJldHVybjtcbiAgICBpZihyZXN1bHQgJiYgcmVzdWx0LmRlc3QgJiYgcmVzdWx0LmRlc3QgIT0gc2VsZi5wZWVySUQpIHJldHVybjtcblxuICAgIC8vIFJlc3BvbnNlXG4gICAgdmFyIHJlcXVlc3QgPSByZXF1ZXN0cy5nZXQoYWNrLCBmcm9tKTtcbiAgICBpZighcmVxdWVzdClcbiAgICB7XG4gICAgICB2YXIgcHJvY2Vzc2VkID0gcHJvY2Vzc2VkUmVzcG9uc2VzLmdldChhY2ssIGZyb20pO1xuICAgICAgaWYocHJvY2Vzc2VkKVxuICAgICAgICByZXR1cm4gZHVwbGljYXRlZFJlc3BvbnNlKHByb2Nlc3NlZCk7XG5cbiAgICAgIHJldHVybiBjb25zb2xlLndhcm4oXCJObyBjYWxsYmFjayB3YXMgZGVmaW5lZCBmb3IgdGhpcyBtZXNzYWdlXCIsIG1lc3NhZ2UpO1xuICAgIH07XG5cbiAgICAvLyBQcm9jZXNzIHJlc3BvbnNlXG4gICAgcHJvY2Vzc1Jlc3BvbnNlKHJlcXVlc3QsIGVycm9yLCByZXN1bHQpO1xuICB9O1xufTtcbmluaGVyaXRzKFJwY0J1aWxkZXIsIEV2ZW50RW1pdHRlcik7XG5cblxuUnBjQnVpbGRlci5ScGNOb3RpZmljYXRpb24gPSBScGNOb3RpZmljYXRpb247XG5cblxubW9kdWxlLmV4cG9ydHMgPSBScGNCdWlsZGVyO1xuXG52YXIgY2xpZW50cyA9IHJlcXVpcmUoJy4vY2xpZW50cycpO1xudmFyIHRyYW5zcG9ydHMgPSByZXF1aXJlKCcuL2NsaWVudHMvdHJhbnNwb3J0cycpO1xuXG5ScGNCdWlsZGVyLmNsaWVudHMgPSBjbGllbnRzO1xuUnBjQnVpbGRlci5jbGllbnRzLnRyYW5zcG9ydHMgPSB0cmFuc3BvcnRzO1xuUnBjQnVpbGRlci5wYWNrZXJzID0gcGFja2VycztcbiIsIi8qKlxuICogSnNvblJQQyAyLjAgcGFja2VyXG4gKi9cblxuLyoqXG4gKiBQYWNrIGEgSnNvblJQQyAyLjAgbWVzc2FnZVxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBtZXNzYWdlIC0gb2JqZWN0IHRvIGJlIHBhY2thZ2VkLiBJdCByZXF1aXJlcyB0byBoYXZlIGFsbCB0aGVcbiAqICAgZmllbGRzIG5lZWRlZCBieSB0aGUgSnNvblJQQyAyLjAgbWVzc2FnZSB0aGF0IGl0J3MgZ29pbmcgdG8gYmUgZ2VuZXJhdGVkXG4gKlxuICogQHJldHVybiB7U3RyaW5nfSAtIHRoZSBzdHJpbmdpZmllZCBKc29uUlBDIDIuMCBtZXNzYWdlXG4gKi9cbmZ1bmN0aW9uIHBhY2sobWVzc2FnZSwgaWQpXG57XG4gIHZhciByZXN1bHQgPVxuICB7XG4gICAganNvbnJwYzogXCIyLjBcIlxuICB9O1xuXG4gIC8vIFJlcXVlc3RcbiAgaWYobWVzc2FnZS5tZXRob2QpXG4gIHtcbiAgICByZXN1bHQubWV0aG9kID0gbWVzc2FnZS5tZXRob2Q7XG5cbiAgICBpZihtZXNzYWdlLnBhcmFtcylcbiAgICAgIHJlc3VsdC5wYXJhbXMgPSBtZXNzYWdlLnBhcmFtcztcblxuICAgIC8vIFJlcXVlc3QgaXMgYSBub3RpZmljYXRpb25cbiAgICBpZihpZCAhPSB1bmRlZmluZWQpXG4gICAgICByZXN1bHQuaWQgPSBpZDtcbiAgfVxuXG4gIC8vIFJlc3BvbnNlXG4gIGVsc2UgaWYoaWQgIT0gdW5kZWZpbmVkKVxuICB7XG4gICAgaWYobWVzc2FnZS5lcnJvcilcbiAgICB7XG4gICAgICBpZihtZXNzYWdlLnJlc3VsdCAhPT0gdW5kZWZpbmVkKVxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQm90aCByZXN1bHQgYW5kIGVycm9yIGFyZSBkZWZpbmVkXCIpO1xuXG4gICAgICByZXN1bHQuZXJyb3IgPSBtZXNzYWdlLmVycm9yO1xuICAgIH1cbiAgICBlbHNlIGlmKG1lc3NhZ2UucmVzdWx0ICE9PSB1bmRlZmluZWQpXG4gICAgICByZXN1bHQucmVzdWx0ID0gbWVzc2FnZS5yZXN1bHQ7XG4gICAgZWxzZVxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk5vIHJlc3VsdCBvciBlcnJvciBpcyBkZWZpbmVkXCIpO1xuXG4gICAgcmVzdWx0LmlkID0gaWQ7XG4gIH07XG5cbiAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHJlc3VsdCk7XG59O1xuXG4vKipcbiAqIFVucGFjayBhIEpzb25SUEMgMi4wIG1lc3NhZ2VcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbWVzc2FnZSAtIHN0cmluZyB3aXRoIHRoZSBjb250ZW50IG9mIHRoZSBKc29uUlBDIDIuMCBtZXNzYWdlXG4gKlxuICogQHRocm93cyB7VHlwZUVycm9yfSAtIEludmFsaWQgSnNvblJQQyB2ZXJzaW9uXG4gKlxuICogQHJldHVybiB7T2JqZWN0fSAtIG9iamVjdCBmaWxsZWQgd2l0aCB0aGUgSnNvblJQQyAyLjAgbWVzc2FnZSBjb250ZW50XG4gKi9cbmZ1bmN0aW9uIHVucGFjayhtZXNzYWdlKVxue1xuICB2YXIgcmVzdWx0ID0gbWVzc2FnZTtcblxuICBpZih0eXBlb2YgbWVzc2FnZSA9PT0gJ3N0cmluZycgfHwgbWVzc2FnZSBpbnN0YW5jZW9mIFN0cmluZykge1xuICAgIHJlc3VsdCA9IEpTT04ucGFyc2UobWVzc2FnZSk7XG4gIH1cblxuICAvLyBDaGVjayBpZiBpdCdzIGEgdmFsaWQgbWVzc2FnZVxuXG4gIHZhciB2ZXJzaW9uID0gcmVzdWx0Lmpzb25ycGM7XG4gIGlmKHZlcnNpb24gIT09ICcyLjAnKVxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJJbnZhbGlkIEpzb25SUEMgdmVyc2lvbiAnXCIgKyB2ZXJzaW9uICsgXCInOiBcIiArIG1lc3NhZ2UpO1xuXG4gIC8vIFJlc3BvbnNlXG4gIGlmKHJlc3VsdC5tZXRob2QgPT0gdW5kZWZpbmVkKVxuICB7XG4gICAgaWYocmVzdWx0LmlkID09IHVuZGVmaW5lZClcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJJbnZhbGlkIG1lc3NhZ2U6IFwiK21lc3NhZ2UpO1xuXG4gICAgdmFyIHJlc3VsdF9kZWZpbmVkID0gcmVzdWx0LnJlc3VsdCAhPT0gdW5kZWZpbmVkO1xuICAgIHZhciBlcnJvcl9kZWZpbmVkICA9IHJlc3VsdC5lcnJvciAgIT09IHVuZGVmaW5lZDtcblxuICAgIC8vIENoZWNrIG9ubHkgcmVzdWx0IG9yIGVycm9yIGlzIGRlZmluZWQsIG5vdCBib3RoIG9yIG5vbmVcbiAgICBpZihyZXN1bHRfZGVmaW5lZCAmJiBlcnJvcl9kZWZpbmVkKVxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkJvdGggcmVzdWx0IGFuZCBlcnJvciBhcmUgZGVmaW5lZDogXCIrbWVzc2FnZSk7XG5cbiAgICBpZighcmVzdWx0X2RlZmluZWQgJiYgIWVycm9yX2RlZmluZWQpXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiTm8gcmVzdWx0IG9yIGVycm9yIGlzIGRlZmluZWQ6IFwiK21lc3NhZ2UpO1xuXG4gICAgcmVzdWx0LmFjayA9IHJlc3VsdC5pZDtcbiAgICBkZWxldGUgcmVzdWx0LmlkO1xuICB9XG5cbiAgLy8gUmV0dXJuIHVucGFja2VkIG1lc3NhZ2VcbiAgcmV0dXJuIHJlc3VsdDtcbn07XG5cblxuZXhwb3J0cy5wYWNrICAgPSBwYWNrO1xuZXhwb3J0cy51bnBhY2sgPSB1bnBhY2s7XG4iLCJmdW5jdGlvbiBwYWNrKG1lc3NhZ2UpXG57XG4gIHRocm93IG5ldyBUeXBlRXJyb3IoXCJOb3QgeWV0IGltcGxlbWVudGVkXCIpO1xufTtcblxuZnVuY3Rpb24gdW5wYWNrKG1lc3NhZ2UpXG57XG4gIHRocm93IG5ldyBUeXBlRXJyb3IoXCJOb3QgeWV0IGltcGxlbWVudGVkXCIpO1xufTtcblxuXG5leHBvcnRzLnBhY2sgICA9IHBhY2s7XG5leHBvcnRzLnVucGFjayA9IHVucGFjaztcbiIsInZhciBKc29uUlBDID0gcmVxdWlyZSgnLi9Kc29uUlBDJyk7XG52YXIgWG1sUlBDICA9IHJlcXVpcmUoJy4vWG1sUlBDJyk7XG5cblxuZXhwb3J0cy5Kc29uUlBDID0gSnNvblJQQztcbmV4cG9ydHMuWG1sUlBDICA9IFhtbFJQQztcbiIsIi8vIENvcHlyaWdodCBKb3llbnQsIEluYy4gYW5kIG90aGVyIE5vZGUgY29udHJpYnV0b3JzLlxuLy9cbi8vIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhXG4vLyBjb3B5IG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlXG4vLyBcIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmdcbi8vIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCxcbi8vIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXRcbi8vIHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZVxuLy8gZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4vL1xuLy8gVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWRcbi8vIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuLy9cbi8vIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1Ncbi8vIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0Zcbi8vIE1FUkNIQU5UQUJJTElUWSwgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU5cbi8vIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLFxuLy8gREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SXG4vLyBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSwgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFXG4vLyBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxuXG5mdW5jdGlvbiBFdmVudEVtaXR0ZXIoKSB7XG4gIHRoaXMuX2V2ZW50cyA9IHRoaXMuX2V2ZW50cyB8fCB7fTtcbiAgdGhpcy5fbWF4TGlzdGVuZXJzID0gdGhpcy5fbWF4TGlzdGVuZXJzIHx8IHVuZGVmaW5lZDtcbn1cbm1vZHVsZS5leHBvcnRzID0gRXZlbnRFbWl0dGVyO1xuXG4vLyBCYWNrd2FyZHMtY29tcGF0IHdpdGggbm9kZSAwLjEwLnhcbkV2ZW50RW1pdHRlci5FdmVudEVtaXR0ZXIgPSBFdmVudEVtaXR0ZXI7XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuX2V2ZW50cyA9IHVuZGVmaW5lZDtcbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuX21heExpc3RlbmVycyA9IHVuZGVmaW5lZDtcblxuLy8gQnkgZGVmYXVsdCBFdmVudEVtaXR0ZXJzIHdpbGwgcHJpbnQgYSB3YXJuaW5nIGlmIG1vcmUgdGhhbiAxMCBsaXN0ZW5lcnMgYXJlXG4vLyBhZGRlZCB0byBpdC4gVGhpcyBpcyBhIHVzZWZ1bCBkZWZhdWx0IHdoaWNoIGhlbHBzIGZpbmRpbmcgbWVtb3J5IGxlYWtzLlxuRXZlbnRFbWl0dGVyLmRlZmF1bHRNYXhMaXN0ZW5lcnMgPSAxMDtcblxuLy8gT2J2aW91c2x5IG5vdCBhbGwgRW1pdHRlcnMgc2hvdWxkIGJlIGxpbWl0ZWQgdG8gMTAuIFRoaXMgZnVuY3Rpb24gYWxsb3dzXG4vLyB0aGF0IHRvIGJlIGluY3JlYXNlZC4gU2V0IHRvIHplcm8gZm9yIHVubGltaXRlZC5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuc2V0TWF4TGlzdGVuZXJzID0gZnVuY3Rpb24obikge1xuICBpZiAoIWlzTnVtYmVyKG4pIHx8IG4gPCAwIHx8IGlzTmFOKG4pKVxuICAgIHRocm93IFR5cGVFcnJvcignbiBtdXN0IGJlIGEgcG9zaXRpdmUgbnVtYmVyJyk7XG4gIHRoaXMuX21heExpc3RlbmVycyA9IG47XG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5lbWl0ID0gZnVuY3Rpb24odHlwZSkge1xuICB2YXIgZXIsIGhhbmRsZXIsIGxlbiwgYXJncywgaSwgbGlzdGVuZXJzO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzKVxuICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuXG4gIC8vIElmIHRoZXJlIGlzIG5vICdlcnJvcicgZXZlbnQgbGlzdGVuZXIgdGhlbiB0aHJvdy5cbiAgaWYgKHR5cGUgPT09ICdlcnJvcicpIHtcbiAgICBpZiAoIXRoaXMuX2V2ZW50cy5lcnJvciB8fFxuICAgICAgICAoaXNPYmplY3QodGhpcy5fZXZlbnRzLmVycm9yKSAmJiAhdGhpcy5fZXZlbnRzLmVycm9yLmxlbmd0aCkpIHtcbiAgICAgIGVyID0gYXJndW1lbnRzWzFdO1xuICAgICAgaWYgKGVyIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgZXI7IC8vIFVuaGFuZGxlZCAnZXJyb3InIGV2ZW50XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBBdCBsZWFzdCBnaXZlIHNvbWUga2luZCBvZiBjb250ZXh0IHRvIHRoZSB1c2VyXG4gICAgICAgIHZhciBlcnIgPSBuZXcgRXJyb3IoJ1VuY2F1Z2h0LCB1bnNwZWNpZmllZCBcImVycm9yXCIgZXZlbnQuICgnICsgZXIgKyAnKScpO1xuICAgICAgICBlcnIuY29udGV4dCA9IGVyO1xuICAgICAgICB0aHJvdyBlcnI7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaGFuZGxlciA9IHRoaXMuX2V2ZW50c1t0eXBlXTtcblxuICBpZiAoaXNVbmRlZmluZWQoaGFuZGxlcikpXG4gICAgcmV0dXJuIGZhbHNlO1xuXG4gIGlmIChpc0Z1bmN0aW9uKGhhbmRsZXIpKSB7XG4gICAgc3dpdGNoIChhcmd1bWVudHMubGVuZ3RoKSB7XG4gICAgICAvLyBmYXN0IGNhc2VzXG4gICAgICBjYXNlIDE6XG4gICAgICAgIGhhbmRsZXIuY2FsbCh0aGlzKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIDI6XG4gICAgICAgIGhhbmRsZXIuY2FsbCh0aGlzLCBhcmd1bWVudHNbMV0pO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMzpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMsIGFyZ3VtZW50c1sxXSwgYXJndW1lbnRzWzJdKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICAvLyBzbG93ZXJcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICAgICAgICBoYW5kbGVyLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgIH1cbiAgfSBlbHNlIGlmIChpc09iamVjdChoYW5kbGVyKSkge1xuICAgIGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICAgIGxpc3RlbmVycyA9IGhhbmRsZXIuc2xpY2UoKTtcbiAgICBsZW4gPSBsaXN0ZW5lcnMubGVuZ3RoO1xuICAgIGZvciAoaSA9IDA7IGkgPCBsZW47IGkrKylcbiAgICAgIGxpc3RlbmVyc1tpXS5hcHBseSh0aGlzLCBhcmdzKTtcbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5hZGRMaXN0ZW5lciA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIHZhciBtO1xuXG4gIGlmICghaXNGdW5jdGlvbihsaXN0ZW5lcikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICBpZiAoIXRoaXMuX2V2ZW50cylcbiAgICB0aGlzLl9ldmVudHMgPSB7fTtcblxuICAvLyBUbyBhdm9pZCByZWN1cnNpb24gaW4gdGhlIGNhc2UgdGhhdCB0eXBlID09PSBcIm5ld0xpc3RlbmVyXCIhIEJlZm9yZVxuICAvLyBhZGRpbmcgaXQgdG8gdGhlIGxpc3RlbmVycywgZmlyc3QgZW1pdCBcIm5ld0xpc3RlbmVyXCIuXG4gIGlmICh0aGlzLl9ldmVudHMubmV3TGlzdGVuZXIpXG4gICAgdGhpcy5lbWl0KCduZXdMaXN0ZW5lcicsIHR5cGUsXG4gICAgICAgICAgICAgIGlzRnVuY3Rpb24obGlzdGVuZXIubGlzdGVuZXIpID9cbiAgICAgICAgICAgICAgbGlzdGVuZXIubGlzdGVuZXIgOiBsaXN0ZW5lcik7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgLy8gT3B0aW1pemUgdGhlIGNhc2Ugb2Ygb25lIGxpc3RlbmVyLiBEb24ndCBuZWVkIHRoZSBleHRyYSBhcnJheSBvYmplY3QuXG4gICAgdGhpcy5fZXZlbnRzW3R5cGVdID0gbGlzdGVuZXI7XG4gIGVsc2UgaWYgKGlzT2JqZWN0KHRoaXMuX2V2ZW50c1t0eXBlXSkpXG4gICAgLy8gSWYgd2UndmUgYWxyZWFkeSBnb3QgYW4gYXJyYXksIGp1c3QgYXBwZW5kLlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXS5wdXNoKGxpc3RlbmVyKTtcbiAgZWxzZVxuICAgIC8vIEFkZGluZyB0aGUgc2Vjb25kIGVsZW1lbnQsIG5lZWQgdG8gY2hhbmdlIHRvIGFycmF5LlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXSA9IFt0aGlzLl9ldmVudHNbdHlwZV0sIGxpc3RlbmVyXTtcblxuICAvLyBDaGVjayBmb3IgbGlzdGVuZXIgbGVha1xuICBpZiAoaXNPYmplY3QodGhpcy5fZXZlbnRzW3R5cGVdKSAmJiAhdGhpcy5fZXZlbnRzW3R5cGVdLndhcm5lZCkge1xuICAgIGlmICghaXNVbmRlZmluZWQodGhpcy5fbWF4TGlzdGVuZXJzKSkge1xuICAgICAgbSA9IHRoaXMuX21heExpc3RlbmVycztcbiAgICB9IGVsc2Uge1xuICAgICAgbSA9IEV2ZW50RW1pdHRlci5kZWZhdWx0TWF4TGlzdGVuZXJzO1xuICAgIH1cblxuICAgIGlmIChtICYmIG0gPiAwICYmIHRoaXMuX2V2ZW50c1t0eXBlXS5sZW5ndGggPiBtKSB7XG4gICAgICB0aGlzLl9ldmVudHNbdHlwZV0ud2FybmVkID0gdHJ1ZTtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJyhub2RlKSB3YXJuaW5nOiBwb3NzaWJsZSBFdmVudEVtaXR0ZXIgbWVtb3J5ICcgK1xuICAgICAgICAgICAgICAgICAgICAnbGVhayBkZXRlY3RlZC4gJWQgbGlzdGVuZXJzIGFkZGVkLiAnICtcbiAgICAgICAgICAgICAgICAgICAgJ1VzZSBlbWl0dGVyLnNldE1heExpc3RlbmVycygpIHRvIGluY3JlYXNlIGxpbWl0LicsXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2V2ZW50c1t0eXBlXS5sZW5ndGgpO1xuICAgICAgaWYgKHR5cGVvZiBjb25zb2xlLnRyYWNlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIC8vIG5vdCBzdXBwb3J0ZWQgaW4gSUUgMTBcbiAgICAgICAgY29uc29sZS50cmFjZSgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5vbiA9IEV2ZW50RW1pdHRlci5wcm90b3R5cGUuYWRkTGlzdGVuZXI7XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUub25jZSA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIGlmICghaXNGdW5jdGlvbihsaXN0ZW5lcikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICB2YXIgZmlyZWQgPSBmYWxzZTtcblxuICBmdW5jdGlvbiBnKCkge1xuICAgIHRoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSwgZyk7XG5cbiAgICBpZiAoIWZpcmVkKSB7XG4gICAgICBmaXJlZCA9IHRydWU7XG4gICAgICBsaXN0ZW5lci5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH1cbiAgfVxuXG4gIGcubGlzdGVuZXIgPSBsaXN0ZW5lcjtcbiAgdGhpcy5vbih0eXBlLCBnKTtcblxuICByZXR1cm4gdGhpcztcbn07XG5cbi8vIGVtaXRzIGEgJ3JlbW92ZUxpc3RlbmVyJyBldmVudCBpZmYgdGhlIGxpc3RlbmVyIHdhcyByZW1vdmVkXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUxpc3RlbmVyID0gZnVuY3Rpb24odHlwZSwgbGlzdGVuZXIpIHtcbiAgdmFyIGxpc3QsIHBvc2l0aW9uLCBsZW5ndGgsIGk7XG5cbiAgaWYgKCFpc0Z1bmN0aW9uKGxpc3RlbmVyKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzIHx8ICF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0dXJuIHRoaXM7XG5cbiAgbGlzdCA9IHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgbGVuZ3RoID0gbGlzdC5sZW5ndGg7XG4gIHBvc2l0aW9uID0gLTE7XG5cbiAgaWYgKGxpc3QgPT09IGxpc3RlbmVyIHx8XG4gICAgICAoaXNGdW5jdGlvbihsaXN0Lmxpc3RlbmVyKSAmJiBsaXN0Lmxpc3RlbmVyID09PSBsaXN0ZW5lcikpIHtcbiAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICAgIGlmICh0aGlzLl9ldmVudHMucmVtb3ZlTGlzdGVuZXIpXG4gICAgICB0aGlzLmVtaXQoJ3JlbW92ZUxpc3RlbmVyJywgdHlwZSwgbGlzdGVuZXIpO1xuXG4gIH0gZWxzZSBpZiAoaXNPYmplY3QobGlzdCkpIHtcbiAgICBmb3IgKGkgPSBsZW5ndGg7IGktLSA+IDA7KSB7XG4gICAgICBpZiAobGlzdFtpXSA9PT0gbGlzdGVuZXIgfHxcbiAgICAgICAgICAobGlzdFtpXS5saXN0ZW5lciAmJiBsaXN0W2ldLmxpc3RlbmVyID09PSBsaXN0ZW5lcikpIHtcbiAgICAgICAgcG9zaXRpb24gPSBpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocG9zaXRpb24gPCAwKVxuICAgICAgcmV0dXJuIHRoaXM7XG5cbiAgICBpZiAobGlzdC5sZW5ndGggPT09IDEpIHtcbiAgICAgIGxpc3QubGVuZ3RoID0gMDtcbiAgICAgIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpc3Quc3BsaWNlKHBvc2l0aW9uLCAxKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fZXZlbnRzLnJlbW92ZUxpc3RlbmVyKVxuICAgICAgdGhpcy5lbWl0KCdyZW1vdmVMaXN0ZW5lcicsIHR5cGUsIGxpc3RlbmVyKTtcbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciBrZXksIGxpc3RlbmVycztcblxuICBpZiAoIXRoaXMuX2V2ZW50cylcbiAgICByZXR1cm4gdGhpcztcblxuICAvLyBub3QgbGlzdGVuaW5nIGZvciByZW1vdmVMaXN0ZW5lciwgbm8gbmVlZCB0byBlbWl0XG4gIGlmICghdGhpcy5fZXZlbnRzLnJlbW92ZUxpc3RlbmVyKSB7XG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApXG4gICAgICB0aGlzLl9ldmVudHMgPSB7fTtcbiAgICBlbHNlIGlmICh0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8gZW1pdCByZW1vdmVMaXN0ZW5lciBmb3IgYWxsIGxpc3RlbmVycyBvbiBhbGwgZXZlbnRzXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgZm9yIChrZXkgaW4gdGhpcy5fZXZlbnRzKSB7XG4gICAgICBpZiAoa2V5ID09PSAncmVtb3ZlTGlzdGVuZXInKSBjb250aW51ZTtcbiAgICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKGtleSk7XG4gICAgfVxuICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKCdyZW1vdmVMaXN0ZW5lcicpO1xuICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgbGlzdGVuZXJzID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIGlmIChpc0Z1bmN0aW9uKGxpc3RlbmVycykpIHtcbiAgICB0aGlzLnJlbW92ZUxpc3RlbmVyKHR5cGUsIGxpc3RlbmVycyk7XG4gIH0gZWxzZSBpZiAobGlzdGVuZXJzKSB7XG4gICAgLy8gTElGTyBvcmRlclxuICAgIHdoaWxlIChsaXN0ZW5lcnMubGVuZ3RoKVxuICAgICAgdGhpcy5yZW1vdmVMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcnNbbGlzdGVuZXJzLmxlbmd0aCAtIDFdKTtcbiAgfVxuICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5saXN0ZW5lcnMgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciByZXQ7XG4gIGlmICghdGhpcy5fZXZlbnRzIHx8ICF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0ID0gW107XG4gIGVsc2UgaWYgKGlzRnVuY3Rpb24odGhpcy5fZXZlbnRzW3R5cGVdKSlcbiAgICByZXQgPSBbdGhpcy5fZXZlbnRzW3R5cGVdXTtcbiAgZWxzZVxuICAgIHJldCA9IHRoaXMuX2V2ZW50c1t0eXBlXS5zbGljZSgpO1xuICByZXR1cm4gcmV0O1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5saXN0ZW5lckNvdW50ID0gZnVuY3Rpb24odHlwZSkge1xuICBpZiAodGhpcy5fZXZlbnRzKSB7XG4gICAgdmFyIGV2bGlzdGVuZXIgPSB0aGlzLl9ldmVudHNbdHlwZV07XG5cbiAgICBpZiAoaXNGdW5jdGlvbihldmxpc3RlbmVyKSlcbiAgICAgIHJldHVybiAxO1xuICAgIGVsc2UgaWYgKGV2bGlzdGVuZXIpXG4gICAgICByZXR1cm4gZXZsaXN0ZW5lci5sZW5ndGg7XG4gIH1cbiAgcmV0dXJuIDA7XG59O1xuXG5FdmVudEVtaXR0ZXIubGlzdGVuZXJDb3VudCA9IGZ1bmN0aW9uKGVtaXR0ZXIsIHR5cGUpIHtcbiAgcmV0dXJuIGVtaXR0ZXIubGlzdGVuZXJDb3VudCh0eXBlKTtcbn07XG5cbmZ1bmN0aW9uIGlzRnVuY3Rpb24oYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnZnVuY3Rpb24nO1xufVxuXG5mdW5jdGlvbiBpc051bWJlcihhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdudW1iZXInO1xufVxuXG5mdW5jdGlvbiBpc09iamVjdChhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdvYmplY3QnICYmIGFyZyAhPT0gbnVsbDtcbn1cblxuZnVuY3Rpb24gaXNVbmRlZmluZWQoYXJnKSB7XG4gIHJldHVybiBhcmcgPT09IHZvaWQgMDtcbn1cbiIsImlmICh0eXBlb2YgT2JqZWN0LmNyZWF0ZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAvLyBpbXBsZW1lbnRhdGlvbiBmcm9tIHN0YW5kYXJkIG5vZGUuanMgJ3V0aWwnIG1vZHVsZVxuICBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGluaGVyaXRzKGN0b3IsIHN1cGVyQ3Rvcikge1xuICAgIGN0b3Iuc3VwZXJfID0gc3VwZXJDdG9yXG4gICAgY3Rvci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKHN1cGVyQ3Rvci5wcm90b3R5cGUsIHtcbiAgICAgIGNvbnN0cnVjdG9yOiB7XG4gICAgICAgIHZhbHVlOiBjdG9yLFxuICAgICAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICAgICAgd3JpdGFibGU6IHRydWUsXG4gICAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuICAgICAgfVxuICAgIH0pO1xuICB9O1xufSBlbHNlIHtcbiAgLy8gb2xkIHNjaG9vbCBzaGltIGZvciBvbGQgYnJvd3NlcnNcbiAgbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBpbmhlcml0cyhjdG9yLCBzdXBlckN0b3IpIHtcbiAgICBjdG9yLnN1cGVyXyA9IHN1cGVyQ3RvclxuICAgIHZhciBUZW1wQ3RvciA9IGZ1bmN0aW9uICgpIHt9XG4gICAgVGVtcEN0b3IucHJvdG90eXBlID0gc3VwZXJDdG9yLnByb3RvdHlwZVxuICAgIGN0b3IucHJvdG90eXBlID0gbmV3IFRlbXBDdG9yKClcbiAgICBjdG9yLnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IGN0b3JcbiAgfVxufVxuIl19
