'use strict';

/**
require("appdynamics").profile({
  controllerHostName: '127.0.0.1',
  controllerPort: 8090,
  controllerSslEnabled: false, //Optional   
  accountName: '', //Required for a controller running in multi-tenant mode.
  accountAccessKey: '', //Required for a controller running in multi-tenant mode.
  applicationName: 'PayPal ECommerce Store',
  tierName: 'NodeJS Web Tier',
  nodeName:'nodejs-osxltsturt', //Prefix to the full node name.
  debug: true //Debug is optional; defaults to false.
 });
**/

var kraken = require('kraken-js'),
    db = require('./lib/database'),
    language = require('./lib/language'),
    express = require('express'),   
    paypal = require('paypal-rest-sdk'),
    app = {};

    app.configure = function configure(nconf, next) {
    
      db.config(nconf.get('databaseConfig'));

      //Configure the PayPal SDK
      paypal.configure(nconf.get('paypalConfig'));
      next(null);

      // Async method run on startup.
      next(null);
    };


app.requestStart = function requestStart(server) {
    // Run before most express middleware has been registered.
};

app.requestBeforeRoute = function requestBeforeRoute(server) {
    // Run before any routes have been added.
    server.use(express.methodOverride());
    server.use(language());
};


app.requestAfterRoute = function requestAfterRoute(server) {
    // Run after all routes have been added.
};


if (require.main === module) {
    kraken.create(app).listen(function (err, server) {
        if (err) {
            console.error(err.stack);
        }
    });
}


module.exports = app;
