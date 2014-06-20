'use strict';


var os = require('os');


function CpuProfiler(agent) {
  this.agent = agent;

  this.active = false;
  this.classRegex = undefined;
  this.appdRegex = undefined;
}
exports.CpuProfiler = CpuProfiler;



CpuProfiler.prototype.init = function() {
  var self = this;

  self.classRegex = /^(.+)\.([^\.]+)$/;
  self.appdRegex = /\/appdynamics\//;
}


CpuProfiler.prototype.startCpuProfiler = function(seconds, callback) {
  var self = this;

  if(!self.agent.appdNative) {
    return callback("V8 tools are not loaded.")
  }

  if(self.active) {
    return callback("CPU profiler is already active.");
  }

  self.active = true;

  self.agent.appdNative.startV8Profiler();
  self.agent.logger.log("V8 CPU profiler started");

  // stop v8 profiler automatically after 10 seconds
  self.agent.timers.setTimeout(function() {
    if(!self.active) return;

    try {
      callback(null, self.stopCpuProfiler(seconds));
    }
    catch(err) {
      callback(err);
    }
  }, seconds * 1000);

  self.agent.on('destroy', function() {
    if(!self.active) return;

    try {
      self.stopCpuProfiler(1); // ignoring any output
      callback("CPU profiling was aborted because of the destroy() call");
    }
    catch(err) {
      callback(err);
    }
  });
};


CpuProfiler.prototype.stopCpuProfiler = function(seconds) {
  var self = this;

  if(!self.agent.appdNative || !self.active) return;

  var processCallGraph = {
    numOfRootElements: 1,
    callElements: []
  }

  var excludeAgentFromCallGraph = self.agent.opts.excludeAgentFromCallGraph;
  var rootSamplesCount = undefined;

  self.agent.appdNative.stopV8Profiler(
    function(childrenCount, totalSamplesCount, functionName, scriptResourceName, lineNumber) {
      if(functionName === '(program)') {
        return true;
      }

      if(excludeAgentFromCallGraph && self.appdRegex.exec(scriptResourceName)) {
        return true;
      }

      return false;
    },
    function(childrenCount, totalSamplesCount, functionName, scriptResourceName, lineNumber) {
      if(rootSamplesCount === undefined)
        rootSamplesCount = totalSamplesCount;

      var classMatch = self.classRegex.exec(functionName);
      var klass, method;
      if(classMatch && classMatch.length == 3) {
        klass = classMatch[1];
        method = classMatch[2];
      }
      else {
        klass = '(global)';
        method = functionName;
      }

      var callElement = {
        klass: klass,
        method: method,
        lineNumber: lineNumber,
        fileName: scriptResourceName,
        numChildren: childrenCount,
        timeTaken: totalSamplesCount / rootSamplesCount * seconds * 1000,
        type: 'JS'
      };

      processCallGraph.callElements.push(callElement);
  });


  self.agent.logger.log("V8 CPU profiler stopped");

  self.active = false;

  return processCallGraph;
};


