'use strict';


var commands = [
  'get',
  'gets',
  'getMulti',
  'set',
  'replace',
  'add',
  'cas',
  'append',
  'prepend',
  'increment',
  'decrement',
  'incr',
  'decr',
  'del',
  'delete',
  'version',
  'flush',
  'samples',
  'slabs',
  'items',
  'flushAll',
  'statsSettings',
  'statsSlabs',
  'statsItems',
  'cachedump'
];


function MemcachedProbe(agent) {
  this.agent = agent;

  this.packages = ['memcached'];
}
exports.MemcachedProbe = MemcachedProbe;



MemcachedProbe.prototype.attach = function(obj) {
  var self = this;

  if(obj.__appdynamicsProbeAttached__) return;
  obj.__appdynamicsProbeAttached__ = true;

  var proxy = self.agent.proxy;
  var profiler = self.agent.profiler;

  commands.forEach(function(command) {
    proxy.before(obj.prototype, command, function(obj, args) {
      // ignore, getMulti will be called
      if(command === 'get' && Array.isArray(args[0])) return;

      var client = obj;
      var trace = profiler.stackTrace();
      var params = args;
      var time = profiler.time();

      proxy.callback(args, -1, function(obj, args) {
        if(!time.done()) return;

        var error = proxy.getErrorObject(args);
        var sample = profiler.createExitCall();
        sample.command = command;
        sample.commandArgs = profiler.truncate(params);
        sample.stackTrace = trace;
        sample.error = error;

        var serverPool = [];
        if(typeof(client.servers) === 'string') {
          serverPool = [client.servers];
        }
        else if(typeof(client.servers) === 'object') {
          if(Array.isArray(client.servers)) {
            client.servers.forEach(function(server) {
              serverPool.push(server);
            });
          }
          else {
            for(var prop in client.servers) {
              serverPool.push(prop);
            }
          }
        }

        if(client.servers.length == 0) {
          // incomplete exit call
          return;
        }

        sample.label = serverPool[serverPool.length - 1] + ' - Memcached';

        serverPool.sort();

        sample.identifyingProperties = {
          "Server Pool" : serverPool.join("\n")
        };
        sample.exitType = 'EXIT_CACHE';
        sample.backendName = 'Memcached';

        profiler.addExitCall(time, sample);
      });
    });
  });
};
