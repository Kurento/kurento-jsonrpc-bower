(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.RpcBuilder = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
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

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJsaWIvTWFwcGVyLmpzIiwibGliL2NsaWVudHMvaW5kZXguanMiLCJsaWIvY2xpZW50cy9qc29ucnBjY2xpZW50LmpzIiwibGliL2NsaWVudHMvdHJhbnNwb3J0cy9pbmRleC5qcyIsImxpYi9jbGllbnRzL3RyYW5zcG9ydHMvd2ViU29ja2V0V2l0aFJlY29ubmVjdGlvbi5qcyIsImxpYi9pbmRleC5qcyIsImxpYi9wYWNrZXJzL0pzb25SUEMuanMiLCJsaWIvcGFja2Vycy9YbWxSUEMuanMiLCJsaWIvcGFja2Vycy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9ldmVudHMvZXZlbnRzLmpzIiwibm9kZV9tb2R1bGVzL2luaGVyaXRzL2luaGVyaXRzX2Jyb3dzZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNwQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDbFBBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3R6QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2R0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNiQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOVNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSIsImZ1bmN0aW9uIE1hcHBlcigpXG57XG4gIHZhciBzb3VyY2VzID0ge307XG5cblxuICB0aGlzLmZvckVhY2ggPSBmdW5jdGlvbihjYWxsYmFjaylcbiAge1xuICAgIGZvcih2YXIga2V5IGluIHNvdXJjZXMpXG4gICAge1xuICAgICAgdmFyIHNvdXJjZSA9IHNvdXJjZXNba2V5XTtcblxuICAgICAgZm9yKHZhciBrZXkyIGluIHNvdXJjZSlcbiAgICAgICAgY2FsbGJhY2soc291cmNlW2tleTJdKTtcbiAgICB9O1xuICB9O1xuXG4gIHRoaXMuZ2V0ID0gZnVuY3Rpb24oaWQsIHNvdXJjZSlcbiAge1xuICAgIHZhciBpZHMgPSBzb3VyY2VzW3NvdXJjZV07XG4gICAgaWYoaWRzID09IHVuZGVmaW5lZClcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICByZXR1cm4gaWRzW2lkXTtcbiAgfTtcblxuICB0aGlzLnJlbW92ZSA9IGZ1bmN0aW9uKGlkLCBzb3VyY2UpXG4gIHtcbiAgICB2YXIgaWRzID0gc291cmNlc1tzb3VyY2VdO1xuICAgIGlmKGlkcyA9PSB1bmRlZmluZWQpXG4gICAgICByZXR1cm47XG5cbiAgICBkZWxldGUgaWRzW2lkXTtcblxuICAgIC8vIENoZWNrIGl0J3MgZW1wdHlcbiAgICBmb3IodmFyIGkgaW4gaWRzKXtyZXR1cm4gZmFsc2V9XG5cbiAgICBkZWxldGUgc291cmNlc1tzb3VyY2VdO1xuICB9O1xuXG4gIHRoaXMuc2V0ID0gZnVuY3Rpb24odmFsdWUsIGlkLCBzb3VyY2UpXG4gIHtcbiAgICBpZih2YWx1ZSA9PSB1bmRlZmluZWQpXG4gICAgICByZXR1cm4gdGhpcy5yZW1vdmUoaWQsIHNvdXJjZSk7XG5cbiAgICB2YXIgaWRzID0gc291cmNlc1tzb3VyY2VdO1xuICAgIGlmKGlkcyA9PSB1bmRlZmluZWQpXG4gICAgICBzb3VyY2VzW3NvdXJjZV0gPSBpZHMgPSB7fTtcblxuICAgIGlkc1tpZF0gPSB2YWx1ZTtcbiAgfTtcbn07XG5cblxuTWFwcGVyLnByb3RvdHlwZS5wb3AgPSBmdW5jdGlvbihpZCwgc291cmNlKVxue1xuICB2YXIgdmFsdWUgPSB0aGlzLmdldChpZCwgc291cmNlKTtcbiAgaWYodmFsdWUgPT0gdW5kZWZpbmVkKVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgdGhpcy5yZW1vdmUoaWQsIHNvdXJjZSk7XG5cbiAgcmV0dXJuIHZhbHVlO1xufTtcblxuXG5tb2R1bGUuZXhwb3J0cyA9IE1hcHBlcjtcbiIsIi8qXG4gKiAoQykgQ29weXJpZ2h0IDIwMTQgS3VyZW50byAoaHR0cDovL2t1cmVudG8ub3JnLylcbiAqXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuICogeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4gKlxuICogICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICpcbiAqL1xuXG52YXIgSnNvblJwY0NsaWVudCAgPSByZXF1aXJlKCcuL2pzb25ycGNjbGllbnQnKTtcblxuXG5leHBvcnRzLkpzb25ScGNDbGllbnQgID0gSnNvblJwY0NsaWVudDsiLCIvKlxuICogKEMpIENvcHlyaWdodCAyMDE0IEt1cmVudG8gKGh0dHA6Ly9rdXJlbnRvLm9yZy8pXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4gKlxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuICogV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cbiAqXG4gKi9cblxudmFyIFJwY0J1aWxkZXIgPSByZXF1aXJlKCcuLi8uLicpO1xudmFyIFdlYlNvY2tldFdpdGhSZWNvbm5lY3Rpb24gPSByZXF1aXJlKCcuL3RyYW5zcG9ydHMvd2ViU29ja2V0V2l0aFJlY29ubmVjdGlvbicpO1xuXG5EYXRlLm5vdyA9IERhdGUubm93IHx8IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiArbmV3IERhdGU7XG59O1xuXG52YXIgUElOR19JTlRFUlZBTCA9IDUwMDA7XG5cbnZhciBSRUNPTk5FQ1RJTkcgPSAnUkVDT05ORUNUSU5HJztcbnZhciBDT05ORUNURUQgPSAnQ09OTkVDVEVEJztcbnZhciBESVNDT05ORUNURUQgPSAnRElTQ09OTkVDVEVEJztcblxudmFyIExvZ2dlciA9IGNvbnNvbGU7XG5cbi8qKlxuICpcbiAqIGhlYXJ0YmVhdDogaW50ZXJ2YWwgaW4gbXMgZm9yIGVhY2ggaGVhcnRiZWF0IG1lc3NhZ2UsXG4gKiBzZW5kQ2xvc2VNZXNzYWdlIDogdHJ1ZSAvIGZhbHNlLCBiZWZvcmUgY2xvc2luZyB0aGUgY29ubmVjdGlvbiwgaXQgc2VuZHMgYSBjbG9zZVNlc3Npb24gbWVzc2FnZVxuICogPHByZT5cbiAqIHdzIDoge1xuICogXHR1cmkgOiBVUkkgdG8gY29ubnRlY3QgdG8sXG4gKiAgdXNlU29ja0pTIDogdHJ1ZSAodXNlIFNvY2tKUykgLyBmYWxzZSAodXNlIFdlYlNvY2tldCkgYnkgZGVmYXVsdCxcbiAqIFx0b25jb25uZWN0ZWQgOiBjYWxsYmFjayBtZXRob2QgdG8gaW52b2tlIHdoZW4gY29ubmVjdGlvbiBpcyBzdWNjZXNzZnVsLFxuICogXHRvbmRpc2Nvbm5lY3QgOiBjYWxsYmFjayBtZXRob2QgdG8gaW52b2tlIHdoZW4gdGhlIGNvbm5lY3Rpb24gaXMgbG9zdCxcbiAqIFx0b25yZWNvbm5lY3RpbmcgOiBjYWxsYmFjayBtZXRob2QgdG8gaW52b2tlIHdoZW4gdGhlIGNsaWVudCBpcyByZWNvbm5lY3RpbmcsXG4gKiBcdG9ucmVjb25uZWN0ZWQgOiBjYWxsYmFjayBtZXRob2QgdG8gaW52b2tlIHdoZW4gdGhlIGNsaWVudCBzdWNjZXNmdWxseSByZWNvbm5lY3RzLFxuICogXHRvbmVycm9yIDogY2FsbGJhY2sgbWV0aG9kIHRvIGludm9rZSB3aGVuIHRoZXJlIGlzIGFuIGVycm9yXG4gKiB9LFxuICogcnBjIDoge1xuICogXHRyZXF1ZXN0VGltZW91dCA6IHRpbWVvdXQgZm9yIGEgcmVxdWVzdCxcbiAqIFx0c2Vzc2lvblN0YXR1c0NoYW5nZWQ6IGNhbGxiYWNrIG1ldGhvZCBmb3IgY2hhbmdlcyBpbiBzZXNzaW9uIHN0YXR1cyxcbiAqIFx0bWVkaWFSZW5lZ290aWF0aW9uOiBtZWRpYVJlbmVnb3RpYXRpb25cbiAqIH1cbiAqIDwvcHJlPlxuICovXG5mdW5jdGlvbiBKc29uUnBjQ2xpZW50KGNvbmZpZ3VyYXRpb24pIHtcblxuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIHZhciB3c0NvbmZpZyA9IGNvbmZpZ3VyYXRpb24ud3M7XG5cbiAgICB2YXIgbm90UmVjb25uZWN0SWZOdW1MZXNzVGhhbiA9IC0xO1xuXG4gICAgdmFyIHBpbmdOZXh0TnVtID0gMDtcbiAgICB2YXIgZW5hYmxlZFBpbmdzID0gdHJ1ZTtcbiAgICB2YXIgcGluZ1BvbmdTdGFydGVkID0gZmFsc2U7XG4gICAgdmFyIHBpbmdJbnRlcnZhbDtcblxuICAgIHZhciBzdGF0dXMgPSBESVNDT05ORUNURUQ7XG5cbiAgICB2YXIgb25yZWNvbm5lY3RpbmcgPSB3c0NvbmZpZy5vbnJlY29ubmVjdGluZztcbiAgICB2YXIgb25yZWNvbm5lY3RlZCA9IHdzQ29uZmlnLm9ucmVjb25uZWN0ZWQ7XG4gICAgdmFyIG9uY29ubmVjdGVkID0gd3NDb25maWcub25jb25uZWN0ZWQ7XG4gICAgdmFyIG9uZXJyb3IgPSB3c0NvbmZpZy5vbmVycm9yO1xuXG4gICAgY29uZmlndXJhdGlvbi5ycGMucHVsbCA9IGZ1bmN0aW9uKHBhcmFtcywgcmVxdWVzdCkge1xuICAgICAgICByZXF1ZXN0LnJlcGx5KG51bGwsIFwicHVzaFwiKTtcbiAgICB9XG5cbiAgICB3c0NvbmZpZy5vbnJlY29ubmVjdGluZyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBMb2dnZXIuZGVidWcoXCItLS0tLS0tLS0gT05SRUNPTk5FQ1RJTkcgLS0tLS0tLS0tLS1cIik7XG4gICAgICAgIGlmIChzdGF0dXMgPT09IFJFQ09OTkVDVElORykge1xuICAgICAgICAgICAgTG9nZ2VyLmVycm9yKFwiV2Vic29ja2V0IGFscmVhZHkgaW4gUkVDT05ORUNUSU5HIHN0YXRlIHdoZW4gcmVjZWl2aW5nIGEgbmV3IE9OUkVDT05ORUNUSU5HIG1lc3NhZ2UuIElnbm9yaW5nIGl0XCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgc3RhdHVzID0gUkVDT05ORUNUSU5HO1xuICAgICAgICBpZiAob25yZWNvbm5lY3RpbmcpIHtcbiAgICAgICAgICAgIG9ucmVjb25uZWN0aW5nKCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB3c0NvbmZpZy5vbnJlY29ubmVjdGVkID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIExvZ2dlci5kZWJ1ZyhcIi0tLS0tLS0tLSBPTlJFQ09OTkVDVEVEIC0tLS0tLS0tLS0tXCIpO1xuICAgICAgICBpZiAoc3RhdHVzID09PSBDT05ORUNURUQpIHtcbiAgICAgICAgICAgIExvZ2dlci5lcnJvcihcIldlYnNvY2tldCBhbHJlYWR5IGluIENPTk5FQ1RFRCBzdGF0ZSB3aGVuIHJlY2VpdmluZyBhIG5ldyBPTlJFQ09OTkVDVEVEIG1lc3NhZ2UuIElnbm9yaW5nIGl0XCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHN0YXR1cyA9IENPTk5FQ1RFRDtcblxuICAgICAgICBlbmFibGVkUGluZ3MgPSB0cnVlO1xuICAgICAgICB1cGRhdGVOb3RSZWNvbm5lY3RJZkxlc3NUaGFuKCk7XG4gICAgICAgIHVzZVBpbmcoKTtcblxuICAgICAgICBpZiAob25yZWNvbm5lY3RlZCkge1xuICAgICAgICAgICAgb25yZWNvbm5lY3RlZCgpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgd3NDb25maWcub25jb25uZWN0ZWQgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgTG9nZ2VyLmRlYnVnKFwiLS0tLS0tLS0tIE9OQ09OTkVDVEVEIC0tLS0tLS0tLS0tXCIpO1xuICAgICAgICBpZiAoc3RhdHVzID09PSBDT05ORUNURUQpIHtcbiAgICAgICAgICAgIExvZ2dlci5lcnJvcihcIldlYnNvY2tldCBhbHJlYWR5IGluIENPTk5FQ1RFRCBzdGF0ZSB3aGVuIHJlY2VpdmluZyBhIG5ldyBPTkNPTk5FQ1RFRCBtZXNzYWdlLiBJZ25vcmluZyBpdFwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBzdGF0dXMgPSBDT05ORUNURUQ7XG5cbiAgICAgICAgZW5hYmxlZFBpbmdzID0gdHJ1ZTtcbiAgICAgICAgdXNlUGluZygpO1xuXG4gICAgICAgIGlmIChvbmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgb25jb25uZWN0ZWQoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHdzQ29uZmlnLm9uZXJyb3IgPSBmdW5jdGlvbihlcnJvcikge1xuICAgICAgICBMb2dnZXIuZGVidWcoXCItLS0tLS0tLS0gT05FUlJPUiAtLS0tLS0tLS0tLVwiKTtcblxuICAgICAgICBzdGF0dXMgPSBESVNDT05ORUNURUQ7XG5cbiAgICAgICAgaWYgKG9uZXJyb3IpIHtcbiAgICAgICAgICAgIG9uZXJyb3IoZXJyb3IpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdmFyIHdzID0gbmV3IFdlYlNvY2tldFdpdGhSZWNvbm5lY3Rpb24od3NDb25maWcpO1xuXG4gICAgTG9nZ2VyLmRlYnVnKCdDb25uZWN0aW5nIHdlYnNvY2tldCB0byBVUkk6ICcgKyB3c0NvbmZpZy51cmkpO1xuXG4gICAgdmFyIHJwY0J1aWxkZXJPcHRpb25zID0ge1xuICAgICAgICByZXF1ZXN0X3RpbWVvdXQ6IGNvbmZpZ3VyYXRpb24ucnBjLnJlcXVlc3RUaW1lb3V0LFxuICAgICAgICBwaW5nX3JlcXVlc3RfdGltZW91dDogY29uZmlndXJhdGlvbi5ycGMuaGVhcnRiZWF0UmVxdWVzdFRpbWVvdXRcbiAgICB9O1xuXG4gICAgdmFyIHJwYyA9IG5ldyBScGNCdWlsZGVyKFJwY0J1aWxkZXIucGFja2Vycy5Kc29uUlBDLCBycGNCdWlsZGVyT3B0aW9ucywgd3MsXG4gICAgICAgIGZ1bmN0aW9uKHJlcXVlc3QpIHtcblxuICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKCdSZWNlaXZlZCByZXF1ZXN0OiAnICsgSlNPTi5zdHJpbmdpZnkocmVxdWVzdCkpO1xuXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHZhciBmdW5jID0gY29uZmlndXJhdGlvbi5ycGNbcmVxdWVzdC5tZXRob2RdO1xuXG4gICAgICAgICAgICAgICAgaWYgKGZ1bmMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgICBMb2dnZXIuZXJyb3IoXCJNZXRob2QgXCIgKyByZXF1ZXN0Lm1ldGhvZCArIFwiIG5vdCByZWdpc3RlcmVkIGluIGNsaWVudFwiKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBmdW5jKHJlcXVlc3QucGFyYW1zLCByZXF1ZXN0KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgICAgICBMb2dnZXIuZXJyb3IoJ0V4Y2VwdGlvbiBwcm9jZXNzaW5nIHJlcXVlc3Q6ICcgKyBKU09OLnN0cmluZ2lmeShyZXF1ZXN0KSk7XG4gICAgICAgICAgICAgICAgTG9nZ2VyLmVycm9yKGVycik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgdGhpcy5zZW5kID0gZnVuY3Rpb24obWV0aG9kLCBwYXJhbXMsIGNhbGxiYWNrKSB7XG4gICAgICAgIGlmIChtZXRob2QgIT09ICdwaW5nJykge1xuICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKCdSZXF1ZXN0OiBtZXRob2Q6JyArIG1ldGhvZCArIFwiIHBhcmFtczpcIiArIEpTT04uc3RyaW5naWZ5KHBhcmFtcykpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHJlcXVlc3RUaW1lID0gRGF0ZS5ub3coKTtcblxuICAgICAgICBycGMuZW5jb2RlKG1ldGhvZCwgcGFyYW1zLCBmdW5jdGlvbihlcnJvciwgcmVzdWx0KSB7XG4gICAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBMb2dnZXIuZXJyb3IoXCJFUlJPUjpcIiArIGVycm9yLm1lc3NhZ2UgKyBcIiBpbiBSZXF1ZXN0OiBtZXRob2Q6XCIgK1xuICAgICAgICAgICAgICAgICAgICAgICAgbWV0aG9kICsgXCIgcGFyYW1zOlwiICsgSlNPTi5zdHJpbmdpZnkocGFyYW1zKSArIFwiIHJlcXVlc3Q6XCIgK1xuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3IucmVxdWVzdCk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChlcnJvci5kYXRhKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBMb2dnZXIuZXJyb3IoXCJFUlJPUiBEQVRBOlwiICsgSlNPTi5zdHJpbmdpZnkoZXJyb3IuZGF0YSkpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge31cbiAgICAgICAgICAgICAgICBlcnJvci5yZXF1ZXN0VGltZSA9IHJlcXVlc3RUaW1lO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICAgICAgaWYgKHJlc3VsdCAhPSB1bmRlZmluZWQgJiYgcmVzdWx0LnZhbHVlICE9PSAncG9uZycpIHtcbiAgICAgICAgICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKCdSZXNwb25zZTogJyArIEpTT04uc3RyaW5naWZ5KHJlc3VsdCkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjYWxsYmFjayhlcnJvciwgcmVzdWx0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdXBkYXRlTm90UmVjb25uZWN0SWZMZXNzVGhhbigpIHtcbiAgICAgICAgTG9nZ2VyLmRlYnVnKFwibm90UmVjb25uZWN0SWZOdW1MZXNzVGhhbiA9IFwiICsgcGluZ05leHROdW0gKyAnIChvbGQ9JyArXG4gICAgICAgICAgICBub3RSZWNvbm5lY3RJZk51bUxlc3NUaGFuICsgJyknKTtcbiAgICAgICAgbm90UmVjb25uZWN0SWZOdW1MZXNzVGhhbiA9IHBpbmdOZXh0TnVtO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNlbmRQaW5nKCkge1xuICAgICAgICBpZiAoZW5hYmxlZFBpbmdzKSB7XG4gICAgICAgICAgICB2YXIgcGFyYW1zID0gbnVsbDtcbiAgICAgICAgICAgIGlmIChwaW5nTmV4dE51bSA9PSAwIHx8IHBpbmdOZXh0TnVtID09IG5vdFJlY29ubmVjdElmTnVtTGVzc1RoYW4pIHtcbiAgICAgICAgICAgICAgICBwYXJhbXMgPSB7XG4gICAgICAgICAgICAgICAgICAgIGludGVydmFsOiBjb25maWd1cmF0aW9uLmhlYXJ0YmVhdCB8fCBQSU5HX0lOVEVSVkFMXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHBpbmdOZXh0TnVtKys7XG5cbiAgICAgICAgICAgIHNlbGYuc2VuZCgncGluZycsIHBhcmFtcywgKGZ1bmN0aW9uKHBpbmdOdW0pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZnVuY3Rpb24oZXJyb3IsIHJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIExvZ2dlci5kZWJ1ZyhcIkVycm9yIGluIHBpbmcgcmVxdWVzdCAjXCIgKyBwaW5nTnVtICsgXCIgKFwiICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlcnJvci5tZXNzYWdlICsgXCIpXCIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBpbmdOdW0gPiBub3RSZWNvbm5lY3RJZk51bUxlc3NUaGFuKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZW5hYmxlZFBpbmdzID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXBkYXRlTm90UmVjb25uZWN0SWZMZXNzVGhhbigpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIExvZ2dlci5kZWJ1ZyhcIlNlcnZlciBkaWQgbm90IHJlc3BvbmQgdG8gcGluZyBtZXNzYWdlICNcIiArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpbmdOdW0gKyBcIi4gUmVjb25uZWN0aW5nLi4uIFwiKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB3cy5yZWNvbm5lY3RXcygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSkocGluZ05leHROdW0pKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIExvZ2dlci5kZWJ1ZyhcIlRyeWluZyB0byBzZW5kIHBpbmcsIGJ1dCBwaW5nIGlzIG5vdCBlbmFibGVkXCIpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLypcbiAgICAqIElmIGNvbmZpZ3VyYXRpb24uaGVhcmJlYXQgaGFzIGFueSB2YWx1ZSwgdGhlIHBpbmctcG9uZyB3aWxsIHdvcmsgd2l0aCB0aGUgaW50ZXJ2YWxcbiAgICAqIG9mIGNvbmZpZ3VyYXRpb24uaGVhcmJlYXRcbiAgICAqL1xuICAgIGZ1bmN0aW9uIHVzZVBpbmcoKSB7XG4gICAgICAgIGlmICghcGluZ1BvbmdTdGFydGVkKSB7XG4gICAgICAgICAgICBMb2dnZXIuZGVidWcoXCJTdGFydGluZyBwaW5nIChpZiBjb25maWd1cmVkKVwiKVxuICAgICAgICAgICAgcGluZ1BvbmdTdGFydGVkID0gdHJ1ZTtcblxuICAgICAgICAgICAgaWYgKGNvbmZpZ3VyYXRpb24uaGVhcnRiZWF0ICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHBpbmdJbnRlcnZhbCA9IHNldEludGVydmFsKHNlbmRQaW5nLCBjb25maWd1cmF0aW9uLmhlYXJ0YmVhdCk7XG4gICAgICAgICAgICAgICAgc2VuZFBpbmcoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuY2xvc2UgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgTG9nZ2VyLmRlYnVnKFwiQ2xvc2luZyBqc29uUnBjQ2xpZW50IGV4cGxpY2l0bHkgYnkgY2xpZW50XCIpO1xuXG4gICAgICAgIGlmIChwaW5nSW50ZXJ2YWwgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBMb2dnZXIuZGVidWcoXCJDbGVhcmluZyBwaW5nIGludGVydmFsXCIpO1xuICAgICAgICAgICAgY2xlYXJJbnRlcnZhbChwaW5nSW50ZXJ2YWwpO1xuICAgICAgICB9XG4gICAgICAgIHBpbmdQb25nU3RhcnRlZCA9IGZhbHNlO1xuICAgICAgICBlbmFibGVkUGluZ3MgPSBmYWxzZTtcblxuICAgICAgICBpZiAoY29uZmlndXJhdGlvbi5zZW5kQ2xvc2VNZXNzYWdlKSB7XG4gICAgICAgICAgICBMb2dnZXIuZGVidWcoXCJTZW5kaW5nIGNsb3NlIG1lc3NhZ2VcIilcbiAgICAgICAgICAgIHRoaXMuc2VuZCgnY2xvc2VTZXNzaW9uJywgbnVsbCwgZnVuY3Rpb24oZXJyb3IsIHJlc3VsdCkge1xuICAgICAgICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICBMb2dnZXIuZXJyb3IoXCJFcnJvciBzZW5kaW5nIGNsb3NlIG1lc3NhZ2U6IFwiICsgSlNPTi5zdHJpbmdpZnkoZXJyb3IpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgd3MuY2xvc2UoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuXHRcdFx0d3MuY2xvc2UoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFRoaXMgbWV0aG9kIGlzIG9ubHkgZm9yIHRlc3RpbmdcbiAgICB0aGlzLmZvcmNlQ2xvc2UgPSBmdW5jdGlvbihtaWxsaXMpIHtcbiAgICAgICAgd3MuZm9yY2VDbG9zZShtaWxsaXMpO1xuICAgIH1cblxuICAgIHRoaXMucmVjb25uZWN0ID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHdzLnJlY29ubmVjdFdzKCk7XG4gICAgfVxufVxuXG5cbm1vZHVsZS5leHBvcnRzID0gSnNvblJwY0NsaWVudDtcbiIsIi8qXG4gKiAoQykgQ29weXJpZ2h0IDIwMTQgS3VyZW50byAoaHR0cDovL2t1cmVudG8ub3JnLylcbiAqXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuICogeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4gKlxuICogICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICpcbiAqL1xuXG52YXIgV2ViU29ja2V0V2l0aFJlY29ubmVjdGlvbiAgPSByZXF1aXJlKCcuL3dlYlNvY2tldFdpdGhSZWNvbm5lY3Rpb24nKTtcblxuXG5leHBvcnRzLldlYlNvY2tldFdpdGhSZWNvbm5lY3Rpb24gID0gV2ViU29ja2V0V2l0aFJlY29ubmVjdGlvbjsiLCIvKlxuICogKEMpIENvcHlyaWdodCAyMDEzLTIwMTUgS3VyZW50byAoaHR0cDovL2t1cmVudG8ub3JnLylcbiAqXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuICogeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4gKlxuICogICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICovXG5cblwidXNlIHN0cmljdFwiO1xuXG52YXIgQnJvd3NlcldlYlNvY2tldCA9IGdsb2JhbC5XZWJTb2NrZXQgfHwgZ2xvYmFsLk1veldlYlNvY2tldDtcblxudmFyIExvZ2dlciA9IGNvbnNvbGU7XG5cbi8qKlxuICogR2V0IGVpdGhlciB0aGUgYFdlYlNvY2tldGAgb3IgYE1veldlYlNvY2tldGAgZ2xvYmFsc1xuICogaW4gdGhlIGJyb3dzZXIgb3IgdHJ5IHRvIHJlc29sdmUgV2ViU29ja2V0LWNvbXBhdGlibGVcbiAqIGludGVyZmFjZSBleHBvc2VkIGJ5IGB3c2AgZm9yIE5vZGUtbGlrZSBlbnZpcm9ubWVudC5cbiAqL1xuXG52YXIgV2ViU29ja2V0ID0gQnJvd3NlcldlYlNvY2tldDtcbmlmICghV2ViU29ja2V0ICYmIHR5cGVvZiB3aW5kb3cgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgV2ViU29ja2V0ID0gcmVxdWlyZSgnd3MnKTtcbiAgICB9IGNhdGNoIChlKSB7IH1cbn1cblxuLy92YXIgU29ja0pTID0gcmVxdWlyZSgnc29ja2pzLWNsaWVudCcpO1xuXG52YXIgTUFYX1JFVFJJRVMgPSAyMDAwOyAvLyBGb3JldmVyLi4uXG52YXIgUkVUUllfVElNRV9NUyA9IDMwMDA7IC8vIEZJWE1FOiBJbXBsZW1lbnQgZXhwb25lbnRpYWwgd2FpdCB0aW1lcy4uLlxuXG52YXIgQ09OTkVDVElORyA9IDA7XG52YXIgT1BFTiA9IDE7XG52YXIgQ0xPU0lORyA9IDI7XG52YXIgQ0xPU0VEID0gMztcblxuLypcbmNvbmZpZyA9IHtcblx0XHR1cmkgOiB3c1VyaSxcblx0XHR1c2VTb2NrSlMgOiB0cnVlICh1c2UgU29ja0pTKSAvIGZhbHNlICh1c2UgV2ViU29ja2V0KSBieSBkZWZhdWx0LFxuXHRcdG9uY29ubmVjdGVkIDogY2FsbGJhY2sgbWV0aG9kIHRvIGludm9rZSB3aGVuIGNvbm5lY3Rpb24gaXMgc3VjY2Vzc2Z1bCxcblx0XHRvbmRpc2Nvbm5lY3QgOiBjYWxsYmFjayBtZXRob2QgdG8gaW52b2tlIHdoZW4gdGhlIGNvbm5lY3Rpb24gaXMgbG9zdCxcblx0XHRvbnJlY29ubmVjdGluZyA6IGNhbGxiYWNrIG1ldGhvZCB0byBpbnZva2Ugd2hlbiB0aGUgY2xpZW50IGlzIHJlY29ubmVjdGluZyxcblx0XHRvbnJlY29ubmVjdGVkIDogY2FsbGJhY2sgbWV0aG9kIHRvIGludm9rZSB3aGVuIHRoZSBjbGllbnQgc3VjY2VzZnVsbHkgcmVjb25uZWN0cyxcblx0fTtcbiovXG5mdW5jdGlvbiBXZWJTb2NrZXRXaXRoUmVjb25uZWN0aW9uKGNvbmZpZykge1xuXG4gICAgdmFyIGNsb3NpbmcgPSBmYWxzZTtcbiAgICB2YXIgcmVnaXN0ZXJNZXNzYWdlSGFuZGxlcjtcbiAgICB2YXIgd3NVcmkgPSBjb25maWcudXJpO1xuICAgIHZhciB1c2VTb2NrSlMgPSBjb25maWcudXNlU29ja0pTO1xuICAgIHZhciByZWNvbm5lY3RpbmcgPSBmYWxzZTtcblxuICAgIHZhciBmb3JjaW5nRGlzY29ubmVjdGlvbiA9IGZhbHNlO1xuXG4gICAgdmFyIHdzO1xuXG4gICAgaWYgKHVzZVNvY2tKUykge1xuICAgICAgICB3cyA9IG5ldyBTb2NrSlMod3NVcmkpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHdzID0gbmV3IFdlYlNvY2tldCh3c1VyaSk7XG4gICAgfVxuXG4gICAgd3Mub25vcGVuID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGxvZ0Nvbm5lY3RlZCh3cywgd3NVcmkpO1xuICAgICAgICBpZiAoY29uZmlnLm9uY29ubmVjdGVkKSB7XG4gICAgICAgICAgICBjb25maWcub25jb25uZWN0ZWQoKTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICB3cy5vbmVycm9yID0gZnVuY3Rpb24oZXJyb3IpIHtcbiAgICAgICAgTG9nZ2VyLmVycm9yKFwiQ291bGQgbm90IGNvbm5lY3QgdG8gXCIgKyB3c1VyaSArIFwiIChpbnZva2luZyBvbmVycm9yIGlmIGRlZmluZWQpXCIsIGVycm9yKTtcbiAgICAgICAgaWYgKGNvbmZpZy5vbmVycm9yKSB7XG4gICAgICAgICAgICBjb25maWcub25lcnJvcihlcnJvcik7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgZnVuY3Rpb24gbG9nQ29ubmVjdGVkKHdzLCB3c1VyaSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKFwiV2ViU29ja2V0IGNvbm5lY3RlZCB0byBcIiArIHdzVXJpKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgTG9nZ2VyLmVycm9yKGUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdmFyIHJlY29ubmVjdGlvbk9uQ2xvc2UgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgaWYgKHdzLnJlYWR5U3RhdGUgPT09IENMT1NFRCkge1xuICAgICAgICAgICAgaWYgKGNsb3NpbmcpIHtcbiAgICAgICAgICAgICAgICBMb2dnZXIuZGVidWcoXCJDb25uZWN0aW9uIGNsb3NlZCBieSB1c2VyXCIpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBMb2dnZXIuZGVidWcoXCJDb25uZWN0aW9uIGNsb3NlZCB1bmV4cGVjdGVjbHkuIFJlY29ubmVjdGluZy4uLlwiKTtcbiAgICAgICAgICAgICAgICByZWNvbm5lY3RUb1NhbWVVcmkoTUFYX1JFVFJJRVMsIDEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKFwiQ2xvc2UgY2FsbGJhY2sgZnJvbSBwcmV2aW91cyB3ZWJzb2NrZXQuIElnbm9yaW5nIGl0XCIpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIHdzLm9uY2xvc2UgPSByZWNvbm5lY3Rpb25PbkNsb3NlO1xuXG4gICAgZnVuY3Rpb24gcmVjb25uZWN0VG9TYW1lVXJpKG1heFJldHJpZXMsIG51bVJldHJpZXMpIHtcbiAgICAgICAgTG9nZ2VyLmRlYnVnKFwicmVjb25uZWN0VG9TYW1lVXJpIChhdHRlbXB0ICNcIiArIG51bVJldHJpZXMgKyBcIiwgbWF4PVwiICsgbWF4UmV0cmllcyArIFwiKVwiKTtcblxuICAgICAgICBpZiAobnVtUmV0cmllcyA9PT0gMSkge1xuICAgICAgICAgICAgaWYgKHJlY29ubmVjdGluZykge1xuICAgICAgICAgICAgICAgIExvZ2dlci53YXJuKFwiVHJ5aW5nIHRvIHJlY29ubmVjdFRvTmV3VXJpIHdoZW4gcmVjb25uZWN0aW5nLi4uIElnbm9yaW5nIHRoaXMgcmVjb25uZWN0aW9uLlwiKVxuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmVjb25uZWN0aW5nID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGNvbmZpZy5vbnJlY29ubmVjdGluZykge1xuICAgICAgICAgICAgICAgIGNvbmZpZy5vbnJlY29ubmVjdGluZygpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGZvcmNpbmdEaXNjb25uZWN0aW9uKSB7XG4gICAgICAgICAgICByZWNvbm5lY3RUb05ld1VyaShtYXhSZXRyaWVzLCBudW1SZXRyaWVzLCB3c1VyaSk7XG5cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmIChjb25maWcubmV3V3NVcmlPblJlY29ubmVjdGlvbikge1xuICAgICAgICAgICAgICAgIGNvbmZpZy5uZXdXc1VyaU9uUmVjb25uZWN0aW9uKGZ1bmN0aW9uKGVycm9yLCBuZXdXc1VyaSkge1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKGVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVjb25uZWN0VG9TYW1lVXJpKG1heFJldHJpZXMsIG51bVJldHJpZXMgKyAxKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sIFJFVFJZX1RJTUVfTVMpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVjb25uZWN0VG9OZXdVcmkobWF4UmV0cmllcywgbnVtUmV0cmllcywgbmV3V3NVcmkpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmVjb25uZWN0VG9OZXdVcmkobWF4UmV0cmllcywgbnVtUmV0cmllcywgd3NVcmkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gVE9ETyBUZXN0IHJldHJpZXMuIEhvdyB0byBmb3JjZSBub3QgY29ubmVjdGlvbj9cbiAgICBmdW5jdGlvbiByZWNvbm5lY3RUb05ld1VyaShtYXhSZXRyaWVzLCBudW1SZXRyaWVzLCByZWNvbm5lY3RXc1VyaSkge1xuICAgICAgICBMb2dnZXIuZGVidWcoXCJSZWNvbm5lY3Rpb24gYXR0ZW1wdCAjXCIgKyBudW1SZXRyaWVzKTtcblxuICAgICAgICB3cy5jbG9zZSgpO1xuXG4gICAgICAgIHdzVXJpID0gcmVjb25uZWN0V3NVcmkgfHwgd3NVcmk7XG5cbiAgICAgICAgdmFyIG5ld1dzO1xuICAgICAgICBpZiAodXNlU29ja0pTKSB7XG4gICAgICAgICAgICBuZXdXcyA9IG5ldyBTb2NrSlMod3NVcmkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbmV3V3MgPSBuZXcgV2ViU29ja2V0KHdzVXJpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG5ld1dzLm9ub3BlbiA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKFwiUmVjb25uZWN0ZWQgYWZ0ZXIgXCIgKyBudW1SZXRyaWVzICsgXCIgYXR0ZW1wdHMuLi5cIik7XG4gICAgICAgICAgICBsb2dDb25uZWN0ZWQobmV3V3MsIHdzVXJpKTtcbiAgICAgICAgICAgIHJlY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgICAgICAgcmVnaXN0ZXJNZXNzYWdlSGFuZGxlcigpO1xuICAgICAgICAgICAgaWYgKGNvbmZpZy5vbnJlY29ubmVjdGVkKCkpIHtcbiAgICAgICAgICAgICAgICBjb25maWcub25yZWNvbm5lY3RlZCgpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBuZXdXcy5vbmNsb3NlID0gcmVjb25uZWN0aW9uT25DbG9zZTtcbiAgICAgICAgfTtcblxuICAgICAgICB2YXIgb25FcnJvck9yQ2xvc2UgPSBmdW5jdGlvbihlcnJvcikge1xuICAgICAgICAgICAgTG9nZ2VyLndhcm4oXCJSZWNvbm5lY3Rpb24gZXJyb3I6IFwiLCBlcnJvcik7XG5cbiAgICAgICAgICAgIGlmIChudW1SZXRyaWVzID09PSBtYXhSZXRyaWVzKSB7XG4gICAgICAgICAgICAgICAgaWYgKGNvbmZpZy5vbmRpc2Nvbm5lY3QpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uZmlnLm9uZGlzY29ubmVjdCgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVjb25uZWN0VG9TYW1lVXJpKG1heFJldHJpZXMsIG51bVJldHJpZXMgKyAxKTtcbiAgICAgICAgICAgICAgICB9LCBSRVRSWV9USU1FX01TKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICBuZXdXcy5vbmVycm9yID0gb25FcnJvck9yQ2xvc2U7XG5cbiAgICAgICAgd3MgPSBuZXdXcztcbiAgICB9XG5cbiAgICB0aGlzLmNsb3NlID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGNsb3NpbmcgPSB0cnVlO1xuICAgICAgICB3cy5jbG9zZSgpO1xuICAgIH07XG5cblxuICAgIC8vIFRoaXMgbWV0aG9kIGlzIG9ubHkgZm9yIHRlc3RpbmdcbiAgICB0aGlzLmZvcmNlQ2xvc2UgPSBmdW5jdGlvbihtaWxsaXMpIHtcbiAgICAgICAgTG9nZ2VyLmRlYnVnKFwiVGVzdGluZzogRm9yY2UgV2ViU29ja2V0IGNsb3NlXCIpO1xuXG4gICAgICAgIGlmIChtaWxsaXMpIHtcbiAgICAgICAgICAgIExvZ2dlci5kZWJ1ZyhcIlRlc3Rpbmc6IENoYW5nZSB3c1VyaSBmb3IgXCIgKyBtaWxsaXMgKyBcIiBtaWxsaXMgdG8gc2ltdWxhdGUgbmV0IGZhaWx1cmVcIik7XG4gICAgICAgICAgICB2YXIgZ29vZFdzVXJpID0gd3NVcmk7XG4gICAgICAgICAgICB3c1VyaSA9IFwid3NzOi8vMjEuMjM0LjEyLjM0LjQ6NDQzL1wiO1xuXG4gICAgICAgICAgICBmb3JjaW5nRGlzY29ubmVjdGlvbiA9IHRydWU7XG5cbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKFwiVGVzdGluZzogUmVjb3ZlciBnb29kIHdzVXJpIFwiICsgZ29vZFdzVXJpKTtcbiAgICAgICAgICAgICAgICB3c1VyaSA9IGdvb2RXc1VyaTtcblxuICAgICAgICAgICAgICAgIGZvcmNpbmdEaXNjb25uZWN0aW9uID0gZmFsc2U7XG5cbiAgICAgICAgICAgIH0sIG1pbGxpcyk7XG4gICAgICAgIH1cblxuICAgICAgICB3cy5jbG9zZSgpO1xuICAgIH07XG5cbiAgICB0aGlzLnJlY29ubmVjdFdzID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIExvZ2dlci5kZWJ1ZyhcInJlY29ubmVjdFdzXCIpO1xuICAgICAgICByZWNvbm5lY3RUb1NhbWVVcmkoTUFYX1JFVFJJRVMsIDEsIHdzVXJpKTtcbiAgICB9O1xuXG4gICAgdGhpcy5zZW5kID0gZnVuY3Rpb24obWVzc2FnZSkge1xuICAgICAgICB3cy5zZW5kKG1lc3NhZ2UpO1xuICAgIH07XG5cbiAgICB0aGlzLmFkZEV2ZW50TGlzdGVuZXIgPSBmdW5jdGlvbih0eXBlLCBjYWxsYmFjaykge1xuICAgICAgICByZWdpc3Rlck1lc3NhZ2VIYW5kbGVyID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB3cy5hZGRFdmVudExpc3RlbmVyKHR5cGUsIGNhbGxiYWNrKTtcbiAgICAgICAgfTtcblxuICAgICAgICByZWdpc3Rlck1lc3NhZ2VIYW5kbGVyKCk7XG4gICAgfTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBXZWJTb2NrZXRXaXRoUmVjb25uZWN0aW9uO1xuIiwiLypcbiAqIChDKSBDb3B5cmlnaHQgMjAxNCBLdXJlbnRvIChodHRwOi8va3VyZW50by5vcmcvKVxuICpcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqXG4gKiAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKlxuICovXG5cblxudmFyIGRlZmluZVByb3BlcnR5X0lFOCA9IGZhbHNlXG5pZihPYmplY3QuZGVmaW5lUHJvcGVydHkpXG57XG4gIHRyeVxuICB7XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHt9LCBcInhcIiwge30pO1xuICB9XG4gIGNhdGNoKGUpXG4gIHtcbiAgICBkZWZpbmVQcm9wZXJ0eV9JRTggPSB0cnVlXG4gIH1cbn1cblxuLy8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvSmF2YVNjcmlwdC9SZWZlcmVuY2UvR2xvYmFsX09iamVjdHMvRnVuY3Rpb24vYmluZFxuaWYgKCFGdW5jdGlvbi5wcm90b3R5cGUuYmluZCkge1xuICBGdW5jdGlvbi5wcm90b3R5cGUuYmluZCA9IGZ1bmN0aW9uKG9UaGlzKSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAvLyBjbG9zZXN0IHRoaW5nIHBvc3NpYmxlIHRvIHRoZSBFQ01BU2NyaXB0IDVcbiAgICAgIC8vIGludGVybmFsIElzQ2FsbGFibGUgZnVuY3Rpb25cbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0Z1bmN0aW9uLnByb3RvdHlwZS5iaW5kIC0gd2hhdCBpcyB0cnlpbmcgdG8gYmUgYm91bmQgaXMgbm90IGNhbGxhYmxlJyk7XG4gICAgfVxuXG4gICAgdmFyIGFBcmdzICAgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpLFxuICAgICAgICBmVG9CaW5kID0gdGhpcyxcbiAgICAgICAgZk5PUCAgICA9IGZ1bmN0aW9uKCkge30sXG4gICAgICAgIGZCb3VuZCAgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gZlRvQmluZC5hcHBseSh0aGlzIGluc3RhbmNlb2YgZk5PUCAmJiBvVGhpc1xuICAgICAgICAgICAgICAgICA/IHRoaXNcbiAgICAgICAgICAgICAgICAgOiBvVGhpcyxcbiAgICAgICAgICAgICAgICAgYUFyZ3MuY29uY2F0KEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cykpKTtcbiAgICAgICAgfTtcblxuICAgIGZOT1AucHJvdG90eXBlID0gdGhpcy5wcm90b3R5cGU7XG4gICAgZkJvdW5kLnByb3RvdHlwZSA9IG5ldyBmTk9QKCk7XG5cbiAgICByZXR1cm4gZkJvdW5kO1xuICB9O1xufVxuXG5cbnZhciBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXI7XG5cbnZhciBpbmhlcml0cyA9IHJlcXVpcmUoJ2luaGVyaXRzJyk7XG5cbnZhciBwYWNrZXJzID0gcmVxdWlyZSgnLi9wYWNrZXJzJyk7XG52YXIgTWFwcGVyID0gcmVxdWlyZSgnLi9NYXBwZXInKTtcblxuXG52YXIgQkFTRV9USU1FT1VUID0gNTAwMDtcblxuXG5mdW5jdGlvbiB1bmlmeVJlc3BvbnNlTWV0aG9kcyhyZXNwb25zZU1ldGhvZHMpXG57XG4gIGlmKCFyZXNwb25zZU1ldGhvZHMpIHJldHVybiB7fTtcblxuICBmb3IodmFyIGtleSBpbiByZXNwb25zZU1ldGhvZHMpXG4gIHtcbiAgICB2YXIgdmFsdWUgPSByZXNwb25zZU1ldGhvZHNba2V5XTtcblxuICAgIGlmKHR5cGVvZiB2YWx1ZSA9PSAnc3RyaW5nJylcbiAgICAgIHJlc3BvbnNlTWV0aG9kc1trZXldID1cbiAgICAgIHtcbiAgICAgICAgcmVzcG9uc2U6IHZhbHVlXG4gICAgICB9XG4gIH07XG5cbiAgcmV0dXJuIHJlc3BvbnNlTWV0aG9kcztcbn07XG5cbmZ1bmN0aW9uIHVuaWZ5VHJhbnNwb3J0KHRyYW5zcG9ydClcbntcbiAgaWYoIXRyYW5zcG9ydCkgcmV0dXJuO1xuXG4gIC8vIFRyYW5zcG9ydCBhcyBhIGZ1bmN0aW9uXG4gIGlmKHRyYW5zcG9ydCBpbnN0YW5jZW9mIEZ1bmN0aW9uKVxuICAgIHJldHVybiB7c2VuZDogdHJhbnNwb3J0fTtcblxuICAvLyBXZWJTb2NrZXQgJiBEYXRhQ2hhbm5lbFxuICBpZih0cmFuc3BvcnQuc2VuZCBpbnN0YW5jZW9mIEZ1bmN0aW9uKVxuICAgIHJldHVybiB0cmFuc3BvcnQ7XG5cbiAgLy8gTWVzc2FnZSBBUEkgKEludGVyLXdpbmRvdyAmIFdlYldvcmtlcilcbiAgaWYodHJhbnNwb3J0LnBvc3RNZXNzYWdlIGluc3RhbmNlb2YgRnVuY3Rpb24pXG4gIHtcbiAgICB0cmFuc3BvcnQuc2VuZCA9IHRyYW5zcG9ydC5wb3N0TWVzc2FnZTtcbiAgICByZXR1cm4gdHJhbnNwb3J0O1xuICB9XG5cbiAgLy8gU3RyZWFtIEFQSVxuICBpZih0cmFuc3BvcnQud3JpdGUgaW5zdGFuY2VvZiBGdW5jdGlvbilcbiAge1xuICAgIHRyYW5zcG9ydC5zZW5kID0gdHJhbnNwb3J0LndyaXRlO1xuICAgIHJldHVybiB0cmFuc3BvcnQ7XG4gIH1cblxuICAvLyBUcmFuc3BvcnRzIHRoYXQgb25seSBjYW4gcmVjZWl2ZSBtZXNzYWdlcywgYnV0IG5vdCBzZW5kXG4gIGlmKHRyYW5zcG9ydC5vbm1lc3NhZ2UgIT09IHVuZGVmaW5lZCkgcmV0dXJuO1xuICBpZih0cmFuc3BvcnQucGF1c2UgaW5zdGFuY2VvZiBGdW5jdGlvbikgcmV0dXJuO1xuXG4gIHRocm93IG5ldyBTeW50YXhFcnJvcihcIlRyYW5zcG9ydCBpcyBub3QgYSBmdW5jdGlvbiBub3IgYSB2YWxpZCBvYmplY3RcIik7XG59O1xuXG5cbi8qKlxuICogUmVwcmVzZW50YXRpb24gb2YgYSBSUEMgbm90aWZpY2F0aW9uXG4gKlxuICogQGNsYXNzXG4gKlxuICogQGNvbnN0cnVjdG9yXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG1ldGhvZCAtbWV0aG9kIG9mIHRoZSBub3RpZmljYXRpb25cbiAqIEBwYXJhbSBwYXJhbXMgLSBwYXJhbWV0ZXJzIG9mIHRoZSBub3RpZmljYXRpb25cbiAqL1xuZnVuY3Rpb24gUnBjTm90aWZpY2F0aW9uKG1ldGhvZCwgcGFyYW1zKVxue1xuICBpZihkZWZpbmVQcm9wZXJ0eV9JRTgpXG4gIHtcbiAgICB0aGlzLm1ldGhvZCA9IG1ldGhvZFxuICAgIHRoaXMucGFyYW1zID0gcGFyYW1zXG4gIH1cbiAgZWxzZVxuICB7XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsICdtZXRob2QnLCB7dmFsdWU6IG1ldGhvZCwgZW51bWVyYWJsZTogdHJ1ZX0pO1xuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0aGlzLCAncGFyYW1zJywge3ZhbHVlOiBwYXJhbXMsIGVudW1lcmFibGU6IHRydWV9KTtcbiAgfVxufTtcblxuXG4vKipcbiAqIEBjbGFzc1xuICpcbiAqIEBjb25zdHJ1Y3RvclxuICpcbiAqIEBwYXJhbSB7b2JqZWN0fSBwYWNrZXJcbiAqXG4gKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdXG4gKlxuICogQHBhcmFtIHtvYmplY3R9IFt0cmFuc3BvcnRdXG4gKlxuICogQHBhcmFtIHtGdW5jdGlvbn0gW29uUmVxdWVzdF1cbiAqL1xuZnVuY3Rpb24gUnBjQnVpbGRlcihwYWNrZXIsIG9wdGlvbnMsIHRyYW5zcG9ydCwgb25SZXF1ZXN0KVxue1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgaWYoIXBhY2tlcilcbiAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoJ1BhY2tlciBpcyBub3QgZGVmaW5lZCcpO1xuXG4gIGlmKCFwYWNrZXIucGFjayB8fCAhcGFja2VyLnVucGFjaylcbiAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoJ1BhY2tlciBpcyBpbnZhbGlkJyk7XG5cbiAgdmFyIHJlc3BvbnNlTWV0aG9kcyA9IHVuaWZ5UmVzcG9uc2VNZXRob2RzKHBhY2tlci5yZXNwb25zZU1ldGhvZHMpO1xuXG5cbiAgaWYob3B0aW9ucyBpbnN0YW5jZW9mIEZ1bmN0aW9uKVxuICB7XG4gICAgaWYodHJhbnNwb3J0ICE9IHVuZGVmaW5lZClcbiAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihcIlRoZXJlIGNhbid0IGJlIHBhcmFtZXRlcnMgYWZ0ZXIgb25SZXF1ZXN0XCIpO1xuXG4gICAgb25SZXF1ZXN0ID0gb3B0aW9ucztcbiAgICB0cmFuc3BvcnQgPSB1bmRlZmluZWQ7XG4gICAgb3B0aW9ucyAgID0gdW5kZWZpbmVkO1xuICB9O1xuXG4gIGlmKG9wdGlvbnMgJiYgb3B0aW9ucy5zZW5kIGluc3RhbmNlb2YgRnVuY3Rpb24pXG4gIHtcbiAgICBpZih0cmFuc3BvcnQgJiYgISh0cmFuc3BvcnQgaW5zdGFuY2VvZiBGdW5jdGlvbikpXG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJPbmx5IGEgZnVuY3Rpb24gY2FuIGJlIGFmdGVyIHRyYW5zcG9ydFwiKTtcblxuICAgIG9uUmVxdWVzdCA9IHRyYW5zcG9ydDtcbiAgICB0cmFuc3BvcnQgPSBvcHRpb25zO1xuICAgIG9wdGlvbnMgICA9IHVuZGVmaW5lZDtcbiAgfTtcblxuICBpZih0cmFuc3BvcnQgaW5zdGFuY2VvZiBGdW5jdGlvbilcbiAge1xuICAgIGlmKG9uUmVxdWVzdCAhPSB1bmRlZmluZWQpXG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJUaGVyZSBjYW4ndCBiZSBwYXJhbWV0ZXJzIGFmdGVyIG9uUmVxdWVzdFwiKTtcblxuICAgIG9uUmVxdWVzdCA9IHRyYW5zcG9ydDtcbiAgICB0cmFuc3BvcnQgPSB1bmRlZmluZWQ7XG4gIH07XG5cbiAgaWYodHJhbnNwb3J0ICYmIHRyYW5zcG9ydC5zZW5kIGluc3RhbmNlb2YgRnVuY3Rpb24pXG4gICAgaWYob25SZXF1ZXN0ICYmICEob25SZXF1ZXN0IGluc3RhbmNlb2YgRnVuY3Rpb24pKVxuICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiT25seSBhIGZ1bmN0aW9uIGNhbiBiZSBhZnRlciB0cmFuc3BvcnRcIik7XG5cbiAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG5cblxuICBFdmVudEVtaXR0ZXIuY2FsbCh0aGlzKTtcblxuICBpZihvblJlcXVlc3QpXG4gICAgdGhpcy5vbigncmVxdWVzdCcsIG9uUmVxdWVzdCk7XG5cblxuICBpZihkZWZpbmVQcm9wZXJ0eV9JRTgpXG4gICAgdGhpcy5wZWVySUQgPSBvcHRpb25zLnBlZXJJRFxuICBlbHNlXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsICdwZWVySUQnLCB7dmFsdWU6IG9wdGlvbnMucGVlcklEfSk7XG5cbiAgdmFyIG1heF9yZXRyaWVzID0gb3B0aW9ucy5tYXhfcmV0cmllcyB8fCAwO1xuXG5cbiAgZnVuY3Rpb24gdHJhbnNwb3J0TWVzc2FnZShldmVudClcbiAge1xuICAgIHNlbGYuZGVjb2RlKGV2ZW50LmRhdGEgfHwgZXZlbnQpO1xuICB9O1xuXG4gIHRoaXMuZ2V0VHJhbnNwb3J0ID0gZnVuY3Rpb24oKVxuICB7XG4gICAgcmV0dXJuIHRyYW5zcG9ydDtcbiAgfVxuICB0aGlzLnNldFRyYW5zcG9ydCA9IGZ1bmN0aW9uKHZhbHVlKVxuICB7XG4gICAgLy8gUmVtb3ZlIGxpc3RlbmVyIGZyb20gb2xkIHRyYW5zcG9ydFxuICAgIGlmKHRyYW5zcG9ydClcbiAgICB7XG4gICAgICAvLyBXM0MgdHJhbnNwb3J0c1xuICAgICAgaWYodHJhbnNwb3J0LnJlbW92ZUV2ZW50TGlzdGVuZXIpXG4gICAgICAgIHRyYW5zcG9ydC5yZW1vdmVFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgdHJhbnNwb3J0TWVzc2FnZSk7XG5cbiAgICAgIC8vIE5vZGUuanMgU3RyZWFtcyBBUElcbiAgICAgIGVsc2UgaWYodHJhbnNwb3J0LnJlbW92ZUxpc3RlbmVyKVxuICAgICAgICB0cmFuc3BvcnQucmVtb3ZlTGlzdGVuZXIoJ2RhdGEnLCB0cmFuc3BvcnRNZXNzYWdlKTtcbiAgICB9O1xuXG4gICAgLy8gU2V0IGxpc3RlbmVyIG9uIG5ldyB0cmFuc3BvcnRcbiAgICBpZih2YWx1ZSlcbiAgICB7XG4gICAgICAvLyBXM0MgdHJhbnNwb3J0c1xuICAgICAgaWYodmFsdWUuYWRkRXZlbnRMaXN0ZW5lcilcbiAgICAgICAgdmFsdWUuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIHRyYW5zcG9ydE1lc3NhZ2UpO1xuXG4gICAgICAvLyBOb2RlLmpzIFN0cmVhbXMgQVBJXG4gICAgICBlbHNlIGlmKHZhbHVlLmFkZExpc3RlbmVyKVxuICAgICAgICB2YWx1ZS5hZGRMaXN0ZW5lcignZGF0YScsIHRyYW5zcG9ydE1lc3NhZ2UpO1xuICAgIH07XG5cbiAgICB0cmFuc3BvcnQgPSB1bmlmeVRyYW5zcG9ydCh2YWx1ZSk7XG4gIH1cblxuICBpZighZGVmaW5lUHJvcGVydHlfSUU4KVxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0aGlzLCAndHJhbnNwb3J0JyxcbiAgICB7XG4gICAgICBnZXQ6IHRoaXMuZ2V0VHJhbnNwb3J0LmJpbmQodGhpcyksXG4gICAgICBzZXQ6IHRoaXMuc2V0VHJhbnNwb3J0LmJpbmQodGhpcylcbiAgICB9KVxuXG4gIHRoaXMuc2V0VHJhbnNwb3J0KHRyYW5zcG9ydCk7XG5cblxuICB2YXIgcmVxdWVzdF90aW1lb3V0ICAgICAgPSBvcHRpb25zLnJlcXVlc3RfdGltZW91dCAgICAgIHx8IEJBU0VfVElNRU9VVDtcbiAgdmFyIHBpbmdfcmVxdWVzdF90aW1lb3V0ID0gb3B0aW9ucy5waW5nX3JlcXVlc3RfdGltZW91dCB8fCByZXF1ZXN0X3RpbWVvdXQ7XG4gIHZhciByZXNwb25zZV90aW1lb3V0ICAgICA9IG9wdGlvbnMucmVzcG9uc2VfdGltZW91dCAgICAgfHwgQkFTRV9USU1FT1VUO1xuICB2YXIgZHVwbGljYXRlc190aW1lb3V0ICAgPSBvcHRpb25zLmR1cGxpY2F0ZXNfdGltZW91dCAgIHx8IEJBU0VfVElNRU9VVDtcblxuXG4gIHZhciByZXF1ZXN0SUQgPSAwO1xuXG4gIHZhciByZXF1ZXN0cyAgPSBuZXcgTWFwcGVyKCk7XG4gIHZhciByZXNwb25zZXMgPSBuZXcgTWFwcGVyKCk7XG4gIHZhciBwcm9jZXNzZWRSZXNwb25zZXMgPSBuZXcgTWFwcGVyKCk7XG5cbiAgdmFyIG1lc3NhZ2UyS2V5ID0ge307XG5cblxuICAvKipcbiAgICogU3RvcmUgdGhlIHJlc3BvbnNlIHRvIHByZXZlbnQgdG8gcHJvY2VzcyBkdXBsaWNhdGUgcmVxdWVzdCBsYXRlclxuICAgKi9cbiAgZnVuY3Rpb24gc3RvcmVSZXNwb25zZShtZXNzYWdlLCBpZCwgZGVzdClcbiAge1xuICAgIHZhciByZXNwb25zZSA9XG4gICAge1xuICAgICAgbWVzc2FnZTogbWVzc2FnZSxcbiAgICAgIC8qKiBUaW1lb3V0IHRvIGF1dG8tY2xlYW4gb2xkIHJlc3BvbnNlcyAqL1xuICAgICAgdGltZW91dDogc2V0VGltZW91dChmdW5jdGlvbigpXG4gICAgICB7XG4gICAgICAgIHJlc3BvbnNlcy5yZW1vdmUoaWQsIGRlc3QpO1xuICAgICAgfSxcbiAgICAgIHJlc3BvbnNlX3RpbWVvdXQpXG4gICAgfTtcblxuICAgIHJlc3BvbnNlcy5zZXQocmVzcG9uc2UsIGlkLCBkZXN0KTtcbiAgfTtcblxuICAvKipcbiAgICogU3RvcmUgdGhlIHJlc3BvbnNlIHRvIGlnbm9yZSBkdXBsaWNhdGVkIG1lc3NhZ2VzIGxhdGVyXG4gICAqL1xuICBmdW5jdGlvbiBzdG9yZVByb2Nlc3NlZFJlc3BvbnNlKGFjaywgZnJvbSlcbiAge1xuICAgIHZhciB0aW1lb3V0ID0gc2V0VGltZW91dChmdW5jdGlvbigpXG4gICAge1xuICAgICAgcHJvY2Vzc2VkUmVzcG9uc2VzLnJlbW92ZShhY2ssIGZyb20pO1xuICAgIH0sXG4gICAgZHVwbGljYXRlc190aW1lb3V0KTtcblxuICAgIHByb2Nlc3NlZFJlc3BvbnNlcy5zZXQodGltZW91dCwgYWNrLCBmcm9tKTtcbiAgfTtcblxuXG4gIC8qKlxuICAgKiBSZXByZXNlbnRhdGlvbiBvZiBhIFJQQyByZXF1ZXN0XG4gICAqXG4gICAqIEBjbGFzc1xuICAgKiBAZXh0ZW5kcyBScGNOb3RpZmljYXRpb25cbiAgICpcbiAgICogQGNvbnN0cnVjdG9yXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXRob2QgLW1ldGhvZCBvZiB0aGUgbm90aWZpY2F0aW9uXG4gICAqIEBwYXJhbSBwYXJhbXMgLSBwYXJhbWV0ZXJzIG9mIHRoZSBub3RpZmljYXRpb25cbiAgICogQHBhcmFtIHtJbnRlZ2VyfSBpZCAtIGlkZW50aWZpZXIgb2YgdGhlIHJlcXVlc3RcbiAgICogQHBhcmFtIFtmcm9tXSAtIHNvdXJjZSBvZiB0aGUgbm90aWZpY2F0aW9uXG4gICAqL1xuICBmdW5jdGlvbiBScGNSZXF1ZXN0KG1ldGhvZCwgcGFyYW1zLCBpZCwgZnJvbSwgdHJhbnNwb3J0KVxuICB7XG4gICAgUnBjTm90aWZpY2F0aW9uLmNhbGwodGhpcywgbWV0aG9kLCBwYXJhbXMpO1xuXG4gICAgdGhpcy5nZXRUcmFuc3BvcnQgPSBmdW5jdGlvbigpXG4gICAge1xuICAgICAgcmV0dXJuIHRyYW5zcG9ydDtcbiAgICB9XG4gICAgdGhpcy5zZXRUcmFuc3BvcnQgPSBmdW5jdGlvbih2YWx1ZSlcbiAgICB7XG4gICAgICB0cmFuc3BvcnQgPSB1bmlmeVRyYW5zcG9ydCh2YWx1ZSk7XG4gICAgfVxuXG4gICAgaWYoIWRlZmluZVByb3BlcnR5X0lFOClcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0aGlzLCAndHJhbnNwb3J0JyxcbiAgICAgIHtcbiAgICAgICAgZ2V0OiB0aGlzLmdldFRyYW5zcG9ydC5iaW5kKHRoaXMpLFxuICAgICAgICBzZXQ6IHRoaXMuc2V0VHJhbnNwb3J0LmJpbmQodGhpcylcbiAgICAgIH0pXG5cbiAgICB2YXIgcmVzcG9uc2UgPSByZXNwb25zZXMuZ2V0KGlkLCBmcm9tKTtcblxuICAgIC8qKlxuICAgICAqIEBjb25zdGFudCB7Qm9vbGVhbn0gZHVwbGljYXRlZFxuICAgICAqL1xuICAgIGlmKCEodHJhbnNwb3J0IHx8IHNlbGYuZ2V0VHJhbnNwb3J0KCkpKVxuICAgIHtcbiAgICAgIGlmKGRlZmluZVByb3BlcnR5X0lFOClcbiAgICAgICAgdGhpcy5kdXBsaWNhdGVkID0gQm9vbGVhbihyZXNwb25zZSlcbiAgICAgIGVsc2VcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsICdkdXBsaWNhdGVkJyxcbiAgICAgICAge1xuICAgICAgICAgIHZhbHVlOiBCb29sZWFuKHJlc3BvbnNlKVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICB2YXIgcmVzcG9uc2VNZXRob2QgPSByZXNwb25zZU1ldGhvZHNbbWV0aG9kXTtcblxuICAgIHRoaXMucGFjayA9IHBhY2tlci5wYWNrLmJpbmQocGFja2VyLCB0aGlzLCBpZClcblxuICAgIC8qKlxuICAgICAqIEdlbmVyYXRlIGEgcmVzcG9uc2UgdG8gdGhpcyByZXF1ZXN0XG4gICAgICpcbiAgICAgKiBAcGFyYW0ge0Vycm9yfSBbZXJyb3JdXG4gICAgICogQHBhcmFtIHsqfSBbcmVzdWx0XVxuICAgICAqXG4gICAgICogQHJldHVybnMge3N0cmluZ31cbiAgICAgKi9cbiAgICB0aGlzLnJlcGx5ID0gZnVuY3Rpb24oZXJyb3IsIHJlc3VsdCwgdHJhbnNwb3J0KVxuICAgIHtcbiAgICAgIC8vIEZpeCBvcHRpb25hbCBwYXJhbWV0ZXJzXG4gICAgICBpZihlcnJvciBpbnN0YW5jZW9mIEZ1bmN0aW9uIHx8IGVycm9yICYmIGVycm9yLnNlbmQgaW5zdGFuY2VvZiBGdW5jdGlvbilcbiAgICAgIHtcbiAgICAgICAgaWYocmVzdWx0ICE9IHVuZGVmaW5lZClcbiAgICAgICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJUaGVyZSBjYW4ndCBiZSBwYXJhbWV0ZXJzIGFmdGVyIGNhbGxiYWNrXCIpO1xuXG4gICAgICAgIHRyYW5zcG9ydCA9IGVycm9yO1xuICAgICAgICByZXN1bHQgPSBudWxsO1xuICAgICAgICBlcnJvciA9IHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgZWxzZSBpZihyZXN1bHQgaW5zdGFuY2VvZiBGdW5jdGlvblxuICAgICAgfHwgcmVzdWx0ICYmIHJlc3VsdC5zZW5kIGluc3RhbmNlb2YgRnVuY3Rpb24pXG4gICAgICB7XG4gICAgICAgIGlmKHRyYW5zcG9ydCAhPSB1bmRlZmluZWQpXG4gICAgICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiVGhlcmUgY2FuJ3QgYmUgcGFyYW1ldGVycyBhZnRlciBjYWxsYmFja1wiKTtcblxuICAgICAgICB0cmFuc3BvcnQgPSByZXN1bHQ7XG4gICAgICAgIHJlc3VsdCA9IG51bGw7XG4gICAgICB9O1xuXG4gICAgICB0cmFuc3BvcnQgPSB1bmlmeVRyYW5zcG9ydCh0cmFuc3BvcnQpO1xuXG4gICAgICAvLyBEdXBsaWNhdGVkIHJlcXVlc3QsIHJlbW92ZSBvbGQgcmVzcG9uc2UgdGltZW91dFxuICAgICAgaWYocmVzcG9uc2UpXG4gICAgICAgIGNsZWFyVGltZW91dChyZXNwb25zZS50aW1lb3V0KTtcblxuICAgICAgaWYoZnJvbSAhPSB1bmRlZmluZWQpXG4gICAgICB7XG4gICAgICAgIGlmKGVycm9yKVxuICAgICAgICAgIGVycm9yLmRlc3QgPSBmcm9tO1xuXG4gICAgICAgIGlmKHJlc3VsdClcbiAgICAgICAgICByZXN1bHQuZGVzdCA9IGZyb207XG4gICAgICB9O1xuXG4gICAgICB2YXIgbWVzc2FnZTtcblxuICAgICAgLy8gTmV3IHJlcXVlc3Qgb3Igb3ZlcnJpZGVuIG9uZSwgY3JlYXRlIG5ldyByZXNwb25zZSB3aXRoIHByb3ZpZGVkIGRhdGFcbiAgICAgIGlmKGVycm9yIHx8IHJlc3VsdCAhPSB1bmRlZmluZWQpXG4gICAgICB7XG4gICAgICAgIGlmKHNlbGYucGVlcklEICE9IHVuZGVmaW5lZClcbiAgICAgICAge1xuICAgICAgICAgIGlmKGVycm9yKVxuICAgICAgICAgICAgZXJyb3IuZnJvbSA9IHNlbGYucGVlcklEO1xuICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgIHJlc3VsdC5mcm9tID0gc2VsZi5wZWVySUQ7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBQcm90b2NvbCBpbmRpY2F0ZXMgdGhhdCByZXNwb25zZXMgaGFzIG93biByZXF1ZXN0IG1ldGhvZHNcbiAgICAgICAgaWYocmVzcG9uc2VNZXRob2QpXG4gICAgICAgIHtcbiAgICAgICAgICBpZihyZXNwb25zZU1ldGhvZC5lcnJvciA9PSB1bmRlZmluZWQgJiYgZXJyb3IpXG4gICAgICAgICAgICBtZXNzYWdlID1cbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgZXJyb3I6IGVycm9yXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgZWxzZVxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHZhciBtZXRob2QgPSBlcnJvclxuICAgICAgICAgICAgICAgICAgICAgICA/IHJlc3BvbnNlTWV0aG9kLmVycm9yXG4gICAgICAgICAgICAgICAgICAgICAgIDogcmVzcG9uc2VNZXRob2QucmVzcG9uc2U7XG5cbiAgICAgICAgICAgIG1lc3NhZ2UgPVxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBtZXRob2Q6IG1ldGhvZCxcbiAgICAgICAgICAgICAgcGFyYW1zOiBlcnJvciB8fCByZXN1bHRcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGVsc2VcbiAgICAgICAgICBtZXNzYWdlID1cbiAgICAgICAgICB7XG4gICAgICAgICAgICBlcnJvcjogIGVycm9yLFxuICAgICAgICAgICAgcmVzdWx0OiByZXN1bHRcbiAgICAgICAgICB9O1xuXG4gICAgICAgIG1lc3NhZ2UgPSBwYWNrZXIucGFjayhtZXNzYWdlLCBpZCk7XG4gICAgICB9XG5cbiAgICAgIC8vIER1cGxpY2F0ZSAmIG5vdC1vdmVycmlkZW4gcmVxdWVzdCwgcmUtc2VuZCBvbGQgcmVzcG9uc2VcbiAgICAgIGVsc2UgaWYocmVzcG9uc2UpXG4gICAgICAgIG1lc3NhZ2UgPSByZXNwb25zZS5tZXNzYWdlO1xuXG4gICAgICAvLyBOZXcgZW1wdHkgcmVwbHksIHJlc3BvbnNlIG51bGwgdmFsdWVcbiAgICAgIGVsc2VcbiAgICAgICAgbWVzc2FnZSA9IHBhY2tlci5wYWNrKHtyZXN1bHQ6IG51bGx9LCBpZCk7XG5cbiAgICAgIC8vIFN0b3JlIHRoZSByZXNwb25zZSB0byBwcmV2ZW50IHRvIHByb2Nlc3MgYSBkdXBsaWNhdGVkIHJlcXVlc3QgbGF0ZXJcbiAgICAgIHN0b3JlUmVzcG9uc2UobWVzc2FnZSwgaWQsIGZyb20pO1xuXG4gICAgICAvLyBSZXR1cm4gdGhlIHN0b3JlZCByZXNwb25zZSBzbyBpdCBjYW4gYmUgZGlyZWN0bHkgc2VuZCBiYWNrXG4gICAgICB0cmFuc3BvcnQgPSB0cmFuc3BvcnQgfHwgdGhpcy5nZXRUcmFuc3BvcnQoKSB8fCBzZWxmLmdldFRyYW5zcG9ydCgpO1xuXG4gICAgICBpZih0cmFuc3BvcnQpXG4gICAgICAgIHJldHVybiB0cmFuc3BvcnQuc2VuZChtZXNzYWdlKTtcblxuICAgICAgcmV0dXJuIG1lc3NhZ2U7XG4gICAgfVxuICB9O1xuICBpbmhlcml0cyhScGNSZXF1ZXN0LCBScGNOb3RpZmljYXRpb24pO1xuXG5cbiAgZnVuY3Rpb24gY2FuY2VsKG1lc3NhZ2UpXG4gIHtcbiAgICB2YXIga2V5ID0gbWVzc2FnZTJLZXlbbWVzc2FnZV07XG4gICAgaWYoIWtleSkgcmV0dXJuO1xuXG4gICAgZGVsZXRlIG1lc3NhZ2UyS2V5W21lc3NhZ2VdO1xuXG4gICAgdmFyIHJlcXVlc3QgPSByZXF1ZXN0cy5wb3Aoa2V5LmlkLCBrZXkuZGVzdCk7XG4gICAgaWYoIXJlcXVlc3QpIHJldHVybjtcblxuICAgIGNsZWFyVGltZW91dChyZXF1ZXN0LnRpbWVvdXQpO1xuXG4gICAgLy8gU3RhcnQgZHVwbGljYXRlZCByZXNwb25zZXMgdGltZW91dFxuICAgIHN0b3JlUHJvY2Vzc2VkUmVzcG9uc2Uoa2V5LmlkLCBrZXkuZGVzdCk7XG4gIH07XG5cbiAgLyoqXG4gICAqIEFsbG93IHRvIGNhbmNlbCBhIHJlcXVlc3QgYW5kIGRvbid0IHdhaXQgZm9yIGEgcmVzcG9uc2VcbiAgICpcbiAgICogSWYgYG1lc3NhZ2VgIGlzIG5vdCBnaXZlbiwgY2FuY2VsIGFsbCB0aGUgcmVxdWVzdFxuICAgKi9cbiAgdGhpcy5jYW5jZWwgPSBmdW5jdGlvbihtZXNzYWdlKVxuICB7XG4gICAgaWYobWVzc2FnZSkgcmV0dXJuIGNhbmNlbChtZXNzYWdlKTtcblxuICAgIGZvcih2YXIgbWVzc2FnZSBpbiBtZXNzYWdlMktleSlcbiAgICAgIGNhbmNlbChtZXNzYWdlKTtcbiAgfTtcblxuXG4gIHRoaXMuY2xvc2UgPSBmdW5jdGlvbigpXG4gIHtcbiAgICAvLyBQcmV2ZW50IHRvIHJlY2VpdmUgbmV3IG1lc3NhZ2VzXG4gICAgdmFyIHRyYW5zcG9ydCA9IHRoaXMuZ2V0VHJhbnNwb3J0KCk7XG4gICAgaWYodHJhbnNwb3J0ICYmIHRyYW5zcG9ydC5jbG9zZSlcbiAgICAgICB0cmFuc3BvcnQuY2xvc2UoKTtcblxuICAgIC8vIFJlcXVlc3QgJiBwcm9jZXNzZWQgcmVzcG9uc2VzXG4gICAgdGhpcy5jYW5jZWwoKTtcblxuICAgIHByb2Nlc3NlZFJlc3BvbnNlcy5mb3JFYWNoKGNsZWFyVGltZW91dCk7XG5cbiAgICAvLyBSZXNwb25zZXNcbiAgICByZXNwb25zZXMuZm9yRWFjaChmdW5jdGlvbihyZXNwb25zZSlcbiAgICB7XG4gICAgICBjbGVhclRpbWVvdXQocmVzcG9uc2UudGltZW91dCk7XG4gICAgfSk7XG4gIH07XG5cblxuICAvKipcbiAgICogR2VuZXJhdGVzIGFuZCBlbmNvZGUgYSBKc29uUlBDIDIuMCBtZXNzYWdlXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBtZXRob2QgLW1ldGhvZCBvZiB0aGUgbm90aWZpY2F0aW9uXG4gICAqIEBwYXJhbSBwYXJhbXMgLSBwYXJhbWV0ZXJzIG9mIHRoZSBub3RpZmljYXRpb25cbiAgICogQHBhcmFtIFtkZXN0XSAtIGRlc3RpbmF0aW9uIG9mIHRoZSBub3RpZmljYXRpb25cbiAgICogQHBhcmFtIHtvYmplY3R9IFt0cmFuc3BvcnRdIC0gdHJhbnNwb3J0IHdoZXJlIHRvIHNlbmQgdGhlIG1lc3NhZ2VcbiAgICogQHBhcmFtIFtjYWxsYmFja10gLSBmdW5jdGlvbiBjYWxsZWQgd2hlbiBhIHJlc3BvbnNlIHRvIHRoaXMgcmVxdWVzdCBpc1xuICAgKiAgIHJlY2VpdmVkLiBJZiBub3QgZGVmaW5lZCwgYSBub3RpZmljYXRpb24gd2lsbCBiZSBzZW5kIGluc3RlYWRcbiAgICpcbiAgICogQHJldHVybnMge3N0cmluZ30gQSByYXcgSnNvblJQQyAyLjAgcmVxdWVzdCBvciBub3RpZmljYXRpb24gc3RyaW5nXG4gICAqL1xuICB0aGlzLmVuY29kZSA9IGZ1bmN0aW9uKG1ldGhvZCwgcGFyYW1zLCBkZXN0LCB0cmFuc3BvcnQsIGNhbGxiYWNrKVxuICB7XG4gICAgLy8gRml4IG9wdGlvbmFsIHBhcmFtZXRlcnNcbiAgICBpZihwYXJhbXMgaW5zdGFuY2VvZiBGdW5jdGlvbilcbiAgICB7XG4gICAgICBpZihkZXN0ICE9IHVuZGVmaW5lZClcbiAgICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiVGhlcmUgY2FuJ3QgYmUgcGFyYW1ldGVycyBhZnRlciBjYWxsYmFja1wiKTtcblxuICAgICAgY2FsbGJhY2sgID0gcGFyYW1zO1xuICAgICAgdHJhbnNwb3J0ID0gdW5kZWZpbmVkO1xuICAgICAgZGVzdCAgICAgID0gdW5kZWZpbmVkO1xuICAgICAgcGFyYW1zICAgID0gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIGVsc2UgaWYoZGVzdCBpbnN0YW5jZW9mIEZ1bmN0aW9uKVxuICAgIHtcbiAgICAgIGlmKHRyYW5zcG9ydCAhPSB1bmRlZmluZWQpXG4gICAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihcIlRoZXJlIGNhbid0IGJlIHBhcmFtZXRlcnMgYWZ0ZXIgY2FsbGJhY2tcIik7XG5cbiAgICAgIGNhbGxiYWNrICA9IGRlc3Q7XG4gICAgICB0cmFuc3BvcnQgPSB1bmRlZmluZWQ7XG4gICAgICBkZXN0ICAgICAgPSB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgZWxzZSBpZih0cmFuc3BvcnQgaW5zdGFuY2VvZiBGdW5jdGlvbilcbiAgICB7XG4gICAgICBpZihjYWxsYmFjayAhPSB1bmRlZmluZWQpXG4gICAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihcIlRoZXJlIGNhbid0IGJlIHBhcmFtZXRlcnMgYWZ0ZXIgY2FsbGJhY2tcIik7XG5cbiAgICAgIGNhbGxiYWNrICA9IHRyYW5zcG9ydDtcbiAgICAgIHRyYW5zcG9ydCA9IHVuZGVmaW5lZDtcbiAgICB9O1xuXG4gICAgaWYoc2VsZi5wZWVySUQgIT0gdW5kZWZpbmVkKVxuICAgIHtcbiAgICAgIHBhcmFtcyA9IHBhcmFtcyB8fCB7fTtcblxuICAgICAgcGFyYW1zLmZyb20gPSBzZWxmLnBlZXJJRDtcbiAgICB9O1xuXG4gICAgaWYoZGVzdCAhPSB1bmRlZmluZWQpXG4gICAge1xuICAgICAgcGFyYW1zID0gcGFyYW1zIHx8IHt9O1xuXG4gICAgICBwYXJhbXMuZGVzdCA9IGRlc3Q7XG4gICAgfTtcblxuICAgIC8vIEVuY29kZSBtZXNzYWdlXG4gICAgdmFyIG1lc3NhZ2UgPVxuICAgIHtcbiAgICAgIG1ldGhvZDogbWV0aG9kLFxuICAgICAgcGFyYW1zOiBwYXJhbXNcbiAgICB9O1xuXG4gICAgaWYoY2FsbGJhY2spXG4gICAge1xuICAgICAgdmFyIGlkID0gcmVxdWVzdElEKys7XG4gICAgICB2YXIgcmV0cmllZCA9IDA7XG5cbiAgICAgIG1lc3NhZ2UgPSBwYWNrZXIucGFjayhtZXNzYWdlLCBpZCk7XG5cbiAgICAgIGZ1bmN0aW9uIGRpc3BhdGNoQ2FsbGJhY2soZXJyb3IsIHJlc3VsdClcbiAgICAgIHtcbiAgICAgICAgc2VsZi5jYW5jZWwobWVzc2FnZSk7XG5cbiAgICAgICAgY2FsbGJhY2soZXJyb3IsIHJlc3VsdCk7XG4gICAgICB9O1xuXG4gICAgICB2YXIgcmVxdWVzdCA9XG4gICAgICB7XG4gICAgICAgIG1lc3NhZ2U6ICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgY2FsbGJhY2s6ICAgICAgICBkaXNwYXRjaENhbGxiYWNrLFxuICAgICAgICByZXNwb25zZU1ldGhvZHM6IHJlc3BvbnNlTWV0aG9kc1ttZXRob2RdIHx8IHt9XG4gICAgICB9O1xuXG4gICAgICB2YXIgZW5jb2RlX3RyYW5zcG9ydCA9IHVuaWZ5VHJhbnNwb3J0KHRyYW5zcG9ydCk7XG5cbiAgICAgIGZ1bmN0aW9uIHNlbmRSZXF1ZXN0KHRyYW5zcG9ydClcbiAgICAgIHtcbiAgICAgICAgdmFyIHJ0ID0gKG1ldGhvZCA9PT0gJ3BpbmcnID8gcGluZ19yZXF1ZXN0X3RpbWVvdXQgOiByZXF1ZXN0X3RpbWVvdXQpO1xuICAgICAgICByZXF1ZXN0LnRpbWVvdXQgPSBzZXRUaW1lb3V0KHRpbWVvdXQsIHJ0Kk1hdGgucG93KDIsIHJldHJpZWQrKykpO1xuICAgICAgICBtZXNzYWdlMktleVttZXNzYWdlXSA9IHtpZDogaWQsIGRlc3Q6IGRlc3R9O1xuICAgICAgICByZXF1ZXN0cy5zZXQocmVxdWVzdCwgaWQsIGRlc3QpO1xuXG4gICAgICAgIHRyYW5zcG9ydCA9IHRyYW5zcG9ydCB8fCBlbmNvZGVfdHJhbnNwb3J0IHx8IHNlbGYuZ2V0VHJhbnNwb3J0KCk7XG4gICAgICAgIGlmKHRyYW5zcG9ydClcbiAgICAgICAgICByZXR1cm4gdHJhbnNwb3J0LnNlbmQobWVzc2FnZSk7XG5cbiAgICAgICAgcmV0dXJuIG1lc3NhZ2U7XG4gICAgICB9O1xuXG4gICAgICBmdW5jdGlvbiByZXRyeSh0cmFuc3BvcnQpXG4gICAgICB7XG4gICAgICAgIHRyYW5zcG9ydCA9IHVuaWZ5VHJhbnNwb3J0KHRyYW5zcG9ydCk7XG5cbiAgICAgICAgY29uc29sZS53YXJuKHJldHJpZWQrJyByZXRyeSBmb3IgcmVxdWVzdCBtZXNzYWdlOicsbWVzc2FnZSk7XG5cbiAgICAgICAgdmFyIHRpbWVvdXQgPSBwcm9jZXNzZWRSZXNwb25zZXMucG9wKGlkLCBkZXN0KTtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuXG4gICAgICAgIHJldHVybiBzZW5kUmVxdWVzdCh0cmFuc3BvcnQpO1xuICAgICAgfTtcblxuICAgICAgZnVuY3Rpb24gdGltZW91dCgpXG4gICAgICB7XG4gICAgICAgIGlmKHJldHJpZWQgPCBtYXhfcmV0cmllcylcbiAgICAgICAgICByZXR1cm4gcmV0cnkodHJhbnNwb3J0KTtcblxuICAgICAgICB2YXIgZXJyb3IgPSBuZXcgRXJyb3IoJ1JlcXVlc3QgaGFzIHRpbWVkIG91dCcpO1xuICAgICAgICAgICAgZXJyb3IucmVxdWVzdCA9IG1lc3NhZ2U7XG5cbiAgICAgICAgZXJyb3IucmV0cnkgPSByZXRyeTtcblxuICAgICAgICBkaXNwYXRjaENhbGxiYWNrKGVycm9yKVxuICAgICAgfTtcblxuICAgICAgcmV0dXJuIHNlbmRSZXF1ZXN0KHRyYW5zcG9ydCk7XG4gICAgfTtcblxuICAgIC8vIFJldHVybiB0aGUgcGFja2VkIG1lc3NhZ2VcbiAgICBtZXNzYWdlID0gcGFja2VyLnBhY2sobWVzc2FnZSk7XG5cbiAgICB0cmFuc3BvcnQgPSB0cmFuc3BvcnQgfHwgdGhpcy5nZXRUcmFuc3BvcnQoKTtcbiAgICBpZih0cmFuc3BvcnQpXG4gICAgICByZXR1cm4gdHJhbnNwb3J0LnNlbmQobWVzc2FnZSk7XG5cbiAgICByZXR1cm4gbWVzc2FnZTtcbiAgfTtcblxuICAvKipcbiAgICogRGVjb2RlIGFuZCBwcm9jZXNzIGEgSnNvblJQQyAyLjAgbWVzc2FnZVxuICAgKlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIHN0cmluZyB3aXRoIHRoZSBjb250ZW50IG9mIHRoZSBtZXNzYWdlXG4gICAqXG4gICAqIEByZXR1cm5zIHtScGNOb3RpZmljYXRpb258UnBjUmVxdWVzdHx1bmRlZmluZWR9IC0gdGhlIHJlcHJlc2VudGF0aW9uIG9mIHRoZVxuICAgKiAgIG5vdGlmaWNhdGlvbiBvciB0aGUgcmVxdWVzdC4gSWYgYSByZXNwb25zZSB3YXMgcHJvY2Vzc2VkLCBpdCB3aWxsIHJldHVyblxuICAgKiAgIGB1bmRlZmluZWRgIHRvIG5vdGlmeSB0aGF0IGl0IHdhcyBwcm9jZXNzZWRcbiAgICpcbiAgICogQHRocm93cyB7VHlwZUVycm9yfSAtIE1lc3NhZ2UgaXMgbm90IGRlZmluZWRcbiAgICovXG4gIHRoaXMuZGVjb2RlID0gZnVuY3Rpb24obWVzc2FnZSwgdHJhbnNwb3J0KVxuICB7XG4gICAgaWYoIW1lc3NhZ2UpXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiTWVzc2FnZSBpcyBub3QgZGVmaW5lZFwiKTtcblxuICAgIHRyeVxuICAgIHtcbiAgICAgIG1lc3NhZ2UgPSBwYWNrZXIudW5wYWNrKG1lc3NhZ2UpO1xuICAgIH1cbiAgICBjYXRjaChlKVxuICAgIHtcbiAgICAgIC8vIElnbm9yZSBpbnZhbGlkIG1lc3NhZ2VzXG4gICAgICByZXR1cm4gY29uc29sZS5kZWJ1ZyhlLCBtZXNzYWdlKTtcbiAgICB9O1xuXG4gICAgdmFyIGlkICAgICA9IG1lc3NhZ2UuaWQ7XG4gICAgdmFyIGFjayAgICA9IG1lc3NhZ2UuYWNrO1xuICAgIHZhciBtZXRob2QgPSBtZXNzYWdlLm1ldGhvZDtcbiAgICB2YXIgcGFyYW1zID0gbWVzc2FnZS5wYXJhbXMgfHwge307XG5cbiAgICB2YXIgZnJvbSA9IHBhcmFtcy5mcm9tO1xuICAgIHZhciBkZXN0ID0gcGFyYW1zLmRlc3Q7XG5cbiAgICAvLyBJZ25vcmUgbWVzc2FnZXMgc2VuZCBieSB1c1xuICAgIGlmKHNlbGYucGVlcklEICE9IHVuZGVmaW5lZCAmJiBmcm9tID09IHNlbGYucGVlcklEKSByZXR1cm47XG5cbiAgICAvLyBOb3RpZmljYXRpb25cbiAgICBpZihpZCA9PSB1bmRlZmluZWQgJiYgYWNrID09IHVuZGVmaW5lZClcbiAgICB7XG4gICAgICB2YXIgbm90aWZpY2F0aW9uID0gbmV3IFJwY05vdGlmaWNhdGlvbihtZXRob2QsIHBhcmFtcyk7XG5cbiAgICAgIGlmKHNlbGYuZW1pdCgncmVxdWVzdCcsIG5vdGlmaWNhdGlvbikpIHJldHVybjtcbiAgICAgIHJldHVybiBub3RpZmljYXRpb247XG4gICAgfTtcblxuXG4gICAgZnVuY3Rpb24gcHJvY2Vzc1JlcXVlc3QoKVxuICAgIHtcbiAgICAgIC8vIElmIHdlIGhhdmUgYSB0cmFuc3BvcnQgYW5kIGl0J3MgYSBkdXBsaWNhdGVkIHJlcXVlc3QsIHJlcGx5IGlubWVkaWF0bHlcbiAgICAgIHRyYW5zcG9ydCA9IHVuaWZ5VHJhbnNwb3J0KHRyYW5zcG9ydCkgfHwgc2VsZi5nZXRUcmFuc3BvcnQoKTtcbiAgICAgIGlmKHRyYW5zcG9ydClcbiAgICAgIHtcbiAgICAgICAgdmFyIHJlc3BvbnNlID0gcmVzcG9uc2VzLmdldChpZCwgZnJvbSk7XG4gICAgICAgIGlmKHJlc3BvbnNlKVxuICAgICAgICAgIHJldHVybiB0cmFuc3BvcnQuc2VuZChyZXNwb25zZS5tZXNzYWdlKTtcbiAgICAgIH07XG5cbiAgICAgIHZhciBpZEFjayA9IChpZCAhPSB1bmRlZmluZWQpID8gaWQgOiBhY2s7XG4gICAgICB2YXIgcmVxdWVzdCA9IG5ldyBScGNSZXF1ZXN0KG1ldGhvZCwgcGFyYW1zLCBpZEFjaywgZnJvbSwgdHJhbnNwb3J0KTtcblxuICAgICAgaWYoc2VsZi5lbWl0KCdyZXF1ZXN0JywgcmVxdWVzdCkpIHJldHVybjtcbiAgICAgIHJldHVybiByZXF1ZXN0O1xuICAgIH07XG5cbiAgICBmdW5jdGlvbiBwcm9jZXNzUmVzcG9uc2UocmVxdWVzdCwgZXJyb3IsIHJlc3VsdClcbiAgICB7XG4gICAgICByZXF1ZXN0LmNhbGxiYWNrKGVycm9yLCByZXN1bHQpO1xuICAgIH07XG5cbiAgICBmdW5jdGlvbiBkdXBsaWNhdGVkUmVzcG9uc2UodGltZW91dClcbiAgICB7XG4gICAgICBjb25zb2xlLndhcm4oXCJSZXNwb25zZSBhbHJlYWR5IHByb2Nlc3NlZFwiLCBtZXNzYWdlKTtcblxuICAgICAgLy8gVXBkYXRlIGR1cGxpY2F0ZWQgcmVzcG9uc2VzIHRpbWVvdXRcbiAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgIHN0b3JlUHJvY2Vzc2VkUmVzcG9uc2UoYWNrLCBmcm9tKTtcbiAgICB9O1xuXG5cbiAgICAvLyBSZXF1ZXN0LCBvciByZXNwb25zZSB3aXRoIG93biBtZXRob2RcbiAgICBpZihtZXRob2QpXG4gICAge1xuICAgICAgLy8gQ2hlY2sgaWYgaXQncyBhIHJlc3BvbnNlIHdpdGggb3duIG1ldGhvZFxuICAgICAgaWYoZGVzdCA9PSB1bmRlZmluZWQgfHwgZGVzdCA9PSBzZWxmLnBlZXJJRClcbiAgICAgIHtcbiAgICAgICAgdmFyIHJlcXVlc3QgPSByZXF1ZXN0cy5nZXQoYWNrLCBmcm9tKTtcbiAgICAgICAgaWYocmVxdWVzdClcbiAgICAgICAge1xuICAgICAgICAgIHZhciByZXNwb25zZU1ldGhvZHMgPSByZXF1ZXN0LnJlc3BvbnNlTWV0aG9kcztcblxuICAgICAgICAgIGlmKG1ldGhvZCA9PSByZXNwb25zZU1ldGhvZHMuZXJyb3IpXG4gICAgICAgICAgICByZXR1cm4gcHJvY2Vzc1Jlc3BvbnNlKHJlcXVlc3QsIHBhcmFtcyk7XG5cbiAgICAgICAgICBpZihtZXRob2QgPT0gcmVzcG9uc2VNZXRob2RzLnJlc3BvbnNlKVxuICAgICAgICAgICAgcmV0dXJuIHByb2Nlc3NSZXNwb25zZShyZXF1ZXN0LCBudWxsLCBwYXJhbXMpO1xuXG4gICAgICAgICAgcmV0dXJuIHByb2Nlc3NSZXF1ZXN0KCk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgcHJvY2Vzc2VkID0gcHJvY2Vzc2VkUmVzcG9uc2VzLmdldChhY2ssIGZyb20pO1xuICAgICAgICBpZihwcm9jZXNzZWQpXG4gICAgICAgICAgcmV0dXJuIGR1cGxpY2F0ZWRSZXNwb25zZShwcm9jZXNzZWQpO1xuICAgICAgfVxuXG4gICAgICAvLyBSZXF1ZXN0XG4gICAgICByZXR1cm4gcHJvY2Vzc1JlcXVlc3QoKTtcbiAgICB9O1xuXG4gICAgdmFyIGVycm9yICA9IG1lc3NhZ2UuZXJyb3I7XG4gICAgdmFyIHJlc3VsdCA9IG1lc3NhZ2UucmVzdWx0O1xuXG4gICAgLy8gSWdub3JlIHJlc3BvbnNlcyBub3Qgc2VuZCB0byB1c1xuICAgIGlmKGVycm9yICAmJiBlcnJvci5kZXN0ICAmJiBlcnJvci5kZXN0ICAhPSBzZWxmLnBlZXJJRCkgcmV0dXJuO1xuICAgIGlmKHJlc3VsdCAmJiByZXN1bHQuZGVzdCAmJiByZXN1bHQuZGVzdCAhPSBzZWxmLnBlZXJJRCkgcmV0dXJuO1xuXG4gICAgLy8gUmVzcG9uc2VcbiAgICB2YXIgcmVxdWVzdCA9IHJlcXVlc3RzLmdldChhY2ssIGZyb20pO1xuICAgIGlmKCFyZXF1ZXN0KVxuICAgIHtcbiAgICAgIHZhciBwcm9jZXNzZWQgPSBwcm9jZXNzZWRSZXNwb25zZXMuZ2V0KGFjaywgZnJvbSk7XG4gICAgICBpZihwcm9jZXNzZWQpXG4gICAgICAgIHJldHVybiBkdXBsaWNhdGVkUmVzcG9uc2UocHJvY2Vzc2VkKTtcblxuICAgICAgcmV0dXJuIGNvbnNvbGUud2FybihcIk5vIGNhbGxiYWNrIHdhcyBkZWZpbmVkIGZvciB0aGlzIG1lc3NhZ2VcIiwgbWVzc2FnZSk7XG4gICAgfTtcblxuICAgIC8vIFByb2Nlc3MgcmVzcG9uc2VcbiAgICBwcm9jZXNzUmVzcG9uc2UocmVxdWVzdCwgZXJyb3IsIHJlc3VsdCk7XG4gIH07XG59O1xuaW5oZXJpdHMoUnBjQnVpbGRlciwgRXZlbnRFbWl0dGVyKTtcblxuXG5ScGNCdWlsZGVyLlJwY05vdGlmaWNhdGlvbiA9IFJwY05vdGlmaWNhdGlvbjtcblxuXG5tb2R1bGUuZXhwb3J0cyA9IFJwY0J1aWxkZXI7XG5cbnZhciBjbGllbnRzID0gcmVxdWlyZSgnLi9jbGllbnRzJyk7XG52YXIgdHJhbnNwb3J0cyA9IHJlcXVpcmUoJy4vY2xpZW50cy90cmFuc3BvcnRzJyk7XG5cblJwY0J1aWxkZXIuY2xpZW50cyA9IGNsaWVudHM7XG5ScGNCdWlsZGVyLmNsaWVudHMudHJhbnNwb3J0cyA9IHRyYW5zcG9ydHM7XG5ScGNCdWlsZGVyLnBhY2tlcnMgPSBwYWNrZXJzO1xuIiwiLyoqXG4gKiBKc29uUlBDIDIuMCBwYWNrZXJcbiAqL1xuXG4vKipcbiAqIFBhY2sgYSBKc29uUlBDIDIuMCBtZXNzYWdlXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG1lc3NhZ2UgLSBvYmplY3QgdG8gYmUgcGFja2FnZWQuIEl0IHJlcXVpcmVzIHRvIGhhdmUgYWxsIHRoZVxuICogICBmaWVsZHMgbmVlZGVkIGJ5IHRoZSBKc29uUlBDIDIuMCBtZXNzYWdlIHRoYXQgaXQncyBnb2luZyB0byBiZSBnZW5lcmF0ZWRcbiAqXG4gKiBAcmV0dXJuIHtTdHJpbmd9IC0gdGhlIHN0cmluZ2lmaWVkIEpzb25SUEMgMi4wIG1lc3NhZ2VcbiAqL1xuZnVuY3Rpb24gcGFjayhtZXNzYWdlLCBpZClcbntcbiAgdmFyIHJlc3VsdCA9XG4gIHtcbiAgICBqc29ucnBjOiBcIjIuMFwiXG4gIH07XG5cbiAgLy8gUmVxdWVzdFxuICBpZihtZXNzYWdlLm1ldGhvZClcbiAge1xuICAgIHJlc3VsdC5tZXRob2QgPSBtZXNzYWdlLm1ldGhvZDtcblxuICAgIGlmKG1lc3NhZ2UucGFyYW1zKVxuICAgICAgcmVzdWx0LnBhcmFtcyA9IG1lc3NhZ2UucGFyYW1zO1xuXG4gICAgLy8gUmVxdWVzdCBpcyBhIG5vdGlmaWNhdGlvblxuICAgIGlmKGlkICE9IHVuZGVmaW5lZClcbiAgICAgIHJlc3VsdC5pZCA9IGlkO1xuICB9XG5cbiAgLy8gUmVzcG9uc2VcbiAgZWxzZSBpZihpZCAhPSB1bmRlZmluZWQpXG4gIHtcbiAgICBpZihtZXNzYWdlLmVycm9yKVxuICAgIHtcbiAgICAgIGlmKG1lc3NhZ2UucmVzdWx0ICE9PSB1bmRlZmluZWQpXG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJCb3RoIHJlc3VsdCBhbmQgZXJyb3IgYXJlIGRlZmluZWRcIik7XG5cbiAgICAgIHJlc3VsdC5lcnJvciA9IG1lc3NhZ2UuZXJyb3I7XG4gICAgfVxuICAgIGVsc2UgaWYobWVzc2FnZS5yZXN1bHQgIT09IHVuZGVmaW5lZClcbiAgICAgIHJlc3VsdC5yZXN1bHQgPSBtZXNzYWdlLnJlc3VsdDtcbiAgICBlbHNlXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiTm8gcmVzdWx0IG9yIGVycm9yIGlzIGRlZmluZWRcIik7XG5cbiAgICByZXN1bHQuaWQgPSBpZDtcbiAgfTtcblxuICByZXR1cm4gSlNPTi5zdHJpbmdpZnkocmVzdWx0KTtcbn07XG5cbi8qKlxuICogVW5wYWNrIGEgSnNvblJQQyAyLjAgbWVzc2FnZVxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBtZXNzYWdlIC0gc3RyaW5nIHdpdGggdGhlIGNvbnRlbnQgb2YgdGhlIEpzb25SUEMgMi4wIG1lc3NhZ2VcbiAqXG4gKiBAdGhyb3dzIHtUeXBlRXJyb3J9IC0gSW52YWxpZCBKc29uUlBDIHZlcnNpb25cbiAqXG4gKiBAcmV0dXJuIHtPYmplY3R9IC0gb2JqZWN0IGZpbGxlZCB3aXRoIHRoZSBKc29uUlBDIDIuMCBtZXNzYWdlIGNvbnRlbnRcbiAqL1xuZnVuY3Rpb24gdW5wYWNrKG1lc3NhZ2UpXG57XG4gIHZhciByZXN1bHQgPSBtZXNzYWdlO1xuXG4gIGlmKHR5cGVvZiBtZXNzYWdlID09PSAnc3RyaW5nJyB8fCBtZXNzYWdlIGluc3RhbmNlb2YgU3RyaW5nKSB7XG4gICAgcmVzdWx0ID0gSlNPTi5wYXJzZShtZXNzYWdlKTtcbiAgfVxuXG4gIC8vIENoZWNrIGlmIGl0J3MgYSB2YWxpZCBtZXNzYWdlXG5cbiAgdmFyIHZlcnNpb24gPSByZXN1bHQuanNvbnJwYztcbiAgaWYodmVyc2lvbiAhPT0gJzIuMCcpXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkludmFsaWQgSnNvblJQQyB2ZXJzaW9uICdcIiArIHZlcnNpb24gKyBcIic6IFwiICsgbWVzc2FnZSk7XG5cbiAgLy8gUmVzcG9uc2VcbiAgaWYocmVzdWx0Lm1ldGhvZCA9PSB1bmRlZmluZWQpXG4gIHtcbiAgICBpZihyZXN1bHQuaWQgPT0gdW5kZWZpbmVkKVxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkludmFsaWQgbWVzc2FnZTogXCIrbWVzc2FnZSk7XG5cbiAgICB2YXIgcmVzdWx0X2RlZmluZWQgPSByZXN1bHQucmVzdWx0ICE9PSB1bmRlZmluZWQ7XG4gICAgdmFyIGVycm9yX2RlZmluZWQgID0gcmVzdWx0LmVycm9yICAhPT0gdW5kZWZpbmVkO1xuXG4gICAgLy8gQ2hlY2sgb25seSByZXN1bHQgb3IgZXJyb3IgaXMgZGVmaW5lZCwgbm90IGJvdGggb3Igbm9uZVxuICAgIGlmKHJlc3VsdF9kZWZpbmVkICYmIGVycm9yX2RlZmluZWQpXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQm90aCByZXN1bHQgYW5kIGVycm9yIGFyZSBkZWZpbmVkOiBcIittZXNzYWdlKTtcblxuICAgIGlmKCFyZXN1bHRfZGVmaW5lZCAmJiAhZXJyb3JfZGVmaW5lZClcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJObyByZXN1bHQgb3IgZXJyb3IgaXMgZGVmaW5lZDogXCIrbWVzc2FnZSk7XG5cbiAgICByZXN1bHQuYWNrID0gcmVzdWx0LmlkO1xuICAgIGRlbGV0ZSByZXN1bHQuaWQ7XG4gIH1cblxuICAvLyBSZXR1cm4gdW5wYWNrZWQgbWVzc2FnZVxuICByZXR1cm4gcmVzdWx0O1xufTtcblxuXG5leHBvcnRzLnBhY2sgICA9IHBhY2s7XG5leHBvcnRzLnVucGFjayA9IHVucGFjaztcbiIsImZ1bmN0aW9uIHBhY2sobWVzc2FnZSlcbntcbiAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk5vdCB5ZXQgaW1wbGVtZW50ZWRcIik7XG59O1xuXG5mdW5jdGlvbiB1bnBhY2sobWVzc2FnZSlcbntcbiAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk5vdCB5ZXQgaW1wbGVtZW50ZWRcIik7XG59O1xuXG5cbmV4cG9ydHMucGFjayAgID0gcGFjaztcbmV4cG9ydHMudW5wYWNrID0gdW5wYWNrO1xuIiwidmFyIEpzb25SUEMgPSByZXF1aXJlKCcuL0pzb25SUEMnKTtcbnZhciBYbWxSUEMgID0gcmVxdWlyZSgnLi9YbWxSUEMnKTtcblxuXG5leHBvcnRzLkpzb25SUEMgPSBKc29uUlBDO1xuZXhwb3J0cy5YbWxSUEMgID0gWG1sUlBDO1xuIiwiLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbmZ1bmN0aW9uIEV2ZW50RW1pdHRlcigpIHtcbiAgdGhpcy5fZXZlbnRzID0gdGhpcy5fZXZlbnRzIHx8IHt9O1xuICB0aGlzLl9tYXhMaXN0ZW5lcnMgPSB0aGlzLl9tYXhMaXN0ZW5lcnMgfHwgdW5kZWZpbmVkO1xufVxubW9kdWxlLmV4cG9ydHMgPSBFdmVudEVtaXR0ZXI7XG5cbi8vIEJhY2t3YXJkcy1jb21wYXQgd2l0aCBub2RlIDAuMTAueFxuRXZlbnRFbWl0dGVyLkV2ZW50RW1pdHRlciA9IEV2ZW50RW1pdHRlcjtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fZXZlbnRzID0gdW5kZWZpbmVkO1xuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fbWF4TGlzdGVuZXJzID0gdW5kZWZpbmVkO1xuXG4vLyBCeSBkZWZhdWx0IEV2ZW50RW1pdHRlcnMgd2lsbCBwcmludCBhIHdhcm5pbmcgaWYgbW9yZSB0aGFuIDEwIGxpc3RlbmVycyBhcmVcbi8vIGFkZGVkIHRvIGl0LiBUaGlzIGlzIGEgdXNlZnVsIGRlZmF1bHQgd2hpY2ggaGVscHMgZmluZGluZyBtZW1vcnkgbGVha3MuXG5FdmVudEVtaXR0ZXIuZGVmYXVsdE1heExpc3RlbmVycyA9IDEwO1xuXG4vLyBPYnZpb3VzbHkgbm90IGFsbCBFbWl0dGVycyBzaG91bGQgYmUgbGltaXRlZCB0byAxMC4gVGhpcyBmdW5jdGlvbiBhbGxvd3Ncbi8vIHRoYXQgdG8gYmUgaW5jcmVhc2VkLiBTZXQgdG8gemVybyBmb3IgdW5saW1pdGVkLlxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5zZXRNYXhMaXN0ZW5lcnMgPSBmdW5jdGlvbihuKSB7XG4gIGlmICghaXNOdW1iZXIobikgfHwgbiA8IDAgfHwgaXNOYU4obikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCduIG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXInKTtcbiAgdGhpcy5fbWF4TGlzdGVuZXJzID0gbjtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciBlciwgaGFuZGxlciwgbGVuLCBhcmdzLCBpLCBsaXN0ZW5lcnM7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMpXG4gICAgdGhpcy5fZXZlbnRzID0ge307XG5cbiAgLy8gSWYgdGhlcmUgaXMgbm8gJ2Vycm9yJyBldmVudCBsaXN0ZW5lciB0aGVuIHRocm93LlxuICBpZiAodHlwZSA9PT0gJ2Vycm9yJykge1xuICAgIGlmICghdGhpcy5fZXZlbnRzLmVycm9yIHx8XG4gICAgICAgIChpc09iamVjdCh0aGlzLl9ldmVudHMuZXJyb3IpICYmICF0aGlzLl9ldmVudHMuZXJyb3IubGVuZ3RoKSkge1xuICAgICAgZXIgPSBhcmd1bWVudHNbMV07XG4gICAgICBpZiAoZXIgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICB0aHJvdyBlcjsgLy8gVW5oYW5kbGVkICdlcnJvcicgZXZlbnRcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEF0IGxlYXN0IGdpdmUgc29tZSBraW5kIG9mIGNvbnRleHQgdG8gdGhlIHVzZXJcbiAgICAgICAgdmFyIGVyciA9IG5ldyBFcnJvcignVW5jYXVnaHQsIHVuc3BlY2lmaWVkIFwiZXJyb3JcIiBldmVudC4gKCcgKyBlciArICcpJyk7XG4gICAgICAgIGVyci5jb250ZXh0ID0gZXI7XG4gICAgICAgIHRocm93IGVycjtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBoYW5kbGVyID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIGlmIChpc1VuZGVmaW5lZChoYW5kbGVyKSlcbiAgICByZXR1cm4gZmFsc2U7XG5cbiAgaWYgKGlzRnVuY3Rpb24oaGFuZGxlcikpIHtcbiAgICBzd2l0Y2ggKGFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICAgIC8vIGZhc3QgY2FzZXNcbiAgICAgIGNhc2UgMTpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMjpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMsIGFyZ3VtZW50c1sxXSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAzOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcywgYXJndW1lbnRzWzFdLCBhcmd1bWVudHNbMl0pO1xuICAgICAgICBicmVhaztcbiAgICAgIC8vIHNsb3dlclxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gICAgICAgIGhhbmRsZXIuYXBwbHkodGhpcywgYXJncyk7XG4gICAgfVxuICB9IGVsc2UgaWYgKGlzT2JqZWN0KGhhbmRsZXIpKSB7XG4gICAgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gICAgbGlzdGVuZXJzID0gaGFuZGxlci5zbGljZSgpO1xuICAgIGxlbiA9IGxpc3RlbmVycy5sZW5ndGg7XG4gICAgZm9yIChpID0gMDsgaSA8IGxlbjsgaSsrKVxuICAgICAgbGlzdGVuZXJzW2ldLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICB9XG5cbiAgcmV0dXJuIHRydWU7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmFkZExpc3RlbmVyID0gZnVuY3Rpb24odHlwZSwgbGlzdGVuZXIpIHtcbiAgdmFyIG07XG5cbiAgaWYgKCFpc0Z1bmN0aW9uKGxpc3RlbmVyKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzKVxuICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuXG4gIC8vIFRvIGF2b2lkIHJlY3Vyc2lvbiBpbiB0aGUgY2FzZSB0aGF0IHR5cGUgPT09IFwibmV3TGlzdGVuZXJcIiEgQmVmb3JlXG4gIC8vIGFkZGluZyBpdCB0byB0aGUgbGlzdGVuZXJzLCBmaXJzdCBlbWl0IFwibmV3TGlzdGVuZXJcIi5cbiAgaWYgKHRoaXMuX2V2ZW50cy5uZXdMaXN0ZW5lcilcbiAgICB0aGlzLmVtaXQoJ25ld0xpc3RlbmVyJywgdHlwZSxcbiAgICAgICAgICAgICAgaXNGdW5jdGlvbihsaXN0ZW5lci5saXN0ZW5lcikgP1xuICAgICAgICAgICAgICBsaXN0ZW5lci5saXN0ZW5lciA6IGxpc3RlbmVyKTtcblxuICBpZiAoIXRoaXMuX2V2ZW50c1t0eXBlXSlcbiAgICAvLyBPcHRpbWl6ZSB0aGUgY2FzZSBvZiBvbmUgbGlzdGVuZXIuIERvbid0IG5lZWQgdGhlIGV4dHJhIGFycmF5IG9iamVjdC5cbiAgICB0aGlzLl9ldmVudHNbdHlwZV0gPSBsaXN0ZW5lcjtcbiAgZWxzZSBpZiAoaXNPYmplY3QodGhpcy5fZXZlbnRzW3R5cGVdKSlcbiAgICAvLyBJZiB3ZSd2ZSBhbHJlYWR5IGdvdCBhbiBhcnJheSwganVzdCBhcHBlbmQuXG4gICAgdGhpcy5fZXZlbnRzW3R5cGVdLnB1c2gobGlzdGVuZXIpO1xuICBlbHNlXG4gICAgLy8gQWRkaW5nIHRoZSBzZWNvbmQgZWxlbWVudCwgbmVlZCB0byBjaGFuZ2UgdG8gYXJyYXkuXG4gICAgdGhpcy5fZXZlbnRzW3R5cGVdID0gW3RoaXMuX2V2ZW50c1t0eXBlXSwgbGlzdGVuZXJdO1xuXG4gIC8vIENoZWNrIGZvciBsaXN0ZW5lciBsZWFrXG4gIGlmIChpc09iamVjdCh0aGlzLl9ldmVudHNbdHlwZV0pICYmICF0aGlzLl9ldmVudHNbdHlwZV0ud2FybmVkKSB7XG4gICAgaWYgKCFpc1VuZGVmaW5lZCh0aGlzLl9tYXhMaXN0ZW5lcnMpKSB7XG4gICAgICBtID0gdGhpcy5fbWF4TGlzdGVuZXJzO1xuICAgIH0gZWxzZSB7XG4gICAgICBtID0gRXZlbnRFbWl0dGVyLmRlZmF1bHRNYXhMaXN0ZW5lcnM7XG4gICAgfVxuXG4gICAgaWYgKG0gJiYgbSA+IDAgJiYgdGhpcy5fZXZlbnRzW3R5cGVdLmxlbmd0aCA+IG0pIHtcbiAgICAgIHRoaXMuX2V2ZW50c1t0eXBlXS53YXJuZWQgPSB0cnVlO1xuICAgICAgY29uc29sZS5lcnJvcignKG5vZGUpIHdhcm5pbmc6IHBvc3NpYmxlIEV2ZW50RW1pdHRlciBtZW1vcnkgJyArXG4gICAgICAgICAgICAgICAgICAgICdsZWFrIGRldGVjdGVkLiAlZCBsaXN0ZW5lcnMgYWRkZWQuICcgK1xuICAgICAgICAgICAgICAgICAgICAnVXNlIGVtaXR0ZXIuc2V0TWF4TGlzdGVuZXJzKCkgdG8gaW5jcmVhc2UgbGltaXQuJyxcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fZXZlbnRzW3R5cGVdLmxlbmd0aCk7XG4gICAgICBpZiAodHlwZW9mIGNvbnNvbGUudHJhY2UgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgLy8gbm90IHN1cHBvcnRlZCBpbiBJRSAxMFxuICAgICAgICBjb25zb2xlLnRyYWNlKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLm9uID0gRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5hZGRMaXN0ZW5lcjtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5vbmNlID0gZnVuY3Rpb24odHlwZSwgbGlzdGVuZXIpIHtcbiAgaWYgKCFpc0Z1bmN0aW9uKGxpc3RlbmVyKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuXG4gIHZhciBmaXJlZCA9IGZhbHNlO1xuXG4gIGZ1bmN0aW9uIGcoKSB7XG4gICAgdGhpcy5yZW1vdmVMaXN0ZW5lcih0eXBlLCBnKTtcblxuICAgIGlmICghZmlyZWQpIHtcbiAgICAgIGZpcmVkID0gdHJ1ZTtcbiAgICAgIGxpc3RlbmVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfVxuICB9XG5cbiAgZy5saXN0ZW5lciA9IGxpc3RlbmVyO1xuICB0aGlzLm9uKHR5cGUsIGcpO1xuXG4gIHJldHVybiB0aGlzO1xufTtcblxuLy8gZW1pdHMgYSAncmVtb3ZlTGlzdGVuZXInIGV2ZW50IGlmZiB0aGUgbGlzdGVuZXIgd2FzIHJlbW92ZWRcbkV2ZW50RW1pdHRlci5wcm90b3R5cGUucmVtb3ZlTGlzdGVuZXIgPSBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lcikge1xuICB2YXIgbGlzdCwgcG9zaXRpb24sIGxlbmd0aCwgaTtcblxuICBpZiAoIWlzRnVuY3Rpb24obGlzdGVuZXIpKVxuICAgIHRocm93IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMgfHwgIXRoaXMuX2V2ZW50c1t0eXBlXSlcbiAgICByZXR1cm4gdGhpcztcblxuICBsaXN0ID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuICBsZW5ndGggPSBsaXN0Lmxlbmd0aDtcbiAgcG9zaXRpb24gPSAtMTtcblxuICBpZiAobGlzdCA9PT0gbGlzdGVuZXIgfHxcbiAgICAgIChpc0Z1bmN0aW9uKGxpc3QubGlzdGVuZXIpICYmIGxpc3QubGlzdGVuZXIgPT09IGxpc3RlbmVyKSkge1xuICAgIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG4gICAgaWYgKHRoaXMuX2V2ZW50cy5yZW1vdmVMaXN0ZW5lcilcbiAgICAgIHRoaXMuZW1pdCgncmVtb3ZlTGlzdGVuZXInLCB0eXBlLCBsaXN0ZW5lcik7XG5cbiAgfSBlbHNlIGlmIChpc09iamVjdChsaXN0KSkge1xuICAgIGZvciAoaSA9IGxlbmd0aDsgaS0tID4gMDspIHtcbiAgICAgIGlmIChsaXN0W2ldID09PSBsaXN0ZW5lciB8fFxuICAgICAgICAgIChsaXN0W2ldLmxpc3RlbmVyICYmIGxpc3RbaV0ubGlzdGVuZXIgPT09IGxpc3RlbmVyKSkge1xuICAgICAgICBwb3NpdGlvbiA9IGk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChwb3NpdGlvbiA8IDApXG4gICAgICByZXR1cm4gdGhpcztcblxuICAgIGlmIChsaXN0Lmxlbmd0aCA9PT0gMSkge1xuICAgICAgbGlzdC5sZW5ndGggPSAwO1xuICAgICAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgICB9IGVsc2Uge1xuICAgICAgbGlzdC5zcGxpY2UocG9zaXRpb24sIDEpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLl9ldmVudHMucmVtb3ZlTGlzdGVuZXIpXG4gICAgICB0aGlzLmVtaXQoJ3JlbW92ZUxpc3RlbmVyJywgdHlwZSwgbGlzdGVuZXIpO1xuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUFsbExpc3RlbmVycyA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgdmFyIGtleSwgbGlzdGVuZXJzO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzKVxuICAgIHJldHVybiB0aGlzO1xuXG4gIC8vIG5vdCBsaXN0ZW5pbmcgZm9yIHJlbW92ZUxpc3RlbmVyLCBubyBuZWVkIHRvIGVtaXRcbiAgaWYgKCF0aGlzLl9ldmVudHMucmVtb3ZlTGlzdGVuZXIpIHtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMClcbiAgICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuICAgIGVsc2UgaWYgKHRoaXMuX2V2ZW50c1t0eXBlXSlcbiAgICAgIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvLyBlbWl0IHJlbW92ZUxpc3RlbmVyIGZvciBhbGwgbGlzdGVuZXJzIG9uIGFsbCBldmVudHNcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApIHtcbiAgICBmb3IgKGtleSBpbiB0aGlzLl9ldmVudHMpIHtcbiAgICAgIGlmIChrZXkgPT09ICdyZW1vdmVMaXN0ZW5lcicpIGNvbnRpbnVlO1xuICAgICAgdGhpcy5yZW1vdmVBbGxMaXN0ZW5lcnMoa2V5KTtcbiAgICB9XG4gICAgdGhpcy5yZW1vdmVBbGxMaXN0ZW5lcnMoJ3JlbW92ZUxpc3RlbmVyJyk7XG4gICAgdGhpcy5fZXZlbnRzID0ge307XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBsaXN0ZW5lcnMgPSB0aGlzLl9ldmVudHNbdHlwZV07XG5cbiAgaWYgKGlzRnVuY3Rpb24obGlzdGVuZXJzKSkge1xuICAgIHRoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSwgbGlzdGVuZXJzKTtcbiAgfSBlbHNlIGlmIChsaXN0ZW5lcnMpIHtcbiAgICAvLyBMSUZPIG9yZGVyXG4gICAgd2hpbGUgKGxpc3RlbmVycy5sZW5ndGgpXG4gICAgICB0aGlzLnJlbW92ZUxpc3RlbmVyKHR5cGUsIGxpc3RlbmVyc1tsaXN0ZW5lcnMubGVuZ3RoIC0gMV0pO1xuICB9XG4gIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmxpc3RlbmVycyA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgdmFyIHJldDtcbiAgaWYgKCF0aGlzLl9ldmVudHMgfHwgIXRoaXMuX2V2ZW50c1t0eXBlXSlcbiAgICByZXQgPSBbXTtcbiAgZWxzZSBpZiAoaXNGdW5jdGlvbih0aGlzLl9ldmVudHNbdHlwZV0pKVxuICAgIHJldCA9IFt0aGlzLl9ldmVudHNbdHlwZV1dO1xuICBlbHNlXG4gICAgcmV0ID0gdGhpcy5fZXZlbnRzW3R5cGVdLnNsaWNlKCk7XG4gIHJldHVybiByZXQ7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmxpc3RlbmVyQ291bnQgPSBmdW5jdGlvbih0eXBlKSB7XG4gIGlmICh0aGlzLl9ldmVudHMpIHtcbiAgICB2YXIgZXZsaXN0ZW5lciA9IHRoaXMuX2V2ZW50c1t0eXBlXTtcblxuICAgIGlmIChpc0Z1bmN0aW9uKGV2bGlzdGVuZXIpKVxuICAgICAgcmV0dXJuIDE7XG4gICAgZWxzZSBpZiAoZXZsaXN0ZW5lcilcbiAgICAgIHJldHVybiBldmxpc3RlbmVyLmxlbmd0aDtcbiAgfVxuICByZXR1cm4gMDtcbn07XG5cbkV2ZW50RW1pdHRlci5saXN0ZW5lckNvdW50ID0gZnVuY3Rpb24oZW1pdHRlciwgdHlwZSkge1xuICByZXR1cm4gZW1pdHRlci5saXN0ZW5lckNvdW50KHR5cGUpO1xufTtcblxuZnVuY3Rpb24gaXNGdW5jdGlvbihhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdmdW5jdGlvbic7XG59XG5cbmZ1bmN0aW9uIGlzTnVtYmVyKGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ251bWJlcic7XG59XG5cbmZ1bmN0aW9uIGlzT2JqZWN0KGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ29iamVjdCcgJiYgYXJnICE9PSBudWxsO1xufVxuXG5mdW5jdGlvbiBpc1VuZGVmaW5lZChhcmcpIHtcbiAgcmV0dXJuIGFyZyA9PT0gdm9pZCAwO1xufVxuIiwiaWYgKHR5cGVvZiBPYmplY3QuY3JlYXRlID09PSAnZnVuY3Rpb24nKSB7XG4gIC8vIGltcGxlbWVudGF0aW9uIGZyb20gc3RhbmRhcmQgbm9kZS5qcyAndXRpbCcgbW9kdWxlXG4gIG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gaW5oZXJpdHMoY3Rvciwgc3VwZXJDdG9yKSB7XG4gICAgY3Rvci5zdXBlcl8gPSBzdXBlckN0b3JcbiAgICBjdG9yLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoc3VwZXJDdG9yLnByb3RvdHlwZSwge1xuICAgICAgY29uc3RydWN0b3I6IHtcbiAgICAgICAgdmFsdWU6IGN0b3IsXG4gICAgICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgICAgICB3cml0YWJsZTogdHJ1ZSxcbiAgICAgICAgY29uZmlndXJhYmxlOiB0cnVlXG4gICAgICB9XG4gICAgfSk7XG4gIH07XG59IGVsc2Uge1xuICAvLyBvbGQgc2Nob29sIHNoaW0gZm9yIG9sZCBicm93c2Vyc1xuICBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGluaGVyaXRzKGN0b3IsIHN1cGVyQ3Rvcikge1xuICAgIGN0b3Iuc3VwZXJfID0gc3VwZXJDdG9yXG4gICAgdmFyIFRlbXBDdG9yID0gZnVuY3Rpb24gKCkge31cbiAgICBUZW1wQ3Rvci5wcm90b3R5cGUgPSBzdXBlckN0b3IucHJvdG90eXBlXG4gICAgY3Rvci5wcm90b3R5cGUgPSBuZXcgVGVtcEN0b3IoKVxuICAgIGN0b3IucHJvdG90eXBlLmNvbnN0cnVjdG9yID0gY3RvclxuICB9XG59XG4iXX0=
