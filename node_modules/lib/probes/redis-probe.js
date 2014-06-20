'use strict';


function RedisProbe(agent) {
  this.agent = agent;

  this.packages = ['redis'];
}
exports.RedisProbe = RedisProbe;



RedisProbe.prototype.attach = function(obj) {
  var self = this;

  if(obj.__nodetimeProbeAttached__) return;
  obj.__nodetimeProbeAttached__ = true;

  var logger = self.agent.logger;
  var proxy = self.agent.proxy;
  var profiler = self.agent.profiler;

  var isSnapshotEnabled = false;

  function proxyCommand(client) {
    proxy.before(client, "send_command", function(obj, args) {
      var trace = profiler.stackTrace();
      var time = profiler.time();
      var command = args[0];
      var params = args[1];
      proxy.callback(args[1], -1, function(obj, args) {
        if(!time.done()) return;
        var error = proxy.getErrorObject(args);
        var sample = profiler.createExitCall();
        sample.command = command;
        sample.commandArgs = profiler.truncate(params);
        sample.stackTrace = trace;
        sample.error = error;
        sample.label = client.host + ':' + client.port + ' - Redis';
        sample.identifyingProperties = {
          "Server Pool" : client.host + ':' + client.port,
        };
        sample.exitType = 'EXIT_CACHE';
        sample.backendName = 'Redis';
        profiler.addExitCall(time, sample);
      }, undefined, isSnapshotEnabled);
    }, isSnapshotEnabled);


    if(isSnapshotEnabled) {
      var firstOnConnect = true;

      // the queue will be available after on_connect event
      proxy.after(client, 'on_connect', function(obj, args) {
        if(!client.command_queue) return;

        var queue = undefined;

        // injecting thread id to command objects as commands added to the queue
        if(firstOnConnect) {
          firstOnConnect = false;

          proxy.before(client.command_queue.__proto__, 'push', function(obj, args) {
            queue = obj;
            var commandObj = args[0];
            var threadId =  self.agent.thread.current();
            if(commandObj && threadId) {
              commandObj._appdThreadId = threadId;
            }
          });
        }

        if(isSnapshotEnabled) {
          // thread aware proxy
          proxy.before(client.reply_parser, 'execute', function(obj, args) {
          }, isSnapshotEnabled);


          // resume thread based on the next command
          proxy.before(client.reply_parser, 'execute', function(obj, args) {
            if(queue &&
                queue.tail &&
                queue.tail.length > 0 &&
                queue.tail[0] &&
                queue.tail[0]._appdThreadId !== undefined) {
              self.agent.thread.resume(queue.tail[0]._appdThreadId);
            }
          });
        }
      });
    }
  }


  proxy.after(obj, 'createClient', function(obj, args, ret) {
    var client = ret;

    proxyCommand(client);
  });
};
