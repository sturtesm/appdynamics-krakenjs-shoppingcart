'use strict';


function CorrelationHeader(agent) {
  this.agent = agent;
  this.correlation = agent.correlation;

  this.subHeaders = {};
  this.selfResolutionBackendId = undefined;
}
exports.CorrelationHeader = CorrelationHeader;



CorrelationHeader.prototype.addSubHeader = function(name, value) {
	var self = this;

	self.subHeaders[name] = value;
}


CorrelationHeader.prototype.getSubHeader = function(name, defaultValue) {
	var self = this;

	var value = self.subHeaders[name];

	if(value === undefined && defaultValue !== undefined) {
		return defaultValue;
	}

	return value;
}


CorrelationHeader.prototype.getStringSubHeader = function(name) {
	var self = this;

	var value = self.subHeaders[name];
	if(value) {
		if(Array.isArray(value)) {
			return value.join(',');
		}
		if(typeof(value) === 'boolean') {
			return value.toString();
		}
		else {
			return value;
		}
	}
	else {
		return undefined;
	}
}


CorrelationHeader.prototype.getStringHeader = function() {
	var self = this;

	var pairs = [];

	for(var name in self.subHeaders) {
		pairs.push(name + '=' + self.getStringSubHeader(name));
	}

	return pairs.join('*');
}



CorrelationHeader.prototype.parseHeaderString = function(headerString) {
	var self = this;
	// sanitize header based on CORE-20346
	var headerStringParts = headerString.split(', ');
	headerString = headerStringParts[headerStringParts.length - 1];

	var pairsMap = {};
	var pairs = headerString.split('*');
	pairs.forEach(function(pairString) {
		var pair = pairString.split('=');

		if(pair.length == 2 && pair[1] !== undefined) {
			pairsMap[pair[0]] = pair[1];
		}
	});


	// value lists
	[self.correlation.COMPONENT_ID_FROM,
			self.correlation.COMPONENT_ID_TO,
			self.correlation.EXIT_CALL_TYPE_ORDER].forEach(function(name) {
		var value = pairsMap[name];
		if(value !== undefined) {
			self.addSubHeader(name, value.split(','));
			delete pairsMap[name];
		}
	});


	// boolean values
	[self.correlation.DONOTRESOLVE,
			self.correlation.SNAPSHOT_ENABLE,
			self.correlation.DISABLE_TRANSACTION_DETECTION,
			self.correlation.DEBUG_ENABLED].forEach(function(value) {
		var value = pairsMap[name];
		if(value !== undefined) {
			self.addSubHeader(name, value.toLowerCase() === 'true');
			delete pairsMap[name];
		}
	});


	// string values
	for(var name in pairsMap) {
		self.addSubHeader(name, pairsMap[name]);
	}
};


CorrelationHeader.prototype.parse = function(headerString) {
	var self = this;

	// parse string header to subheader pairs
	self.parseHeaderString(headerString);

	// TODO: debug == true -> enable logging for only this transaction

	// disable transaction detection if subheader is set
	if(self.getSubHeader(self.correlation.DISABLE_TRANSACTION_DETECTION)) {
		self.agent.logger.log("CorrelationHeader.parse: transaction disabled from the originating tier, not processing");
		return false;
	}


	// get app id
	if(self.getSubHeader(self.correlation.APP_ID) != self.correlation.appId) {
		self.agent.logger.log("CorrelationHeader.parse: Remote app ID [" + self.getSubHeader(self.correlation.APP_ID) + "] and local app ID [" + self.correlation.appId + "] do not match, not processing");
		return false;
	}


	// parse components
  var componentLinks = []; // needed for size

	var cidFrom = self.getSubHeader(self.correlation.COMPONENT_ID_FROM) || [];
	var cidTo = self.getSubHeader(self.correlation.COMPONENT_ID_TO) || [];
	var eTypeOrder = self.getSubHeader(self.correlation.EXIT_CALL_TYPE_ORDER) || [];

	if(cidFrom.length != cidTo.length || cidFrom.length != eTypeOrder.length) {
		self.agent.logger.error("CorrelationHeader.parse: malformed caller chain");
		return false;
	}

	for(var i = 0; i < cidFrom.length; i++) {
		var componentLink = {};
		componentLink[self.correlation.COMPONENT_ID_FROM] = cidFrom[i];
		componentLink[self.correlation.COMPONENT_ID_TO] = cidTo[i];
		componentLink[self.correlation.EXIT_CALL_TYPE_ORDER] = eTypeOrder[i];
		componentLinks.push(componentLink);
	}

	var lastComponent = componentLinks[componentLinks.length - 1];


	// add own component link
	if(self.getSubHeader(self.correlation.DONOTRESOLVE)) {
		cidFrom.push(lastComponent[self.correlation.COMPONENT_ID_TO]);
		cidTo.push(self.correlation.tierId.toString());
		eTypeOrder.push(lastComponent[self.correlation.EXIT_CALL_TYPE_ORDER]);

		var componentLink = {};
		componentLink[self.correlation.COMPONENT_ID_FROM] = lastComponent[self.correlation.COMPONENT_ID_TO];
		componentLink[self.correlation.COMPONENT_ID_TO] = self.correlation.tierId.toString();
		componentLink[self.correlation.EXIT_CALL_TYPE_ORDER] = lastComponent[self.correlation.EXIT_CALL_TYPE_ORDER];
		componentLinks.push(componentLink);
	}


	// extract backend ID
	if(!self.getSubHeader(self.correlation.DONOTRESOLVE)) {
		var m = self.correlation.cidRegex.exec(lastComponent[self.correlation.COMPONENT_ID_TO]);
		if(m && m.length == 2) {
			self.selfResolutionBackendId = parseInt(m[1]);
		}
	}

	// backend ID resolution
	if(!self.selfResolutionBackendId) {
		if(self.getSubHeader(self.correlation.UNRESOLVED_EXIT_ID) !== undefined) {
			var unresolvedExitId = parseInt(self.getSubHeader(self.correlation.UNRESOLVED_EXIT_ID));
			if(unresolvedExitId > 0) {
				self.selfResolutionBackendId = unresolvedExitId;

				var correlatedComponentId = self.agent.transactionRegistry.resolvedBackendIds[unresolvedExitId];
				if(correlatedComponentId != undefined && correlatedComponentId != self.correlation.tierId) {
					self.agent.proxyTransport.sendSelfReResolution({
						backendId: unresolvedExitId
					});

					return false;
				}
			}
		}
	}


	// apply header size limitations
	var size = 0;
	componentLinks.forEach(function(componentLink) {
		size += 30
				+ componentLink[self.correlation.COMPONENT_ID_TO].length;
				+ componentLink[self.correlation.COMPONENT_ID_FROM].length;
				+ componentLink[self.correlation.EXIT_CALL_TYPE_ORDER].length;
	});

	if(size > 750 + 16 + 15 + 20) {
		return false;
	}


	// adjust timestamp
	var skewAdjustedOriginTimestamp = self.getSubHeader(self.correlation.TIMESTAMP);
	if(skewAdjustedOriginTimestamp) {
	  // is this used at all?
	}

	return true;
}

CorrelationHeader.prototype.makeContinuingTransaction = function(transaction) {
	var self = this;

	var btId = self.getSubHeader(self.correlation.BT_ID);
	var btName = self.getSubHeader(self.correlation.BT_NAME);

	if(btId) {
		transaction.registrationId = btId;
	}
	else if(btName) {
		var btType = self.getSubHeader(self.correlation.ENTRY_POINT_TYPE);
		var btComp = self.getSubHeader(self.correlation.BT_COMPONENT_MAPPING);
		var mcType = self.getSubHeader(self.correlation.MATCH_CRITERIA_TYPE);
		var mcValue = self.getSubHeader(self.correlation.MATCH_CRITERIA_VALUE);

		if(mcType === self.correlation.MATCH_CRITERIA_TYPE_DISCOVERED) {
			transaction.isAutoDiscovered = true;
			transaction.namingSchemeType = mcValue;
		}
		else {
			transaction.isAutoDiscovered = false;
		}

		transaction.name = btName;
		transaction.entryType = btType;
		transaction.componentId = btComp;
	}
	else {
		self.agent.logger.error("CorrelationHeader.makeContinuingTransaction: invalid correlation header, did not find BT id or name");
		return false;
	}

	transaction.guid = self.getSubHeader(self.correlation.REQUEST_GUID);

	return true;
}



var exitPointTypeToString = {
  'EXIT_HTTP' : 'HTTP',
  'EXIT_CACHE' : 'CACHE',
  'EXIT_DB' : 'DB'
}

CorrelationHeader.prototype.build = function(transaction, exitCall) {
	var self = this;

	if(transaction.ignore) {
		return;
	}

	// assign backendID and componentID to backend call if available
	self.agent.transactionRegistry.matchBackendCall(exitCall);


	var incomingHeader = transaction.corrHeader;

	// if backend call is not registered
	if(!exitCall.registrationId) {
		self.addSubHeader(self.correlation.DISABLE_TRANSACTION_DETECTION, true);

		if(incomingHeader && incomingHeader.getSubHeader(self.correlation.DEBUG_ENABLED)) {
			self.addSubHeader(self.correlation.DEBUG_ENABLED, true);
		}

		self.agent.logger.log("CorrelationHeader.build: disabling correlation header generated: " + self.getStringHeader());
		return;
	}


	// add app id subheader
	self.addSubHeader(self.correlation.APP_ID, self.correlation.appId);


	// add BT related subheaders
  if(transaction.registrationId) {
		self.addSubHeader(self.correlation.BT_ID, transaction.registrationId);
  }
  else {
		self.addSubHeader(self.correlation.BT_NAME, transaction.name);
		self.addSubHeader(self.correlation.ENTRY_POINT_TYPE, transaction.entryType);
		self.addSubHeader(self.correlation.BT_COMPONENT_MAPPING, self.correlation.tierId);

		if(incomingHeader) {
			if(transaction.isAutoDiscovered) {
				self.addSubHeader(self.correlation.MATCH_CRITERIA_TYPE, self.correlation.MATCH_CRITERIA_TYPE_DISCOVERED);
				self.addSubHeader(self.correlation.MATCH_CRITERIA_VALUE, transaction.namingSchemeType);
			}
			else {
				self.addSubHeader(self.correlation.MATCH_CRITERIA_TYPE, self.correlation.MATCH_CRITERIA_TYPE_DISCOVERED);
				self.addSubHeader(self.correlation.MATCH_CRITERIA_VALUE, transaction.name);
			}
		}
		else {
			if(transaction.isAutoDiscovered) {
				self.addSubHeader(self.correlation.MATCH_CRITERIA_TYPE, self.correlation.MATCH_CRITERIA_TYPE_DISCOVERED);
				self.addSubHeader(self.correlation.MATCH_CRITERIA_VALUE, self.correlation.namingSchemeType);
			}
			else {
				self.addSubHeader(self.correlation.MATCH_CRITERIA_TYPE, self.correlation.MATCH_CRITERIA_TYPE_DISCOVERED);
				self.addSubHeader(self.correlation.MATCH_CRITERIA_VALUE, transaction.customMatch.btName);
			}
		}
  }


  // add request guid subheader
  self.addSubHeader(self.correlation.REQUEST_GUID, transaction.guid);


  // add debug subheader
  if(incomingHeader && incomingHeader.getSubHeader(self.correlation.DEBUG_ENABLED)) {
  	self.addSubHeader(self.correlation.DEBUG_ENABLED, true);
  }


  // add snapshot enable subheader
	var btInfoResponse = transaction.btInfoResponse;
	if((incomingHeader && incomingHeader.getSubHeader(self.correlation.SNAPSHOT_ENABLE)) ||
			(btInfoResponse && btInfoResponse.isSnapshotRequired)) {
		self.addSubHeader(self.correlation.SNAPSHOT_ENABLE, true);
	}

	// add unresoved exit id subheader
	var componentId;
	if(exitCall.componentId !== undefined) {
		componentId = exitCall.componentId;
	}
	else {
		componentId = "{[UNRESOLVED][" + exitCall.registrationId + "]}";
	}

	if(exitCall.componentId) {
		self.addSubHeader(self.correlation.UNRESOLVED_EXIT_ID, exitCall.registrationId);
	}
	else {
		self.addSubHeader(self.correlation.UNRESOLVED_EXIT_ID, '0');
	}


	// add exit guid subheader
	self.addSubHeader(self.correlation.EXIT_POINT_GUID, parseInt(exitCall.sequenceInfo) + 1);


  // add component link subheaders
  var compFrom;
  var compTo;
  var exitOrder;

	if(incomingHeader) {
		compFrom = incomingHeader.getSubHeader(self.correlation.COMPONENT_ID_FROM) || [];
		compTo = incomingHeader.getSubHeader(self.correlation.COMPONENT_ID_TO) || [];
		exitOrder = incomingHeader.getSubHeader(self.correlation.EXIT_CALL_TYPE_ORDER) || [];
	}
	else {
		compFrom = [];
		compTo = [];
		exitOrder = [];
	}

	compFrom.push(self.correlation.tierId);
	compTo.push(componentId);
	exitOrder.push(exitPointTypeToString[exitCall.exitType]);

	self.addSubHeader(self.correlation.COMPONENT_ID_FROM, compFrom);
	self.addSubHeader(self.correlation.COMPONENT_ID_TO, compTo);
	self.addSubHeader(self.correlation.EXIT_CALL_TYPE_ORDER, exitOrder);


	self.agent.logger.log("CorrelationHeader.build: correlation header generated: " + self.getStringHeader());
}
