'use strict';


function ExitCall() {
  this.user = undefined;
  this.command = undefined;
  this.commandArgs = undefined;
  this.stackTrace = undefined;
  this.error = undefined;
  this.url = undefined;
  this.method = undefined;
  this.requestHeaders = undefined;
  this.responseHeaders = undefined;
  this.statusCode = undefined;
  this.label = undefined;
  this.id = undefined;
  this.ms = undefined;
  this.ts = undefined;
  this.threadId = undefined;
  this.exitType = undefined;
  this.backendName = undefined;
  this.isSql = undefined;
  this.identifyingProperties = undefined;
  this.registrationId = undefined;
  this.componentId = undefined;
  this.backendIdentifier = undefined;
  this.sequenceInfo = undefined;
}

function backendInfoToString(exitPointType, identifyingProperties) {
   var identifyingPropertyNames = Object.keys(identifyingProperties);
   identifyingPropertyNames.sort();

   var backedInfoParts = [exitPointType.toString()];

   identifyingPropertyNames.forEach(function (propertyName) {
     var propertyValue = identifyingProperties[propertyName];
     backedInfoParts.push(propertyName);
     backedInfoParts.push(propertyValue.toString());
   });

   var result = JSON.stringify(backedInfoParts);
   return result;
}

ExitCall.prototype.getBackendInfoString = function () {
    return backendInfoToString(this.exitType, this.identifyingProperties);
}

exports.ExitCall = ExitCall;
exports.backendInfoToString = backendInfoToString;
