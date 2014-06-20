'use strict';


var util = require('util');
var os = require('os');
var fs = require('fs');
var path = require('path');
var StringMatcher = require('./string-matcher').StringMatcher;


function ProtobufModel(agent) {
  this.agent = agent;

  this.detectErrors = undefined;
  this.errorThreshold = undefined;
  this.ignoredMessagesConfig = undefined;
  this.ignoredExceptionConfig = undefined;
  this.callGraphConfig = undefined;
  this.stringMatcher = undefined;
  this.lastSnapshotRequestID = undefined;

  this.traceRegex = undefined;
  this.classRegex = undefined;
}
exports.ProtobufModel = ProtobufModel;


ProtobufModel.prototype.init = function() {
  var self = this;

  self.nextExitCallSequenceInfo = 1;
  self.nextDbCallSequenceInfo = 1;
  self.lastSnapshotRequestID = 0;
  self.traceRegex = /at\s([^\(]+)\s\(([^\:]+)\:(\d+)\:\d+\)$/;
  self.classRegex = /^(.+)\.([^\.]+)$/;

  self.agent.timers.setInterval(function() {
    self.lastSnapshotRequestID = 0;
  }, 300000);

  self.agent.on('configUpdated', function() {
    self.detectErrors = self.agent.configManager.getConfigValue('errorConfig.errorDetection.detectErrors');
    self.errorThreshold = self.agent.configManager.getConfigValue('errorConfig.errorDetection.errorThreshold');
    self.ignoredMessagesConfig = self.agent.configManager.getConfigValue('errorConfig.ignoredMessages');
    self.ignoredExceptionsConfig = self.agent.configManager.getConfigValue('errorConfig.ignoredExceptions');
    self.callGraphConfig = self.agent.configManager.getConfigValue('callgraphConfig');
  });

  this.stringMatcher = new StringMatcher();
  this.stringMatcher.init();
}


ProtobufModel.prototype.createBTIdentifier = function(transaction) {
  var self = this;

  var btIdentifier;
  if(transaction.registrationId) {
    btIdentifier = {
      type: transaction.corrHeader ? 'REMOTE_REGISTERED' : 'REGISTERED',
      btID: transaction.registrationId
    };
  }
  else {
    if(transaction.corrHeader) {
      btIdentifier = {
        type: 'REMOTE_UNREGISTERED',
        unregisteredRemoteBT: {
          btName: transaction.name,
          entryPointType: transaction.entryType
        }
      };

      if(transaction.isAutoDiscovered) {
        btIdentifier.unregisteredRemoteBT.matchCriteriaType = 'DISCOVERED';
        btIdentifier.unregisteredRemoteBT.namingSchemeType = transaction.namingSchemeType;
      }
      else {
        btIdentifier.unregisteredRemoteBT.matchCriteriaType = 'CUSTOM';
      }
    }
    else {
      btIdentifier = {
        type: 'UNREGISTERED',
        unregisteredBT: {
          btInfo: {
            internalName: transaction.name,
            entryPointType: transaction.entryType
          },
          isAutoDiscovered: transaction.isAutoDiscovered
        }
      };
    }
  }

  return btIdentifier;
}



ProtobufModel.prototype.createCorrelation = function(transaction) {
  var self = this;

  var corrHeader = transaction.corrHeader;
  if(!corrHeader) {
    return undefined;
  }

  var correlation = self.agent.correlation;

  var corrObj = {
    incomingBackendId: corrHeader.selfResolutionBackendId,
    incomingSnapshotEnabled: corrHeader.getSubHeader(correlation.SNAPSHOT_ENABLE) || false,
    doNotSelfResolve: corrHeader.getSubHeader(correlation.DONOTSELFRESOLVE) || false,
    exitCallSequence: corrHeader.getSubHeader(correlation.EXIT_POINT_GUID),
    componentLinks: [],
  };

  var compFrom = corrHeader.getSubHeader(correlation.COMPONENT_ID_FROM);
  var compTo = corrHeader.getSubHeader(correlation.COMPONENT_ID_TO);
  var exitOrder = corrHeader.getSubHeader(correlation.EXIT_CALL_TYPE_ORDER);

  if(compFrom) {
    for(var i = 0; i < compFrom.length; i++) {
      corrObj.componentLinks.push({
        fromComponentID: compFrom[i],
        toComponentID: compTo[i],
        exitPointType: exitOrder[i]
      });
    }
  }

  return corrObj;
}



ProtobufModel.prototype.createBTDetails = function(transaction) {
  var self = this;

  //console.log(transaction)

  var btDetails = {
    btInfoRequest: transaction.btInfoRequest,
    btMetrics: {
      isError: transaction.hasErrors,
      timeTaken: transaction.ms,
      backendMetrics: self.createBackendMetrics(transaction)
    },
    btInfoResponseReceived: !!transaction.btInfoResponse,
    snapshotInfo: self.createSnapshotInfo(transaction),
    errors: undefined
  }

  if(!btDetails.snapshotInfo) {
    btDetails.errors = {
      btIdentifier: transaction.btInfoRequest.btIdentifier,
      errorInfo: self.createErrorInfo(transaction),
      exceptionInfo: self.createExceptionInfo(transaction)
    }
  }

  return btDetails;
}



ProtobufModel.prototype.createSnapshotInfo = function(transaction) {
  var self = this;

  //console.log('btInfoResponse', transaction.btInfoResponse)

  var snapshotInfo = undefined;
  if(transaction.btInfoResponse) {
    var attachSnapshot = false;
    var snapshotTrigger = undefined;
    if(transaction.btInfoResponse.isSnapshotRequired) {
      attachSnapshot = true;
      snapshotTrigger = 'REQUIRED';
    }
    else if(transaction.btInfoResponse.currentSlowThreshold > 0 &&
        transaction.btInfoResponse.currentSlowThreshold < transaction.ms) {
      attachSnapshot = true;
      snapshotTrigger = 'SLOW';
    }
    else if(transaction.btInfoResponse.sendSnapshotIfError &&
        transaction.hasErrors) {
      attachSnapshot = true;
      snapshotTrigger = 'ERROR';
    }
    else if(transaction.btInfoResponse.sendSnapshotIfContinuing &&
        transaction.corrHeader &&
        transaction.corrHeader.getSubHeader(self.agent.correlation.SNAPSHOT_ENABLE)) {
      attachSnapshot = true;
      snapshotTrigger = 'CONTINUING';
    }

    if(attachSnapshot) {
      snapshotInfo = {
        trigger: snapshotTrigger,
        snapshot: {
          snapshotGUID: transaction.guid,
          timestamp: transaction.ts,
          callGraph: self.createCallGraph(transaction),
          errorInfo: self.createErrorInfo(transaction),
          exceptionInfo: self.createExceptionInfo(transaction),
          processID: process.pid,
          url: transaction.url,
          dbCalls: self.createSnapshotDBCalls(transaction)
        }
      };
    }
  }

  return snapshotInfo;
}




ProtobufModel.prototype.createBackendMetrics = function(transaction) {
  var self = this;

  var backendMetricsMap = {};
  var backendMetrics = [];
  if(transaction.exitCalls) {
    transaction.exitCalls.forEach(function(exitCall) {
      var exitCallId = exitCall.getBackendInfoString();
      var backendMetric = backendMetricsMap[exitCallId];
      if(backendMetric) {
        backendMetric.numOfCalls++;
        if(exitCall.error) {
          backendMetric.numOfErrors++;
        }

        if(exitCall.ms < backendMetric.minCallTime) {
          backendMetric.minCallTime = exitCall.ms;
        }

        if(exitCall.ms > backendMetric.maxCallTime) {
          backendMetric.maxCallTime = exitCall.ms;
        }

        // this will be needed by SnapshotDbCalls
        exitCall.backendIdentifier = backendMetric.backendIdentifier;

        return;
      }

      var backendIdentifier;
      if(exitCall.registrationId) {
        var registeredBackend = {
           exitPointType: exitCall.exitType,
           backendID: exitCall.registrationId
        };
        var componentId = exitCall.componentId;
        if (componentId) {
          registeredBackend.componentID = componentId;
        }
        backendIdentifier = {
          type: 'REGISTERED',
          registeredBackend: registeredBackend
        }
      }
      else {
        var identifyingProperties = [];
        var detectedIdentifyingProperties = exitCall.identifyingProperties;
        for (var propName in detectedIdentifyingProperties) {
          if (!detectedIdentifyingProperties.hasOwnProperty(propName))
            continue;
          var prop =
            {name: propName, value: detectedIdentifyingProperties[propName]};
          identifyingProperties.push(prop);
        }

        backendIdentifier = {
          type: 'UNREGISTERED',
          unregisteredBackend: {
            exitCallInfo: {
              exitPointType: exitCall.exitType,
              displayName: exitCall.label,
              identifyingProperties: identifyingProperties
            }
          }
        }
      }

      backendMetric = {
        category: exitCall.category,
        timeTaken: exitCall.ms,
        numOfCalls: 1,
        numOfErrors: (exitCall.error ? 1 : 0),
        minCallTime: exitCall.ms,
        maxCallTime: exitCall.ms,
        backendIdentifier: backendIdentifier
      };

      backendMetrics.push(backendMetric);
      backendMetricsMap[exitCallId] = backendMetric;

      // this will be needed by SnapshotDbCalls
      exitCall.backendIdentifier = backendIdentifier;
    });
  }

   return backendMetrics;
}



ProtobufModel.prototype.createErrorInfo = function(transaction) {
  // will be reused for console.log and console.error messages

  var self = this;

  if(!self.detectErrors) {
    return undefined;
  }

  var errorsMap = {};
  var errorInfo = {
      errors: []
  }

  // iterate over console.log and console.error messages here instead

  /*
  if(transaction.exitCalls) {
    transaction.exitCalls.forEach(function(exitCall) {
      if(!exitCall.error) return;
      if(exitCall.error.stack) return; // filter out exceptions
      // don't care about errorThreshold for now, because we only have ERRORs

      var errorMessage = extractErrorMessage(error);
      if(!errorMessage) return;

      if(self.isErrorIgnored(errorMessage)) return;

      var error = errorsMap[errorMessage];
      if(error) {
        error.count++;
        return;
      }

      error = {
        errorThreshold: 'ERROR',
        errorMessage: exitCall.error.message,
        displayName: "Node.js Error",
        count: 1
      }

      errorsMap[errorMessage] = error;
      errorInfo.errors.push(error)
    });
  }
  */

  if(errorInfo.errors.length > 0) {
    return errorInfo;
  }

  return undefined;
}



ProtobufModel.prototype.createExceptionInfo = function(transaction) {
  var self = this;

  var exceptionsMap = {};
  var exceptionInfo = {
    exceptions: [],
    stackTraces: []
  }

  if(transaction.exitCalls) {
    transaction.exitCalls.forEach(function(exitCall) {
      if(!exitCall.error) return;

      var stackTraceStr = exitCall.error.stack;
      if(stackTraceStr && self.isExceptionIgnored(stackTraceStr)) return;

      var message = extractErrorMessage(exitCall.error);
      var rootException = exceptionsMap[message];
      if(rootException) {
        rootException.count++;
        return;
      }

      // stack trace
      var stackTrace = {
        elements: []
      };

      if(stackTraceStr) {
        var lines = stackTraceStr.split("\n");
        lines.shift();
        lines.forEach(function(line) {
          var traceMatch = self.traceRegex.exec(line);
          if(traceMatch && traceMatch.length == 4) {
            var classMatch = self.classRegex.exec(traceMatch[1]);
            var klass;
            if(classMatch && classMatch.length == 3) {
              klass = classMatch[1];
            }
            else {
              klass = 'Object';
            }

            stackTrace.elements.push({
              klass: klass,
              method: traceMatch[1],
              fileName: traceMatch[2],
              lineNumber: parseInt(traceMatch[3])
            });
          }
        });
      }

      // exception
      rootException = {
        root: {
          klass: exitCall.backendName + 'Exception',
          message: message,
          stackTraceID: exceptionInfo.stackTraces.length
        },
        count: 1
      }

      exceptionInfo.stackTraces.push(stackTrace);
      exceptionInfo.exceptions.push(rootException);
      exceptionsMap[message] = rootException;
    });
  }

  if(exceptionInfo.exceptions.length > 0) {
    return exceptionInfo;
  }

  return undefined;
}


ProtobufModel.prototype.isErrorIgnored = function(message) {
  var self = this;

  if(!self.ignoredMessagesConfig) {
    return false;
  }

  var ignore = false
  self.ignoredMessagesConfig.forEach(function(ignoredMessageConfigs) {
    if(self.stringMatcher.matchString(ignoredMessageConfig, message)) {
      ignore = true;
    }
  });

  return ignore;
}


ProtobufModel.prototype.isExceptionIgnored = function(stack) {
  var self = this;

  if(!self.ignoredExceptionsConfig) {
    return false;
  }

  var ignore = false
  self.ignoredExceptionsConfig.forEach(function(ignoredExceptionConfig) {
    if(self.stringMatcher.matchString(ignoredExceptionConfig, stack)) {
      ignore = true;
    }
  });

  return ignore;
}


ProtobufModel.prototype.createSnapshotDBCalls = function(transaction) {
  var self = this;

  var dbCallsMap = {};
  var dbCalls = [];
  if(transaction.exitCalls) {
    transaction.exitCalls.forEach(function(exitCall) {
      if(!exitCall.isSql || !exitCall.command) return;

      var dbCallId = exitCall.backendName + ':' + exitCall.command;
      var dbCall = dbCallsMap[dbCallId];
      if(dbCall) {
        dbCall.count++;
        dbCall.totalTimeTakenMS += exitCall.ms;
        if(exitCall.ms < dbCall.minTimeMS) dbCall.minTimeMS = exitCall.ms;
        if(exitCall.ms > dbCall.maxTimeMS) dbCall.maxTimeMS = exitCall.ms;
        return;
      }

      dbCall = {
        backendIdentifier: exitCall.backendIdentifier,
        sqlString: exitCall.command,
        count: 1,
        totalTimeTakenMS: exitCall.ms,
        minTimeMS: exitCall.ms,
        maxTimeMS: exitCall.ms,
        boundParameters: undefined,
        sequenceInfo: exitCall.sequenceInfo
      }

      if(exitCall.commandArgs) {
        dbCall.boundParameters = {
          type: 'POSITIONAL',
          posParameters: exitCall.commandArgs
        }
      }

      dbCalls.push(dbCall);
      if(!exitCall.commandArgs) {
        dbCallsMap[dbCallId] = dbCall;
      }
    });
  }

  if(dbCalls.length > 0) {
    return dbCalls;
  }

  return undefined;
}


ProtobufModel.prototype.createCallGraph = function(transaction) {
  var self = this;

  var callGraph = {
    callElements: []
  };

  var callElement = {
    //klass: 'Object',
    //method: 'main',
    fileName: require.main.filename,
    numOfChildren: 0,
    timeTaken: transaction.ms,
    type: 'JS',
    exitCalls: self.createSnapshotExitCalls(transaction)
  };

  callGraph.callElements.push(callElement);
  return callGraph;
}


ProtobufModel.prototype.createSnapshotExitCalls = function(transaction) {
  var self = this;

  var snapshotExitCalls = [];
  if(transaction.exitCalls) {
    transaction.exitCalls.forEach(function(exitCall) {
      if(exitCall.isSql && exitCall.ms < self.callGraphConfig.minSQLExecTime) {
        return;
      }

      var properties = [];
      // fill properties later, if needed

      var snapshotExitCall = {
        backendIdentifier: exitCall.backendIdentifier,
        timeTaken: exitCall.ms,
        sequenceInfo: exitCall.sequenceInfo,
        detailString: exitCall.command,
        properties: properties,
        errorDetails: extractErrorMessage(exitCall.error),
        boundParameters: undefined
      }

      if(exitCall.isSql && exitCall.commandArgs && self.callGraphConfig.captureRawSQL) {
        snapshotExitCall.boundParameters = {
          type: 'POSITIONAL',
          posParameters: exitCall.commandArgs
        }
      }

      snapshotExitCalls.push(snapshotExitCall);
    });
  }

  if(snapshotExitCalls.length > 0) {
    return snapshotExitCalls;
  }

  return undefined;
}


ProtobufModel.prototype.createProcessSnapshot = function(processCallGraphReq, callback) {
  var self = this;

  if(processCallGraphReq.snapshotRequestID <= self.lastSnapshotRequestID) {
    self.agent.logger.log('snapshotRequestID ' + processCallGraphReq.snapshotRequestID + ' was already processed, ignoring.')
    return;
  }

  process.nextTick(function() {
    try {
      self.agent.cpuProfiler.startCpuProfiler(processCallGraphReq.captureTime, function(err, processCallGraph) {
        if(err) {
          return callback(err);
        }

        var processSnapshot = {
          snapshotRequestID: processCallGraphReq.snapshotRequestID,
          timestamp: Date.now(),
          processCallGraph: processCallGraph,
          processID: process.pid
        };

        self.lastSnapshotRequestID = processCallGraphReq.snapshotRequestID;

        callback(null, processSnapshot);
      });
    }
    catch(err) {
      self.agent.logger.error(err);
    }
  });
}


function extractErrorMessage(error) {
  if(typeof(error) == 'string') {
    return error;
  }
  else if(typeof(error) == 'object') {
    return error.message;
  }

  return undefined;
}
