'use strict';


var internalCommands = [
  '_executeQueryCommand',
  '_executeInsertCommand',
  '_executeUpdateCommand',
  '_executeRemoveCommand'
];

var commandMap = {
  '_executeQueryCommand': 'find',
  '_executeInsertCommand': 'insert',
  '_executeUpdateCommand': 'update',
  '_executeRemoveCommand': 'remove'
};



function MongodbProbe(agent) {
  this.agent = agent;

  this.packages = ['mongodb'];
}
exports.MongodbProbe = MongodbProbe;



MongodbProbe.prototype.attach = function(obj) {
  var self = this;

  if(obj.__appdynamicsProbeAttached__) return;
  obj.__appdynamicsProbeAttached__ = true;

  var proxy = self.agent.proxy;
  var profiler = self.agent.profiler;


  internalCommands.forEach(function(internalCommand) {
    var commandName = commandMap[internalCommand] || internalCommand;

    proxy.before(obj.Db.prototype, internalCommand, function(obj, args) {
      var trace = profiler.stackTrace();
      var command = (args && args.length > 0) ? args[0] : undefined;

      var time = profiler.time();

      proxy.callback(args, -1, function(obj, args) {
        if(!time.done()) return;

        var commandArgs = {
          databaseName: undefined,
          collectionName: undefined,
          query: undefined,
          queryOptions: undefined,
          numberToSkip: undefined,
          numberToReturn: undefined,
          auth: undefined
        };
        var serverPool = [];
        if(command && command.db) {
          commandArgs.databaseName = command.db.databaseName;
          commandArgs.collectionName = command.collectionName;
          commandArgs.query = command.query ? profiler.truncate(JSON.stringify(command.query)) : '';
          commandArgs.queryOptions = command.queryOptions;
          commandArgs.numberToSkip = command.numberToSkip;
          commandArgs.numberToReturn = command.numberToReturn;

          if(command.db.auths && command.db.auths.length > 0) {
            commandArgs.auth = command.db.auths[0];
          }

          var serverConfig = command.db.serverConfig;
          if(serverConfig) {
            if(serverConfig.host && serverConfig.port) {
              serverPool.push(serverConfig.host + ':' + serverConfig.port)
            }
            else if(Array.isArray(serverConfig.servers)) {
              serverConfig.servers.forEach(function(server) {
                serverPool.push(server.host + ':' + server.port);
              });
            }
          }
        }

        var error = proxy.getErrorObject(args);
        var sample = profiler.createExitCall();
        sample.command = commandName;
        sample.commandArgs = commandArgs;
        sample.stackTrace = trace;
        sample.error = error;
        if (serverPool.length == 0)
          return; // incomplete exit call

        sample.label = serverPool[serverPool.length - 1] + ' - MongoDB';
        sample.identifyingProperties = {
          "Server Pool" : serverPool.sort().join("\n"),
          Vendor : "MONGODB",
          Database : commandArgs.databaseName
        };
        serverPool = serverPool.sort();


        sample.exitType = 'EXIT_DB';
        if(internalCommand === '_executeQueryCommand') {
          sample.category = "read";
        }
        else {
          sample.category = "write"
        }
        sample.backendName = 'MongoDB';
        sample.vendor = "MONGODB";

        profiler.addExitCall(time, sample);
      });
    });
  });
};
