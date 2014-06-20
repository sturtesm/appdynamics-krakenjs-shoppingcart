'use strict';

var util = require('util');
var EventEmitter = require('events').EventEmitter;


function Transaction() {
  this.connection = undefined;
  this.command = undefined;
  this.commandArgs = undefined;
  this.stackTrace = undefined;
  this.error = undefined;
  this.url = undefined;
  this.method = undefined;
  this.requestHeaders = undefined;
  this.responseHeaders = undefined;
  this.statusCode = undefined;
  this.name = undefined;
  this.label = undefined;
  this.id = undefined;
  this.ms = undefined;
  this.ts = undefined;
  this.threadId = undefined;
  this.entryType = undefined;
  this.host = undefined;
  this.port = undefined;
  this.guid = undefined;
  this.exitCalls = undefined;
  this.btInfoRequest = undefined;
  this.btInfoResponse = undefined;
  this.hasWaitedForBTInfoResponse = undefined;
  this.registrationId = undefined;
  this.isAutoDiscovered = undefined;
  this.hasErrors = undefined;
  this.ignore = undefined;
  this.exitCallCounter = 0;
  this.corrHeader = undefined;
  this.namingSchemeType = undefined;

  EventEmitter.call(this);
}

util.inherits(Transaction, EventEmitter);
exports.Transaction = Transaction;
