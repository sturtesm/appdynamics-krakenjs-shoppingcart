'use strict';

var url = require('url');


function HttpProbe(agent) {
  this.agent = agent;

  this.packages = ['http', 'https'];
}
exports.HttpProbe = HttpProbe;



HttpProbe.prototype.attach = function(obj, moduleName) {
  var self = this;

  if(obj.__appdynamicsProbeAttached__) return;
  obj.__appdynamicsProbeAttached__ = true;

  self.isHTTPs = obj.Agent && (obj.Agent.prototype.defaultPort == 443);

  var proxy = self.agent.proxy;
  var profiler = self.agent.profiler;


  // server probe
  proxy.before(obj.Server.prototype, ['on', 'addListener'], function(obj, args) {
    if(args[0] !== 'request') return;

    if(obj.__httpProbe__) return;
    obj.__httpProbe__ = true;

    proxy.callback(args, -1, function(obj, args) {
      var req = args[0];
      var res = args[1];
      var time = profiler.time(true);

      var transaction = profiler.startTransaction(time, req, 'NODEJS_WEB');

      proxy.after(res, 'end', function(obj, args) {
        var error = res.__caughtException__;
        if(error) res.__caughtException__ = undefined;

        if(!time.done()) return;

        transaction.method = req.method;
        transaction.url = req.url;
        transaction.requestHeaders = req.headers;
        transaction.statusCode = res.statusCode;
        transaction.stackTrace = profiler.formatStackTrace(error);
        transaction.error = error;

        profiler.endTransaction(time, transaction);
      });
    });
  });



  // client probe

  function clientCallback(locals) {
    if(!locals.time.done()) return;

    if(!locals.opts.port) {
      // by default port will be 80 for http, 443 for https
      // but we don't know what protocol is in play, so we
      // need to dig up the actual port used
      try {
        locals.opts.port = locals.res.req.connection.socket.remotePort;
      } catch (e) {
        self.agent.logger.error('Unable to determine port for outgoing HTTP request.');
        return;
      }
    }
    var exitCall = locals.exitCall;

    if(locals.res) {
      exitCall.responseHeaders = locals.res.headers;
      exitCall.stausCode = locals.res.statusCode;
    }
    exitCall.stackTrace = locals.stackTrace;
    exitCall.error = locals.error
    exitCall.identifyingProperties = {
      HOST: locals.opts.hostname || locals.opts.host,
      PORT: locals.opts.port
    };
    var protocol = locals.opts.protocol || (self.isHTTPs ? "https:" : "http:");
    exitCall.label = protocol + '//' + (locals.opts.hostname || locals.opts.host) + ':' + locals.opts.port;
    exitCall.exitType = 'EXIT_HTTP';
    exitCall.category = ((locals.opts.method === 'POST' || locals.opts.method === 'PUT') ? "write" : "read");
    exitCall.backendName = 'HTTP';
    exitCall.error = locals.error

    profiler.addExitCall(locals.time, exitCall);
  }

  // support 0.11.x and further
  if(obj.globalAgent && obj.globalAgent.request) {
    obj = obj.globalAgent;
  }

  proxy.around(obj, 'request', function(obj, args, locals) {
    if(typeof(args[0]) === 'string') {
      locals.opts = url.parse(args[0]);
    }
    else {
      locals.opts = args[0];
    }
    var protocol = (moduleName === 'https' ? 'https:' : 'http:')
    var host = locals.opts.hostname || locals.opts.host;
    var port = locals.opts.port || (moduleName === 'https' ? 443 : 80);

    locals.time = profiler.time();

    // unlike other backends the info is gathered in advance
    // to make outgoing correlation header generation possible
    var exitCall = locals.exitCall = profiler.createExitCall(locals.time);
    exitCall.stackTrace = profiler.stackTrace();
    exitCall.group = (locals.opts.method || 'GET');
    exitCall.method = locals.opts.method;
    exitCall.command =
      host +
      ':'  +
      port +
      (locals.opts.path || '/');
    exitCall.requestHeaders = locals.opts.headers;
    exitCall.identifyingProperties = {
      HOST: host,
      PORT: port
    };
    exitCall.label = protocol + '//' + host + ':' + port;
    exitCall.exitType = 'EXIT_HTTP';
    exitCall.category = ((locals.opts.method === 'POST' || locals.opts.method === 'PUT') ? "write" : "read");
    exitCall.backendName = 'HTTP';


    proxy.callback(args, -1, function(obj, args) {
      var res = locals.res = args[0];
      proxy.before(res, ['on', 'addListener'], function(obj, args) {
        // workaround for end event
        if(args[0] === 'data' && obj.on !== undefined) {
          obj.on('end', function() {});
        }

        if(args[0] !== 'end') return;

        clientCallback(locals);
      });
    });
  },
  function(obj, args, ret, locals) {
    proxy.before(ret, 'end', function(obj, args, orig) {
      var endCallDone = false;
      function endCallOnce() {
        if(!endCallDone) {
          endCallDone = true;

          var corrHeader = self.agent.correlation.newCorrelationHeader();
          corrHeader.build(locals.transaction, locals.exitCall);

          obj.setHeader(self.agent.correlation.HEADER_NAME, corrHeader.getStringHeader());

          return orig();
        }
      }

      locals.transaction = profiler.getTransaction(locals.time.threadId);
      if(locals.transaction && !locals.transaction.btInfoResponse) {
        setTimeout(function() {
          // timeout while waiting for btInfoResponse
          return endCallOnce();
        }, 10);

        locals.transaction.once('btInfoResponse', function() {
          // got btInfoResponse
          return endCallOnce();
        });
      }
      else {
        // has btInfoResponse
        return endCallOnce();
      }
    }, false, true);

    proxy.before(ret, ['on', 'addListener'], function(obj, args) {
      if(args[0] == 'response') {
        proxy.callback(args, -1, function(obj, args) {
          locals.res = args[0];
          clientCallback(locals);
        });
      }
      else if(args[0] == 'error') {
        proxy.callback(args, -1, function(obj, args) {
          locals.error = args[0];
          clientCallback(locals);
        });
      }
    });
  });
};
