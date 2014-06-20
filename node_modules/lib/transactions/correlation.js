
'use strict';

var CorrelationHeader = require('./correlation-header').CorrelationHeader;


function Correlation(agent) {
  this.agent = agent;

  this.cidRegex = undefined;

  this.appId = undefined;
  this.tierId = undefined;
  this.namingSchemeType = undefined;

  // constants
  this.HEADER_NAME = "singularityheader";
  this.APP_ID = "appId";
  this.BT_ID = "btid";
  this.BT_NAME = "btname";
  this.ENTRY_POINT_TYPE = "bttype";
  this.BT_COMPONENT_MAPPING = "btcomp";
  this.EXIT_POINT_GUID = "exitguid";
  this.UNRESOLVED_EXIT_ID = "unresolvedexitid"
  this.COMPONENT_ID_FROM = "cidfrom";
  this.COMPONENT_ID_TO = "cidto";
  this.EXIT_CALL_TYPE_ORDER = "etypeorder";
  this.SNAPSHOT_ENABLE = "snapenable";
  this.REQUEST_GUID = "guid";
  this.MATCH_CRITERIA_TYPE = "mctype";
  this.MATCH_CRITERIA_VALUE = "mcvalue";
  this.TIMESTAMP = "ts";
  this.DISABLE_TRANSACTION_DETECTION = "notxdetect";
  this.DONOTRESOLVE = "donotresolve";
  this.DEBUG_ENABLED = "debug";
  this.MUST_TAKE_SNAPSHOT = "appdynamicssnapshotenabled";
  this.MATCH_CRITERIA_TYPE_DISCOVERED = "auto";
  this.MATCH_CRITERIA_TYPE_CUSTOM = "custom";
}
exports.Correlation = Correlation;


Correlation.prototype.init = function() {
	var self = this;

  this.cidRegex = /\{\[UNRESOLVED\]\[(\d+)\]\}/;

  self.agent.on('configUpdated', function() {
    self.appId = self.agent.configManager.getConfigValue("agentIdentity.appID");
    self.tierId = self.agent.configManager.getConfigValue("agentIdentity.tierID");
    self.namingSchemeType = self.agent.configManager.getConfigValue('txConfig.nodejsWeb.discoveryConfig.namingScheme.type');
  });
};


Correlation.prototype.newCorrelationHeader = function() {
	var self = this;

	return new CorrelationHeader(self.agent);
};

