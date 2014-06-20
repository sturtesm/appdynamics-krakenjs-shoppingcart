'use strict';

var uuid = require('../../thirdparty/node-uuid');


function TransactionReporter(agent) {
  this.agent = agent;
  this.enabled = undefined;
  this.uuidInstance = undefined;
  this.nextRequestId = undefined;
  this.markTransactionAsError = undefined;
}
exports.TransactionReporter = TransactionReporter;


TransactionReporter.prototype.init = function() {
  var self = this;

  self.enabled = false;

  self.uuidInstance = uuid.v4();
  self.nextRequestId = 1;

  var configManager = self.agent.configManager;
  var registry = self.agent.transactionRegistry;
  var naming = self.agent.transactionNaming;


  self.agent.on('configUpdated', function() {
    var txConfig = configManager.getConfigValue('txConfig');
    var enabled = configManager.getConfigValue('txConfig.nodejsWeb.enabled');
    if(txConfig && enabled !== undefined) {
      self.enabled = enabled;
    }
    self.markTransactionAsError = self.agent.configManager.getConfigValue('errorConfig.errorDetection.markTransactionAsError');
  });


  self.agent.on('transactionStarted', function(transaction, req) {
    if(!self.enabled) {
      transaction.ignore = true;
      return;
    }

    transaction.name = naming.createHttpTransactionName(req);
    self.agent.logger.log('transaction name: ' + transaction.name)
    if(!transaction.name) {
      transaction.ignore = true;
      self.agent.logger.log("cannot create transaction name");
      return;

    transaction.guid = self.uuidInstance + (self.nextRequestId++);

    var corrHeaderStr = req.headers[self.agent.correlation.HEADER_NAME];
    if(corrHeaderStr) {
      var corrHeader = self.agent.correlation.newCorrelationHeader();
      if(corrHeader.parse(corrHeaderStr)) {
        transaction.corrHeader = corrHeader;
        corrHeader.makeContinuingTransaction(transaction);
      }
      else {
        transaction.ignore = true;
        return;
      }
    }
    else {
      if(!rules.accept(req, transaction)) {
        transaction.ignore = true;
        return;
      }

      transaction.name = naming.createHttpTransactionName(req, transaction);
      self.agent.logger.log('transaction name: ' + transaction.name)

      if(!transaction.name) {
        transaction.ignore = true;
        self.agent.logger.log("cannot create transaction name");
        return;
      }

      registry.matchTransaction(transaction, req);
    }

    if(registry.isExcludedTransaction(transaction)) {
      transaction.ignore = true;
      return;
    }

    self.agent.proxyTransport.sendBTInfoRequest(transaction);
  });


  self.agent.on('transaction', function(transaction) {
    if(!self.enabled || transaction.ignore) return;

    transaction.hasErrors = self.hasErrors(transaction);

    if(transaction.exitCalls) {
      transaction.exitCalls.forEach(function(exitCall) {
        registry.matchBackendCall(exitCall);
      });
    }

    self.agent.proxyTransport.sendTransactionDetails(transaction);
  });
}


TransactionReporter.prototype.hasErrors = function(transaction) {
  var self = this;

  // this relates to error only, not exceptions
  /*if(self.markTransactionAsError === false) {
    return false;
  }*/

  if(transaction.error) {
    return true;
  }

  var result = false;
  if(transaction.exitCalls) {
    transaction.exitCalls.forEach(function(exitCall) {
      if(exitCall.error) {
        result = true;
      }
    });
  }
  return result;
}
