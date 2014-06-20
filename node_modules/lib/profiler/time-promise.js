'use strict';


function TimePromise(agent, scope, label) {
  this.agent = agent;

  this.scope = scope;
  this.label = label;

  this.stackTrace = undefined;
  this.time = undefined;
  this.context = undefined;
};
exports.TimePromise = TimePromise;



TimePromise.prototype.start = function(context) {
  var self = this;
  var profiler = self.agent.profiler;

  self.stackTrace = profiler.stackTrace(),
  self.time = profiler.time(true),
  profiler.startTransaction(self.time);

  this.context = context;
};



TimePromise.prototype.end = function(context) {
  var self = this;
  var profiler = self.agent.profiler;

  if(!self.time.done()) return;

  var sample = profiler.createTransaction();
  sample['Start context'] = self.context;
  sample['End context'] = context;
  sample['Stack trace'] = self.stackTrace;
  if(context && context['Error']) sample['Error'] = context['Error'];

  profiler.endTransaction(self.time, sample);
};
