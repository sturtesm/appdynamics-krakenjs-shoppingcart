'use strict';

var os = require('os');
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var cluster = require('cluster');

/*
 * There are currently 5 modes in which a proxy can be launched
 * on a single machine:
 * 1. Single node.js process. Starts one proxy.
 * 2. Node.js cluster with proxyMode "tier". Indexes processes and
 *    starts one proxy. This requires multitenant proxy.
 * 3. Node.js cluster with proxyMode "node". Indexes processes and
 *    start one proxy for each node process.
 * 4. Multiple independent node.js processes with proxyMode "tier".
 *    Indexes must be configured manually using nodeIndex option.
 *    Starts one proxy.
 * 5. Multiple independent node.js processes with proxyMode "node".
 *    Indexes must be configured manually using nodeIndex option.
 *    Starts one proxy for each node process.
 */

function ProxyLauncher(agent) {
  this.agent = agent;

  this.indexDir = undefined;
}
exports.ProxyLauncher = ProxyLauncher;


ProxyLauncher.prototype.init = function() {
  var self = this;

  self.indexDir = self.agent.tmpDir + '/index';

  self.agent.on('nodeIndex', function(nodeIndex) {
    self.agent.logger.log('nodeIndex', nodeIndex, process.pid)

    if(!self.agent.opts.proxyMode || self.agent.opts.proxyMode === 'tier') {
      if(nodeIndex === 0) {
        self.agent.logger.log('launching proxy from node 0 in "tier" mode');
        self.startProxy(nodeIndex);
      }
      else {
        self.agent.timers.setTimeout(function() {
          self.agent.logger.log('not launching proxy from node ' + nodeIndex + ' in "tier" mode');
          self.agent.emit('proxyStarted', 0);
        }, 5000);
      }
    }
    else if(self.agent.opts.proxyMode === 'node') {
      self.startProxy(nodeIndex);
    }
  });
}

ProxyLauncher.prototype.start = function() {
  var self = this;

  if(cluster.isMaster) {
    if(self.agent.opts.nodeIndex) {
      self.agent.emit('nodeIndex', self.agent.opts.nodeIndex);
    }
    else {
      self.agent.emit('nodeIndex', 0);
    }
  }
  else {
    self.agent.timers.setTimeout(function() {
      self.readNodeIndex(function(nodeIndex) {
        if(nodeIndex !== undefined) {
          self.agent.emit('nodeIndex', nodeIndex);
        }
        else {
          self.agent.timers.setTimeout(function() {
            self.readNodeIndex(function(nodeIndex) {
              if(nodeIndex !== undefined) {
                self.agent.emit('nodeIndex', nodeIndex);
              }
            });
          }, 4000);
        }
      });
    }, 1000);
  }
}


ProxyLauncher.prototype.readNodeIndex = function(callback) {
  var self = this;

  var callbackCalled = false;
  function callbackOnce(ret) {
    if(!callbackCalled) {
      callbackCalled = true;
      callback(ret);
    }
  }

  fs.readdir(self.indexDir, function(err, indexFiles) {
    if(err) return self.agent.logger.error(err);

    indexFiles.forEach(function(indexFile) {
      var nodeIndex = parseInt(indexFile.split('.')[0]);
      if(nodeIndex !== NaN) {
        fs.readFile(self.indexDir + '/' + indexFile, function(err, pid) {
          if(err) return self.agent.logger.error(err);

          if(pid == process.pid) {
            callbackOnce(nodeIndex);
          }
        });
      }
    });
  });

  self.agent.timers.setTimeout(function() {
    callbackOnce(null);
  }, 2000);
}


ProxyLauncher.prototype.startProxy = function(nodeIndex) {
  var self = this;

  var opts = self.agent.opts;

  var proxyOpts = {};
  proxyOpts['appdynamics.controller.hostName'] = opts.controllerHostName;
  proxyOpts['appdynamics.controller.port']  = opts.controllerPort;
  proxyOpts['appdynamics.http.proxyHost']  = opts.proxyHost;
  proxyOpts['appdynamics.http.proxyPort']  = opts.proxyPort;
  proxyOpts['appdynamics.controller.ssl.enabled']  = opts.controllerSslEnabled;
  proxyOpts['appdynamics.force.default.ssl.certificate.validation']  = opts.sslCertificateValidation;
  proxyOpts['appdynamics.agent.accountName']  = opts.accountName;
  proxyOpts['appdynamics.agent.accountAccessKey']  = opts.accountAccessKey;
  proxyOpts['appdynamics.agent.applicationName']  = opts.applicationName;
  proxyOpts['appdynamics.agent.tierName']  = opts.tierName;
  var computedNodeName = (opts.nodeName || os.hostname());
  if (!opts.noNodeNameSuffix)
    computedNodeName += '-' + nodeIndex;
  proxyOpts['appdynamics.agent.nodeName']  = computedNodeName;
  proxyOpts['agentType']  = 'NODEJS_APP_AGENT';

  var proxyDir = path.join(__dirname + '/../../proxy');

  var proxyTmpDir = self.agent.tmpDir + '/proxy';
  mkdir(proxyTmpDir);

  var proxyCommDir = proxyTmpDir + '/' + opts.applicationName + '/' + opts.tierName +  '/' + nodeIndex;
  mkdir(proxyTmpDir + '/' + opts.applicationName);
  mkdir(proxyTmpDir + '/' + opts.applicationName + '/' + opts.tierName);
  mkdir(proxyTmpDir + '/' + opts.applicationName + '/' + opts.tierName +  '/' + nodeIndex);

  var proxyLogsDir = self.agent.tmpDir + '/logs/' + opts.applicationName + '/' + opts.tierName +  '/' + nodeIndex;
  mkdir(self.agent.tmpDir + '/logs');
  mkdir(self.agent.tmpDir + '/logs/' + opts.applicationName);
  mkdir(self.agent.tmpDir + '/logs/' + opts.applicationName + '/' + opts.tierName);
  mkdir(self.agent.tmpDir + '/logs/' + opts.applicationName + '/' + opts.tierName +  '/' + nodeIndex);

  cp.exec('rm -rf ' + proxyCommDir + '/* ' + proxyLogsDir + '/*', function () {
    var proxyArgs = [
        '-d',
        proxyDir,
        "--",
        proxyCommDir,
        proxyLogsDir
      ];

    var proxyOutput = fs.openSync(proxyLogsDir + "/proxy.out", 'w');

    for(var prop in proxyOpts) {
      if(proxyOpts[prop]) {
        proxyArgs.push('-D' + prop + '=' + proxyOpts[prop]);
      }
    }
    self.agent.logger.log("This is ProxyArgs: " +proxyArgs);
    var proxyProcess = cp.spawn(proxyDir + '/runProxy', proxyArgs, {
      detached: false,
      stdio: ['ignore', proxyOutput, proxyOutput]
    });
    self.agent.logger.log("Proxy spawned!");
    proxyProcess.unref();
    proxyOutput = undefined;

    var termHandler = function () {
      proxyProcess.kill('SIGKILL');
      require('child_process').exec('rm -rf ' + proxyCommDir + '/*');
      self.agent.emit('proxyKilled');
      process.removeListener('SIGTERM', termHandler);
      process.kill(process.pid, 'SIGTERM');
    };

    process.on('SIGTERM', termHandler);
    process.on('SIGINT', termHandler);
    process.on('uncaughtException', termHandler);

    self.agent.timers.setTimeout(function() {
      self.agent.emit('proxyStarted', nodeIndex);
    }, 5000);
  });
}



function mkdir(dirPath) {
  if(!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }
}


