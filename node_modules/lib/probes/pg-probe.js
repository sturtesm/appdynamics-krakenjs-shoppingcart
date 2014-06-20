'use strict';


function PgProbe(agent) {
  this.agent = agent;

  this.packages = ['pg'];
}
exports.PgProbe = PgProbe;



PgProbe.prototype.attach = function(obj) {
  var self = this;

  if(obj.__appdynamicsProbeAttached__) return;
  obj.__appdynamicsProbeAttached__ = true;

  var proxy = self.agent.proxy;
  var profiler = self.agent.profiler;

  function probe(obj) {
    if(obj.__appdynamicsProbeAttached__) return;
    obj.__appdynamicsProbeAttached__ = true;

    // Callback API
    proxy.before(obj, 'query', function(obj, args, ret) {
      var client = obj;
      var trace = profiler.stackTrace();
      var command = args.length > 0 ? args[0] : undefined;
      var params = args.length > 1 && Array.isArray(args[1]) ? args[1] : undefined;
      var time = profiler.time();

      proxy.callback(args, -1, function(obj, args) {
        if(!time.done()) return;

        var error = proxy.getErrorObject(args);
        var sample = profiler.createExitCall();
        sample.user = client.user;
        var database = client.database ? client.database : undefined;
        sample.identifyingProperties = {
          Host : client.host,
          Port : client.port,
          Database : database,
          Vendor : "POSTGRESQL"
        };
        sample.command = truncate(profiler, command);
        sample.commandArgs = profiler.truncate(params);
        sample.stackTrace = trace;
        sample.error = error;
        sample.label = client.host + ':' + client.port + ' - PostgreSQL';
        sample.exitType = 'EXIT_DB';
        sample.isSql = true;
        sample.backendName = 'PostgreSQL';

        profiler.addExitCall(time, sample);
      });
    });


    // Evented API
    proxy.after(obj, 'query', function(obj, args, ret) {
      // If has a callback, ignore
      if(args.length > 0 && typeof args[args.length - 1] === 'function') return;

      var client = obj;
      var trace = profiler.stackTrace();
      var command = args.length > 0 ? args[0] : undefined;
      var params = args.length > 1 && Array.isArray(args[1]) ? args[1] : undefined;
      var time = profiler.time();
      var error;

      proxy.before(ret, 'on', function(obj, args) {
        var event = args[0];

        if(event !== 'end' && event !== 'error') return;

        proxy.callback(args, -1, function(obj, args) {
          if(event === 'error') {
            error = proxy.getErrorObject(args);
            return;
          }

          if(!time.done()) return;

          var sample = profiler.createExitCall();
          sample.command = truncate(profiler, command);
          sample.commandArgs = profiler.truncate(params);
          var database = client.database ? client.database : undefined;
          sample.identifyingProperties = {
            Host : client.host,
            Port : client.port,
            Database : database,
            Vendor : "POSTGRESQL"
          };
          sample.user = client.user;
          sample.stackTrace = trace;
          sample.error = error;
          sample.label = client.host + ':' + client.host + ' - ' + 'PostgreSQL';
          sample.exitType = 'EXIT_DB';
          sample.isSql = true;
          sample.backendName = 'PostgreSQL';

          profiler.addExitCall(time, sample);
        });
      });
    });
  }


  // Native, reinitialize probe
  proxy.getter(obj, 'native', function(obj, ret) {
    proxy.after(ret, 'Client', function(obj, args, ret) {
      probe(ret.__proto__);
    });
  });

  probe(obj.Client.prototype);
};


function truncate(profiler, str) {
  if(str && typeof(str) === 'object') {
    str = str.text;
  }

  return profiler.truncate(str);
}
