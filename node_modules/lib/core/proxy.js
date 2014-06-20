'use strict';

var EventEmitter = require('events').EventEmitter;

function Proxy(agent) {
  this.agent = agent;

  this.threadProxyPool = undefined;
  this.threadProxyMap = undefined;
}
exports.Proxy = Proxy;


Proxy.prototype.init = function() {
  this.threadProxyMap = {};
  this.resetThreadProxyPool();

  // removeListener compairs objects, so the original callback
  // should be passed instead of the proxy
  this.before(EventEmitter.prototype, 'removeListener', function(obj, args) {
    if(args.length > 1 && args[1] && args[1].__appdynamicsProxy__) {
      args[1] = args[1].__appdynamicsProxy__;
    }
  });
};


Proxy.prototype.resetThreadProxyPool = function() {
  this.threadProxyPool = [];

  for(var i = 0; i < 10; i++) {
    this.threadProxyPool.unshift(i);
  }
}


Proxy.prototype.generateThreadProxies = function(func) {
  return [
    function appd_proxy_0() { return func.apply(this, arguments); },
    function appd_proxy_1() { return func.apply(this, arguments); },
    function appd_proxy_2() { return func.apply(this, arguments); },
    function appd_proxy_3() { return func.apply(this, arguments); },
    function appd_proxy_4() { return func.apply(this, arguments); },
    function appd_proxy_5() { return func.apply(this, arguments); },
    function appd_proxy_6() { return func.apply(this, arguments); },
    function appd_proxy_7() { return func.apply(this, arguments); },
    function appd_proxy_8() { return func.apply(this, arguments); },
    function appd_proxy_9() { return func.apply(this, arguments); }
  ];
}


Proxy.prototype.getThreadProxy = function(threadProxies) {
  var self = this;

  var threadId = self.agent.thread.current();
//return threadProxies[threadId % 10];
  if(threadId !== undefined) {
    // check if already mapped
    var threadProxyId = self.threadProxyMap[threadId];
    if(!threadProxyId) {
      // try to get a free wrapper
      threadProxyId = self.threadProxyPool.pop();
      if(threadProxyId) {
        // map wrapper id to thread id
        self.threadProxyMap[threadId] = threadProxyId;

        return threadProxies[threadProxyId];
      }
    }
    else {
      return threadProxies[threadProxyId];
    }
  }

  return undefined;
}


var Locals = function() {
  this.time = undefined;
  this.stackTrace = undefined;
  this.params = undefined;
  this.opts = undefined;
  this.group = undefined;
  this.req = undefined;
  this.res = undefined;
  this.error = undefined;
  this.transaction = undefined;
  this.exitCall = undefined;
}


Proxy.prototype.before = function(obj, meths, hook, isSnapshotEnabled, isCallbackHook) {
  var self = this;

  if(!Array.isArray(meths)) meths = [meths];

  meths.forEach(function(meth) {
    var orig = obj[meth];
    if(!orig) return;

    var threadProxies = isSnapshotEnabled ? self.generateThreadProxies(orig) : undefined;

    obj[meth] = function appd_proxy() {
      if(isCallbackHook) {
        var selfProxy = this;

        // the hook code should contain try/catch
        hook(this, arguments, function() {
          if(isSnapshotEnabled) {
            var threadProxy = self.getThreadProxy(threadProxies);
            if(threadProxy) {
              return threadProxy.apply(selfProxy, arguments);
            }
          }

          return orig.apply(selfProxy, arguments);
        });
      }
      else {
        try {
          hook(this, arguments);
        }
        catch(e) {
          self.logError(e);
        }

        if(isSnapshotEnabled) {
          var threadProxy = self.getThreadProxy(threadProxies);
          if(threadProxy) {
            return threadProxy.apply(this, arguments);
          }
        }

        return orig.apply(this, arguments);
      }
    };
  });
};


Proxy.prototype.after = function(obj, meths, hook) {
  var self = this;

  if(!Array.isArray(meths)) meths = [meths];

  meths.forEach(function(meth) {
    var orig = obj[meth];
    if(!orig) return;

    obj[meth] = function() {
      var ret = orig.apply(this, arguments);

      var hookRet;
      try {
        hookRet = hook(this, arguments, ret);
      }
      catch(e) {
        self.logError(e)
      }

      return hookRet || ret;
    };
  });
};



Proxy.prototype.around = function(obj, meths, hookBefore, hookAfter) {
  var self = this;

  if(!Array.isArray(meths)) meths = [meths];

  meths.forEach(function(meth) {
    var orig = obj[meth];
    if(!orig) return;

    obj[meth] = function() {
      var locals = new Locals();

      try {
        hookBefore(this, arguments, locals);
      }
      catch(e) {
        self.logError(e)
      }

      var ret = orig.apply(this, arguments);

      var hookRet;
      try {
        hookRet = hookAfter(this, arguments, ret, locals);
      }
      catch(e) {
        self.logError(e)
      }

      return hookRet || ret;
    };
  });
};


Proxy.prototype.callback = function(args, pos, hookBefore, hookAfter, isSnapshotEnabled) {
  var self = this;

  if(args.length <= pos) return false;
  if(pos === -1) pos = args.length - 1;

  var orig = (typeof args[pos] === 'function') ? args[pos] : undefined;
  if(!orig) return;

  args[pos] = function appd_proxy() {
    if(hookBefore) {
      try {
        hookBefore(this, arguments);
      }
      catch(e) {
        self.logError(e);
      }
    }

    var ret = orig.apply(this, arguments);

    if(hookAfter) {
      try {
        hookAfter(this, arguments);
      }
      catch(e) {
        self.logError(e);
      }
    }
    return ret;
  };

  if(isSnapshotEnabled) {
    var threadProxies = self.generateThreadProxies(args[pos]);
    var threadProxy = self.getThreadProxy(threadProxies);
    if(threadProxy) {
      args[pos] = threadProxy;
    }
  }

  // this is needed for removeListener
  orig.__appdynamicsProxy__ = args[pos];
};


Proxy.prototype.getter = function(obj, props, hook) {
  var self = this;

  if(!Array.isArray(props)) props = [props];

  props.forEach(function(prop) {
    var orig = obj.__lookupGetter__(prop);
    if(!orig) return;

    obj.__defineGetter__(prop, function() {
      var ret = orig.apply(this, arguments);

      try {
        hook(this, ret);
      }
      catch(e) {
        self.logError(e)
      }

      return ret;
    });
  });
};


Proxy.prototype.getErrorObject = function(args) {
  if(args && args.length > 0 && args[0]) {
    if(typeof(args[0]) === 'object' || typeof(args[0]) === 'string') {
      return args[0];
    }
    else {
      return 'unspecified';
    }
  }

  return undefined;
};


Proxy.prototype.logError = function(err) {
  this.agent.logger.error(err);
}

