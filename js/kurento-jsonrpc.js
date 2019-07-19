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

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJsaWIvTWFwcGVyLmpzIiwibGliL2NsaWVudHMvaW5kZXguanMiLCJsaWIvY2xpZW50cy9qc29ucnBjY2xpZW50LmpzIiwibGliL2NsaWVudHMvdHJhbnNwb3J0cy9pbmRleC5qcyIsImxpYi9jbGllbnRzL3RyYW5zcG9ydHMvd2ViU29ja2V0V2l0aFJlY29ubmVjdGlvbi5qcyIsImxpYi9pbmRleC5qcyIsImxpYi9wYWNrZXJzL0pzb25SUEMuanMiLCJsaWIvcGFja2Vycy9YbWxSUEMuanMiLCJsaWIvcGFja2Vycy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9ldmVudHMvZXZlbnRzLmpzIiwibm9kZV9tb2R1bGVzL2luaGVyaXRzL2luaGVyaXRzX2Jyb3dzZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNwQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDbFBBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3R6QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2R0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNiQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOVNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24oKXtmdW5jdGlvbiByKGUsbix0KXtmdW5jdGlvbiBvKGksZil7aWYoIW5baV0pe2lmKCFlW2ldKXt2YXIgYz1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlO2lmKCFmJiZjKXJldHVybiBjKGksITApO2lmKHUpcmV0dXJuIHUoaSwhMCk7dmFyIGE9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitpK1wiJ1wiKTt0aHJvdyBhLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsYX12YXIgcD1uW2ldPXtleHBvcnRzOnt9fTtlW2ldWzBdLmNhbGwocC5leHBvcnRzLGZ1bmN0aW9uKHIpe3ZhciBuPWVbaV1bMV1bcl07cmV0dXJuIG8obnx8cil9LHAscC5leHBvcnRzLHIsZSxuLHQpfXJldHVybiBuW2ldLmV4cG9ydHN9Zm9yKHZhciB1PVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmUsaT0wO2k8dC5sZW5ndGg7aSsrKW8odFtpXSk7cmV0dXJuIG99cmV0dXJuIHJ9KSgpIiwiZnVuY3Rpb24gTWFwcGVyKClcbntcbiAgdmFyIHNvdXJjZXMgPSB7fTtcblxuXG4gIHRoaXMuZm9yRWFjaCA9IGZ1bmN0aW9uKGNhbGxiYWNrKVxuICB7XG4gICAgZm9yKHZhciBrZXkgaW4gc291cmNlcylcbiAgICB7XG4gICAgICB2YXIgc291cmNlID0gc291cmNlc1trZXldO1xuXG4gICAgICBmb3IodmFyIGtleTIgaW4gc291cmNlKVxuICAgICAgICBjYWxsYmFjayhzb3VyY2Vba2V5Ml0pO1xuICAgIH07XG4gIH07XG5cbiAgdGhpcy5nZXQgPSBmdW5jdGlvbihpZCwgc291cmNlKVxuICB7XG4gICAgdmFyIGlkcyA9IHNvdXJjZXNbc291cmNlXTtcbiAgICBpZihpZHMgPT0gdW5kZWZpbmVkKVxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIHJldHVybiBpZHNbaWRdO1xuICB9O1xuXG4gIHRoaXMucmVtb3ZlID0gZnVuY3Rpb24oaWQsIHNvdXJjZSlcbiAge1xuICAgIHZhciBpZHMgPSBzb3VyY2VzW3NvdXJjZV07XG4gICAgaWYoaWRzID09IHVuZGVmaW5lZClcbiAgICAgIHJldHVybjtcblxuICAgIGRlbGV0ZSBpZHNbaWRdO1xuXG4gICAgLy8gQ2hlY2sgaXQncyBlbXB0eVxuICAgIGZvcih2YXIgaSBpbiBpZHMpe3JldHVybiBmYWxzZX1cblxuICAgIGRlbGV0ZSBzb3VyY2VzW3NvdXJjZV07XG4gIH07XG5cbiAgdGhpcy5zZXQgPSBmdW5jdGlvbih2YWx1ZSwgaWQsIHNvdXJjZSlcbiAge1xuICAgIGlmKHZhbHVlID09IHVuZGVmaW5lZClcbiAgICAgIHJldHVybiB0aGlzLnJlbW92ZShpZCwgc291cmNlKTtcblxuICAgIHZhciBpZHMgPSBzb3VyY2VzW3NvdXJjZV07XG4gICAgaWYoaWRzID09IHVuZGVmaW5lZClcbiAgICAgIHNvdXJjZXNbc291cmNlXSA9IGlkcyA9IHt9O1xuXG4gICAgaWRzW2lkXSA9IHZhbHVlO1xuICB9O1xufTtcblxuXG5NYXBwZXIucHJvdG90eXBlLnBvcCA9IGZ1bmN0aW9uKGlkLCBzb3VyY2UpXG57XG4gIHZhciB2YWx1ZSA9IHRoaXMuZ2V0KGlkLCBzb3VyY2UpO1xuICBpZih2YWx1ZSA9PSB1bmRlZmluZWQpXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcblxuICB0aGlzLnJlbW92ZShpZCwgc291cmNlKTtcblxuICByZXR1cm4gdmFsdWU7XG59O1xuXG5cbm1vZHVsZS5leHBvcnRzID0gTWFwcGVyO1xuIiwiLypcbiAqIChDKSBDb3B5cmlnaHQgMjAxNCBLdXJlbnRvIChodHRwOi8va3VyZW50by5vcmcvKVxuICpcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqXG4gKiAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKlxuICovXG5cbnZhciBKc29uUnBjQ2xpZW50ICA9IHJlcXVpcmUoJy4vanNvbnJwY2NsaWVudCcpO1xuXG5cbmV4cG9ydHMuSnNvblJwY0NsaWVudCAgPSBKc29uUnBjQ2xpZW50OyIsIi8qXG4gKiAoQykgQ29weXJpZ2h0IDIwMTQgS3VyZW50byAoaHR0cDovL2t1cmVudG8ub3JnLylcbiAqXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuICogeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4gKlxuICogICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICpcbiAqL1xuXG52YXIgUnBjQnVpbGRlciA9IHJlcXVpcmUoJy4uLy4uJyk7XG52YXIgV2ViU29ja2V0V2l0aFJlY29ubmVjdGlvbiA9IHJlcXVpcmUoJy4vdHJhbnNwb3J0cy93ZWJTb2NrZXRXaXRoUmVjb25uZWN0aW9uJyk7XG5cbkRhdGUubm93ID0gRGF0ZS5ub3cgfHwgZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuICtuZXcgRGF0ZTtcbn07XG5cbnZhciBQSU5HX0lOVEVSVkFMID0gNTAwMDtcblxudmFyIFJFQ09OTkVDVElORyA9ICdSRUNPTk5FQ1RJTkcnO1xudmFyIENPTk5FQ1RFRCA9ICdDT05ORUNURUQnO1xudmFyIERJU0NPTk5FQ1RFRCA9ICdESVNDT05ORUNURUQnO1xuXG52YXIgTG9nZ2VyID0gY29uc29sZTtcblxuLyoqXG4gKlxuICogaGVhcnRiZWF0OiBpbnRlcnZhbCBpbiBtcyBmb3IgZWFjaCBoZWFydGJlYXQgbWVzc2FnZSxcbiAqIHNlbmRDbG9zZU1lc3NhZ2UgOiB0cnVlIC8gZmFsc2UsIGJlZm9yZSBjbG9zaW5nIHRoZSBjb25uZWN0aW9uLCBpdCBzZW5kcyBhIGNsb3NlU2Vzc2lvbiBtZXNzYWdlXG4gKiA8cHJlPlxuICogd3MgOiB7XG4gKiBcdHVyaSA6IFVSSSB0byBjb25udGVjdCB0byxcbiAqICB1c2VTb2NrSlMgOiB0cnVlICh1c2UgU29ja0pTKSAvIGZhbHNlICh1c2UgV2ViU29ja2V0KSBieSBkZWZhdWx0LFxuICogXHRvbmNvbm5lY3RlZCA6IGNhbGxiYWNrIG1ldGhvZCB0byBpbnZva2Ugd2hlbiBjb25uZWN0aW9uIGlzIHN1Y2Nlc3NmdWwsXG4gKiBcdG9uZGlzY29ubmVjdCA6IGNhbGxiYWNrIG1ldGhvZCB0byBpbnZva2Ugd2hlbiB0aGUgY29ubmVjdGlvbiBpcyBsb3N0LFxuICogXHRvbnJlY29ubmVjdGluZyA6IGNhbGxiYWNrIG1ldGhvZCB0byBpbnZva2Ugd2hlbiB0aGUgY2xpZW50IGlzIHJlY29ubmVjdGluZyxcbiAqIFx0b25yZWNvbm5lY3RlZCA6IGNhbGxiYWNrIG1ldGhvZCB0byBpbnZva2Ugd2hlbiB0aGUgY2xpZW50IHN1Y2Nlc2Z1bGx5IHJlY29ubmVjdHMsXG4gKiBcdG9uZXJyb3IgOiBjYWxsYmFjayBtZXRob2QgdG8gaW52b2tlIHdoZW4gdGhlcmUgaXMgYW4gZXJyb3JcbiAqIH0sXG4gKiBycGMgOiB7XG4gKiBcdHJlcXVlc3RUaW1lb3V0IDogdGltZW91dCBmb3IgYSByZXF1ZXN0LFxuICogXHRzZXNzaW9uU3RhdHVzQ2hhbmdlZDogY2FsbGJhY2sgbWV0aG9kIGZvciBjaGFuZ2VzIGluIHNlc3Npb24gc3RhdHVzLFxuICogXHRtZWRpYVJlbmVnb3RpYXRpb246IG1lZGlhUmVuZWdvdGlhdGlvblxuICogfVxuICogPC9wcmU+XG4gKi9cbmZ1bmN0aW9uIEpzb25ScGNDbGllbnQoY29uZmlndXJhdGlvbikge1xuXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgdmFyIHdzQ29uZmlnID0gY29uZmlndXJhdGlvbi53cztcblxuICAgIHZhciBub3RSZWNvbm5lY3RJZk51bUxlc3NUaGFuID0gLTE7XG5cbiAgICB2YXIgcGluZ05leHROdW0gPSAwO1xuICAgIHZhciBlbmFibGVkUGluZ3MgPSB0cnVlO1xuICAgIHZhciBwaW5nUG9uZ1N0YXJ0ZWQgPSBmYWxzZTtcbiAgICB2YXIgcGluZ0ludGVydmFsO1xuXG4gICAgdmFyIHN0YXR1cyA9IERJU0NPTk5FQ1RFRDtcblxuICAgIHZhciBvbnJlY29ubmVjdGluZyA9IHdzQ29uZmlnLm9ucmVjb25uZWN0aW5nO1xuICAgIHZhciBvbnJlY29ubmVjdGVkID0gd3NDb25maWcub25yZWNvbm5lY3RlZDtcbiAgICB2YXIgb25jb25uZWN0ZWQgPSB3c0NvbmZpZy5vbmNvbm5lY3RlZDtcbiAgICB2YXIgb25lcnJvciA9IHdzQ29uZmlnLm9uZXJyb3I7XG5cbiAgICBjb25maWd1cmF0aW9uLnJwYy5wdWxsID0gZnVuY3Rpb24ocGFyYW1zLCByZXF1ZXN0KSB7XG4gICAgICAgIHJlcXVlc3QucmVwbHkobnVsbCwgXCJwdXNoXCIpO1xuICAgIH1cblxuICAgIHdzQ29uZmlnLm9ucmVjb25uZWN0aW5nID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIExvZ2dlci5kZWJ1ZyhcIi0tLS0tLS0tLSBPTlJFQ09OTkVDVElORyAtLS0tLS0tLS0tLVwiKTtcbiAgICAgICAgaWYgKHN0YXR1cyA9PT0gUkVDT05ORUNUSU5HKSB7XG4gICAgICAgICAgICBMb2dnZXIuZXJyb3IoXCJXZWJzb2NrZXQgYWxyZWFkeSBpbiBSRUNPTk5FQ1RJTkcgc3RhdGUgd2hlbiByZWNlaXZpbmcgYSBuZXcgT05SRUNPTk5FQ1RJTkcgbWVzc2FnZS4gSWdub3JpbmcgaXRcIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBzdGF0dXMgPSBSRUNPTk5FQ1RJTkc7XG4gICAgICAgIGlmIChvbnJlY29ubmVjdGluZykge1xuICAgICAgICAgICAgb25yZWNvbm5lY3RpbmcoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHdzQ29uZmlnLm9ucmVjb25uZWN0ZWQgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgTG9nZ2VyLmRlYnVnKFwiLS0tLS0tLS0tIE9OUkVDT05ORUNURUQgLS0tLS0tLS0tLS1cIik7XG4gICAgICAgIGlmIChzdGF0dXMgPT09IENPTk5FQ1RFRCkge1xuICAgICAgICAgICAgTG9nZ2VyLmVycm9yKFwiV2Vic29ja2V0IGFscmVhZHkgaW4gQ09OTkVDVEVEIHN0YXRlIHdoZW4gcmVjZWl2aW5nIGEgbmV3IE9OUkVDT05ORUNURUQgbWVzc2FnZS4gSWdub3JpbmcgaXRcIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgc3RhdHVzID0gQ09OTkVDVEVEO1xuXG4gICAgICAgIGVuYWJsZWRQaW5ncyA9IHRydWU7XG4gICAgICAgIHVwZGF0ZU5vdFJlY29ubmVjdElmTGVzc1RoYW4oKTtcbiAgICAgICAgdXNlUGluZygpO1xuXG4gICAgICAgIGlmIChvbnJlY29ubmVjdGVkKSB7XG4gICAgICAgICAgICBvbnJlY29ubmVjdGVkKCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB3c0NvbmZpZy5vbmNvbm5lY3RlZCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBMb2dnZXIuZGVidWcoXCItLS0tLS0tLS0gT05DT05ORUNURUQgLS0tLS0tLS0tLS1cIik7XG4gICAgICAgIGlmIChzdGF0dXMgPT09IENPTk5FQ1RFRCkge1xuICAgICAgICAgICAgTG9nZ2VyLmVycm9yKFwiV2Vic29ja2V0IGFscmVhZHkgaW4gQ09OTkVDVEVEIHN0YXRlIHdoZW4gcmVjZWl2aW5nIGEgbmV3IE9OQ09OTkVDVEVEIG1lc3NhZ2UuIElnbm9yaW5nIGl0XCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHN0YXR1cyA9IENPTk5FQ1RFRDtcblxuICAgICAgICBlbmFibGVkUGluZ3MgPSB0cnVlO1xuICAgICAgICB1c2VQaW5nKCk7XG5cbiAgICAgICAgaWYgKG9uY29ubmVjdGVkKSB7XG4gICAgICAgICAgICBvbmNvbm5lY3RlZCgpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgd3NDb25maWcub25lcnJvciA9IGZ1bmN0aW9uKGVycm9yKSB7XG4gICAgICAgIExvZ2dlci5kZWJ1ZyhcIi0tLS0tLS0tLSBPTkVSUk9SIC0tLS0tLS0tLS0tXCIpO1xuXG4gICAgICAgIHN0YXR1cyA9IERJU0NPTk5FQ1RFRDtcblxuICAgICAgICBpZiAob25lcnJvcikge1xuICAgICAgICAgICAgb25lcnJvcihlcnJvcik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgd3MgPSBuZXcgV2ViU29ja2V0V2l0aFJlY29ubmVjdGlvbih3c0NvbmZpZyk7XG5cbiAgICBMb2dnZXIuZGVidWcoJ0Nvbm5lY3Rpbmcgd2Vic29ja2V0IHRvIFVSSTogJyArIHdzQ29uZmlnLnVyaSk7XG5cbiAgICB2YXIgcnBjQnVpbGRlck9wdGlvbnMgPSB7XG4gICAgICAgIHJlcXVlc3RfdGltZW91dDogY29uZmlndXJhdGlvbi5ycGMucmVxdWVzdFRpbWVvdXQsXG4gICAgICAgIHBpbmdfcmVxdWVzdF90aW1lb3V0OiBjb25maWd1cmF0aW9uLnJwYy5oZWFydGJlYXRSZXF1ZXN0VGltZW91dFxuICAgIH07XG5cbiAgICB2YXIgcnBjID0gbmV3IFJwY0J1aWxkZXIoUnBjQnVpbGRlci5wYWNrZXJzLkpzb25SUEMsIHJwY0J1aWxkZXJPcHRpb25zLCB3cyxcbiAgICAgICAgZnVuY3Rpb24ocmVxdWVzdCkge1xuXG4gICAgICAgICAgICBMb2dnZXIuZGVidWcoJ1JlY2VpdmVkIHJlcXVlc3Q6ICcgKyBKU09OLnN0cmluZ2lmeShyZXF1ZXN0KSk7XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdmFyIGZ1bmMgPSBjb25maWd1cmF0aW9uLnJwY1tyZXF1ZXN0Lm1ldGhvZF07XG5cbiAgICAgICAgICAgICAgICBpZiAoZnVuYyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIExvZ2dlci5lcnJvcihcIk1ldGhvZCBcIiArIHJlcXVlc3QubWV0aG9kICsgXCIgbm90IHJlZ2lzdGVyZWQgaW4gY2xpZW50XCIpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGZ1bmMocmVxdWVzdC5wYXJhbXMsIHJlcXVlc3QpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgICAgICAgIExvZ2dlci5lcnJvcignRXhjZXB0aW9uIHByb2Nlc3NpbmcgcmVxdWVzdDogJyArIEpTT04uc3RyaW5naWZ5KHJlcXVlc3QpKTtcbiAgICAgICAgICAgICAgICBMb2dnZXIuZXJyb3IoZXJyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICB0aGlzLnNlbmQgPSBmdW5jdGlvbihtZXRob2QsIHBhcmFtcywgY2FsbGJhY2spIHtcbiAgICAgICAgaWYgKG1ldGhvZCAhPT0gJ3BpbmcnKSB7XG4gICAgICAgICAgICBMb2dnZXIuZGVidWcoJ1JlcXVlc3Q6IG1ldGhvZDonICsgbWV0aG9kICsgXCIgcGFyYW1zOlwiICsgSlNPTi5zdHJpbmdpZnkocGFyYW1zKSk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgcmVxdWVzdFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgICAgIHJwYy5lbmNvZGUobWV0aG9kLCBwYXJhbXMsIGZ1bmN0aW9uKGVycm9yLCByZXN1bHQpIHtcbiAgICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIExvZ2dlci5lcnJvcihcIkVSUk9SOlwiICsgZXJyb3IubWVzc2FnZSArIFwiIGluIFJlcXVlc3Q6IG1ldGhvZDpcIiArXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXRob2QgKyBcIiBwYXJhbXM6XCIgKyBKU09OLnN0cmluZ2lmeShwYXJhbXMpICsgXCIgcmVxdWVzdDpcIiArXG4gICAgICAgICAgICAgICAgICAgICAgICBlcnJvci5yZXF1ZXN0KTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGVycm9yLmRhdGEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIExvZ2dlci5lcnJvcihcIkVSUk9SIERBVEE6XCIgKyBKU09OLnN0cmluZ2lmeShlcnJvci5kYXRhKSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7fVxuICAgICAgICAgICAgICAgIGVycm9yLnJlcXVlc3RUaW1lID0gcmVxdWVzdFRpbWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgICAgICBpZiAocmVzdWx0ICE9IHVuZGVmaW5lZCAmJiByZXN1bHQudmFsdWUgIT09ICdwb25nJykge1xuICAgICAgICAgICAgICAgICAgICBMb2dnZXIuZGVidWcoJ1Jlc3BvbnNlOiAnICsgSlNPTi5zdHJpbmdpZnkocmVzdWx0KSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNhbGxiYWNrKGVycm9yLCByZXN1bHQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB1cGRhdGVOb3RSZWNvbm5lY3RJZkxlc3NUaGFuKCkge1xuICAgICAgICBMb2dnZXIuZGVidWcoXCJub3RSZWNvbm5lY3RJZk51bUxlc3NUaGFuID0gXCIgKyBwaW5nTmV4dE51bSArICcgKG9sZD0nICtcbiAgICAgICAgICAgIG5vdFJlY29ubmVjdElmTnVtTGVzc1RoYW4gKyAnKScpO1xuICAgICAgICBub3RSZWNvbm5lY3RJZk51bUxlc3NUaGFuID0gcGluZ05leHROdW07XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2VuZFBpbmcoKSB7XG4gICAgICAgIGlmIChlbmFibGVkUGluZ3MpIHtcbiAgICAgICAgICAgIHZhciBwYXJhbXMgPSBudWxsO1xuICAgICAgICAgICAgaWYgKHBpbmdOZXh0TnVtID09IDAgfHwgcGluZ05leHROdW0gPT0gbm90UmVjb25uZWN0SWZOdW1MZXNzVGhhbikge1xuICAgICAgICAgICAgICAgIHBhcmFtcyA9IHtcbiAgICAgICAgICAgICAgICAgICAgaW50ZXJ2YWw6IGNvbmZpZ3VyYXRpb24uaGVhcnRiZWF0IHx8IFBJTkdfSU5URVJWQUxcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcGluZ05leHROdW0rKztcblxuICAgICAgICAgICAgc2VsZi5zZW5kKCdwaW5nJywgcGFyYW1zLCAoZnVuY3Rpb24ocGluZ051bSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbihlcnJvciwgcmVzdWx0KSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKFwiRXJyb3IgaW4gcGluZyByZXF1ZXN0ICNcIiArIHBpbmdOdW0gKyBcIiAoXCIgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yLm1lc3NhZ2UgKyBcIilcIik7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocGluZ051bSA+IG5vdFJlY29ubmVjdElmTnVtTGVzc1RoYW4pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbmFibGVkUGluZ3MgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB1cGRhdGVOb3RSZWNvbm5lY3RJZkxlc3NUaGFuKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKFwiU2VydmVyIGRpZCBub3QgcmVzcG9uZCB0byBwaW5nIG1lc3NhZ2UgI1wiICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGluZ051bSArIFwiLiBSZWNvbm5lY3RpbmcuLi4gXCIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdzLnJlY29ubmVjdFdzKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KShwaW5nTmV4dE51bSkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKFwiVHJ5aW5nIHRvIHNlbmQgcGluZywgYnV0IHBpbmcgaXMgbm90IGVuYWJsZWRcIik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKlxuICAgICogSWYgY29uZmlndXJhdGlvbi5oZWFyYmVhdCBoYXMgYW55IHZhbHVlLCB0aGUgcGluZy1wb25nIHdpbGwgd29yayB3aXRoIHRoZSBpbnRlcnZhbFxuICAgICogb2YgY29uZmlndXJhdGlvbi5oZWFyYmVhdFxuICAgICovXG4gICAgZnVuY3Rpb24gdXNlUGluZygpIHtcbiAgICAgICAgaWYgKCFwaW5nUG9uZ1N0YXJ0ZWQpIHtcbiAgICAgICAgICAgIExvZ2dlci5kZWJ1ZyhcIlN0YXJ0aW5nIHBpbmcgKGlmIGNvbmZpZ3VyZWQpXCIpXG4gICAgICAgICAgICBwaW5nUG9uZ1N0YXJ0ZWQgPSB0cnVlO1xuXG4gICAgICAgICAgICBpZiAoY29uZmlndXJhdGlvbi5oZWFydGJlYXQgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgcGluZ0ludGVydmFsID0gc2V0SW50ZXJ2YWwoc2VuZFBpbmcsIGNvbmZpZ3VyYXRpb24uaGVhcnRiZWF0KTtcbiAgICAgICAgICAgICAgICBzZW5kUGluZygpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5jbG9zZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBMb2dnZXIuZGVidWcoXCJDbG9zaW5nIGpzb25ScGNDbGllbnQgZXhwbGljaXRseSBieSBjbGllbnRcIik7XG5cbiAgICAgICAgaWYgKHBpbmdJbnRlcnZhbCAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIExvZ2dlci5kZWJ1ZyhcIkNsZWFyaW5nIHBpbmcgaW50ZXJ2YWxcIik7XG4gICAgICAgICAgICBjbGVhckludGVydmFsKHBpbmdJbnRlcnZhbCk7XG4gICAgICAgIH1cbiAgICAgICAgcGluZ1BvbmdTdGFydGVkID0gZmFsc2U7XG4gICAgICAgIGVuYWJsZWRQaW5ncyA9IGZhbHNlO1xuXG4gICAgICAgIGlmIChjb25maWd1cmF0aW9uLnNlbmRDbG9zZU1lc3NhZ2UpIHtcbiAgICAgICAgICAgIExvZ2dlci5kZWJ1ZyhcIlNlbmRpbmcgY2xvc2UgbWVzc2FnZVwiKVxuICAgICAgICAgICAgdGhpcy5zZW5kKCdjbG9zZVNlc3Npb24nLCBudWxsLCBmdW5jdGlvbihlcnJvciwgcmVzdWx0KSB7XG4gICAgICAgICAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIExvZ2dlci5lcnJvcihcIkVycm9yIHNlbmRpbmcgY2xvc2UgbWVzc2FnZTogXCIgKyBKU09OLnN0cmluZ2lmeShlcnJvcikpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB3cy5jbG9zZSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG5cdFx0XHR3cy5jbG9zZSgpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gVGhpcyBtZXRob2QgaXMgb25seSBmb3IgdGVzdGluZ1xuICAgIHRoaXMuZm9yY2VDbG9zZSA9IGZ1bmN0aW9uKG1pbGxpcykge1xuICAgICAgICB3cy5mb3JjZUNsb3NlKG1pbGxpcyk7XG4gICAgfVxuXG4gICAgdGhpcy5yZWNvbm5lY3QgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgd3MucmVjb25uZWN0V3MoKTtcbiAgICB9XG59XG5cblxubW9kdWxlLmV4cG9ydHMgPSBKc29uUnBjQ2xpZW50O1xuIiwiLypcbiAqIChDKSBDb3B5cmlnaHQgMjAxNCBLdXJlbnRvIChodHRwOi8va3VyZW50by5vcmcvKVxuICpcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqXG4gKiAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKlxuICovXG5cbnZhciBXZWJTb2NrZXRXaXRoUmVjb25uZWN0aW9uICA9IHJlcXVpcmUoJy4vd2ViU29ja2V0V2l0aFJlY29ubmVjdGlvbicpO1xuXG5cbmV4cG9ydHMuV2ViU29ja2V0V2l0aFJlY29ubmVjdGlvbiAgPSBXZWJTb2NrZXRXaXRoUmVjb25uZWN0aW9uOyIsIi8qXG4gKiAoQykgQ29weXJpZ2h0IDIwMTMtMjAxNSBLdXJlbnRvIChodHRwOi8va3VyZW50by5vcmcvKVxuICpcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqXG4gKiAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKi9cblxuXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciBCcm93c2VyV2ViU29ja2V0ID0gZ2xvYmFsLldlYlNvY2tldCB8fCBnbG9iYWwuTW96V2ViU29ja2V0O1xuXG52YXIgTG9nZ2VyID0gY29uc29sZTtcblxuLyoqXG4gKiBHZXQgZWl0aGVyIHRoZSBgV2ViU29ja2V0YCBvciBgTW96V2ViU29ja2V0YCBnbG9iYWxzXG4gKiBpbiB0aGUgYnJvd3NlciBvciB0cnkgdG8gcmVzb2x2ZSBXZWJTb2NrZXQtY29tcGF0aWJsZVxuICogaW50ZXJmYWNlIGV4cG9zZWQgYnkgYHdzYCBmb3IgTm9kZS1saWtlIGVudmlyb25tZW50LlxuICovXG5cbnZhciBXZWJTb2NrZXQgPSBCcm93c2VyV2ViU29ja2V0O1xuaWYgKCFXZWJTb2NrZXQgJiYgdHlwZW9mIHdpbmRvdyA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICB0cnkge1xuICAgICAgICBXZWJTb2NrZXQgPSByZXF1aXJlKCd3cycpO1xuICAgIH0gY2F0Y2ggKGUpIHsgfVxufVxuXG4vL3ZhciBTb2NrSlMgPSByZXF1aXJlKCdzb2NranMtY2xpZW50Jyk7XG5cbnZhciBNQVhfUkVUUklFUyA9IDIwMDA7IC8vIEZvcmV2ZXIuLi5cbnZhciBSRVRSWV9USU1FX01TID0gMzAwMDsgLy8gRklYTUU6IEltcGxlbWVudCBleHBvbmVudGlhbCB3YWl0IHRpbWVzLi4uXG5cbnZhciBDT05ORUNUSU5HID0gMDtcbnZhciBPUEVOID0gMTtcbnZhciBDTE9TSU5HID0gMjtcbnZhciBDTE9TRUQgPSAzO1xuXG4vKlxuY29uZmlnID0ge1xuXHRcdHVyaSA6IHdzVXJpLFxuXHRcdHVzZVNvY2tKUyA6IHRydWUgKHVzZSBTb2NrSlMpIC8gZmFsc2UgKHVzZSBXZWJTb2NrZXQpIGJ5IGRlZmF1bHQsXG5cdFx0b25jb25uZWN0ZWQgOiBjYWxsYmFjayBtZXRob2QgdG8gaW52b2tlIHdoZW4gY29ubmVjdGlvbiBpcyBzdWNjZXNzZnVsLFxuXHRcdG9uZGlzY29ubmVjdCA6IGNhbGxiYWNrIG1ldGhvZCB0byBpbnZva2Ugd2hlbiB0aGUgY29ubmVjdGlvbiBpcyBsb3N0LFxuXHRcdG9ucmVjb25uZWN0aW5nIDogY2FsbGJhY2sgbWV0aG9kIHRvIGludm9rZSB3aGVuIHRoZSBjbGllbnQgaXMgcmVjb25uZWN0aW5nLFxuXHRcdG9ucmVjb25uZWN0ZWQgOiBjYWxsYmFjayBtZXRob2QgdG8gaW52b2tlIHdoZW4gdGhlIGNsaWVudCBzdWNjZXNmdWxseSByZWNvbm5lY3RzLFxuXHR9O1xuKi9cbmZ1bmN0aW9uIFdlYlNvY2tldFdpdGhSZWNvbm5lY3Rpb24oY29uZmlnKSB7XG5cbiAgICB2YXIgY2xvc2luZyA9IGZhbHNlO1xuICAgIHZhciByZWdpc3Rlck1lc3NhZ2VIYW5kbGVyO1xuICAgIHZhciB3c1VyaSA9IGNvbmZpZy51cmk7XG4gICAgdmFyIHVzZVNvY2tKUyA9IGNvbmZpZy51c2VTb2NrSlM7XG4gICAgdmFyIHJlY29ubmVjdGluZyA9IGZhbHNlO1xuXG4gICAgdmFyIGZvcmNpbmdEaXNjb25uZWN0aW9uID0gZmFsc2U7XG5cbiAgICB2YXIgd3M7XG5cbiAgICBpZiAodXNlU29ja0pTKSB7XG4gICAgICAgIHdzID0gbmV3IFNvY2tKUyh3c1VyaSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgd3MgPSBuZXcgV2ViU29ja2V0KHdzVXJpKTtcbiAgICB9XG5cbiAgICB3cy5vbm9wZW4gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgbG9nQ29ubmVjdGVkKHdzLCB3c1VyaSk7XG4gICAgICAgIGlmIChjb25maWcub25jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIGNvbmZpZy5vbmNvbm5lY3RlZCgpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIHdzLm9uZXJyb3IgPSBmdW5jdGlvbihlcnJvcikge1xuICAgICAgICBMb2dnZXIuZXJyb3IoXCJDb3VsZCBub3QgY29ubmVjdCB0byBcIiArIHdzVXJpICsgXCIgKGludm9raW5nIG9uZXJyb3IgaWYgZGVmaW5lZClcIiwgZXJyb3IpO1xuICAgICAgICBpZiAoY29uZmlnLm9uZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbmZpZy5vbmVycm9yKGVycm9yKTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBmdW5jdGlvbiBsb2dDb25uZWN0ZWQod3MsIHdzVXJpKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBMb2dnZXIuZGVidWcoXCJXZWJTb2NrZXQgY29ubmVjdGVkIHRvIFwiICsgd3NVcmkpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICBMb2dnZXIuZXJyb3IoZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgcmVjb25uZWN0aW9uT25DbG9zZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBpZiAod3MucmVhZHlTdGF0ZSA9PT0gQ0xPU0VEKSB7XG4gICAgICAgICAgICBpZiAoY2xvc2luZykge1xuICAgICAgICAgICAgICAgIExvZ2dlci5kZWJ1ZyhcIkNvbm5lY3Rpb24gY2xvc2VkIGJ5IHVzZXJcIik7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIExvZ2dlci5kZWJ1ZyhcIkNvbm5lY3Rpb24gY2xvc2VkIHVuZXhwZWN0ZWNseS4gUmVjb25uZWN0aW5nLi4uXCIpO1xuICAgICAgICAgICAgICAgIHJlY29ubmVjdFRvU2FtZVVyaShNQVhfUkVUUklFUywgMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBMb2dnZXIuZGVidWcoXCJDbG9zZSBjYWxsYmFjayBmcm9tIHByZXZpb3VzIHdlYnNvY2tldC4gSWdub3JpbmcgaXRcIik7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgd3Mub25jbG9zZSA9IHJlY29ubmVjdGlvbk9uQ2xvc2U7XG5cbiAgICBmdW5jdGlvbiByZWNvbm5lY3RUb1NhbWVVcmkobWF4UmV0cmllcywgbnVtUmV0cmllcykge1xuICAgICAgICBMb2dnZXIuZGVidWcoXCJyZWNvbm5lY3RUb1NhbWVVcmkgKGF0dGVtcHQgI1wiICsgbnVtUmV0cmllcyArIFwiLCBtYXg9XCIgKyBtYXhSZXRyaWVzICsgXCIpXCIpO1xuXG4gICAgICAgIGlmIChudW1SZXRyaWVzID09PSAxKSB7XG4gICAgICAgICAgICBpZiAocmVjb25uZWN0aW5nKSB7XG4gICAgICAgICAgICAgICAgTG9nZ2VyLndhcm4oXCJUcnlpbmcgdG8gcmVjb25uZWN0VG9OZXdVcmkgd2hlbiByZWNvbm5lY3RpbmcuLi4gSWdub3JpbmcgdGhpcyByZWNvbm5lY3Rpb24uXCIpXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZWNvbm5lY3RpbmcgPSB0cnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoY29uZmlnLm9ucmVjb25uZWN0aW5nKSB7XG4gICAgICAgICAgICAgICAgY29uZmlnLm9ucmVjb25uZWN0aW5nKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZm9yY2luZ0Rpc2Nvbm5lY3Rpb24pIHtcbiAgICAgICAgICAgIHJlY29ubmVjdFRvTmV3VXJpKG1heFJldHJpZXMsIG51bVJldHJpZXMsIHdzVXJpKTtcblxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaWYgKGNvbmZpZy5uZXdXc1VyaU9uUmVjb25uZWN0aW9uKSB7XG4gICAgICAgICAgICAgICAgY29uZmlnLm5ld1dzVXJpT25SZWNvbm5lY3Rpb24oZnVuY3Rpb24oZXJyb3IsIG5ld1dzVXJpKSB7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBMb2dnZXIuZGVidWcoZXJyb3IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWNvbm5lY3RUb1NhbWVVcmkobWF4UmV0cmllcywgbnVtUmV0cmllcyArIDEpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSwgUkVUUllfVElNRV9NUyk7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZWNvbm5lY3RUb05ld1VyaShtYXhSZXRyaWVzLCBudW1SZXRyaWVzLCBuZXdXc1VyaSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZWNvbm5lY3RUb05ld1VyaShtYXhSZXRyaWVzLCBudW1SZXRyaWVzLCB3c1VyaSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBUT0RPIFRlc3QgcmV0cmllcy4gSG93IHRvIGZvcmNlIG5vdCBjb25uZWN0aW9uP1xuICAgIGZ1bmN0aW9uIHJlY29ubmVjdFRvTmV3VXJpKG1heFJldHJpZXMsIG51bVJldHJpZXMsIHJlY29ubmVjdFdzVXJpKSB7XG4gICAgICAgIExvZ2dlci5kZWJ1ZyhcIlJlY29ubmVjdGlvbiBhdHRlbXB0ICNcIiArIG51bVJldHJpZXMpO1xuXG4gICAgICAgIHdzLmNsb3NlKCk7XG5cbiAgICAgICAgd3NVcmkgPSByZWNvbm5lY3RXc1VyaSB8fCB3c1VyaTtcblxuICAgICAgICB2YXIgbmV3V3M7XG4gICAgICAgIGlmICh1c2VTb2NrSlMpIHtcbiAgICAgICAgICAgIG5ld1dzID0gbmV3IFNvY2tKUyh3c1VyaSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBuZXdXcyA9IG5ldyBXZWJTb2NrZXQod3NVcmkpO1xuICAgICAgICB9XG5cbiAgICAgICAgbmV3V3Mub25vcGVuID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBMb2dnZXIuZGVidWcoXCJSZWNvbm5lY3RlZCBhZnRlciBcIiArIG51bVJldHJpZXMgKyBcIiBhdHRlbXB0cy4uLlwiKTtcbiAgICAgICAgICAgIGxvZ0Nvbm5lY3RlZChuZXdXcywgd3NVcmkpO1xuICAgICAgICAgICAgcmVjb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgICAgICByZWdpc3Rlck1lc3NhZ2VIYW5kbGVyKCk7XG4gICAgICAgICAgICBpZiAoY29uZmlnLm9ucmVjb25uZWN0ZWQoKSkge1xuICAgICAgICAgICAgICAgIGNvbmZpZy5vbnJlY29ubmVjdGVkKCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG5ld1dzLm9uY2xvc2UgPSByZWNvbm5lY3Rpb25PbkNsb3NlO1xuICAgICAgICB9O1xuXG4gICAgICAgIHZhciBvbkVycm9yT3JDbG9zZSA9IGZ1bmN0aW9uKGVycm9yKSB7XG4gICAgICAgICAgICBMb2dnZXIud2FybihcIlJlY29ubmVjdGlvbiBlcnJvcjogXCIsIGVycm9yKTtcblxuICAgICAgICAgICAgaWYgKG51bVJldHJpZXMgPT09IG1heFJldHJpZXMpIHtcbiAgICAgICAgICAgICAgICBpZiAoY29uZmlnLm9uZGlzY29ubmVjdCkge1xuICAgICAgICAgICAgICAgICAgICBjb25maWcub25kaXNjb25uZWN0KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICByZWNvbm5lY3RUb1NhbWVVcmkobWF4UmV0cmllcywgbnVtUmV0cmllcyArIDEpO1xuICAgICAgICAgICAgICAgIH0sIFJFVFJZX1RJTUVfTVMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIG5ld1dzLm9uZXJyb3IgPSBvbkVycm9yT3JDbG9zZTtcblxuICAgICAgICB3cyA9IG5ld1dzO1xuICAgIH1cblxuICAgIHRoaXMuY2xvc2UgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgY2xvc2luZyA9IHRydWU7XG4gICAgICAgIHdzLmNsb3NlKCk7XG4gICAgfTtcblxuXG4gICAgLy8gVGhpcyBtZXRob2QgaXMgb25seSBmb3IgdGVzdGluZ1xuICAgIHRoaXMuZm9yY2VDbG9zZSA9IGZ1bmN0aW9uKG1pbGxpcykge1xuICAgICAgICBMb2dnZXIuZGVidWcoXCJUZXN0aW5nOiBGb3JjZSBXZWJTb2NrZXQgY2xvc2VcIik7XG5cbiAgICAgICAgaWYgKG1pbGxpcykge1xuICAgICAgICAgICAgTG9nZ2VyLmRlYnVnKFwiVGVzdGluZzogQ2hhbmdlIHdzVXJpIGZvciBcIiArIG1pbGxpcyArIFwiIG1pbGxpcyB0byBzaW11bGF0ZSBuZXQgZmFpbHVyZVwiKTtcbiAgICAgICAgICAgIHZhciBnb29kV3NVcmkgPSB3c1VyaTtcbiAgICAgICAgICAgIHdzVXJpID0gXCJ3c3M6Ly8yMS4yMzQuMTIuMzQuNDo0NDMvXCI7XG5cbiAgICAgICAgICAgIGZvcmNpbmdEaXNjb25uZWN0aW9uID0gdHJ1ZTtcblxuICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICBMb2dnZXIuZGVidWcoXCJUZXN0aW5nOiBSZWNvdmVyIGdvb2Qgd3NVcmkgXCIgKyBnb29kV3NVcmkpO1xuICAgICAgICAgICAgICAgIHdzVXJpID0gZ29vZFdzVXJpO1xuXG4gICAgICAgICAgICAgICAgZm9yY2luZ0Rpc2Nvbm5lY3Rpb24gPSBmYWxzZTtcblxuICAgICAgICAgICAgfSwgbWlsbGlzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHdzLmNsb3NlKCk7XG4gICAgfTtcblxuICAgIHRoaXMucmVjb25uZWN0V3MgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgTG9nZ2VyLmRlYnVnKFwicmVjb25uZWN0V3NcIik7XG4gICAgICAgIHJlY29ubmVjdFRvU2FtZVVyaShNQVhfUkVUUklFUywgMSwgd3NVcmkpO1xuICAgIH07XG5cbiAgICB0aGlzLnNlbmQgPSBmdW5jdGlvbihtZXNzYWdlKSB7XG4gICAgICAgIHdzLnNlbmQobWVzc2FnZSk7XG4gICAgfTtcblxuICAgIHRoaXMuYWRkRXZlbnRMaXN0ZW5lciA9IGZ1bmN0aW9uKHR5cGUsIGNhbGxiYWNrKSB7XG4gICAgICAgIHJlZ2lzdGVyTWVzc2FnZUhhbmRsZXIgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHdzLmFkZEV2ZW50TGlzdGVuZXIodHlwZSwgY2FsbGJhY2spO1xuICAgICAgICB9O1xuXG4gICAgICAgIHJlZ2lzdGVyTWVzc2FnZUhhbmRsZXIoKTtcbiAgICB9O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IFdlYlNvY2tldFdpdGhSZWNvbm5lY3Rpb247XG4iLCIvKlxuICogKEMpIENvcHlyaWdodCAyMDE0IEt1cmVudG8gKGh0dHA6Ly9rdXJlbnRvLm9yZy8pXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4gKlxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuICogV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cbiAqXG4gKi9cblxuXG52YXIgZGVmaW5lUHJvcGVydHlfSUU4ID0gZmFsc2VcbmlmKE9iamVjdC5kZWZpbmVQcm9wZXJ0eSlcbntcbiAgdHJ5XG4gIHtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoe30sIFwieFwiLCB7fSk7XG4gIH1cbiAgY2F0Y2goZSlcbiAge1xuICAgIGRlZmluZVByb3BlcnR5X0lFOCA9IHRydWVcbiAgfVxufVxuXG4vLyBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1dlYi9KYXZhU2NyaXB0L1JlZmVyZW5jZS9HbG9iYWxfT2JqZWN0cy9GdW5jdGlvbi9iaW5kXG5pZiAoIUZ1bmN0aW9uLnByb3RvdHlwZS5iaW5kKSB7XG4gIEZ1bmN0aW9uLnByb3RvdHlwZS5iaW5kID0gZnVuY3Rpb24ob1RoaXMpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIC8vIGNsb3Nlc3QgdGhpbmcgcG9zc2libGUgdG8gdGhlIEVDTUFTY3JpcHQgNVxuICAgICAgLy8gaW50ZXJuYWwgSXNDYWxsYWJsZSBmdW5jdGlvblxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignRnVuY3Rpb24ucHJvdG90eXBlLmJpbmQgLSB3aGF0IGlzIHRyeWluZyB0byBiZSBib3VuZCBpcyBub3QgY2FsbGFibGUnKTtcbiAgICB9XG5cbiAgICB2YXIgYUFyZ3MgICA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSksXG4gICAgICAgIGZUb0JpbmQgPSB0aGlzLFxuICAgICAgICBmTk9QICAgID0gZnVuY3Rpb24oKSB7fSxcbiAgICAgICAgZkJvdW5kICA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiBmVG9CaW5kLmFwcGx5KHRoaXMgaW5zdGFuY2VvZiBmTk9QICYmIG9UaGlzXG4gICAgICAgICAgICAgICAgID8gdGhpc1xuICAgICAgICAgICAgICAgICA6IG9UaGlzLFxuICAgICAgICAgICAgICAgICBhQXJncy5jb25jYXQoQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKSkpO1xuICAgICAgICB9O1xuXG4gICAgZk5PUC5wcm90b3R5cGUgPSB0aGlzLnByb3RvdHlwZTtcbiAgICBmQm91bmQucHJvdG90eXBlID0gbmV3IGZOT1AoKTtcblxuICAgIHJldHVybiBmQm91bmQ7XG4gIH07XG59XG5cblxudmFyIEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcjtcblxudmFyIGluaGVyaXRzID0gcmVxdWlyZSgnaW5oZXJpdHMnKTtcblxudmFyIHBhY2tlcnMgPSByZXF1aXJlKCcuL3BhY2tlcnMnKTtcbnZhciBNYXBwZXIgPSByZXF1aXJlKCcuL01hcHBlcicpO1xuXG5cbnZhciBCQVNFX1RJTUVPVVQgPSA1MDAwO1xuXG5cbmZ1bmN0aW9uIHVuaWZ5UmVzcG9uc2VNZXRob2RzKHJlc3BvbnNlTWV0aG9kcylcbntcbiAgaWYoIXJlc3BvbnNlTWV0aG9kcykgcmV0dXJuIHt9O1xuXG4gIGZvcih2YXIga2V5IGluIHJlc3BvbnNlTWV0aG9kcylcbiAge1xuICAgIHZhciB2YWx1ZSA9IHJlc3BvbnNlTWV0aG9kc1trZXldO1xuXG4gICAgaWYodHlwZW9mIHZhbHVlID09ICdzdHJpbmcnKVxuICAgICAgcmVzcG9uc2VNZXRob2RzW2tleV0gPVxuICAgICAge1xuICAgICAgICByZXNwb25zZTogdmFsdWVcbiAgICAgIH1cbiAgfTtcblxuICByZXR1cm4gcmVzcG9uc2VNZXRob2RzO1xufTtcblxuZnVuY3Rpb24gdW5pZnlUcmFuc3BvcnQodHJhbnNwb3J0KVxue1xuICBpZighdHJhbnNwb3J0KSByZXR1cm47XG5cbiAgLy8gVHJhbnNwb3J0IGFzIGEgZnVuY3Rpb25cbiAgaWYodHJhbnNwb3J0IGluc3RhbmNlb2YgRnVuY3Rpb24pXG4gICAgcmV0dXJuIHtzZW5kOiB0cmFuc3BvcnR9O1xuXG4gIC8vIFdlYlNvY2tldCAmIERhdGFDaGFubmVsXG4gIGlmKHRyYW5zcG9ydC5zZW5kIGluc3RhbmNlb2YgRnVuY3Rpb24pXG4gICAgcmV0dXJuIHRyYW5zcG9ydDtcblxuICAvLyBNZXNzYWdlIEFQSSAoSW50ZXItd2luZG93ICYgV2ViV29ya2VyKVxuICBpZih0cmFuc3BvcnQucG9zdE1lc3NhZ2UgaW5zdGFuY2VvZiBGdW5jdGlvbilcbiAge1xuICAgIHRyYW5zcG9ydC5zZW5kID0gdHJhbnNwb3J0LnBvc3RNZXNzYWdlO1xuICAgIHJldHVybiB0cmFuc3BvcnQ7XG4gIH1cblxuICAvLyBTdHJlYW0gQVBJXG4gIGlmKHRyYW5zcG9ydC53cml0ZSBpbnN0YW5jZW9mIEZ1bmN0aW9uKVxuICB7XG4gICAgdHJhbnNwb3J0LnNlbmQgPSB0cmFuc3BvcnQud3JpdGU7XG4gICAgcmV0dXJuIHRyYW5zcG9ydDtcbiAgfVxuXG4gIC8vIFRyYW5zcG9ydHMgdGhhdCBvbmx5IGNhbiByZWNlaXZlIG1lc3NhZ2VzLCBidXQgbm90IHNlbmRcbiAgaWYodHJhbnNwb3J0Lm9ubWVzc2FnZSAhPT0gdW5kZWZpbmVkKSByZXR1cm47XG4gIGlmKHRyYW5zcG9ydC5wYXVzZSBpbnN0YW5jZW9mIEZ1bmN0aW9uKSByZXR1cm47XG5cbiAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiVHJhbnNwb3J0IGlzIG5vdCBhIGZ1bmN0aW9uIG5vciBhIHZhbGlkIG9iamVjdFwiKTtcbn07XG5cblxuLyoqXG4gKiBSZXByZXNlbnRhdGlvbiBvZiBhIFJQQyBub3RpZmljYXRpb25cbiAqXG4gKiBAY2xhc3NcbiAqXG4gKiBAY29uc3RydWN0b3JcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbWV0aG9kIC1tZXRob2Qgb2YgdGhlIG5vdGlmaWNhdGlvblxuICogQHBhcmFtIHBhcmFtcyAtIHBhcmFtZXRlcnMgb2YgdGhlIG5vdGlmaWNhdGlvblxuICovXG5mdW5jdGlvbiBScGNOb3RpZmljYXRpb24obWV0aG9kLCBwYXJhbXMpXG57XG4gIGlmKGRlZmluZVByb3BlcnR5X0lFOClcbiAge1xuICAgIHRoaXMubWV0aG9kID0gbWV0aG9kXG4gICAgdGhpcy5wYXJhbXMgPSBwYXJhbXNcbiAgfVxuICBlbHNlXG4gIHtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ21ldGhvZCcsIHt2YWx1ZTogbWV0aG9kLCBlbnVtZXJhYmxlOiB0cnVlfSk7XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsICdwYXJhbXMnLCB7dmFsdWU6IHBhcmFtcywgZW51bWVyYWJsZTogdHJ1ZX0pO1xuICB9XG59O1xuXG5cbi8qKlxuICogQGNsYXNzXG4gKlxuICogQGNvbnN0cnVjdG9yXG4gKlxuICogQHBhcmFtIHtvYmplY3R9IHBhY2tlclxuICpcbiAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc11cbiAqXG4gKiBAcGFyYW0ge29iamVjdH0gW3RyYW5zcG9ydF1cbiAqXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBbb25SZXF1ZXN0XVxuICovXG5mdW5jdGlvbiBScGNCdWlsZGVyKHBhY2tlciwgb3B0aW9ucywgdHJhbnNwb3J0LCBvblJlcXVlc3QpXG57XG4gIHZhciBzZWxmID0gdGhpcztcblxuICBpZighcGFja2VyKVxuICAgIHRocm93IG5ldyBTeW50YXhFcnJvcignUGFja2VyIGlzIG5vdCBkZWZpbmVkJyk7XG5cbiAgaWYoIXBhY2tlci5wYWNrIHx8ICFwYWNrZXIudW5wYWNrKVxuICAgIHRocm93IG5ldyBTeW50YXhFcnJvcignUGFja2VyIGlzIGludmFsaWQnKTtcblxuICB2YXIgcmVzcG9uc2VNZXRob2RzID0gdW5pZnlSZXNwb25zZU1ldGhvZHMocGFja2VyLnJlc3BvbnNlTWV0aG9kcyk7XG5cblxuICBpZihvcHRpb25zIGluc3RhbmNlb2YgRnVuY3Rpb24pXG4gIHtcbiAgICBpZih0cmFuc3BvcnQgIT0gdW5kZWZpbmVkKVxuICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiVGhlcmUgY2FuJ3QgYmUgcGFyYW1ldGVycyBhZnRlciBvblJlcXVlc3RcIik7XG5cbiAgICBvblJlcXVlc3QgPSBvcHRpb25zO1xuICAgIHRyYW5zcG9ydCA9IHVuZGVmaW5lZDtcbiAgICBvcHRpb25zICAgPSB1bmRlZmluZWQ7XG4gIH07XG5cbiAgaWYob3B0aW9ucyAmJiBvcHRpb25zLnNlbmQgaW5zdGFuY2VvZiBGdW5jdGlvbilcbiAge1xuICAgIGlmKHRyYW5zcG9ydCAmJiAhKHRyYW5zcG9ydCBpbnN0YW5jZW9mIEZ1bmN0aW9uKSlcbiAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihcIk9ubHkgYSBmdW5jdGlvbiBjYW4gYmUgYWZ0ZXIgdHJhbnNwb3J0XCIpO1xuXG4gICAgb25SZXF1ZXN0ID0gdHJhbnNwb3J0O1xuICAgIHRyYW5zcG9ydCA9IG9wdGlvbnM7XG4gICAgb3B0aW9ucyAgID0gdW5kZWZpbmVkO1xuICB9O1xuXG4gIGlmKHRyYW5zcG9ydCBpbnN0YW5jZW9mIEZ1bmN0aW9uKVxuICB7XG4gICAgaWYob25SZXF1ZXN0ICE9IHVuZGVmaW5lZClcbiAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihcIlRoZXJlIGNhbid0IGJlIHBhcmFtZXRlcnMgYWZ0ZXIgb25SZXF1ZXN0XCIpO1xuXG4gICAgb25SZXF1ZXN0ID0gdHJhbnNwb3J0O1xuICAgIHRyYW5zcG9ydCA9IHVuZGVmaW5lZDtcbiAgfTtcblxuICBpZih0cmFuc3BvcnQgJiYgdHJhbnNwb3J0LnNlbmQgaW5zdGFuY2VvZiBGdW5jdGlvbilcbiAgICBpZihvblJlcXVlc3QgJiYgIShvblJlcXVlc3QgaW5zdGFuY2VvZiBGdW5jdGlvbikpXG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJPbmx5IGEgZnVuY3Rpb24gY2FuIGJlIGFmdGVyIHRyYW5zcG9ydFwiKTtcblxuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuXG4gIEV2ZW50RW1pdHRlci5jYWxsKHRoaXMpO1xuXG4gIGlmKG9uUmVxdWVzdClcbiAgICB0aGlzLm9uKCdyZXF1ZXN0Jywgb25SZXF1ZXN0KTtcblxuXG4gIGlmKGRlZmluZVByb3BlcnR5X0lFOClcbiAgICB0aGlzLnBlZXJJRCA9IG9wdGlvbnMucGVlcklEXG4gIGVsc2VcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ3BlZXJJRCcsIHt2YWx1ZTogb3B0aW9ucy5wZWVySUR9KTtcblxuICB2YXIgbWF4X3JldHJpZXMgPSBvcHRpb25zLm1heF9yZXRyaWVzIHx8IDA7XG5cblxuICBmdW5jdGlvbiB0cmFuc3BvcnRNZXNzYWdlKGV2ZW50KVxuICB7XG4gICAgc2VsZi5kZWNvZGUoZXZlbnQuZGF0YSB8fCBldmVudCk7XG4gIH07XG5cbiAgdGhpcy5nZXRUcmFuc3BvcnQgPSBmdW5jdGlvbigpXG4gIHtcbiAgICByZXR1cm4gdHJhbnNwb3J0O1xuICB9XG4gIHRoaXMuc2V0VHJhbnNwb3J0ID0gZnVuY3Rpb24odmFsdWUpXG4gIHtcbiAgICAvLyBSZW1vdmUgbGlzdGVuZXIgZnJvbSBvbGQgdHJhbnNwb3J0XG4gICAgaWYodHJhbnNwb3J0KVxuICAgIHtcbiAgICAgIC8vIFczQyB0cmFuc3BvcnRzXG4gICAgICBpZih0cmFuc3BvcnQucmVtb3ZlRXZlbnRMaXN0ZW5lcilcbiAgICAgICAgdHJhbnNwb3J0LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCB0cmFuc3BvcnRNZXNzYWdlKTtcblxuICAgICAgLy8gTm9kZS5qcyBTdHJlYW1zIEFQSVxuICAgICAgZWxzZSBpZih0cmFuc3BvcnQucmVtb3ZlTGlzdGVuZXIpXG4gICAgICAgIHRyYW5zcG9ydC5yZW1vdmVMaXN0ZW5lcignZGF0YScsIHRyYW5zcG9ydE1lc3NhZ2UpO1xuICAgIH07XG5cbiAgICAvLyBTZXQgbGlzdGVuZXIgb24gbmV3IHRyYW5zcG9ydFxuICAgIGlmKHZhbHVlKVxuICAgIHtcbiAgICAgIC8vIFczQyB0cmFuc3BvcnRzXG4gICAgICBpZih2YWx1ZS5hZGRFdmVudExpc3RlbmVyKVxuICAgICAgICB2YWx1ZS5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgdHJhbnNwb3J0TWVzc2FnZSk7XG5cbiAgICAgIC8vIE5vZGUuanMgU3RyZWFtcyBBUElcbiAgICAgIGVsc2UgaWYodmFsdWUuYWRkTGlzdGVuZXIpXG4gICAgICAgIHZhbHVlLmFkZExpc3RlbmVyKCdkYXRhJywgdHJhbnNwb3J0TWVzc2FnZSk7XG4gICAgfTtcblxuICAgIHRyYW5zcG9ydCA9IHVuaWZ5VHJhbnNwb3J0KHZhbHVlKTtcbiAgfVxuXG4gIGlmKCFkZWZpbmVQcm9wZXJ0eV9JRTgpXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsICd0cmFuc3BvcnQnLFxuICAgIHtcbiAgICAgIGdldDogdGhpcy5nZXRUcmFuc3BvcnQuYmluZCh0aGlzKSxcbiAgICAgIHNldDogdGhpcy5zZXRUcmFuc3BvcnQuYmluZCh0aGlzKVxuICAgIH0pXG5cbiAgdGhpcy5zZXRUcmFuc3BvcnQodHJhbnNwb3J0KTtcblxuXG4gIHZhciByZXF1ZXN0X3RpbWVvdXQgICAgICA9IG9wdGlvbnMucmVxdWVzdF90aW1lb3V0ICAgICAgfHwgQkFTRV9USU1FT1VUO1xuICB2YXIgcGluZ19yZXF1ZXN0X3RpbWVvdXQgPSBvcHRpb25zLnBpbmdfcmVxdWVzdF90aW1lb3V0IHx8IHJlcXVlc3RfdGltZW91dDtcbiAgdmFyIHJlc3BvbnNlX3RpbWVvdXQgICAgID0gb3B0aW9ucy5yZXNwb25zZV90aW1lb3V0ICAgICB8fCBCQVNFX1RJTUVPVVQ7XG4gIHZhciBkdXBsaWNhdGVzX3RpbWVvdXQgICA9IG9wdGlvbnMuZHVwbGljYXRlc190aW1lb3V0ICAgfHwgQkFTRV9USU1FT1VUO1xuXG5cbiAgdmFyIHJlcXVlc3RJRCA9IDA7XG5cbiAgdmFyIHJlcXVlc3RzICA9IG5ldyBNYXBwZXIoKTtcbiAgdmFyIHJlc3BvbnNlcyA9IG5ldyBNYXBwZXIoKTtcbiAgdmFyIHByb2Nlc3NlZFJlc3BvbnNlcyA9IG5ldyBNYXBwZXIoKTtcblxuICB2YXIgbWVzc2FnZTJLZXkgPSB7fTtcblxuXG4gIC8qKlxuICAgKiBTdG9yZSB0aGUgcmVzcG9uc2UgdG8gcHJldmVudCB0byBwcm9jZXNzIGR1cGxpY2F0ZSByZXF1ZXN0IGxhdGVyXG4gICAqL1xuICBmdW5jdGlvbiBzdG9yZVJlc3BvbnNlKG1lc3NhZ2UsIGlkLCBkZXN0KVxuICB7XG4gICAgdmFyIHJlc3BvbnNlID1cbiAgICB7XG4gICAgICBtZXNzYWdlOiBtZXNzYWdlLFxuICAgICAgLyoqIFRpbWVvdXQgdG8gYXV0by1jbGVhbiBvbGQgcmVzcG9uc2VzICovXG4gICAgICB0aW1lb3V0OiBzZXRUaW1lb3V0KGZ1bmN0aW9uKClcbiAgICAgIHtcbiAgICAgICAgcmVzcG9uc2VzLnJlbW92ZShpZCwgZGVzdCk7XG4gICAgICB9LFxuICAgICAgcmVzcG9uc2VfdGltZW91dClcbiAgICB9O1xuXG4gICAgcmVzcG9uc2VzLnNldChyZXNwb25zZSwgaWQsIGRlc3QpO1xuICB9O1xuXG4gIC8qKlxuICAgKiBTdG9yZSB0aGUgcmVzcG9uc2UgdG8gaWdub3JlIGR1cGxpY2F0ZWQgbWVzc2FnZXMgbGF0ZXJcbiAgICovXG4gIGZ1bmN0aW9uIHN0b3JlUHJvY2Vzc2VkUmVzcG9uc2UoYWNrLCBmcm9tKVxuICB7XG4gICAgdmFyIHRpbWVvdXQgPSBzZXRUaW1lb3V0KGZ1bmN0aW9uKClcbiAgICB7XG4gICAgICBwcm9jZXNzZWRSZXNwb25zZXMucmVtb3ZlKGFjaywgZnJvbSk7XG4gICAgfSxcbiAgICBkdXBsaWNhdGVzX3RpbWVvdXQpO1xuXG4gICAgcHJvY2Vzc2VkUmVzcG9uc2VzLnNldCh0aW1lb3V0LCBhY2ssIGZyb20pO1xuICB9O1xuXG5cbiAgLyoqXG4gICAqIFJlcHJlc2VudGF0aW9uIG9mIGEgUlBDIHJlcXVlc3RcbiAgICpcbiAgICogQGNsYXNzXG4gICAqIEBleHRlbmRzIFJwY05vdGlmaWNhdGlvblxuICAgKlxuICAgKiBAY29uc3RydWN0b3JcbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1ldGhvZCAtbWV0aG9kIG9mIHRoZSBub3RpZmljYXRpb25cbiAgICogQHBhcmFtIHBhcmFtcyAtIHBhcmFtZXRlcnMgb2YgdGhlIG5vdGlmaWNhdGlvblxuICAgKiBAcGFyYW0ge0ludGVnZXJ9IGlkIC0gaWRlbnRpZmllciBvZiB0aGUgcmVxdWVzdFxuICAgKiBAcGFyYW0gW2Zyb21dIC0gc291cmNlIG9mIHRoZSBub3RpZmljYXRpb25cbiAgICovXG4gIGZ1bmN0aW9uIFJwY1JlcXVlc3QobWV0aG9kLCBwYXJhbXMsIGlkLCBmcm9tLCB0cmFuc3BvcnQpXG4gIHtcbiAgICBScGNOb3RpZmljYXRpb24uY2FsbCh0aGlzLCBtZXRob2QsIHBhcmFtcyk7XG5cbiAgICB0aGlzLmdldFRyYW5zcG9ydCA9IGZ1bmN0aW9uKClcbiAgICB7XG4gICAgICByZXR1cm4gdHJhbnNwb3J0O1xuICAgIH1cbiAgICB0aGlzLnNldFRyYW5zcG9ydCA9IGZ1bmN0aW9uKHZhbHVlKVxuICAgIHtcbiAgICAgIHRyYW5zcG9ydCA9IHVuaWZ5VHJhbnNwb3J0KHZhbHVlKTtcbiAgICB9XG5cbiAgICBpZighZGVmaW5lUHJvcGVydHlfSUU4KVxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsICd0cmFuc3BvcnQnLFxuICAgICAge1xuICAgICAgICBnZXQ6IHRoaXMuZ2V0VHJhbnNwb3J0LmJpbmQodGhpcyksXG4gICAgICAgIHNldDogdGhpcy5zZXRUcmFuc3BvcnQuYmluZCh0aGlzKVxuICAgICAgfSlcblxuICAgIHZhciByZXNwb25zZSA9IHJlc3BvbnNlcy5nZXQoaWQsIGZyb20pO1xuXG4gICAgLyoqXG4gICAgICogQGNvbnN0YW50IHtCb29sZWFufSBkdXBsaWNhdGVkXG4gICAgICovXG4gICAgaWYoISh0cmFuc3BvcnQgfHwgc2VsZi5nZXRUcmFuc3BvcnQoKSkpXG4gICAge1xuICAgICAgaWYoZGVmaW5lUHJvcGVydHlfSUU4KVxuICAgICAgICB0aGlzLmR1cGxpY2F0ZWQgPSBCb29sZWFuKHJlc3BvbnNlKVxuICAgICAgZWxzZVxuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ2R1cGxpY2F0ZWQnLFxuICAgICAgICB7XG4gICAgICAgICAgdmFsdWU6IEJvb2xlYW4ocmVzcG9uc2UpXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHZhciByZXNwb25zZU1ldGhvZCA9IHJlc3BvbnNlTWV0aG9kc1ttZXRob2RdO1xuXG4gICAgdGhpcy5wYWNrID0gcGFja2VyLnBhY2suYmluZChwYWNrZXIsIHRoaXMsIGlkKVxuXG4gICAgLyoqXG4gICAgICogR2VuZXJhdGUgYSByZXNwb25zZSB0byB0aGlzIHJlcXVlc3RcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7RXJyb3J9IFtlcnJvcl1cbiAgICAgKiBAcGFyYW0geyp9IFtyZXN1bHRdXG4gICAgICpcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgICAqL1xuICAgIHRoaXMucmVwbHkgPSBmdW5jdGlvbihlcnJvciwgcmVzdWx0LCB0cmFuc3BvcnQpXG4gICAge1xuICAgICAgLy8gRml4IG9wdGlvbmFsIHBhcmFtZXRlcnNcbiAgICAgIGlmKGVycm9yIGluc3RhbmNlb2YgRnVuY3Rpb24gfHwgZXJyb3IgJiYgZXJyb3Iuc2VuZCBpbnN0YW5jZW9mIEZ1bmN0aW9uKVxuICAgICAge1xuICAgICAgICBpZihyZXN1bHQgIT0gdW5kZWZpbmVkKVxuICAgICAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihcIlRoZXJlIGNhbid0IGJlIHBhcmFtZXRlcnMgYWZ0ZXIgY2FsbGJhY2tcIik7XG5cbiAgICAgICAgdHJhbnNwb3J0ID0gZXJyb3I7XG4gICAgICAgIHJlc3VsdCA9IG51bGw7XG4gICAgICAgIGVycm9yID0gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBlbHNlIGlmKHJlc3VsdCBpbnN0YW5jZW9mIEZ1bmN0aW9uXG4gICAgICB8fCByZXN1bHQgJiYgcmVzdWx0LnNlbmQgaW5zdGFuY2VvZiBGdW5jdGlvbilcbiAgICAgIHtcbiAgICAgICAgaWYodHJhbnNwb3J0ICE9IHVuZGVmaW5lZClcbiAgICAgICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJUaGVyZSBjYW4ndCBiZSBwYXJhbWV0ZXJzIGFmdGVyIGNhbGxiYWNrXCIpO1xuXG4gICAgICAgIHRyYW5zcG9ydCA9IHJlc3VsdDtcbiAgICAgICAgcmVzdWx0ID0gbnVsbDtcbiAgICAgIH07XG5cbiAgICAgIHRyYW5zcG9ydCA9IHVuaWZ5VHJhbnNwb3J0KHRyYW5zcG9ydCk7XG5cbiAgICAgIC8vIER1cGxpY2F0ZWQgcmVxdWVzdCwgcmVtb3ZlIG9sZCByZXNwb25zZSB0aW1lb3V0XG4gICAgICBpZihyZXNwb25zZSlcbiAgICAgICAgY2xlYXJUaW1lb3V0KHJlc3BvbnNlLnRpbWVvdXQpO1xuXG4gICAgICBpZihmcm9tICE9IHVuZGVmaW5lZClcbiAgICAgIHtcbiAgICAgICAgaWYoZXJyb3IpXG4gICAgICAgICAgZXJyb3IuZGVzdCA9IGZyb207XG5cbiAgICAgICAgaWYocmVzdWx0KVxuICAgICAgICAgIHJlc3VsdC5kZXN0ID0gZnJvbTtcbiAgICAgIH07XG5cbiAgICAgIHZhciBtZXNzYWdlO1xuXG4gICAgICAvLyBOZXcgcmVxdWVzdCBvciBvdmVycmlkZW4gb25lLCBjcmVhdGUgbmV3IHJlc3BvbnNlIHdpdGggcHJvdmlkZWQgZGF0YVxuICAgICAgaWYoZXJyb3IgfHwgcmVzdWx0ICE9IHVuZGVmaW5lZClcbiAgICAgIHtcbiAgICAgICAgaWYoc2VsZi5wZWVySUQgIT0gdW5kZWZpbmVkKVxuICAgICAgICB7XG4gICAgICAgICAgaWYoZXJyb3IpXG4gICAgICAgICAgICBlcnJvci5mcm9tID0gc2VsZi5wZWVySUQ7XG4gICAgICAgICAgZWxzZVxuICAgICAgICAgICAgcmVzdWx0LmZyb20gPSBzZWxmLnBlZXJJRDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFByb3RvY29sIGluZGljYXRlcyB0aGF0IHJlc3BvbnNlcyBoYXMgb3duIHJlcXVlc3QgbWV0aG9kc1xuICAgICAgICBpZihyZXNwb25zZU1ldGhvZClcbiAgICAgICAge1xuICAgICAgICAgIGlmKHJlc3BvbnNlTWV0aG9kLmVycm9yID09IHVuZGVmaW5lZCAmJiBlcnJvcilcbiAgICAgICAgICAgIG1lc3NhZ2UgPVxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBlcnJvcjogZXJyb3JcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICBlbHNlXG4gICAgICAgICAge1xuICAgICAgICAgICAgdmFyIG1ldGhvZCA9IGVycm9yXG4gICAgICAgICAgICAgICAgICAgICAgID8gcmVzcG9uc2VNZXRob2QuZXJyb3JcbiAgICAgICAgICAgICAgICAgICAgICAgOiByZXNwb25zZU1ldGhvZC5yZXNwb25zZTtcblxuICAgICAgICAgICAgbWVzc2FnZSA9XG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG1ldGhvZDogbWV0aG9kLFxuICAgICAgICAgICAgICBwYXJhbXM6IGVycm9yIHx8IHJlc3VsdFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgZWxzZVxuICAgICAgICAgIG1lc3NhZ2UgPVxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGVycm9yOiAgZXJyb3IsXG4gICAgICAgICAgICByZXN1bHQ6IHJlc3VsdFxuICAgICAgICAgIH07XG5cbiAgICAgICAgbWVzc2FnZSA9IHBhY2tlci5wYWNrKG1lc3NhZ2UsIGlkKTtcbiAgICAgIH1cblxuICAgICAgLy8gRHVwbGljYXRlICYgbm90LW92ZXJyaWRlbiByZXF1ZXN0LCByZS1zZW5kIG9sZCByZXNwb25zZVxuICAgICAgZWxzZSBpZihyZXNwb25zZSlcbiAgICAgICAgbWVzc2FnZSA9IHJlc3BvbnNlLm1lc3NhZ2U7XG5cbiAgICAgIC8vIE5ldyBlbXB0eSByZXBseSwgcmVzcG9uc2UgbnVsbCB2YWx1ZVxuICAgICAgZWxzZVxuICAgICAgICBtZXNzYWdlID0gcGFja2VyLnBhY2soe3Jlc3VsdDogbnVsbH0sIGlkKTtcblxuICAgICAgLy8gU3RvcmUgdGhlIHJlc3BvbnNlIHRvIHByZXZlbnQgdG8gcHJvY2VzcyBhIGR1cGxpY2F0ZWQgcmVxdWVzdCBsYXRlclxuICAgICAgc3RvcmVSZXNwb25zZShtZXNzYWdlLCBpZCwgZnJvbSk7XG5cbiAgICAgIC8vIFJldHVybiB0aGUgc3RvcmVkIHJlc3BvbnNlIHNvIGl0IGNhbiBiZSBkaXJlY3RseSBzZW5kIGJhY2tcbiAgICAgIHRyYW5zcG9ydCA9IHRyYW5zcG9ydCB8fCB0aGlzLmdldFRyYW5zcG9ydCgpIHx8IHNlbGYuZ2V0VHJhbnNwb3J0KCk7XG5cbiAgICAgIGlmKHRyYW5zcG9ydClcbiAgICAgICAgcmV0dXJuIHRyYW5zcG9ydC5zZW5kKG1lc3NhZ2UpO1xuXG4gICAgICByZXR1cm4gbWVzc2FnZTtcbiAgICB9XG4gIH07XG4gIGluaGVyaXRzKFJwY1JlcXVlc3QsIFJwY05vdGlmaWNhdGlvbik7XG5cblxuICBmdW5jdGlvbiBjYW5jZWwobWVzc2FnZSlcbiAge1xuICAgIHZhciBrZXkgPSBtZXNzYWdlMktleVttZXNzYWdlXTtcbiAgICBpZigha2V5KSByZXR1cm47XG5cbiAgICBkZWxldGUgbWVzc2FnZTJLZXlbbWVzc2FnZV07XG5cbiAgICB2YXIgcmVxdWVzdCA9IHJlcXVlc3RzLnBvcChrZXkuaWQsIGtleS5kZXN0KTtcbiAgICBpZighcmVxdWVzdCkgcmV0dXJuO1xuXG4gICAgY2xlYXJUaW1lb3V0KHJlcXVlc3QudGltZW91dCk7XG5cbiAgICAvLyBTdGFydCBkdXBsaWNhdGVkIHJlc3BvbnNlcyB0aW1lb3V0XG4gICAgc3RvcmVQcm9jZXNzZWRSZXNwb25zZShrZXkuaWQsIGtleS5kZXN0KTtcbiAgfTtcblxuICAvKipcbiAgICogQWxsb3cgdG8gY2FuY2VsIGEgcmVxdWVzdCBhbmQgZG9uJ3Qgd2FpdCBmb3IgYSByZXNwb25zZVxuICAgKlxuICAgKiBJZiBgbWVzc2FnZWAgaXMgbm90IGdpdmVuLCBjYW5jZWwgYWxsIHRoZSByZXF1ZXN0XG4gICAqL1xuICB0aGlzLmNhbmNlbCA9IGZ1bmN0aW9uKG1lc3NhZ2UpXG4gIHtcbiAgICBpZihtZXNzYWdlKSByZXR1cm4gY2FuY2VsKG1lc3NhZ2UpO1xuXG4gICAgZm9yKHZhciBtZXNzYWdlIGluIG1lc3NhZ2UyS2V5KVxuICAgICAgY2FuY2VsKG1lc3NhZ2UpO1xuICB9O1xuXG5cbiAgdGhpcy5jbG9zZSA9IGZ1bmN0aW9uKClcbiAge1xuICAgIC8vIFByZXZlbnQgdG8gcmVjZWl2ZSBuZXcgbWVzc2FnZXNcbiAgICB2YXIgdHJhbnNwb3J0ID0gdGhpcy5nZXRUcmFuc3BvcnQoKTtcbiAgICBpZih0cmFuc3BvcnQgJiYgdHJhbnNwb3J0LmNsb3NlKVxuICAgICAgIHRyYW5zcG9ydC5jbG9zZSgpO1xuXG4gICAgLy8gUmVxdWVzdCAmIHByb2Nlc3NlZCByZXNwb25zZXNcbiAgICB0aGlzLmNhbmNlbCgpO1xuXG4gICAgcHJvY2Vzc2VkUmVzcG9uc2VzLmZvckVhY2goY2xlYXJUaW1lb3V0KTtcblxuICAgIC8vIFJlc3BvbnNlc1xuICAgIHJlc3BvbnNlcy5mb3JFYWNoKGZ1bmN0aW9uKHJlc3BvbnNlKVxuICAgIHtcbiAgICAgIGNsZWFyVGltZW91dChyZXNwb25zZS50aW1lb3V0KTtcbiAgICB9KTtcbiAgfTtcblxuXG4gIC8qKlxuICAgKiBHZW5lcmF0ZXMgYW5kIGVuY29kZSBhIEpzb25SUEMgMi4wIG1lc3NhZ2VcbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IG1ldGhvZCAtbWV0aG9kIG9mIHRoZSBub3RpZmljYXRpb25cbiAgICogQHBhcmFtIHBhcmFtcyAtIHBhcmFtZXRlcnMgb2YgdGhlIG5vdGlmaWNhdGlvblxuICAgKiBAcGFyYW0gW2Rlc3RdIC0gZGVzdGluYXRpb24gb2YgdGhlIG5vdGlmaWNhdGlvblxuICAgKiBAcGFyYW0ge29iamVjdH0gW3RyYW5zcG9ydF0gLSB0cmFuc3BvcnQgd2hlcmUgdG8gc2VuZCB0aGUgbWVzc2FnZVxuICAgKiBAcGFyYW0gW2NhbGxiYWNrXSAtIGZ1bmN0aW9uIGNhbGxlZCB3aGVuIGEgcmVzcG9uc2UgdG8gdGhpcyByZXF1ZXN0IGlzXG4gICAqICAgcmVjZWl2ZWQuIElmIG5vdCBkZWZpbmVkLCBhIG5vdGlmaWNhdGlvbiB3aWxsIGJlIHNlbmQgaW5zdGVhZFxuICAgKlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBBIHJhdyBKc29uUlBDIDIuMCByZXF1ZXN0IG9yIG5vdGlmaWNhdGlvbiBzdHJpbmdcbiAgICovXG4gIHRoaXMuZW5jb2RlID0gZnVuY3Rpb24obWV0aG9kLCBwYXJhbXMsIGRlc3QsIHRyYW5zcG9ydCwgY2FsbGJhY2spXG4gIHtcbiAgICAvLyBGaXggb3B0aW9uYWwgcGFyYW1ldGVyc1xuICAgIGlmKHBhcmFtcyBpbnN0YW5jZW9mIEZ1bmN0aW9uKVxuICAgIHtcbiAgICAgIGlmKGRlc3QgIT0gdW5kZWZpbmVkKVxuICAgICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJUaGVyZSBjYW4ndCBiZSBwYXJhbWV0ZXJzIGFmdGVyIGNhbGxiYWNrXCIpO1xuXG4gICAgICBjYWxsYmFjayAgPSBwYXJhbXM7XG4gICAgICB0cmFuc3BvcnQgPSB1bmRlZmluZWQ7XG4gICAgICBkZXN0ICAgICAgPSB1bmRlZmluZWQ7XG4gICAgICBwYXJhbXMgICAgPSB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgZWxzZSBpZihkZXN0IGluc3RhbmNlb2YgRnVuY3Rpb24pXG4gICAge1xuICAgICAgaWYodHJhbnNwb3J0ICE9IHVuZGVmaW5lZClcbiAgICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiVGhlcmUgY2FuJ3QgYmUgcGFyYW1ldGVycyBhZnRlciBjYWxsYmFja1wiKTtcblxuICAgICAgY2FsbGJhY2sgID0gZGVzdDtcbiAgICAgIHRyYW5zcG9ydCA9IHVuZGVmaW5lZDtcbiAgICAgIGRlc3QgICAgICA9IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBlbHNlIGlmKHRyYW5zcG9ydCBpbnN0YW5jZW9mIEZ1bmN0aW9uKVxuICAgIHtcbiAgICAgIGlmKGNhbGxiYWNrICE9IHVuZGVmaW5lZClcbiAgICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiVGhlcmUgY2FuJ3QgYmUgcGFyYW1ldGVycyBhZnRlciBjYWxsYmFja1wiKTtcblxuICAgICAgY2FsbGJhY2sgID0gdHJhbnNwb3J0O1xuICAgICAgdHJhbnNwb3J0ID0gdW5kZWZpbmVkO1xuICAgIH07XG5cbiAgICBpZihzZWxmLnBlZXJJRCAhPSB1bmRlZmluZWQpXG4gICAge1xuICAgICAgcGFyYW1zID0gcGFyYW1zIHx8IHt9O1xuXG4gICAgICBwYXJhbXMuZnJvbSA9IHNlbGYucGVlcklEO1xuICAgIH07XG5cbiAgICBpZihkZXN0ICE9IHVuZGVmaW5lZClcbiAgICB7XG4gICAgICBwYXJhbXMgPSBwYXJhbXMgfHwge307XG5cbiAgICAgIHBhcmFtcy5kZXN0ID0gZGVzdDtcbiAgICB9O1xuXG4gICAgLy8gRW5jb2RlIG1lc3NhZ2VcbiAgICB2YXIgbWVzc2FnZSA9XG4gICAge1xuICAgICAgbWV0aG9kOiBtZXRob2QsXG4gICAgICBwYXJhbXM6IHBhcmFtc1xuICAgIH07XG5cbiAgICBpZihjYWxsYmFjaylcbiAgICB7XG4gICAgICB2YXIgaWQgPSByZXF1ZXN0SUQrKztcbiAgICAgIHZhciByZXRyaWVkID0gMDtcblxuICAgICAgbWVzc2FnZSA9IHBhY2tlci5wYWNrKG1lc3NhZ2UsIGlkKTtcblxuICAgICAgZnVuY3Rpb24gZGlzcGF0Y2hDYWxsYmFjayhlcnJvciwgcmVzdWx0KVxuICAgICAge1xuICAgICAgICBzZWxmLmNhbmNlbChtZXNzYWdlKTtcblxuICAgICAgICBjYWxsYmFjayhlcnJvciwgcmVzdWx0KTtcbiAgICAgIH07XG5cbiAgICAgIHZhciByZXF1ZXN0ID1cbiAgICAgIHtcbiAgICAgICAgbWVzc2FnZTogICAgICAgICBtZXNzYWdlLFxuICAgICAgICBjYWxsYmFjazogICAgICAgIGRpc3BhdGNoQ2FsbGJhY2ssXG4gICAgICAgIHJlc3BvbnNlTWV0aG9kczogcmVzcG9uc2VNZXRob2RzW21ldGhvZF0gfHwge31cbiAgICAgIH07XG5cbiAgICAgIHZhciBlbmNvZGVfdHJhbnNwb3J0ID0gdW5pZnlUcmFuc3BvcnQodHJhbnNwb3J0KTtcblxuICAgICAgZnVuY3Rpb24gc2VuZFJlcXVlc3QodHJhbnNwb3J0KVxuICAgICAge1xuICAgICAgICB2YXIgcnQgPSAobWV0aG9kID09PSAncGluZycgPyBwaW5nX3JlcXVlc3RfdGltZW91dCA6IHJlcXVlc3RfdGltZW91dCk7XG4gICAgICAgIHJlcXVlc3QudGltZW91dCA9IHNldFRpbWVvdXQodGltZW91dCwgcnQqTWF0aC5wb3coMiwgcmV0cmllZCsrKSk7XG4gICAgICAgIG1lc3NhZ2UyS2V5W21lc3NhZ2VdID0ge2lkOiBpZCwgZGVzdDogZGVzdH07XG4gICAgICAgIHJlcXVlc3RzLnNldChyZXF1ZXN0LCBpZCwgZGVzdCk7XG5cbiAgICAgICAgdHJhbnNwb3J0ID0gdHJhbnNwb3J0IHx8IGVuY29kZV90cmFuc3BvcnQgfHwgc2VsZi5nZXRUcmFuc3BvcnQoKTtcbiAgICAgICAgaWYodHJhbnNwb3J0KVxuICAgICAgICAgIHJldHVybiB0cmFuc3BvcnQuc2VuZChtZXNzYWdlKTtcblxuICAgICAgICByZXR1cm4gbWVzc2FnZTtcbiAgICAgIH07XG5cbiAgICAgIGZ1bmN0aW9uIHJldHJ5KHRyYW5zcG9ydClcbiAgICAgIHtcbiAgICAgICAgdHJhbnNwb3J0ID0gdW5pZnlUcmFuc3BvcnQodHJhbnNwb3J0KTtcblxuICAgICAgICBjb25zb2xlLndhcm4ocmV0cmllZCsnIHJldHJ5IGZvciByZXF1ZXN0IG1lc3NhZ2U6JyxtZXNzYWdlKTtcblxuICAgICAgICB2YXIgdGltZW91dCA9IHByb2Nlc3NlZFJlc3BvbnNlcy5wb3AoaWQsIGRlc3QpO1xuICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG5cbiAgICAgICAgcmV0dXJuIHNlbmRSZXF1ZXN0KHRyYW5zcG9ydCk7XG4gICAgICB9O1xuXG4gICAgICBmdW5jdGlvbiB0aW1lb3V0KClcbiAgICAgIHtcbiAgICAgICAgaWYocmV0cmllZCA8IG1heF9yZXRyaWVzKVxuICAgICAgICAgIHJldHVybiByZXRyeSh0cmFuc3BvcnQpO1xuXG4gICAgICAgIHZhciBlcnJvciA9IG5ldyBFcnJvcignUmVxdWVzdCBoYXMgdGltZWQgb3V0Jyk7XG4gICAgICAgICAgICBlcnJvci5yZXF1ZXN0ID0gbWVzc2FnZTtcblxuICAgICAgICBlcnJvci5yZXRyeSA9IHJldHJ5O1xuXG4gICAgICAgIGRpc3BhdGNoQ2FsbGJhY2soZXJyb3IpXG4gICAgICB9O1xuXG4gICAgICByZXR1cm4gc2VuZFJlcXVlc3QodHJhbnNwb3J0KTtcbiAgICB9O1xuXG4gICAgLy8gUmV0dXJuIHRoZSBwYWNrZWQgbWVzc2FnZVxuICAgIG1lc3NhZ2UgPSBwYWNrZXIucGFjayhtZXNzYWdlKTtcblxuICAgIHRyYW5zcG9ydCA9IHRyYW5zcG9ydCB8fCB0aGlzLmdldFRyYW5zcG9ydCgpO1xuICAgIGlmKHRyYW5zcG9ydClcbiAgICAgIHJldHVybiB0cmFuc3BvcnQuc2VuZChtZXNzYWdlKTtcblxuICAgIHJldHVybiBtZXNzYWdlO1xuICB9O1xuXG4gIC8qKlxuICAgKiBEZWNvZGUgYW5kIHByb2Nlc3MgYSBKc29uUlBDIDIuMCBtZXNzYWdlXG4gICAqXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gc3RyaW5nIHdpdGggdGhlIGNvbnRlbnQgb2YgdGhlIG1lc3NhZ2VcbiAgICpcbiAgICogQHJldHVybnMge1JwY05vdGlmaWNhdGlvbnxScGNSZXF1ZXN0fHVuZGVmaW5lZH0gLSB0aGUgcmVwcmVzZW50YXRpb24gb2YgdGhlXG4gICAqICAgbm90aWZpY2F0aW9uIG9yIHRoZSByZXF1ZXN0LiBJZiBhIHJlc3BvbnNlIHdhcyBwcm9jZXNzZWQsIGl0IHdpbGwgcmV0dXJuXG4gICAqICAgYHVuZGVmaW5lZGAgdG8gbm90aWZ5IHRoYXQgaXQgd2FzIHByb2Nlc3NlZFxuICAgKlxuICAgKiBAdGhyb3dzIHtUeXBlRXJyb3J9IC0gTWVzc2FnZSBpcyBub3QgZGVmaW5lZFxuICAgKi9cbiAgdGhpcy5kZWNvZGUgPSBmdW5jdGlvbihtZXNzYWdlLCB0cmFuc3BvcnQpXG4gIHtcbiAgICBpZighbWVzc2FnZSlcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJNZXNzYWdlIGlzIG5vdCBkZWZpbmVkXCIpO1xuXG4gICAgdHJ5XG4gICAge1xuICAgICAgbWVzc2FnZSA9IHBhY2tlci51bnBhY2sobWVzc2FnZSk7XG4gICAgfVxuICAgIGNhdGNoKGUpXG4gICAge1xuICAgICAgLy8gSWdub3JlIGludmFsaWQgbWVzc2FnZXNcbiAgICAgIHJldHVybiBjb25zb2xlLmRlYnVnKGUsIG1lc3NhZ2UpO1xuICAgIH07XG5cbiAgICB2YXIgaWQgICAgID0gbWVzc2FnZS5pZDtcbiAgICB2YXIgYWNrICAgID0gbWVzc2FnZS5hY2s7XG4gICAgdmFyIG1ldGhvZCA9IG1lc3NhZ2UubWV0aG9kO1xuICAgIHZhciBwYXJhbXMgPSBtZXNzYWdlLnBhcmFtcyB8fCB7fTtcblxuICAgIHZhciBmcm9tID0gcGFyYW1zLmZyb207XG4gICAgdmFyIGRlc3QgPSBwYXJhbXMuZGVzdDtcblxuICAgIC8vIElnbm9yZSBtZXNzYWdlcyBzZW5kIGJ5IHVzXG4gICAgaWYoc2VsZi5wZWVySUQgIT0gdW5kZWZpbmVkICYmIGZyb20gPT0gc2VsZi5wZWVySUQpIHJldHVybjtcblxuICAgIC8vIE5vdGlmaWNhdGlvblxuICAgIGlmKGlkID09IHVuZGVmaW5lZCAmJiBhY2sgPT0gdW5kZWZpbmVkKVxuICAgIHtcbiAgICAgIHZhciBub3RpZmljYXRpb24gPSBuZXcgUnBjTm90aWZpY2F0aW9uKG1ldGhvZCwgcGFyYW1zKTtcblxuICAgICAgaWYoc2VsZi5lbWl0KCdyZXF1ZXN0Jywgbm90aWZpY2F0aW9uKSkgcmV0dXJuO1xuICAgICAgcmV0dXJuIG5vdGlmaWNhdGlvbjtcbiAgICB9O1xuXG5cbiAgICBmdW5jdGlvbiBwcm9jZXNzUmVxdWVzdCgpXG4gICAge1xuICAgICAgLy8gSWYgd2UgaGF2ZSBhIHRyYW5zcG9ydCBhbmQgaXQncyBhIGR1cGxpY2F0ZWQgcmVxdWVzdCwgcmVwbHkgaW5tZWRpYXRseVxuICAgICAgdHJhbnNwb3J0ID0gdW5pZnlUcmFuc3BvcnQodHJhbnNwb3J0KSB8fCBzZWxmLmdldFRyYW5zcG9ydCgpO1xuICAgICAgaWYodHJhbnNwb3J0KVxuICAgICAge1xuICAgICAgICB2YXIgcmVzcG9uc2UgPSByZXNwb25zZXMuZ2V0KGlkLCBmcm9tKTtcbiAgICAgICAgaWYocmVzcG9uc2UpXG4gICAgICAgICAgcmV0dXJuIHRyYW5zcG9ydC5zZW5kKHJlc3BvbnNlLm1lc3NhZ2UpO1xuICAgICAgfTtcblxuICAgICAgdmFyIGlkQWNrID0gKGlkICE9IHVuZGVmaW5lZCkgPyBpZCA6IGFjaztcbiAgICAgIHZhciByZXF1ZXN0ID0gbmV3IFJwY1JlcXVlc3QobWV0aG9kLCBwYXJhbXMsIGlkQWNrLCBmcm9tLCB0cmFuc3BvcnQpO1xuXG4gICAgICBpZihzZWxmLmVtaXQoJ3JlcXVlc3QnLCByZXF1ZXN0KSkgcmV0dXJuO1xuICAgICAgcmV0dXJuIHJlcXVlc3Q7XG4gICAgfTtcblxuICAgIGZ1bmN0aW9uIHByb2Nlc3NSZXNwb25zZShyZXF1ZXN0LCBlcnJvciwgcmVzdWx0KVxuICAgIHtcbiAgICAgIHJlcXVlc3QuY2FsbGJhY2soZXJyb3IsIHJlc3VsdCk7XG4gICAgfTtcblxuICAgIGZ1bmN0aW9uIGR1cGxpY2F0ZWRSZXNwb25zZSh0aW1lb3V0KVxuICAgIHtcbiAgICAgIGNvbnNvbGUud2FybihcIlJlc3BvbnNlIGFscmVhZHkgcHJvY2Vzc2VkXCIsIG1lc3NhZ2UpO1xuXG4gICAgICAvLyBVcGRhdGUgZHVwbGljYXRlZCByZXNwb25zZXMgdGltZW91dFxuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgc3RvcmVQcm9jZXNzZWRSZXNwb25zZShhY2ssIGZyb20pO1xuICAgIH07XG5cblxuICAgIC8vIFJlcXVlc3QsIG9yIHJlc3BvbnNlIHdpdGggb3duIG1ldGhvZFxuICAgIGlmKG1ldGhvZClcbiAgICB7XG4gICAgICAvLyBDaGVjayBpZiBpdCdzIGEgcmVzcG9uc2Ugd2l0aCBvd24gbWV0aG9kXG4gICAgICBpZihkZXN0ID09IHVuZGVmaW5lZCB8fCBkZXN0ID09IHNlbGYucGVlcklEKVxuICAgICAge1xuICAgICAgICB2YXIgcmVxdWVzdCA9IHJlcXVlc3RzLmdldChhY2ssIGZyb20pO1xuICAgICAgICBpZihyZXF1ZXN0KVxuICAgICAgICB7XG4gICAgICAgICAgdmFyIHJlc3BvbnNlTWV0aG9kcyA9IHJlcXVlc3QucmVzcG9uc2VNZXRob2RzO1xuXG4gICAgICAgICAgaWYobWV0aG9kID09IHJlc3BvbnNlTWV0aG9kcy5lcnJvcilcbiAgICAgICAgICAgIHJldHVybiBwcm9jZXNzUmVzcG9uc2UocmVxdWVzdCwgcGFyYW1zKTtcblxuICAgICAgICAgIGlmKG1ldGhvZCA9PSByZXNwb25zZU1ldGhvZHMucmVzcG9uc2UpXG4gICAgICAgICAgICByZXR1cm4gcHJvY2Vzc1Jlc3BvbnNlKHJlcXVlc3QsIG51bGwsIHBhcmFtcyk7XG5cbiAgICAgICAgICByZXR1cm4gcHJvY2Vzc1JlcXVlc3QoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBwcm9jZXNzZWQgPSBwcm9jZXNzZWRSZXNwb25zZXMuZ2V0KGFjaywgZnJvbSk7XG4gICAgICAgIGlmKHByb2Nlc3NlZClcbiAgICAgICAgICByZXR1cm4gZHVwbGljYXRlZFJlc3BvbnNlKHByb2Nlc3NlZCk7XG4gICAgICB9XG5cbiAgICAgIC8vIFJlcXVlc3RcbiAgICAgIHJldHVybiBwcm9jZXNzUmVxdWVzdCgpO1xuICAgIH07XG5cbiAgICB2YXIgZXJyb3IgID0gbWVzc2FnZS5lcnJvcjtcbiAgICB2YXIgcmVzdWx0ID0gbWVzc2FnZS5yZXN1bHQ7XG5cbiAgICAvLyBJZ25vcmUgcmVzcG9uc2VzIG5vdCBzZW5kIHRvIHVzXG4gICAgaWYoZXJyb3IgICYmIGVycm9yLmRlc3QgICYmIGVycm9yLmRlc3QgICE9IHNlbGYucGVlcklEKSByZXR1cm47XG4gICAgaWYocmVzdWx0ICYmIHJlc3VsdC5kZXN0ICYmIHJlc3VsdC5kZXN0ICE9IHNlbGYucGVlcklEKSByZXR1cm47XG5cbiAgICAvLyBSZXNwb25zZVxuICAgIHZhciByZXF1ZXN0ID0gcmVxdWVzdHMuZ2V0KGFjaywgZnJvbSk7XG4gICAgaWYoIXJlcXVlc3QpXG4gICAge1xuICAgICAgdmFyIHByb2Nlc3NlZCA9IHByb2Nlc3NlZFJlc3BvbnNlcy5nZXQoYWNrLCBmcm9tKTtcbiAgICAgIGlmKHByb2Nlc3NlZClcbiAgICAgICAgcmV0dXJuIGR1cGxpY2F0ZWRSZXNwb25zZShwcm9jZXNzZWQpO1xuXG4gICAgICByZXR1cm4gY29uc29sZS53YXJuKFwiTm8gY2FsbGJhY2sgd2FzIGRlZmluZWQgZm9yIHRoaXMgbWVzc2FnZVwiLCBtZXNzYWdlKTtcbiAgICB9O1xuXG4gICAgLy8gUHJvY2VzcyByZXNwb25zZVxuICAgIHByb2Nlc3NSZXNwb25zZShyZXF1ZXN0LCBlcnJvciwgcmVzdWx0KTtcbiAgfTtcbn07XG5pbmhlcml0cyhScGNCdWlsZGVyLCBFdmVudEVtaXR0ZXIpO1xuXG5cblJwY0J1aWxkZXIuUnBjTm90aWZpY2F0aW9uID0gUnBjTm90aWZpY2F0aW9uO1xuXG5cbm1vZHVsZS5leHBvcnRzID0gUnBjQnVpbGRlcjtcblxudmFyIGNsaWVudHMgPSByZXF1aXJlKCcuL2NsaWVudHMnKTtcbnZhciB0cmFuc3BvcnRzID0gcmVxdWlyZSgnLi9jbGllbnRzL3RyYW5zcG9ydHMnKTtcblxuUnBjQnVpbGRlci5jbGllbnRzID0gY2xpZW50cztcblJwY0J1aWxkZXIuY2xpZW50cy50cmFuc3BvcnRzID0gdHJhbnNwb3J0cztcblJwY0J1aWxkZXIucGFja2VycyA9IHBhY2tlcnM7XG4iLCIvKipcbiAqIEpzb25SUEMgMi4wIHBhY2tlclxuICovXG5cbi8qKlxuICogUGFjayBhIEpzb25SUEMgMi4wIG1lc3NhZ2VcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gbWVzc2FnZSAtIG9iamVjdCB0byBiZSBwYWNrYWdlZC4gSXQgcmVxdWlyZXMgdG8gaGF2ZSBhbGwgdGhlXG4gKiAgIGZpZWxkcyBuZWVkZWQgYnkgdGhlIEpzb25SUEMgMi4wIG1lc3NhZ2UgdGhhdCBpdCdzIGdvaW5nIHRvIGJlIGdlbmVyYXRlZFxuICpcbiAqIEByZXR1cm4ge1N0cmluZ30gLSB0aGUgc3RyaW5naWZpZWQgSnNvblJQQyAyLjAgbWVzc2FnZVxuICovXG5mdW5jdGlvbiBwYWNrKG1lc3NhZ2UsIGlkKVxue1xuICB2YXIgcmVzdWx0ID1cbiAge1xuICAgIGpzb25ycGM6IFwiMi4wXCJcbiAgfTtcblxuICAvLyBSZXF1ZXN0XG4gIGlmKG1lc3NhZ2UubWV0aG9kKVxuICB7XG4gICAgcmVzdWx0Lm1ldGhvZCA9IG1lc3NhZ2UubWV0aG9kO1xuXG4gICAgaWYobWVzc2FnZS5wYXJhbXMpXG4gICAgICByZXN1bHQucGFyYW1zID0gbWVzc2FnZS5wYXJhbXM7XG5cbiAgICAvLyBSZXF1ZXN0IGlzIGEgbm90aWZpY2F0aW9uXG4gICAgaWYoaWQgIT0gdW5kZWZpbmVkKVxuICAgICAgcmVzdWx0LmlkID0gaWQ7XG4gIH1cblxuICAvLyBSZXNwb25zZVxuICBlbHNlIGlmKGlkICE9IHVuZGVmaW5lZClcbiAge1xuICAgIGlmKG1lc3NhZ2UuZXJyb3IpXG4gICAge1xuICAgICAgaWYobWVzc2FnZS5yZXN1bHQgIT09IHVuZGVmaW5lZClcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkJvdGggcmVzdWx0IGFuZCBlcnJvciBhcmUgZGVmaW5lZFwiKTtcblxuICAgICAgcmVzdWx0LmVycm9yID0gbWVzc2FnZS5lcnJvcjtcbiAgICB9XG4gICAgZWxzZSBpZihtZXNzYWdlLnJlc3VsdCAhPT0gdW5kZWZpbmVkKVxuICAgICAgcmVzdWx0LnJlc3VsdCA9IG1lc3NhZ2UucmVzdWx0O1xuICAgIGVsc2VcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJObyByZXN1bHQgb3IgZXJyb3IgaXMgZGVmaW5lZFwiKTtcblxuICAgIHJlc3VsdC5pZCA9IGlkO1xuICB9O1xuXG4gIHJldHVybiBKU09OLnN0cmluZ2lmeShyZXN1bHQpO1xufTtcblxuLyoqXG4gKiBVbnBhY2sgYSBKc29uUlBDIDIuMCBtZXNzYWdlXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG1lc3NhZ2UgLSBzdHJpbmcgd2l0aCB0aGUgY29udGVudCBvZiB0aGUgSnNvblJQQyAyLjAgbWVzc2FnZVxuICpcbiAqIEB0aHJvd3Mge1R5cGVFcnJvcn0gLSBJbnZhbGlkIEpzb25SUEMgdmVyc2lvblxuICpcbiAqIEByZXR1cm4ge09iamVjdH0gLSBvYmplY3QgZmlsbGVkIHdpdGggdGhlIEpzb25SUEMgMi4wIG1lc3NhZ2UgY29udGVudFxuICovXG5mdW5jdGlvbiB1bnBhY2sobWVzc2FnZSlcbntcbiAgdmFyIHJlc3VsdCA9IG1lc3NhZ2U7XG5cbiAgaWYodHlwZW9mIG1lc3NhZ2UgPT09ICdzdHJpbmcnIHx8IG1lc3NhZ2UgaW5zdGFuY2VvZiBTdHJpbmcpIHtcbiAgICByZXN1bHQgPSBKU09OLnBhcnNlKG1lc3NhZ2UpO1xuICB9XG5cbiAgLy8gQ2hlY2sgaWYgaXQncyBhIHZhbGlkIG1lc3NhZ2VcblxuICB2YXIgdmVyc2lvbiA9IHJlc3VsdC5qc29ucnBjO1xuICBpZih2ZXJzaW9uICE9PSAnMi4wJylcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiSW52YWxpZCBKc29uUlBDIHZlcnNpb24gJ1wiICsgdmVyc2lvbiArIFwiJzogXCIgKyBtZXNzYWdlKTtcblxuICAvLyBSZXNwb25zZVxuICBpZihyZXN1bHQubWV0aG9kID09IHVuZGVmaW5lZClcbiAge1xuICAgIGlmKHJlc3VsdC5pZCA9PSB1bmRlZmluZWQpXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiSW52YWxpZCBtZXNzYWdlOiBcIittZXNzYWdlKTtcblxuICAgIHZhciByZXN1bHRfZGVmaW5lZCA9IHJlc3VsdC5yZXN1bHQgIT09IHVuZGVmaW5lZDtcbiAgICB2YXIgZXJyb3JfZGVmaW5lZCAgPSByZXN1bHQuZXJyb3IgICE9PSB1bmRlZmluZWQ7XG5cbiAgICAvLyBDaGVjayBvbmx5IHJlc3VsdCBvciBlcnJvciBpcyBkZWZpbmVkLCBub3QgYm90aCBvciBub25lXG4gICAgaWYocmVzdWx0X2RlZmluZWQgJiYgZXJyb3JfZGVmaW5lZClcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJCb3RoIHJlc3VsdCBhbmQgZXJyb3IgYXJlIGRlZmluZWQ6IFwiK21lc3NhZ2UpO1xuXG4gICAgaWYoIXJlc3VsdF9kZWZpbmVkICYmICFlcnJvcl9kZWZpbmVkKVxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk5vIHJlc3VsdCBvciBlcnJvciBpcyBkZWZpbmVkOiBcIittZXNzYWdlKTtcblxuICAgIHJlc3VsdC5hY2sgPSByZXN1bHQuaWQ7XG4gICAgZGVsZXRlIHJlc3VsdC5pZDtcbiAgfVxuXG4gIC8vIFJldHVybiB1bnBhY2tlZCBtZXNzYWdlXG4gIHJldHVybiByZXN1bHQ7XG59O1xuXG5cbmV4cG9ydHMucGFjayAgID0gcGFjaztcbmV4cG9ydHMudW5wYWNrID0gdW5wYWNrO1xuIiwiZnVuY3Rpb24gcGFjayhtZXNzYWdlKVxue1xuICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiTm90IHlldCBpbXBsZW1lbnRlZFwiKTtcbn07XG5cbmZ1bmN0aW9uIHVucGFjayhtZXNzYWdlKVxue1xuICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiTm90IHlldCBpbXBsZW1lbnRlZFwiKTtcbn07XG5cblxuZXhwb3J0cy5wYWNrICAgPSBwYWNrO1xuZXhwb3J0cy51bnBhY2sgPSB1bnBhY2s7XG4iLCJ2YXIgSnNvblJQQyA9IHJlcXVpcmUoJy4vSnNvblJQQycpO1xudmFyIFhtbFJQQyAgPSByZXF1aXJlKCcuL1htbFJQQycpO1xuXG5cbmV4cG9ydHMuSnNvblJQQyA9IEpzb25SUEM7XG5leHBvcnRzLlhtbFJQQyAgPSBYbWxSUEM7XG4iLCIvLyBDb3B5cmlnaHQgSm95ZW50LCBJbmMuIGFuZCBvdGhlciBOb2RlIGNvbnRyaWJ1dG9ycy5cbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYVxuLy8gY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZVxuLy8gXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nXG4vLyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsXG4vLyBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0XG4vLyBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGVcbi8vIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy9cbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkXG4vLyBpbiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTXG4vLyBPUiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GXG4vLyBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOXG4vLyBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSxcbi8vIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUlxuLy8gT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRVxuLy8gVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cblxuZnVuY3Rpb24gRXZlbnRFbWl0dGVyKCkge1xuICB0aGlzLl9ldmVudHMgPSB0aGlzLl9ldmVudHMgfHwge307XG4gIHRoaXMuX21heExpc3RlbmVycyA9IHRoaXMuX21heExpc3RlbmVycyB8fCB1bmRlZmluZWQ7XG59XG5tb2R1bGUuZXhwb3J0cyA9IEV2ZW50RW1pdHRlcjtcblxuLy8gQmFja3dhcmRzLWNvbXBhdCB3aXRoIG5vZGUgMC4xMC54XG5FdmVudEVtaXR0ZXIuRXZlbnRFbWl0dGVyID0gRXZlbnRFbWl0dGVyO1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLl9ldmVudHMgPSB1bmRlZmluZWQ7XG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLl9tYXhMaXN0ZW5lcnMgPSB1bmRlZmluZWQ7XG5cbi8vIEJ5IGRlZmF1bHQgRXZlbnRFbWl0dGVycyB3aWxsIHByaW50IGEgd2FybmluZyBpZiBtb3JlIHRoYW4gMTAgbGlzdGVuZXJzIGFyZVxuLy8gYWRkZWQgdG8gaXQuIFRoaXMgaXMgYSB1c2VmdWwgZGVmYXVsdCB3aGljaCBoZWxwcyBmaW5kaW5nIG1lbW9yeSBsZWFrcy5cbkV2ZW50RW1pdHRlci5kZWZhdWx0TWF4TGlzdGVuZXJzID0gMTA7XG5cbi8vIE9idmlvdXNseSBub3QgYWxsIEVtaXR0ZXJzIHNob3VsZCBiZSBsaW1pdGVkIHRvIDEwLiBUaGlzIGZ1bmN0aW9uIGFsbG93c1xuLy8gdGhhdCB0byBiZSBpbmNyZWFzZWQuIFNldCB0byB6ZXJvIGZvciB1bmxpbWl0ZWQuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnNldE1heExpc3RlbmVycyA9IGZ1bmN0aW9uKG4pIHtcbiAgaWYgKCFpc051bWJlcihuKSB8fCBuIDwgMCB8fCBpc05hTihuKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ24gbXVzdCBiZSBhIHBvc2l0aXZlIG51bWJlcicpO1xuICB0aGlzLl9tYXhMaXN0ZW5lcnMgPSBuO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuZW1pdCA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgdmFyIGVyLCBoYW5kbGVyLCBsZW4sIGFyZ3MsIGksIGxpc3RlbmVycztcblxuICBpZiAoIXRoaXMuX2V2ZW50cylcbiAgICB0aGlzLl9ldmVudHMgPSB7fTtcblxuICAvLyBJZiB0aGVyZSBpcyBubyAnZXJyb3InIGV2ZW50IGxpc3RlbmVyIHRoZW4gdGhyb3cuXG4gIGlmICh0eXBlID09PSAnZXJyb3InKSB7XG4gICAgaWYgKCF0aGlzLl9ldmVudHMuZXJyb3IgfHxcbiAgICAgICAgKGlzT2JqZWN0KHRoaXMuX2V2ZW50cy5lcnJvcikgJiYgIXRoaXMuX2V2ZW50cy5lcnJvci5sZW5ndGgpKSB7XG4gICAgICBlciA9IGFyZ3VtZW50c1sxXTtcbiAgICAgIGlmIChlciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgIHRocm93IGVyOyAvLyBVbmhhbmRsZWQgJ2Vycm9yJyBldmVudFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQXQgbGVhc3QgZ2l2ZSBzb21lIGtpbmQgb2YgY29udGV4dCB0byB0aGUgdXNlclxuICAgICAgICB2YXIgZXJyID0gbmV3IEVycm9yKCdVbmNhdWdodCwgdW5zcGVjaWZpZWQgXCJlcnJvclwiIGV2ZW50LiAoJyArIGVyICsgJyknKTtcbiAgICAgICAgZXJyLmNvbnRleHQgPSBlcjtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGhhbmRsZXIgPSB0aGlzLl9ldmVudHNbdHlwZV07XG5cbiAgaWYgKGlzVW5kZWZpbmVkKGhhbmRsZXIpKVxuICAgIHJldHVybiBmYWxzZTtcblxuICBpZiAoaXNGdW5jdGlvbihoYW5kbGVyKSkge1xuICAgIHN3aXRjaCAoYXJndW1lbnRzLmxlbmd0aCkge1xuICAgICAgLy8gZmFzdCBjYXNlc1xuICAgICAgY2FzZSAxOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcyk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAyOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcywgYXJndW1lbnRzWzFdKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIDM6XG4gICAgICAgIGhhbmRsZXIuY2FsbCh0aGlzLCBhcmd1bWVudHNbMV0sIGFyZ3VtZW50c1syXSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgLy8gc2xvd2VyXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgICAgICAgaGFuZGxlci5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICB9XG4gIH0gZWxzZSBpZiAoaXNPYmplY3QoaGFuZGxlcikpIHtcbiAgICBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgICBsaXN0ZW5lcnMgPSBoYW5kbGVyLnNsaWNlKCk7XG4gICAgbGVuID0gbGlzdGVuZXJzLmxlbmd0aDtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGVuOyBpKyspXG4gICAgICBsaXN0ZW5lcnNbaV0uYXBwbHkodGhpcywgYXJncyk7XG4gIH1cblxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuYWRkTGlzdGVuZXIgPSBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lcikge1xuICB2YXIgbTtcblxuICBpZiAoIWlzRnVuY3Rpb24obGlzdGVuZXIpKVxuICAgIHRocm93IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMpXG4gICAgdGhpcy5fZXZlbnRzID0ge307XG5cbiAgLy8gVG8gYXZvaWQgcmVjdXJzaW9uIGluIHRoZSBjYXNlIHRoYXQgdHlwZSA9PT0gXCJuZXdMaXN0ZW5lclwiISBCZWZvcmVcbiAgLy8gYWRkaW5nIGl0IHRvIHRoZSBsaXN0ZW5lcnMsIGZpcnN0IGVtaXQgXCJuZXdMaXN0ZW5lclwiLlxuICBpZiAodGhpcy5fZXZlbnRzLm5ld0xpc3RlbmVyKVxuICAgIHRoaXMuZW1pdCgnbmV3TGlzdGVuZXInLCB0eXBlLFxuICAgICAgICAgICAgICBpc0Z1bmN0aW9uKGxpc3RlbmVyLmxpc3RlbmVyKSA/XG4gICAgICAgICAgICAgIGxpc3RlbmVyLmxpc3RlbmVyIDogbGlzdGVuZXIpO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgIC8vIE9wdGltaXplIHRoZSBjYXNlIG9mIG9uZSBsaXN0ZW5lci4gRG9uJ3QgbmVlZCB0aGUgZXh0cmEgYXJyYXkgb2JqZWN0LlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXSA9IGxpc3RlbmVyO1xuICBlbHNlIGlmIChpc09iamVjdCh0aGlzLl9ldmVudHNbdHlwZV0pKVxuICAgIC8vIElmIHdlJ3ZlIGFscmVhZHkgZ290IGFuIGFycmF5LCBqdXN0IGFwcGVuZC5cbiAgICB0aGlzLl9ldmVudHNbdHlwZV0ucHVzaChsaXN0ZW5lcik7XG4gIGVsc2VcbiAgICAvLyBBZGRpbmcgdGhlIHNlY29uZCBlbGVtZW50LCBuZWVkIHRvIGNoYW5nZSB0byBhcnJheS5cbiAgICB0aGlzLl9ldmVudHNbdHlwZV0gPSBbdGhpcy5fZXZlbnRzW3R5cGVdLCBsaXN0ZW5lcl07XG5cbiAgLy8gQ2hlY2sgZm9yIGxpc3RlbmVyIGxlYWtcbiAgaWYgKGlzT2JqZWN0KHRoaXMuX2V2ZW50c1t0eXBlXSkgJiYgIXRoaXMuX2V2ZW50c1t0eXBlXS53YXJuZWQpIHtcbiAgICBpZiAoIWlzVW5kZWZpbmVkKHRoaXMuX21heExpc3RlbmVycykpIHtcbiAgICAgIG0gPSB0aGlzLl9tYXhMaXN0ZW5lcnM7XG4gICAgfSBlbHNlIHtcbiAgICAgIG0gPSBFdmVudEVtaXR0ZXIuZGVmYXVsdE1heExpc3RlbmVycztcbiAgICB9XG5cbiAgICBpZiAobSAmJiBtID4gMCAmJiB0aGlzLl9ldmVudHNbdHlwZV0ubGVuZ3RoID4gbSkge1xuICAgICAgdGhpcy5fZXZlbnRzW3R5cGVdLndhcm5lZCA9IHRydWU7XG4gICAgICBjb25zb2xlLmVycm9yKCcobm9kZSkgd2FybmluZzogcG9zc2libGUgRXZlbnRFbWl0dGVyIG1lbW9yeSAnICtcbiAgICAgICAgICAgICAgICAgICAgJ2xlYWsgZGV0ZWN0ZWQuICVkIGxpc3RlbmVycyBhZGRlZC4gJyArXG4gICAgICAgICAgICAgICAgICAgICdVc2UgZW1pdHRlci5zZXRNYXhMaXN0ZW5lcnMoKSB0byBpbmNyZWFzZSBsaW1pdC4nLFxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9ldmVudHNbdHlwZV0ubGVuZ3RoKTtcbiAgICAgIGlmICh0eXBlb2YgY29uc29sZS50cmFjZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAvLyBub3Qgc3VwcG9ydGVkIGluIElFIDEwXG4gICAgICAgIGNvbnNvbGUudHJhY2UoKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUub24gPSBFdmVudEVtaXR0ZXIucHJvdG90eXBlLmFkZExpc3RlbmVyO1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLm9uY2UgPSBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lcikge1xuICBpZiAoIWlzRnVuY3Rpb24obGlzdGVuZXIpKVxuICAgIHRocm93IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG5cbiAgdmFyIGZpcmVkID0gZmFsc2U7XG5cbiAgZnVuY3Rpb24gZygpIHtcbiAgICB0aGlzLnJlbW92ZUxpc3RlbmVyKHR5cGUsIGcpO1xuXG4gICAgaWYgKCFmaXJlZCkge1xuICAgICAgZmlyZWQgPSB0cnVlO1xuICAgICAgbGlzdGVuZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9XG4gIH1cblxuICBnLmxpc3RlbmVyID0gbGlzdGVuZXI7XG4gIHRoaXMub24odHlwZSwgZyk7XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vLyBlbWl0cyBhICdyZW1vdmVMaXN0ZW5lcicgZXZlbnQgaWZmIHRoZSBsaXN0ZW5lciB3YXMgcmVtb3ZlZFxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVMaXN0ZW5lciA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIHZhciBsaXN0LCBwb3NpdGlvbiwgbGVuZ3RoLCBpO1xuXG4gIGlmICghaXNGdW5jdGlvbihsaXN0ZW5lcikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICBpZiAoIXRoaXMuX2V2ZW50cyB8fCAhdGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgIHJldHVybiB0aGlzO1xuXG4gIGxpc3QgPSB0aGlzLl9ldmVudHNbdHlwZV07XG4gIGxlbmd0aCA9IGxpc3QubGVuZ3RoO1xuICBwb3NpdGlvbiA9IC0xO1xuXG4gIGlmIChsaXN0ID09PSBsaXN0ZW5lciB8fFxuICAgICAgKGlzRnVuY3Rpb24obGlzdC5saXN0ZW5lcikgJiYgbGlzdC5saXN0ZW5lciA9PT0gbGlzdGVuZXIpKSB7XG4gICAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgICBpZiAodGhpcy5fZXZlbnRzLnJlbW92ZUxpc3RlbmVyKVxuICAgICAgdGhpcy5lbWl0KCdyZW1vdmVMaXN0ZW5lcicsIHR5cGUsIGxpc3RlbmVyKTtcblxuICB9IGVsc2UgaWYgKGlzT2JqZWN0KGxpc3QpKSB7XG4gICAgZm9yIChpID0gbGVuZ3RoOyBpLS0gPiAwOykge1xuICAgICAgaWYgKGxpc3RbaV0gPT09IGxpc3RlbmVyIHx8XG4gICAgICAgICAgKGxpc3RbaV0ubGlzdGVuZXIgJiYgbGlzdFtpXS5saXN0ZW5lciA9PT0gbGlzdGVuZXIpKSB7XG4gICAgICAgIHBvc2l0aW9uID0gaTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHBvc2l0aW9uIDwgMClcbiAgICAgIHJldHVybiB0aGlzO1xuXG4gICAgaWYgKGxpc3QubGVuZ3RoID09PSAxKSB7XG4gICAgICBsaXN0Lmxlbmd0aCA9IDA7XG4gICAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICAgIH0gZWxzZSB7XG4gICAgICBsaXN0LnNwbGljZShwb3NpdGlvbiwgMSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2V2ZW50cy5yZW1vdmVMaXN0ZW5lcilcbiAgICAgIHRoaXMuZW1pdCgncmVtb3ZlTGlzdGVuZXInLCB0eXBlLCBsaXN0ZW5lcik7XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUucmVtb3ZlQWxsTGlzdGVuZXJzID0gZnVuY3Rpb24odHlwZSkge1xuICB2YXIga2V5LCBsaXN0ZW5lcnM7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMpXG4gICAgcmV0dXJuIHRoaXM7XG5cbiAgLy8gbm90IGxpc3RlbmluZyBmb3IgcmVtb3ZlTGlzdGVuZXIsIG5vIG5lZWQgdG8gZW1pdFxuICBpZiAoIXRoaXMuX2V2ZW50cy5yZW1vdmVMaXN0ZW5lcikge1xuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKVxuICAgICAgdGhpcy5fZXZlbnRzID0ge307XG4gICAgZWxzZSBpZiAodGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgICAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vIGVtaXQgcmVtb3ZlTGlzdGVuZXIgZm9yIGFsbCBsaXN0ZW5lcnMgb24gYWxsIGV2ZW50c1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgIGZvciAoa2V5IGluIHRoaXMuX2V2ZW50cykge1xuICAgICAgaWYgKGtleSA9PT0gJ3JlbW92ZUxpc3RlbmVyJykgY29udGludWU7XG4gICAgICB0aGlzLnJlbW92ZUFsbExpc3RlbmVycyhrZXkpO1xuICAgIH1cbiAgICB0aGlzLnJlbW92ZUFsbExpc3RlbmVycygncmVtb3ZlTGlzdGVuZXInKTtcbiAgICB0aGlzLl9ldmVudHMgPSB7fTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIGxpc3RlbmVycyA9IHRoaXMuX2V2ZW50c1t0eXBlXTtcblxuICBpZiAoaXNGdW5jdGlvbihsaXN0ZW5lcnMpKSB7XG4gICAgdGhpcy5yZW1vdmVMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcnMpO1xuICB9IGVsc2UgaWYgKGxpc3RlbmVycykge1xuICAgIC8vIExJRk8gb3JkZXJcbiAgICB3aGlsZSAobGlzdGVuZXJzLmxlbmd0aClcbiAgICAgIHRoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSwgbGlzdGVuZXJzW2xpc3RlbmVycy5sZW5ndGggLSAxXSk7XG4gIH1cbiAgZGVsZXRlIHRoaXMuX2V2ZW50c1t0eXBlXTtcblxuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUubGlzdGVuZXJzID0gZnVuY3Rpb24odHlwZSkge1xuICB2YXIgcmV0O1xuICBpZiAoIXRoaXMuX2V2ZW50cyB8fCAhdGhpcy5fZXZlbnRzW3R5cGVdKVxuICAgIHJldCA9IFtdO1xuICBlbHNlIGlmIChpc0Z1bmN0aW9uKHRoaXMuX2V2ZW50c1t0eXBlXSkpXG4gICAgcmV0ID0gW3RoaXMuX2V2ZW50c1t0eXBlXV07XG4gIGVsc2VcbiAgICByZXQgPSB0aGlzLl9ldmVudHNbdHlwZV0uc2xpY2UoKTtcbiAgcmV0dXJuIHJldDtcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUubGlzdGVuZXJDb3VudCA9IGZ1bmN0aW9uKHR5cGUpIHtcbiAgaWYgKHRoaXMuX2V2ZW50cykge1xuICAgIHZhciBldmxpc3RlbmVyID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gICAgaWYgKGlzRnVuY3Rpb24oZXZsaXN0ZW5lcikpXG4gICAgICByZXR1cm4gMTtcbiAgICBlbHNlIGlmIChldmxpc3RlbmVyKVxuICAgICAgcmV0dXJuIGV2bGlzdGVuZXIubGVuZ3RoO1xuICB9XG4gIHJldHVybiAwO1xufTtcblxuRXZlbnRFbWl0dGVyLmxpc3RlbmVyQ291bnQgPSBmdW5jdGlvbihlbWl0dGVyLCB0eXBlKSB7XG4gIHJldHVybiBlbWl0dGVyLmxpc3RlbmVyQ291bnQodHlwZSk7XG59O1xuXG5mdW5jdGlvbiBpc0Z1bmN0aW9uKGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ2Z1bmN0aW9uJztcbn1cblxuZnVuY3Rpb24gaXNOdW1iZXIoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnbnVtYmVyJztcbn1cblxuZnVuY3Rpb24gaXNPYmplY3QoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnb2JqZWN0JyAmJiBhcmcgIT09IG51bGw7XG59XG5cbmZ1bmN0aW9uIGlzVW5kZWZpbmVkKGFyZykge1xuICByZXR1cm4gYXJnID09PSB2b2lkIDA7XG59XG4iLCJpZiAodHlwZW9mIE9iamVjdC5jcmVhdGUgPT09ICdmdW5jdGlvbicpIHtcbiAgLy8gaW1wbGVtZW50YXRpb24gZnJvbSBzdGFuZGFyZCBub2RlLmpzICd1dGlsJyBtb2R1bGVcbiAgbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBpbmhlcml0cyhjdG9yLCBzdXBlckN0b3IpIHtcbiAgICBpZiAoc3VwZXJDdG9yKSB7XG4gICAgICBjdG9yLnN1cGVyXyA9IHN1cGVyQ3RvclxuICAgICAgY3Rvci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKHN1cGVyQ3Rvci5wcm90b3R5cGUsIHtcbiAgICAgICAgY29uc3RydWN0b3I6IHtcbiAgICAgICAgICB2YWx1ZTogY3RvcixcbiAgICAgICAgICBlbnVtZXJhYmxlOiBmYWxzZSxcbiAgICAgICAgICB3cml0YWJsZTogdHJ1ZSxcbiAgICAgICAgICBjb25maWd1cmFibGU6IHRydWVcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9XG4gIH07XG59IGVsc2Uge1xuICAvLyBvbGQgc2Nob29sIHNoaW0gZm9yIG9sZCBicm93c2Vyc1xuICBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGluaGVyaXRzKGN0b3IsIHN1cGVyQ3Rvcikge1xuICAgIGlmIChzdXBlckN0b3IpIHtcbiAgICAgIGN0b3Iuc3VwZXJfID0gc3VwZXJDdG9yXG4gICAgICB2YXIgVGVtcEN0b3IgPSBmdW5jdGlvbiAoKSB7fVxuICAgICAgVGVtcEN0b3IucHJvdG90eXBlID0gc3VwZXJDdG9yLnByb3RvdHlwZVxuICAgICAgY3Rvci5wcm90b3R5cGUgPSBuZXcgVGVtcEN0b3IoKVxuICAgICAgY3Rvci5wcm90b3R5cGUuY29uc3RydWN0b3IgPSBjdG9yXG4gICAgfVxuICB9XG59XG4iXX0=
