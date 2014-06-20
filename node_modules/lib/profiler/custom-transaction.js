'use strict';


var TimePromise = require('./time-promise').TimePromise;


function CustomTransaction(agent) {
  this.agent = agent;
}
exports.CustomTransaction = CustomTransaction;


CustomTransaction.prototype.init = function() {
};


CustomTransaction.prototype.start = function(scope, label, context) {
  var tp = new TimePromise(this.agent, scope, label);
  tp.start(context);

  return tp;
};
