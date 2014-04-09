'use strict';

var fs = require('fs');


function ClusterProbe(agent) {
  this.agent = agent;

  this.packages = ['cluster'];
}
exports.ClusterProbe = ClusterProbe;



ClusterProbe.prototype.attach = function(obj) {
  var self = this;

  if(obj.__appdynamicsProbeAttached__) return;
  obj.__appdynamicsProbeAttached__ = true;

  var proxy = self.agent.proxy;

  var indexDirExists = false;

  proxy.after(obj, 'fork', function(obj, args, ret) {
    var indexMap = {};
    var maxIndex = 0;
    for(var id in obj.workers) {
      var worker = obj.workers[id];

      if(worker.__appdNodeIndex !== undefined) {
        indexMap[worker.__appdNodeIndex] = true;

        if(worker.__appdNodeIndex > maxIndex) {
          maxIndex = worker.__appdNodeIndex;
        }
      }
    }

    var freeIndex = undefined;
    for(var i = 1; i <= maxIndex; i++) {
      if(!indexMap[i]) {
        freeIndex = i;
        break;
      }
    }

    if(freeIndex === undefined) {
      freeIndex = maxIndex + 1;
    }

    ret.__appdNodeIndex = freeIndex;

    var indexDir = self.agent.tmpDir + '/index';
    if(indexDirExists) {
      writeIndexPid();
    }
    else if(fs.existsSync(indexDir)) {
      indexDirExists = true;
      writeIndexPid();
    }
    else {
      fs.mkdirSync(indexDir);
      indexDirExists = true;
      writeIndexPid()
    }

    function writeIndexPid() {
      fs.writeFile(indexDir + '/' + freeIndex + '.pid', ret.process.pid, function(err) {
        if(err) return self.agent.logger.error(err);
      });
    }
  });
};


function calculateSize(args) {
  if(args.length < 1) return 0;

  return args[0].length || 0; // approximate for strings
}

