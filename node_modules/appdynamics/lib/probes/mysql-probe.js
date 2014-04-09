'use strict';


function MysqlProbe(agent) {
  this.agent = agent;

  this.packages = ['mysql'];
}
exports.MysqlProbe = MysqlProbe;



MysqlProbe.prototype.attach = function(obj) {
  var self = this;

  if(obj.__appdynamicsProbeAttached__) return;
  obj.__appdynamicsProbeAttached__ = true;

  var proxy = self.agent.proxy;
  var profiler = self.agent.profiler;
  var type = 'MySQL';

  ['createClient', 'createConnection'].forEach(function(createCmd) {
    proxy.after(obj, createCmd, function(obj, args, ret) {
      var client = ret;
      var config = (createCmd === 'createClient' ? client : client.config);
      if(!config) return;

      proxy.before(client, 'query', function(obj, args) {
        var trace = profiler.stackTrace();
        var command = args.length > 0 ? args[0] : undefined;
        var params = args.length > 1 && Array.isArray(args[1]) ? args[1] : undefined;
        var time = profiler.time();

        proxy.callback(args, -1, function(obj, args) {
          if(!time.done()) return;

          var error = proxy.getErrorObject(args);
          var sample = profiler.createExitCall();
          sample.user = config.user;
          var database = config.database !== '' ? config.database : undefined;
          sample.identifyingProperties = {
            Host : config.host,
            Port : config.port,
            Vendor : "MYSQL"
          };
          if(database) sample.identifyingProperties['Database'] = database;
          sample.command = profiler.truncate(command);
          sample.commandArgs = profiler.truncate(params);
          sample.stackTrace = trace;
          sample.error = error;
          sample.label = config.host + ':' + config.port + ' - MySQL';

          sample.exitType = 'EXIT_DB';
          sample.isSql = true;
          sample.backendName = 'MySQL';

          profiler.addExitCall(time, sample);
        });
      });
    });
  });
};
